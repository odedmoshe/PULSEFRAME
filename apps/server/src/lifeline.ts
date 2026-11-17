/**
 * Server side of the life line (ADR-0021): "on this day" across the owner's projects, and reading capture dates again from the
 * stored originals of files that have none. The routes are registered in http.ts and documented in openapi.ts.
 *
 * The signatures are the lead's contract. The rules:
 * - onThisDayFor reads every project of the store (the caller is the owner's own session; the route refuses agents) and
 *   answers with core onThisDay, at most 12 items. `today` is the browser's local day; the server never uses its own clock for it.
 * - readMissingCaptures re-reads the ORIGINAL bytes of pictures, videos and sounds without a capture (the blob named by
 *   conform.originalContentHash when the file was conformed, else contentHash; at most 500 files per call), with the name the
 *   file has in the library, and commits ONE transaction of internal attach_asset_capture operations (allowInternal, actor =
 *   the caller, label naming the action). `read` = files looked at, `dated` = files that got a date, `revision` = the
 *   project's revision afterwards (unchanged when nothing was dated: no empty transaction).
 * - peopleSuggestions («העתקה מפרויקט אחר», ADR-0021 people section): the people already entered in the owner's other
 *   projects, so they are typed once. It reads birth dates across every project, which no grant covers: the owner's own
 *   session only (the route refuses first; the function refuses again). W2 fills it.
 *
 * What re-reading looks at: files a person brought in (provenance upload or fixture). A generated or derived file has no
 * capture of its own; it shows the date of the file it was made from (core captureOf), so its bytes are never read for one.
 * A file that was looked at and gave no date is remembered for as long as the server runs (the bytes of a stored original
 * never change), so a library with more than 500 undated files is worked through over several calls instead of the same
 * 500 being read again each time.
 * Known limit: the name the file was uploaded with is not kept, so the library name is what the file-name patterns and the
 * messaging-app rule see. A forwarded video that was renamed in the library gets its container time as a firm date.
 */
import { onThisDay, type Asset, type Capture, type OnThisDayItem, type OpCall } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { readCapture, type CaptureContext } from './captureMeta.ts';
import { ApiError, type Store } from './store.ts';

/** At most this many files are re-read in one call of readMissingCaptures. */
export const MAX_CAPTURE_READS = 500;
/** At most this many items are answered by onThisDayFor. */
export const MAX_ON_THIS_DAY = 12;
/** Files read at once (each video is one ffprobe process; the machine is shared with exports and previews). */
const READS_AT_ONCE = 3;
/** Originals that were looked at and gave no date, per store: `<original hash> <library name>`. Bounded; lost at restart, which only costs a second look. */
const NO_DATE = new WeakMap<Store, Set<string>>();
const MAX_REMEMBERED = 50_000;

/** Files of the owner's projects taken on `today`'s date in earlier years. `today` is a real WALL_DATE (the route checks it). */
export function onThisDayFor(store: Store, p: Principal, today: string): OnThisDayItem[] {
  // it reads across every project, which no grant covers: the owner's own session only (the route refuses first; this is the second lock)
  if (p.kind !== 'user') throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
  const projects: { projectId: string; projectName: string; doc: ReturnType<Store['getProject']>['doc'] }[] = [];
  for (const row of store.listProjects()) {
    // a project that cannot be opened is left out of the card; it is not a reason to show nothing
    try { projects.push({ projectId: row.id, projectName: row.name, doc: store.getProject(row.id).doc }); } catch { /* skipped */ }
  }
  return onThisDay(projects, today, MAX_ON_THIS_DAY).slice(0, MAX_ON_THIS_DAY);
}

/** One person as another project of the owner holds them, for «העתקה מפרויקט אחר». */
export interface PersonSuggestion { name: string; birthDate: string | null; form?: 'm' | 'f'; /** The project it was read from (the newest that has this name). */ projectId: string; projectName: string }
/** At most this many suggestions are answered. */
export const MAX_PEOPLE_SUGGESTIONS = 200;
/**
 * The people of the owner's projects, one per name (core personNameKey; the most recently changed project wins), by name,
 * at most MAX_PEOPLE_SUGGESTIONS. A project that cannot be opened is left out. W2 fills the body: read each project with
 * store.wholeProject (this is the owner's session). Until then it refuses.
 */
export function peopleSuggestions(_store: Store, p: Principal): PersonSuggestion[] {
  if (p.kind !== 'user') throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
  throw new ApiError(501, 'not_implemented', 'copying people from another project is not built yet');
}

/** A file whose own bytes can carry a capture date and that has none yet: a picture, video or sound a person brought in. */
const readable = (a: Asset) => a.kind !== 'lut' && !a.capture && (a.provenance.origin === 'upload' || a.provenance.origin === 'fixture');
/** The bytes as they were uploaded: the kept original of a conformed file, else the file itself. */
const originalHash = (a: Asset) => a.conform?.originalContentHash ?? a.contentHash;
/**
 * What a re-read would attach, without committing anything: the files it looked at (at most MAX_CAPTURE_READS, in library
 * order, skipping originals already known to carry no date) and the dates it read. Never throws for a file: a blob that is
 * missing or unreadable is simply a file without a date.
 */
export async function planCaptureReads(store: Store, projectId: string, cx: CaptureContext): Promise<{ read: number; found: { assetId: string; capture: Capture }[] }> {
  const { doc } = store.getProject(projectId);
  let known = NO_DATE.get(store);
  if (!known) NO_DATE.set(store, (known = new Set()));
  const keyOf = (a: Asset) => `${originalHash(a)} ${a.name}`;
  const todo = Object.values(doc.assets).filter((a) => readable(a) && !known.has(keyOf(a))).slice(0, MAX_CAPTURE_READS);
  const found: { assetId: string; capture: Capture }[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const a = todo[i]!;
      let capture: Capture | null = null;
      try { capture = await readCapture(store.blobPath(originalHash(a)), a.name, cx); } catch { /* a hash the store refuses: no date */ }
      if (capture) found.push({ assetId: a.id, capture });
      else { if (known.size >= MAX_REMEMBERED) known.clear(); known.add(keyOf(a)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, todo.length) }, worker));
  // library order, whatever order the reads finished in: the same library gives the same transaction
  const order = new Map(todo.map((a, i) => [a.id, i]));
  found.sort((x, y) => order.get(x.assetId)! - order.get(y.assetId)!);
  return { read: todo.length, found };
}
/** Reads capture dates from the stored originals of the project's files that have none, and attaches them in one transaction. */
export async function readMissingCaptures(store: Store, p: Principal, projectId: string, cx: CaptureContext): Promise<{ read: number; dated: number; revision: number }> {
  const { read, found } = await planCaptureReads(store, projectId, cx);
  // Reading took a while and the project may have moved on: a file that was removed meanwhile, or got a date (by hand, or from
  // another call), is left out, so one of them cannot refuse the dates of all the others. Nothing awaits between this look
  // and the commit.
  const now = store.getProject(projectId);
  const ops: OpCall[] = found
    .filter(({ assetId }) => Object.hasOwn(now.doc.assets, assetId) && !now.doc.assets[assetId]!.capture)
    .map(({ assetId, capture }) => ({ op: 'attach_asset_capture', args: { assetId, capture } }));
  if (ops.length === 0) return { read, dated: 0, revision: now.revision }; // no empty transaction
  const r = store.commit({ projectId, actor: p.actor, label: 'Read capture dates from the files', allowInternal: true, ops });
  return { read, dated: r.results.filter((x) => x.output?.attached === true).length, revision: r.revision };
}
