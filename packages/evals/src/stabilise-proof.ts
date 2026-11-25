/**
 * pnpm proof:stabilise — stabilisation, model-free (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md §4). LEAD: the
 * entry point and the list of checks; W3 builds the checks in this file (the kernel checks once W1 and W2 have merged). Until
 * STABILISE_PROOF_BUILT is true it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made by the proof with packages/fixtures/src/steady.ts (W1) and FFmpeg: 1280×720, 30 fps, 180 frames,
 * a world with its own texture and five ringed discs seen through a known camera path (slow pan + band-limited shake). No owner clip
 * is ever used. Thresholds are the designer's; a builder reports the measured value and never loosens one without the lead.
 * Writes docs/evidence/stabilise-proof.json when built. One timing sample is one sample.
 *
 * Fixtures: F1 plain · F2 a foreground block with its own motion over 25 % · F3 the block over 65 % · F4 flat grey with faint noise ·
 * F5 a hard cut at frame 90 to a world ≥ 40 grey levels apart · F7 a steady pan, no shake · F8 a portrait picture in the landscape
 * project · F9 a picture-in-picture clip.
 */
export const STABILISE_PROOF_BUILT = false;
export const STABILISE_CHECKS: Readonly<Record<string, string>> = {
  S1: 'kernel on F1: every frame after the first is ok; translation error p95 ≤ 0.3 source px, rotation p95 ≤ 0.02° (measured values reported)',
  S2: 'kernel on F2: the same bounds as S1 (the block\'s points are rejected)',
  S3: 'F3: at least 80 % of the frames with the block are weak, none ok (competing motions at ≥ 24 points and ≥ 40 % support; both ratios reported)',
  S4: 'F4: under 50 % measured; set_clip_stabilise refused with tooLittle; the document unchanged',
  S5: 'F5: frame 90 is start, 89 and 91 ok; the poses of 89 and 90 use no sample across the cut',
  S6: 'F7: zoomPm 1000 and an identity pose on every frame, edges included, at strengths 1, 50 and 100',
  S7: 'steadyPose digest over F1 at strengths 1, 50, 100 is identical in Node and in headless Chromium (window.__pfSteadyHash)',
  S8: 'sinCos and expm are within 1e-12 of Math.sin, Math.cos, Math.exp over their ranges',
  S9: '2,000 seeded poses and zooms: limitToCover returns a pose that covers; neededZoom covers and 0.999 of it does not',
  S10: 'export of F1 at strength 50: disc-centroid acceleration RMS ≤ 1/10 of the unstabilised export; each centroid within 0.5 px of the prediction',
  S11: 'no background pixel on ≥ 30 lossless render_frame stills per variant (automatic zoom, and zoomPm 1010 where the frames are listed limited), and on the export within a stated colour tolerance',
  S12: 'areaPercent equals 100·(1 − 10⁶/zoomPm²); zoomPm is within 0.5 % above the zoom the truth needs',
  S13: 'five frames as render_frame stills, decoded from the export and read from the editor preview agree within the parity tolerances',
  S14: 'the still of a source frame is byte-identical before and after split_clip, slip_clip, set_clip_speed 2 and 0.5, set_clip_reverse; the freeze frame equals its frame',
  S15: 'echo taps and a velocity ramp carry the pose of their own source frame (describe_moment); cover holds; ramp-only limits say reach',
  S16: 'a tracked region on a disc, stabilised: ≥ 80 % Laplacian loss on every exported frame; its centre within 1.5 px of the disc',
  S17: 'a sticker that follows a disc is within 1.5 px of its centroid in the stabilised export',
  S18: 'F8: no content outside its own rectangle on any frame',
  S19: 'after the job one undo returns the document hash from before the press; redo returns the stabilised hash',
  S20: 'F9 with a covering privacy region at its edge, and in the whole-picture fallback: no changed pixel outside its own rectangle',
  S21: 'a strength change is one commit, no job, no decode; the crop line equals the operation\'s output',
  S22: 'the slider at 100 on a clip measured at 50 starts no job and lists no outside frame',
  S23: 'a second clip of the same file stabilised: the still of a frame of the first clip is byte-identical',
  S24: 'cancel mid-run: status canceled, FFmpeg gone, the document unchanged',
  S25: 'the clip deleted while the job runs: the job fails clip_changed, the document unchanged',
  S26: 'a measurement that would pass 43,200 shared samples is refused with budget before 202; nothing attached',
  S27: 'preflight lists stabilise_limited and stabilise_unmeasured at the right timeline ranges at speed 1 and 2; warnings only',
  S28: 'recorded, not gated (one run): frames a second, event-loop lag p50/p99, commit delta at 10,800 camera samples, planStabilise time at 1,800 frames',
};

if (!STABILISE_PROOF_BUILT) {
  console.error(`stabilise-proof: not built yet; ${Object.keys(STABILISE_CHECKS).length} checks pending (${Object.keys(STABILISE_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
