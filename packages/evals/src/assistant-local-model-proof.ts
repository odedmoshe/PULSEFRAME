/**
 * pnpm proof:assistant-local-model — OPTIONAL, against the owner's REAL local model (wave 7 assistant track;
 * .artifacts/wave7/assistant-decisions.md §4–§6). For the owner's laptop only: nothing on the cloud container runs a model, and no
 * test in the repository depends on one. It exits 2 (blocked) when nothing answers on 127.0.0.1:${PF_ASSISTANT_LOCAL_PORT ?? 8791}.
 *
 * It contacts ONLY http://127.0.0.1:<port> (providers localModelUrl: three fixed paths), with node:http (no proxy, no redirect),
 * checks the socket's remote address before a byte is written (isLoopbackRemote), sends no key, downloads nothing and starts no
 * process. Each of the 51 fixtures of packages/evals/fixtures/assistant-local-fixtures.json whose text the grammar does not read is
 * sent once with the reviewed local prompt (apps/server localPrompt.ts buildLocalRequest, the body providers llamaChatBody), and its
 * answer is scored (assistant-local-score.ts). GRAMMAR fixtures are never sent (the server refuses them with grammar_understood).
 *
 * Its evidence file (docs/evidence/assistant-local/<date>-<model>.json) holds fixture ids, the designer's fixture text, the answers,
 * the phrases, the timings and the model name only: never a path under the owner's profile, never the server's log. Every number is
 * labelled "one machine, one run"; no quality threshold is a pass. Exit: 2 blocked (M0), 1 when M1, M2 or M3 fails, 0 otherwise.
 *
 *   PF_ASSISTANT_LOCAL_PORT=8791 PF_ASSISTANT_LOCAL_TIMEOUT=60 pnpm proof:assistant-local-model [-- --no-evidence]
 */
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { barUnderstands } from '@pulseframe/core';
import { isLoopbackRemote, llamaChatBody, localModelName, localModelUrl, parseLlamaReply, type LocalModelPath } from '@pulseframe/providers';
import { buildLocalRequest } from '@pulseframe/server/assistant/localPrompt.ts';
import { checkLocalFixtures, scoreLocalAnswer, summarizeLocalScores, type LocalFixture, type LocalScoreRow } from './assistant-local-score.ts';

export const ASSISTANT_LOCAL_MODEL_PROOF_BUILT = true;
export const ASSISTANT_LOCAL_MODEL_CHECKS: Readonly<Record<string, string>> = {
  M0: 'nothing answers on 127.0.0.1 at the port: exit 2 with the sentence of local_not_running, nothing measured',
  M1: 'GET /health answers 200 and GET /v1/models names a model; the name is recorded (basename only)',
  M2: 'every one of the 51 fixtures gets an HTTP 200 reply whose message parses under core LocalAnswerSchema (the stand-in\'s shape matches the real server\'s)',
  M3: 'no fixture of group D (nothing to propose) yields a phrase whose grammar result is a plan (wouldChange count is reported, and any such fixture is listed by id)',
  M4: 'the report lists intentMatch, slotsMatch, droppedUngrounded and the warm wall-time median and maximum, labelled one machine, one run',
};

const NOT_RUNNING = { he: 'העוזר המקומי לא פועל כרגע; הפעילו אותו לפי המדריך «עוזר שפה מקומי» ובקשו שוב', en: 'The local assistant is not running; start it as the guide says, then ask again' };
const LABEL = 'one machine, one run';
const MAX_REPLY = 64 * 1024;

interface Reply { status: number; body: string }
/** One call on 127.0.0.1: the request is written only after the socket's remote address is checked. 'refused' when nothing listens. */
function call(port: number, path: LocalModelPath, method: 'GET' | 'POST', body: string | null, timeoutMs: number): Promise<Reply | 'refused' | 'timeout' | 'not_loopback'> {
  return new Promise((resolve) => {
    const url = new URL(localModelUrl(port, path));
    let done = false;
    const finish = (v: Reply | 'refused' | 'timeout' | 'not_loopback') => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = http.request({
      host: url.hostname, port: url.port, path: url.pathname, method, agent: false,
      headers: body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_REPLY) { req.destroy(); finish({ status: 0, body: '' }); return; } chunks.push(c); });
      res.on('end', () => finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    const timer = setTimeout(() => { req.destroy(); finish('timeout'); }, timeoutMs);
    req.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ECONNREFUSED' ? 'refused' : 'timeout'));
    req.on('socket', (s) => {
      const go = () => {
        if (!isLoopbackRemote(s.remoteAddress)) { req.destroy(); finish('not_loopback'); return; }
        req.end(body ?? undefined);
      };
      if (s.connecting) s.once('connect', go); else go();
    });
  });
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null; };

async function main(): Promise<number> {
  const port = Number(process.env.PF_ASSISTANT_LOCAL_PORT ?? 8791);
  const timeoutMs = Number(process.env.PF_ASSISTANT_LOCAL_TIMEOUT ?? 60) * 1000;
  const fixtures = (JSON.parse(readFileSync(new URL('../fixtures/assistant-local-fixtures.json', import.meta.url), 'utf8')) as { fixtures: LocalFixture[] }).fixtures;
  checkLocalFixtures(fixtures);

  // M0 / M1
  const health = await call(port, '/health', 'GET', null, 5000);
  if (health === 'refused' || health === 'timeout') {
    console.error(`M0 blocked: nothing answers on 127.0.0.1:${port}. ${NOT_RUNNING.he} / ${NOT_RUNNING.en}. Nothing was measured.`);
    return 2;
  }
  if (health === 'not_loopback') { console.error('M0: the socket was not 127.0.0.1; nothing was written'); return 1; }
  const models = await call(port, '/v1/models', 'GET', null, 5000);
  let model: string | null = null;
  if (typeof models === 'object' && models.status === 200) {
    try { const m = JSON.parse(models.body) as { data?: { id?: unknown }[] }; model = localModelName(m.data?.[0]?.id); } catch { model = null; }
  }
  const m1 = health.status === 200 && model !== null;
  console.log(`M1 ${m1 ? 'ok' : 'FAILED'}: /health ${health.status}, model ${model ?? '(none named)'}`);
  if (health.status === 503) { console.error('the local server is still loading its model; run the proof again when it has loaded'); return 1; }
  if (!m1) return 1;

  // M2: every fixture the grammar does not read, once
  const rows: LocalScoreRow[] = [];
  const shapeFailures: string[] = [];
  const answers: Record<string, string | null> = {};
  for (const f of fixtures) {
    if (f.expect === 'GRAMMAR' || barUnderstands(f.text)) { rows.push(scoreLocalAnswer(f, null, null)); continue; }
    const body = JSON.stringify(llamaChatBody(buildLocalRequest(f.text)));
    const t0 = performance.now();
    const r = await call(port, '/v1/chat/completions', 'POST', body, timeoutMs);
    const wallMs = Math.round(performance.now() - t0);
    let text: string | null = null;
    if (typeof r === 'object' && r.status === 200) {
      try { const reply = parseLlamaReply(JSON.parse(r.body)); text = reply && reply.finish === 'stop' ? reply.text : null; } catch { text = null; }
    }
    answers[f.id] = text;
    const row = scoreLocalAnswer(f, text, wallMs);
    if (!row.valid) shapeFailures.push(`${f.id} (${typeof r === 'object' ? `HTTP ${r.status}` : r})`);
    rows.push(row);
    console.log(`${f.id} ${row.valid ? row.outcome : 'invalid'} ${wallMs} ms ${row.phrase ?? ''}`);
  }
  const m2 = shapeFailures.length === 0;
  console.log(`M2 ${m2 ? 'ok' : 'FAILED'}: ${shapeFailures.length ? `not a valid answer: ${shapeFailures.join(', ')}` : 'every reply parsed'}`);

  // M3: group D proposes no edit
  const s = summarizeLocalScores(fixtures, rows);
  const dChanges = s.wouldChange.filter((id) => id.startsWith('D'));
  const m3 = dChanges.length === 0;
  console.log(`M3 ${m3 ? 'ok' : 'FAILED'}: group D phrases that would edit the project: ${dChanges.length ? dChanges.join(', ') : 'none'}; all fixtures that would edit unexpectedly: ${s.wouldChange.join(', ') || 'none'}`);

  // M4: the report (counts and times, labelled; no threshold)
  const timed = rows.filter((r) => r.wallMs !== null).map((r) => r.wallMs!);
  const warm = timed.slice(1);
  console.log(`M4 (${LABEL}): sent ${s.sent}, valid ${s.valid}, intentMatch ${s.intentMatch}, slotsMatch ${s.slotsMatch}, guessed ${s.guessed}, droppedUngrounded ${s.droppedUngrounded}, none ${s.noneHandled}/${s.noneExpected}, no phrase ${s.noPhrase.length}; first request ${timed[0] ?? '-'} ms, warm median ${median(warm) ?? '-'} ms, max ${warm.length ? Math.max(...warm) : '-'} ms`);

  if (!process.argv.includes('--no-evidence')) {
    const date = new Date().toISOString().slice(0, 10);
    const dir = new URL('../../../docs/evidence/assistant-local/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    const safe = (model ?? 'model').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    const out = new URL(`${date}-${safe}.json`, dir);
    writeFileSync(out, `${JSON.stringify({
      label: `${LABEL}; designer-written fixtures; not a measure of how the owner speaks`, date, model, port, checks: { M1: m1, M2: m2, M3: m3 },
      summary: s, rows: rows.map((r) => ({ id: r.id, text: fixtures.find((f) => f.id === r.id)!.text, answer: answers[r.id] ?? null, outcome: r.outcome, phrase: r.phrase, intentMatch: r.intentMatch, slotsMatch: r.slotsMatch, guessed: r.guessed, droppedUngrounded: r.droppedUngrounded, wouldChange: r.wouldChange, wallMs: r.wallMs })),
    }, null, 1)}\n`);
    console.log(`evidence: docs/evidence/assistant-local/${date}-${safe}.json`);
  }
  return m1 && m2 && m3 ? 0 : 1;
}

main().then((code) => process.exit(code), (e: unknown) => { console.error(`assistant-local-model-proof: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
