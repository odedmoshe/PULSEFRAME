/**
 * «למדו אותי פעם אחת» — the chip's and dialog's strings (wave 8 teach). LEAD seed of the pre-pass: the shared lines come from
 * packages/i18n/src/teach.ts (`teach.*`, Hebrew first, plural and ungendered: «החילו», «בחרו»); the counts and the few dialog-only
 * words are here. W3 owns this file after the pre-pass and may add keys (both languages; teach.strings.test.ts keeps them in step).
 * Nothing calls the result right or matched: a lesson repeats edits, and nobody has looked at the result. Numbers are plain digits
 * drawn in <bdi> by the components.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';
import { DERIVE_LEFT_OUT, LESSON_PART_ORDER, NOT_LEARNED_WHY, WINDOW_STOPS, type LessonPartKind, type NotLearnedReason, type WindowStop } from '@pulseframe/core';

export interface TeachStrings {
  name: string; dialogTitle: string; close: string; cancel: string;
  chip(n: number): string; fromClip(name: string): string; targets: string; allOnTrack: string; apply(n: number): string;
  window: string; notLearned(n: number): string; rows: string; rowApplied(n: number): string; rowSkipped(part: string, why: string): string;
  lookNoPreview: string; lookNoAdapter: string; sameSteps: string; absolute: string; lightWarning: string; nothing: string; notBuilt: string; notInFormat: string;
  stale: string; proposal: string; noSound: string; done(n: number): string;
  part: Record<LessonPartKind, string>;
  why: Record<NotLearnedReason, string>;
  stop: Record<WindowStop, string>;
}
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
const OWN = {
  he: { close: 'סגירה', cancel: 'ביטול', notLearned: 'לא נלמד ({n})', rows: 'מה יקרה בכל קליפ', stale: 'הפרויקט השתנה — בדקו שוב', done: 'הוחלו עריכות על {n} קליפים' },
  en: { close: 'Close', cancel: 'Cancel', notLearned: 'Not learned ({n})', rows: 'What happens in each clip', stale: 'The project changed — check again', done: 'Edits applied to {n} clips' },
} as const;

export function teachStrings(lang: Lang): TeachStrings {
  const d = dictionaries[lang] as Record<string, string>;
  const t = (k: string) => d[`teach.${k}`] ?? k;
  const o = OWN[lang];
  return {
    name: t('name'), dialogTitle: t('dialogTitle'), close: o.close, cancel: o.cancel,
    chip: (n) => (n === 1 ? t('chipOne') : fill(t('chipMany'), { n })), fromClip: (name) => fill(t('fromClip'), { name }), targets: t('targets'), allOnTrack: t('allOnTrack'),
    apply: (n) => (n === 1 ? t('applyOne') : fill(t('applyMany'), { n })),
    window: t('window'), notLearned: (n) => fill(o.notLearned, { n }), rows: o.rows, rowApplied: (n) => fill(t('rowApplied'), { n }), rowSkipped: (part, why) => fill(t('rowSkipped'), { part, why }),
    lookNoPreview: t('lookNoPreview'), lookNoAdapter: t('lookNoAdapter'), sameSteps: t('sameStepsNotSameLook'), absolute: t('absolute'), lightWarning: t('lightWarning'),
    nothing: t('nothing'), notBuilt: t('notBuilt'), notInFormat: t('notInFormat'), stale: o.stale, proposal: t('proposal'), noSound: t('skip.no_sound'), done: (n) => fill(o.done, { n }),
    part: Object.fromEntries(LESSON_PART_ORDER.map((k) => [k, t(`part.${k}`)])) as Record<LessonPartKind, string>,
    why: Object.fromEntries([...NOT_LEARNED_WHY, ...DERIVE_LEFT_OUT].map((k) => [k, t(`why.${k}`)])) as Record<NotLearnedReason, string>,
    stop: Object.fromEntries(WINDOW_STOPS.map((k) => [k, t(`stop.${k}`)])) as Record<WindowStop, string>,
  };
}
