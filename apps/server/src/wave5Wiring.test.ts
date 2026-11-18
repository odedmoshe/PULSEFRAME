/**
 * The lead's wiring of wave 5 on a real server (startServer): the import queue and the phone drop on the main listener
 * (ADR-0023), the render cache's routes and the privacy purge in the commit path (ADR-0024). The builders' own tests cover the
 * queue, the door and the store; these cover what only the wiring decides: which routes exist and who may call them, that the
 * synchronous upload route keeps its answer through the queue, that a privacy change purges in the same commit path (and an
 * unrelated edit does not), that a running export cannot store a segment after the purge or after the project was deleted,
 * and the two new refusals (shutting_down, render_cache_purged) with their words.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlashCells } from '@pulseframe/engine';
import { startServer, type RunningServer } from './index.ts';
import type { SegmentPin } from './segmentStore.ts';

let s: RunningServer;
let dir: string;
let clipFile: string;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
type Res = { status: number; body: any; headers: Headers };
async function call(token: string, p: string, init: RequestInit = {}): Promise<Res> {
  const r = await fetch(`${s.url}/api/v1${p}`, { ...init, headers: { authorization: `Bearer ${token}`, connection: 'close', ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) } });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, headers: r.headers };
}
const agent = (p: string, init?: RequestInit) => call(s.auth.tokens.agent, p, init);
/** The owner's own session: a browser cookie issued for the launch secret (never a bearer token). */
let ownerCookie = '';
const owner = async (p: string, init: RequestInit = {}): Promise<Res> => {
  const r = await fetch(`${s.url}/api/v1${p}`, { ...init, headers: { cookie: ownerCookie, origin: s.url, connection: 'close', ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) } });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, headers: r.headers };
};
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const upload = (who: typeof agent, route: string, bytes: Buffer, name: string, headers: Record<string, string> = {}) =>
  who(route, { method: 'POST', body: new Uint8Array(bytes), headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name), ...headers } });
async function waitJob(id: string): Promise<any> {
  for (let i = 0; i < 600; i++) { const j = (await agent(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`job ${id} did not finish`);
}
async function newProject(name: string): Promise<string> { return (await agent('/projects', post({ name }))).body.project.id; }
const tx = (projectId: string, ops: unknown[]) => agent(`/projects/${projectId}/transactions`, post({ ops }));
/** A stored segment put through the store's own API with this export's pin (the bytes are never decoded by the store). */
let n = 0;
async function putSegment(pin: SegmentPin, projectId: string): Promise<string> {
  const file = path.join(dir, `seg${n}.bin`);
  fs.writeFileSync(file, Buffer.alloc(500, n));
  const key = sha(`wiring-segment-${n++}`);
  const cells: FlashCells[] = Array.from({ length: 3 }, () => ({ cols: 2, rows: 2, rgb: new Float32Array(12).fill(0.5) }));
  await s.renderCache.store.put(key, { videoFile: file, frames: 3, width: 64, height: 36, rgbaSha256: [sha('a'), sha('b'), sha('c')], ptsOffsetTicks: 1024, cells, renderMs: 30, projectId }, pin);
  return key;
}
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wave5-wiring-'));
  clipFile = path.join(dir, 'clip.mp4');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipFile]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  s = await startServer({ port: 21000 + Math.floor(Math.random() * 20000), dataDir: path.join(dir, 'data'), dropPort: 0, dropAdmitAddresses: ['127.0.0.1'] });
  ownerCookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
}, 120_000);
afterAll(async () => { await s?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('imports on the main listener (ADR-0023)', () => {
  it('POST …/assets goes through the queue and keeps its 201 body, naming the import job in X-PF-Import-Job', async () => {
    const pid = await newProject('wiring assets');
    const r = await upload(agent, `/projects/${pid}/assets`, fs.readFileSync(clipFile), 'קליפ.mp4');
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(['asset', 'assetId', 'deduplicated', 'revision']);
    expect(r.body.asset.name).toBe('קליפ.mp4');
    const jobId = r.headers.get('x-pf-import-job');
    expect(jobId).toMatch(/^job_/);
    const job = await waitJob(jobId!);
    expect(job).toMatchObject({ type: 'import', status: 'succeeded' });
    expect(job.output.assetId).toBe(r.body.assetId);
    // the synchronous route commits as an edit, so the uploader's Ctrl+Z still removes it (as before the queue)
    const undo = await agent(`/projects/${pid}/undo`, post());
    expect(undo.status).toBe(200);
    expect((await agent(`/projects/${pid}`)).body.project.assets[r.body.assetId]).toBeUndefined();
  }, 120_000);
  it('a malformed x-filename is 400 invalid_filename, not a server error (review item: it used to be a 500)', async () => {
    const pid = await newProject('wiring names');
    const r = await agent(`/projects/${pid}/assets`, { method: 'POST', body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'application/octet-stream', 'x-filename': '%E0%A4%A' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_filename');
  });
  it('POST …/imports answers 202 with the job before it is converted, as a background commit; GET lists open and failed ones; a failed one can be dismissed by its sender', async () => {
    const pid = await newProject('wiring queue');
    const r = await upload(agent, `/projects/${pid}/imports`, fs.readFileSync(clipFile), 'b.mp4', { 'x-pf-via': 'browser', 'x-pf-batch': 'b1', 'x-pf-last-modified': '1700000000000' });
    expect(r.status).toBe(202);
    expect(r.body.job).toMatchObject({ name: 'b.mp4', via: 'browser', batchId: 'b1' });
    const done = await waitJob(r.body.job.jobId);
    expect(done.status).toBe('succeeded');
    // background: Ctrl+Z of the same actor has nothing to undo (the import is off the default undo stack)
    expect((await agent(`/projects/${pid}/undo`, post())).body.error.code).toBe('nothing_to_undo');
    const junk = await upload(agent, `/projects/${pid}/imports`, Buffer.from('not a video at all, just text'), 'junk.mp4');
    expect(junk.status).toBe(202);
    const failed = await waitJob(junk.body.job.jobId);
    expect(failed.status).toBe('failed');
    const listed = (await agent(`/projects/${pid}/imports`)).body;
    expect(listed.imports.map((j: any) => j.jobId)).toEqual([junk.body.job.jobId]);
    expect(listed.room).toHaveProperty('maxFileBytes');
    expect((await agent(`/jobs/${junk.body.job.jobId}/dismiss`, post())).body).toEqual({ jobId: junk.body.job.jobId, dismissed: true });
    expect((await agent(`/projects/${pid}/imports`)).body.imports).toEqual([]);
    // dismiss of a job of another kind is refused with not_an_import
    const exp = s.store.createJob(pid, 'analysis', 'agent:local', {});
    expect((await agent(`/jobs/${exp.id}/dismiss`, post())).body.error.code).toBe('not_an_import');
    // files from a phone arrive through the door only
    expect((await upload(agent, `/projects/${pid}/imports`, Buffer.from('x'), 'p.mp4', { 'x-pf-via': 'phone' })).status).toBe(400);
  }, 120_000);
  it('cancel and retry of an import go through the import guard: an agent cannot touch the owner\'s import (not_your_job)', async () => {
    const pid = await newProject('wiring guard');
    const r = await upload(owner, `/projects/${pid}/imports`, Buffer.from('still not a video'), 'o.mp4');
    const failed = await waitJob(r.body.job.jobId);
    expect(failed.status).toBe('failed');
    expect((await agent(`/jobs/${failed.id}/retry`, post())).body.error.code).toBe('not_your_job');
    expect((await agent(`/jobs/${failed.id}/cancel`, post())).body.error.code).toBe('not_your_job');
    expect((await agent(`/jobs/${failed.id}/dismiss`, post())).body.error.code).toBe('not_your_job');
    // the owner may: an unsupported file's original is removed at once, so its retry is refused honestly (original_gone)
    expect((await owner(`/jobs/${failed.id}/retry`, post())).body.error.code).toBe('original_gone');
    expect((await owner(`/jobs/${failed.id}/cancel`, post())).body).toMatchObject({ outcome: 'already-finished' });
  }, 60_000);
});

describe('the phone drop routes are the owner\'s alone (ADR-0023)', () => {
  it('an agent can neither list addresses, open, read nor close a code; the owner must name the address', async () => {
    const pid = await newProject('wiring drop');
    expect((await agent('/drop/addresses')).body.error.code).toBe('owner_required');
    expect((await agent(`/projects/${pid}/drop`, post({ address: '127.0.0.1' }))).body.error.code).toBe('owner_required');
    expect((await agent(`/projects/${pid}/drop`)).body.error.code).toBe('owner_required');
    const missing = await owner(`/projects/${pid}/drop`, post({}));
    expect(missing.status).toBe(400);
    expect((await owner(`/projects/${pid}/drop`, post({ address: '0.0.0.0' }))).body.error.code).toBe('invalid_address');
    const addresses = (await owner('/drop/addresses')).body.addresses;
    expect(addresses.map((a: any) => a.address)).toContain('127.0.0.1'); // admitted by the test's startServer override only
    const opened = await owner(`/projects/${pid}/drop`, post({ address: '127.0.0.1' }));
    expect(opened.status).toBe(201);
    const drop = opened.body.drop;
    expect(drop.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#[A-Za-z0-9_-]+$/);
    expect(drop.pin).toMatch(/^\d{6}$/);
    // the second listener serves the page, and nothing of the main app
    const page = await fetch(drop.url.replace(/#.*$/, ''), { headers: { connection: 'close' } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<html lang="he" dir="rtl"');
    const api = await fetch(drop.url.replace(/\/#.*$/, '/api/v1/session'), { headers: { connection: 'close' } });
    expect(api.status).toBe(404);
    expect((await owner(`/projects/${pid}/drop`)).body.drop.dropId).toBe(drop.dropId);
    expect((await agent(`/projects/${pid}/drop/${drop.dropId}/close`, post())).body.error.code).toBe('owner_required');
    expect((await owner(`/projects/${pid}/drop/nope/close`, post())).body.error.code).toBe('drop_not_found');
    const closed = await owner(`/projects/${pid}/drop/${drop.dropId}`, { method: 'DELETE' });
    expect(closed.body.drop).toMatchObject({ state: 'closed', closeReason: 'owner', url: null, pin: null });
    expect((await owner(`/projects/${pid}/drop`)).body.drop).toBeNull();
    await expect(fetch(drop.url.replace(/#.*$/, ''), { headers: { connection: 'close' } })).rejects.toThrow(); // the listener is gone
  }, 60_000);
});

describe('render cache routes and the privacy purge (ADR-0024)', () => {
  let pid: string;
  let clipId: string;
  beforeAll(async () => {
    pid = await newProject('wiring cache');
    const up = await upload(agent, `/projects/${pid}/assets`, fs.readFileSync(clipFile), 'c.mp4');
    const added = await tx(pid, [{ op: 'add_clip', args: { assetId: up.body.assetId, start: { value: '0', timescale: 1 } } }]);
    clipId = added.body.results[0].output.clipId;
  }, 120_000);
  it('the plan route keys the project with the export\'s blockers; GET status for anyone who may read, DELETE for the owner only', async () => {
    const plan = await agent(`/projects/${pid}/exports/segments/plan`, post({ format: 'mp4-h264-aac', mode: 'incremental', quality: 'draft' }));
    if (fs.existsSync(path.join(s.cfg.webDist, 'render.html'))) { // keying needs the built render bundle (its digest is part of every key)
      expect(plan.status).toBe(200);
      expect(plan.body).toMatchObject({ mode: 'incremental', frames: 60, segFrames: 60 });
      expect(plan.body.segments).toMatchObject({ total: 1, render: 1, cached: 0 });
    } else expect(plan.body.error.code).toBe('renderer_unavailable');
    expect((await agent(`/projects/${pid}/exports/segments/plan`, post({ mode: 'single-pass' }))).status).toBe(400);
    const webm = await agent(`/projects/${pid}/exports/segments/plan`, post({ format: 'webm-vp9-opus' }));
    expect(webm.status).toBe(422);
    expect(webm.body.error.details.blockers[0].code).toBe('incremental_format_unsupported');
    expect((await agent('/storage/render-cache')).body).toMatchObject({ capBytes: s.cfg.renderCacheBytes });
    expect((await agent('/storage/render-cache', { method: 'DELETE' })).body.error.code).toBe('owner_required');
    expect((await owner('/storage/render-cache', { method: 'DELETE' })).body).toMatchObject({ keptPinned: 0 });
  }, 120_000);
  it('a privacy-region change purges the project\'s segments in the commit path; an export already running cannot store another; an unrelated edit purges nothing', async () => {
    const rev = (await agent(`/projects/${pid}`)).body.revision;
    const running = s.renderCache.store.pin([], { projectId: pid, revision: rev }); // an export of this revision
    const before = await putSegment(running, pid);
    expect(s.renderCache.store.has(before)).toBe(true);
    // control: an edit that changes no privacy region keeps the cache and lets the running export go on
    expect((await tx(pid, [{ op: 'rename_asset', args: { assetId: Object.keys((await agent(`/projects/${pid}`)).body.project.assets)[0], name: 'renamed.mp4' } }])).status).toBe(200);
    expect(s.renderCache.store.has(before)).toBe(true);
    const fine = await putSegment(running, pid);
    expect(s.renderCache.store.has(fine)).toBe(true);
    // adding a region: purged at once, before the commit's answer arrives
    const add = await tx(pid, [{ op: 'set_redact_region', args: { clipId, region: { x: 0, y: 0, width: 0.3, height: 0.3 } } }]);
    expect(add.status).toBe(200);
    expect(s.renderCache.store.has(before)).toBe(false);
    expect(s.renderCache.store.has(fine)).toBe(false);
    expect(await codeOf(putSegment(running, pid))).toBe('render_cache_purged');
    running.release();
    // a new export of the new revision stores again; changing the region (strength) purges it; undo of that purges too
    const after = s.renderCache.store.pin([], { projectId: pid, revision: add.body.revision });
    const k1 = await putSegment(after, pid);
    expect(s.renderCache.store.has(k1)).toBe(true);
    const regionId = (await agent(`/projects/${pid}`)).body.project.sequences;
    const region = Object.values<any>(regionId).flatMap((q) => q.tracks).flatMap((t: any) => t.clips).find((c: any) => c.id === clipId).redact[0].id;
    const change = await tx(pid, [{ op: 'set_redact_region', args: { clipId, regionId: region, region: { strength: 0.3 } } }]);
    expect(change.status).toBe(200);
    expect(s.renderCache.store.has(k1)).toBe(false);
    expect(await codeOf(putSegment(after, pid))).toBe('render_cache_purged');
    after.release();
    // an old snapshot (a retry of the pre-redaction export) is fenced off for good
    const old = s.renderCache.store.pin([], { projectId: pid, revision: rev });
    expect(await codeOf(putSegment(old, pid))).toBe('render_cache_purged');
    old.release();
    const p3 = s.renderCache.store.pin([], { projectId: pid, revision: change.body.revision });
    const k3 = await putSegment(p3, pid);
    const undo = await agent(`/projects/${pid}/undo`, post());
    expect(undo.status).toBe(200);
    expect(s.renderCache.store.has(k3)).toBe(false);
    p3.release();
    // removing the region also counts
    const p4 = s.renderCache.store.pin([], { projectId: pid, revision: undo.body.revision });
    const k4 = await putSegment(p4, pid);
    expect((await tx(pid, [{ op: 'set_redact_region', args: { clipId, regionId: region, region: null } }])).status).toBe(200);
    expect(s.renderCache.store.has(k4)).toBe(false);
    p4.release();
  }, 120_000);
  it('deleting a project purges its segments, and an export of it still running cannot store one afterwards', async () => {
    const gone = await newProject('wiring delete');
    const pin = s.renderCache.store.pin([], { projectId: gone, revision: 0 });
    const k = await putSegment(pin, gone);
    expect(s.renderCache.store.has(k)).toBe(true);
    expect((await owner(`/projects/${gone}/delete`, post({ confirmName: 'wiring delete' }))).status).toBe(200);
    expect(s.renderCache.store.has(k)).toBe(false);
    expect(await codeOf(putSegment(pin, gone))).toBe('render_cache_purged');
    pin.release();
  });
  it('an export stopped by the purge cannot be retried (render_cache_purged with its hint): a new export is needed', async () => {
    const job = s.store.createJob(pid, 'export', 'agent:local', { revision: 1, snapshot: s.store.wholeProject(pid).doc, manifest: { options: { format: 'mp4-h264-aac', mode: 'incremental' } } });
    s.store.updateJob(job.id, { status: 'failed', error: { code: 'render_cache_purged', message: 'x', retryable: false } });
    const r = await agent(`/jobs/${job.id}/retry`, post());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('render_cache_purged');
    expect(r.body.error.hint).toMatch(/new export/i);
  });
});

describe('shutting down (last: it stops the queue)', () => {
  it('an upload while the queue stops is refused 503 shutting_down', async () => {
    const pid = await newProject('wiring stop');
    await s.imports.stop();
    const r = await upload(agent, `/projects/${pid}/imports`, Buffer.from('late'), 'late.mp4');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('shutting_down');
    const sync = await upload(agent, `/projects/${pid}/assets`, Buffer.from('late'), 'late.mp4');
    expect(sync.body.error.code).toBe('shutting_down');
  });
});
