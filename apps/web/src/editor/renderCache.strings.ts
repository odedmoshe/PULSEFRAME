/**
 * The number-carrying strings of the fast export and the render cache (ADR-0024), Hebrew first; the fixed strings are i18n
 * `cache.*` (packages/i18n/src/renderCache.ts), read through `cacheText`. The Hebrew reuse line for (284, 300) reads
 * «נעשה שימוש חוזר ב-284 מתוך 300 מקטעים»; where a line is rendered its digit runs go in <bdi dir="ltr"> (`numberParts`).
 * No string promises a speed or says the cache was verified as a whole: the self-check proves the frames it checked, nothing more.
 */
import { dictionaries, type Key } from '@pulseframe/i18n';

export interface RenderCacheStrings {
  reuseLine(reused: number, total: number): string;
  renderLine(segments: number, seconds: number): string;
  firstExport(total: number): string;
  uncacheableLine(segments: number): string;
  /** Only when SegmentPlanView.estimate.seconds is not null. */
  eta(seconds: number): string;
  laneSummary(cached: number, total: number): string;
  done(o: { reused: number; rendered: number; framesChecked: number; notStored: number }): string;
  storageRow(usedBytes: number, capBytes: number): string;
  cleared(bytes: number, keptPinned: number): string;
}

const GB = 2 ** 30;
const MB = 2 ** 20;
/** 1.2 GB, 640 MB, 2 GB (no trailing .0): the unit is kept in Latin letters in both languages, as the status bar writes sizes. */
export function formatBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  const trim = (n: number) => (Math.round(n * 10) / 10).toString();
  if (b >= GB / 10) return `${trim(b / GB)} GB`;
  if (b >= MB) return `${Math.round(b / MB)} MB`;
  return `${Math.round(b / 1024)} KB`;
}
const isOne = (n: number) => n === 1;

const HE: RenderCacheStrings = {
  reuseLine: (r, t) => `נעשה שימוש חוזר ב-${r} מתוך ${t} מקטעים`,
  renderLine: (n, s) => `${isOne(n) ? 'יירנדר מחדש מקטע אחד' : `יירנדרו מחדש ${n} מקטעים`} (${isOne(s) ? 'שנייה אחת' : `${s} שניות`} של סרטון)`,
  firstExport: (t) => (isOne(t) ? 'ייצוא ראשון: המקטע ירונדר ויישמר לפעם הבאה' : `ייצוא ראשון: כל ${t} המקטעים ירונדרו ויישמרו לפעם הבאה`),
  uncacheableLine: (n) => (isOne(n) ? 'מקטע אחד ירונדר בכל ייצוא ולא יישמר במטמון' : `${n} מקטעים ירונדרו בכל ייצוא ולא יישמרו במטמון`),
  eta: (s) => `זמן משוער: ${s < 60 ? `כ-${Math.max(1, Math.round(s))} שניות` : Math.round(s / 60) === 1 ? 'כ-דקה אחת' : `כ-${Math.round(s / 60)} דקות`} (נמדד בייצואים קודמים במחשב הזה)`,
  laneSummary: (c, t) => `מטמון רינדור: ${c} מתוך ${t} מקטעים שמורים`,
  done: ({ reused, rendered, framesChecked, notStored }) =>
    `${isOne(reused) ? 'מקטע אחד מהמטמון' : `${reused} מקטעים מהמטמון`} · ${rendered} רונדרו · ${framesChecked > 0 ? `בדיקה עצמית: ${isOne(framesChecked) ? 'פריים אחד זהה' : `${framesChecked} פריימים זהים`} ✓` : 'בדיקה עצמית: לא נדרשה'}${notStored > 0 ? ` · ${notStored} לא נשמרו (אין מקום)` : ''}`,
  storageRow: (u, c) => (c <= 0 ? dictionaries.he['cache.storage.off'] : `מטמון רינדור ${formatBytes(u).replace(' GB', '')} / ${formatBytes(c)}`),
  cleared: (b, k) => `המטמון נוקה: ${formatBytes(b)} שוחררו${k > 0 ? `. ${dictionaries.he['cache.storage.keptPinned']}` : ''}`,
};
const EN: RenderCacheStrings = {
  reuseLine: (r, t) => `Reusing ${r} of ${t} segments`,
  renderLine: (n, s) => `${isOne(n) ? '1 segment' : `${n} segments`} will be rendered again (${isOne(s) ? '1 second' : `${s} seconds`} of video)`,
  firstExport: (t) => (isOne(t) ? 'First export: the segment will be rendered and kept for next time' : `First export: all ${t} segments will be rendered and kept for next time`),
  uncacheableLine: (n) => (isOne(n) ? '1 segment is rendered on every export and is not kept in the cache' : `${n} segments are rendered on every export and are not kept in the cache`),
  eta: (s) => `Estimated time: about ${s < 60 ? `${Math.max(1, Math.round(s))} seconds` : Math.round(s / 60) === 1 ? '1 minute' : `${Math.round(s / 60)} minutes`} (measured in earlier exports on this computer)`,
  laneSummary: (c, t) => `Render cache: ${c} of ${t} segments kept`,
  done: ({ reused, rendered, framesChecked, notStored }) =>
    `${isOne(reused) ? '1 segment' : `${reused} segments`} from the cache · ${rendered} rendered · ${framesChecked > 0 ? `self-check: ${isOne(framesChecked) ? '1 frame identical' : `${framesChecked} frames identical`} ✓` : 'self-check: not needed'}${notStored > 0 ? ` · ${notStored} not stored (no room)` : ''}`,
  storageRow: (u, c) => (c <= 0 ? dictionaries.en['cache.storage.off'] : `Render cache ${formatBytes(u).replace(' GB', '')} / ${formatBytes(c)}`),
  cleared: (b, k) => `Cache cleared: ${formatBytes(b)} freed${k > 0 ? `. ${dictionaries.en['cache.storage.keptPinned']}` : ''}`,
};

export const RENDER_CACHE_LINES = { he: HE, en: EN } as const;
export function renderCacheStrings(lang: 'he' | 'en'): RenderCacheStrings { return lang === 'he' ? HE : EN; }

/** A fixed `cache.*` / `error.code.*` string of the track (packages/i18n/src/renderCache.ts). */
export function cacheText(lang: 'he' | 'en', key: Key): string { return dictionaries[lang][key]; }

/** The progress stage rows of the incremental route, from core SEGMENTED_STAGES: the stage text the job reports to the sheet's label. */
const STAGE_KEYS: Record<string, Key> = {
  keying: 'cache.stage.keying', 'self-check': 'cache.stage.selfCheck', rendering: 'cache.stage.rendering', joining: 'cache.stage.joining', validating: 'cache.stage.validating',
};
/** The label of a job stage text («keying», «self-check 3/12», «rendering 2/16» …) or null for a stage the ordinary sheet words itself. */
export function stageLabel(stage: string, lang: 'he' | 'en'): string | null {
  const m = /^([a-z-]+)(?:\s+(\d+)\s*\/\s*(\d+))?$/.exec(stage.trim());
  const key = m && Object.hasOwn(STAGE_KEYS, m[1]!) ? STAGE_KEYS[m[1]!] : undefined; // 'constructor' is not a stage
  if (!key) return null;
  return m![2] ? `${cacheText(lang, key)} ${m![2]}/${m![3]}` : cacheText(lang, key);
}

/** The sentence of a failed incremental job by its error code, or null when the code is not the fast export's own. */
export function failureText(code: string | undefined, lang: 'he' | 'en'): string | null {
  if (code === 'render_cache_self_check_failed') return cacheText(lang, 'cache.failed.selfCheck');
  if (code === 'segment_join_mismatch') return cacheText(lang, 'cache.failed.join');
  // a privacy region changed while the export ran (ADR-0024): a new export is the way on, never a retry of the old snapshot
  if (code === 'render_cache_purged') return cacheText(lang, 'cache.failed.purged');
  return null;
}

/** Splits a line into text and digit runs, so the renderer can put each number in <bdi dir="ltr"> (a number with ':' or '.' stays whole). */
export function numberParts(text: string): { text: string; num: boolean }[] {
  const out: { text: string; num: boolean }[] = [];
  const re = /\d+(?:[.,:]\d+)*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), num: false });
    out.push({ text: m[0], num: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), num: false });
  return out;
}

/** The plan could not be asked for (the route failed): said plainly; the ordinary export is unchanged. */
export function planErrorText(lang: 'he' | 'en'): string {
  return lang === 'he' ? 'לא הצלחנו לבדוק מה השתנה. הייצוא הרגיל לא מושפע.' : 'We could not check what changed. The ordinary export is not affected.';
}
