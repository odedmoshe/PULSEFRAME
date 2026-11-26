/**
 * Whether the timeline toolbar must give the ride bar more room (wave 8D integration). The ride bar sits between the toolbar's
 * two ends; when even its icons-only form is wider than that room it lay over the toolbar's controls. Then the toolbar is
 * "crowded": its worded buttons keep only their icons (timeline.css data-crowded). Hysteresis: the toolbar is uncrowded only
 * when the room it would have WITHOUT the gain of crowding (`gained`, measured once after crowding) holds the bar, so the
 * toolbar does not switch back and forth.
 */
export function crowdedNext(s: { crowded: boolean; need: number; room: number; gained: number | null }): boolean {
  if (!s.crowded) return s.need > s.room + 1;
  if (s.gained === null) return true;
  return s.room - s.gained < s.need;
}
