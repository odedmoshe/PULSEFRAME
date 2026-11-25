/**
 * pnpm proof:craft — editing craft (wave 7 craft track; .artifacts/wave7/craft-decisions.md §4). LEAD: the entry point and the list
 * of checks. Each builder owns one part file and builds its checks there:
 *   craft-proof.ops.ts (W1: R1–R7, P1–P3, P5–P8, F1–F6, F9, F11) · craft-proof.versions.ts (W2: V1–V7, V9–V11) ·
 *   craft-proof.ui.ts (W3: R8, F7, F8, F10, U1–U3).
 * Until every part is built it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC only, made by the proof: barcode clips and stills from packages/fixtures, a beep track by ffmpeg, typed
 * Hebrew texts («נעה», «שָׁלוֹם», «מלך», «ילדים», a title with {name:…}), a typed transcript. Never the owner's media.
 * Writes docs/evidence/craft-proof.json when built.
 *
 * Ripple and time
 *  R1 Q at frame k of a main-track clip: the clip's first frame shows the source frame that was under the playhead; the edit is
 *     exactly k frames shorter; every later main-track clip and its linked sound moved by −k; music, a title and a marker did not.
 *  R2 the same for W at the tail. R3 Ctrl+Z after each returns the exact document hash.
 *  R4 a J-cut partner that would land before 0 refuses Q with the trim wording (never Delete's); the hash is unchanged.
 *  R5 six stills selected, D, `5s` at 30000/1001: each is 150 frames, the row is contiguous, one transaction, one undo (lengthening).
 *  R6 `00:00:10:00` at 29.97 → frame 300, `1:10` → 2098, `+12` and `-1:00` relative, a bare `90` → 90; `0.5f` and `abc` are
 *     refused in words and nothing moves.
 *  R7 ripple-delete.golden.json, recorded at 91078dc before the extraction, replays identically.
 *  R8 Q, W, G, D, Ctrl+Alt+V, Ctrl+F, Ctrl+S run their commands under a Hebrew layout (physical codes); no editing one fires while
 *     typing or behind a dialog; Ctrl+S with the cursor in a title field opens the name field and commits nothing.
 * Paste attributes
 *  P1 a grade copied to five clips: each target's colour effects equal the source's (compared without ids); a target's still is
 *     byte-identical to the still after adding that effect by hand.
 *  P2 a mixed selection (video, title, sound, caption, a clip on a locked track): the dialog's rows equal the commit's applied and
 *     skipped; every skipped row carries the underlying op's code; one transaction; undo returns the exact hash.
 *  P3 animation: keys past the target's end are left out and counted; the pasted curves equal the source's bit for bit;
 *     `pnpm baseline:keys --check` reports 0 differences.
 *  P5 a source without effects never removes a target's effects. P6 craft-fuzz holds every invariant; undo/redo/replay through the store.
 *  P7 a light.strobe and a turning-back brightness curve pasted to five clips: the strobe's parameters equal the source's, the curve
 *     is skipped with the underlying op's code, and the flash check of the range gives the verdict of the same effect added by hand.
 *  P8 «מיקום וגודל» onto a clip with position keys and «אנימציה» unticked is skipped as target_animated; with both, keys replaced.
 * Find and replace
 *  F1 «נעה» → «נועה» over titles, cues, phrases and one format wording: the count equals the planted count; an unticked match is
 *     untouched; one transaction; undo returns the exact hash.
 *  F2 «שלום» finds «שָׁלוֹם» with marks ignored and not otherwise; after replacing, no mark is left without its letter.
 *  F3 «מלכ» finds «מלך» with final letters equal and not otherwise. F4 whole word «ילד» finds neither «ילדים» nor «הילד».
 *  F5 `name` finds nothing inside {name:…}; the title's fields still resolve.
 *  F6 a cue with word timing keeps it when the word count is unchanged and loses it (and is listed) when it changes.
 *  F7 an edit between preview and Enter gives «הפרויקט השתנה — בדקו שוב» and commits nothing.
 *  F8 findReplace.golden.json (200+ cases) gives identical output in Node and in headless Chromium.
 *  F9 a reviewed translation's reworded line returns to needs-review and is listed before the commit.
 *  F10 with a clip selected and focus in the result list, Q, D, Delete and Space leave the document hash and the playhead unchanged.
 *  F11 an assistant proposal holding replace_text is refused (the op is not offered).
 * Versions
 *  V1 a saved version's copy equals replay(revision) and the current document (canonical form).
 *  V2 frame N of version A is byte-identical to the still taken before later edits; B equals the current still; past A's end
 *     answers version_frame_out_of_range.
 *  V3 after known edits (a clip 12 frames shorter, one deleted, a title reworded, an effect added) the counts and names say exactly
 *     that, in Hebrew and in English.
 *  V4 restore: the edit entities equal the version's; a file imported later is still in the library; one transaction; Ctrl+Z
 *     returns the hash from before the restore.
 *  V5 a file removed after the version, storage clean-up run in between: restore brings it back and its bytes are still stored.
 *  V6 an observe credential lists and diffs and is refused save and restore; no planted birth date in any versions answer without
 *     the people scope; a clip-limited grant is refused restore.
 *  V7 deleting the project leaves no row of it in project_versions. V9 a backup lists the saved version when served.
 *  V10 a version saved before a region was added: an observe credential is refused its still; the owner's restore text names the
 *     region and needs confirmation; after restore the render cache of the project is empty.
 *  V11 the 51st save answers version_limit, an agent's 11th version_limit_agents; a full disk answers 507.
 * Interface
 *  U1 each of the four tools by keyboard only, in Hebrew and in English, with dir checked on lists and time fields.
 *  U2 pnpm audit:a11y with four new states (time field, paste dialog, find panel with matches, versions compare): 0 findings.
 *  U3 pnpm audit:testids: 0 lost, the new ids listed.
 * Must stay green: pnpm test, proof:phase3, proof:editor-interactions, proof:command-bar, proof:phase6, proof:phase12,
 * proof:phase5, proof:owner-ui, baseline:keys --check, audit:a11y, audit:testids.
 * Not provable here (the owner's laptop): the Hebrew read by a Hebrew speaker; Ctrl+S / Ctrl+F in the real browser; Ctrl+Alt+V
 * on a physical Hebrew keyboard (AltGr); how long two stills take there; find and replace on real recognised captions.
 */
import { CRAFT_PROOF_OPS } from './craft-proof.ops.ts';
import { CRAFT_PROOF_VERSIONS } from './craft-proof.versions.ts';
import { CRAFT_PROOF_UI } from './craft-proof.ui.ts';

/** One part of the proof: built or not, and its checks (id → run). Each run returns true (pass) or a failure sentence. */
export interface CraftProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }
const parts = { ops: CRAFT_PROOF_OPS, versions: CRAFT_PROOF_VERSIONS, ui: CRAFT_PROOF_UI };
const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
if (pending.length) {
  console.error(`craft-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
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
