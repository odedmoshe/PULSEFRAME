/**
 * pnpm proof:library — the content library on disk (wave 7 library track; .artifacts/wave7/library-decisions.md §4). LEAD: the
 * entry point and the list of checks. Each worker owns one part file and builds its checks there:
 *   library-proof.server.ts (worker A: 1–11, 16, 18) · library-proof.duties.ts (worker B: 12–15) · library-proof.ui.ts (worker C: 17).
 * Until every part is built it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Fixtures are SYNTHETIC LIBRARY only, made by the proof in a temp folder (library-fixtures.ts, worker A): tones and a whoosh by
 * ffmpeg, a test-pattern PNG, an Iconify-shaped set, a Fluent-shaped folder, a pieces.json-shaped file, an unsafe SVG; the ledger
 * written by tools/library/fetch.mjs run() against a loopback server (insecureOk, tests only), then tampered. No downloaded file and
 * no owner clip is ever used. Writes docs/evidence/library-proof.json when built.
 *
 *  1 no root: status not_configured, items/use 409 library_not_configured, tabs «הספרייה לא מוגדרת», 0 non-loopback connects.
 *  2 agent PUT root 403; owner → ready with per-kind counts equal to the fixture's; root inside the data dir 400; missing folder,
 *    missing ledger, ledgerVersion 2 → their states; after each the previous index answers the same query with the same keys.
 *  3 «חנוכיה», «החנוכיה», «חֲנֻכִּיָּה», "menorah" give the same first key; bpm 100–130 gives exactly the 120 BPM row; credit=none
 *    hides every CC BY row; the same query twice gives identical key lists.
 *  4 audio Range 100-199 → 206 with exactly those bytes; an m4a row and a non-audio row → 415.
 *  5 use a track: contentHash = ledger sha256; record = row record; clip at the asked frame; undo removes the clip, keeps the
 *    asset; exported WAV onset within one frame of the clip start.
 *  6 a file uploaded by hand earlier, then used: asset count unchanged, recordAttached true.
 *  7 wrong-hash file item → 409 library_hash_mismatch, touched tree file → 409 library_changed_since_index, `..` and link rows →
 *    409 library_path_escape; blob, asset and job counts unchanged; the planted outside file is never opened (fs.open spy).
 *  8 MIT icon set rows: nonCommercial false, shareable false; CC-BY-NC, GPL and `ri` sets: 0 rows; personalOnly row badge
 *    «לשימוש לא מסחרי בלבד»; incompetech-shaped row credit begins with its track title.
 *  9 ND, unknown-custom and animated rows listed with reason; use → 409 library_item_unusable with it; a hand-built
 *    use_library_item with an ND record → core licence_no_derivatives.
 * 10 Fluent 3D PNG used without rasteriser → image hasAlpha at 256×256, a still shows ink in the clip box; red icon centre R≥200
 *    (BLOCKED, exit 2, without librsvg); unsafe SVG → 422 svg_unsafe with the ffmpeg spawn counter unchanged.
 * 11 no library response is image/svg+xml; thumbs are image/png with DATA_CSP.
 * 12 credits: each required line exactly once in timeline order; CC0 absent; removing the clip removes its line;
 *    credit_not_on_screen for the creditInExport row, its fix (add_credits_card) clears it; a still of the card has ink; undo
 *    restores the document hash; export not blocked; job output descriptionText = sidecar = collectCredits(...).descriptionText('he').
 * 13 CC-BY icon set credit names its author; a CC-BY row without credit → credit_missing, use 409.
 * 14 archive: restricted asset, no choice → 409 archive_needs_library_choice; strip omits exactly the restricted blobs and lists
 *    them; import elsewhere opens with them in missing-media and the note in he and en; keep → 403 agent, all blobs for owner; a
 *    project without library content gives the same bytes with library=strip as without the parameter.
 * 15 a backup of a data dir holding library.json and library-index.sqlite holds neither.
 * 16 MCP use_library_item in propose mode 403; get_credits = REST credits; restart mid-index → ready with full counts; cancel keeps
 *    the previous counts.
 * 17 editor (he, en; 1280, 1440): audition aria-pressed true while playing, false after Escape; clipboard = descriptionText('he');
 *    zero overlapping boxes among LIBRARY_TESTIDS; the settings flow sets the root.
 * 18 recorded, not gated: index and query time on a generated 600,000-row ledger (one sample).
 * Not provable here (the helper runs them on the laptop, library-decisions.md §6): the real 500 GB root, librsvg on the laptop's
 * ffmpeg, real Hebrew words against real CLDR data, the owner's listening and looking, whether a platform releases a claim.
 */
import { LIBRARY_PROOF_SERVER } from './library-proof.server.ts';
import { LIBRARY_PROOF_DUTIES } from './library-proof.duties.ts';
import { LIBRARY_PROOF_UI } from './library-proof.ui.ts';

/** One part of the proof: built or not, and its checks (number → run). Each part's run returns true (pass) or a failure sentence. */
export interface LibraryProofPart { built: boolean; checks: Record<number, () => Promise<true | string>> }
const parts = { server: LIBRARY_PROOF_SERVER, duties: LIBRARY_PROOF_DUTIES, ui: LIBRARY_PROOF_UI };
const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
if (pending.length) {
  console.error(`library-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
  process.exit(2);
}
let failed = 0;
for (const [name, part] of Object.entries(parts)) {
  for (const [n, check] of Object.entries(part.checks)) {
    const r = await check();
    console.log(`${r === true ? 'PASS' : 'FAIL'} ${n} (${name})${r === true ? '' : `: ${r}`}`);
    if (r !== true) failed++;
  }
}
process.exit(failed ? 1 : 0);
