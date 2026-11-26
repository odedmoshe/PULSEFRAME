/**
 * C8 — the resume rule (agent/contract.ts 1–4) against a REAL process death: the editor runs in a child process, is killed with
 * SIGKILL at a chosen point, and a new editor on the same data directory recovers the run. EVERY model is the LABELLED test double
 * `MOCK-scripted-model`; nothing here is a claim about a real model. No socket is opened by the editor (the loop speaks MCP in process).
 *  - tool: killed while export_project's step is running (the export job already exists): resent with the same key, the same job.
 *  - partial: killed after `undo` (not idempotent) committed: not resent; the model gets «הצעד הושלם בחלקו».
 *  - model: killed during a model call: its money is unknown (never zero), the turn is asked again.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { AGENT_RUN_FINAL, type AgentRunAnswer } from '@pulseframe/core';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, createScriptedModel, type ScriptedTurn } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig } from './config.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Store, type JobRow } from './store.ts';
import { createAgentService } from './agent/loop.ts';
import { modelCallLedgerId } from './agent/contract.ts';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, '../../..');
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** The editor's pieces as index.ts makes them, minus the render worker (a job row stays queued: what idempotency is about). */
const WORLD = `
import fs from 'node:fs';
import path from 'node:path';
import { Auth } from '${SRC}/auth.ts';
import { Capabilities } from '${SRC}/capabilities.ts';
import { loadConfig } from '${SRC}/config.ts';
import { Exporter } from '${SRC}/export.ts';
import { Governance } from '${SRC}/governance.ts';
import { createMcp } from '${SRC}/mcp.ts';
import { Presence } from '${SRC}/presence.ts';
import { Store } from '${SRC}/store.ts';
import { createAgentService } from '${SRC}/agent/loop.ts';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, createScriptedModel } from '${ROOT}/packages/providers/src/index.ts';
class NoWorkerExporter extends Exporter { enqueue() {} }
`;
function world(dir: string) {
  const cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  const store = new Store(dir);
  const auth = new Auth(cfg);
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  class NoWorkerExporter extends Exporter { override enqueue(_j: JobRow) {} }
  const mcp = createMcp(store, auth, new NoWorkerExporter(store, null as never, () => '', path.join(dir, 'no-web-dist')), new Capabilities(store, cfg), new Presence(), gov);
  return { store, gov, mcp };
}
const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === 'anthropic')!;
const row = AGENT_MODEL_TABLE.find((r) => r.providerId === 'anthropic' && r.id === 'claude-opus-5-5')!;

function fixture(store: Store): string {
  const id = store.createProject({ name: 'recover', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const bytes = Buffer.from('a labelled fixture: not a real recording');
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(store.tmpDir, 'fixture.wav'); fs.writeFileSync(tmp, bytes); store.putBlob(contentHash, tmp, bytes.length, 'audio/wav');
  const asset = { kind: 'audio' as const, name: 'voice.wav', contentHash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } };
  const assetId = store.commit({ projectId: id, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  store.commit({ projectId: id, actor: 'test', ops: [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.rt(4, 1) } }] });
  return id;
}

/**
 * Runs the editor in a child process on `dir` with the scripted turns (JSON) until it prints CRASH at `crashAt`, then SIGKILLs it.
 * crashAt: { tool } = right after that MCP tool answered (its effect exists; the step row is still running), { modelTurn } = during that model call.
 */
async function runUntilKilled(dir: string, projectId: string, script: unknown[], crashAt: { tool?: string; modelTurn?: number }): Promise<string> {
  const file = path.join(dir, 'child.ts');
  fs.writeFileSync(file, `${WORLD}
const dir = ${JSON.stringify(dir)};
const cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
const store = new Store(dir); const auth = new Auth(cfg); const gov = new Governance(store);
const mcp = createMcp(store, auth, new NoWorkerExporter(store, null, () => '', path.join(dir, 'no-web-dist')), new Capabilities(store, cfg), new Presence(), gov);
const crashAt = ${JSON.stringify(crashAt)};
const hang = () => { process.stdout.write('CRASH\\n'); return new Promise(() => {}); };
const door = { serveAs: async (p, req) => { const body = await req.clone().json(); const res = await mcp.serveAs(p, req); if (body.method === 'tools/call' && body.params.name === crashAt.tool) await hang(); return res; }, forgetAs: (p) => mcp.forgetAs(p) };
const scripted = createScriptedModel(${JSON.stringify(script)});
let turns = 0;
const model = { ...scripted, id: scripted.id, family: scripted.family, turn: async (...a) => { if (++turns === crashAt.modelTurn) await hang(); return scripted.turn(...a); } };
const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === 'anthropic');
const row = AGENT_MODEL_TABLE.find((r) => r.id === 'claude-opus-5-5');
const svc = createAgentService({ store, gov, mcp: door, providers: { resolve: () => ({ preset, endpoint: { providerId: 'anthropic', family: 'anthropic-messages', baseUrl: preset.baseUrl, model: row.id }, adapter: model, key: null, row }), view: () => { throw new Error('x'); } }, adapters: new Map([['anthropic-messages', model]]) });
const r = svc.start({ actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }, ${JSON.stringify(projectId)}, { goal: 'recover test' });
process.stdout.write('RUN ' + r.runId + '\\n');
`);
  const child = spawn(process.execPath, ['--import', 'tsx', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stderr.on('data', (d) => { err += d; });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`the child never reached its crash point:\n${out}\n${err}`)); }, 60_000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('CRASH\n')) { child.kill('SIGKILL'); }
    });
    child.on('exit', () => { clearTimeout(t); const m = /RUN (run_\w+)/.exec(out); if (out.includes('CRASH') && m) resolve(m[1]!); else reject(new Error(`child exited early:\n${out}\n${err}`)); });
  });
}

async function recover(dir: string, script: ScriptedTurn[], runId: string, projectId: string) {
  const w = world(dir);
  const model = createScriptedModel(script);
  const svc = createAgentService({ store: w.store, gov: w.gov, mcp: w.mcp, providers: { resolve: () => ({ preset, endpoint: { providerId: 'anthropic', family: 'anthropic-messages', baseUrl: preset.baseUrl, model: row.id }, adapter: model, key: null, row }), view: () => { throw new Error('not used'); } }, adapters: new Map([['anthropic-messages', model]]) });
  const before = svc.get(OWNER, projectId, runId);
  expect(svc.recover()).toEqual([runId]);
  const t = Date.now();
  let a: AgentRunAnswer;
  for (;;) { a = svc.get(OWNER, projectId, runId); if (AGENT_RUN_FINAL.includes(a.run.status) || Date.now() - t > 20_000) break; await new Promise((r) => setTimeout(r, 20)); }
  await svc.whenIdle(runId);
  return { ...w, svc, model, before, after: a!, close: async () => { await svc.stop(); await (w.mcp as any).close(); w.store.close(); } };
}
const setup = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-recover-')); dirs.push(dir); const s = new Store(dir); const pid = fixture(s); s.close(); return { dir, pid }; };
const marker = (label: string, at: number) => ({ op: 'add_marker', args: { time: T.rt(at, 1), label } });
const fin = { toolCalls: [{ name: 'finish', input: { summary: 'סיימתי', outcome: 'done' } }] };

describe('C8: killed and restarted', () => {
  it('killed while export_project\'s step runs (its job exists): resent with the same key → the same job; no duplicate transaction, no second export job', async () => {
    const { dir, pid } = setup();
    const runId = await runUntilKilled(dir, pid, [
      { toolCalls: [{ name: 'apply_transaction', input: { ops: [marker('לפני', 1)] } }] },
      { toolCalls: [{ name: 'export_project', input: { format: 'wav' } }] },
    ], { tool: 'export_project' });
    const r = await recover(dir, [fin], runId, pid);
    try {
      const running = r.before.steps.filter((s) => s.status === 'running');
      expect(running.map((s) => [s.kind, s.tool?.tool])).toEqual([['tool', 'export_project']]);
      expect(r.after.run.status).toBe('succeeded');
      const actor = r.after.run.actor;
      expect((r.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export' AND actor = ?").get(actor) as any).n).toBe(1);
      expect((r.store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE actor = ?').get(actor) as any).n).toBe(1);
      const ex = r.after.steps.find((s) => s.tool?.tool === 'export_project')!;
      expect([ex.n, ex.status, ex.tool!.jobIds.length]).toEqual([running[0]!.n, 'done', 1]);
      expect(ex.tool!.resultSummary).toContain('"replayed":true');
      expect(r.model.requests).toHaveLength(1); // the export turn was not asked again
    } finally { await r.close(); }
  }, 120_000);

  it('killed after a tool that is not idempotent (undo) committed: not resent; the model is told the step was partly done', async () => {
    const { dir, pid } = setup();
    const runId = await runUntilKilled(dir, pid, [
      { toolCalls: [{ name: 'apply_transaction', input: { ops: [marker('לבטל', 2)] } }] },
      { toolCalls: [{ name: 'undo', input: {} }] },
    ], { tool: 'undo' });
    const r = await recover(dir, [fin], runId, pid);
    try {
      expect(r.after.run.status).toBe('succeeded');
      const actor = r.after.run.actor;
      expect((r.store.db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE actor = ? AND kind = 'undo'").get(actor) as any).n).toBe(1);
      const u = r.after.steps.find((s) => s.tool?.tool === 'undo')!;
      expect([u.status, u.tool!.errorCode, u.tool!.transactionIds.length]).toEqual(['failed', 'partial_after_restart', 1]);
      expect(r.after.steps.some((s) => s.note?.code === 'partial')).toBe(true);
      expect(r.model.requests[0]!.messages.at(-1)).toMatchObject({ role: 'tool', results: [{ isError: true }] });
    } finally { await r.close(); }
  }, 120_000);

  it('killed during a model call: its money is unknown (ledger unknown, never zero), the turn is asked again and the run finishes', async () => {
    const { dir, pid } = setup();
    const runId = await runUntilKilled(dir, pid, [
      { toolCalls: [{ name: 'get_summary', input: {} }] },
      fin,
    ], { modelTurn: 2 });
    const r = await recover(dir, [fin], runId, pid);
    try {
      expect(r.before.steps.at(-1)).toMatchObject({ kind: 'model', status: 'running' });
      const lost = r.before.steps.at(-1)!.n;
      expect(r.after.run.status).toBe('succeeded');
      expect(r.after.run.unknownCostCalls).toBe(1);
      expect(r.after.steps.find((s) => s.n === lost)).toMatchObject({ status: 'failed', model: { cost: { cents: null, unknown: true } } });
      expect((r.store.db.prepare('SELECT state FROM budget_ledger WHERE job_id = ?').get(modelCallLedgerId(r.after.run.jobId, lost)) as any).state).toBe('unknown');
      expect(r.model.requests).toHaveLength(1);
    } finally { await r.close(); }
  }, 120_000);
});
