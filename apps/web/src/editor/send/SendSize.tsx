/** «גודל יעד» of the «מתאים לשליחה» tile (wave 7 send). Worker C's component; until then an honest placeholder with its test id. */
import { dictionaries } from '@pulseframe/i18n';
import { SEND_TESTIDS as ID } from './send.testids.ts';

export interface SendSizeProps { lang: 'he' | 'en'; targetBytes: number | null; onChange(targetBytes: number | null): void }
export function SendSize({ lang }: SendSizeProps) {
  return <div data-testid={ID.size} role="note">{dictionaries[lang]['send.notBuilt']}</div>;
}
