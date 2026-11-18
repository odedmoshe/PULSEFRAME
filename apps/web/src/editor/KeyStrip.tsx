/**
 * The keyframe strip «פס קיפריימים» (ADR-0019, W2): a sibling overlay of the selected picture, title or adjustment clip on the
 * timeline (data-drag-clip, as VolumeLine; Timeline.tsx mounts it where VolumeLine is mounted, VolumeLine stays on sound clips).
 * Interactive for a single selected clip on an unlocked track, read-only in a format view (i18n keys.readOnlyFormat). One
 * <button aria-pressed> per keyed frame, aggregated by exact frame with effect keys included (core keyEdits.ts keyTimes), its
 * glyph SHAPE showing the curve after it and its name the timecode, channels and curve; keys outside the clip as an edge chip.
 * Click selects, Shift/Mod toggles, double-click opens the curve picker; drag after 3 px moves whole frames counted from the
 * original positions and commits once on release (keyEdits.ts moveKeysOps); a context menu offers Smooth / Straight / Curve… /
 * Copy / Paste / Delete. Focused keys handle their own keys and stop propagation (VolumeLine.tsx). Selection lives in the
 * editor's session state (store.ts keySel), never in the document. Test ids: keyframes.testids.ts KF_TESTIDS.strip, key,
 * outside, menu, menuItem. Strings: i18n keys.*.
 *
 * PLACEHOLDER of the lead's contracts commit: it draws nothing (the timeline keeps its passive diamonds). Not mounted yet.
 */
import type { ReactElement } from 'react';
import type { Clip, Track } from '@pulseframe/core';

export interface KeyStripProps {
  clip: Clip;
  track: Track;
  /** The clip is the only selected clip (the strip is interactive only then). */
  selected: boolean;
  /** The track is not locked and no format is viewed. */
  editable: boolean;
  /** Timeline zoom (pixels per second), and the clip's drawn box on the lane (as VolumeLine). */
  pps: number;
  left: number;
  width: number;
  clipHeight: number;
  clipTop: number;
}

export function KeyStrip(props: KeyStripProps): ReactElement | null {
  void props;
  return null;
}
