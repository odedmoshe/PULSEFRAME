/** «בדיקות הקובץ» on the file card (wave 7 send): findings with «מעבר לקטע». Worker C's component; a placeholder until then. */
import type { ExportChecks } from '@pulseframe/core';
import type { RationalTime } from '@pulseframe/time';
import { dictionaries } from '@pulseframe/i18n';
import { SEND_TESTIDS as ID } from './send.testids.ts';

export interface ChecksResultProps { lang: 'he' | 'en'; checks: ExportChecks | null; onJump(at: RationalTime): void }
export function ChecksResult({ lang, checks }: ChecksResultProps) {
  if (!checks) return null;
  return <div data-testid={ID.checks} role="note">{dictionaries[lang]['send.notBuilt']}</div>;
}
