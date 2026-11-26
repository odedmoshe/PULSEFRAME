/**
 * pnpm proof:grade — colour curves «עקומות» and the scope additions (wave 8 grade; grade-plan.md §5 as corrected by grade-verify.md
 * C1–C12; cut: hue-versus-saturation, false colour, curve keyframes, describe_moment table samples, the curve-aware colour-match fit,
 * zebra while playing, double-click to add a point). LEAD: the entry point and the check list. Each builder owns one part file:
 *   grade-proof.engine.ts (W1: G1–G10) · grade-proof.ui.ts (W2: G11, G12) · grade-proof.scopes.ts (W3: G13–G18).
 * The model tolerances of G5, G6 and G6b are grade-proof.tolerance.ts (slope-aware, C6), written in the pre-pass: never loosened; a
 * failure is reported with the adapter, the worst value, S and δ₀.
 * Until every part is built it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made at proof time as raw rgb24/rgba bytes turned into PNGs with `ffmpeg -f rawvideo … out.png`
 * (exact), 512×320, project size equal, one still on the timeline, deleted at the end (under 3 MB): F1 ramp (five 64-row bands, each
 * code value 2 columns wide: grey; red only; green only; blue only; grey at alpha 128), F2 75 % bars (the six targets plus black),
 * F3 zebra card (grey 128 with 96×96 squares of 255, 252, 250, 0, 4 and 6), F4 parade card (left (255,0,0), right (0,0,255)), F5 a
 * 3 s 30 fps testsrc clip for playback. All GPU checks run on the container's software adapter; the adapter is recorded.
 * Nobody here looks at a picture: every check is a measurement.
 */
import { GRADE_PROOF_ENGINE } from './grade-proof.engine.ts';
import { GRADE_PROOF_UI } from './grade-proof.ui.ts';
import { GRADE_PROOF_SCOPES } from './grade-proof.scopes.ts';

/** One part of the proof: built or not, and its checks (id → run). Each run returns true (pass) or a failure sentence with its numbers. */
export interface GradeProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }

export const GRADE_CHECKS: Readonly<Record<string, string>> = {
  G1: 'the gradeCurveTablesDigest of 40 point sets (the presets, the identity, 37 from a fixed integer generator) is identical in Node and in headless Chromium (window.__pfGradeCurveHash)',
  G2: 'at every knot of the 40 sets the table equals y; monotone sets give non-decreasing tables with no segment outside its knots\' range; the identity gives C[v] = v',
  G3: 'set_grade_curves refuses unordered points, gaps < 4, a missing end point, 13 points, a value of 256 or 0.5, curves on a caption or sound clip and a locked track, typed and worded in he/en; identity channels are dropped; null removes; nothing is added to a clip without a grade when there is nothing to set (C10b); there is no merge mode; one undo restores the document byte for byte',
  G4: 'set_colour_grade (replace and merge), apply_look, update_effect and colour match leave the curves unchanged (colour match words replaces_grade as «מחליף את ערכי המחוונים; העקומות נשארות», C5); remove_effect removes them and undo brings them back; paste_attributes colour carries them; set_angle_look unedited keeps a segment whose only change is its curves (C4)',
  G5: 'F1 through render_frame, neutral sliders and the cinematic preset (every step ≤ 3): the opaque bands are T[v] exactly on ≥ 99 % of columns and within NEUTRAL_OPAQUE_CODES (1) everywhere (no slider stage, so no δ); the translucent band is within 3 codes of T[v]·α with the input un-premultiplied (gentle-translucent); the picture changed (mean difference > 5)',
  G6: 'the same with sliders (exposure +0.5, temperature 0.3, contrast 1.2) and four gentle curves (every step ≤ 3): every grid pixel within 2 codes of gradePixel(passInput, p, tables); the worst value and δ₀ (the same sliders without curves, this run) recorded',
  G6b: 'a steep curve (local step S ≥ 40, opaque pixels only): every grid pixel within 0.5 + S·δ₀ codes, δ₀ measured in the same run without curves; the worst value, its S and δ₀ recorded (C6)',
  G7: 'preview = still: in the editor, paused, the mean difference < 0.5 of 255; the PNG export frame equals render_frame byte for byte; an MP4 frame\'s flat bands within 12 of 255; the worker mode and adapter recorded',
  G8: 'frame key: one point\'s y raised by 1 changes the key; the same document keys equal twice; a document without curves keys exactly as on the base commit; the render cache re-renders a segment after a curve edit',
  G9: 'no regression: pnpm proof:gpu passes as on the base tree and the trend baseline\'s 348 frame hashes are identical (a grade without curves runs the unchanged pipeline)',
  G10: 'describe_moment on a curved clip returns the grade\'s params and points (no table samples: cut)',
  G11: 'editor, keyboard only, he and en: Tab to point 2 of the master curve, ↑ ×5 → after keyup the document holds y+5 and the status line reads the numbers; WHILE ↑ is held the preview changes before keyup and the document revision does not (C3); the «יציאה» field commits a typed value; Enter → a new point, focused, on the curve, the still identical; Delete → removed; Delete on an end point → the sentence, no commit; «דהוי» → its points; reset → no curves; each action one undo step; aria-valuetext of every point matches «כניסה N, יציאה M»; no aria-live on the status line; with curves the look picker shows «העקומות של הקליפ נשארות»; a grade slider previews live and commits once',
  G12: 'pointer: dragging point 2 past point 3 stops 4 short of it; one commit on pointer-up (double-click to add: cut)',
  G13: 'scopes on F2: each 75 % target holds ≥ 95 % of its bar\'s expected share (the measured share recorded); grey and black at the centre',
  G14: 'parade on F4: the red panel\'s left-half columns count only code 255, the green panel only code 0, the blue panel\'s right-half columns only 255',
  G15: 'zebra on F3, paused: data-clipped-px = the area of the 255 and 252 squares exactly; data-crushed-px = the 0 and 4 squares exactly; 250 and 6 not marked (overlay at the picture\'s 512 width)',
  G16: 'isolation: with zebra on and off the scope numbers, render_frame bytes and the export frame are equal; exposure-overlay is absent outside the Colour workspace; WHILE PLAYING no exposure-overlay pixels are drawn and the chip says «זברה מוצגת כשהניגון עוצר» (C7)',
  G17: 'throttle (C8): playing F5 for 2 s, the scope updates are within ±1 of the data-frame changes / 6; paused, five seeks give five updates and the numbers match the frame shown',
  G18: 'text labels: the parade, vectorscope and histogram each have their legend in words in both languages; the six target letters with their legend; the skin-line note (a convention, no judgement) is present and no number about the skin line is shown',
};
export const GRADE_MUST_STAY_GREEN = ['pnpm test', 'audit:a11y (states grade-curves with a point focused, scopes-zebra; dark and light, he and en)', 'audit:testids', 'proof:editor-interactions', 'proof:phase3 (its scope checks)', 'proof:gpu', 'proof:colourmatch 17/17', 'proof:audiences', 'proof:phase4', 'proof:keyframes (window.__pfCurveHash untouched)'];

const parts: Record<string, GradeProofPart> = { engine: GRADE_PROOF_ENGINE, ui: GRADE_PROOF_UI, scopes: GRADE_PROOF_SCOPES };
const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
if (pending.length) {
  console.error(`grade-proof: not built yet (parts ${pending.join(', ')}); ${Object.keys(GRADE_CHECKS).length} checks pending (${Object.keys(GRADE_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
let failed = 0;
for (const part of Object.values(parts)) for (const [id, run] of Object.entries(part.checks)) {
  const r = await run().catch((e: unknown) => `threw: ${String((e as Error)?.message ?? e)}`);
  if (r === true) console.log(`PASS ${id}: ${GRADE_CHECKS[id] ?? ''}`); else { failed++; console.log(`FAIL ${id}: ${r}`); }
}
const missing = Object.keys(GRADE_CHECKS).filter((id) => !Object.values(parts).some((p) => id in p.checks));
if (missing.length) { console.log(`FAIL: checks without a run: ${missing.join(', ')}`); failed++; }
process.exit(failed ? 1 : 0);
