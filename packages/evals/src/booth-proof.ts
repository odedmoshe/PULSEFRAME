/**
 * pnpm proof:booth — «תא הבדיקה» and «בדיקת המחשב» (wave 8 booth track; .artifacts/wave8/booth-plan.md §5 as corrected by
 * booth-verify.md). LEAD: the entry point and the list of checks. Built in two parts: booth-proof.server.ts (W1: B1–B11) and
 * booth-proof.ui.ts (W3: B12–B14, with W2's picture and mic cards), both imported here (integration). Needs `pnpm build`; CPU only.
 * `--server` or `--ui` runs one part (no evidence file is written then); with no flag both run and docs/evidence/booth-proof.json is written.
 * States, each counted on its own: pass; partial (a part could not be measured here: never a pass); blocked (could not run here, with
 * the reason); fail; pending (not built yet). Exit 0 only when every check passes, 1 on any failure, 2 otherwise.
 * Fixtures are SYNTHETIC, made in the proof and deleted after: a temporary data dir, a project with an asset named
 * `נועה-גן-2026.mp4` (ffmpeg testsrc, 1 s), a person «נועה» with a birth date, a library root, planted paths (a home path with a
 * space, a forward-slash path, a OneDrive-style folder). Nobody here can see or hear: every check is a measurement or an equality.
 */
import fs from 'node:fs';
import path from 'node:path';

export const BOOTH_PROOF_BUILT = true;
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

interface ProofRow { id: string; part: 'server' | 'ui'; status: BoothProofStatus; check: string; sample: string }

async function main(): Promise<void> {
  // imported here, not at the top: booth-proof.server.ts imports BoothProofStatus from this file
  const { runBoothServerProof } = await import('./booth-proof.server.ts');
  const { runBoothUiProof } = await import('./booth-proof.ui.ts');
  const only = process.argv.includes('--server') ? 'server' : process.argv.includes('--ui') ? 'ui' : null;
  const rows: ProofRow[] = [];
  const t0 = Date.now();
  // one part at a time (one browser at a time on this machine): the server part, then the page
  if (only !== 'ui') for (const r of await runBoothServerProof()) rows.push({ id: r.id, part: 'server', status: r.status, check: BOOTH_CHECKS_PROOF[r.id] ?? '', sample: r.sample });
  if (only !== 'server') for (const r of await runBoothUiProof()) rows.push({ id: r.id, part: 'ui', status: r.status, check: BOOTH_CHECKS_PROOF[r.id] ?? '', sample: r.detail });
  for (const id of Object.keys(BOOTH_CHECKS_PROOF)) if (!rows.some((r) => r.id === id)) rows.push({ id, part: Number(id.slice(1)) >= 12 ? 'ui' : 'server', status: 'pending', check: BOOTH_CHECKS_PROOF[id]!, sample: only ? `not run (--${only})` : 'not run' });
  rows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(4)} [${r.part}] ${r.sample}`);
  const count = (st: BoothProofStatus) => rows.filter((r) => r.status === st).length;
  const summary = `${count('pass')} pass, ${count('partial')} partial, ${count('blocked')} blocked, ${count('fail')} fail, ${count('pending')} pending (of ${rows.length}); one sample each`;
  console.log(`\n${summary}`);
  if (!only) {
    const out = path.resolve(import.meta.dirname, '../../../docs/evidence/booth-proof.json');
    fs.writeFileSync(out, `${JSON.stringify({
      proof: 'proof:booth', date: new Date().toISOString().slice(0, 10), seconds: Math.round((Date.now() - t0) / 1000), summary,
      machine: 'the build container: 4 shared CPUs, no hardware GPU, no microphone, headless Chromium; nobody here hears or sees anything',
      rows,
    }, null, 2)}\n`);
    console.log(`evidence: ${path.relative(process.cwd(), out)}`);
  }
  process.exitCode = count('fail') ? 1 : count('pass') === rows.length ? 0 : 2;
}
await main();
// the render host, the MCP server and the browser may keep handles open
setTimeout(() => process.exit(process.exitCode), 1000).unref();
