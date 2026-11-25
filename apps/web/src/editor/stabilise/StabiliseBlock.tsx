/**
 * The «ייצוב תמונה» block of the object inspector (wave 7 stabilise track). W3 BUILDS IT against the settled contracts: the
 * operations set_clip_stabilise / remove_camera_motion (core steadyOps.ts), the job (api.stabiliseClip, api.cameraMotion), the live
 * preview (editor.previewStabilise in store.ts), the strings (packages/i18n/src/stabilise.ts `stab.*`, read through
 * stabilise.strings.ts) and the test ids (stabilise.testids.ts). InspectorObject.tsx mounts the section above the tracking section
 * for one selected video clip only while STABILISE_UI_BUILT is true, so the editor shows nothing new until it is built.
 * Rules: every state a labelled sentence (not measured, measuring with «עצירה», on, off, limited, refused through translateRefusal,
 * not offered for stills and multicam segments); nothing is called steady or good; the slider previews through
 * editor.previewStabilise and commits ONCE on release with dependsOn ['analysis:<assetId>']; arrows ±1, PageUp/PageDown ±10,
 * Home/End; numbers and ×Z in LTR isolates; the last strength of a clip is remembered and sent when the switch goes back on.
 */
import type { MediaClip } from '@pulseframe/core';

/** True once W3 has built the block (InspectorObject.tsx mounts the section only then). */
export const STABILISE_UI_BUILT = false;

export function StabiliseBlock({ clip }: { clip: MediaClip }) {
  void clip;
  return null;
}
