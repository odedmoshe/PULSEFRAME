/**
 * «מגביל ראשי» in the sound panel's loudness section (wave 7 send): a switch and a ceiling (−9…0 dB, default the loudness true peak
 * or −1) committing set_master_limiter. Worker C's component; a placeholder until then.
 */
import { dictionaries } from '@pulseframe/i18n';
import { SEND_TESTIDS as ID } from './send.testids.ts';

export interface LimiterSwitchProps { lang: 'he' | 'en'; ceiling: number | null; onChange(ceiling: number | null): void }
export function LimiterSwitch({ lang }: LimiterSwitchProps) {
  return <div data-testid={ID.limiter} role="note">{dictionaries[lang]['send.notBuilt']}</div>;
}
