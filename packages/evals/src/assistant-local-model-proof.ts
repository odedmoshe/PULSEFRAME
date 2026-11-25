/**
 * pnpm proof:assistant-local-model — OPTIONAL, against the owner's REAL local model (wave 7 assistant track;
 * .artifacts/wave7/assistant-decisions.md §4–§6). For the owner's laptop only: nothing on the cloud container runs a model, and no
 * test in the repository depends on one. It exits 2 (blocked) when nothing answers on 127.0.0.1:${PF_ASSISTANT_LOCAL_PORT ?? 8791}.
 * BUILDER A: the body (it runs the 51 fixtures of packages/evals/fixtures/assistant-local-fixtures.json through the real adapter and
 * the scorer, assistant-local-score.ts). Its evidence file holds fixture ids, the designer's fixture text, the answers, the phrases,
 * the timings and the model name only: never a path under the owner's profile, never the server's log. Every number is labelled
 * "one machine, one run"; no quality threshold is a pass.
 */
export const ASSISTANT_LOCAL_MODEL_PROOF_BUILT = false;
export const ASSISTANT_LOCAL_MODEL_CHECKS: Readonly<Record<string, string>> = {
  M0: 'nothing answers on 127.0.0.1 at the port: exit 2 with the sentence of local_not_running, nothing measured',
  M1: 'GET /health answers 200 and GET /v1/models names a model; the name is recorded (basename only)',
  M2: 'every one of the 51 fixtures gets an HTTP 200 reply whose message parses under core LocalAnswerSchema (the stand-in\'s shape matches the real server\'s)',
  M3: 'no fixture of group D (nothing to propose) yields a phrase whose grammar result is a plan (wouldChange count is reported, and any such fixture is listed by id)',
  M4: 'the report lists intentMatch, slotsMatch, droppedUngrounded and the warm wall-time median and maximum, labelled one machine, one run',
};

if (!ASSISTANT_LOCAL_MODEL_PROOF_BUILT) {
  console.error(`assistant-local-model-proof: not built yet; ${Object.keys(ASSISTANT_LOCAL_MODEL_CHECKS).length} checks pending; nothing was measured`);
  process.exit(2);
}
