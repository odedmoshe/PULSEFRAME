/**
 * The motion path «מסלול תנועה» on the stage (ADR-0019, W3), mounted inside CanvasHandles' `.ch-root` (dir=ltr), sharing its
 * rect, its scale k = rect.width / frame width, the viewed document (editor.viewDoc) and its visibility rule. Shown when x or y
 * of the selected clip is keyed, playback is paused and the editor's `pathOn` is set (store.ts; view.motionPath toggles it).
 * Points come from core pathEdits.ts pathPoints (transformAt per frame, ≤ 600 points, every key frame kept): an aria-hidden
 * dual-stroke polyline, frame dots when they are ≥ 4 px apart, one <button> per vertex (named with timecode and values; drag
 * after 3 px with the centre snap of CanvasHandles; arrows 0.01, Shift 0.05, Alt+←/→ change the time), a bend grip at each
 * segment's middle frame (pathEdits.ts bendOps; a role=status note gives the deviation in pixels when it was approximate), and
 * aria-hidden edge stand-ins for points outside the viewer. Read-only in a format view (i18n keys.path.readOnlyFormat). A clip
 * that follows a motion track (clip.follow) shows no path in wave 1, with its reason (i18n keys.path.follower): its on-screen
 * path is the follow post-pass's and comes with ADR-0015's monitor path overlay (wave4-decisions.md).
 * Test ids: keyframes.testids.ts KF_TESTIDS.path, pathPoint, bend, pathNote, pathEdge, pathReason. Strings: i18n keys.path.*.
 *
 * PLACEHOLDER of the lead's contracts commit: it draws nothing. Not mounted yet.
 */
import type { ReactElement } from 'react';
import type { Clip, ProjectDocument } from '@pulseframe/core';

export interface MotionPathProps {
  /** The selected clip as the viewed document holds it. */
  clip: Clip;
  /** The viewed document (editor.viewDoc): its frame size and the clip's format overrides. */
  doc: ProjectDocument;
  /** The viewer rectangle CanvasHandles measures (CSS pixels), and its scale k = rect.width / frame width. */
  rect: { left: number; top: number; width: number; height: number };
  k: number;
  /** False in a format view: the path is drawn but cannot be edited. */
  editable: boolean;
}

export function MotionPath(props: MotionPathProps): ReactElement | null {
  void props;
  return null;
}
