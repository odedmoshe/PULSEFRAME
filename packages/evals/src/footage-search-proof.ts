/**
 * pnpm proof:search — «חיפוש בצילומים», find it in your footage (wave 7 search track; .artifacts/wave7/search-decisions.md §4). LEAD: the
 * entry point and the list of checks. The checks are built in three parts, each owned by one builder: footage-search-proof.core.ts (A: S2,
 * S3 Node side, S9 numbers, S17, S18), footage-search-proof.server.ts (B: S1 server, S4–S8, S11–S16), footage-search-proof.ui.ts (C: S1
 * editor, S3 browser, S10, U1). This entry point (integration, wave 7) runs every part of every check in number order, and adds the
 * halves only the integration run can do (footage-search-proof.integration.ts): S3 through the real route as the owner against Node,
 * and S8 with a REAL server export (Chromium renderer, FFmpeg) started while a scan runs — the part B runs with the lane's export flag
 * stays as well. Exit 0 every check passes, 1 a failure, 2 only blocked ones besides passes ("cannot run
 * here", never a pass). `--server-only` (laptop step L7) runs the checks that need no browser (the core and server parts).
 * Fixtures are SYNTHETIC only, made by the proof with ffmpeg and the fixture generator's frame-index barcode: colours.mp4 (12 s: red, blue,
 * green, yellow, 3 s each, a white disc), colours2.mp4 (red with a square), VID_20241226_183000.mp4 (4 s; Hanukkah by the file-name date),
 * talk.mp4 with a typed transcript holding «בנרות», a still, invented people «אלף» and "Gimel". Never an owner's clip. The model is the
 * labelled TEST-DOUBLE-embedder/1 (hue × lightness bins and a 16-word colour table): it proves plumbing, never quality. The real model runs
 * only in pnpm proof:search-real (footage-search-real.ts), which exits 2 without PF_TOOLS_PYTHON and the seven pinned files.
 * Writes docs/evidence/footage-search-proof.json when built; one sample of each timing, never gated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOTAGE_PROOF_CORE } from './footage-search-proof.core.ts';
import { closeFootageProofServer, FOOTAGE_PROOF_SERVER } from './footage-search-proof.server.ts';
import { closeFootageProofUi, FOOTAGE_PROOF_UI } from './footage-search-proof.ui.ts';
import { closeFootageProofIntegration, FOOTAGE_PROOF_INTEGRATION } from './footage-search-proof.integration.ts';

export const FOOTAGE_PROOF_BUILT = true;

export const FOOTAGE_CHECKS: Readonly<Record<string, string>> = {
  S1: 'with no picture runtime a query returns the exact section and pictureState not_installed with its setup code; no picture row exists; the editor shows «החיפוש בתמונה לא מותקן» with its steps',
  S2: '«חנוכה 2024» returns exactly the VID_20241226 file; «נרות» returns the «בנרות» phrase with its exact rational word span',
  S3: '40 baseline queries give byte-identical JSON from the server (owner), from core in Node and from window.__pfFootageSearch in Chromium',
  S4: 'an agent\'s answer has only assetId/start/end/sources keys with sources ⊂ name/date/event/transcript; a pearl named «תוויתסוד» tagged with «אלף» is found by the owner and by no agent (people full included); no agent answer or refusal byte holds the label or the query',
  S5: 'a range-restricted grant gets 403 out_of_scope; a grant for project A cannot search B; index status, scan and forget answer 403 owner_required to every agent and the observer; MCP lists find_in_footage and no other search tool',
  S6: 'a scan with the test double ends succeeded as a durable job; per file the stored frames equal sampleFrameTargets and the barcode read from each decoded frame',
  S7: 'a server restart mid-scan resumes; no file has partial rows; totals equal S6',
  S8: 'cancel stops at a batch boundary and the unfinished file has no rows; an export started during the scan finishes before the next batch (server part: the lane\'s export flag as export.ts sets it; integration part: a real server export of a short timeline, rendered by Chromium and encoded by FFmpeg, during a real scan)',
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_ONLY = process.argv.includes('--server-only');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  type Part = { built: boolean; checks: Record<string, () => Promise<true | string>> };
  const parts: Record<string, Part> = SERVER_ONLY
    ? { core: FOOTAGE_PROOF_CORE, server: FOOTAGE_PROOF_SERVER }
    : { core: FOOTAGE_PROOF_CORE, server: FOOTAGE_PROOF_SERVER, ui: FOOTAGE_PROOF_UI, integration: FOOTAGE_PROOF_INTEGRATION };
  const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
  if (!FOOTAGE_PROOF_BUILT || pending.length) {
    console.error(`footage-search-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
    process.exit(2);
  }
  // the server part captures console.* while its world lives (S13 reads every log line for the planted query): write to stdout directly
  const say = (line: string) => { process.stdout.write(`${line}\n`); };
  const results: { check: string; part: string; verdict: 'PASS' | 'BLOCKED' | 'FAIL'; seconds: number; reason?: string }[] = [];
  const ids = Object.keys(FOOTAGE_CHECKS).filter((id) => !SERVER_ONLY || id !== 'U1');
  try {
    for (const id of ids) {
      for (const [name, part] of Object.entries(parts)) {
        const run = part.checks[id];
        if (!run) continue;
        const t0 = Date.now();
        let r: true | string;
        try { r = await run(); } catch (e) { r = `threw: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; }
        const verdict = r === true ? 'PASS' : r.startsWith('BLOCKED') ? 'BLOCKED' : 'FAIL';
        const seconds = Math.round((Date.now() - t0) / 100) / 10;
        say(`${verdict} ${id} (${name}, ${seconds} s)${r === true ? '' : `: ${r}`}`);
        results.push({ check: id, part: name, verdict, seconds, ...(r === true ? {} : { reason: r.slice(0, 2000) }) });
      }
      if (!results.some((x) => x.check === id)) results.push({ check: id, part: 'none', verdict: 'FAIL', seconds: 0, reason: 'no part runs this check' });
    }
  } finally {
    await closeFootageProofServer();
    if (!SERVER_ONLY) { await closeFootageProofUi(); await closeFootageProofIntegration(); }
  }
  const count = (v: string) => results.filter((x) => x.verdict === v).length;
  const code = count('FAIL') ? 1 : count('BLOCKED') ? 2 : 0;
  const byCheck = ids.map((id) => { const rs = results.filter((x) => x.check === id); return rs.some((x) => x.verdict === 'FAIL') ? 'FAIL' : rs.some((x) => x.verdict === 'BLOCKED') ? 'BLOCKED' : 'PASS'; });
  const checksPassed = byCheck.filter((v) => v === 'PASS').length;
  say(`footage-search-proof${SERVER_ONLY ? ' (server only)' : ''}: ${checksPassed}/${byCheck.length} checks pass (${count('PASS')} pass, ${count('BLOCKED')} blocked, ${count('FAIL')} fail of ${results.length} parts; exit ${code})`);
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'evidence', f), 'utf8')); } catch { return null; } };
  if (!SERVER_ONLY) {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'footage-search-proof.json'), JSON.stringify({
      when: new Date().toISOString(), exit: code, checksPassed, checks: byCheck.length, results,
      evidence: { core: FOOTAGE_PROOF_CORE.evidence, server: read('footage-search-proof.server.json')?.evidence ?? null, ui: read('footage-search-proof.ui.json')?.evidence ?? null, integration: FOOTAGE_PROOF_INTEGRATION.evidence },
      note: 'SYNTHETIC fixtures only (made by the proof); the picture model is the labelled TEST-DOUBLE-embedder/1 (plumbing, never quality); timings are one sample each on a shared machine',
    }, null, 1) + '\n');
  }
  process.exit(code);
}
