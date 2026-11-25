/**
 * «השוואת עוצמה» in the sound panel (wave 7 send): measure the selected clips (api.measureClipLoudness), default target = the
 * median, commit match_clip_loudness with expectedRevision = the measurement's revision, show the per-clip result. Worker C's
 * component; a placeholder until then.
 */
import { dictionaries } from '@pulseframe/i18n';
import { SEND_TESTIDS as ID } from './send.testids.ts';

export interface LoudnessMatchProps { lang: 'he' | 'en'; projectId: string; clipIds: string[] }
export function LoudnessMatch({ lang }: LoudnessMatchProps) {
  return <div data-testid={ID.match} role="note">{dictionaries[lang]['send.notBuilt']}</div>;
}
