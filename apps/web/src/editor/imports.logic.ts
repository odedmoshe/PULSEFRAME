/**
 * Pure logic of the import cards and the folder import (ADR-0023), unit-tested without a browser (imports.logic.test.ts).
 *
 * Built by W3 on the lead's signatures (plan §7 with the verifier's corrections).
 * - planFolderImport: media extensions only, hidden and system files skipped (a name or a folder starting with '.', Thumbs.db,
 *   desktop.ini, __MACOSX), natural sort by path, at most FOLDER_IMPORT_CAP files; the counts of what was skipped and why.
 * - collectDropped: webkitGetAsEntry, and readEntries called until it returns an empty batch (it yields at most 100 a call).
 *   Tested with fakes only (a fake directory of 250 entries), which the test says.
 * - cardText: the card's chip and sub-text from importCardState (core) and the strings modules.
 * - Placement: one file after another, in the order dropped; a failed file is skipped and the next one goes where it would have.
 *   Keyed by Map, never by a plain object (an id may name an Object.prototype member).
 */
import { dictionaries } from '@pulseframe/i18n';
import type { ImportJobView } from '@pulseframe/core';
import type { LocalImport } from './imports.ts';
import { IMPORTS_STRINGS } from './imports.strings.ts';

/** A dropped folder is imported up to this many files at once. */
export const FOLDER_IMPORT_CAP = 500;

export const MEDIA_EXTENSIONS = {
  video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', '3gp', 'wmv', 'mxf'],
  sound: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'],
} as const;
const MEDIA_SET: ReadonlySet<string> = new Set([...MEDIA_EXTENSIONS.video, ...MEDIA_EXTENSIONS.sound, ...MEDIA_EXTENSIONS.image]);
const extOf = (name: string): string => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
/** What kind of file a name says it is (the card's icon). */
export function kindOfName(name: string): 'video' | 'sound' | 'image' | 'other' {
  const e = extOf(name);
  return (MEDIA_EXTENSIONS.video as readonly string[]).includes(e) ? 'video' : (MEDIA_EXTENSIONS.sound as readonly string[]).includes(e) ? 'sound' : (MEDIA_EXTENSIONS.image as readonly string[]).includes(e) ? 'image' : 'other';
}
export const isMediaName = (name: string): boolean => MEDIA_SET.has(extOf(name));
const SYSTEM_NAMES = new Set(['thumbs.db', 'desktop.ini', 'ehthumbs.db']);
/** A hidden or system file: a name or any folder starting with '.', Thumbs.db, desktop.ini, __MACOSX. */
export function isHiddenPath(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.some((p) => p.startsWith('.') || p === '__MACOSX') || SYSTEM_NAMES.has((parts[parts.length - 1] ?? '').toLowerCase());
}

/** Natural order: digit runs compare as numbers (IMG_2 before IMG_10), the rest case-insensitively; ties fall back to code units, so the order is total and the same everywhere. */
export function naturalCompare(a: string, b: string): number {
  const A = a.match(/\d+|\D+/g) ?? [], B = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i]!, y = B[i]!;
    const nx = /^\d/.test(x), ny = /^\d/.test(y);
    if (nx && ny) {
      const tx = x.replace(/^0+(?=\d)/, ''), ty = y.replace(/^0+(?=\d)/, '');
      if (tx.length !== ty.length) return tx.length - ty.length;
      if (tx !== ty) return tx < ty ? -1 : 1;
      if (x.length !== y.length) return x.length - y.length;
    } else {
      const lx = x.toLowerCase(), ly = y.toLowerCase();
      if (lx !== ly) return lx < ly ? -1 : 1;
    }
  }
  if (A.length !== B.length) return A.length - B.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A file the folder walk found, with its path inside the dropped folder ('a/b/IMG_1.jpg'). */
export interface PickedFile { name: string; relativePath: string; size: number }
export interface FolderPlan<F extends PickedFile> { files: F[]; skipped: { notMedia: number; hidden: number; tooMany: number } }
/** Media files only, hidden and system files left out, natural order by path, at most FOLDER_IMPORT_CAP; the counts of what was left out and why. */
export function planFolderImport<F extends PickedFile>(files: F[]): FolderPlan<F> {
  const skipped = { notMedia: 0, hidden: 0, tooMany: 0 };
  const keep: F[] = [];
  for (const f of files) {
    if (isHiddenPath(f.relativePath || f.name) || isHiddenPath(f.name)) skipped.hidden++;
    else if (!isMediaName(f.name)) skipped.notMedia++;
    else keep.push(f);
  }
  keep.sort((a, b) => naturalCompare(a.relativePath || a.name, b.relativePath || b.name));
  if (keep.length > FOLDER_IMPORT_CAP) { skipped.tooMany = keep.length - FOLDER_IMPORT_CAP; keep.length = FOLDER_IMPORT_CAP; }
  return { files: keep, skipped };
}
/** The notice under the cards for a plan: too many wins over not-media; hidden files are never mentioned. */
export function skippedOf(plan: { skipped: { notMedia: number; tooMany: number } }): { count: number; reason: 'not-media' | 'too-many' } | null {
  if (plan.skipped.tooMany > 0) return { count: plan.skipped.tooMany, reason: 'too-many' };
  if (plan.skipped.notMedia > 0) return { count: plan.skipped.notMedia, reason: 'not-media' };
  return null;
}

/** The parts of the File and Directory Entries API the walk uses (fakes implement these in the test). */
export interface FsEntryLike { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?(ok: (f: File) => void, fail: (e: unknown) => void): void; createReader?(): { readEntries(ok: (batch: FsEntryLike[]) => void, fail: (e: unknown) => void): void } }
export interface DroppedItemLike { kind: string; webkitGetAsEntry(): FsEntryLike | null; getAsFile(): File | null }
/** The walk stops after this many files: a drop of a whole disk must not freeze the tab. */
export const WALK_FILE_LIMIT = 20_000;

const readAll = (dir: FsEntryLike): Promise<FsEntryLike[]> => new Promise((resolve, reject) => {
  const reader = dir.createReader?.();
  if (!reader) { resolve([]); return; }
  const all: FsEntryLike[] = [];
  // readEntries yields at most 100 entries (Chrome) per call: it is called until it returns an empty batch
  const next = () => reader.readEntries((batch) => { if (batch.length === 0) resolve(all); else { all.push(...batch); next(); } }, reject);
  next();
});
const fileOf = (e: FsEntryLike): Promise<File> => new Promise((ok, fail) => (e.file ? e.file(ok, fail) : fail(new Error('not a file entry'))));
const trimSlash = (p: string) => p.replace(/^[\\/]+/, '');

/** Every file of a drop (folders walked), with its path inside the dropped folder. Tested with fakes only: a real folder drop is for the proof in a browser. */
export async function collectDropped(items: ArrayLike<DroppedItemLike>): Promise<{ file: File; relativePath: string }[]> {
  // The entries are taken first and synchronously: a DataTransferItem is dead after the first await.
  const roots: { entry: FsEntryLike | null; file: File | null }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind !== 'file') continue;
    const entry = it.webkitGetAsEntry?.() ?? null;
    roots.push({ entry, file: entry ? null : it.getAsFile() });
  }
  const out: { file: File; relativePath: string }[] = [];
  const walk = async (e: FsEntryLike): Promise<void> => {
    if (out.length >= WALK_FILE_LIMIT) return;
    if (e.isFile) { out.push({ file: await fileOf(e), relativePath: trimSlash(e.fullPath || e.name) }); return; }
    if (e.isDirectory) for (const child of await readAll(e)) await walk(child);
  };
  for (const r of roots) {
    if (r.entry) await walk(r.entry);
    else if (r.file) out.push({ file: r.file, relativePath: r.file.name });
  }
  return out;
}

/** 412 MB, 1.2 GB: the sizes the cards show. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ''));
const isDone = (j: ImportJobView) => j.state === 'ready' || j.state === 'failed' || j.state === 'canceled';

/** A job's queue position when the server gave none: the files ahead of it in the list (oldest first) that are not finished. */
export function withQueuePositions(jobs: ImportJobView[]): ImportJobView[] {
  let ahead = 0;
  return jobs.map((j) => {
    const open = !isDone(j);
    const out = j.state === 'waiting' && j.waitingFor === 'turn' ? { ...j, queuePosition: j.queuePosition ?? ahead } : j;
    if (open) ahead++;
    return out;
  });
}

type DictKey = keyof typeof dictionaries.he;
/** The words for a failure code: the dictionaries' error.code.* when there is one, else a plain sentence. */
export function failureText(code: string, lang: 'he' | 'en', fallback?: string): string {
  const key = `error.code.${code}` as DictKey;
  const hit = (dictionaries[lang] as Record<string, string>)[key];
  return hit ?? fallback ?? IMPORTS_STRINGS[lang].failedUnknown;
}

/** What a card says: its chip and, when there is one, the line under it. */
export function cardText(item: { kind: 'job'; view: ImportJobView } | { kind: 'local'; local: LocalImport }, lang: 'he' | 'en'): { chip: string; detail: string | null } {
  const S = IMPORTS_STRINGS[lang];
  if (item.kind === 'local') {
    const l = item.local;
    if (l.state === 'uploading') return { chip: fill(S.uploading, { percent: Math.round(l.percent) }), detail: null };
    if (l.state === 'pending-upload') return { chip: S.pendingUpload, detail: null };
    const detail = l.reason === 'network_error' ? S.uploadInterrupted : l.reason === 'no_project' ? S.noProject : l.reason ? failureText(l.reason, lang, S.failedUnknown) : null;
    return { chip: S.notUploaded, detail };
  }
  const v = item.view;
  switch (v.state) {
    case 'waiting': {
      const detail = v.waitingFor === 'turn' ? (v.queuePosition && v.queuePosition > 0 ? fill(S.waitTurn, { count: v.queuePosition }) : null)
        : v.waitingFor === 'export' ? S.waitExport : v.waitingFor === 'compute' ? S.waitCompute : v.waitingFor === 'check' ? S.waitCheck : null;
      return { chip: S.waiting, detail };
    }
    case 'converting': {
      const reasons = v.reasons.map((r) => (dictionaries[lang] as Record<string, string>)[`notice.reason.${r}`] ?? r).join(', ');
      return { chip: v.percent == null ? S.convertingPlain : fill(S.converting, { percent: Math.round(v.percent) }), detail: reasons || null };
    }
    case 'ready': return { chip: S.ready, detail: null };
    case 'canceled': return { chip: S.canceled, detail: null };
    case 'failed': return { chip: S.failed, detail: v.error ? failureText(v.error.code, lang, v.error.message) : S.failedUnknown };
  }
}

/** Where the files of one timeline drop go: in the order dropped, each after the previous clip. */
export interface PlacementState { order: string[]; finished: Map<string, string | null>; nextIndex: number; at: { frame: number; trackId: string | null } | null; placing: boolean }
export type PlacementEvent = { kind: 'finished'; localId: string; assetId: string | null } | { kind: 'placed'; nextFrame: number | null };
export function startPlacement(order: string[], at: { frame: number; trackId: string | null }): PlacementState {
  return { order: [...order], finished: new Map(), nextIndex: 0, at: { ...at }, placing: false };
}
/**
 * The next state, and the file to place now (null = nothing to place yet, or the chain is done). A file finishes with its asset id,
 * or with null when it failed or was canceled: that one is skipped, and the next goes where it would have. Only one placement is in
 * flight at a time (placing), so the order dropped is the order on the timeline whatever order the jobs finish in.
 */
export function placementStep(s: PlacementState, ev: PlacementEvent): { state: PlacementState; place: { localId: string; assetId: string; frame: number; trackId: string | null } | null } {
  const state: PlacementState = { ...s, finished: new Map(s.finished), at: s.at ? { ...s.at } : null };
  if (ev.kind === 'finished') {
    if (state.order.includes(ev.localId) && !state.finished.has(ev.localId)) state.finished.set(ev.localId, ev.assetId);
  } else if (state.placing) {
    state.placing = false;
    state.nextIndex++;
    if (ev.nextFrame !== null && state.at) state.at = { ...state.at, frame: ev.nextFrame };
  }
  while (!state.placing && state.nextIndex < state.order.length) {
    const id = state.order[state.nextIndex]!;
    if (!state.finished.has(id)) break;
    const assetId = state.finished.get(id)!;
    if (assetId === null || !state.at) { state.nextIndex++; continue; }
    state.placing = true;
    return { state, place: { localId: id, assetId, frame: state.at.frame, trackId: state.at.trackId } };
  }
  return { state, place: null };
}
