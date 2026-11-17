import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from './governance.ts';
import { addElement, addSfx } from './http.ts';
import { startServer, type RunningServer } from './index.ts';
import { SFX } from './sfx.ts';

/**
 * Built-in sounds and graphic elements over the real routes (real ffmpeg): a refused placement changes nothing,
 * a pause during synthesis holds, many sound previews at once are bounded, and element pictures respect the storage ceiling.
 */
const OWNER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const at = (frame: number) => ({ value: String(frame), timescale: 30 });

describe('adding a sound or an element: a refused placement leaves the project unchanged', () => {
  let s: RunningServer;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-synth-routes-'));
  let h: Record<string, string> = {};
  const post = (p: string, body: unknown) => fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const project = async (pid: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json()) as { revision: number; project: { assets: Record<string, { name: string }>; sequences: Record<string, { tracks: { id: string; kind: string; clips: unknown[] }[] }> } };
  const shape = async (pid: string) => { const p = await project(pid); return { revision: p.revision, assets: Object.values(p.project.assets).map((a) => a.name), clips: Object.values(p.project.sequences).flatMap((q) => q.tracks).reduce((n, t) => n + t.clips.length, 0) }; };
  const create = async (name: string) => ((await (await post('/projects', { name, width: 640, height: 360, frameRate: { num: 30, den: 1 } })).json()) as { project: { id: string } }).project.id;
  beforeAll(async () => { s = await startServer({ port: 8991, dataDir: dir }); h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' }; }, 60_000);
  afterAll(async () => { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('element: start off the frame grid, unknown track, zero duration, occupied track -> error and no asset, no revision', async () => {
    const pid = await create('refused element');
    const before = await shape(pid);
    expect(before).toEqual({ revision: 0, assets: [], clips: 0 });
    const tries: [unknown, number, string][] = [
      [{ elementId: 'element.shape.circle', start: { value: '1', timescale: 7 } }, 422, 'invalid_args'],
      [{ elementId: 'element.shape.circle', color: '#FF0000', start: { value: '1', timescale: 7 } }, 422, 'invalid_args'], // another colour is another picture: used to leave a second orphan
      [{ elementId: 'element.shape.circle', start: at(0), trackId: 'trk_nope' }, 404, 'not_found'],
      [{ elementId: 'element.shape.circle', start: at(0), duration: at(0) }, 422, 'invalid_args'],
    ];
    for (const [body, status, code] of tries) {
      const r = await post(`/projects/${pid}/elements`, body);
      expect([r.status, ((await r.json()) as { error: { code: string } }).error.code], JSON.stringify(body)).toEqual([status, code]);
      expect(await shape(pid), JSON.stringify(body)).toEqual(before);
    }
    // the same request with a valid place is accepted: two transactions as before (the picture, then its clip)
    const ok = await post(`/projects/${pid}/elements`, { elementId: 'element.shape.circle', start: at(30), duration: at(60) });
    expect(ok.status).toBe(201);
    const added = (await ok.json()) as { assetId: string; revision: number; placed: { clipId: string } };
    expect(added.revision).toBe(2);
    expect(added.placed.clipId).toBeTruthy();
    expect(await shape(pid)).toEqual({ revision: 2, assets: ['Circle.png'], clips: 1 });
    // an explicit track that is taken at that time: refused, and the new colour's picture is not added
    const taken = (await project(pid)).project.sequences;
    const trackId = Object.values(taken).flatMap((q) => q.tracks).find((t) => t.clips.length)!.id;
    const overlap = await post(`/projects/${pid}/elements`, { elementId: 'element.shape.circle', color: '#00FF00', start: at(45), trackId });
    expect(overlap.status).toBe(422);
    expect(await shape(pid)).toEqual({ revision: 2, assets: ['Circle.png'], clips: 1 });
    // without a place it is only added to the library
    const lib = await post(`/projects/${pid}/elements`, { elementId: 'element.shape.star-5' });
    expect(lib.status).toBe(201);
    expect((await lib.json() as { placed: unknown }).placed).toBeNull();
    expect((await shape(pid)).revision).toBe(3);
  }, 60_000);

  it('sound: the same rule (addSfx had the same order of steps)', async () => {
    const pid = await create('refused sound');
    const before = await shape(pid);
    for (const [body, status, code] of [
      [{ sfxId: 'sfx.ding', start: { value: '1', timescale: 7 } }, 422, 'invalid_args'],
      [{ sfxId: 'sfx.ding', start: at(0), trackId: 'trk_nope' }, 404, 'not_found'],
    ] as [unknown, number, string][]) {
      const r = await post(`/projects/${pid}/sfx`, body);
      expect([r.status, ((await r.json()) as { error: { code: string } }).error.code], JSON.stringify(body)).toEqual([status, code]);
      expect(await shape(pid), JSON.stringify(body)).toEqual(before);
    }
    const ok = await post(`/projects/${pid}/sfx`, { sfxId: 'sfx.ding', start: at(15) });
    expect(ok.status).toBe(201);
    expect(await shape(pid)).toEqual({ revision: 2, assets: ['Ding.wav'], clips: 1 });
    // the stored sound is the corrected recipe where there is one: version 2 in its provenance
    const clap = await post(`/projects/${pid}/sfx`, { sfxId: 'sfx.clap' });
    const clapId = ((await clap.json()) as { assetId: string }).assetId;
    expect(((await project(pid)).project.assets[clapId] as unknown as { provenance: { procedural: { id: string; version: number } } }).provenance.procedural).toMatchObject({ id: 'sfx.clap', version: 2 });
  }, 60_000);

  it('an agent whose owner presses Pause while the picture or sound is being made writes nothing', async () => {
    const pid = await create('pause race');
    const { token } = s.governance.createGrant({ name: 'racer', mode: 'edit' }, OWNER);
    const agent = s.governance.principalForToken(token)!;
    for (const start of [
      () => addElement(s.store, s.governance, agent, pid, { elementId: 'element.shape.square', color: '#123456' }),
      () => addElement(s.store, s.governance, agent, pid, { elementId: 'element.shape.square', color: '#123457', start: at(0) }),
      () => addSfx(s.store, s.governance, agent, pid, { sfxId: 'sfx.pop' }),
    ]) {
      const pending = start(); // has passed the first check and is now waiting for ffmpeg
      s.governance.setPaused(pid, true, OWNER);
      await expect(pending).rejects.toMatchObject({ status: 423, code: 'agent_paused' });
      expect(await shape(pid)).toEqual({ revision: 0, assets: [], clips: 0 });
      expect(s.store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE project_id = ?').get(pid)).toEqual({ n: 0 });
      s.governance.setPaused(pid, false, OWNER);
    }
    // not paused: the same agent call goes through
    const done = await addElement(s.store, s.governance, agent, pid, { elementId: 'element.shape.square', color: '#123456', start: at(0) });
    expect(done.revision).toBe(2);
    expect(await shape(pid)).toEqual({ revision: 2, assets: ['Square.png'], clips: 1 });
  }, 60_000);

  it('a read-only credential asking for every sound at once is held to the queue: 200 or 429 with Retry-After, never an error, and the server recovers', async () => {
    const ro = { authorization: `Bearer ${s.auth.tokens.observer}`, connection: 'close' };
    const audio = (id: string) => fetch(`${s.url}/api/v1/sfx/${id}/audio`, { headers: ro });
    // the long sounds first, so the two running ones are still busy while the rest arrive
    const ids = [...SFX].sort((a, b) => b.seconds - a.seconds).map((x) => x.id);
    const all = await Promise.all(ids.map(async (id) => { const r = await audio(id); return { id, status: r.status, retry: r.headers.get('retry-after'), type: r.headers.get('content-type'), body: r.status === 200 ? Buffer.from(await r.arrayBuffer()) : await r.json() }; }));
    const ok = all.filter((r) => r.status === 200), busy = all.filter((r) => r.status === 429);
    expect(ok.length + busy.length).toBe(80);
    expect(ok.length).toBeGreaterThanOrEqual(18); // two running and sixteen waiting are always served
    expect(busy.length).toBeGreaterThan(0);
    for (const r of ok) { expect(r.type).toBe('audio/wav'); expect((r.body as Buffer).subarray(0, 4).toString('ascii')).toBe('RIFF'); }
    for (const r of busy) { expect(r.retry).toBe('2'); expect((r.body as { error: { code: string; details: unknown } }).error).toMatchObject({ code: 'synthesis_busy', details: { retryAfterSeconds: 2 } }); }
    // nothing is stuck afterwards: a refused sound can be fetched, and an unknown one is still a plain 404
    const again = await audio(busy[0]!.id);
    expect(again.status).toBe(200);
    expect((await audio('sfx.nope')).status).toBe(404);
    expect(fs.readdirSync(s.store.tmpDir).filter((f) => f.startsWith('sfxp_'))).toEqual([]);
  }, 120_000);
});

describe('element pictures and the storage ceiling', () => {
  let s: RunningServer;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-synth-quota-'));
  const QUOTA = 3_000_000;
  let h: Record<string, string> = {};
  const post = (p: string, body: unknown) => fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  beforeAll(async () => { s = await startServer({ port: 8992, dataDir: dir, maxStorageBytes: QUOTA }); h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' }; }, 60_000);
  afterAll(async () => { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('once the ceiling is reached a new picture is refused with 507 on the route and for the agent tool alike, and nothing is added', async () => {
    const pid = ((await (await post('/projects', { name: 'quota' })).json()) as { project: { id: string } }).project.id;
    expect((await post(`/projects/${pid}/elements`, { elementId: 'element.symbol.check', color: '#00AA00' })).status).toBe(201);
    fs.writeFileSync(path.join(dir, 'filler.bin'), Buffer.alloc(QUOTA)); // stands in for accumulated media and exports
    const refused = await post(`/projects/${pid}/elements`, { elementId: 'element.symbol.check', color: '#00AA01', start: at(0) });
    expect(refused.status).toBe(507);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('storage_quota_exceeded');
    // add_graphic_element calls this function with the same store
    const agent: Principal = { actor: 'agent:test', kind: 'agent', scopes: ['observe', 'edit'] };
    await expect(addElement(s.store, s.governance, agent, pid, { elementId: 'element.symbol.check', color: '#00AA02' })).rejects.toMatchObject({ status: 507, code: 'storage_quota_exceeded' });
    const now = s.store.getProject(pid);
    expect([now.revision, Object.keys(now.doc.assets).length]).toEqual([1, 1]);
    // the picture that is already stored needs no room
    expect((await post(`/projects/${pid}/elements`, { elementId: 'element.symbol.check', color: '#00AA00' })).status).toBe(201);
    fs.rmSync(path.join(dir, 'filler.bin'));
    expect((await post(`/projects/${pid}/elements`, { elementId: 'element.symbol.check', color: '#00AA01', start: at(0) })).status).toBe(201);
  }, 60_000);
});
