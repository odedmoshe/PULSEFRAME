/**
 * The clip panel of a drawing (wave 8 ink), registered for the drawn kind `ink` (drawnPanels.tsx) once INK_UI_BUILT: «הופעה» כפי שצויר /
 * הכול מיד and «היעלמות בסוף» (one edit_ink each), the chip «לא נבדק בעין», «הציור לא מסתיים לפני סוף הקליפ» when the clip is shorter
 * than the drawing, the other-format note, the neon note when this browser cannot blur. Follow is the carrier's Position tab
 * (set_clip_follow); no text control, no stroke editing. Lead pre-pass: empty stub; until it is registered the inspector shows the
 * carrier's neutral note for the kind.
 */
import { registerDrawnPanel, type DrawnPanelProps } from '../drawnPanels.tsx';
import { INK_UI_BUILT } from './InkMode.tsx';

export function InkPanel(props: DrawnPanelProps) {
  void props;
  return null;
}
if (INK_UI_BUILT) registerDrawnPanel('ink', InkPanel);
