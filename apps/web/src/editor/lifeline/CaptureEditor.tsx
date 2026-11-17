/**
 * The capture date of library files (life line, ADR-0021; plan §7): the date badge of a media card (`15.3.24`; an estimate
 * has a dashed badge AND the words «משוער משם הקובץ», never colour alone), the popover «תאריך צילום…» (date, optional time,
 * «משוער», a live echo of the weekday and the Hebrew date, שמירה / הסרת התאריך → set_asset_capture) and, for several
 * selected files, «הזזת השעון…» (shift_asset_captures). Dates and numbers sit in `.num` / <bdi>.
 * Test ids: LIFE_TESTIDS.dateBadge(assetId), captureEdit, captureSave, shiftClock.
 *
 * CONTRACT FILE (lead pre-pass): the exports and their props are fixed; W3 builds the bodies. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
/** The date badge on a media card; draws nothing for a file without a date. */
export function DateBadge(_props: { assetId: string }): ReactElement | null {
  return null;
}
/** The capture date popover of one file. */
export function CaptureEditor(_props: { assetId: string; onClose: () => void }): ReactElement | null {
  return null;
}
/** The clock shift of several files. */
export function ClockShift(_props: { assetIds: readonly string[]; onClose: () => void }): ReactElement | null {
  return null;
}
