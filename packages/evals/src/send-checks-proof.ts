/**
 * pnpm proof:send — export checks (worker B; sound findings from worker A) (wave 7, track send; .artifacts/wave7/send-decisions.md §4). Lead pre-pass skeleton: it lists its
 * checks and exits 2 (BLOCKED) until worker B builds it; it never reports a pass it did not measure. Fixtures are synthetic, made
 * here with ffmpeg lavfi and the barcode generator; nothing of the owner's.
 *
 * Checks (each can fail):
 *  K1 F3 single pass: exactly one black, one frozen, one silence and one clipped finding at the planted times (+-1 frame / 1 block), as exact rationals
 *  K2 the same export with every segment reused gives identical findings
 *  K3 a still photo, a freeze clip, a video on a hidden track, a video covered by an opaque full-frame clip and the clean F1 give no frozen finding; a timeline gap is black with context gap
 *  K4 measure_loudness returns the same silence and clipped ranges as the export
 *  K5 (unit) 15 black frames at 30 fps are found, 14 are not
 *  K6 editor: findings listed in Hebrew, «מעבר לקטע» lands on the frame, the ruler shows the marks, the quiet state does not contain «תקין»
 *  K7 the Phase 4 flashing fixture gives the same flash report as before
 *  K8 the F3 export succeeds and is published (checks report only)
 */
const CHECKS = [
  'K1 F3 single pass: exactly one black, one frozen, one silence and one clipped finding at the planted times (+-1 frame / 1 block), as exact rationals',
  'K2 the same export with every segment reused gives identical findings',
  'K3 a still photo, a freeze clip, a video on a hidden track, a video covered by an opaque full-frame clip and the clean F1 give no frozen finding; a timeline gap is black with context gap',
  'K4 measure_loudness returns the same silence and clipped ranges as the export',
  'K5 (unit) 15 black frames at 30 fps are found, 14 are not',
  'K6 editor: findings listed in Hebrew, «מעבר לקטע» lands on the frame, the ruler shows the marks, the quiet state does not contain «תקין»',
  'K7 the Phase 4 flashing fixture gives the same flash report as before',
  'K8 the F3 export succeeds and is published (checks report only)',
] as const;

console.log('send-checks-proof: BLOCKED — not built yet (worker B). Pending checks:');
for (const c of CHECKS) console.log(`  pending  ${c}`);
process.exit(2);

export {};
