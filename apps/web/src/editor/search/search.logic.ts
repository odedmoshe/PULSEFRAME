/**
 * Pure helpers of «חיפוש בצילומים» in the editor (wave 7 search track, builder C). No DOM and no editor: everything here is tested
 * against small local fixtures of the contract's shapes (search.logic.test.ts). Times stay exact rationals; seconds appear only as
 * display text. Nothing here computes, keeps or shows a score: a picture moment is an ordered row with a model label, never a number.
 */
import * as T from '@pulseframe/time';
import type { FootageAnswer, FootageIndexStatus, Moment, MomentSource, PictureState, ProjectDocument, SearchSetup } from '@pulseframe/core';

/** What the picture part knows of the project's index, from the owner's own session (GET …/search/index). */
export interface IndexView { status: FootageIndexStatus | null; failure: { status: number; code: string } | null }

/** The jobs whose scan is still going. */
export const SCAN_BUSY = ['queued', 'running', 'pending', 'waiting'] as const;
export const scanIsBusy = (s: string | undefined | null): boolean => !!s && (SCAN_BUSY as readonly string[]).includes(s);

/**
 * The state of the status line (the contract's PICTURE_STATES), or null while the first answer is awaited. The order is the order a
 * person fixes things: this build lacks it → this session may not use it → setup → a scan running → what is scanned.
 */
export function pictureLineOf(v: IndexView): PictureState | null {
  if (v.failure) {
    if (v.failure.status === 501 || v.failure.code === 'footage_search_not_built') return 'not_built';
    if (v.failure.status === 403) return 'owner_only';
    return null;
  }
  const s = v.status;
  if (!s) return null;
  if (s.setup.code === 'not_built') return 'not_built';
  if (s.setup.code !== 'ready') return 'not_installed';
  if (s.job && scanIsBusy(s.job.status)) return 'busy';
  const { scanned, stale, of } = s.files;
  if (of > 0 && scanned >= of) return 'ready';
  if (stale > 0) return 'stale';
  if (scanned === 0) return 'not_scanned';
  return 'partly_scanned';
}

/** True only for the owner's own session: the index route answered, or answered that this build lacks it (501 comes after the owner rule). */
export function ownerOf(v: IndexView): boolean | null {
  if (v.failure) return v.failure.status === 501 ? true : v.failure.status === 403 ? false : null;
  return v.status ? true : null;
}

/** «סרוק עכשיו» is offered when set up, nothing is running and a video is not in the index for the current model. */
export function canScan(v: IndexView): boolean {
  const s = v.status;
  if (!s || s.setup.code !== 'ready' || (s.job && scanIsBusy(s.job.status))) return false;
  return s.files.of > 0 && s.files.scanned < s.files.of;
}
/** «מחק את מפתח החיפוש בתמונה» is offered when the project has anything kept (current or stale) and no scan is running. */
export function canForget(v: IndexView): boolean {
  const s = v.status;
  return !!s && !(s.job && scanIsBusy(s.job.status)) && (s.files.scanned + s.files.stale > 0 || s.bytes > 0);
}

/** A byte count for people ("2.9 MB"): decimal units, one decimal at most; display only. */
export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  const text = i === 0 || n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[i]}`;
}

/** A moment's time as display text: m:ss.s (exact numerator and denominator, one decimal; never stored). */
export function clockText(t: T.RationalTime): string {
  const tenths = (BigInt(t.value) * 10n) / BigInt(t.timescale); // floor, exact
  const total = tenths < 0n ? 0n : tenths;
  const m = total / 600n, s = (total % 600n) / 10n, d = total % 10n;
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}
/** "0:02.0–0:06.0" for a span, null for a whole file. */
export function spanText(m: Pick<Moment, 'start' | 'end'>): string | null {
  return m.start && m.end ? `${clockText(m.start)}–${clockText(m.end)}` : null;
}
/** A rational as the attribute value the proofs read: "value/timescale", '' for none. */
export const timeAttr = (t: T.RationalTime | null): string => (t ? `${t.value}/${t.timescale}` : '');

/** One row of the results, from a moment and the document: the file's name and kind come from the document, never from the moment. */
export interface Row {
  key: string;
  section: 'exact' | 'picture';
  moment: Moment;
  name: string;
  kind: 'video' | 'audio' | 'image' | 'other';
  /** the file can open in the source viewer on its moment (video only; audio and stills offer the two placements) */
  canView: boolean;
}
const own = <V,>(rec: Record<string, V> | undefined, k: string): V | undefined => (rec && Object.hasOwn(rec, k) ? rec[k] : undefined);
export function rowsOf(doc: ProjectDocument | null, moments: readonly Moment[], section: 'exact' | 'picture'): Row[] {
  if (!doc) return [];
  const rows: Row[] = [];
  for (const m of moments) {
    const a = own(doc.assets, m.assetId);
    if (!a || a.kind === 'lut') continue; // a file removed since the search is not a row
    const kind: Row['kind'] = a.kind === 'image' ? 'image' : a.video ? 'video' : a.kind === 'audio' || a.audio ? 'audio' : 'other';
    rows.push({ key: `${section}|${m.assetId}|${timeAttr(m.start)}|${timeAttr(m.end)}`, section, moment: m, name: a.name, kind, canView: kind === 'video' });
  }
  return rows;
}

/** The sources a row may name: the picture section's rows say only «לפי התמונה»; a pearl's name or a tag is named only when the moment carries it. */
export function sourcesOf(row: Row): MomentSource[] {
  return row.section === 'picture' ? ['picture'] : row.moment.sources.filter((s) => s !== 'picture');
}

/** The answer's picture rows, in the answer's order (the order is the model's; no number comes with it). */
export function pictureMomentsOf(a: Pick<FootageAnswer, 'picture' | 'pictureState'> | null): Moment[] {
  return a && (a.pictureState === 'ready' || a.pictureState === 'busy' || a.pictureState === 'partly_scanned' || a.pictureState === 'stale') ? a.picture : [];
}

/** The state of a section by what was asked: shown rows, an honest "nothing found" (asked and empty), or not asked yet (null). */
export function sectionState(asked: boolean, rows: number): 'rows' | 'empty' | null {
  return rows > 0 ? 'rows' : asked ? 'empty' : null;
}

/** The setup state the status line explains (never invented: the server's own code). */
export function setupReasonKey(setup: SearchSetup | undefined): string {
  return `footage.setup.${setup?.code ?? 'not_built'}`;
}

/** The count for the polite live region. */
export function liveKey(count: number): 'footage.foundNone' | 'footage.foundOne' | 'footage.found' {
  return count === 0 ? 'footage.foundNone' : count === 1 ? 'footage.foundOne' : 'footage.found';
}
