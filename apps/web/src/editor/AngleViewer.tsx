/**
 * The angle viewer (ADR-0020, W3): core multiviewDocument (a layoutPlacements grid of the live angles, labels, no sound) drawn
 * by a SECOND Player with its own MediaPool({ assetUrl, previewUrl, maxDecoders: 4 }), slaved through Player.follow(frame) from
 * the program's group time and throttled to ≤ 15 fps. Angles beyond the 4 live tiles show the nearest thumbnail
 * (mediaThumb.ts), labelled «תמונה ממוזערת, לא חי». The program pool (10 decoders) is untouched.
 * Player contract W3 adds to player.ts (plan §13): PlayerOptions { draftOnly?: { maxHeight } }; setPictureDoc(doc): boolean
 * (no pause when canonical(audioPlan) is unchanged, else exactly setDoc); follow(frame): draw a frame with no transport.
 * LEAD PLACEHOLDER: draws nothing and says it is not built.
 */
import { dictionaries } from '@pulseframe/i18n';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';

export interface AngleViewerProps { groupId: string; lang: 'he' | 'en'; liveAngleIds: string[] }
export function AngleViewer({ lang }: AngleViewerProps) {
  return <p className="muted" data-testid={ID.notBuilt}>{dictionaries[lang]['multicam.notBuilt']}</p>;
}
