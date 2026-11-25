/**
 * «התאמה לאורך» in the Sound tab of a music clip (wave 7 musicfit track). BUILDER C builds it under the existing «סיום המוזיקה עם
 * התמונה» button (SoundPanel.tsx ClipSound mounts it while MUSICFIT_UI_BUILT): the plan inline (api.musicFitPlan) — what will be made,
 * how it ends in words (musicfit.endsWithFilm / endsEarly / endsCut, with «סיום אחר»), for a song the join row with its measured
 * sentence, «השמעת החיבור» (musicJoinUrl; aria-pressed) and «חיבור אחר» (the next candidate's removal), then «בצעו» (api.musicFitApply
 * with the plan's revision). On a shortened song's clip: the chip MUSICFIT_UNHEARD_LABEL and «שמעתי — החיבור בסדר» (api.markJoinHeard;
 * the owner's session only). Built-in tracks keep MUSIC_UNHEARD_LABEL. A 501 shows musicfit.notBuilt. Ids: MUSICFIT_TESTIDS.
 */
import type { Clip } from '@pulseframe/core';

/** True once builder C has built the editor surfaces (the block, the dialog, the impact controls and tick, the commands). */
export const MUSICFIT_UI_BUILT = false;

export function MusicFitBlock({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  void clip;
  return null;
}
