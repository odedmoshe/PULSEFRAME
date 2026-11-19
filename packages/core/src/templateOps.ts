/**
 * apply_template (internal, v1; ADR-0016): applies a template plan (public ops with bindings) as ONE step and records the run
 * with its slots. Issued only by the server from a plan it built (apps/server/src/templates.ts), like apply_recipe; the
 * arguments carry everything (asset records, resolved ops), so replay never reads the template catalogue.
 * Registered on import of this module (packages/core/src/index.ts exports it).
 *
 * The binding language (templateContract.ts RefSchema / AssetRefSchema) runs on this trusted path and is kept small and
 * strict: a binding is exactly one of the two strict shapes, it names only steps that came EARLIER (or asset keys of this
 * call), bind names and asset keys live in Maps, an output key is read only when it is the output's own property
 * (Object.hasOwn), and the walk stops at 64 levels. Names such as "constructor" or "toString" therefore find nothing.
 */
import { z } from 'zod';
import { createdIdsOf, defineOp, findClip, getOp, OpError, refuseInheritedIds, removeRunClips, runFingerprints } from './ops.ts';
import { ApplyTemplateArgsSchema, AssetRefSchema, findGatedTemplate, RefSchema, type ApplyTemplateOutput } from './templateContract.ts';
import type { SlotRecord } from './schema.ts';
import { attachKnownGrid } from './packOps.ts';
import { analysisEntityId } from './entities.ts';

/** How deep a step's arguments are walked for bindings. */
export const MAX_BINDING_DEPTH = 64;
/** A run record holds at most this many slots (schema.ts RecipeRunSchema.slots). */
const MAX_RUN_SLOTS = 400;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const BINDING_SHAPE = 'a binding is exactly {"$ref": name} with optional "out" and "at", or {"$asset": key}';

/**
 * The value a reference stands for: output.clipId of the step bound as `$ref`, or output[out] (a string or a list of strings),
 * or output[out][at] (a string). Anything else is refused with invalid_args.
 */
function resolveRef(ref: z.infer<typeof RefSchema>, bound: ReadonlyMap<string, Readonly<Record<string, unknown>>>, where: string): string | string[] {
  const output = bound.get(ref.$ref);
  if (!output) throw new OpError('invalid_args', `${where}: "$ref": "${ref.$ref}" names no earlier step`, { ref: ref.$ref }, 'A reference names the bind of a step that comes before it.');
  const key = ref.out ?? 'clipId';
  // own properties only: an output never answers to "constructor", "toString" or other inherited names
  const value = Object.hasOwn(output, key) ? output[key] : undefined;
  if (ref.at !== undefined) {
    const item = Array.isArray(value) ? value[ref.at] : undefined;
    if (typeof item !== 'string') throw new OpError('invalid_args', `${where}: "$ref": "${ref.$ref}" has no text id at ${key}[${ref.at}]`, { ref: ref.$ref, out: key, at: ref.at });
    return item;
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) return [...value];
  throw new OpError('invalid_args', `${where}: "$ref": "${ref.$ref}" has no text id or list of ids at ${key}`, { ref: ref.$ref, out: key });
}

/**
 * Replace the bindings ({$ref}, {$asset}; templateContract.ts RefSchema / AssetRefSchema) inside one step's args, BEFORE the
 * step's own zod parse. `bound` holds the outputs of earlier steps by bind name, `assets` the asset ids by asset key; `where`
 * names the step in refusals. Returns a new value; `args` is not changed. An object with a "$ref" or "$asset" key is a binding
 * and must be exactly one of the strict shapes; every other value is copied as it is (own keys only, by definition, so a key
 * "__proto__" in parsed JSON stays an ordinary key).
 */
export function resolveBindings(args: unknown, bound: ReadonlyMap<string, Readonly<Record<string, unknown>>>, assets: ReadonlyMap<string, string>, where: string): unknown {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > MAX_BINDING_DEPTH) throw new OpError('invalid_args', `${where}: the arguments are nested more than ${MAX_BINDING_DEPTH} levels deep`, { maxDepth: MAX_BINDING_DEPTH });
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (!isObject(v)) return v;
    if (Object.hasOwn(v, '$ref') || Object.hasOwn(v, '$asset')) {
      const ref = RefSchema.safeParse(v);
      if (ref.success) return resolveRef(ref.data, bound, where);
      const asset = AssetRefSchema.safeParse(v);
      if (!asset.success) throw new OpError('invalid_args', `${where}: ${BINDING_SHAPE}`, { binding: Object.keys(v).slice(0, 8) });
      const id = assets.get(asset.data.$asset);
      if (id === undefined) throw new OpError('invalid_args', `${where}: "$asset": "${asset.data.$asset}" names no asset of this template`, { asset: asset.data.$asset });
      return id;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]));
  };
  return walk(args, 0);
}

defineOp({
  name: 'apply_template',
  version: 1,
  internal: true,
  description: 'Apply a template plan (ordinary public ops with bindings to earlier steps and to the procedural media it carries) as one step, and record the run with its slots. Issued by the server from a plan it built; on regeneration it first removes the previous run\'s untouched clips. Rule-based; no model.',
  args: ApplyTemplateArgsSchema,
  apply(d, a, ctx) {
    // a template that needs a model this build does not have is never applied (MODEL_GATED_TEMPLATES); the server refuses it
    // before planning, and so does the op, whatever the plan says
    const gated = findGatedTemplate(a.templateId);
    if (gated) throw new OpError('incompatible', `template ${gated.id} needs a model that is not installed, so it is never applied`, { templateId: gated.id, needsModel: gated.needsModel }, 'Choose one of the available templates (GET /api/v1/templates).');
    const recipeId = `template:${a.templateId}`;
    const earlier = a.runId ? d.recipeRuns[a.runId] : undefined;
    if (earlier && earlier.recipeId !== recipeId) throw new OpError('invalid_args', `run ${a.runId} is a run of ${earlier.recipeId}, not of ${recipeId}`, { runId: a.runId, recipeId: earlier.recipeId });
    // a. regeneration: the previous run's untouched clips go (and what is left linked to nothing is unlinked)
    const affected = new Set<string>(removeRunClips(d, a.removeClipIds ?? []));
    // b. the procedural media the server made for this plan, deduplicated by content like import_asset
    const assets = new Map<string, string>();
    for (const { key, asset, analysis } of a.assets ?? []) {
      if (assets.has(key)) throw new OpError('invalid_args', `asset key "${key}" is given twice`, { key });
      const existing = Object.values(d.assets).find((x) => x.contentHash === asset.contentHash);
      const id = existing?.id ?? ctx.newId('ast');
      if (!existing) { d.assets[id] = { id, ...asset }; affected.add(id); }
      assets.set(key, id);
      // built-in music (ADR-0022) arrives with its known beat grid; it is attached as add_builtin_music attaches it
      if (analysis && attachKnownGrid(d, id, analysis, ctx.actor)) affected.add(analysisEntityId(id));
    }
    // c. the steps, each with its bindings resolved against the steps before it only
    const bound = new Map<string, Readonly<Record<string, unknown>>>();
    const created: string[] = [...(a.keepIds ?? [])];
    for (const [i, step] of a.ops.entries()) {
      const where = `template step ${i} (${step.op})`;
      const def = getOp(step.op);
      if (!def || def.internal) throw new OpError('forbidden_op', `template step ${i} uses "${step.op}", which is not a public operation`, { index: i });
      if (step.bind !== undefined && bound.has(step.bind)) throw new OpError('invalid_args', `${where}: the bind name "${step.bind}" is used twice`, { index: i, bind: step.bind });
      const args = resolveBindings(step.args, bound, assets, where);
      const parsed = def.args.safeParse(args);
      if (!parsed.success) throw new OpError('invalid_args', `${where}: ${z.prettifyError(parsed.error)}`, { index: i });
      refuseInheritedIds(parsed.data, where, '', def.checksOwnIds);
      const r = def.apply(d, parsed.data, ctx);
      for (const id of r.affectedIds) affected.add(id);
      const out = r.output ?? {};
      created.push(...createdIdsOf(out));
      if (step.bind !== undefined) bound.set(step.bind, out);
    }
    // d. what the run made, and the fingerprints that later tell hand edits apart
    const { createdIds, fingerprints } = runFingerprints(d, created, a.keepIds ?? [], earlier?.fingerprints ?? {});
    // e. every planned slot names a clip that exists now
    const resolved: SlotRecord[] = a.slots.map((s, i) => {
      let clipId: unknown;
      try { clipId = typeof s.clipId === 'string' ? s.clipId : resolveRef(s.clipId, bound, `slot ${i} (${s.key})`); } catch (e) { if (!(e instanceof OpError)) throw e; clipId = undefined; }
      if (typeof clipId !== 'string' || !findClip(d, clipId)) throw new OpError('invalid_result', `slot ${i} (${s.key}) names no clip the template made`, { index: i, key: s.key });
      return { key: s.key, kind: s.kind, clipId, ...(s.accept ? { accept: s.accept } : {}), ...(s.beats ? { beats: s.beats } : {}) };
    });
    // f. the run record: kept slots (hand-edited items of the previous run) and the new ones
    const kept = a.keepSlots ?? [];
    const slots = [...kept, ...resolved.filter((s) => !kept.some((k) => k.key === s.key && k.clipId === s.clipId))];
    if (slots.length > MAX_RUN_SLOTS) throw new OpError('invalid_args', `a template run holds at most ${MAX_RUN_SLOTS} slots; this one would hold ${slots.length}`, { slots: slots.length });
    const id = a.runId ?? ctx.newId('run');
    d.recipeRuns[id] = { id, recipeId, params: { ...a.params, templateVersion: a.templateVersion }, createdIds, fingerprints, steps: a.steps, slots };
    affected.add(id);
    const output: ApplyTemplateOutput = { runId: id, createdIds, slots, assetIds: Object.fromEntries(assets) };
    return { affectedIds: [...affected], summary: `${a.runId ? 'Regenerated' : 'Applied'} template ${a.templateId}: ${a.steps[0] ?? ''}`.slice(0, 200), output: output as unknown as Record<string, unknown> };
  },
});
