/**
 * pnpm proof:growing — «גדלים מול העיניים» (wave 8 growing; growing-plan.md §5 as corrected by growing-verify.md). LEAD: the entry
 * point and the list of checks. Each builder owns one part file and builds its checks there:
 *   growing-proof.server.ts (W2: G1–G17 below) · growing-proof.ui.ts (W3: U1–U4).
 * Until every part is built it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made at proof time by ffmpeg in a temporary folder and deleted after the run (about 2 MB): ten
 * "faces" (a beige disc and two 6×6 #FF00FF eye squares at known positions over a textured gradient; rotations −40°, −10°, 0, 25°,
 * 80°; sizes 640×480, 480×640, 1280×720, 320×240; eye distances 12–140 px), two JPEGs with EXIF orientation 6 and 3
 * (image-matrix.ts maker), a 2 s 30 fps barcode video with drifting eye squares, black/white backgrounds for the flash check.
 * Dates through set_asset_capture (two left undated); a person with a birth date. Never owner or family media.
 *
 *  G1  each pick's server still at its middle frame has the two magenta centroids within 1.0 px of the targets (EXIF-6 and EXIF-3 included, C4).
 *  G2  the paused editor preview is byte-identical to the server still at 6 frames, one inside a dissolve.
 *  G3  in the exported MP4 the frame count equals the planned length exactly; centroids within 2 px at every hold's middle frame.
 *  G4  the order is capture order, the two undated pictures where the hand placed them.
 *  G5  a video pick shows exactly its marked frame (barcode) on every frame of its hold: still, preview and export.
 *  G6  a dissolve out of a held video frame is accepted, and its middle frame is the exact mix within the opacity tolerance.
 *  G7  colour fill: uncovered corners are exactly the background colour; at suggestedFaceSize no pick has uncovered pixels (grid and still agree).
 *  G8  captions resolved by evaluate for the owner: date and age on dated picks, date only before birth, none on undated picks, the
 *      frame where a dissolve starts included (verifier C14); preflight has no field-without-data blocker.
 *  G9  (C8) no `eyeMarks` key and no planted coordinate anywhere: stored document, transactions, events, entity versions, summary,
 *      archives, versions, MCP resources, for every credential.
 *  G10 agents are refused: plan, apply and both rebuild routes and the three MCP recipe tools answer 403 owner_required; nothing committed.
 *  G11 the run record holds picks and settings only: no number pair in [0,1].
 *  G12 one undo returns the document hash to the one before apply; redo restores it.
 *  G13 rebuild: a hand-rotated pick kept exactly; a deleted pick stays out and is named, and comes back with restoreRemoved only when
 *      marked again (else needs_marks); a pick moved in time goes back (moved_back); an untouched pick keeps its transform exactly
 *      (eyes from eyesFromTransform).
 *  G14 flash: at the minimum hold with hard cuts on black and white pictures the export's photosensitivity check reports no failing
 *      stretch; control: the same pictures at a 4-frame hold laid by direct ops are reported failing.
 *  G15 a hold below flashGapFrames is refused with its wording, not raised.
 *  G16 each refusal of add_clip { freeze } and of the planner answers its code and both wordings.
 *  G17 the plan digest is identical in two runs; the browser's planGrowing (live preview) gives the server's transforms within 1e-6.
 *  U1  keyboard only: start hub card, choose 4 pictures, mark 3 by arrows and Enter and 1 by click, choose a video frame, «צרו»; the
 *      bar is shown and the timeline holds the picks.
 *  U2  the live preview appears after the second picture, labelled «תצוגה מקדימה — עוד לא נוצר», and nothing is stored until «צרו».
 *  U3  S swaps the two points and the preview follows; closing with unmade marks asks first (C8); no localStorage/sessionStorage key holds a mark.
 *  U4  the dialog is dir=rtl, the marking view dir=ltr, focus returns to the opener, Escape closes; the privacy sentence is shown.
 * Must stay green: typecheck, test, audit:a11y (states growing-pick, growing-mark, growing-settings, growing-bar), audit:testids,
 * proof:editor-interactions, proof:family-film, proof:story, proof:templates, proof:lifeline, proof:lifeline-ui, proof:phase5,
 * proof:phase4, proof:phase7, proof:trend-transitions, proof:speed, conformance:opacity, conformance:parity.
 * Not provable here (the owner's laptop): real photos of a child, how precisely a person clicks eyes there, whether it looks still or
 * good, the Hebrew, the speed there, HEIC photos, a screen reader, createImageBitmap orientation in the renderer's Chromium.
 */
import { GROWING_PROOF_SERVER } from './growing-proof.server.ts';
import { GROWING_PROOF_UI } from './growing-proof.ui.ts';

/** One part of the proof: built or not, and its checks (id → run). Each run returns true (pass) or a failure sentence. */
export interface GrowingProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }
const parts = { server: GROWING_PROOF_SERVER, ui: GROWING_PROOF_UI };
const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
if (pending.length) {
  console.error(`growing-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
  process.exit(2);
}
let failed = 0;
for (const [name, part] of Object.entries(parts)) {
  for (const [id, check] of Object.entries(part.checks)) {
    const r = await check();
    console.log(`${r === true ? 'PASS' : 'FAIL'} ${id} (${name})${r === true ? '' : `: ${r}`}`);
    if (r !== true) failed++;
  }
}
process.exit(failed ? 1 : 0);
