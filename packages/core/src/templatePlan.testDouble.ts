/**
 * TEST DOUBLE — not product code; imported only by tests (templatePlan.test.ts, apps/server/src/templates.test.ts).
 *
 * The internal op apply_template (ADR-0016) is built by another worker of the templates track (templateOps.ts). On a tree where
 * the registered op is still the contracts stub (it refuses every call with unknown_op), `useApplyTemplateDoubleIfStub()` puts
 * this double's body in its place so the planner's plans and the server's flow can be exercised end to end. Where the real op
 * is registered, it changes nothing and the tests run against the real op. Remove this file once the real op has merged.
 *
 * The double follows the contract comments in templateContract.ts (RefSchema, AssetRefSchema, ApplyTemplateArgs,
 * ApplyTemplateOutput) and the order the task gives: remove the previous run's untouched clips (unlinking what is left alone),
 * attach the procedural assets (deduplicated by content), run each step with its bindings resolved against EARLIER steps only,
 * record created ids, fingerprints and slots.
 */
import { z } from 'zod';
import { AssetRefSchema, RefSchema, type ApplyTemplateArgs } from './templateContract.ts';
import { findClip, getOp, makeIdSource, OpError, refuseInheritedIds, type OpContext, type OpResult } from './ops.ts';
import { fingerprint } from './entities.ts';
import { createProject, type ProjectDocument, type SlotRecord } from './schema.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function resolve(v: unknown, bound: Map<string, Record<string, unknown>>, assets: Map<string, string>, where: string, depth = 0): unknown {
  if (depth > 64) throw new OpError('invalid_args', `${where}: nested too deep`);
  if (Array.isArray(v)) return v.map((x) => resolve(x, bound, assets, where, depth + 1));
  if (!isObj(v)) return v;
  if (Object.hasOwn(v, '$ref') || Object.hasOwn(v, '$asset')) {
    const r = RefSchema.safeParse(v);
    if (r.success) return ref(r.data, bound, where);
    const a = AssetRefSchema.safeParse(v);
    if (!a.success) throw new OpError('invalid_args', `${where}: malformed binding`);
    const id = assets.get(a.data.$asset);
    if (id === undefined) throw new OpError('invalid_args', `${where}: unknown asset key ${a.data.$asset}`);
    return id;
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, bound, assets, where, depth + 1)]));
}
function ref(r: z.infer<typeof RefSchema>, bound: Map<string, Record<string, unknown>>, where: string): string | string[] {
  const out = bound.get(r.$ref);
  if (!out) throw new OpError('invalid_args', `${where}: "${r.$ref}" names no earlier step`);
  const key = r.out ?? 'clipId';
  const value = Object.hasOwn(out, key) ? out[key] : undefined;
  if (r.at !== undefined) { const item = Array.isArray(value) ? value[r.at] : undefined; if (typeof item !== 'string') throw new OpError('invalid_args', `${where}: no id at ${key}[${r.at}]`); return item; }
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) return [...value];
  throw new OpError('invalid_args', `${where}: no id at ${key}`);
}

function applyDouble(d: ProjectDocument, a: ApplyTemplateArgs, ctx: OpContext): OpResult {
  const recipeId = `template:${a.templateId}`;
  const earlier = a.runId ? d.recipeRuns[a.runId] : undefined;
  const affected = new Set<string>();
  // a. the previous run's untouched clips go; a clip left alone in its link group is unlinked
  const groups = new Set<string>();
  for (const id of a.removeClipIds ?? []) {
    const f = findClip(d, id);
    if (!f) continue;
    if (f.track.locked) throw new OpError('track_locked', `track ${f.track.id} is locked`);
    f.track.clips.splice(f.index, 1);
    if (f.clip.type === 'media' && f.clip.linkGroupId) groups.add(f.clip.linkGroupId);
    affected.add(id);
  }
  for (const g of groups) {
    const members = Object.values(d.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'media' && c.linkGroupId === g);
    if (members.length === 1 && members[0]!.type === 'media') { members[0]!.linkGroupId = null; affected.add(members[0]!.id); }
  }
  // b. procedural assets, deduplicated by content
  const assets = new Map<string, string>();
  for (const { key, asset } of a.assets ?? []) {
    const existing = Object.values(d.assets).find((x) => x.contentHash === asset.contentHash);
    const id = existing?.id ?? ctx.newId('ast');
    if (!existing) { d.assets[id] = { id, ...asset }; affected.add(id); }
    assets.set(key, id);
  }
  // c. the steps
  const bound = new Map<string, Record<string, unknown>>();
  const created: string[] = [...(a.keepIds ?? [])];
  for (const [i, step] of a.ops.entries()) {
    const where = `template step ${i} (${step.op})`;
    const def = getOp(step.op);
    if (!def || def.internal) throw new OpError('forbidden_op', `${where}: not a public operation`);
    if (step.bind !== undefined && bound.has(step.bind)) throw new OpError('invalid_args', `${where}: bind ${step.bind} twice`);
    const parsed = def.args.safeParse(resolve(step.args, bound, assets, where));
    if (!parsed.success) throw new OpError('invalid_args', `${where}: ${z.prettifyError(parsed.error)}`);
    refuseInheritedIds(parsed.data, where, '', def.checksOwnIds);
    const r = def.apply(d, parsed.data, ctx);
    for (const id of r.affectedIds) affected.add(id);
    const out = r.output ?? {};
    for (const k of ['clipId', 'audioClipId', 'trackId', 'variantId'] as const) if (typeof out[k] === 'string') created.push(out[k] as string);
    if (step.bind !== undefined) bound.set(step.bind, out);
  }
  // d. created ids and fingerprints (kept clips keep their original fingerprint)
  const createdIds = [...new Set(created)].filter((x) => !!findClip(d, x) || Object.values(d.sequences).some((s) => s.tracks.some((t) => t.id === x)));
  const fingerprints: Record<string, string> = {};
  for (const id of createdIds) { const f = findClip(d, id); if (f) fingerprints[id] = (a.keepIds ?? []).includes(id) && earlier?.fingerprints[id] ? earlier.fingerprints[id]! : fingerprint(f.clip); }
  // e. slots
  const resolved: SlotRecord[] = a.slots.map((s) => {
    const clipId = typeof s.clipId === 'string' ? s.clipId : (() => { try { return ref(s.clipId, bound, s.key); } catch { return undefined; } })();
    if (typeof clipId !== 'string' || !findClip(d, clipId)) throw new OpError('invalid_result', `slot ${s.key} names no clip`);
    return { key: s.key, kind: s.kind, clipId, ...(s.accept ? { accept: s.accept } : {}), ...(s.beats ? { beats: s.beats } : {}) };
  });
  const kept = a.keepSlots ?? [];
  const slots = [...kept, ...resolved.filter((s) => !kept.some((k) => k.key === s.key && k.clipId === s.clipId))];
  const id = a.runId ?? ctx.newId('run');
  d.recipeRuns[id] = { id, recipeId, params: { ...a.params, templateVersion: a.templateVersion }, createdIds, fingerprints, steps: a.steps, slots };
  affected.add(id);
  return { affectedIds: [...affected], summary: `Applied template ${a.templateId} (test double)`, output: { runId: id, createdIds, slots, assetIds: Object.fromEntries(assets) } };
}

/** True when the registered apply_template is the contracts stub (it refuses a valid one-step plan with unknown_op). */
export function applyTemplateIsStub(): boolean {
  const def = getOp('apply_template');
  if (!def) return true;
  const doc = createProject({ id: 'prj_probe', name: 'probe' });
  try {
    def.apply(structuredClone(doc), { templateId: 'tpl.probe', templateVersion: 1, params: {}, steps: [], ops: [{ op: 'add_track', args: { kind: 'video' } }], slots: [] } as never, { newId: makeIdSource('probe'), actor: 'test' });
    return false;
  } catch (e) {
    return e instanceof OpError && e.code === 'unknown_op';
  }
}
/** Put the double in place of the stub's body (only while the stub is registered). Returns whether the double is in use. */
export function useApplyTemplateDoubleIfStub(): boolean {
  if (!applyTemplateIsStub()) return false;
  const def = getOp('apply_template')!;
  (def as { apply: unknown }).apply = applyDouble;
  return true;
}
