/**
 * pnpm proof:audiences — «גרסה לכל קהל», calm and grandparents versions (wave 8 audiences track; .artifacts/wave8/audiences-plan.md §5
 * as corrected by audiences-verify.md: the sharing checks 7, 8, 10–13, 18, 19, 22, 23 are cut with the sharing profile). LEAD: the entry
 * point and the list of checks, numbered as in the plan. Built in parts: audiences-proof.core.ts and audiences-proof.server.ts (W2:
 * 1–5, 6, 9, 14–17) and audiences-proof.ui.ts (W3: 20, 21); the integration step imports them here and sets AUDIENCES_PROOF_BUILT.
 * Until then it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made at proof time: 6 s of 320×180 at 30 fps from the fixtures generator (frame barcode), a 220 Hz
 * "music" bed and pulsed 1 kHz "speech" from ffmpeg sine, one built-in music track; no owner clip; under 2 MB, deleted at the end.
 * Check 15 needs the software WebGPU adapter for the flash transition: slow on 4 CPUs; one sample is recorded, not gated. Nobody here
 * can look or listen: every check is a measurement, none says how anything looks or sounds.
 */
export const AUDIENCES_PROOF_BUILT = false;
export const AUDIENCES_CHECKS: Readonly<Record<string, string>> = {
  1: 'a calm version turns off every CALM_OFF_EFFECTS effect on picture and adjustment clips, and the master document hash is unchanged',
  2: 'every softened transition becomes a dissolve with the same frames and no velocity, colour or seed; the projected calm and grandparents documents pass validateProject',
  3: 'a strobe clip added to the master after the version exists is off in the version, with no op on the variant',
  4: 'a kept strobe stays on; a split of that clip keeps the exception on both pieces; undo returns the exact document hash',
  5: 'grandparents titles and captions are ×4/3 within their caps (a size the version set itself stays as set: C3); the music track gain equals DB_GAIN[−8] × master; ducking +6 dB on an already ducked track only; a speech track is unchanged; the owner\'s role correction is honoured',
  6: 'a retry of a version export plans its snapshot as resolved: the same manifest and the same frame hashes as the first run (C1; no applied marker exists)',
  9: 'every change\'s jump frame lies inside its clip; kept items are listed as kept; the count of changes equals the number of rule applications',
  14: 'a retry of a grandparents export gives the same frame hashes',
  15: 'the master export\'s photosensitivity report has a flash stretch (strobe plus flash transition); the calm export\'s report has none on the same range — a measurement only, one sample',
  16: 'for one frame of each profile, the paused editor preview, the server still and the exported frame agree (still = preview byte-identical; export within the parity limit)',
  17: 'with no loudness target and no master limiter, measured from the exported WAV: the grandparents music-only stretch is 8.0 ± 0.1 dB below the master export and the speech-only stretch is equal ± 0.1 dB; a track with one camera-sound clip is not lowered (C13)',
  20: '«+» → «גרסה רגועה» makes one transaction: a chip appears, the viewer switches and the panel lists the changes; Ctrl+Z returns the document hash; the menu is there with all four formats added (C14)',
  21: 'by keyboard only: Tab to a row, Enter moves the playhead to its frame, «להשאיר כמו במקור» commits once; in Hebrew (RTL) and English',
};

if (!AUDIENCES_PROOF_BUILT) {
  console.error(`audiences-proof: not built yet; ${Object.keys(AUDIENCES_CHECKS).length} checks pending (${Object.keys(AUDIENCES_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
