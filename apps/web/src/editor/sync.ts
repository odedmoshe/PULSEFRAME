/**
 * How the editor's copy of the project follows the server (the server stays the only authority: Store.commit).
 *
 * A live revision event carries the states its transaction left, by entity id (`changes`: the transaction's own diff, the one
 * stored for undo; apps/server/src/store.ts liveChanges). When the editor holds the document at exactly the revision before,
 * it applies them with core's restoreEntities (or, when every change is a clip, the same rule on copies of the touched tracks
 * only) and reads the result as every server read does (migrateProject: the schema's key order and defaults), which gives the
 * document GET /projects/:id would answer, byte for byte. Anything else reads the
 * whole document as before: an event without changes (replayed on reconnect, published after a restart, or sent to a reader
 * without the people scope), a gap in revisions, a large transaction, or a track whose clips share a start (restoreEntities
 * orders those by id; the stored order may differ). sync.test.ts drives a long fuzzed edit sequence through Store.commit and
 * the event stream's own serialisation and checks the hash of this document against the server's after every event.
 */
import { migrateProject, restoreEntities, type Clip, type EntityState, type ProjectDocument } from '@pulseframe/core';
import * as T from '@pulseframe/time';

/** One entity's state after the transaction (null: removed). */
export interface LiveChange { id: string; after: EntityState | null }
/** Above this many changed entities the whole document is read (restoreEntities looks each entity up in the whole document). */
export const MAX_LIVE_CHANGES = 64;

/**
 * The document after `changes`, from the document at the revision before (never changed). null: the whole document must be read.
 */
export function applyLiveChanges(base: ProjectDocument, changes: readonly LiveChange[]): ProjectDocument | null {
  if (changes.length === 0 || changes.length > MAX_LIVE_CHANGES) return null;
  try {
    const clips = clipChanges(base, changes);
    if (clips !== undefined) return clips;
    const draft = structuredClone(base);
    restoreEntities(draft, changes.map((c) => ({ id: c.id, state: c.after })));
    // restoreEntities keeps a track's clips sorted by (start, id); the stored order of clips that share a start is not known here
    const touched = new Set(changes.flatMap((c) => (c.after?.kind === 'clip' ? [`${c.after.sequenceId} ${c.after.trackId}`] : [])));
    for (const seq of Object.values(draft.sequences)) for (const t of seq.tracks) {
      if (!touched.has(`${seq.id} ${t.id}`)) continue;
      for (let i = 1; i < t.clips.length; i++) if (T.eq(t.clips[i - 1]!.start, t.clips[i]!.start)) return null;
    }
    return migrateProject(draft);
  } catch {
    return null; // not applicable to this document: read the whole one
  }
}

/**
 * The common case, without copying the whole document: every change is a clip (added, changed, moved or removed) on tracks
 * that exist. The same rule as restoreEntities step 3 (the clip leaves wherever it was, joins its track, the track is sorted
 * by start then id), on copies of the touched sequences and tracks only; the rest is shared with `base` (never changed) until
 * migrateProject copies it. undefined: not this case (the general path decides); null: read the whole document.
 */
function clipChanges(base: ProjectDocument, changes: readonly LiveChange[]): ProjectDocument | null | undefined {
  const at = new Map<string, { seq: string; track: string }>();
  for (const seq of Object.values(base.sequences)) for (const t of seq.tracks) for (const c of t.clips) at.set(c.id, { seq: seq.id, track: t.id });
  if (!changes.every((c) => (c.after ? c.after.kind === 'clip' : at.has(c.id)))) return undefined;
  const lists = new Map<string, Map<string, Clip[]>>(); // sequence id → track id → its clips (a copy)
  const list = (seqId: string, trackId: string): Clip[] | null => {
    const seq = Object.hasOwn(base.sequences, seqId) ? base.sequences[seqId]! : null;
    const track = seq?.tracks.find((t) => t.id === trackId);
    if (!track) return null;
    let bySeq = lists.get(seqId);
    if (!bySeq) lists.set(seqId, (bySeq = new Map()));
    let l = bySeq.get(trackId);
    if (!l) bySeq.set(trackId, (l = [...track.clips]));
    return l;
  };
  for (const c of changes) {
    const was = at.get(c.id);
    if (was) { const l = list(was.seq, was.track)!; l.splice(l.findIndex((x) => x.id === c.id), 1); }
  }
  for (const c of changes) {
    if (c.after?.kind !== 'clip') continue;
    const l = list(c.after.sequenceId, c.after.trackId);
    if (!l) return null;
    l.push(c.after.clip);
  }
  const sequences = { ...base.sequences };
  for (const [seqId, tracks] of lists) {
    for (const l of tracks.values()) {
      l.sort((x, y) => T.cmp(x.start, y.start) || (x.id < y.id ? -1 : 1));
      for (let i = 1; i < l.length; i++) if (T.eq(l[i - 1]!.start, l[i]!.start)) return null; // the stored order of these is not known here
    }
    const seq = base.sequences[seqId]!;
    sequences[seqId] = { ...seq, tracks: seq.tracks.map((t) => (tracks.has(t.id) ? { ...t, clips: tracks.get(t.id)! } : t)) };
  }
  return migrateProject({ ...base, sequences });
}

/** A revision event as the stream sends it (only what this module reads). */
export interface LiveEvent { revision: number; changes?: readonly LiveChange[] }

/**
 * The next document from a revision event: the applied changes when they apply to `doc` at `revision`, else null (read the
 * whole document; also when the event is not newer).
 */
export function nextFromEvent(doc: ProjectDocument | null, revision: number, e: LiveEvent): ProjectDocument | null {
  if (!doc || !e.changes || e.revision !== revision + 1) return null;
  return applyLiveChanges(doc, e.changes);
}

/**
 * The editor's document kept in step with the events, outside the editor (the request bench and sync.test.ts): the same rule
 * the editor store applies (apps/web/src/editor/store.ts, revision events).
 */
export class EditorDocSync {
  doc: ProjectDocument | null = null;
  revision = 0;
  /** Events applied from their changes, and whole-document reads. */
  applied = 0;
  reads = 0;
  constructor(private readWhole: () => Promise<{ project: ProjectDocument; revision: number }>) {}
  reset(doc: ProjectDocument, revision: number) { this.doc = doc; this.revision = revision; }
  async onEvent(e: LiveEvent) {
    if (e.revision <= this.revision) return;
    const next = nextFromEvent(this.doc, this.revision, e);
    if (next) { this.applied++; this.reset(next, e.revision); return; }
    this.reads++;
    const p = await this.readWhole();
    if (p.revision >= this.revision) this.reset(p.project, p.revision);
  }
}
