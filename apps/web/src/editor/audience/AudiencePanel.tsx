/**
 * «מה שונה בגרסה הזו» — the change list of the viewed version for an audience (wave 8 audiences track). W3 builds it; DeliverPanel.tsx
 * mounts it in the formats section while a version with `audience` is viewed and AUDIENCE_UI_BUILT is true. It holds (plan §3.6,
 * corrected by the verifier; sharing is cut): the groups changes / fast cuts not changed / sound / what the version does not do, from
 * api.audienceChanges; each row a button (roving tab stop, ds rovingNext) whose Enter moves the playhead to its startFrame; «להשאיר
 * כמו במקור» / «להחזיר את השינוי» commits set_audience_keep once; sound rows with role, reason and a role select
 * (update_audience_version.sound) and the integer-dB music level (musicDb) said «ביחס לשאר הקול», every sound row «לא נשמע»;
 * «לשליחה» opens openExportSheet on this version. A 501 shows audience.notBuilt. Ids: AUDIENCE_TESTIDS. No focus is moved in a later
 * task (CAPABILITIES "Keyboard focus is never moved in a later task").
 */
import type { Variant } from '@pulseframe/core';

/** True once W3 has built the editor surfaces (the menu group, the chip mark, this panel, the stage note) against a built server. */
export const AUDIENCE_UI_BUILT = false;

export function AudiencePanel({ variant }: { variant: Variant }) {
  void variant;
  return null;
}
