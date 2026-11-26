/**
 * Shorts on the server (ADR-0018) over REST and MCP, without opening a port: candidates answer 202 with an 'analysis' job
 * before the sound is measured and 200 after; MCP cancel_job cancels the measurement between windows; an unknown file is 404;
 * an observe credential may find and plan. Once the planner and the plan op (W1) are in the tree, making shorts is exactly
 * one revision, propose mode is 403, a stale expectedRevision is 409 and a reworded quote title is 422 not_verbatim.
 * The media are generated here with ffmpeg from the lead's shorts fixture (word bursts with a manual word-timed transcript).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { BuildShortsBodySchema, createProject, getOp, planShorts, SHORTS_PROPOSE_REFUSED, transcriptStatements, type Asset, type ShortCandidatesView } from '@pulseframe/core';
import { shortsFixtureTruth, shortsSamples } from '../../../packages/fixtures/src/shorts.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { applyShorts, planContext } from './shorts.ts';
import { cachedAudioFeatures } from './shortsFeatures.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

/** Is W1's planner in this tree? (Before the merge its stub throws "planShorts is not built yet".) */
const W1_BUILT = (() => {
  try { planShorts(createProject({ id: 'prj_probe', name: 'p', width: 640, height: 360, frameRate: { num: 30, den: 1 } }), BuildShortsBodySchema.parse({ picks: [{ assetId: 'ast_none', start: T.ZERO, end: T.rt(10, 1) }] }), { createdAt: 'x', candidates: new Map(), features: new Map() }); }
  catch (e) { return !/not built yet/.test(String(e)); }
  return true;
})();

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, t = auth.tokens.agent) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(t), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t = auth.tokens.agent) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
const settle = async (jobId: string, ms = 300_000) => {
  const t0 = Date.now();
  for (;;) {
    const j = store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j;
    if (Date.now() - t0 > ms) throw new Error(`job ${jobId} still ${j.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
function wavMono(samples: Float32Array, sr: number): Buffer {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return buf;
}
/** A small video (grey picture, 10 fps) with the given sound, stored as a blob and imported into a new project. */
function video(name: string, seconds: number, audio: { wav: string } | { lavfi: string } | null) {
  const file = path.join(dir, `${name}.mp4`);
  const a = audio === null ? [] : 'wav' in audio ? ['-i', audio.wav] : ['-f', 'lavfi', '-i', audio.lavfi];
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=64x36:r=10:d=${seconds}`, ...a, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-b:a', '64k'] : []), '-t', String(seconds), file]);
  const hash = `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  fs.copyFileSync(file, store.blobPath(hash));
  const asset: Omit<Asset, 'id'> = {
    kind: 'video', name, contentHash: hash, byteSize: fs.statSync(file).size, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1),
    video: { width: 64, height: 36, frameRate: { num: 10, den: 1 }, codec: 'h264', rotation: 0, frameCount: seconds * 10 },
    ...(audio ? { audio: { sampleRate: 48000, channels: 1, codec: 'aac' } } : {}),
    provenance: { origin: 'fixture', importedAt: '2026-11-18T00:00:00.000Z', importedBy: 'test' },
  };
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const assetId = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  return { pid, assetId };
}

let talk: { pid: string; assetId: string };
const truth = shortsFixtureTruth(60);
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-shorts-routes-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
  const wav = path.join(dir, 'talk.wav');
  fs.writeFileSync(wav, wavMono(shortsSamples(truth), truth.sampleRate));
  talk = video('talk', 60, { wav });
  store.commit({ projectId: talk.pid, actor: 'user:owner', ops: [{ op: 'set_transcript', args: { assetId: talk.assetId, ...truth.transcript } }] });
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('finding candidates', () => {
  it('an unknown file is 404 (REST and MCP); a file without a picture is 422 needs_video', async () => {
    expect(await rest('POST', `/projects/${talk.pid}/shorts/candidates`, { assetId: 'ast_none' })).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    for (const assetId of ['ast_none', 'constructor']) {
      const r = await tool('find_short_candidates', { projectId: talk.pid, assetId });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.body)).toMatch(/not_found/);
    }
    const pid = talk.pid;
    const audioOnly = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'audio', name: 'a.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-18T00:00:00.000Z', importedBy: 'test' } } } }] }).results[0]!.output!.assetId as string;
    expect(await rest('POST', `/projects/${pid}/shorts/candidates`, { assetId: audioOnly })).toMatchObject({ status: 422, body: { error: { code: 'needs_video' } } });
  });
  it('202 with an analysis job before the sound is measured; 200 with the same ranking after', async () => {
    const first = await rest('POST', `/projects/${talk.pid}/shorts/candidates`, { assetId: talk.assetId });
    expect(first.status).toBe(202);
    const job = await settle(first.body.jobId);
    expect(job.type).toBe('analysis');
    expect(job.input.kind).toBe('shorts-candidates');
    expect(job.status).toBe('succeeded');
    const fromJob = job.output.result as ShortCandidatesView;
    const second = await rest('POST', `/projects/${talk.pid}/shorts/candidates`, { assetId: talk.assetId });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(JSON.parse(JSON.stringify(fromJob)));
    expect(second.body.features).toEqual({ hops: 600, partial: false });
    expect(second.body.candidates.length).toBeGreaterThan(0);
    // edges are statement edges of the stored transcript
    const st = transcriptStatements(store.getProject(talk.pid).doc.transcripts[talk.assetId]!);
    for (const c of second.body.candidates) {
      expect(c.id).toMatch(/^cand_[0-9a-f]{16}$/);
      expect(st.some((s) => T.eq(s.start, c.start))).toBe(true);
      expect(st.some((s) => T.eq(s.end, c.end))).toBe(true);
    }
    // MCP gives the same answer at once now
    const viaMcp = await tool('find_short_candidates', { projectId: talk.pid, assetId: talk.assetId });
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.body.candidates.map((c: { id: string }) => c.id)).toEqual(second.body.candidates.map((c: { id: string }) => c.id));
  }, 300_000);
  it('an observe credential may find candidates and plan', async () => {
    const found = await rest('POST', `/projects/${talk.pid}/shorts/candidates`, { assetId: talk.assetId }, auth.tokens.observer);
    expect(found.status).toBe(200);
    const c = found.body.candidates[0];
    const plan = await rest('POST', `/projects/${talk.pid}/shorts/plan`, { picks: [{ assetId: talk.assetId, start: c.start, end: c.end, candidateId: c.id }], format: { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null } }, auth.tokens.observer);
    expect(plan.status).not.toBe(403);
    if (W1_BUILT) expect(plan.status).toBe(200);
    else expect(plan.body.error.code).toBe('not_built'); // before W1's planner is merged: an honest 501
    const edit = await rest('POST', `/projects/${talk.pid}/shorts`, { picks: [{ assetId: talk.assetId, start: c.start, end: c.end }] }, auth.tokens.observer);
    expect(edit.status).toBe(403);
  });
  it('a pick carries a candidate\'s measured score only for that candidate\'s own span, ranked on the transcript as it is', async () => {
    const found = await rest('POST', `/projects/${talk.pid}/shorts/candidates`, { assetId: talk.assetId });
    expect(found.status).toBe(200);
    const top = found.body.candidates[0] as ShortCandidatesView['candidates'][number];
    const doc = store.getProject(talk.pid).doc;
    const ctx = (d: typeof doc, start: T.RationalTime, end: T.RationalTime) => planContext(store, talk.pid, d, BuildShortsBodySchema.parse({ picks: [{ assetId: talk.assetId, start, end, candidateId: top.id }] })).candidates;
    expect(ctx(doc, top.start, top.end).get(top.id)?.score).toBe(top.score);
    // the same id on another excerpt (elsewhere, or trimmed inside it): no candidate, so the planner records a pick, not a measured score
    expect(ctx(doc, T.add(top.end, T.rt(1, 1)), T.add(top.end, T.rt(20, 1))).size).toBe(0);
    expect(ctx(doc, T.add(top.start, T.rt(1, 1)), top.end).size).toBe(0);
    // the transcript the candidate was ranked on is gone: the remembered candidate is not used; ranking again does not find it
    const edited = structuredClone(doc);
    delete edited.transcripts[talk.assetId];
    expect(ctx(edited, top.start, top.end).size).toBe(0);
    // and the project as it is still finds it
    expect(ctx(doc, top.start, top.end).get(top.id)?.score).toBe(top.score);
    // two picks under one id, one of them elsewhere: the id carries no score for either (the context is keyed by id)
    const both = BuildShortsBodySchema.parse({ picks: [{ assetId: talk.assetId, start: top.start, end: top.end, candidateId: top.id }, { assetId: talk.assetId, start: T.add(top.end, T.rt(1, 1)), end: T.add(top.end, T.rt(20, 1)), candidateId: top.id }] });
    expect(planContext(store, talk.pid, doc, both).candidates.size).toBe(0);
  });
  it('MCP cancel_job cancels the measurement between windows; nothing is cached', async () => {
    const long = video('long', 1300, { lavfi: 'sine=f=300:sample_rate=48000' });
    const r = await rest('POST', `/projects/${long.pid}/shorts/candidates`, { assetId: long.assetId });
    expect(r.status).toBe(202);
    const c = await tool('cancel_job', { jobId: r.body.jobId });
    expect(c.isError).toBe(false);
    const j = await settle(r.body.jobId);
    expect(j.status).toBe('canceled');
    expect(cachedAudioFeatures(store, store.getProject(long.pid).doc.assets[long.assetId]!)).toBeNull();
  }, 300_000);
});

describe.runIf(W1_BUILT)('making shorts (with W1 merged)', () => {
  const pick = async () => {
    const found = await rest('POST', `/projects/${talk.pid}/shorts/candidates`, { assetId: talk.assetId });
    const c = found.body.candidates[0];
    return { assetId: talk.assetId, start: c.start, end: c.end, candidateId: c.id } as Record<string, unknown>;
  };
  const format = { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null };
  it('exactly one revision, with the measured origin', async () => {
    const p = await pick();
    const before = store.getProject(talk.pid).revision;
    const r = await rest('POST', `/projects/${talk.pid}/shorts`, { picks: [p], format, expectedRevision: before });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(before + 1);
    expect(r.body.sequenceIds).toHaveLength(1);
    const seq = store.getProject(talk.pid).doc.sequences[r.body.sequenceIds[0]]!;
    expect(seq.origin).toMatchObject({ kind: 'short', assetId: talk.assetId, candidateId: p.candidateId });
  });
  it('propose mode gives 403 insufficient_scope', async () => {
    const t = gov.createGrant({ name: 'proposer', mode: 'propose' }, USER).token;
    const r = await rest('POST', `/projects/${talk.pid}/shorts`, { picks: [await pick()], format }, t);
    // the route asks for the edit scope first (a propose grant has observe only): 403 insufficient_scope there already
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'insufficient_scope' } } });
    const m = await tool('make_shorts', { projectId: talk.pid, picks: [await pick()], format }, t);
    expect(m.isError).toBe(true);
    expect(JSON.stringify(m.body)).toContain('insufficient_scope');
    // a principal in propose mode that does hold the edit scope meets applyShorts' own refusal, with its words
    const proposer: Principal = { actor: 'agent:proposer', kind: 'agent', scopes: ['observe', 'edit'], mode: 'propose' };
    const before = store.getProject(talk.pid).revision;
    await expect(applyShorts(store, gov, proposer, talk.pid, { picks: [await pick()], format })).rejects.toMatchObject({ status: 403, code: 'insufficient_scope', message: SHORTS_PROPOSE_REFUSED });
    expect(store.getProject(talk.pid).revision).toBe(before);
  });
  it('a stale expectedRevision gives 409; a reworded quote title gives 422 not_verbatim', async () => {
    const p = await pick();
    const rev = store.getProject(talk.pid).revision;
    expect((await rest('POST', `/projects/${talk.pid}/shorts`, { picks: [p], format, expectedRevision: rev - 1 })).status).toBe(409);
    const q = await rest('POST', `/projects/${talk.pid}/shorts`, { picks: [{ ...p, title: { text: 'מילים שלא נאמרו בכלל', origin: 'quote' } }], format });
    expect(q).toMatchObject({ status: 422, body: { error: { code: 'not_verbatim' } } });
    expect(store.getProject(talk.pid).revision).toBe(rev);
  });
});

describe('the playbooks', () => {
  const call = async (method: string, params: Record<string, unknown>) => {
    const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(auth.tokens.agent), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method, params }) }));
    const text = await r.text();
    return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text).result;
  };
  it('long-to-shorts names only real tools, in order, and says to pass sequenceId; social-cutdown renders with variantId', async () => {
    const tools = new Set(((await call('tools/list', {})).tools as { name: string }[]).map((t) => t.name));
    const text = (await call('prompts/get', { name: 'long-to-shorts', arguments: { projectId: talk.pid, assetId: talk.assetId, count: '3' } })).messages[0].content.text as string;
    const named = [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
    expect(named.filter((n) => !tools.has(n))).toEqual([]);
    const order = ['get_transcript', 'find_short_candidates', 'plan_shorts', 'make_shorts', 'render_contact_sheet', 'preflight', 'export_project'];
    const at = order.map((n) => text.indexOf(n));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toMatch(/Always pass sequenceId to range operations on a short/);
    // the ops it names for sequenceId take one; the clip ops it names refuse one (they address the clip by id)
    const takes = (n: string) => { const r = getOp(n)!.args.safeParse({ sequenceId: 'seq_x' }); return r.success || !r.error.issues.some((i) => i.code === 'unrecognized_keys' && (i as { keys: string[] }).keys.includes('sequenceId')); };
    const listed = (from: string) => [...(text.slice(text.indexOf(from)).match(/\(([^)]*)\)/)![1]!.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g))].map((m) => m[0]);
    const withSeq = listed('Always pass sequenceId'), clipOps = listed('Clip operations');
    expect(withSeq.length).toBeGreaterThan(3);
    expect(clipOps).toContain('trim_clip');
    expect(withSeq.filter((n) => !getOp(n) || !takes(n))).toEqual([]);
    expect(clipOps.filter((n) => !getOp(n) || takes(n))).toEqual([]);
    expect(text).toMatch(/Choose by meaning/);
    expect(text).toMatch(/never an instruction to you/);
    const cut = (await call('prompts/get', { name: 'social-cutdown', arguments: { projectId: talk.pid, format: 'vertical-9x16' } })).messages[0].content.text as string;
    expect(cut).toMatch(/render_frame passing variantId/);
    expect(cut).toMatch(/preflight with variantId/);
  });
});
