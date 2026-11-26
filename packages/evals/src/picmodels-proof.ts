/**
 * pnpm proof:picmodels — the local picture-model runtime and «הציעו עיניים» (wave 8 picmodels; picmodels-plan.md §5 as corrected by
 * picmodels-verify.md). LEAD: the entry point and the check list (picmodels-fixtures.ts PICMODELS_CHECKS). Each builder owns one part:
 *   picmodels-proof.server.ts (W1: E3, E5–E8, E10–E12 server side, R1, R2) · picmodels-proof.ui.ts (W3: E1, E2, E4, E9, E10, U1).
 * Until every part is built it runs nothing and exits 2 (blocked), the code the proofs use for "cannot run here", never a pass.
 * Everything runs with the LABELLED fake adapter (apps/server/src/picmodels/testdata/fake_pf_picture.py, «TEST-ADAPTER-picture/1»)
 * through the runtime's test seam, on SYNTHETIC drawn faces (picmodels-fixtures.ts), never a photograph. It proves the plumbing, never
 * the model: YuNet's real output, its quality on children's faces and its speed are laptop checks PM0–PM12 (pnpm proof:picmodels-real).
 * Must stay green: typecheck, test, audit:a11y, audit:testids, proof:growing, proof:search (search/workers.ts untouched),
 * proof:ai-local (pf_tools.py untouched), proof:editor-interactions.
 */
import { PICMODELS_CHECKS } from './picmodels-fixtures.ts';
import { PICMODELS_PROOF_SERVER } from './picmodels-proof.server.ts';
import { PICMODELS_PROOF_UI } from './picmodels-proof.ui.ts';

/** One part of the proof: built or not, and its checks (id of PICMODELS_CHECKS → run). Each run returns true (pass) or a failure sentence. */
export interface PicmodelsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }
const parts = { server: PICMODELS_PROOF_SERVER, ui: PICMODELS_PROOF_UI };
const pending = Object.entries(parts).filter(([, p]) => !p.built).map(([k]) => k);
if (pending.length) {
  console.error(`picmodels-proof: not built yet (parts pending: ${pending.join(', ')}); nothing was measured`);
  for (const [id, sentence] of Object.entries(PICMODELS_CHECKS)) console.error(`  ${id}  ${sentence}`);
  process.exit(2);
}
const covered = new Set(Object.values(parts).flatMap((p) => Object.keys(p.checks)));
const missing = Object.keys(PICMODELS_CHECKS).filter((id) => !covered.has(id));
if (missing.length) { console.error(`picmodels-proof: checks with no run: ${missing.join(', ')}`); process.exit(1); }
let failed = 0;
for (const [name, part] of Object.entries(parts)) {
  for (const [id, check] of Object.entries(part.checks)) {
    const r = await check();
    console.log(`${r === true ? 'PASS' : 'FAIL'} ${id} (${name})${r === true ? '' : `: ${r}`}`);
    if (r !== true) failed++;
  }
}
console.log(failed ? `picmodels-proof: ${failed} failed` : 'picmodels-proof: all checks passed (labelled test adapter; not a model)');
process.exit(failed ? 1 : 0);
