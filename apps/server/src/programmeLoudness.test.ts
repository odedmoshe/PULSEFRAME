/**
 * The programme loudness measures the CHOSEN output (wave 8 qc, verifier C2): a short with other sound than the main edit measures
 * its own sound against its own target, and a linked format whose programme differs measures its own — here the format hides a
 * title that runs 4 s past the sound, so the main edit has a 4 s silent tail and the format has none (format overrides cannot touch
 * sound clips; an audience version's music level is the audiences track's projection, a todo below until it is built) —
 * through the in-request route, the background job and MCP measure_loudness alike. Before the fix the route and the job took no
 * variantId and MCP took none either, so every one of them measured the main edit's sound.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { programmeLoudness } from './programmeLoudness.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
/** `seconds` of a 440 Hz sine as a 16-bit mono WAV at 48 kHz, peak `amp` of full scale (synthetic, made here). */
function tone(seconds: number, amp: number): Buffer {
  const sr = 48000, n = sr * seconds, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * 32767 * Math.sin((2 * Math.PI * 440 * i) / sr)), 44 + i * 2);
  return b;
}

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let pid = '', shortId = '', variantId = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const agent = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const post = async (p: string, body: unknown) => { const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method: 'POST', headers: agent(), body: JSON.stringify(body) })); return { status: r.status, body: (await r.json()) as any }; };
const get = async (p: string) => (await (await app.fetch(new Request(`${base()}/api/v1${p}`, { headers: agent() }))).json()) as any;
let rpcId = 0;
async function tool(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agent(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  expect(msg.result?.isError ?? false).toBe(false);
  return JSON.parse(msg.result.content[0].text);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = async (jobId: string) => { for (let i = 0; i < 300; i++) { const j = await get(`/jobs/${jobId}`); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } throw new Error('job did not finish'); };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-progloud-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), new Presence(), mcp, gov, undefined, speech);
  pid = store.createProject({ name: 'loudness of the chosen output' }).doc.id;
  const up = async (name: string, bytes: Buffer) => { const r = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...agent(), 'x-filename': name }, body: new Uint8Array(bytes) })); expect(r.status).toBeLessThan(300); return ((await r.json()) as any).assetId as string; };
  const loud = await up('loud.wav', tone(3, 0.5));
  const quiet = await up('quiet.wav', tone(3, 0.03));
  // the main edit: the loud tone, then the quiet one, under a 10 s title; a short of the quiet tone alone with its own target; a
  // square format that hides the title (so it ends with the sound, at 6 s)
  let r = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_clip', args: { assetId: loud, start: f(0), duration: f(90) } }, { op: 'add_clip', args: { assetId: quiet, start: f(90), duration: f(90) } }, { op: 'add_text', args: { text: 'סוף', start: f(0), duration: f(300) } }] });
  const title = r.results[2]!.output!.clipId as string;
  r = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_sequence', args: { name: 'קצר', format: { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null, loudness: { target: -16, truePeak: -1 } } } }] });
  shortId = r.results[0]!.output!.sequenceId as string;
  store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_clip', args: { sequenceId: shortId, assetId: quiet, start: f(0), duration: f(90) } }] });
  r = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_variant', args: { profileId: 'square-1x1' } }] });
  variantId = r.results[0]!.output!.variantId as string;
  store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'set_variant_override', args: { variantId, clipId: title, hidden: true } }, { op: 'set_loudness_target', args: { target: -23 } }] });
}, 60_000);
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the programme loudness follows the chosen output (verifier C2)', () => {
  it('a short with other sound than the main edit measures its own loudness, against its own target', async () => {
    const main = await programmeLoudness(store, pid) as any;
    const short = (await post(`/projects/${pid}/analysis/loudness`, { sequenceId: shortId })).body;
    // the quiet tone is about 24 dB under the loud one; the main edit's integrated loudness is dominated by the loud tone
    expect(short.integratedLufs).toBeLessThan(main.integratedLufs - 10);
    expect(short.target).toEqual({ target: -16, truePeak: -1 });
    expect(main.target).toEqual({ target: -23, truePeak: -1 });
  }, 60_000);

  it('a linked format whose programme differs measures its own, through the route, the job and MCP', async () => {
    const main = (await post(`/projects/${pid}/analysis/loudness`, {})).body;
    const own = (await post(`/projects/${pid}/analysis/loudness`, { variantId })).body;
    expect(main.seconds).toBe(10);
    expect(own.seconds).toBe(6);
    // the sound checks are read from the WAV export would write for THAT output: the main edit's 4 s tail is a silence, the format has none
    expect(main.soundChecks.findings.filter((x: any) => x.kind === 'silence').length).toBe(1);
    expect(own.soundChecks.status).toBe('measured');
    expect(own.soundChecks.findings.filter((x: any) => x.kind === 'silence')).toEqual([]);
    const job = await done((await post(`/projects/${pid}/analysis/loudness`, { variantId, background: true })).body.jobId);
    expect(job.status).toBe('succeeded');
    expect(job.output.result.seconds).toBe(6);
    expect(job.output.result.integratedLufs).toBe(own.integratedLufs);
    expect(JSON.stringify(job.output.result.soundChecks.findings)).toBe(JSON.stringify(own.soundChecks.findings));
    const viaMcp = await tool('measure_loudness', { projectId: pid, variantId });
    expect(viaMcp.seconds).toBe(6);
    expect(JSON.stringify(viaMcp.soundChecks.findings)).toBe(JSON.stringify(own.soundChecks.findings));
    const shortViaMcp = await tool('measure_loudness', { projectId: pid, sequenceId: shortId });
    expect(shortViaMcp.target).toEqual({ target: -16, truePeak: -1 });
  }, 120_000);

  it('an unknown format is 404 before any job exists', async () => {
    const r = await post(`/projects/${pid}/analysis/loudness`, { variantId: 'var_none', background: true });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });

  // audiences W1 builds applyAudience; once projectVariant applies the music level, the same route measures it with no change here
  it.todo('an audience version with a music-level setting measures its own music level (needs AUDIENCE_PROJECTION_BUILT)');
});
