/**
 * Reframing a wide picture into a narrow frame (ADR-0018, plan §4.5): a camera path over the subject's centre, kept inside
 * the cover clamp, written as LINEAR x keys (Ramer–Douglas–Peucker with ε, doubled until at most REFRAME_DEFAULTS.maxKeys).
 * Reframe motion has exactly one owner: these x keys on clips inside the short's own sequence (wave4-decisions.md); tracking's
 * camera follow and ADR-0017 1b faces feed planReframe as ReframeSample sources. W1 builds the bodies; this pre-pass fixes the
 * signatures and refuses honestly (each throws; none returns a made-up path).
 *
 * Formulas (plan §4.5): target x = −(u−½)·Ws·f·s/Wo with f the cover fitScale (geometry.ts); clamp |x| ≤ coverLimit =
 * max(0, (Ws·f·s/Wo − 1)/2); backdropScale = contain factor / cover factor (1080×1920 from 1920×1080 = 0.31640625).
 */
import type { OpCall } from './ops.ts';
import type { ProjectDocument } from './schema.ts';
import type { PlanWarning, ReframeInput, ReframePlanBody, ReframeResult, ReframeShot } from './shortsContract.ts';

export function planReframe(_i: ReframeInput): ReframeResult {
  throw new Error('planReframe is not built yet (shorts W1)');
}
/** The coverage clamp: the largest |x| that keeps the frame covered by a cover-fitted source at `framing`. */
export function coverLimit(_frameW: number, _srcW: number, _fitScale: number, _framing: number): number {
  throw new Error('coverLimit is not built yet (shorts W1)');
}
/** The foreground scale of the blurred-backdrop layout: contain factor / cover factor. */
export function backdropScale(_frame: { width: number; height: number }, _src: { width: number; height: number }): number {
  throw new Error('backdropScale is not built yet (shorts W1)');
}
/** The replace_clip_keyframes calls (at most MAX_REFRAME_OPS) that reframe an existing sequence's media clips. */
export function reframeOps(_doc: ProjectDocument, _sequenceId: string, _body: ReframePlanBody): { ops: OpCall[]; shots: ReframeShot[]; warnings: PlanWarning[] } {
  throw new Error('reframeOps is not built yet (shorts W1)');
}
