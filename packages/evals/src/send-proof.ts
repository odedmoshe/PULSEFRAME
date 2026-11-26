/**
 * pnpm proof:send — runs the three send proofs one after the other (fit, checks, loudness) and reports each one's exit, so a
 * failure in the first does not hide the others (wave 7, track send). Exit 1 when any failed, else 2 when any is blocked, else 0.
 * Run after `pnpm build`, `pnpm proof` and `pnpm proof:editor-interactions`: S13, K6 and L7d read those proofs' evidence and
 * are blocked when it was recorded before the bundle that is built now (send-evidence.ts).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const here = import.meta.dirname;
const parts = ['send-fit-proof.ts', 'send-checks-proof.ts', 'send-loudness-proof.ts'];
const results: { proof: string; exit: number | null; seconds: number }[] = [];
for (const p of parts) {
  const t = Date.now();
  console.log(`\n=== ${p} ===`);
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, p)], { stdio: 'inherit' });
  results.push({ proof: p, exit: r.status, seconds: Math.round((Date.now() - t) / 1000) });
}
const word = (x: number | null) => (x === 0 ? 'PASSED' : x === 2 ? 'BLOCKED' : `FAILED (exit ${x})`);
console.log('\nproof:send');
for (const r of results) console.log(`  ${r.proof.padEnd(24)} ${word(r.exit)}  ${r.seconds} s`);
const failed = results.some((r) => r.exit !== 0 && r.exit !== 2), held = results.some((r) => r.exit === 2);
process.exit(failed ? 1 : held ? 2 : 0);
