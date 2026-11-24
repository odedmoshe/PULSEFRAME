/**
 * How the editor's copy of the project follows the server (the server stays the only authority: Store.commit).
 *
 * A live revision event carries the states its transaction left, by entity id (`changes`: the transaction's own diff, the one
 * stored for undo; apps/server/src/store.ts liveChanges). When the editor holds the document at exactly the revision before,
 * it applies them with core's restoreEntities and reads the result as every server read does (migrateProject: the schema's
 * key order and defaults), which gives the document GET /projects/:id would answer, byte for byte. Anything else reads the
 * whole document as before: an event without changes (replayed on reconnect, published after a restart, or sent to a reader
 * without the people scope), a gap in revisions, a large transaction, or a track whose clips share a start (restoreEntities
 * orders those by id; the stored order may differ). sync.test.ts drives a long fuzzed edit sequence through Store.commit and
 * the event stream's own serialisation and checks the hash of this document against the server's after every event.
 */
import { migrateProject, restoreEntities, type EntityState, type ProjectDocument } from '@pulseframe/core';
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
