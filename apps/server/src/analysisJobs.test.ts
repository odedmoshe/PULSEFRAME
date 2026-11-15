import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 12 s of clicks at 120 BPM as a 16-bit mono WAV: a pulse the beat tracker can follow. */
function clicks(amp = 26000) {
  const sr = 22050, n = sr * 12, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let k = 0; k < 24; k++) { const at = Math.round(k * 0.5 * sr); for (let i = 0; i < 900; i++) b.writeInt16LE(Math.round(amp * Math.exp(-i / 150) * Math.sin(i * 0.9)), 44 + (at + i) * 2); }
  return b;
}

describe('analysis as a durable job', () => {
  it('background analysis returns a job at once, attaches the same kind of result as the in-request path, survives a restart, and can be canceled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-anjob-'));
    dirs.push(dir);
    let s: RunningServer = await startServer({ port: 8971, dataDir: dir });
    const h = () => ({ authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' });
    const post = async (p: string, body: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h(), 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
    const get = async (p: string) => (await fetch(`${s.url}/api/v1${p}`, { headers: h() })).json() as Promise<any>;
    const done = async (jobId: string) => { for (let i = 0; i < 300; i++) { const j = await get(`/jobs/${jobId}`); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } throw new Error('job did not finish'); };
    try {
      const pid = (await post('/projects', { name: 'jobs' })).body.project.id;
      const up = async (name: string, amp?: number) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h(), 'x-filename': name }, body: new Uint8Array(clicks(amp)) })).json() as any).assetId as string;
      const assetId = await up('clicks.wav');

      // refused before any job exists: the wrong kind of media
      const wrong = await post(`/projects/${pid}/assets/${assetId}/analyze`, { kind: 'scenes', background: true });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.code).toBe('no_video');

      const started = await post(`/projects/${pid}/assets/${assetId}/analyze`, { kind: 'beats', background: true });
      expect(started.status).toBe(202);
      expect(['queued', 'running']).toContain(started.body.status);
      const job = await done(started.body.jobId);
      expect(job.status).toBe('succeeded');
      expect(job.type).toBe('analysis');
      expect(job.output.beats.count).toBeGreaterThanOrEqual(20);
      expect(Math.abs(job.output.beats.bpm - 120)).toBeLessThan(2);
      const viaJob = await get(`/projects/${pid}/assets/${assetId}/analysis`);
      const sync = await post(`/projects/${pid}/assets/${assetId}/analyze`, { kind: 'beats' }); // the in-request path on the same file
      expect(sync.status).toBe(200);
      expect(sync.body.beats.beatSeconds).toEqual(viaJob.beats.beatSeconds);
      expect((await get(`/projects/${pid}`)).revision).toBe(job.output.revision + 1);

      // cancel: a queued job is removed; a finished one says so
      const queued = s.store.createJob(pid, 'analysis', 'agent:local', { assetId, kind: 'beats' });
      expect((await post(`/jobs/${queued.id}/cancel`, {})).body).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' });
      expect((await post(`/jobs/${job.id}/cancel`, {})).body).toMatchObject({ status: 'succeeded', outcome: 'already-finished' });

      // restart: one job was "running" when the process stopped, another must not overwrite a hand correction made meanwhile
      const other = await up('quieter.wav', 20000); // different bytes: a second asset
      expect(other).not.toBe(assetId);
      const interrupted = s.store.createJob(pid, 'analysis', 'agent:local', { assetId: other, kind: 'beats', overwrite: true });
      s.store.updateJob(interrupted.id, { status: 'running', stage: 'measuring' });
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'edit_analysis', args: { assetId, kind: 'beats', add: [{ value: '1', timescale: 4 }] } }] }); // hand correction
      const stale = s.store.createJob(pid, 'analysis', 'agent:local', { assetId, kind: 'beats' }); // queued without overwrite
      await s.close();
      s = await startServer({ port: 8972, dataDir: dir });
      const recovered = await done(interrupted.id);
      expect(recovered.status).toBe('succeeded');
      expect(recovered.output.beats.count).toBeGreaterThanOrEqual(20);
      const refused = await done(stale.id);
      expect(refused.status).toBe('failed');
      expect(refused.error.code).toBe('would_discard_edits');
    } finally { await s.close(); }
  }, 120_000);
});
