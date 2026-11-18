/**
 * Entity-level view of a project (SPEC §6): the unit of change tracking, undo and stale-result checks.
 * Entities: the project header, each asset, each track (without its clips) and each clip.
 * `diffEntities` is the exact creative difference between two documents; `restoreEntities` applies
 * target states. Undo is "restore the before-states of the entities a transaction changed, but only
 * if nobody changed them since" — a compensating transaction, never a history rewrite.
 */
import * as T from '@pulseframe/time';
import type { Analysis, Asset, Clip, LifeEvent, Marker, Person, ProjectDocument, RecipeRun, Sequence, Track, Transcript, Variant } from './schema.ts';
import { isInheritedName, own } from './own.ts';
import type { MotionTrack } from './tracking.ts';

export type EntityState =
  | { kind: 'project'; name: string; settings: ProjectDocument['settings'] }
  | { kind: 'asset'; asset: Asset }
  | { kind: 'track'; sequenceId: string; index: number; track: Omit<Track, 'clips'> }
  | { kind: 'clip'; sequenceId: string; trackId: string; clip: Clip }
  | { kind: 'transcript'; transcript: Transcript }
  | { kind: 'analysis'; analysis: Analysis }
  | { kind: 'variant'; variant: Variant }
  | { kind: 'recipeRun'; run: RecipeRun }
  | { kind: 'marker'; marker: Marker }
  /** A motion track (ADR-0015), keyed by its own id like a marker, so an edit sent from an out-of-date view of it conflicts. */
  | { kind: 'motionTrack'; track: MotionTrack }
  /** An event of the life line (ADR-0021), keyed by its own id. A file's capture date rides on its `asset` entity. */
  | { kind: 'lifeEvent'; event: LifeEvent }
  /**
   * A person named in titles (ADR-0021, people section), keyed by the person's own id. The state holds the birth date: it is
   * stored with the transaction for undo and never leaves the server for a credential without the people scope
   * (apps/server/src/peoplePrivacy.ts).
   */
  | { kind: 'person'; person: Person }
  /**
   * A sequence's own fields (ADR-0018): id, name, format and origin. Entity id = the sequence id. Its tracks, track order,
   * clips and markers stay their own entities. CONTRACT for W1 (entityMap / restoreEntities bodies):
   * - entityMap emits it for every sequence, keyed by the sequence id;
   * - restoreEntities step 0 (before step 1) creates a missing sequence with tracks [] or replaces its own fields (keys absent
   *   from the target are deleted, `tracks` is never touched); a final step deletes the sequences whose target is null,
   *   throws for mainSequenceId and throws while the sequence still holds tracks;
   * - the stricter undo rule (wave4-decisions.md, project-wide): step 1 throws `track <id> holds clips added later` when a
   *   track whose target is null still holds a clip the targets do not also set to null. A throw becomes invalid_result in
   *   restore_entities and then 409 undo_conflict in apps/server/src/store.ts undo(), so nothing is ever deleted silently.
   */
  | { kind: 'sequence'; sequence: Omit<Sequence, 'tracks'> }
  /** The stacking order of a sequence's tracks. Compared only over the tracks both sides have, so adding or removing a track is not an order change. */
  | { kind: 'trackOrder'; sequenceId: string; ids: string[] };
/** Entity id of an asset's analysis results. */
export const analysisEntityId = (assetId: string) => `analysis:${assetId}`;
/** Entity id of a sequence's track order. */
export const trackOrderEntityId = (sequenceId: string) => `order:${sequenceId}`;
/** Entity id of an asset's transcript. */
export const transcriptEntityId = (assetId: string) => `transcript:${assetId}`;
export interface EntityChange { id: string; before: EntityState | null; after: EntityState | null }

/** Key-order-independent JSON, with times reduced to lowest terms so equal instants compare equal. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    if (T.isRationalTime(v)) { const n = T.normalize(v); return `{"t":"${n.value}/${n.timescale}"}`; }
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function entityMap(doc: ProjectDocument): Map<string, EntityState> {
  const m = new Map<string, EntityState>();
  m.set(doc.id, { kind: 'project', name: doc.name, settings: doc.settings });
  for (const a of Object.values(doc.assets)) m.set(a.id, { kind: 'asset', asset: a });
  for (const t of Object.values(doc.transcripts ?? {})) m.set(transcriptEntityId(t.assetId), { kind: 'transcript', transcript: t });
  for (const a of Object.values(doc.analyses ?? {})) m.set(analysisEntityId(a.assetId), { kind: 'analysis', analysis: a });
  for (const v of Object.values(doc.variants ?? {})) m.set(v.id, { kind: 'variant', variant: v });
  for (const r of Object.values(doc.recipeRuns ?? {})) m.set(r.id, { kind: 'recipeRun', run: r });
  for (const k of Object.values(doc.markers ?? {})) m.set(k.id, { kind: 'marker', marker: k });
  for (const k of Object.values(doc.motionTracks ?? {})) m.set(k.id, { kind: 'motionTrack', track: k });
  for (const e of Object.values(doc.events ?? {})) m.set(e.id, { kind: 'lifeEvent', event: e });
  for (const p of Object.values(doc.people ?? {})) m.set(p.id, { kind: 'person', person: p });
  for (const seq of Object.values(doc.sequences)) {
    m.set(trackOrderEntityId(seq.id), { kind: 'trackOrder', sequenceId: seq.id, ids: seq.tracks.map((t) => t.id) });
    seq.tracks.forEach((t, index) => {
      const { clips, ...track } = t;
      m.set(t.id, { kind: 'track', sequenceId: seq.id, index, track });
      for (const clip of clips) m.set(clip.id, { kind: 'clip', sequenceId: seq.id, trackId: t.id, clip });
    });
  }
  return m;
}
/** Track position is ordering metadata: unrelated track insertions must not count as a change to this track. */
const comparable = (s: EntityState | null | undefined) => (s ? canonical(s.kind === 'track' ? { ...s, index: 0 } : s) : 'null');
/**
 * Structural equality with the same meaning as comparing `canonical()` strings (key order ignored, equal instants equal,
 * undefined properties ignored), but without building strings: this runs for every entity on every commit.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aa = Array.isArray(a), ba = Array.isArray(b);
  if (aa !== ba) return false;
  if (aa) { const x = a as unknown[], y = b as unknown[]; if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (!same(x[i], y[i])) return false; return true; }
  if (T.isRationalTime(a) && T.isRationalTime(b)) return T.eq(a, b);
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  let n = 0;
  for (const k in x) { if (x[k] === undefined) continue; n++; if (!same(x[k], y[k])) return false; }
  for (const k in y) if (y[k] !== undefined) n--;
  return n === 0;
}
export function sameEntity(a: EntityState | null | undefined, b: EntityState | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'trackOrder' && b.kind === 'trackOrder') { const [x, y] = commonOrder(a.ids, b.ids); return a.sequenceId === b.sequenceId && x.length === y.length && x.every((id, i) => id === y[i]); }
  // Track position is ordering metadata (see `comparable`).
  if (a.kind === 'track' && b.kind === 'track') return a.sequenceId === b.sequenceId && same(a.track, b.track);
  return same(a, b);
}
/** Each list restricted to the ids the other also has: the relative order of the tracks both sides know. */
const commonOrder = (a: string[], b: string[]): [string[], string[]] => { const inB = new Set(b), inA = new Set(a); return [a.filter((id) => inB.has(id)), b.filter((id) => inA.has(id))]; };
/** The slower string form of the same comparison; kept as the reference the fast path is tested against. */
export const sameEntityCanonical = (a: EntityState | null | undefined, b: EntityState | null | undefined) => {
  if (a?.kind === 'trackOrder' && b?.kind === 'trackOrder') { const [x, y] = commonOrder(a.ids, b.ids); return a.sequenceId === b.sequenceId && canonical(x) === canonical(y); }
  return comparable(a) === comparable(b);
};

export function diffEntities(before: ProjectDocument, after: ProjectDocument): EntityChange[] {
  const a = entityMap(before);
  const b = entityMap(after);
  const out: EntityChange[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) if (!sameEntity(a.get(id), b.get(id))) out.push({ id, before: a.get(id) ?? null, after: b.get(id) ?? null });
  return out;
}

/** The creative projection used to compare documents in undo/redo tests: no revisions, logs or timestamps exist in it. */
export const creativeProjection = (doc: ProjectDocument) => canonical([...entityMap(doc)].sort(([x], [y]) => (x < y ? -1 : 1)));

export interface RestoreTarget { id: string; state: EntityState | null }
/** Set each listed entity to the given state (null = absent). Mutates `draft`. Order-independent. */
export function restoreEntities(draft: ProjectDocument, targets: RestoreTarget[]): void {
  const removeClip = (id: string) => { for (const s of Object.values(draft.sequences)) for (const t of s.tracks) { const i = t.clips.findIndex((c) => c.id === id); if (i >= 0) t.clips.splice(i, 1); } };
  // An entry is stored under the id its recorded state carries. `record['__proto__'] = entry` would replace the record's prototype instead of adding an entry, so such an id is refused.
  const put = <V>(record: Record<string, V>, key: string, value: V) => { if (isInheritedName(key)) throw new Error(`id "${key}" is reserved and cannot name an item`); record[key] = value; };
  // 1. removals and in-place header/asset changes
  for (const { id, state } of targets) {
    const cur = entityMap(draft).get(id);
    if (cur?.kind === 'clip') removeClip(id);
    if (state === null) {
      if (cur?.kind === 'asset') delete draft.assets[id];
      if (cur?.kind === 'transcript') delete draft.transcripts[cur.transcript.assetId];
      if (cur?.kind === 'analysis') delete draft.analyses[cur.analysis.assetId];
      if (cur?.kind === 'variant') delete draft.variants[cur.variant.id];
      if (cur?.kind === 'recipeRun') delete draft.recipeRuns[cur.run.id];
      if (cur?.kind === 'marker') delete draft.markers[cur.marker.id];
      if (cur?.kind === 'motionTrack') delete draft.motionTracks[cur.track.id];
      if (cur?.kind === 'lifeEvent') delete draft.events[cur.event.id];
      // a project without people has no `people` key at all, so undoing the first add_person gives the stored document back exactly
      if (cur?.kind === 'person' && draft.people) { delete draft.people[cur.person.id]; if (Object.keys(draft.people).length === 0) delete draft.people; }
      if (cur?.kind === 'track') { const seq = own(draft.sequences, cur.sequenceId)!; seq.tracks.splice(seq.tracks.findIndex((t) => t.id === id), 1); }
    } else if (state.kind === 'project') { draft.name = state.name; draft.settings = structuredClone(state.settings); }
    else if (state.kind === 'asset') put(draft.assets, id, structuredClone(state.asset));
    else if (state.kind === 'transcript') put(draft.transcripts, state.transcript.assetId, structuredClone(state.transcript));
    else if (state.kind === 'analysis') put(draft.analyses, state.analysis.assetId, structuredClone(state.analysis));
    else if (state.kind === 'variant') put(draft.variants, state.variant.id, structuredClone(state.variant));
    else if (state.kind === 'recipeRun') put(draft.recipeRuns, state.run.id, structuredClone(state.run));
    else if (state.kind === 'marker') put((draft.markers ??= {}), state.marker.id, structuredClone(state.marker));
    else if (state.kind === 'motionTrack') put((draft.motionTracks ??= {}), state.track.id, structuredClone(state.track));
    else if (state.kind === 'lifeEvent') put((draft.events ??= {}), state.event.id, structuredClone(state.event));
    else if (state.kind === 'person') put((draft.people ??= {}), state.person.id, structuredClone(state.person));
  }
  // 2. tracks (so restored clips have a home), lowest original index first
  for (const { id, state } of targets.filter((t) => t.state?.kind === 'track').sort((x, y) => (x.state as any).index - (y.state as any).index)) {
    if (state?.kind !== 'track') continue;
    const seq = own(draft.sequences, state.sequenceId);
    if (!seq) throw new Error(`sequence ${state.sequenceId} missing`);
    const existing = seq.tracks.find((t) => t.id === id);
    if (existing) {
      // Replace, not merge: a property the track did not have in the target state (sound settings added later, say) must go.
      for (const k of Object.keys(existing)) if (k !== 'clips' && !(k in state.track)) delete (existing as Record<string, unknown>)[k];
      Object.assign(existing, structuredClone(state.track));
    }
    else seq.tracks.splice(Math.min(state.index, seq.tracks.length), 0, { ...structuredClone(state.track), clips: [] });
  }
  // 2b. track order: the tracks named in the target take that relative order, in the slots they occupy now; other tracks stay put
  for (const { state } of targets) {
    if (state?.kind !== 'trackOrder') continue;
    const seq = own(draft.sequences, state.sequenceId);
    if (!seq) continue;
    const want = state.ids.filter((id) => seq.tracks.some((t) => t.id === id));
    const wanted = new Set(want);
    const byId = new Map(seq.tracks.map((t) => [t.id, t]));
    let k = 0;
    seq.tracks = seq.tracks.map((t) => (wanted.has(t.id) ? byId.get(want[k++]!)! : t));
  }
  // 3. clips
  for (const { state } of targets) {
    if (state?.kind !== 'clip') continue;
    const track = own(draft.sequences, state.sequenceId)?.tracks.find((t) => t.id === state.trackId);
    if (!track) throw new Error(`track ${state.trackId} missing`);
    track.clips.push(structuredClone(state.clip));
    track.clips.sort((x, y) => T.cmp(x.start, y.start) || (x.id < y.id ? -1 : 1));
  }
}

/** Every string in op arguments that names an existing or formerly existing entity: what the caller's intent depends on. */
export function referencedIds(args: unknown, known: (id: string) => boolean, out = new Set<string>()): Set<string> {
  if (typeof args === 'string') { if (known(args)) out.add(args); }
  else if (Array.isArray(args)) for (const v of args) referencedIds(v, known, out);
  else if (args && typeof args === 'object') for (const v of Object.values(args)) referencedIds(v, known, out);
  return out;
}

/** Short content fingerprint of any JSON value (FNV-1a over its canonical form). Not cryptographic; used to notice hand edits. */
export function fingerprint(value: unknown): string {
  const s = canonical(value);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
