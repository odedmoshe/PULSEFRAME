/**
 * pnpm proof:owntemplate — «שמירת הסרט כתבנית» (wave 8 owntemplate; owntemplate-plan.md §5 with owntemplate-verify.md C1–C12).
 * LEAD: the entry point and the list of checks. BUILDER W2 builds the proof (server through REST, Node only; no browser) and sets
 * OWNTEMPLATE_PROOF_BUILT; until then it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Writes docs/evidence/owntemplate-proof.json when built.
 *
 * FIXTURE (synthetic, made by the proof in a fresh temp dir, deleted at the end, < 5 MB): 12 ffmpeg testsrc2 / color clips 160x90 at
 * 30 fps (2–4 s) and 6 PNG stills; music: built-in music of music.calm (80 BPM) — the ORIGINAL film is built on it, so half a beat is
 * 11.25 frames, not under flashGapFrames(30) = 11 (verifier C5: at 120–128 BPM the cuts at beats 3½ and 4 would be merged) — and
 * music.cinematic (72 BPM) as the other tempo; a 30 s ffmpeg sine WAV whose beats are set by hand to an uneven list with
 * edit_analysis; a people sheet with two invented names; a transcript and captions with invented words; title texts holding an
 * invented name and a date. The original film, built through REST ops: cuts on beats 0, 2, 3½, 4, 6⅔, 8 after a bar-phase start,
 * a gap, a ken-burns preset at amount 0.6 (reported camera_move: recognition is cut), a hand keyframe path, a redact region, a speed 2
 * clip, a drawn clip, a PiP picture on V2, a narration clip, an adjustment look with a fade, a date-stamp effect with typed digits, a
 * transition with beat sync, a colour-table effect, a credits card, a title with {name:<person>} and a font outside the catalogue.
 */
export const OWNTEMPLATE_PROOF_BUILT = false;
export const OWNTEMPLATE_CHECKS: Readonly<Record<string, string>> = {
  K1: 'capture of the fixture film gives ticks [0, 384, 672, 768, 1280, 1536] relative to the lead (whole, half and third beats with the smallest denominator)',
  K2: 'applied in a new project with the same music and other media, the first picture starts EXACTLY at `at` (C3) and every cut is on the original film\'s exact frame (rational equality of clip starts)',
  K3: 'with music.cinematic (72 BPM) every cut start equals nearestFrame(at + (ticks − lead)/192 · 60/72) computed independently in the proof (music shifted by the lead)',
  K4: 'with the uneven hand-set grid every cut equals the independent interpolation between the two measured beats around it',
  K5: 'tempo half and double put cuts at (position − lead)·2 and ÷2 on the same grid (C12)',
  K6: 'frames axis (the film without music): cuts reproduce exactly at 30 fps; in a 25 fps project each cut is nearestFrame(frames/30)',
  K7: 'a pair of cuts closer than the flash gap gives cuts_merged on apply; the same pair in a hand-edited film is reported cuts_close with times at save (C5)',
  K8: 'titles start and end at their own from/to on the new grid, not at slot edges; style fields equal the original\'s (fontFamily outside the catalogue became the default: font_family); live tokens of FIELD_NAMES kept; person tokens and words are placeholders',
  K9: 'with «להשאיר את הטקסט» the words equal the original for the owner; the agent and observer tokens and a grant of another project read the placeholders in GET /api/v1/templates, catalog() and the plan (C2h); without it, none of the words is in the stored file',
  K10: 'the bytes of own-templates.json hold no asset id, asset name or stem, project name, people name, title / caption / transcript word or date shape',
  K11: 'an asset named color.mp4 does not refuse a template that carries a color.* effect (C2f: the deny check runs on free-text leaves only); a definition with an injected file name in an effect string param is refused 500 privacy_scan_failed naming the path only (the value absent from the answer)',
  K12: 'the report lists exactly: gap_closed, camera_move, redact, speed, drawn, other_pictures, own_sound, effect_text_param, lut, credits_card, person_field, font_family (with times); the template holds none of them; every clip of the main sequence is in exactly one list (partitionProblems)',
  K13: 'preview and save carry expectedRevision; a commit between them makes save answer 409 stale_revision; the «מה נשמר» counts equal the saved definition\'s',
  K14: 'apply is one transaction; one undo returns the document byte-identical; replaying the log after deleting the own template gives the same document',
  K15: 'regenerate (shuffle) of an own run works; after DELETE it answers 404 «התבנית הזו לא שמורה במחשב הזה…» (C10), also through music fit',
  K16: 'saving with the agent or observer token → 403 owner_required; the gallery lists the own template to an observer with name and schematic only',
  K17: 'the same film twice → 409 already_saved; the 51st → 409 too_many_templates; a film whose ops exceed 2000 → 409 too_many_operations at save (C8)',
  K18: 'pnpm backup of the data directory holds own-templates.json byte for byte, and a restore lists the template (C1)',
  K19: 'built-in templates: templateParity.golden.json (36) and templateParity2.golden.json (96) unchanged',
};

if (!OWNTEMPLATE_PROOF_BUILT) {
  console.error(`owntemplate-proof: not built yet; ${Object.keys(OWNTEMPLATE_CHECKS).length} checks pending (${Object.keys(OWNTEMPLATE_CHECKS).join(', ')}); nothing was saved or applied`);
  process.exit(2);
}
