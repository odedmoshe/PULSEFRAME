/**
 * The block's strings (wave 7 stabilise track). W3 owns this file. The words themselves live in packages/i18n/src/stabilise.ts
 * (`stab.*`, Hebrew first); this file reads them for the interface language and fills the {placeholders}. The few sentences the
 * shared table does not have yet are in EXTRA below (Hebrew first), for the owner to review and for the lead to move into i18n.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

/** Sentences the block needs that packages/i18n/src/stabilise.ts does not hold. */
export const EXTRA = {
  he: {
    'job.queued': 'ממתין לתור', 'job.done': 'המדידה הסתיימה והייצוב פועל', 'job.canceled': 'המדידה נעצרה; דבר לא נשמר', 'job.failed': 'המדידה נכשלה',
    'report': 'מה כדאי לבדוק', 'report.none': 'לא נמצאו קטעים חשודים בקליפ', 'report.jump': 'עברו לשם', 'report.frames': 'פריימים',
    'report.weak': 'נמדד בביטחון נמוך', 'report.unknown': 'לא נמדד', 'report.cut': 'מעבר בין צילומים', 'report.jumpNone': 'הקליפ לא מציג את הפריימים האלה',
    'measured': 'נמדדו {n} מתוך {total} פריימים של הקליפ', 'notMeasuredYet': 'תנועת המצלמה של הקליפ עוד לא נמדדה', 'strengthValue': 'עוצמה {n}',
    'switchedOn': 'הייצוב פועל', 'switchedOff': 'הייצוב כבוי', 'removed': 'המדידה הוסרה', 'more': 'ועוד {n}',
    'progress': 'התקדמות המדידה',
  },
  en: {
    'job.queued': 'Waiting in the queue', 'job.done': 'The measurement finished and stabilisation is on', 'job.canceled': 'The measurement was stopped; nothing was saved', 'job.failed': 'The measurement failed',
    'report': 'What to check', 'report.none': 'No suspicious stretches in the clip', 'report.jump': 'Go there', 'report.frames': 'frames',
    'report.weak': 'low confidence', 'report.unknown': 'not measured', 'report.cut': 'change of shot', 'report.jumpNone': 'The clip does not show those frames',
    'measured': '{n} of the clip\'s {total} frames were measured', 'notMeasuredYet': 'The camera motion of this clip has not been measured yet', 'strengthValue': 'Strength {n}',
    'switchedOn': 'Stabilisation is on', 'switchedOff': 'Stabilisation is off', 'removed': 'The measurement was removed', 'more': '+{n} more',
    'progress': 'Measurement progress',
  },
} as const;

export function stabiliseT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  const extra = EXTRA[lang === 'he' ? 'he' : 'en'] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`stab.${key}`] ?? extra[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
