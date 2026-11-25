/**
 * pnpm proof:search — «חיפוש בצילומים», find it in your footage (wave 7 search track; .artifacts/wave7/search-decisions.md §4). LEAD: the
 * entry point and the list of checks. The checks are built in three parts, each owned by one builder: footage-search-proof.core.ts (A: S2,
 * S3 Node side, S9 numbers, S17, S18), footage-search-proof.server.ts (B: S1 server, S4–S8, S11–S16), footage-search-proof.ui.ts (C: S1
 * editor, S3 browser, S10, U1). The integration step imports them here and sets FOOTAGE_PROOF_BUILT. Until then it runs nothing and exits
 * 2 (blocked), the code the proofs use for "cannot run here", never a pass. `--server-only` (laptop step L7) runs the checks that need no
 * browser.
 * Fixtures are SYNTHETIC only, made by the proof with ffmpeg and the fixture generator's frame-index barcode: colours.mp4 (12 s: red, blue,
 * green, yellow, 3 s each, a white disc), colours2.mp4 (red with a square), VID_20241226_183000.mp4 (4 s; Hanukkah by the file-name date),
 * talk.mp4 with a typed transcript holding «בנרות», a still, invented people «אלף» and "Gimel". Never an owner's clip. The model is the
 * labelled TEST-DOUBLE-embedder/1 (hue × lightness bins and a 16-word colour table): it proves plumbing, never quality. The real model runs
 * only in pnpm proof:search-real (footage-search-real.ts), which exits 2 without PF_TOOLS_PYTHON and the seven pinned files.
 * Writes docs/evidence/footage-search-proof.json when built; one sample of each timing, never gated.
 */
export const FOOTAGE_PROOF_BUILT = false;
export const FOOTAGE_CHECKS: Readonly<Record<string, string>> = {
  S1: 'with no picture runtime a query returns the exact section and pictureState not_installed with its setup code; no picture row exists; the editor shows «החיפוש בתמונה לא מותקן» with its steps',
  S2: '«חנוכה 2024» returns exactly the VID_20241226 file; «נרות» returns the «בנרות» phrase with its exact rational word span',
  S3: '40 baseline queries give byte-identical JSON from the server (owner) and from window.__pfFootageSearch in Chromium',
  S4: 'an agent\'s answer has only assetId/start/end/sources keys with sources ⊂ name/date/event/transcript; a pearl named «תוויתסוד» tagged with «אלף» is found by the owner and by no agent (people full included); no agent answer or refusal byte holds the label or the query',
  S5: 'a range-restricted grant gets 403 out_of_scope; a grant for project A cannot search B; index status, scan and forget answer 403 owner_required to every agent and the observer; MCP lists find_in_footage and no other search tool',
  S6: 'a scan with the test double ends succeeded as a durable job; per file the stored frames equal sampleFrameTargets and the barcode read from each decoded frame',
  S7: 'a server restart mid-scan resumes; no file has partial rows; totals equal S6',
  S8: 'cancel stops at a batch boundary and the unfinished file has no rows; an export started during the scan finishes before the next batch',
  S9: '«כחול» ranks colours.mp4 first with the span exactly [2 s, 6 s] snapped outward to project frames',
  S10: '«הכנס במקום הסמן» from a row is one commit placing exactly that span; one undo restores the document hash',
  S11: 'remove_asset of a file no other project holds deletes its rows; a planted vector byte pattern is absent from index.sqlite and its WAL; undo shows «צריך לסרוק»; project delete and storage clean-up do the same; a removal during that file\'s scan leaves no rows',
  S12: 'the backup output holds no search/ folder; a project archive holds no index bytes',
  S13: 'a planted unique query string appears in no file of the data dir, the tmp dir, or any server log line',
  S14: 'setup is exact: PF_TOOLS_PYTHON unset → engine_not_configured; Python without transformers → engine_not_working naming it; model absent → model_missing with 1,539,637,736 bytes; one changed byte → model_missing; never ready without the verified seven',
  S15: 'a scan holds the lane only under local.search.picture …; a local-tool job run during a scan completes; a query during a scan answers; scan totals unchanged',
  S16: 'a vector of wrong length, with NaN or not of unit length fails the file (job) or the query (502) and nothing is shown',
  S17: 'a query that matches nothing answers both sections empty with «לא נמצא דבר»; nothing below the relevance floor is shown',
  S18: 'ranking of 200,000 random int8 vectors timed once (recorded, not gated)',
  U1: 'the flows by keyboard only in Hebrew and English (ArrowDown, Enter, Shift+Enter, Escape), RTL without overlap at 1280 and 1440 px; new states in audit:a11y; ids in audit:testids',
};

if (!FOOTAGE_PROOF_BUILT) {
  console.error(`footage-search-proof: not built yet; ${Object.keys(FOOTAGE_CHECKS).length} checks pending (${Object.keys(FOOTAGE_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
