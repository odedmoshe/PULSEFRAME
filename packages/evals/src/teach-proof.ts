/**
 * pnpm proof:teach — «למדו אותי פעם אחת» (wave 8 teach track; .artifacts/wave8/teach-plan.md §5 as corrected by teach-verify.md and
 * the lead's cuts in decisions.md). LEAD: the entry point and the list of checks. Checks 2 and 7 are the verifier's corrected ones
 * (C15): gain and fades are their own parts, so check 2 counts 4 parts; check 7 uses 3-frame trims at 30 fps applied at 25 fps (5
 * merged, 6 unmerged), and since saved lessons are cut it sends the derived arguments from the owner's session to a second project.
 * The plan's check 8 (LUT by hash), check 12 (ripple), the frame route of check 6, propose_lesson and the saved-lesson rows of check
 * 11 are CUT with their features; checks 8 and 12 here are the replacements the verifier's corrections ask for (C5, C1/C2).
 * Built in parts by W2 (teach-proof.server.ts: 1–12, 13) and W3 (the browser rows in proof:editor-interactions, the a11y states);
 * the integration step imports them here and sets TEACH_PROOF_BUILT. Until then it runs nothing and exits 2 (blocked), never a pass.
 * Fixtures are SYNTHETIC only, made at proof time: three 2 s 320×180 testsrc2 clips with a 1 kHz tone, one 320×180 PNG still, a
 * 25 fps twin project; under 2 MB, deleted at the end. Check 6 renders a look: it needs the software WebGPU launch proof:gpu uses
 * (C13) and is reported blocked, never passed, without it. Nobody here looks at pictures: every check is a measurement.
 */
export const TEACH_PROOF_BUILT = false;
export const TEACH_CHECKS: Readonly<Record<string, string>> = {
  1: 'the classification covers every registered op and every argument key, and every string and frame parameter of the effect and sound-effect catalogues (lessonContracts.test.ts run inside the proof); nothing learnable is internal, a person, marked-range, privacy or motion-track op',
  2: 'the owner trims A\'s start by 10 frames, applies the look «שמש חמה», sets gain 0.7, fades the sound in 0.5 s, moves A and types a title word: the derived lesson has exactly 4 parts — trim-start, look, gain, fades — in the fixed part order; move_clip is listed `placement`, the word `words`; the planted word «נועה» appears nowhere in the derive answer (C15 fixed: gain and fades are their own parts)',
  3: 'applying it to B, C and the still makes revision +1 with one transaction: B\'s and C\'s starts exactly 10 frames later with source in-points advanced equally (rational equality); the grade params equal A\'s; gain 0.7 and fadeIn 0.5 s on the sound clips; the still\'s gain and fades are skipped `no_sound` and its look applied',
  4: 'planApplyLesson\'s rows (the dialog\'s) equal the commit\'s applied + skipped + rounded, field for field',
  5: 'undo returns the canonical document byte-equal to before; redo equals the apply; replay from the op log equals the stored document',
  6: 'render_frame of B after the lesson equals, pixel for pixel, render_frame of a twin B′ given the same ops by hand (one compositor, ADR-0005); with no graphics adapter the look check is BLOCKED (422 render_blocked), never passed (C13)',
  7: 'trim-twice merge (C15 fixed): two start trims of 3 frames at 30 fps derive one part with by = 1/5 s; those arguments, sent by the owner\'s session to the 25 fps twin project, move the start by exactly 5 frames with one `rounded` row (unmerged would be 3 + 3 = 6)',
  8: 'never carried (C5): a date stamp\'s typed text, color.lut\'s table id, a denoise profile and a free font family are not learned (each with its reason), and a crafted lesson carrying any of them is refused by validation; the derive answer holds no asset id',
  9: 'a target on a locked track has its parts skipped `track_locked` and the others applied; the whole op is refused (`nothing`) only when no pair applied anywhere',
  10: 'a crafted lesson (labelled: the log cannot hold one) with a strobe at rate 4 is refused per pair by the effect\'s own schema, and the pair is put back exactly (diff empty for that pair)',
  11: 'governance (version 1): an agent token\'s apply_lesson is 403 lesson_owner_only on REST commit, dry run, nested apply_transaction, proposals and the MCP op tool, with nothing committed or stored; an agent\'s derive is 403 owner_required; a hand-written add_person step inside the owner\'s apply_lesson is 403 forbidden_op',
  12: 'the window (C1, C2, C14): after a version restore, a paste of attributes, a template run and an accepted agent proposal, the earlier edits of the clip are not learned and the window names its stop; undone rows are never learned; the route read at most the newest 400 rows',
  13: 'one timing sample on this CPU (never generalised): derive over 400 rows, plan and commit of 200 targets × 4 parts',
};

if (!TEACH_PROOF_BUILT) {
  console.error(`teach-proof: not built yet; ${Object.keys(TEACH_CHECKS).length} checks pending (${Object.keys(TEACH_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
