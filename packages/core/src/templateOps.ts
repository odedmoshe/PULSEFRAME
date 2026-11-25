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
import { ApplyTemplateArgsSchema, AssetRefSchema, findGatedTemplate, RefSchema, type ApplyTemplateOutput, type PlannedSlot, type TemplateStep } from './templateContract.ts';
import * as T from '@pulseframe/time';
import type { ProjectDocument, RecipeRun, RunRange, SlotRecord } from './schema.ts';
import { attachKnownGrid } from './packOps.ts';
import { own } from './own.ts';
import { analysisEntityId, fingerprint } from './entities.ts';
import { clipEnd } from './validate.ts';

/** How deep a step's arguments are walked for bindings. */
export const MAX_BINDING_DEPTH = 64;
/** A run record holds at most this many slots (schema.ts RecipeRunSchema.slots). */
const MAX_RUN_SLOTS = 400;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The slot records of a run whose clip is no longer in the document: items deleted by hand since the run (ADR-0016, decision 6).
 * Nothing records the delete: the slot record outlives its clip ("an inert, detached slot", schema.ts), so the answer follows the
 * document and its history (undo the delete and the slot is live again). A regeneration passes them as keepSlots, so the new run
 * record carries them and the next regeneration still knows; with restoreRemoved it leaves them out and the items are made again.
 */
export const removedByHand = (doc: ProjectDocument, slots: readonly SlotRecord[]): SlotRecord[] => slots.filter((s) => !findClip(doc, s.clipId));
/**
 * The clips among `ids` whose ONLY change since the run is their place in time (ADR-0016 decision 6, amendment of 2026-11-24):
 * a ripple delete before them closed the gap, or they were dragged along their track. Such a clip is not "edited by hand" for a
 * template regeneration; it is replaced and made again on its slot like an untouched one. The test, per clip:
 * - the run recorded where it placed the clip (run.ranges[id], written by apply_template with recordRanges);
 * - the clip is on the track recorded there (a clip taken to another track was arranged by hand and stays protected; an entry
 *   without a track cannot be checked and names nothing);
 * - its start differs from the recorded start; and
 * - its content fingerprint with the recorded start put back equals the fingerprint the run recorded, so nothing else differs:
 *   not its length, source range, speed, transform, keyframes, effects, sound, link, text or style.
 * A run without recorded places (made before this rule) names none here; the server then works the places out from the run's
 * own plan (derivedRanges) and passes them as `ranges`, and the same test decides.
 * Pure; reads the document and the run record only, so undo of the move gives the old answer back.
 */
export function movedOnly(doc: ProjectDocument, run: Pick<RecipeRun, 'fingerprints' | 'ranges'>, ids: readonly string[]): string[] {
  const ranges = run.ranges ?? {}, fingerprints = run.fingerprints ?? {};
  return ids.filter((id) => {
    const f = findClip(doc, id);
    const place = Object.hasOwn(ranges, id) ? ranges[id] : undefined, recorded = Object.hasOwn(fingerprints, id) ? fingerprints[id] : undefined;
    if (!f || !place || recorded === undefined || place.trackId !== f.track.id || T.eq(f.clip.start, place.start)) return false;
    return fingerprint({ ...f.clip, start: place.start }) === recorded;
  });
}
/**
 * How many different amounts the deletes before the clips of one track could have moved them by (the subset sums of the gone
 * clips' lengths, level by level) closedGapOnly follows. Equal-length slots never come near it (n gone clips give at most n + 1
 * amounts); 12 gone clips of pairwise different lengths can reach it (2^12). A track that goes beyond it is judged by the
 * full-sum test instead: every gone clip before a clip counted as having closed its gap.
 */
export const MAX_GAP_AMOUNTS = 4096;
/**
 * movedOnly, narrowed for runs whose clips a person arranges by dragging (the family film, the beat montage; ADR-0026): only a
 * move that deletes which closed their gaps explain. The run's own clips that are gone from the document and whose recorded
 * range lies on a track are that track's gone clips. Each was deleted either with its gap closed (ripple_delete_clips: every
 * later clip of the track moves earlier by its length) or with its gap kept (delete_clip: nothing moves), and the document does
 * not say which. So per track ONE reading is chosen — for each gone clip, closed or kept — and a clip is named when, besides
 * the conditions of movedOnly, its start is EARLIER than recorded by exactly the summed length of the gone clips recorded
 * before it that the reading takes as closed (exact rational arithmetic; a clip with no gone clip before it is never named).
 * The reading chosen is the one that agrees with the most of the track's clips among `ids`: a clip agrees when it lies on its
 * recorded track and either passes movedOnly and moved by exactly the reading's amount for its place, or still starts where
 * recorded while the reading's amount there is zero. Among readings that agree with equally many clips, the one that names
 * fewer moved clips wins, then the one with fewer closed gaps, then the smaller total; so in doubt a clip stays kept.
 * (The gone clips before a clip are a prefix of the track's gone clips in time order, so the readings are followed level by
 * level, one state per amount reached; at most MAX_GAP_AMOUNTS amounts, see there for what happens beyond.)
 * A clip linked to a named clip moves with it by the same amount on its own track (a pick's own sound), so a clip also counts
 * when it moved by exactly as much as a clip it is linked to that passes the test itself.
 * Therefore: with no deleted length before it, any move is a move by hand and the clip is not named (it stays kept, and the
 * planner lays the rest around it); after a Delete that closed its gap and a Shift+Delete that kept its gap, in either order,
 * the later clips moved by the one closed length and are named; after several gap-closing deletes their sum is what counts; a
 * clip dragged on by hand after a delete moved by an amount no reading gives, or by one that the rest of its track
 * contradicts, and is not named, while the clips around it still are; a delete on another track does not count for this track;
 * a deleted clip the run did not make (or one already gone when the run was made: not among its createdIds) adds nothing, so
 * clips moved by it are not named. In all the not-named cases the answer is the one from before the rule: kept by hand.
 * What it cannot tell: a clip dragged by hand to exactly the place one reading of the deletes gives it, where no other reading
 * agrees with more of the track (the last clip of a track pulled into the gap a Shift+Delete left: the document is then the
 * very one a plain Delete leaves). It is named and laid out again like the clips a delete moved.
 */
export function closedGapOnly(doc: ProjectDocument, run: Pick<RecipeRun, 'fingerprints' | 'ranges' | 'createdIds'>, ids: readonly string[]): string[] {
  const ranges = run.ranges ?? {};
  const place = (id: string) => (Object.hasOwn(ranges, id) ? ranges[id] : undefined);
  const gone = run.createdIds.filter((id) => !findClip(doc, id)).flatMap((id) => { const r = place(id); return r && r.trackId !== undefined ? [r] : []; });
  const shiftOf = (id: string) => T.sub(place(id)!.start, findClip(doc, id)!.clip.start);
  const moved = movedOnly(doc, run, ids);
  const keyOf = (t: T.RationalTime) => { const x = T.normalize(t); return `${x.value}/${x.timescale}`; };
  const closed: string[] = [];
  for (const trackId of new Set(gone.map((g) => g.trackId!))) {
    const lengths = gone.filter((g) => g.trackId === trackId).sort((a, b) => T.cmp(a.end, b.end)).map((g) => ({ end: g.end, length: T.sub(g.end, g.start) }));
    // the track's clips that say something: where each was recorded (level = how many gone clips lay before it) and how far it moved
    const said: { id: string; level: number; shift: T.RationalTime; moved: boolean }[] = [];
    for (const id of ids) {
      const f = findClip(doc, id), at = place(id);
      if (!f || !at || at.trackId !== trackId || f.track.id !== trackId) continue;
      const isMoved = moved.includes(id), shift = shiftOf(id);
      if (!isMoved && !T.isZero(shift)) continue; // moved and changed otherwise: says nothing either way
      said.push({ id, level: lengths.filter((g) => !T.lt(at.start, g.end)).length, shift, moved: isMoved });
    }
    const candidates = said.filter((c) => c.moved && c.level > 0);
    if (!candidates.length) continue;
    // per level, how many clips moved by each amount: [clips that agree, of which moved]
    const votes = lengths.map(() => new Map<string, [number, number]>());
    for (const c of said) if (c.level > 0) { const m = votes[c.level - 1]!, k = keyOf(c.shift), v = m.get(k) ?? [0, 0]; m.set(k, [v[0] + 1, v[1] + (c.moved ? 1 : 0)]); }
    // one state per amount reached after each gone clip: the best reading that reaches it (agreeing clips, then fewer named, then fewer closed)
    interface State { sum: T.RationalTime; agree: number; named: number; closedGaps: number; before: State | null }
    const better = (a: State, b: State) => a.agree !== b.agree ? a.agree > b.agree : a.named !== b.named ? a.named < b.named : a.closedGaps !== b.closedGaps ? a.closedGaps < b.closedGaps : T.lt(a.sum, b.sum);
    let states = new Map<string, State>([[keyOf(T.ZERO), { sum: T.ZERO, agree: 0, named: 0, closedGaps: 0, before: null }]]);
    let within = true;
    for (let level = 0; level < lengths.length && within; level++) {
      const next = new Map<string, State>();
      for (const s of states.values())
        for (const isClosed of [false, true]) {
          const sum = isClosed ? T.add(s.sum, lengths[level]!.length) : s.sum, k = keyOf(sum), v = votes[level]!.get(k) ?? [0, 0];
          const state: State = { sum, agree: s.agree + v[0], named: s.named + v[1], closedGaps: s.closedGaps + (isClosed ? 1 : 0), before: s };
          const had = next.get(k);
          if (!had || better(state, had)) next.set(k, state);
        }
      states = next;
      within = states.size <= MAX_GAP_AMOUNTS;
    }
    // the amount at each level: of the chosen reading, or (beyond the bound) of the reading in which every gap closed
    const amounts: T.RationalTime[] = [];
    if (within) {
      let best: State | null = null;
      for (const s of states.values()) if (!best || better(s, best)) best = s;
      for (let s = best; s && s.before; s = s.before) amounts.unshift(s.sum);
    } else lengths.reduce((sum, g) => { const total = T.add(sum, g.length); amounts.push(total); return total; }, T.ZERO);
    for (const c of candidates) if (T.eq(c.shift, amounts[c.level - 1]!)) closed.push(c.id);
  }
  const groupOf = (id: string) => { const c = findClip(doc, id)!.clip; return c.type === 'media' ? c.linkGroupId : null; };
  return moved.filter((id) => closed.includes(id) || closed.some((other) => !!groupOf(id) && groupOf(other) === groupOf(id) && T.eq(shiftOf(other), shiftOf(id))));
}
/**
 * The clips among `ids` that lie on another track than the one the run recorded for them: taken there by hand, so edited by hand
 * and kept where they are, whether or not their time changed too (the fingerprint holds no track, so only a run that recorded
 * `trackId` can tell). A run without recorded tracks names none and behaves as before.
 */
export function onOtherTrack(doc: ProjectDocument, run: Pick<RecipeRun, 'ranges'>, ids: readonly string[]): string[] {
  const ranges = run.ranges ?? {};
  return ids.filter((id) => {
    const f = findClip(doc, id), place = Object.hasOwn(ranges, id) ? ranges[id] : undefined;
    return !!f && place?.trackId !== undefined && place.trackId !== f.track.id;
  });
}
/**
 * The places of a run that recorded none (made before run.ranges; ADR-0016 decision 6, amendment of 2026-11-24), worked out from
 * a plan made again with the run's OWN stored parameters on the document without the run's clips: per live clip of a run slot,
 * the start (and length) its making step gives it, and the track when that step names an existing one. Only such a clip gets a
 * `trackId`, and movedOnly accepts a clip only with one, so the kinds covered are those the plan places on a named track:
 * the pictures of a template and of a film (when the plan finds their track again and does not ask for a new one), a film's
 * music, a template's graphic elements. A picture's own sound is placed with its picture by the same step on a track that step
 * chooses: it gets its picture's start and the track it lies on now (its track cannot be checked). Titles, looks, sound effects
 * and a template's music are placed on a track the operation chooses and are not covered: moved, they stay kept as before.
 * Nothing here is trusted on its own: movedOnly accepts a clip only when its fingerprint with this start equals the run's.
 * A clip of a slot that is gone from the document (deleted by hand since) gets the place its step gave it, with the step's own
 * length: closedGapOnly sums those. A deleted picture's own sound has no slot and is not listed; the sound of a later picture
 * is told by having moved exactly as far as its picture.
 */
export function derivedRanges(doc: ProjectDocument, plan: { ops: readonly TemplateStep[]; slots: readonly PlannedSlot[] }, run: Pick<RecipeRun, 'slots' | 'createdIds'>): Record<string, RunRange> {
  const out: Record<string, RunRange> = {};
  const isTime = (v: unknown): v is T.RationalTime => T.isRationalTime(v);
  for (const record of run.slots ?? []) {
    const f = findClip(doc, record.clipId);
    const planned = plan.slots.find((s) => s.key === record.key);
    if (!planned || typeof planned.clipId === 'string' || (planned.clipId.out !== undefined && planned.clipId.out !== 'clipId')) continue;
    const bind = planned.clipId.$ref;
    const step = plan.ops.find((o) => o.bind === bind);
    const args = step && isObject(step.args) ? step.args : undefined;
    if (!args) continue;
    const span = isObject(args.span) ? args.span : args;
    if (!isTime(span.start)) continue;
    const start = span.start;
    const track = typeof args.trackId === 'string' ? { trackId: args.trackId } : {};
    if (!f) {
      // a clip the run made that is gone now (deleted by hand since): where it lay, when its step says how long it was. It is
      // what closedGapOnly sums; a slot carried on from an earlier run (not among createdIds) was never this run's clip
      if (run.createdIds.includes(record.clipId) && isTime(span.duration)) out[record.clipId] = { start: { ...start }, end: { ...T.add(start, span.duration) }, ...track };
      continue;
    }
    out[record.clipId] = { start: { ...start }, end: { ...T.add(start, f.clip.duration) }, ...track };
    // the picture's own sound, made by the same step: same start, on the track it is on now
    if (args.withLinkedAudio === true && f.clip.type === 'media' && f.clip.linkGroupId) {
      const group = f.clip.linkGroupId;
      for (const id of run.createdIds) {
        const p = id === record.clipId ? undefined : findClip(doc, id);
        if (p && p.clip.type === 'media' && p.clip.linkGroupId === group && p.track.kind === 'audio') out[id] = { start: { ...start }, end: { ...T.add(start, p.clip.duration) }, trackId: p.track.id };
      }
    }
  }
  return out;
}
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
    const earlier = a.runId ? own(d.recipeRuns, a.runId) : undefined;
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
    // d'. where each clip lies, when asked (recordRanges): the place that goes with its fingerprint. A clip kept from the earlier
    // run keeps that run's entry (or none, when that run recorded none), as it keeps that run's fingerprint.
    let ranges: Record<string, RunRange> | undefined;
    if (a.recordRanges) {
      ranges = {};
      const keptIds = new Set(a.keepIds ?? []), before = earlier?.ranges ?? {};
      for (const cid of createdIds) {
        const f = findClip(d, cid);
        if (!f) continue;
        if (keptIds.has(cid)) {
          const r = Object.hasOwn(before, cid) ? before[cid] : undefined;
          if (r) ranges[cid] = { start: { ...r.start }, end: { ...r.end }, ...(r.trackId !== undefined ? { trackId: r.trackId } : {}) };
        } else ranges[cid] = { start: { ...f.clip.start }, end: { ...clipEnd(f.clip) }, trackId: f.track.id };
      }
    }
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
    d.recipeRuns[id] = { id, recipeId, params: { ...a.params, templateVersion: a.templateVersion }, createdIds, fingerprints, steps: a.steps, slots, ...(ranges ? { ranges } : {}) };
    affected.add(id);
    const output: ApplyTemplateOutput = { runId: id, createdIds, slots, assetIds: Object.fromEntries(assets) };
    return { affectedIds: [...affected], summary: `${a.runId ? 'Regenerated' : 'Applied'} template ${a.templateId}: ${a.steps[0] ?? ''}`.slice(0, 200), output: output as unknown as Record<string, unknown> };
  },
});
