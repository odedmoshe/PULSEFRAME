/**
 * proof:agent — the server checks (wave 8 autonomy Part 2, builder W1): checks 1–10, 12 and 14 of agent-proof.ts AGENT_CHECKS.
 * The integrator imports `runServerChecks` into agent-proof.ts; until then this file runs on its own:
 *   pnpm build && tsx packages/evals/src/agent-proof.server.ts
 * EVERY model here is the LABELLED test double `MOCK-scripted-model` (createScriptedModel), placed in BOTH family slots through the
 * startServer `agent.adapters` seam; nothing here is a claim about any real model. Measured on the results the server produced.
 * Fixture made here by ffmpeg: 20 s 640×360 testsrc2 with a 1 kHz tone silent over [4, 7] s and [12, 15] s, and a typed Hebrew
 * transcript set as data (no speech engine). Deleted at the end.
 * Check 6 kills a child editor (SIGKILL) during a model call and recovers the run in a new editor on the same data folder; the kill
 * during a TOOL step is apps/server/src/agentRecover.test.ts (a child process too). Check 14 needs Part 1 (open/guarded mode):
 * reported blocked until it lands.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import { AGENT_RUN_FINAL, AGENT_STOP_REASONS, canonical, entityMap, summarize, type AgentRunAnswer, type ProjectDocument } from '@pulseframe/core';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, createScriptedModel, lastToolResult, MOCK_SCRIPTED_ID, type AgentModelAdapter, type AgentTurnRequest, type ScriptedModel, type ScriptedTurn } from '@pulseframe/providers';
import { startServer } from '@pulseframe/server';
import { AGENT_HE } from '../../i18n/src/agent.ts';

type Check = (id: string, ok: boolean, detail?: unknown) => void;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const until = async <R>(fn: () => Promise<R>, ok: (r: R) => boolean, ms: number): Promise<R> => { const t = Date.now(); for (;;) { const r = await fn(); if (ok(r) || Date.now() - t > ms) return r; await new Promise((x) => setTimeout(x, 100)); } };

/** The MOCK in both family slots: one holder whose script each check sets; `before` lets a check act between turns (as the owner would). */
function mockSlot() {
  const slot = { model: createScriptedModel([]) as ScriptedModel, before: null as null | ((turn: number, req: AgentTurnRequest) => Promise<void>), turns: 0 };
  const adapter: AgentModelAdapter = {
    id: MOCK_SCRIPTED_ID, family: 'mock-scripted',
    async turn(req, ep, key, signal) { const n = slot.turns++; if (slot.before) await slot.before(n, req); return slot.model.turn(req, ep, key, signal); },
    async probe(ep) { return { ok: true, model: ep.model }; },
  };
  const set = (script: readonly ScriptedTurn[], before: typeof slot.before = null) => { slot.model = createScriptedModel(script); slot.before = before; slot.turns = 0; };
  return { slot, adapter, set };
}
const providersOf = (adapter: AgentModelAdapter) => ({
  resolve(providerId?: string) {
    const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === (providerId ?? 'anthropic'))!;
    const row = AGENT_MODEL_TABLE.find((r) => r.providerId === preset.id) ?? null;
    return { preset, endpoint: { providerId: preset.id, family: preset.family, baseUrl: preset.baseUrl, model: row?.id ?? 'local' }, adapter, key: null, row };
  },
  view(): never { throw new Error('not used by the proof'); },
});

function makeFixture(dir: string): string {
  const out = path.join(dir, 'talk.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=20',
    '-af', "volume=enable='between(t,4,7)+between(t,12,15)':volume=0", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
  return out;
}

export async function runServerChecks(check: Check): Promise<void> {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-proof-'));
  const { adapter, set, slot } = mockSlot();
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') }, { agent: { providers: providersOf(adapter), adapters: new Map([['anthropic-messages', adapter], ['openai-chat', adapter]]) } });
  const origin = s.url;
  try {
    const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
    const owner = { cookie, origin };
    const rest = async (p: string, body?: unknown, method?: string, cred: Record<string, string> = owner) => {
      const r = await fetch(`${origin}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...cred, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: (await r.json().catch(() => null)) as any };
    };
    const newProject = async (name: string) => (await rest('/projects', { name, width: 640, height: 360 })).body.project.id as string;
    const startRun = async (pid: string, body: Record<string, unknown>) => (await rest(`/projects/${pid}/agent/runs`, body)).body as { runId: string; jobId: string };
    const getRun = async (pid: string, runId: string) => (await rest(`/projects/${pid}/agent/runs/${runId}`)).body as AgentRunAnswer;
    const finalRun = (pid: string, runId: string, ms = 600_000) => until(() => getRun(pid, runId), (a) => AGENT_RUN_FINAL.includes(a.run?.status), ms);
    const doc = async (pid: string) => (await rest(`/projects/${pid}`)).body as { project: ProjectDocument; revision: number };
    const digestOf = (d: ProjectDocument) => canonical([...entityMap(d)].filter(([, e]) => e.kind !== 'project'));
    const fin = (summary = 'סיימתי'): ScriptedTurn => ({ toolCalls: [{ name: 'finish', input: { summary, outcome: 'done' } }] });

    // ---------- fixture ----------
    const pid = await newProject('agent walk');
    const file = makeFixture(art);
    const up = await (await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': 'talk.mp4', connection: 'close' }, body: fs.readFileSync(file) })).json() as any;
    const assetId = up.assetId as string;
    await until(() => doc(pid), (d) => !!d.project.assets[assetId], 120_000);
    await rest(`/projects/${pid}/transactions`, { ops: [
      { op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.rt(20, 1) } },
      { op: 'set_transcript', args: { assetId, language: 'he', segments: [[0, 'שלום לכולם'], [8, 'זה החלק השני'], [16, 'ותודה רבה']].map(([at, text]) => ({ start: T.rt(at as number, 1), duration: T.rt(3, 1), text })) } },
    ] });
    const startDoc = await doc(pid);
    const startDuration = summarize(startDoc.project).duration;

    // ---------- checks 1–4: the walk ----------
    const events: { stage: string; at: number }[] = [];
    const sse = await fetch(`${origin}/api/v1/projects/${pid}/events`, { headers: { ...owner } });
    const reader = sse.body!.getReader();
    void (async () => { const dec = new TextDecoder(); let buf = ''; for (;;) { const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true })); if (done) return; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); if (/^event: job$/m.test(block)) { const data = JSON.parse(block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('')); if (data.type === 'agent.run' && data.stage) events.push({ stage: data.stage, at: Date.now() }); } } } })();
    let planBeforeActing: unknown = null;
    let runId1 = '';
    set([
      { toolCalls: [{ name: 'update_plan', input: { steps: ['לקרוא את הפרויקט', 'לחתוך את השקטים', 'כתוביות בעברית', 'גרסה 9:16', 'ייצוא'].map((title) => ({ title })) } }] },
      { toolCalls: [{ name: 'get_summary', input: {} }, { name: 'get_timeline', input: {} }] },
      { toolCalls: [{ name: 'find_silences', input: { assetId, keepSeconds: 0 } }] },
      (req) => ({ toolCalls: [{ name: 'apply_transaction', input: { ops: (lastToolResult(req, 'find_silences') as any).ops } }] }),
      { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_caption_track', args: { mode: 'transcript' } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }] } }] },
      (req) => ({ toolCalls: [{ name: 'preflight', input: { variantId: (lastToolResult(req, 'apply_transaction') as any).results[1].output.variantId } }] }),
      (req) => ({ toolCalls: [{ name: 'export_project', input: { variantId: (lastToolResult(req, 'apply_transaction') as any).results[1].output.variantId, format: 'mp4-h264-aac', scale: 0.25, quality: 'draft' } }] }),
      (req) => ({ toolCalls: [{ name: 'wait_for_job', input: { jobId: (lastToolResult(req, 'export_project') as any).jobId } }] }),
      fin('חתכתי את השקטים, הוספתי כתוביות, גרסה 9:16 וייצוא'),
    ], async (turn) => { if (turn === 3) planBeforeActing = (await getRun(pid, runId1)).run.plan; });
    runId1 = (await startRun(pid, { goal: 'תחתכו את השקטים, תוסיפו כתוביות בעברית, תעשו גרסה 9:16 ותייצאו' })).runId;
    const w = await finalRun(pid, runId1);
    await until(async () => events.map((e) => e.stage), (st) => st.includes(`${w.run.status}:${w.run.stopReason}`), 10_000); // the stream delivers after the run's row is final
    const tools = w.steps.filter((x) => x.kind === 'tool');
    check('1 the walk reaches succeeded with the MOCK scripted model; the plan is readable over REST before the first acting step', w.run.status === 'succeeded' && Array.isArray(planBeforeActing) && (planBeforeActing as unknown[]).length === 5 && events.length > 0,
      { status: w.run.status, stopReason: w.run.stopReason, planBeforeActing: (planBeforeActing as unknown[] | null)?.length, sseJobEvents: events.length, failed: tools.filter((x) => x.status !== 'done').map((x) => [x.tool?.tool, x.tool?.resultSummary?.slice(0, 300)]) });
    const stagesOk = tools.every((t) => { const r = events.findIndex((e) => e.stage === `step:${t.n}:running`), d = events.findIndex((e) => e.stage === `step:${t.n}:done` || e.stage === `step:${t.n}:failed`); return r >= 0 && d > r; });
    check('2 every step passes running → done/failed with its tool, arguments, summary, ids; its row is written before the call (SSE step:<n>:running before step:<n>:done)', stagesOk && tools.every((t) => t.tool && t.tool.input !== undefined && t.startedAt <= (t.endedAt ?? '') && t.tool.resultSummary !== null),
      { steps: w.steps.length, tools: tools.map((t) => `${t.n}:${t.tool!.tool}:${t.status}`), sseStages: events.map((e) => e.stage) });
    const txs = s.store.db.prepare('SELECT actor, idempotency_key AS k FROM transactions WHERE project_id = ? AND revision > ?').all(pid, w.run.startRevision) as { actor: string; k: string | null }[];
    const agentDir = path.join(ROOT, 'apps/server/src/agent');
    const offenders = fs.readdirSync(agentDir).filter((f) => { const src = fs.readFileSync(path.join(agentDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); return /\.commit\(/.test(src) || /UPDATE\s+projects/i.test(src); });
    check('3 every edit of the run is a transaction by agent:run_<id> with the key <runId>.<n>.<k> (through serveAs → commitAs → Store.commit); agent/ holds no .commit( nor UPDATE projects', txs.length === 2 && txs.every((t) => t.actor === w.run.actor && t.k?.startsWith(`${runId1}.`)) && offenders.length === 0, { txs, offenders });
    const after = await doc(pid);
    const fr = after.project.settings.frameRate;
    const lost = T.sub(startDuration, summarize(after.project).duration);
    const lostFrames = T.frameCount(lost, fr);
    const variant = Object.values(after.project.variants)[0];
    const captionTrack = Object.values(after.project.sequences).some((sq) => sq.tracks.some((t) => t.kind === 'caption'));
    const exportJobId = tools.find((t) => t.tool?.tool === 'export_project')?.tool?.jobIds[0];
    const job = exportJobId ? s.store.getJob(exportJobId) : null;
    let probe: { width?: number; height?: number; frames?: number } = {};
    try {
      const outFile = path.join(s.store.outDir, String(job?.output?.file));
      const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', String(outFile)]).toString()).streams[0];
      probe = { width: pr.width, height: pr.height, frames: Number(pr.nb_read_frames) };
    } catch (e) { probe = { error: String(e).slice(0, 200) } as never; }
    const even = (n: number) => Math.max(2, Math.round(n * 0.25 / 2) * 2);
    const expectFrames = summarize(after.project).frameCount;
    // lead decision 1: the product rounds each cut INWARD to whole frames; the expected loss is computed from the detected ranges
    // (find_silences' own answer, keepSeconds 0) rounded that way, ± 1 frame per cut
    const fsSummary = tools.find((t) => t.tool?.tool === 'find_silences')?.tool?.resultSummary ?? '';
    const detected = [...(/"sourceSilences":\[([^\]]*)\]/.exec(fsSummary)?.[1] ?? '').matchAll(/"startSeconds":([0-9.]+),"endSeconds":([0-9.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const fps = Number(fr.num) / Number(fr.den);
    const expectedLost = detected.reduce((n, [a, b]) => n + Math.max(0, Math.floor(b * fps + 1e-9) - Math.ceil(a * fps - 1e-9)), 0);
    check('4 measured: the timeline lost both detected silences (the detected ranges rounded inward to whole frames, ± 1 frame per cut: lead decision 1; rational), a caption track and a 9:16 variant exist, the export file has the variant\'s size (×0.25) and the frame count',
      detected.length === 2 && Math.abs(lostFrames - expectedLost) <= detected.length && captionTrack && !!variant && job?.status === 'succeeded' && probe.width === even(variant.width) && probe.height === even(variant.height) && probe.frames === expectFrames,
      { lostSeconds: T.toSeconds(lost), lostFrames, expectedLostFrames: expectedLost, detected, silencesFound: /"sourceSilences":\[[^\]]*\]|"removableSeconds":[0-9.]+/g.exec(tools.find((t) => t.tool?.tool === 'find_silences')?.tool?.resultSummary ?? '')?.[0] ?? null, removable: /"removableSeconds":[0-9.]+/.exec(tools.find((t) => t.tool?.tool === 'find_silences')?.tool?.resultSummary ?? '')?.[0] ?? null, captionTrack, variant: variant && [variant.width, variant.height], job: job?.status, probe, expectFrames, jobOutput: job?.output });

    // ---------- check 5: «ביטול הכול», the interleaved case, redo ----------
    const before5 = digestOf(s.store.replay(pid, w.run.startRevision).doc);
    const rev5 = (await doc(pid)).revision;
    const u = await rest(`/projects/${pid}/agent/runs/${runId1}/undo-all`, {});
    const afterUndo = await doc(pid);
    const ok5a = u.status === 200 && afterUndo.revision === rev5 + 1 && digestOf(afterUndo.project) === before5;
    const p5 = await newProject('interleaved');
    let markerId = '';
    set([
      { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_marker', args: { time: T.rt(1, 1), label: 'run 1' } }] } }] },
      (req) => { markerId = (lastToolResult(req, 'apply_transaction') as any).results[0].output.markerId; return { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_marker', args: { time: T.rt(3, 1), label: 'other' } }] } }] }; },
      () => ({ toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'update_marker', args: { markerId, label: 'run 2' } }] } }] }),
      fin(),
    ], async (turn) => { if (turn === 2) await rest(`/projects/${p5}/transactions`, { ops: [{ op: 'update_marker', args: { markerId, label: 'owner' } }] }); });
    const r5 = (await startRun(p5, { goal: 'markers' })).runId;
    await finalRun(p5, r5);
    const revBefore = (await doc(p5)).revision;
    const conflict = await rest(`/projects/${p5}/agent/runs/${r5}/undo-all`, {});
    const unchanged = (await doc(p5)).revision === revBefore;
    const partial = await rest(`/projects/${p5}/agent/runs/${r5}/undo-all`, { partial: true });
    const d5 = (await doc(p5)).project;
    const markers = Object.values(d5.markers ?? {}).map((m) => m.label);
    const redo = await rest(`/projects/${p5}/redo`, {});
    const marks = (s.store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE project_id = ? AND actor = ? AND undone_by IS NOT NULL').get(p5, `agent:${r5}`) as { n: number }).n;
    const markersRedone = Object.values((await doc(p5)).project.markers ?? {}).map((m) => m.label).sort();
    check('5 «ביטול הכול» brings the digest back to the start revision\'s in ONE revision; interleaved: 409 undo_conflict lists X by user:local and applies nothing; partial undoes the rest, and X (changed later by someone else) is skipped, left as it is and listed (lead decision 2); redo restores the run\'s states and clears every mark',
      ok5a && conflict.status === 409 && conflict.body.error.code === 'undo_conflict' && JSON.stringify(conflict.body.error.details.conflicts) === JSON.stringify([{ entityId: markerId, changedAtRevision: revBefore - 1, by: 'user:local' }]) && unchanged
      && partial.status === 200 && JSON.stringify(markers) === JSON.stringify(['run 2']) && (partial.body?.conflicts ?? []).some((c: { entityId: string }) => c.entityId === markerId) && redo.status === 200 && marks === 0 && JSON.stringify(markersRedone) === JSON.stringify(['other', 'run 2']),
      { undoAll: [u.status, afterUndo.revision - rev5], conflict: conflict.body?.error?.details?.conflicts, partial: partial.status, partialListed: partial.body?.conflicts, markers, redo: redo.status, marksLeft: marks, markersRedone });

    // ---------- check 7: step limit ----------
    const p7 = await newProject('limit');
    set([...Array.from({ length: 4 }, () => ({ toolCalls: [{ name: 'get_summary', input: {} }] })), fin()]);
    const r7 = (await startRun(p7, { goal: 'x', stepLimit: 3 })).runId;
    const a7 = await finalRun(p7, r7);
    await new Promise((x) => setTimeout(x, 200));
    const c7 = await rest(`/projects/${p7}/agent/runs/${r7}/continue`, {});
    const b7 = await finalRun(p7, r7);
    check('7 step limit 3 stops at step 3 as stopped_at_limit with its reason (job stage says it); continue (+100) finishes it', a7.run.status === 'stopped_at_limit' && a7.run.stopReason === 'step_limit' && a7.run.stepsUsed === 3 && c7.status === 200 && b7.run.status === 'succeeded',
      { first: [a7.run.status, a7.run.stopReason, a7.run.stepsUsed], jobStage: s.store.getJob(a7.run.jobId).stage, continued: [b7.run.status, b7.run.stepsUsed, b7.run.stepLimit] });

    // ---------- check 8: money ----------
    set(Array.from({ length: 6 }, () => ({ toolCalls: [{ name: 'get_summary', input: {} }] })));
    const r8 = (await startRun(p7, { goal: 'x', spendLimitCents: 1 })).runId;
    const a8 = await finalRun(p7, r8);
    const rows8 = s.store.db.prepare("SELECT job_id, state, actual_cents FROM budget_ledger WHERE job_id LIKE ?").all(`${a8.run.jobId}:%`) as { job_id: string; state: string; actual_cents: number }[];
    set([fin()]);
    const r8b = (await startRun(p7, { goal: 'x' })).runId;
    const b8 = await finalRun(p7, r8b);
    check('8 one ledger row per model call (<jobId>:<n>) settled explicitly; scripted usage × the table\'s prices over a 1-cent spend limit stops at the limit with the reason; no limit runs',
      a8.run.status === 'stopped_at_limit' && a8.run.stopReason === 'spend_limit' && rows8.length === a8.run.stepsUsed && rows8.every((r) => r.state === 'settled') && b8.run.status === 'succeeded',
      { run: [a8.run.status, a8.run.stopReason, a8.run.stepsUsed, a8.run.spentCents], rows: rows8.map((r) => [r.job_id.split(':')[1], r.state, r.actual_cents]), noLimit: b8.run.status, note: 'the run\'s own spend limit stops as spend_limit after the call that reached it; budget_reached is the owner-wide / grant budget at reservation (agentLoop.test.ts)' });

    // ---------- check 9: tool error, unparseable calls (the openai-chat family slot) ----------
    set([
      { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'update_marker', args: { markerId: 'mrk_no_such', label: 'x' } }] } }] },
      (req) => ({ toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_marker', args: { time: T.rt(2, 1), label: `after ${(lastToolResult(req, 'apply_transaction') as any).error.code}` } }] } }] }),
      fin(),
    ]);
    const r9 = (await startRun(p7, { goal: 'x', providerId: 'openai' })).runId;
    const a9 = await finalRun(p7, r9);
    const t9 = a9.steps.filter((x) => x.kind === 'tool');
    set([{ fail: 'bad_tool_call' }, { fail: 'bad_tool_call' }]);
    const r9b = (await startRun(p7, { goal: 'x', providerId: 'openai' })).runId;
    const b9 = await finalRun(p7, r9b);
    check('9 a tool error (a wrong id) returns to the model as an error and the next turn recovers; an unparseable call twice stops model_no_tools and is not counted as a step',
      a9.run.status === 'succeeded' && t9[0]?.tool?.isError === true && t9[1]?.status === 'done' && b9.run.status === 'failed' && b9.run.stopReason === 'model_no_tools' && b9.run.stepsUsed === 0,
      { recovered: [a9.run.status, t9.map((t) => `${t.tool!.tool}:${t.tool!.errorCode ?? 'ok'}`)], badCalls: [b9.run.status, b9.run.stopReason, b9.run.stepsUsed], provider: a9.run.providerId });

    // ---------- check 10: C16 failure rows ----------
    const rows10: Record<string, unknown> = {};
    let ok10 = true;
    for (const [code, status, reason] of [['unauthorized', 'provider_unavailable', 'provider_unauthorized'], ['no_credit', 'provider_unavailable', 'provider_no_credit'], ['local_server_down', 'provider_unavailable', 'local_server_down'], ['unknown_after_send', 'provider_unavailable', 'unknown_after_send'], ['refused', 'failed', 'model_refused']] as const) {
      set([{ fail: code }, fin()]);
      const a = await finalRun(p7, (await startRun(p7, { goal: 'x' })).runId);
      rows10[code] = [a.run.status, a.run.stopReason, a.run.unknownCostCalls, slot.turns];
      ok10 &&= a.run.status === status && a.run.stopReason === reason && slot.turns === 1 && !!AGENT_HE[`agent.stop.${reason}` as keyof typeof AGENT_HE];
    }
    set([{ fail: 'rate_limited', retryAfterSeconds: 1 }, { fail: 'context_too_long' }, fin()]);
    const rl = (await startRun(p7, { goal: 'x' })).runId;
    const sawWaiting = await until(() => getRun(p7, rl), (a) => a.run.status === 'waiting', 5_000);
    const arl = await finalRun(p7, rl);
    rows10.rate_limited_and_trim = [sawWaiting.run.status, arl.run.status, arl.run.stepsUsed, arl.steps.filter((x) => x.kind === 'note').map((x) => x.note!.code)];
    ok10 &&= arl.run.status === 'succeeded' && arl.run.stepsUsed === 1 && arl.steps.some((x) => x.note?.code === 'trimmed');
    await rest(`/projects/${p7}/agents/pause`, {});
    set([fin()]);
    const pr = (await startRun(p7, { goal: 'x' })).runId;
    const paused = await until(() => getRun(p7, pr), (a) => a.run.status === 'waiting', 10_000);
    await rest(`/projects/${p7}/agents/resume`, {});
    const resumed = await finalRun(p7, pr);
    rows10.paused = [paused.run.status, paused.run.stepsUsed, resumed.run.status];
    ok10 &&= paused.run.status === 'waiting' && paused.run.stepsUsed === 0 && resumed.run.status === 'succeeded';
    ok10 &&= AGENT_STOP_REASONS.every((r) => !!AGENT_HE[`agent.stop.${r}` as keyof typeof AGENT_HE]);
    check('10 C16 rows with the scripted double: unauthorized, no_credit, local_server_down, refused, unknown_after_send (never resent: one model call), rate_limited (waiting, no step burned), context_too_long (a trim note), 423 paused (waiting); every stop reason worded in Hebrew', ok10, rows10);

    // ---------- check 12: an outside MCP client ----------
    const c = new Client({ name: 'agent-proof-outside', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } } }));
    const call = async (name: string, args: Record<string, unknown>) => { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: JSON.parse((r.content as any[]).find((x) => x.type === 'text').text) }; };
    const p12 = await newProject('outside');
    const up12 = await (await fetch(`${origin}/api/v1/projects/${p12}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': 'talk.mp4', connection: 'close' }, body: fs.readFileSync(file) })).json() as any;
    await until(() => doc(p12), (d) => !!d.project.assets[up12.assetId], 120_000);
    await rest(`/projects/${p12}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up12.assetId, start: T.rt(0, 1), duration: T.rt(4, 1) } }] });
    set([
      { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_marker', args: { time: T.rt(1, 1), label: 'outside' } }] } }] },
      { toolCalls: [{ name: 'export_project', input: { format: 'wav' } }] },
      (req) => ({ toolCalls: [{ name: 'wait_for_job', input: { jobId: (lastToolResult(req, 'export_project') as any).jobId } }] }),
      fin(),
    ]);
    const st = await call('start_agent_run', { projectId: p12, goal: 'סמן ויצא' });
    const g = await until(() => call('get_agent_run', { projectId: p12, runId: st.data.runId }), (r) => AGENT_RUN_FINAL.includes(r.data?.run?.status), 300_000);
    const un = await call('undo_actor_since', { projectId: p12, actor: g.data.run.actor });
    await c.close();
    check('12 an outside MCP client (official SDK) starts a run, reads it and undoes it by actor; the undo lists what it cannot undo (1 export file, money, data sent) (C7)',
      !st.isError && g.data.run.status === 'succeeded' && !un.isError && !!un.data.transactionId && un.data.notUndone.some((x: any) => x.kind === 'export_file' && x.count === 1) && un.data.notUndone.some((x: any) => x.kind === 'money_spent') && un.data.notUndone.some((x: any) => x.kind === 'data_sent'),
      { start: st.data, status: g.data.run?.status, undo: { tx: un.data.transactionId, notUndone: un.data.notUndone, error: un.data.error } });

    check('14 mode (Part 1): BLOCKED — the open/guarded mode (wt/auto-p1) is not merged into this build; the loop has its seams (stamp, modeEvents) and agentLoop.test.ts stops runs on a guarded switch with a stand-in emitter', false, { blocked: true });
    reader.cancel().catch(() => {});
  } finally {
    await s.close();
  }

  // ---------- check 6: killed during a model call, restarted on the same data folder ----------
  const dir6 = path.join(art, 'data6');
  const childFile = path.join(art, 'child6.mts');
  fs.writeFileSync(childFile, `
import { startServer } from '${ROOT}/apps/server/src/index.ts';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, createScriptedModel } from '${ROOT}/packages/providers/src/index.ts';
import * as T from '${ROOT}/packages/time/src/index.ts';
const scripted = createScriptedModel([
  { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_marker', args: { time: T.rt(1, 1), label: 'before the kill' } }] } }] },
  { toolCalls: [{ name: 'export_project', input: { format: 'wav' } }] },
]);
let turns = 0;
const model = { id: scripted.id, family: scripted.family, probe: scripted.probe, turn: async (...a) => { if (++turns === 3) { process.stdout.write('CRASH\\n'); await new Promise(() => {}); } return scripted.turn(...a); } };
const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === 'anthropic'); const row = AGENT_MODEL_TABLE.find((r) => r.id === 'claude-opus-5-5');
const providers = { resolve: () => ({ preset, endpoint: { providerId: 'anthropic', family: 'anthropic-messages', baseUrl: preset.baseUrl, model: row.id }, adapter: model, key: null, row }), view: () => { throw new Error('x'); } };
const s = await startServer({ port: 0, dataDir: ${JSON.stringify(dir6)} }, { agent: { providers, adapters: new Map([['anthropic-messages', model]]) } });
const pid = s.store.createProject({ name: 'kill', width: 640, height: 360 }).doc.id;
// a labelled audio fixture on the timeline (an audio export starts on it); not a recording
const { createHash } = await import('node:crypto'); const fs = await import('node:fs'); const path = await import('node:path');
const bytes = Buffer.from('a labelled fixture: not a real recording'); const contentHash = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const tmp = path.join(s.store.tmpDir, 'fixture.wav'); fs.writeFileSync(tmp, bytes); s.store.putBlob(contentHash, tmp, bytes.length, 'audio/wav');
const assetId = s.store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'audio', name: 'voice.wav', contentHash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'proof' } } } }] }).results[0].output.assetId;
s.store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.rt(4, 1) } }] });
const res = await fetch(s.url + '/api/v1/projects/' + pid + '/agent/runs', { method: 'POST', headers: { authorization: 'Bearer ' + s.auth.tokens.agent, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'kill test' }) });
const b = await res.json();
process.stdout.write('RUN ' + pid + ' ' + b.runId + '\\n');
`);
  const killed = await new Promise<{ pid: string; runId: string } | { error: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', childFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.on('data', (d) => { out += d; if (out.includes('CRASH')) child.kill('SIGKILL'); });
    child.stderr.on('data', (d) => { err += d; });
    // the run's ids are read from the data folder (the child may be killed before its POST answer is printed)
    child.on('exit', () => { clearTimeout(t); resolve(out.includes('CRASH') ? { pid: '', runId: '' } : { error: `${out}\n${err}`.slice(-1500) }); });
  });
  if ('error' in killed) check('6 killed during a model call and restarted: no duplicate transaction, no second export job, the lost call counted as unknown money', false, killed);
  else {
    const { adapter: a6, set: set6 } = mockSlot();
    set6([{ toolCalls: [{ name: 'finish', input: { summary: 'after the restart', outcome: 'done' } }] }]);
    const s6 = await startServer({ port: 0, dataDir: dir6 }, { agent: { providers: providersOf(a6), adapters: new Map([['anthropic-messages', a6], ['openai-chat', a6]]) } });
    try {
      const r6 = s6.store.db.prepare('SELECT id, project_id AS pid FROM agent_runs').all() as { id: string; pid: string }[];
      if (r6.length !== 1) throw new Error(`expected one run in the killed editor's data folder, found ${r6.length}`);
      killed.pid = r6[0]!.pid; killed.runId = r6[0]!.id;
      const h = { authorization: `Bearer ${s6.auth.tokens.agent}` };
      const get = async () => (await (await fetch(`${s6.url}/api/v1/projects/${killed.pid}/agent/runs/${killed.runId}`, { headers: h })).json()) as AgentRunAnswer;
      const a = await until(get, (x) => AGENT_RUN_FINAL.includes(x.run?.status), 60_000);
      const actor = a.run.actor;
      const txs = (s6.store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE actor = ?').get(actor) as { n: number }).n;
      const exportsN = (s6.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export' AND actor = ?").get(actor) as { n: number }).n;
      const lost = a.steps.find((x) => x.kind === 'model' && x.status === 'failed');
      check('6 killed (SIGKILL) during a model call and restarted on the same data folder: the run resumes and finishes with no duplicate transaction and no second export job; the lost call is counted as unknown money (never zero)',
        a.run.status === 'succeeded' && txs === 1 && exportsN === 1 && a.run.unknownCostCalls === 1 && lost?.model?.cost.unknown === true,
        { status: a.run.status, transactions: txs, exportJobs: exportsN, unknownCostCalls: a.run.unknownCostCalls, note: 'the kill during a TOOL step: apps/server/src/agentRecover.test.ts' });
    } finally { await s6.close(); }
  }
  fs.rmSync(art, { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const results: { id: string; ok: boolean }[] = [];
  await runServerChecks((id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${id}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); });
  const failed = results.filter((r) => !r.ok && !r.id.startsWith('14 '));
  console.log(`agent-proof.server: ${results.length - failed.length - (results.some((r) => r.id.startsWith('14 ')) ? 1 : 0)} passed, ${failed.length} failed, 14 blocked (Part 1)`);
  process.exit(failed.length ? 1 : 2);
}
