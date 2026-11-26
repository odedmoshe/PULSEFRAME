/** The stage word of a background (capability or model-download) job, in the owner's language. Never the server's raw text. */
import { jobStageLabel } from '@pulseframe/i18n';

type Lang = 'he' | 'en';
const WORDS: [RegExp, { he: string; en: string }][] = [
  [/^queued\b/, { he: 'ממתין בתור', en: 'waiting in line' }],
  [/^submitting\b/, { he: 'שולח', en: 'sending' }],
  [/^transfer \(staging/, { he: 'מעביר קבצים', en: 'moving files' }],
  [/^transfer \(downloading/, { he: 'מקבל את התוצאה', en: 'receiving the result' }],
  [/^downloading\b/, { he: 'מוריד', en: 'downloading' }],
  [/^verified\b/, { he: 'בודק', en: 'checking' }],
];
const GENERIC = { he: 'בעבודה', en: 'working' };

export function capStageLabel(stage: string | null | undefined, lang: Lang): string {
  if (!stage) return '';
  for (const [re, w] of WORDS) if (re.test(stage)) return w[lang];
  const known = jobStageLabel(stage, lang);
  return known !== stage ? known : GENERIC[lang];
}
