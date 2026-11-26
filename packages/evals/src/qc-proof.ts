/**
 * pnpm proof:qc — «בדיקה לפני ייצוא» (wave 8 qc; .artifacts/wave8/qc-plan.md §5 as corrected by qc-verify.md and decisions.md
 * "Batch C … qc"). LEAD: the entry point and the list of checks, numbered as in the plan. B1 builds Q1–Q15 and Q17 here (core rules,
 * server lines); the editor rows (Q16) are B2's, in editor-interactions-proof.ts, read here from its evidence by the integration.
 * Until then it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass. Needs `pnpm build`.
 * Corrections taken in: Q3 is held_past_picture (C1) on an ffmpeg fixture made here (10 s of video muxed with 12.5 s of tone, no
 * -shortest), not a hand-built document; Q5 is the after-export `fade_edge` bound only (faded_out is CUT, C4/C9); Q11 checks the
 * USER-VISIBLE strings (sheet, card, i18n rows), not the API's `ok`/`verdict` fields (C7); Q12 has no PNG line (cut); no `there`.
 * Fixtures are SYNTHETIC only, made at proof time by ffmpeg (a 640×360 30 fps barcode video with a 440 Hz tone, a short clip, a still
 * PNG, tone WAVs, a typed word-timed transcript) and deleted at the end; under 20 MB. Nobody here can look or listen: every check is
 * a measurement, every rule a rule of thumb. proof:send K4 (the loudness route's sound findings equal the export's) must stay green.
 */
export const QC_PROOF_BUILT = false;
export const QC_CHECKS: Readonly<Record<string, string>> = {
  Q1: 'a 2-frame clip of a.mp4 between two longer clips gives exactly one flash_clip with measured {frames: 2, minFrames: 3}, its range and no fix',
  Q2: 'a 4-frame clip elsewhere gives no flash_clip',
  Q3: 'a clip of the ffmpeg file whose sound runs 2.5 s past its last picture gives one held_past_picture note with heldFrames 75; its picture-only fix (includeLinked false) removes it and one undo restores the document hash; after export the frozen finding there is explained picture_ends (C1, C14)',
  Q4: 'a title under a full-frame opaque video for its whole length gives one title_hidden; moved to a track above, none; under a chroma-keyed or shaken cover, none (C3)',
  Q5: 'an opacity fade to 0 over the last 0.7 s gives, after export, one black finding at the end explained fade_edge; a 20 s black clip after a fade is not explained (C9)',
  Q6: 'a dip-black transition of 20 frames leaves no unexplained black finding after export (a render-found one is dip_transition)',
  Q7: 'a 3-s freeze frame (add_clip freeze: true) gives no frozen finding and its silence is freeze_hold; a still photo with a motion preset for 4 s gives no frozen finding',
  Q8: 'a 3.2-s hole between two tone clips: the sheet\'s measurement (the route with the variantId of a format and with a short\'s sequenceId, and without) lists one silence with soundPlays false, and the export lists the same range (± one 0.1 s block)',
  Q9: 'a tone clip at +12 dB gives one clipped finding before export and the same after',
  Q10: 'the film ending inside a transcript word gives one ends_mid_word; a cut on a word edge mid-film none; a cut 2 frames inside a word one cut_mid_word note; a fadeOut at the end and a razor split are excused; segment timing is skipped and named (C5)',
  Q11: 'a clean control project (same media, no plant) has zero qc issues; no USER-VISIBLE string of the sheet\'s section, the file card or the qc i18n rows matches /fine|ok|pass|clean|תקין|עבר/ as a word (C7)',
  Q12: 'the WAV export of the planted project has checks.sound measured and checks.picture not_measured with its reason; a browser-route export stores not_measured on both with the route reason',
  Q13: 'fast export: after a one-clip edit, findings and their explained equal those of a single-pass export of the same revision',
  Q14: 'preflight with a variantId and with a short\'s sequenceId lists each qc issue in that output\'s own frames',
  Q15: 'MCP preflight and get_job (agent credential, observe) return the codes, frame ranges, measured numbers and clip ids, and no transcript word in any message (C5)',
  Q16: 'editor (Chromium, B2\'s rows of editor-interactions-proof): the count line in Hebrew, «מעבר לקטע» on flash_clip lands on its first frame, the file card folds «יש לזה הסבר בעריכה (n)», Tab reaches every jump, English shows the same keys',
  Q17: 'timing: documentChecks on a synthetic 10-minute, 600-clip document — one sample recorded, not gated',
};

if (!QC_PROOF_BUILT) {
  console.error(`qc-proof: not built yet; ${Object.keys(QC_CHECKS).length} checks pending (${Object.keys(QC_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
