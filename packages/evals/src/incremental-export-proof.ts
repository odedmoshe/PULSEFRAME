/**
 * `pnpm proof:incremental` — the end-to-end proof of the fast export and the render cache (ADR-0024; plan §10 with the verifier's
 * corrections), on a CPU, with no model. Evidence: docs/evidence/incremental-export.json (every measurement, and which claim was
 * proven: byte-equal segments, or render-equal frames with a PSNR floor).
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed; W3 writes the checks (with
 * incremental-fixtures.ts, built through the REST API with ops only) against a server started with startServer on its own port
 * and data directory, after the lead has wired the route. Until then this exits 2 = blocked, and proves nothing.
 *
 * The proof plan: an incremental export is compared with a full export FRAME BY FRAME and SAMPLE BY SAMPLE after a set of edits.
 * Fixture A: 640×360, 30 fps, 1801 frames (a 1-frame tail; a second variant has 1802), barcode video with B-frames and a 1-second
 * GOP, titles at 20–24 s and 40–41 s, grain on one clip, one transition, an echo time effect crossing a segment boundary, a
 * caption track, one followed redaction, a strobe clip and a snow overlay (Infinity values stay cacheable). Fixture B: a strobe
 * across the joins at 4 s and 6 s.
 * What the checks must be able to fail for:
 * - I1  clean segmented export: exact frame count, constant frame rate (sorted packet PTS deltas all equal frameTicks, first 0), reused 0;
 * - I2  against single pass at the same revision: every barcode frame source-exact; minimum PSNR reported (fail below 38 dB); size ratio reported (fail above 1.15);
 * - I3  clear and export again: per-segment sha256 equal; else encoderDeterministic: false is recorded;
 * - I4  one title changed: the plan marks exactly the two segments under it; the export renders exactly 2;
 * - I5  the incremental file equals a clean segmented export of the same revision on an empty cache: decoded framemd5 lists equal
 *       (and the video stream hash) when I3 held; otherwise the per-frame RGBA sha256 lists equal plus a decoded PSNR floor;
 *       the audio: decoded PCM sample by sample equal to the clean export's (sound is mixed whole; the join must not move it);
 * - I6  an audio gain change only: every segment reused; the sound differs where it must and the picture frames are equal;
 * - I7  a restart with another PF_SEGMENT_THREADS: every segment misses (encoder id) and the export equals clean (no test seam);
 * - I8  a planted stale segment (barcode frames, stale on every frame, stored under another key through the SegmentStore API on the
 *       stopped server's data directory): every-segment fails with render_cache_self_check_failed, nothing in out/, entries purged,
 *       the clean counter reset; the retry succeeds and equals clean;
 * - I8b a segment stale in half its frames: detection rate over 20 seeds in sample mode reported; in every-segment mode detection
 *       asserted only when the three checked frames include a stale one (stated which);
 * - I9  a flipped byte in a stored video: dropped by the integrity check, re-rendered, output equals clean;
 * - I10 fixture B with an edit inside 4–6 s: the photosensitivity report deep-equals the single-pass report of the same revision;
 * - I11 a small cap: cache <= cap after the export and at the store's high-water mark, LRU order respected; a cap smaller than one
 *       export: success with notStored > 0, cache never above the cap; a tight ceiling: data directory never above it, success, or a
 *       typed 507 with nothing published;
 * - I11b cache full under a ceiling: a small upload succeeds (the reclaimer made room);
 * - I12 ten-minute A/V sync (av-sync-long.ts PF_AVSYNC_MODE=incremental): clean segmented, one title at 5:00, incremental; max
 *       offset <= 1 ms and drift 0 on both; wall seconds of single pass, clean segmented (fail above 1.25×) and incremental (fail
 *       above 30 % of clean, target 15 %); the seconds spent in the self-check with 3 frames per segment;
 * - I13 cancel at about half, retry: finished segments are reused; result equals clean;
 * - I14 keying a ten-minute project: seconds and maximum event-loop lag (fail above 100 ms);
 * - I15 range exports starting and ending 1 and 2 frames off the grid, and a 2-frame range: equal to the same frames of the full export;
 * - I16 undo the title change: the plan shows everything reused;
 * - I17 delete the project: its exclusive segments are gone, shared ones stay;
 * - I18 UI on the harness page until the redesign surfaces mount: sheet numbers equal the plan, the lane shows the two stale
 *       stretches, a11y 0 findings in Hebrew and English;
 * - I19 regressions: proof:phase4 and the parity suite unchanged; I19b one GPU effect on the software adapter: engine.browser
 *       carries the launch mode, and whether adding the effect kept the other segments reusable is recorded;
 * - expected numbers are typed in this file, never computed by the code under test; a failing check is reported with its numbers, never relaxed.
 */
console.error('proof:incremental is not built yet (segmented export and render cache, ADR-0024): the contracts are in place and the proof is W3\'s after the lead wires the route. Nothing was checked.');
process.exit(2);
