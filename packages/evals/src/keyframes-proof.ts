/**
 * `pnpm proof:keyframes` — the end-to-end proof of keyframe curves and motion paths (ADR-0019, keyframes-plan.md §6), in
 * headless Chromium after `pnpm build`. Evidence: docs/evidence/keyframes-proof.json (every measured number with its budget
 * and pass or fail) and he/en screenshots. W3 writes the checks; the lead runs it after merging. Exit codes: 0 = every check
 * passed; 1 = a check failed (its numbers are in the evidence, never relaxed); 2 = blocked (a part is not built on this tree,
 * or a check could not run: listed as `blocked` with its reason).
 * - P1 keyboard picker → Overshoot on x: one revision; frames 0..30 within 1e-12 of the closed form.
 * - P2 the custom curve through the four inputs is stored exactly and renders within 1e-12.
 * - P3 S and L on a middle key set both sides; after S the slope is continuous (1e-4 relative).
 * - P4 the path overlay's points within 0.5 px of the mapped transformAt on every frame (motion-path-he.png, -en.png).
 * - P5 a 40 px vertex drag is one revision; Δx = 40/rect.width ± 1e-4; the untouched axis is exact at every other frame.
 * - P6 the bend grip inserts at the middle frame, smooth on both sides, within 1 px of the pointer (before/after screenshots).
 * - P7 keyboard walk (Alt+K, Comma/Period, ←/→ one revision each, Delete); clip count and start unchanged.
 * - P8 copy and paste keys to a second clip at exact offsets, one revision.
 * - P9 in a format view the path is read-only: 0 revisions.
 * - P10 the opacity picker disables the turn-back tiles; REST and MCP refuse with the Hebrew text.
 * - P11 export 60 frames 640×360 (white square on black, x overshoot, y smooth), ffmpeg-decoded centroid within 0.5 px of the
 *   closed form; render_frame at 5 frames meets the same bound.
 * - P12 Chromium __pfCurveHash equals the Node constant.
 * - P13 a follower's path is hidden with its reason.
 * Recorded: sampler ns/sample in Chromium (≤ 2 µs), pathPoints ms for 600 points (≤ 16 ms), the commit p95 of a 2000-key
 * replace with the document size (≤ +15 ms over a 1-key replace).
 *
 * PLACEHOLDER of the lead's contracts commit: no check is built, so it reports blocked and exits 2. It never writes evidence.
 */
import { CURVES_BUILT, KEYFRAME_OPS_BUILT } from '@pulseframe/core';

const report = { proof: 'keyframes', status: 'blocked', reason: `the keyframes proof is not built yet (W3); the curves are ${CURVES_BUILT ? 'built' : 'not built'} and the keyframe operations are ${KEYFRAME_OPS_BUILT ? 'built' : 'not built'} on this tree`, checks: [] as unknown[] };
console.log(JSON.stringify(report, null, 2));
process.exit(2);
