/**
 * Fixed data-testids of «מוזיקה שמתאימה לסרט» (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md §4), shared by the
 * interface (builder C) and the proofs (musicfit-proof.ui.ts, the a11y rows the lead adds at integration). Lead contract: C puts exactly
 * these on the elements named here and does not rename them.
 */
export const MUSICFIT_TESTIDS = {
  /** the block under «סיום המוזיקה עם התמונה» in the Sound tab; data-state = idle | planning | plan | refused | not-built */
  block: 'musicfit-block', fit: 'musicfit-fit', ending: 'musicfit-ending', otherEnding: 'musicfit-other-ending', apply: 'musicfit-apply', cancel: 'musicfit-cancel',
  /** the join row of a song: where, the measurements, «השמעת החיבור» (aria-pressed), «חיבור אחר» */
  join: 'musicfit-join', joinMeasured: 'musicfit-join-measured', playJoin: 'musicfit-play-join', otherJoin: 'musicfit-other-join',
  /** the chip on a shortened song's clip and the owner's «שמעתי — החיבור בסדר» */
  unheardChip: 'musicfit-unheard', heard: 'musicfit-heard',
  /** «מוזיקה אחרת»: the button (data-host = clip | film | template), the dialog, a music row (data-asset-id or data-style-id), «להתאים גם את האורך», the "what changes" table */
  swap: 'musicfit-swap', swapDialog: 'musicfit-swap-dialog', swapRow: 'musicfit-swap-row', swapTailor: 'musicfit-swap-tailor', swapWhat: 'musicfit-swap-what', swapApply: 'musicfit-swap-apply',
  /** the impact controls in the clip's Beat tab and the ◆ tick on a timeline clip (data-clip-id) */
  impact: 'musicfit-impact', markImpact: 'musicfit-mark-impact', clearImpact: 'musicfit-clear-impact', impactOffset: 'musicfit-impact-offset',
  toBeat: 'musicfit-to-beat', toBar: 'musicfit-to-bar', earlier: 'musicfit-earlier', later: 'musicfit-later', impactTick: 'musicfit-impact-tick', realign: 'musicfit-realign',
} as const;
