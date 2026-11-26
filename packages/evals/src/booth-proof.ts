/**
 * pnpm proof:booth — «תא הבדיקה» and «בדיקת המחשב» (wave 8 booth track; .artifacts/wave8/booth-plan.md §5 as corrected by
 * booth-verify.md). LEAD: the entry point and the list of checks. Built in two parts: booth-proof.server.ts (W1: B1–B11) and
 * booth-proof.ui.ts (W3: B12–B14, with W2's picture and mic cards). Integration imports both here. Needs `pnpm build`; CPU only.
 * States, each counted on its own: pass; partial (a part could not be measured here: never a pass); blocked (could not run here, with
 * the reason); fail; pending (not built yet). Exit 0 only when every check passes, 1 on any failure, 2 otherwise.
 * Fixtures are SYNTHETIC, made in the proof and deleted after: a temporary data dir, a project with an asset named
 * `נועה-גן-2026.mp4` (ffmpeg testsrc, 1 s), a person «נועה» with a birth date, a library root, planted paths (a home path with a
 * space, a forward-slash path, a OneDrive-style folder). Nobody here can see or hear: every check is a measurement or an equality.
 */
export const BOOTH_PROOF_BUILT = false;
export const BOOTH_CHECKS_PROOF: Readonly<Record<string, string>> = {
  B1: 'the registry has one item per catalogue member it covers and a BOOTH_LATER row with a reason for each member it does not; ids unique; the first sitting is exactly 14 cards',
  B2: 'recipes are equal across two server starts; a labelled synthetic registry with one changed SFX graph changes only that item\'s recipe; the SFX recipe holds the ffmpeg version line',
  B3: 'for all six styles the booth audio bytes have the sha256 of music.golden.json and equal GET /api/v1/music/:id/audio?bars=8&seed=1 (x-pf-expected-match 1)',
  B4: 'an SFX item\'s booth audio equals GET /api/v1/sfx/:id/audio byte for byte',
  B5: 'agent, observer and propose credentials get 403 owner_required on every booth route, GET included and a PUT with an invalid body; no booth path in DROP_ROUTES; no MCP booth tool',
  B6: 'PUT ok and PUT bad store rows; GET /api/v1/music labels are unchanged (the booth changes no product label); the report lists the bad one',
  B7: 'a row whose recipe no longer matches is changed and counted unanswered; a PUT with an old recipe gets 409 booth_stale_recipe; a picture on another adapter is changed with booth.changed.adapter',
  B8: 'music-kits-heard.json and its route are untouched (proof:instruments I16/I17 still pass); the kit is a self-check row only',
  B9: 'owner-review.json is mode 0600 where the OS has modes, written atomically, in no project document, no archive and no backup destination',
  B10: 'the report contains none of the planted values (data dir, user, host, project, asset name, «נועה», birth date, loopback and LAN address, agent token, library root, home path with a space, C:/ path, OneDrive folder); a planted note comes out scrubbed; parseBoothBlock round-trips; a bidi mark or one changed character is refused',
  B11: 'every server row answers within its timeout with a BoothCheckRowSchema row: export-gpu reports a software adapter or none and never ok on it; ffmpeg has its version line and h264_nvenc false; library setup; heavy rows skipped while an export runs',
  B12: 'UI: the booth button exists only in the owner\'s session; keyboard only: open from the rail, the first screen says «חלק ראשון: 0 מתוך 14», run the check, Space plays (currentTime advances — measured, not heard), Digit1 answers, Escape closes and focus returns to rail-booth',
  B13: 'UI, flash: a light-changing GPU card starts as a still, plays with no light rise closer than 1/3 s by the guard\'s own counter; under reduced motion no animation frame is drawn',
  B14: 'UI: «העתקת הדוח» puts exactly the box\'s text on the clipboard',
};
export type BoothProofStatus = 'pass' | 'partial' | 'blocked' | 'fail' | 'pending';

function main(): void {
  const rows = Object.keys(BOOTH_CHECKS_PROOF).map((id) => ({ id, part: Number(id.slice(1)) >= 12 ? 'ui' : 'server', status: 'pending' as BoothProofStatus }));
  for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(4)} [${r.part}] ${BOOTH_CHECKS_PROOF[r.id]}`);
  console.log(`\n${rows.length} checks pending; nothing built yet (wave 8 booth pre-pass). Exit 2.`);
  process.exitCode = 2;
}
main();
