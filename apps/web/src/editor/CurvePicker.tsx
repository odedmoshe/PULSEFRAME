/**
 * The curve picker «בוחר עקומה» and the curve chip (ADR-0019, W2).
 *
 * CurvePicker: role=dialog aria-modal=true with a focus trap (App.tsx's shortcut gate then mutes the global shortcuts behind
 * it), opened for editor state `curvePicker` (store.ts: a clip, a clip-local frame and the channels). Smooth «רך» and Straight
 * «ישר» buttons; a scope radio (every channel at this time, or one channel); a tile per named curve of core keyframe.ts CURVES
 * drawn by the one sampler (animation.ts sampleKeyframes at 41 points), turn-back tiles aria-disabled on light channels with
 * the reason (i18n curve.flashDisabled; keyframeChannels.ts isLightChannel); a 128×128 custom editor with two focusable
 * handles and four number inputs (x1, y1, x2, y2; x in 0..1, y in -1..2); a preview in channel units, stepped for integer
 * parameters, with a note when the parameter follows the beat. Every choice is one commit (keyEdits.ts curveOps →
 * set_keyframe_curve). It belongs to the redesigned inspector's Basic tab "keyframe curve drawer" (docs/design/UX_REDESIGN.md
 * §4.6) and opens from a strip key, a path point or a curve chip.
 *
 * CurveChip: a small button beside a keyframe diamond (InspectorObject.tsx TransformRow's keyframe column, LookPanel.tsx's
 * effect parameter keyer) naming the curve after the key at the playhead; it opens the picker for that one channel.
 *
 * Test ids: keyframes.testids.ts KF_TESTIDS.picker, tile(id), custom, customHandle, customInput(i), smooth, straight, scope,
 * preview, chip(channelKey). Strings: i18n curve.*.
 *
 * PLACEHOLDERS of the lead's contracts commit: both draw nothing. Not mounted yet.
 */
import type { ReactElement } from 'react';
import type { ChannelRef } from '@pulseframe/core';

/** The picker host: reads editor state `curvePicker` and shows the dialog while it is set. */
export function CurvePicker(): ReactElement | null {
  return null;
}

export interface CurveChipProps { clipId: string; channel: ChannelRef }
export function CurveChip(props: CurveChipProps): ReactElement | null {
  void props;
  return null;
}
