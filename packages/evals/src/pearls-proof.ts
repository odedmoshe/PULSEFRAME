/**
 * pnpm proof:pearls — marked source ranges «פנינים» (wave 7 pearls track; .artifacts/wave7/pearls-decisions.md §4). LEAD: the entry
 * point and the list of checks. The checks are built in three parts, each owned by one builder: pearls-proof.core.ts (A: P1, P6,
 * P8 numbers, P14–P16), pearls-proof.server.ts (B: P2, P7–P9 route and tool, P10–P12), pearls-proof.ui.ts (C: P3–P5, P7 and P9 in the
 * editor, P13, P15 browser side). The integration step imports them here and sets PEARLS_PROOF_BUILT. Until then it runs nothing
 * and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made by the proof: barcode videos at 30 and 30000/1001 fps (packages/fixtures generateBarcodeFixture),
 * a tone and a still by FFmpeg, a time-preserving copy and an untimed (reversed) copy made by FFmpeg with lineage provenance, a typed
 * 12-word transcript, invented people «אלף», «בית», "Gimel", "gimel". No owner clip is ever used. Writes
 * docs/evidence/pearls-proof.json when built. One timing sample is one sample.
 */
export const PEARLS_PROOF_BUILT = false;
export const PEARLS_CHECKS: Readonly<Record<string, string>> = {
  P1: 'a new project\'s JSON has no sourceRanges key; stored fixtures and op logs replay; add-then-undo returns the stored JSON, also for a document imported with sourceRanges: {}; frame keys of 10 frames are equal before and after a pearl and a presence tag',
  P2: 'the three ops give equal revisions and events through REST, MCP and the editor; every refusal is worded in Hebrew and English',
  P3: 'viewer by keyboard: I at 30, O at 74, P, a name, Enter → one commit whose span is exactly [30/30, 75/30) s; Escape in the form closes the form only, the viewer stays open, focus is on «שמור כפנינה», nothing is committed',
  P4: 'transcript words 3–6 → the span is exactly first-word start to last-word end; verbatim is true; one letter changed → false',
  P5: '«הכנס במקום הסמן» is one transaction; stills at the clip\'s first and last frame read barcodes 30 and 74; one undo restores the hash; a word-aligned pearl is placed snapped outward',
  P6: 'usage equals the picture: the frames rangeUsage reports equal the frames whose barcode, read from each rendered frame, lies in [kLo, kHi) — forward, reversed, 2×, ramped and freeze clips, a span marked on 30 fps frames over the 29.97 file, and a word-edge span',
  P7: 'a trim changes the coverage to the exact new numbers; the other file\'s pearl is «לא בשימוש» in the list, the route and the tool',
  P8: 'the time-preserving copy counts as use of the original\'s pearl at the right offset; the untimed copy does not count and is named',
  P9: 'screen time on a built timeline (two tagged files, one untagged, a hidden track, two overlapping layers) equals hand-computed frames in the editor table, the route and the tool; the label is present in Hebrew and English',
  P10: 'privacy: a names agent reads names, no birth date, label "" and labelsHidden; a people "full" grant reads labels; people from any agent is 403 human_tag_required in a commit, a dry run, nested in apply_transaction and in propose_transaction; an agent\'s update or remove of a tagged range and remove_person of a tagged person are refused; a label from a names agent is 403 people_scope_required; the same add without people and label succeeds; assistantOps() holds none of the three ops; no run record holds a planted label after a film with pearls; the assistant summary (labelled MOCK adapter) holds no planted label',
  P11: 'a normal archive round-trips the ranges; «בלי פרטי משפחה» has no sourceRanges key and validates',
  P12: 'film: without picks.pearls the plan deep-equals the plan with every range removed; with prefer each file\'s first pearl is a pick whose first rendered frame is the barcode at sourceFrameOfTime(span.start); the file\'s second pearl is in pearl_left_out (one_per_file); a pearl longer than the longest span warns pearl_cut_short; apply is one undo; a pearl pick deleted by hand stays out on regenerate while its file stays in, and restoreRemoved returns it',
  P13: '«שורט מהפנינה»: without a transcript the short\'s first frame is the pearl\'s first source frame; with one the plan warns snapped_to_words and the excerpt contains the pearl; a 2-second pearl has the action disabled with its reason',
  P14: 'remove_asset takes its ranges and undo returns them; the owner\'s remove_person drops the tags, says the count, and undo returns them',
  P15: 'a hash of rangeUsage + screenTime over 20 fuzzed documents (Hebrew, Latin, names differing only in case) is equal in Node and in headless Chromium (window.__pfPearlsHash)',
  P16: 'recorded, not gated (one sample each): usage + screen time on 700 clips and 300 ranges; commit time with 2000 ranges',
};

if (!PEARLS_PROOF_BUILT) {
  console.error(`pearls-proof: not built yet; ${Object.keys(PEARLS_CHECKS).length} checks pending (${Object.keys(PEARLS_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
