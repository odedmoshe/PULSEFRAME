/**
 * pnpm proof:send — loudness: clip match and master limiter (worker A) (wave 7, track send; .artifacts/wave7/send-decisions.md §4). Lead pre-pass skeleton: it lists its
 * checks and exits 2 (BLOCKED) until worker A builds it; it never reports a pass it did not measure. Fixtures are synthetic, made
 * here with ffmpeg lavfi and the barcode generator; nothing of the owner's.
 *
 * Checks (each can fail):
 *  L1 measure_clip_loudness on F4 is within 0.1 LU of ffmpeg run here on the same audio; the 0.3 s clip is too_short
 *  L2 after the match every clip re-measures within 0.1 LU of the target; the click clip says limitedBy peak; one undo restores the document hash; a changed gain is refused stale_measurement; an old expectedRevision is refused
 *  L3 without a limiter the exported WAV is byte-identical to this proof's own run of unchanged mixToRaw + a frozen copy of the conversion command
 *  L4 with a limiter, a +6 dB mix: every 16-bit sample <= floor(10^(c/20)*32767), true peak <= c + 0.05 dB, samples outside the 125 ms window equal the unlimited export
 *  L5 a target the static gain misses (limitedByPeak) lands within 0.5 LU with the limiter; the report equals this proof's measurement
 *  L6 the same hash from the engine kernel in Node, on the selftest page, and from public/pf-master-limiter.js in an OfflineAudioContext
 *  L7 preview: limiter on -> the tap after it never exceeds the ceiling, reduction shown only in the loud part, «לפני הגברת הייצוא» shown with a loudness target; absent -> no worklet node and the Phase 0 preview-audio checks unchanged
 *  L8 a range export equals the full export from 125 ms after its start
 */
const CHECKS = [
  'L1 measure_clip_loudness on F4 is within 0.1 LU of ffmpeg run here on the same audio; the 0.3 s clip is too_short',
  'L2 after the match every clip re-measures within 0.1 LU of the target; the click clip says limitedBy peak; one undo restores the document hash; a changed gain is refused stale_measurement; an old expectedRevision is refused',
  "L3 without a limiter the exported WAV is byte-identical to this proof's own run of unchanged mixToRaw + a frozen copy of the conversion command",
  'L4 with a limiter, a +6 dB mix: every 16-bit sample <= floor(10^(c/20)*32767), true peak <= c + 0.05 dB, samples outside the 125 ms window equal the unlimited export',
  "L5 a target the static gain misses (limitedByPeak) lands within 0.5 LU with the limiter; the report equals this proof's measurement",
  'L6 the same hash from the engine kernel in Node, on the selftest page, and from public/pf-master-limiter.js in an OfflineAudioContext',
  'L7 preview: limiter on -> the tap after it never exceeds the ceiling, reduction shown only in the loud part, «לפני הגברת הייצוא» shown with a loudness target; absent -> no worklet node and the Phase 0 preview-audio checks unchanged',
  'L8 a range export equals the full export from 125 ms after its start',
] as const;

console.log('send-loudness-proof: BLOCKED — not built yet (worker A). Pending checks:');
for (const c of CHECKS) console.log(`  pending  ${c}`);
process.exit(2);

export {};
