/**
 * `pnpm proof:shorts` — the end-to-end proof of shorts (ADR-0018, plan §6), CPU only, no model. Evidence:
 * docs/evidence/shorts-proof.json (every measured number with its budget and pass or fail). W2 writes the checks; the lead runs
 * it after merging and `pnpm build`. Exit codes: 0 = every check passed; 1 = a check failed (its numbers are in the evidence,
 * never relaxed); 2 = blocked (the part is not built on this tree, or a check could not run: listed as `blocked` with its reason).
 *
 * Fixture (lead): packages/fixtures/src/shorts.ts generateShortsFixture (240 s, 1920×1080, 30 fps, four planted cuts, a white
 * disc on a known path, the frame-index barcode, word bursts with a manual word-timed Hebrew transcript: Q a question at +6 dB,
 * R opens with «אז כמו שאמרתי», X holds the excluded word, P holds 0.8 s and 1.5 s pauses and two «אממ»; a 2 s burst with no
 * words), plus the 20-minute long-media fixture for S10.
 * - S1 candidates: Q in the top 3; X listed as excluded with its word and exact time; every edge T.eq a statement edge; R carries
 *   context_added or starts_with_reference; louder value 6.0 ± 0.5 dB; two runs give identical JSON; no "viral" wording; the
 *   method says heuristic; ranking with cached features ≤ 2 s.
 * - S2 no transcript: every edge within 0.15 s of a planted silence edge; no word reasons; every candidate has no_transcript.
 * - S3 making 3 shorts at 720×1280 (tightened, track, backdrop): one revision, 3 sequences, ops ≤ 2000; undo/redo give equal
 *   creativeProjection; a title added on a plan-made track then an out-of-order undo → 409 undo_conflict, document unchanged;
 *   bytes per short (budget 60 KB) and commit p95 (budget +15 ms) recorded.
 * - S4 exact time: every kept word inside a piece; frame-aligned starts and durations; sequenceDuration = sum of pieces; no
 *   silence ≥ 0.5 s in the tightened wav; RMS in the 50 ms after each first-word onset within 0.5 dB of the source; picture
 *   cuts ≥ 11 frames apart; fades exactly 1/100 s at removal joins only.
 * - S5 follow: |cx − W/2| ≤ 0.10·W in ≥ 95% of settled frames (from /frame?sequence=); no #000 in the 2-px edge columns; the
 *   barcode at every planted cut is at/after the cut on the new piece's first frame and before it on the previous frame.
 * - S6 backdrop: bands not background-coloured, Laplacian variance ≤ 10% of the foreground's; foreground band W·Hs/Ws ± 2 px;
 *   no 'upscaled' warning for the blurred copy.
 * - S7 export: ffprobe 720×1280, frames = frameCount(sequenceDuration), 30/1, AAC; burned vs caption-free differ ≥ 5 levels in
 *   the caption band and ≤ 1 above; first SRT cue = snapped first word; −14 ± 0.5 LUFS; 0 photosensitivity failures; a batch of
 *   2 items makes 2 jobs, a bad item none (404).
 * - S8 parity: /frame?sequence=, a png export and a browser export of the same frame within the parity tolerance.
 * - S9 MCP: find → plan → make → contact sheet (sequenceId) → preflight → export; propose mode 403 on make_shorts; a
 *   non-verbatim quote 422; render_frame reports 720×1280.
 * - S10 long media: time, real-time factor ≥ 20×, RSS ≤ 400 MB, hops = ceil(seconds·10) with no seam gap, commit p95.
 *
 * PLACEHOLDER of the lead's contracts commit: no check is built, so it reports blocked and exits 2. It never writes evidence.
 */
import { SEQUENCE_OPS_BUILT } from '@pulseframe/core';

const report = { proof: 'shorts', status: 'blocked', reason: `the shorts proof is not built yet (W2); the sequence operations are ${SEQUENCE_OPS_BUILT ? 'built' : 'not built'} on this tree`, checks: [] as unknown[] };
console.log(JSON.stringify(report, null, 2));
process.exit(2);
