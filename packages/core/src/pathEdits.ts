/**
 * Motion path edits (ADR-0019, W3 bodies; the lead's contracts commit fixes the signatures): the path of a clip's x/y keys on
 * the stage, and the operations a vertex drag or a bend makes. Pure; the editor calls them inside commit(() => …).
 *
 * The path is the clip's OWN x/y (animation.ts transformAt), so it is the same curve preview, render_frame and export draw
 * (ADR-0005). A clip that follows a motion track (clip.follow, ADR-0015) is not drawn in wave 1: its on-screen path is the
 * follow post-pass's (engine follow.ts resolveFollows) and comes with ADR-0015's monitor path overlay in wave 2
 * (wave4-decisions.md); the editor states that reason instead (i18n keys.path.follower).
 * Writes go through replace_clip_keyframes (≤ 2 ops per gesture: x and y).
 *
 * PLACEHOLDERS: every function refuses ("… is not built yet") until W3 fills it.
 */
import type * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { Clip } from './schema.ts';

const notBuilt = (what: string): never => { throw new Error(`${what} is not built yet (ADR-0019 W3)`); };

/** One point of the path, in transform units (fractions of the frame width/height from the centre). */
export interface PathPoint { frame: number; x: number; y: number }
/** transformAt for each frame of [0, frame count); decimated above `max` (default 600) points, every key frame kept. */
export function pathPoints(clip: Clip, rate: T.Rate, max?: number): PathPoint[] { void clip; void rate; void max; return notBuilt('pathPoints'); }
/** Frames inside the clip where x or y has a key, ascending. */
export function vertexFrames(clip: Clip, rate: T.Rate): number[] { void clip; void rate; return notBuilt('vertexFrames'); }
/**
 * Move the vertex at `frame` to (x, y): ≤ 2 replace_clip_keyframes. An axis with no keys is keyed at every vertex with its
 * static value and the same curves, so the path elsewhere is unchanged exactly; a missing key on a keyed axis is inserted
 * with curves.ts splitSegment (`exact` false when that insertion was approximate).
 */
export function moveVertexOps(clip: Clip, rate: T.Rate, frame: number, x: number, y: number): { ops: OpCall[]; exact: boolean } { void clip; void rate; void frame; void x; void y; return notBuilt('moveVertexOps'); }
/** Insert an x+y vertex at floor((a + b) / 2) through (x, y), with 'smooth' on both sides of it. */
export function bendOps(clip: Clip, rate: T.Rate, a: number, b: number, x: number, y: number): { ops: OpCall[]; frame: number; exact: boolean; maxDeviation: { x: number; y: number } } { void clip; void rate; void a; void b; void x; void y; return notBuilt('bendOps'); }
