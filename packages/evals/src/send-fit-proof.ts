/**
 * pnpm proof:send — size-fit export (worker B) (wave 7, track send; .artifacts/wave7/send-decisions.md §4). Lead pre-pass skeleton: it lists its
 * checks and exits 2 (BLOCKED) until worker B builds it; it never reports a pass it did not measure. Fixtures are synthetic, made
 * here with ffmpeg lavfi and the barcode generator; nothing of the owner's.
 *
 * Checks (each can fail):
 *  S1 F1 (12 s 640x360 30 fps testsrc2 + noise + barcode + beeps) at a 1,500,000-byte target: the downloaded file is <= target and >= 85 % of it
 *  S2 it has exactly the planned frames at the exact rate (packet times), every barcode in order, beep offset <= 1 ms
 *  S3 fitFault overshoot-once (startServer deps): two attempts, the second <= target, the output labelled TEST
 *  S4 fitFault overshoot-always: the job fails size_fit_missed with both byte counts; the output route answers 409; no file and no work directory remain
 *  S5 plan only, a 20-minute document of one generated still: 1,000,000 is refused size_fit_too_small with minBytes; minBytes plans clean; minBytes - 1 is refused
 *  S6 F1 at 600,000: fit.scale 0.5, probed 320x180, frames exact
 *  S7 F2 at 500 MB: already_fits, one encode, fit.scale and the pixel size stated
 *  S8 fast export: a second target at the same scale renders 0 segments; after a one-clip edit only the changed segments render; both files <= their targets
 *  S9 the flash and check reports of a fit export equal those of the plain export at that scale
 *  S10 cancel during pass 2 ends within 2 s with nothing published
 *  S11 single-pass, segmented and fit outputs carry only ALLOWED_OUTPUT_TAGS
 *  S12 the browser route refuses sizeFit and a limiter with unsupported_in_browser_export
 *  S13 editor: tile -> typed 16 -> the fitted picture size shown before export; Hebrew stages; the card shows the bytes and «לא אומת»; the too-small refusal in Hebrew with the minimum
 *  S14 peak disk use <= 1.5 GB and the data directory removed at the end
 */
const CHECKS = [
  'S1 F1 (12 s 640x360 30 fps testsrc2 + noise + barcode + beeps) at a 1,500,000-byte target: the downloaded file is <= target and >= 85 % of it',
  'S2 it has exactly the planned frames at the exact rate (packet times), every barcode in order, beep offset <= 1 ms',
  'S3 fitFault overshoot-once (startServer deps): two attempts, the second <= target, the output labelled TEST',
  'S4 fitFault overshoot-always: the job fails size_fit_missed with both byte counts; the output route answers 409; no file and no work directory remain',
  'S5 plan only, a 20-minute document of one generated still: 1,000,000 is refused size_fit_too_small with minBytes; minBytes plans clean; minBytes - 1 is refused',
  'S6 F1 at 600,000: fit.scale 0.5, probed 320x180, frames exact',
  'S7 F2 at 500 MB: already_fits, one encode, fit.scale and the pixel size stated',
  'S8 fast export: a second target at the same scale renders 0 segments; after a one-clip edit only the changed segments render; both files <= their targets',
  'S9 the flash and check reports of a fit export equal those of the plain export at that scale',
  'S10 cancel during pass 2 ends within 2 s with nothing published',
  'S11 single-pass, segmented and fit outputs carry only ALLOWED_OUTPUT_TAGS',
  'S12 the browser route refuses sizeFit and a limiter with unsupported_in_browser_export',
  'S13 editor: tile -> typed 16 -> the fitted picture size shown before export; Hebrew stages; the card shows the bytes and «לא אומת»; the too-small refusal in Hebrew with the minimum',
  'S14 peak disk use <= 1.5 GB and the data directory removed at the end',
] as const;

console.log('send-fit-proof: BLOCKED — not built yet (worker B). Pending checks:');
for (const c of CHECKS) console.log(`  pending  ${c}`);
process.exit(2);

export {};
