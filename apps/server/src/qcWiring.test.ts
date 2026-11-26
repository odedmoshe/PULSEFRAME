/**
 * Lead wiring of the wave 8 qc track on the server: preflight carries core documentChecks (one line), the scope names the rules only
 * once they are built, MCP and OpenAPI describe the new codes and the `measured` numbers, and the list of preflight codes the sheet
 * must word in Hebrew (verifier C12) names only codes the server or core really emit. B1's server lines (the explanation pass on
 * every route, the WAV sound checks, the browser route's not-measured record) are the todo rows at the end.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, PREFLIGHT_SHOWN_CODES, QC_BUILT, QC_CODES, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { Hono } from 'hono';
import type { Principal } from './auth.ts';
import { registerBrowserExportRoutes } from './browser-export.ts';
import { Exporter } from './export.ts';
import { startServer, type RunningServer } from './index.ts';
import { preflight } from './preflight.ts';
import { buildOpenApi } from './openapi.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: 'qcw_', actor: 'user:local' }).doc;
let dir: string, store: Store, exporter: Exporter;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-qcw-')); store = new Store(dir); exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist')); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('qc wiring (wave 8, lead pre-pass)', () => {
  it.runIf(!QC_BUILT)('preflight runs the document rules but, until they are built, lists none of their codes and its scope does not claim them', () => {
    const doc = tx(createProject({ id: 'prj_qcw', name: 'qc', frameRate: R }), [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(2) } }]);
    const rep = preflight(exporter, doc, 1);
    expect(rep.issues.filter((i) => (QC_CODES as readonly string[]).includes(i.code))).toEqual([]);
    for (const c of QC_CODES) expect(rep.scope.includes(c), c).toBe(false);
  });
  it('the preflight source pushes documentChecks once, and the MCP description names every qc code', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'preflight.ts'), 'utf8');
    expect(src.match(/issues\.push\(\.\.\.documentChecks\(doc\)\.issues\)/g)).toHaveLength(1);
    const mcp = fs.readFileSync(path.join(import.meta.dirname, 'mcp.ts'), 'utf8');
    const line = mcp.split('\n').find((l) => l.includes("registerTool('preflight'"))!;
    for (const c of QC_CODES) expect(line.includes(c), c).toBe(true);
  });
  it('OpenAPI documents an issue\'s range and measured numbers, and the loudness body\'s variantId (C15)', () => {
    const api = buildOpenApi() as any;
    const issue = api.paths['/api/v1/projects/{id}/preflight'].get.responses['200'].content['application/json'].schema.properties.issues.items;
    expect(Object.keys(issue.properties)).toEqual(expect.arrayContaining(['range', 'measured']));
    const loud = api.paths['/api/v1/projects/{id}/analysis/loudness'].post.requestBody.content['application/json'].schema;
    expect(Object.keys(loud.properties)).toEqual(expect.arrayContaining(['sequenceId', 'variantId', 'background']));
  });
  it('every preflight code the sheet must word (C12) is a code the server or core emits', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const files = [path.join(root, 'apps/server/src'), path.join(root, 'packages/core/src')].flatMap((d) => fs.readdirSync(d).filter((x) => x.endsWith('.ts') && !x.includes('.test.') && x !== 'qcContract.ts').map((x) => path.join(d, x)));
    const text = files.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    const missing = PREFLIGHT_SHOWN_CODES.filter((c) => !(QC_CODES as readonly string[]).includes(c) && !text.includes(`'${c}'`));
    expect(missing).toEqual([]);
  });
  // B1 (qc-b1.md): the server lines
  it('the export\'s checks go through explainFindings once, after assembleChecks; the fast export gives the same explained fields (Q13)', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'export.ts'), 'utf8');
    // one `checks` for both routes (the fast export's segments feed the same picture check, export.ts onCells), every assembleChecks inside the pass
    expect(src.match(/const checks = /g)).toHaveLength(1);
    expect(src.match(/assembleChecks\(/g)).toHaveLength(2);
    expect(src.match(/explainFindings\(doc, output\.firstFrame, assembleChecks\(/g)).toHaveLength(2);
    const loud = fs.readFileSync(path.join(import.meta.dirname, 'programmeLoudness.ts'), 'utf8');
    expect(loud.match(/explainFindings\(p\.doc, 0, assembleChecks\(/g)).toHaveLength(1);
  });
  describe('through a running server (port 0, synthetic media made here and deleted)', () => {
    let s: RunningServer, h: Record<string, string>, pid = '', wavJob: any, loud: any;
    const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-qcw-srv-'));
    const call = async (p: string, body?: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, body === undefined ? { headers: h } : { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
    const up = async (file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: new Uint8Array(fs.readFileSync(file)) })).json() as any).assetId as string;
    const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };
    beforeAll(async () => {
      s = await startServer({ port: 0, dataDir: path.join(sdir, 'data') });
      h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
      const tone = path.join(sdir, 'tone.wav'), still = path.join(sdir, 'still.mp4');
      ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-ac', '1', '-c:a', 'pcm_s16le', tone]);
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', still]);
      pid = (await call('/projects', { name: 'qc wiring', width: 64, height: 36 })).body.project.id;
      const T1 = await up(tone), V = await up(still);
      // tone [0, 1 s) · a freeze frame [1 s, 4 s) with no sound under it · tone [4 s, 5 s): the silence lies inside the freeze → freeze_hold
      const r = await call(`/projects/${pid}/transactions`, { ops: [
        { op: 'add_clip', args: { assetId: T1, start: f(0) } },
        { op: 'add_clip', args: { assetId: V, start: f(30), duration: f(90), freeze: true } },
        { op: 'add_clip', args: { assetId: T1, start: f(120) } },
      ] });
      expect(r.status).toBe(200);
      const job = (await call(`/projects/${pid}/exports`, { format: 'wav' })).body;
      for (let i = 0; i < 600; i++) { const j = (await call(`/jobs/${job.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) { wavJob = j; break; } await new Promise((res) => setTimeout(res, 100)); }
      loud = (await call(`/projects/${pid}/analysis/loudness`, {})).body;
    }, 120_000);
    afterAll(async () => { await s?.close(); fs.rmSync(sdir, { recursive: true, force: true }); });
    it('the loudness route\'s soundChecks go through the same explainFindings, so proof:send K4 still holds byte for byte (C6)', () => {
      expect(wavJob?.status, JSON.stringify(wavJob?.error)).toBe('succeeded');
      const exp = wavJob.output.checks.sound.findings, got = loud.soundChecks.findings;
      expect(exp.filter((x: any) => x.kind === 'silence').map((x: any) => x.explained)).toEqual(['freeze_hold']);
      expect(JSON.stringify(got)).toBe(JSON.stringify(exp));
    });
    it('a WAV export stores checks with sound measured and picture not_measured with its reason (Q12)', () => {
      expect(wavJob.output.checks.sound.status).toBe('measured');
      expect(wavJob.output.checks.picture).toEqual({ method: 'audio-only export: no picture', status: 'not_measured', findings: [] });
      expect(wavJob.output.checks.lookedFor).toEqual(['black', 'frozen', 'silence', 'clipped']);
    });
  });
  it('a browser-route export stores checks not_measured on both parts with the route\'s reason (Q12)', async () => {
    const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-qcw-bx-'));
    fs.mkdirSync(path.join(bdir, 'web/assets'), { recursive: true });
    fs.writeFileSync(path.join(bdir, 'web/assets/heebo-latin-400.woff2'), 'x');
    const st = new Store(path.join(bdir, 'data'));
    const ex = new Exporter(st, {} as never, () => '', path.join(bdir, 'web'));
    const { doc } = st.createProject({ name: 'p' });
    st.commit({ projectId: doc.id, actor: 'user:a', ops: [{ op: 'add_text', args: { text: 'hi', start: f(0), duration: T.rt(1, 1) } }] });
    const app = new Hono<any>();
    app.use('*', async (ctx, next) => { ctx.set('principal', { actor: 'user:a', kind: 'user', scopes: ['observe', 'edit'] } satisfies Principal); await next(); });
    const be = registerBrowserExportRoutes(app, st, ex, { now: () => 1_000_000, sweepIntervalMs: 0 });
    try {
      const req = async (p: string, body: unknown) => (await (await app.request(`/api/v1${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as any;
      const started = await req(`/projects/${doc.id}/exports/browser`, { sessionId: 'session-qcqc' });
      const done = await req(`/jobs/${started.jobId}/complete`, { sessionId: 'session-qcqc', bytes: 10, sha256: 'a'.repeat(64), videoCodec: 'avc', audioCodec: 'opus', frames: 30, container: 'mp4' });
      expect(done.status).toBe('succeeded');
      const checks = st.getJob(started.jobId).output.checks;
      expect(checks.picture).toMatchObject({ status: 'not_measured', findings: [] });
      expect(checks.sound).toMatchObject({ status: 'not_measured', findings: [] });
      expect(checks.picture.method).toMatch(/^browser route: /);
      expect(checks.sound.method).toMatch(/^browser route: /);
    } finally { be.stop(); st.close(); fs.rmSync(bdir, { recursive: true, force: true }); }
  });
});
