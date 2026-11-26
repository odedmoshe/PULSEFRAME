/**
 * The block's strings (wave 8 cover). W3 owns this file after the pre-pass. The words live in packages/i18n/src/cover.ts (`cover.*`,
 * Hebrew first); this reads them for the interface language and fills the {placeholders}. A sentence the shared table does not
 * have goes in EXTRA (Hebrew first, both languages, plural address) for the lead to move into i18n.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

/** Sentences the shared table (packages/i18n/src/cover.ts) does not have yet: Hebrew first, plural address; for the lead to move into i18n. */
export const EXTRA = {
  he: {
    range: 'הקטע שנמדד: פריימים {from}–{last} ({n})', progress: 'התקדמות המדידה', measureStopped: 'המדידה הופסקה. לא נשמר דבר',
    tileLabel: 'מועמד {n}: פריים {frame}', stepped: 'הפריים שמוצג זז לפריים {frame}',
    cropLabel: 'מסגרת החיתוך', cropGrow: 'הגדלת המסגרת', cropShrink: 'הקטנת המסגרת', cropValues: 'המסגרת: {w}×{h} פיקסלים, מ־({x}, {y})',
    orientation: 'כיוון הנייר', ppiHead: 'פיקסלים לאינץ׳ במסגרת הזו', wholeSize: 'כל הפריים: {w}×{h} פיקסלים',
    saved: 'התמונה נשמרה: {w}×{h} פיקסלים', saveStopped: 'השמירה הופסקה. לא נשמר דבר', close: 'סגירה',
    'reason.variable-frame-rate': 'קצב פריימים משתנה', 'reason.rotation': 'סיבוב', 'reason.codec': 'סוג הקידוד', 'reason.pixel-aspect': 'צורת הפיקסל',
    'reason.still-format': 'סוג קובץ התמונה', 'reason.hdr': 'HDR',
  },
  en: {
    range: 'The measured stretch: frames {from}–{last} ({n})', progress: 'Progress of the measurement', measureStopped: 'The measurement was stopped. Nothing was saved',
    tileLabel: 'Candidate {n}: frame {frame}', stepped: 'The shown frame moved to frame {frame}',
    cropLabel: 'Crop frame', cropGrow: 'Make the frame larger', cropShrink: 'Make the frame smaller', cropValues: 'Frame: {w}×{h} pixels, from ({x}, {y})',
    orientation: 'Paper orientation', ppiHead: 'Pixels per inch in this frame', wholeSize: 'The whole frame: {w}×{h} pixels',
    saved: 'Picture saved: {w}×{h} pixels', saveStopped: 'Saving was stopped. Nothing was saved', close: 'Close',
    'reason.variable-frame-rate': 'variable frame rate', 'reason.rotation': 'rotation', 'reason.codec': 'codec', 'reason.pixel-aspect': 'pixel shape',
    'reason.still-format': 'picture file type', 'reason.hdr': 'HDR',
  },
} as const satisfies Record<'he' | 'en', Record<string, string>>;

export function coverT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  const extra = EXTRA[lang === 'he' ? 'he' : 'en'] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`cover.${key}`] ?? extra[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
