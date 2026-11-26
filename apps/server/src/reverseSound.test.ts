import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.ts';

/**
 * A sound clip played backwards, through the real server export (ffmpeg decode + the shared mixer).
 * Source: 2 s of silence with one tone burst that starts abruptly at 0.5 s and decays to nothing by 0.7 s.
 * Played backwards the burst must occupy 1.3–1.5 s, rising slowly and ending abruptly at 1.5 s.
 */
const SR = 48000;
function burstWav() {
  const n = SR * 2, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  const from = SR * 0.5, len = SR * 0.2;
  for (let i = 0; i < len; i++) b.writeInt16LE(Math.round(24000 * (1 - i / len) * Math.sin((2 * Math.PI * 1000 * i) / SR)), 44 + (from + i) * 2);
  return b;
}
/** Peak level in 10 ms windows of a 16-bit stereo WAV file (channel 0). */
function envelope(wav: Buffer) {
  const data = wav.indexOf(Buffer.from('data')) + 8;
  const frames = Math.floor((wav.length - data) / 4), win = SR / 100;
  const out: number[] = [];
  for (let w = 0; w * win < frames; w++) { let p = 0; for (let i = w * win; i < Math.min(frames, (w + 1) * win); i++) p = Math.max(p, Math.abs(wav.readInt16LE(data + i * 4))); out.push(p); }
  return { frames, levels: out };
}
const f = (n: number) => ({ value: String(n), timescale: 30 });

describe('reversed sound in the server export', () => {
  let s: RunningServer;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-revsound-'));
  let h: Record<string, string>;
  const post = async (p: string, body: unknown) => (await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
  const wavOf = async (pid: string, body: unknown) => {
    const job = await post(`/projects/${pid}/exports`, body);
    for (let i = 0; i < 300; i++) { const j: any = await (await fetch(`${s.url}/api/v1/jobs/${job.jobId}`, { headers: h })).json(); if (j.status === 'succeeded') break; if (['failed', 'canceled'].includes(j.status)) throw new Error(`export ${j.status}: ${JSON.stringify(j.error)}`); await new Promise((r) => setTimeout(r, 100)); }
    return Buffer.from(await (await fetch(`${s.url}/api/v1/jobs/${job.jobId}/output`, { headers: h })).arrayBuffer());
  };
  beforeAll(async () => { s = await startServer({ port: 0, dataDir: dir }); h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' }; }, 60_000);
  afterAll(async () => { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('a reversed clip is heard mirrored in time, also when only part of it is exported and at double speed', async () => {
    const pid = (await post('/projects', { name: 'rev sound', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'burst.wav' }, body: new Uint8Array(burstWav()) })).json();
    const added = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
    const clipId = added.results[0].output.audioClipId ?? added.results[0].output.clipId;
    const loud = (e: { levels: number[] }) => { const on = e.levels.map((v, i) => (v > 1500 ? i : -1)).filter((i) => i >= 0); return on.length ? [on[0]! / 100, (on.at(-1)! + 1) / 100] : null; };

    const fwd = envelope(await wavOf(pid, { format: 'wav' }));
    expect(fwd.frames).toBe(SR * 2);
    expect(loud(fwd)![0]).toBeCloseTo(0.5, 1);
    expect(fwd.levels[50]!).toBeGreaterThan(fwd.levels[62]!); // loud at its start, fading

    const r = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }] });
    expect(r.revision).toBeGreaterThan(added.revision);
    const rev = envelope(await wavOf(pid, { format: 'wav' }));
    expect(rev.frames).toBe(SR * 2);
    const span = loud(rev)!;
    expect(span[1]).toBeCloseTo(1.5, 1); // ends where the mirrored start is
    expect(span[0]).toBeGreaterThan(1.25);
    expect(rev.levels[149]!).toBeGreaterThan(rev.levels[137]!); // now rising towards its abrupt end
    expect(Math.max(...rev.levels.slice(0, 120))).toBeLessThan(200); // nothing where the forward burst was

    // only the second second of the timeline: the burst ends 0.5 s into the file
    const part = envelope(await wavOf(pid, { format: 'wav', range: { startFrame: 30, endFrame: 60 } }));
    expect(part.frames).toBe(SR);
    expect(loud(part)![1]).toBeCloseTo(0.5, 1);

    // double speed: the clip is one second long and the mirrored burst ends at 0.75 s
    await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }] });
    const fast = envelope(await wavOf(pid, { format: 'wav' }));
    expect(fast.frames).toBe(SR);
    expect(loud(fast)![1]).toBeCloseTo(0.75, 1);
    expect(loud(fast)![0]).toBeGreaterThan(0.6);
  }, 120_000);

  it('a grant can limit exports per 24 hours: starts beyond the limit get a typed 429, a refused start costs nothing, another grant is unaffected, and the limit frees up a day later', async () => {
    const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
    const owner = { cookie, origin: s.url };
    const mk = async (body: unknown) => (await (await fetch(`${s.url}/api/v1/grants`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) })).json()) as any;
    const two = await mk({ name: 'exporter', mode: 'edit', exportsPerDay: 2 });
    const same = await mk({ name: 'exporter', mode: 'edit', exportsPerDay: 2 }); // same name, separate grant: counted separately
    const free = await mk({ name: 'free', mode: 'edit' });
    expect([two.grant.exportsPerDay, free.grant.exportsPerDay]).toEqual([2, null]);
    const pid = (await post('/projects', { name: 'quota', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'burst.wav' }, body: new Uint8Array(burstWav()) })).json();
    await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
    const start = async (token: string, body: unknown = { format: 'wav' } /* sound only: needs no built web bundle */) => { const r = await fetch(`${s.url}/api/v1/projects/${pid}/exports`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
    const bad = await start(two.token, { format: 'nonsense' });
    expect(bad.status).toBeGreaterThanOrEqual(400); // refused before any job: must not use up the quota
    expect([(await start(two.token)).status, (await start(two.token)).status]).toEqual([202, 202]);
    const over = await start(two.token);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('export_quota_exceeded');
    expect(over.body.error.details).toMatchObject({ limitPerDay: 2, usedInLast24h: 2 });
    expect((await start(same.token)).status).toBe(202);
    expect((await start(free.token)).status).toBe(202);
    const realNow = Date.now;
    try { (s.governance as any).clock = () => realNow() + 24 * 3600_000 + 1000; expect((await start(two.token)).status).toBe(202); } finally { (s.governance as any).clock = realNow; }
    expect((await mk({ name: 'bad', mode: 'edit', exportsPerDay: 0 })).error?.code).toBe('invalid_request');
  }, 60_000);
});
