/**
 * pnpm proof:assistant-local — the LOCAL language assistant on this CPU container against a labelled STAND-IN of llama.cpp's server
 * (wave 7 assistant track; .artifacts/wave7/assistant-decisions.md §4). No model runs here: every check is about the editor's own
 * behaviour (loopback only, grammar first, grounding, no money, privacy at rest, honest states), never about the quality of a model.
 * LEAD: the entry point and the checks. Parts: assistant-local-proof.server.ts (builder B: L1–L12, L14, L15) and
 * assistant-local-proof.ui.ts (builder C: L13), imported here (integration, wave 7). The stand-in runs in this process on an ephemeral
 * 127.0.0.1 port; the server under test on its own ephemeral port. Writes docs/evidence/assistant-local-proof.json.
 * Order: the server part's checks first (its first check installs L14's process-wide socket hook), then L13 (the browser part, its own
 * server, adapter and stand-in in this same process), then L14 last, so L14's "whole proof" counts L13's sockets too. Chromium's own
 * traffic is another process and is not counted by the hook. Exit 0 every check passed; 1 a check failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ASSISTANT_LOCAL_PROOF_SERVER, stopAssistantLocalProofServer } from './assistant-local-proof.server.ts';
import { ASSISTANT_LOCAL_PROOF_UI, stopAssistantLocalProofUi } from './assistant-local-proof.ui.ts';

export const ASSISTANT_LOCAL_PROOF_BUILT = ASSISTANT_LOCAL_PROOF_SERVER.built && ASSISTANT_LOCAL_PROOF_UI.built;
export const ASSISTANT_LOCAL_CHECKS: Readonly<Record<string, string>> = {
  L1: 'with the local adapter chosen and no port saved the owner\'s status is provider_not_configured; with a port it is ready; seven non-owner credentials read only connected, setup and detail (no port, no model name, no last check)',
  L2: 'PUT /assistant/config refuses a local block holding a host, a URL or a path with 400 and stores nothing; every URL the adapter dialled during the whole proof starts with http://127.0.0.1:',
  L3: 'with the adapter\'s connect check fed a socket whose remote address is 10.0.0.5 the job fails local_not_loopback and the stand-in received zero request bodies',
  L4: 'a request whose text the grammar reads («חתוך כאן») answers 409 grammar_understood, creates no job row and the stand-in receives nothing',
  L5: '«המוזיקה חזקה מדי, תורידי אותה בשש דציבל» with the stand-in answering gain_change {target music, dir down, db "6"} succeeds with phrase «הנמך את המוזיקה ב־6 דציבל», stages in the order sending, awaiting-local-model, checking, no budget_ledger row, and lane.busy().holder null afterwards',
  L6: 'the stand-in answering db "6" to «תורידי קצת את המוזיקה» gives dropped [{slot db, why ungrounded}], phrase «הנמך את המוזיקה», and interpret(phrase) is incomplete with missing amount',
  L7: 'every body the stand-in received holds no Authorization header, no cookie, no owner or agent token, and none of a planted track name, clip id or person name of the project',
  L8: 'answers that are not JSON, of the wrong shape, with an intent outside the vocabulary, or whose phrase the grammar cannot read each fail invalid_model_output with their category, and a planted word of the answer is absent from the job row',
  L9: 'with nothing listening on the port the job fails local_not_running with ASSISTANT_LOCAL_SENTENCES.local_not_running and its row holds no stack line (no "Error:", no "    at ")',
  L10: 'a stand-in answering 503 gives local_loading; one delaying past timeoutSeconds 5 gives local_timeout and its request count stays 1 (no retry)',
  L11: 'a cancel before the send ends canceled with attempt 0 and the stand-in received nothing; a cancel while it answers aborts its request; neither sentence holds a money word',
  L12: 'after taken (and separately after the next request, and after project delete) the job output has cleared true, phrase null and slots {}, and the planted title text is absent from the database file and its WAL',
  L13: 'in Chromium from the keyboard, Hebrew and English, RTL: an unknown request shows «לשאול את העוזר המקומי»; Enter, then «הכנס לשורה» puts the phrase in the input with the badge; the grammar preview shows; Enter commits exactly one transaction labelled Command bar: gain_change at the shown revision; intent none shows its sentence and no button',
  L14: 'during the whole proof no socket of this process connects to an address other than 127.0.0.1 (the server, the adapter and the stand-in counted by the same hook)',
  L15: 'ASSISTANT_PROMPT_DIGEST equals sha256:be49337a799f70911112f8f4ff4d92076eba11482beb047dccef90e68b3671c8 and assistantPrompt().digest equals it; localPrompt().digest equals ASSISTANT_LOCAL_PROMPT_DIGEST',
};

if (!ASSISTANT_LOCAL_PROOF_BUILT) {
  console.error(`assistant-local-proof: not built yet; ${Object.keys(ASSISTANT_LOCAL_CHECKS).length} checks pending (${Object.keys(ASSISTANT_LOCAL_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '../../..');
const OUT = path.join(root, 'docs/evidence/assistant-local-proof.json');
type Status = 'pass' | 'fail';
const order = [...Object.keys(ASSISTANT_LOCAL_CHECKS).filter((id) => id !== 'L13' && id !== 'L14'), 'L13', 'L14'];
const results: { id: string; name: string; status: Status; ms: number; why?: string }[] = [];
try {
  for (const id of order) {
    const run = ASSISTANT_LOCAL_PROOF_UI.checks[id] ?? ASSISTANT_LOCAL_PROOF_SERVER.checks[id];
    const t0 = Date.now();
    let r: true | string;
    try { r = run ? await run() : 'no part implements this check'; } catch (e) { r = `error: ${(e as Error)?.message ?? String(e)}`; }
    const status: Status = r === true ? 'pass' : 'fail';
    results.push({ id, name: ASSISTANT_LOCAL_CHECKS[id]!, status, ms: Date.now() - t0, ...(r === true ? {} : { why: r }) });
    console.log(`${status === 'pass' ? '  ok  ' : ' FAIL '} ${id} ${r === true ? '' : r.slice(0, 600)}`);
  }
} finally {
  await stopAssistantLocalProofUi().catch(() => {});
  await stopAssistantLocalProofServer().catch(() => {});
}
results.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
const counts = { pass: results.filter((r) => r.status === 'pass').length, fail: results.filter((r) => r.status === 'fail').length };
const result = counts.fail ? 'FAIL' : 'PASS';
fs.writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(),
  result,
  counts,
  scope: 'In-process servers on 127.0.0.1 and a labelled STAND-IN of llama.cpp\'s server (apps/server/src/assistant/local/standIn.ts) answering scripted JSON; headless Chromium for L13. NO MODEL RAN: every check is about the editor\'s own behaviour (loopback only, grammar first, grounding, no money, privacy at rest, honest states). Not proven here: a real llama-server, the quality of any model\'s Hebrew, its speed, a screen reader. Timings are one sample on a shared machine.',
  checks: results,
}, null, 2) + '\n');
console.log(`\nassistant-local proof ${result}: pass ${counts.pass}, fail ${counts.fail}. Evidence: docs/evidence/assistant-local-proof.json`);
process.exit(counts.fail ? 1 : 0);
