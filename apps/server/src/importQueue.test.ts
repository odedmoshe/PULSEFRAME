/**
 * The import queue (ADR-0023, W2): plan §8 W2 cases with the verifier's corrections. Real ffmpeg and ffprobe, fixtures made
 * here (as conform.test.ts does); no server and no port is needed (the queue is driven directly). Every test injects the free
 * disk space (never the machine's own). Labelled fakes: `derivatives` is a counting stub (thumbnails are not under test), and
 * where a conversion must take long, ffmpeg is started through `sh -c 'sleep N; exec ffmpeg …'` with the same arguments.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Asset, ImportJobOutput } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { readCapture } from './captureMeta.ts';
import { CONFORM_RECIPE, importIdempotencyKey, type ImportQueue, type ReceiveRequest } from './importContracts.ts';
import { ConformError, conformArgs, conformArgsWithProgress, ingestUpload, NeedsConform, runFfmpeg } from './ingest.ts';
import { createImportQueue } from './importQueue.ts';
import { FifoComputeLane } from './lane.ts';
import { collectGarbage, dataDirBytes, storageReport } from './storage.ts';
import { ApiError, Store, type JobRow } from './store.ts';

const GiB = 1024 ** 3;
let root: string;
const dirs: string[] = [];
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 28 });
const sha = (file: string) => `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const LATER = () => Date.now() + 60 * 60_000; // past the clean-up's grace period
const code = async (p: Promise<unknown> | (() => unknown)) => {
  try { await (typeof p === 'function' ? p() : p); } catch (e) { return e instanceof ApiError ? `${e.status} ${e.code}` : `other: ${e}`; }
  return 'ok';
};

const fx: Record<string, string> = {};
/** A small HEVC clip (needs conversion: codec), distinct bytes per `tag`. */
const hevc = (tag: string, opts: { size?: string; seconds?: number } = {}) => {
  const f = path.join(root, `${tag}.mp4`);
  if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', `testsrc2=size=${opts.size ?? '320x240'}:rate=30`, '-t', String(opts.seconds ?? 1), '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=none', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-metadata', `comment=${tag}`, f]);
  return f;
};
const h264 = (tag: string, meta: string[] = []) => {
  const f = path.join(root, `${tag}.mp4`);
  if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...[...meta, `comment=${tag}`].flatMap((m) => ['-metadata', m]), f]);
  return f;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-importq-'));
  // A: HEVC, rotated 90°, variable rate, AAC, Apple's creation date (the phone clip of plan §9)
  const a0 = path.join(root, 'a0.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-map', '0:v', '-map', '1:a', '-vf', "select='mod(n\\,3)'", '-fps_mode', 'vfr', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=none', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', a0]);
  fx.A = path.join(root, 'A.mp4');
  ff(['-display_rotation', '90', '-i', a0, '-c', 'copy', '-movflags', 'use_metadata_tags', '-metadata', 'creation_time=2025-08-14T15:03:22.000000Z', '-metadata', 'com.apple.quicktime.creationdate=2025-08-14T18:03:22+0300', fx.A]);
  fx.B = h264('B', ['creation_time=2024-03-01T09:30:00.000000Z']);
  fx.old = h264('old1904', ['creation_time=1904-01-01T00:00:00.000000Z']);
  fx.junk = path.join(root, 'junk.mp4');
  fs.writeFileSync(fx.junk, Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 7919 + 13) & 0xff)));
}, 120_000);
afterAll(() => { for (const d of [...dirs, root]) fs.rmSync(d, { recursive: true, force: true }); });

interface World { store: Store; lane: FifoComputeLane; queue: ImportQueue; spawned: string[][]; ensured: string[]; free: { bytes: number | null }; pid: string; dir: string; events: { at: number; row: JobRow }[] }
function world(opts: { maxStorageBytes?: number; slowStart?: number; store?: Store; dir?: string; spawn?: (args: string[]) => ReturnType<typeof spawn> } = {}): World {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pf-importq-w-'));
  if (!opts.dir) dirs.push(dir);
  const store = opts.store ?? new Store(dir, opts.maxStorageBytes ?? 0);
  const lane = new FifoComputeLane();
  const spawned: string[][] = [];
  const ensured: string[] = [];
  const free = { bytes: 100 * GiB as number | null };
  const events: World['events'] = [];
  store.events.on('job', (row: JobRow) => { if (row.type === 'import') events.push({ at: Date.now(), row }); });
  const queue = createImportQueue({
    store, lane, maxUploadBytes: GiB, reserveBytes: 2 * GiB, homeZone: 'Asia/Jerusalem',
    derivatives: { ensure: (a: Asset) => { ensured.push(a.id); return []; } }, // labelled fake: thumbnails are not under test
    freeBytes: () => free.bytes,
    spawnFfmpeg: (args) => {
      spawned.push(args);
      if (opts.spawn) return opts.spawn(args); // labelled: a test's own stand-in for ffmpeg
      // labelled: a slow start makes a conversion long without changing its arguments
      return opts.slowStart ? spawn('sh', ['-c', `sleep ${opts.slowStart}; exec ffmpeg "$@"`, 'sh', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }) : spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    },
  });
  const pid = opts.store ? '' : store.createProject({ name: 'p' }).doc.id;
  return { store, lane, queue, spawned, ensured, free, pid, dir, events };
}
const send = (w: World, file: string, extra: Partial<ReceiveRequest> = {}) => w.queue.receive({
  projectId: w.pid, actor: 'user:local', body: fs.createReadStream(file), name: path.basename(file), via: 'browser',
  declaredBytes: fs.statSync(file).size, maxBytes: GiB, commitKind: 'background', ...extra,
});
const until = async (cond: () => boolean, ms = 60_000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 20)); } };
const asset = (w: World, job: JobRow, pid = w.pid) => w.store.getProject(pid).doc.assets[(job.output as ImportJobOutput).assetId]!;
const strip = (a: any) => { const { id: _i, capture: _c, provenance: _p, ...rest } = a; return rest; };
const tmpLeft = (w: World) => fs.readdirSync(w.store.tmpDir).filter((f) => /^(imp|up)_/.test(f));

describe('import queue: receive, convert, commit', () => {
  it('receive returns before the HEVC job is done; the original is stored byte for byte; the asset equals ingestUpload\'s apart from capture and provenance, with the same conformed bytes', async () => {
    const w = world();
    const row = await send(w, fx.A!);
    expect(row.status).toBe('queued'); // the answer to the sender comes before any probing or converting
    expect(w.store.getJob(row.id).status).not.toBe('succeeded');
    expect(row.input).toMatchObject({ originalHash: sha(fx.A!), byteSize: fs.statSync(fx.A!).size, name: 'A.mp4', via: 'browser', commitKind: 'background' });
    expect(sha(w.store.blobPath(row.input.originalHash))).toBe(sha(fx.A!)); // stored before the job exists
    const done = await w.queue.wait(row.id);
    expect(done.status).toBe('succeeded');
    const out = done.output as ImportJobOutput;
    expect(out).toMatchObject({ deduplicated: false, converted: true, reusedConform: false, reasons: ['variable-frame-rate', 'rotation', 'codec'] });
    const got = asset(w, done);
    expect(got.conform).toMatchObject({ originalContentHash: sha(fx.A!), originalByteSize: fs.statSync(fx.A!).size });
    expect(got.provenance).toEqual({ origin: 'upload', importedAt: row.input.receivedAt, importedBy: 'user:local', upload: { via: 'browser', jobId: row.id } });
    // the capture date: the life line's reader on the ORIGINAL file, with now = the moment the bytes were received
    expect(got.capture).toEqual(await readCapture(fx.A!, 'A.mp4', { homeZone: 'Asia/Jerusalem', now: new Date(row.input.receivedAt) }));
    expect(got.capture).toMatchObject({ at: '2025-08-14T18:03:22', utcOffsetMinutes: 180 });
    // the synchronous ingest in a fresh data directory (no conversion can be reused there)
    const other = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-importq-sync-')));
    dirs.push(other.dataDir);
    const sync = await ingestUpload(other, Readable.toWeb(fs.createReadStream(fx.A!)) as any, 'A.mp4', 'user:local', GiB, { homeZone: 'Asia/Jerusalem', now: new Date() });
    expect(strip(JSON.parse(JSON.stringify(got)))).toEqual(strip(JSON.parse(JSON.stringify(sync))));
    expect(got.contentHash).toBe(sync.contentHash);
    expect(w.ensured).toEqual([got.id]);
    expect(tmpLeft(w)).toEqual([]);
  }, 120_000);

  it('the conform recipe is pinned: the exact ffmpeg arguments, plus only -progress pipe:1 -nostats', async () => {
    const needs = new NeedsConform(['variable-frame-rate', 'codec'], { codec: 'hevc', width: 320, height: 240, avgFrameRate: '20/1', rFrameRate: '30/1', rotation: 0, frameCount: 40, durationSeconds: 2 }, { num: 24000, den: 1001 });
    expect(CONFORM_RECIPE).toBe('conform-1');
    expect(conformArgs('IN', 'OUT', needs)).toEqual(['-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', 'IN', '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'fps=24000/1001,scale=trunc(iw*sar/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-bf', '2',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'OUT']);
    const hdr = new NeedsConform(['codec', 'hdr'], needs.original, { num: 30, den: 1 });
    expect(conformArgs('IN', 'OUT', hdr)[conformArgs('IN', 'OUT', hdr).indexOf('-vf') + 1]).toBe('zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:param=0.6:desat=0,zscale=t=bt709:m=bt709:r=tv,fps=30/1,scale=trunc(iw*sar/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p');
    const withProgress = conformArgsWithProgress('IN', 'OUT', needs);
    expect(withProgress.filter((a, i) => !(a === '-progress' || a === '-nostats' || (a === 'pipe:1' && withProgress[i - 1] === '-progress')))).toEqual(conformArgs('IN', 'OUT', needs));
    // and the queue spawns exactly that (the original blob in, a per-attempt working file out)
    const w = world();
    const row = await send(w, hevc('pin'));
    await w.queue.wait(row.id);
    expect(w.spawned).toHaveLength(1);
    const args = w.spawned[0]!;
    const src = w.store.blobPath(row.input.originalHash);
    expect(args[args.indexOf('-i') + 1]).toBe(src);
    expect(path.basename(args.at(-1)!)).toMatch(new RegExp(`^imp_${row.id}_1_[0-9a-f]+\\.conform\\.mp4$`));
    const n = asset(w, w.store.getJob(row.id)).conform!;
    expect(args).toEqual(conformArgsWithProgress(src, args.at(-1)!, new NeedsConform(n.reasons, n.original, { num: 30, den: 1 })));
  }, 120_000);

  it('capture: a 1904 creation time is no date; the uploader\'s last-modified time is recorded and never becomes one; a file stored as it is spawns no ffmpeg', async () => {
    const w = world();
    const old = await send(w, fx.old!, { declaredLastModified: '2026-11-01T10:00:00.000Z' });
    const done = await w.queue.wait(old.id);
    expect(done.status).toBe('succeeded');
    expect((done.output as ImportJobOutput)).toMatchObject({ converted: false, deduplicated: false, reasons: [] });
    expect(asset(w, done).capture).toBeUndefined();
    expect(done.input.declaredLastModified).toBe('2026-11-01T10:00:00.000Z');
    const b = await w.queue.wait((await send(w, fx.B!)).id);
    expect(asset(w, b).capture).toMatchObject({ source: 'container' }); // creation_time
    expect(asset(w, b).contentHash).toBe(sha(fx.B!));
    expect(w.spawned).toHaveLength(0);
  }, 60_000);

  it('a second import of a file spawns no ffmpeg: in the same project it is the same asset; in another it reuses the conversion (same original, same recipe)', async () => {
    const w = world();
    const file = hevc('twice');
    const first = await w.queue.wait((await send(w, file)).id);
    expect(w.spawned).toHaveLength(1);
    const again = await w.queue.wait((await send(w, file)).id);
    expect(again.output).toMatchObject({ deduplicated: true, assetId: (first.output as ImportJobOutput).assetId });
    const pid2 = w.store.createProject({ name: 'second' }).doc.id;
    const elsewhere = await w.queue.wait((await send(w, file, { projectId: pid2 })).id);
    expect(elsewhere.output).toMatchObject({ deduplicated: false, converted: true, reusedConform: true, contentHash: (first.output as ImportJobOutput).contentHash });
    expect(strip(asset(w, elsewhere, pid2))).toEqual(strip(asset(w, first)));
    expect(w.spawned).toHaveLength(1);
  }, 120_000);
});

describe('import queue: the lane, progress and order', () => {
  it('waits for a running export (waiting-export), then for the compute lane (waiting-compute); a file that needs no conversion finishes meanwhile', async () => {
    const w = world();
    w.lane.setExportActive(true);
    const holder = await w.lane.acquire('speech recognition (test holder)');
    const slow = await send(w, hevc('lane'));
    await until(() => w.store.getJob(slow.id).stage === 'waiting-export');
    expect(w.queue.view(w.store.getJob(slow.id))).toMatchObject({ state: 'waiting', waitingFor: 'export' });
    w.lane.setExportActive(false);
    await until(() => w.store.getJob(slow.id).stage === 'waiting-compute');
    expect(w.queue.view(w.store.getJob(slow.id))).toMatchObject({ state: 'waiting', waitingFor: 'compute', reasons: ['codec'] });
    const quick = await w.queue.wait((await send(w, fx.B!)).id);
    expect(quick.status).toBe('succeeded');
    expect(w.store.getJob(slow.id).status).toBe('running');
    expect(w.spawned).toHaveLength(0);
    holder();
    expect((await w.queue.wait(slow.id)).status).toBe('succeeded');
    expect(w.lane.busy()).toEqual({ holder: null, waiting: 0 }); // the lane was taken for the file and given back
  }, 120_000);

  it('an export that starts while the file waits for the compute lane is waited for too: no ffmpeg runs during it', async () => {
    const base = world();
    const spawnedDuringExport: boolean[] = [];
    const w = { ...base, queue: createImportQueue({
      store: base.store, lane: base.lane, maxUploadBytes: GiB, reserveBytes: 2 * GiB, homeZone: 'Asia/Jerusalem',
      derivatives: { ensure: () => [] }, // labelled fake: thumbnails are not under test
      freeBytes: () => 100 * GiB,
      spawnFfmpeg: (args) => { spawnedDuringExport.push(base.lane.exportActive()); return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] }); },
    }) };
    const holder = await w.lane.acquire('speech recognition (test holder)');
    const job = await send(w, hevc('export-meanwhile'));
    await until(() => w.store.getJob(job.id).stage === 'waiting-compute');
    w.lane.setExportActive(true); // an export begins while the file waits for the lane
    holder();
    await until(() => w.store.getJob(job.id).stage === 'waiting-export');
    expect(w.lane.busy()).toEqual({ holder: null, waiting: 0 }); // the lane was given back to the export's other users
    expect(spawnedDuringExport).toEqual([]);
    w.lane.setExportActive(false);
    expect((await w.queue.wait(job.id)).status).toBe('succeeded');
    expect(spawnedDuringExport).toEqual([false]);
  }, 120_000);

  it('a file that needs no conversion finishes before a long conversion ahead of it', async () => {
    const w = world({ slowStart: 3 });
    const long = await send(w, hevc('long-ahead'));
    await until(() => /^converting:/.test(w.store.getJob(long.id).stage ?? ''));
    const quick = await w.queue.wait((await send(w, h264('quick'))).id);
    expect(quick.status).toBe('succeeded');
    expect(w.store.getJob(long.id)).toMatchObject({ status: 'running' });
    expect(w.store.getJob(long.id).stage).toMatch(/^converting:\d+$/);
    expect((await w.queue.wait(long.id)).status).toBe('succeeded');
  }, 120_000);

  it('progress is monotone, never 100, and written at most once a second', async () => {
    const w = world();
    const row = await send(w, hevc('progress', { size: '1280x720', seconds: 10 }));
    await w.queue.wait(row.id);
    const writes = w.events.filter((e) => e.row.id === row.id && /^converting:/.test(e.row.stage ?? ''));
    const pct = writes.map((e) => Number(e.row.stage!.split(':')[1]));
    expect(pct[0]).toBe(0);
    expect(pct.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pct.length; i++) {
      expect(pct[i]!).toBeGreaterThan(pct[i - 1]!);
      expect(writes[i]!.at - writes[i - 1]!.at).toBeGreaterThanOrEqual(990);
    }
    expect(Math.max(...pct)).toBeLessThanOrEqual(99);
  }, 180_000);
});

describe('import queue: restart and recovery', () => {
  it('six queued conversions survive stop() and a new queue on the same store: each asset once, the interrupted one on attempt 2, no working files left', async () => {
    const w = world({ slowStart: 1 });
    const files = Array.from({ length: 6 }, (_, i) => hevc(`six-${i}`));
    const rows: JobRow[] = [];
    for (const f of files) rows.push(await send(w, f));
    await until(() => rows.some((r) => /^converting:/.test(w.store.getJob(r.id).stage ?? '')));
    const interrupted = rows.find((r) => /^converting:/.test(w.store.getJob(r.id).stage ?? ''))!;
    await w.queue.stop();
    expect(w.store.getJob(interrupted.id).status).toBe('running'); // left for recover()
    expect(await code(send(w, files[0]!))).toBe('503 shutting_down');
    const w2 = world({ store: w.store, dir: w.dir });
    w2.pid = w.pid;
    const open = rows.filter((r) => w.store.getJob(r.id).status !== 'succeeded').length;
    expect(w2.queue.recover()).toBe(open);
    const done = await Promise.all(rows.map((r) => w2.queue.wait(r.id)));
    expect(done.every((d) => d.status === 'succeeded')).toBe(true);
    const assets = Object.values(w.store.getProject(w.pid).doc.assets);
    expect(assets).toHaveLength(6);
    expect(new Set(assets.map((a) => a.conform!.originalContentHash))).toEqual(new Set(files.map(sha)));
    expect(w.store.getJob(interrupted.id).attempt).toBe(2);
    expect(tmpLeft(w)).toEqual([]);
    await w2.queue.stop();
  }, 180_000);

  it('a crash between the commit and the job update is finished from the commit: same asset and revision, no ffmpeg, no new transaction', async () => {
    const w = world();
    const row = await send(w, hevc('crash'));
    const first = await w.queue.wait(row.id);
    const out = first.output as ImportJobOutput;
    const txCount = () => (w.store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE project_id = ?').get(w.pid) as { n: number }).n;
    const before = txCount();
    // as the row was when the process died: committed, job not yet updated
    w.store.db.prepare("UPDATE jobs SET status = 'running', stage = 'converting:99', output = NULL WHERE id = ?").run(row.id);
    await w.queue.stop();
    const w2 = world({ store: w.store, dir: w.dir });
    expect(w2.queue.recover()).toBe(1);
    const again = await w2.queue.wait(row.id);
    expect(again.output).toMatchObject({ assetId: out.assetId, revision: out.revision, deduplicated: false, converted: true, contentHash: out.contentHash });
    expect(w2.spawned).toHaveLength(0);
    expect(txCount()).toBe(before);
  }, 120_000);

  it('a transaction someone else wrote under the import\'s key is not a recovery: the job fails as a server fault and nothing is imported', async () => {
    const w = world();
    const row = await send(w, fx.B!);
    // an agent (here: the same actor, which an agent of its own job is) commits its own edit under the key first
    w.store.commit({ projectId: w.pid, actor: 'user:local', idempotencyKey: importIdempotencyKey(row.id), ops: [{ op: 'rename_project', args: { name: 'mine' } }] });
    const done = await w.queue.wait(row.id);
    expect(done).toMatchObject({ status: 'failed', error: { code: 'internal_error', retryable: true } });
    expect(Object.keys(w.store.getProject(w.pid).doc.assets)).toHaveLength(0);
    // a retry has its own key, so it imports the file
    const retried = await w.queue.wait(w.queue.retry(row.id, 'user:local').id);
    expect(retried.status).toBe('succeeded');
  }, 60_000);
});

describe('import queue: a conversion that fails', () => {
  const stored = (w: World, row: JobRow) => fs.existsSync(w.store.blobPath(row.input.originalHash));
  // labelled stand-ins for ffmpeg: one ended by SIGKILL (as the out-of-memory killer ends it), one missing, one that reports a decode error
  const killed = () => spawn('sh', ['-c', 'kill -9 $$'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const missing = () => spawn('pf-no-such-ffmpeg-binary', [], { stdio: ['ignore', 'pipe', 'pipe'] });
  const decodeError = () => spawn('sh', ['-c', 'echo "Invalid data found when processing input" >&2; exit 1'], { stdio: ['ignore', 'pipe', 'pipe'] });

  it('runFfmpeg tells the file\'s faults from the machine\'s: timeout, a signal, out of memory and no ffmpeg are machine faults', async () => {
    const sh = (script: string) => () => spawn('sh', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    const kindOf = async (s: () => ReturnType<typeof spawn>, timeoutMs = 30_000) => {
      const e = await runFfmpeg([], { spawn: s, timeoutMs }).then(() => null, (x) => x);
      expect(e).toBeInstanceOf(ConformError);
      return [(e as ConformError).kind, (e as ConformError).machineFault];
    };
    expect(await kindOf(sh('exec sleep 30'), 200)).toEqual(['timeout', true]);
    expect(await kindOf(killed)).toEqual(['killed', true]);
    expect(await kindOf(sh('echo "Cannot allocate memory" >&2; exit 1'))).toEqual(['killed', true]);
    expect(await kindOf(missing)).toEqual(['no_ffmpeg', true]);
    expect(await kindOf(decodeError)).toEqual(['failed', false]);
    expect(await kindOf(sh('echo "No space left on device" >&2; exit 1'))).toEqual(['disk_full', false]);
  }, 60_000);

  it('ffmpeg ended by the system (SIGKILL, out of memory) is a server fault: internal_error, retryable, the original kept, and a retry converts it', async () => {
    const w = world({ spawn: killed });
    const row = await send(w, hevc('oom'));
    const done = await w.queue.wait(row.id);
    expect(done).toMatchObject({ status: 'failed', error: { code: 'internal_error', retryable: true, details: { ffmpeg: 'killed', reasons: ['codec'] } } });
    expect(w.queue.view(done).error).toMatchObject({ code: 'internal_error', retryable: true });
    expect(stored(w, row)).toBe(true);
    // the same file, retried on the same queue once memory is back (here: a queue with the real ffmpeg on the same store)
    await w.queue.stop();
    const w2 = world({ store: w.store, dir: w.dir });
    const again = await w2.queue.wait(w2.queue.retry(row.id, 'user:local').id);
    expect(again).toMatchObject({ status: 'succeeded', output: { converted: true } });
  }, 120_000);

  it('ffmpeg not installed is an honest setup state: internal_error with an install hint, the original kept', async () => {
    const w = world({ spawn: missing });
    const row = await send(w, hevc('no-ffmpeg'));
    const done = await w.queue.wait(row.id);
    expect(done).toMatchObject({ status: 'failed', error: { code: 'internal_error', retryable: true, status: 503, details: { ffmpeg: 'no_ffmpeg' } } });
    expect((done.error as { hint?: string }).hint).toMatch(/Install ffmpeg/);
    expect(stored(w, row)).toBe(true);
  }, 60_000);

  it('ffmpeg that ran and reported a decode error is the file\'s fault: conform_failed, not retryable, the original removed', async () => {
    const w = world({ spawn: decodeError });
    const row = await send(w, hevc('decode-error'));
    const done = await w.queue.wait(row.id);
    expect(done).toMatchObject({ status: 'failed', error: { code: 'conform_failed', retryable: false } });
    expect((done.error as { message: string }).message).toMatch(/Invalid data found/);
    expect(stored(w, row)).toBe(false);
  }, 60_000);
});

describe('import queue: cancel, retry, dismiss, refusals', () => {
  it('cancel (queued and waiting), retry, dismiss; then the storage report lists the originals as unreferenced and a retry is refused original_gone', async () => {
    const w = world();
    const holder = await w.lane.acquire('local.test holder');
    const x = await send(w, hevc('cancel-x'));
    await until(() => w.store.getJob(x.id).stage === 'waiting-compute');
    const y = await send(w, hevc('cancel-y'));
    await until(() => w.queue.view(w.store.getJob(y.id)).queuePosition === 1);
    expect(w.queue.cancel(y.id, 'user:local')).toMatchObject({ outcome: 'removed-from-queue', status: 'canceled' });
    expect(w.queue.cancel(x.id, 'user:local')).toMatchObject({ outcome: 'stopping' });
    expect(await w.queue.wait(x.id)).toMatchObject({ status: 'canceled', error: { code: 'canceled', retryable: true } });
    expect(w.queue.cancel(x.id, 'user:local').outcome).toBe('already-finished');
    expect(w.queue.list(w.pid).map((v) => [v.jobId, v.state])).toEqual([[x.id, 'canceled'], [y.id, 'canceled']]);
    // retry: a new job as the retrier's actor, the old one leaves the list
    const x2 = w.queue.retry(x.id, 'agent:helper');
    expect(x2).toMatchObject({ actor: 'agent:helper', status: 'queued', input: { retryOf: x.id, originalHash: x.input.originalHash, commitKind: 'background' } });
    expect(w.queue.view(x2).retryOf).toBe(x.id);
    await until(() => w.store.getJob(x2.id).stage === 'waiting-compute');
    expect(await code(() => w.queue.dismiss(x2.id, 'user:local'))).toBe('409 import_not_finished');
    expect(await code(() => w.queue.retry(x2.id, 'user:local'))).toBe('409 import_not_finished');
    w.queue.cancel(x2.id, 'user:local');
    await w.queue.wait(x2.id);
    w.queue.dismiss(x2.id, 'user:local');
    w.queue.dismiss(y.id, 'user:local');
    expect(w.queue.list(w.pid)).toEqual([]);
    holder();
    expect(w.spawned).toHaveLength(0);
    const report = storageReport(w.store, owner, LATER());
    for (const r of [x, y]) expect(report.unreferenced.hashes).toContain(r.input.originalHash.slice(7));
    collectGarbage(w.store, owner, true, LATER());
    expect(await code(() => w.queue.retry(x2.id, 'user:local'))).toBe('409 original_gone');
    const exportJob = w.store.createJob(w.pid, 'export', 'user:local', {});
    expect(await code(() => w.queue.cancel(exportJob.id, 'user:local'))).toBe('409 not_an_import');
  }, 120_000);

  it('unsupported bytes fail for good and leave no stored original; a synchronous-route failure is dismissed at once', async () => {
    const w = world();
    const bad = await w.queue.wait((await send(w, fx.junk!)).id);
    expect(bad).toMatchObject({ status: 'failed', error: { code: 'unsupported_media', status: 415, retryable: false } });
    expect(fs.existsSync(w.store.blobPath(bad.input.originalHash))).toBe(false);
    expect(w.queue.list(w.pid).map((v) => v.error?.code)).toEqual(['unsupported_media']);
    const bytes = fs.readFileSync(fx.junk!); bytes[0] = 1;
    const junk2 = path.join(root, 'junk2.mp4'); fs.writeFileSync(junk2, bytes);
    const sync = await w.queue.wait((await send(w, junk2, { commitKind: 'edit' })).id);
    expect(sync.error).toMatchObject({ code: 'unsupported_media', dismissed: true });
    expect(w.queue.list(w.pid)).toHaveLength(1);
    expect(tmpLeft(w)).toEqual([]);
  }, 60_000);

  it('refusals before anything is stored: the ceiling (data directory unchanged, no job), the disk reserve, too large, incomplete and empty bodies', async () => {
    const probe = world();
    const used = dataDirBytes(probe.dir);
    const w = world({ maxStorageBytes: used + 4096 });
    const size0 = dataDirBytes(w.dir);
    const jobs = () => (w.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
    expect(await code(send(w, fx.B!))).toBe('507 storage_quota_exceeded');
    expect(await code(send(w, fx.B!, { declaredBytes: null }))).toBe('507 storage_quota_exceeded'); // cut off at the room left
    expect(dataDirBytes(w.dir)).toBe(size0);
    expect(jobs()).toBe(0);
    expect(tmpLeft(w)).toEqual([]);
    const d = world();
    d.free.bytes = 1 * GiB; // less than the 2 GiB reserve
    const never = new Readable({ read() { throw new Error('the body must not be read'); } });
    expect(await code(d.queue.receive({ projectId: d.pid, actor: 'user:local', body: never, name: 'big.mp4', via: 'phone', dropId: 'drp_x', declaredBytes: 100 * 1024 ** 2, maxBytes: GiB, commitKind: 'background' }))).toBe('507 disk_full');
    expect(await code(send(d, fx.B!, { maxBytes: 1000 }))).toBe('413 upload_too_large');
    expect(await code(send(d, fx.B!, { declaredBytes: fs.statSync(fx.B!).size + 10 }))).toBe('400 upload_incomplete');
    expect(await code(d.queue.receive({ projectId: d.pid, actor: 'user:local', body: Readable.from([]), name: 'e.mp4', via: 'browser', declaredBytes: null, maxBytes: GiB, commitKind: 'background' }))).toBe('400 empty_upload');
    expect(await code(send(d, fx.B!, { projectId: 'prj_none' }))).toBe('404 project_not_found');
    const ac = new AbortController(); ac.abort();
    expect(await code(send(d, fx.B!, { signal: ac.signal }))).toBe('400 upload_incomplete');
    expect((d.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(0);
    expect(tmpLeft(d)).toEqual([]);
  }, 60_000);

  it('uploads of unknown size count toward the ceiling as their bytes arrive: two streams that each fit alone cannot pass it together (one is refused, nothing partial kept)', async () => {
    const MiB = 1024 ** 2;
    const probe = world();
    const used = dataDirBytes(probe.dir);
    const ceiling = used + Math.round(1.5 * MiB) + 256 * 1024; // room for one 1 MiB file (and the job row), not for two
    const w = world({ maxStorageBytes: ceiling });
    const jobs = () => (w.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
    const chunk = (k: number, tag: number) => Buffer.from(Array.from({ length: 16 * 1024 }, (_, i) => (i * 31 + k * 7 + tag * 101) & 0xff));
    const bodies = [new PassThrough(), new PassThrough()];
    for (const b of bodies) b.on('error', () => { /* destroyed by the refusal */ });
    const results = bodies.map((body, i) => code(w.queue.receive({ projectId: w.pid, actor: 'user:local', body, name: `stream${i}.mp4`, via: 'browser', declaredBytes: null, maxBytes: GiB, commitKind: 'background' })));
    for (let k = 0; k < 64; k++) { // 64 × 16 KiB = 1 MiB each, sent turn by turn
      for (const [i, b] of bodies.entries()) if (!b.destroyed && b.writable) b.write(chunk(k, i));
      await new Promise((r) => setTimeout(r, 2));
    }
    for (const b of bodies) if (!b.destroyed) b.end();
    const got = (await Promise.all(results)).sort();
    expect(got).toEqual(['507 storage_quota_exceeded', 'ok']);
    expect(jobs()).toBe(1);
    expect(tmpLeft(w)).toEqual([]);
    expect(dataDirBytes(w.dir)).toBeLessThanOrEqual(ceiling);
  }, 60_000);

  it('a stream of unknown size that started first is cut off when a declared upload took the room meanwhile (its reservation grows against the ledger, not against the room it saw at the start)', async () => {
    const MiB = 1024 ** 2;
    const probe = world();
    const used = dataDirBytes(probe.dir);
    // a real clip (a file that fails to import would give its room back at once): lossless, so it is large
    const big = path.join(root, 'declared-lossless.mp4');
    if (!fs.existsSync(big)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-qp', '0', '-pix_fmt', 'yuv420p', big]);
    const declared = fs.statSync(big).size;
    expect(declared).toBeGreaterThan(MiB / 2);
    const ceiling = used + declared + MiB / 2 + 256 * 1024; // room for the clip, or for the 1 MiB stream, not for both
    const w = world({ maxStorageBytes: ceiling });
    const body = new PassThrough();
    body.on('error', () => { /* destroyed by the refusal */ });
    const streamed = code(w.queue.receive({ projectId: w.pid, actor: 'user:local', body, name: 'first.mp4', via: 'browser', declaredBytes: null, maxBytes: GiB, commitKind: 'background' }));
    const piece = (k: number) => Buffer.from(Array.from({ length: 16 * 1024 }, (_, i) => (i * 17 + k) & 0xff));
    for (let k = 0; k < 4; k++) { body.write(piece(k)); await new Promise((r) => setTimeout(r, 2)); } // 64 KiB arrived
    expect(await code(send(w, big))).toBe('ok'); // declared, stored while the stream waits
    expect((await w.queue.wait((w.store.db.prepare("SELECT id FROM jobs").get() as { id: string }).id)).status).toBe('succeeded'); // and kept
    for (let k = 4; k < 64 && !body.destroyed; k++) { body.write(piece(k)); await new Promise((r) => setTimeout(r, 2)); }
    if (!body.destroyed) body.end();
    expect(await streamed).toBe('507 storage_quota_exceeded');
    expect((w.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(1);
    expect(tmpLeft(w)).toEqual([]);
    expect(dataDirBytes(w.dir)).toBeLessThanOrEqual(ceiling);
  }, 60_000);

  it('disk_full before a conversion is retryable, and the retry succeeds once there is room', async () => {
    const w = world();
    const row = await send(w, hevc('diskfull'));
    w.free.bytes = 2 * GiB + 1000; // the reserve leaves no room for the converted copy
    const failed = await w.queue.wait(row.id);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'disk_full', status: 507, retryable: true } });
    expect(w.spawned).toHaveLength(0);
    expect(w.queue.room()).toMatchObject({ freeDiskBytes: 2 * GiB + 1000, reserveBytes: 2 * GiB, maxFileBytes: GiB, ceilingRoomBytes: null });
    w.free.bytes = 100 * GiB;
    const ok = await w.queue.wait(w.queue.retry(row.id, 'user:local').id);
    expect(ok.status).toBe('succeeded');
    expect(asset(w, ok).provenance.upload).toMatchObject({ jobId: ok.id });
  }, 120_000);

  it('names from a REST client are cleaned and cut (emoji name, 600-character folder path, controls, bidi, both separators); a path is kept for folder uploads only', async () => {
    const w = world();
    const emoji = `${'😀'.repeat(300)}.mp4`;
    const deep = `${'תיקייה/'.repeat(90)}\u202Eevil\u0007.mp4`;
    const f = await send(w, h264('names-1'), { name: `C:\\Users\\x\\${emoji}`, via: 'folder', relativePath: deep });
    expect(f.input.name.length).toBeLessThanOrEqual(256);
    expect(f.input.name.endsWith('.mp4')).toBe(true);
    expect(f.input.name.startsWith('😀')).toBe(true);
    expect(f.input.relativePath.length).toBeLessThanOrEqual(512);
    expect(f.input.relativePath).not.toMatch(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/);
    const done = await w.queue.wait(f.id);
    expect(done.status).toBe('succeeded');
    expect(asset(w, done).provenance.upload).toMatchObject({ via: 'folder', relativePath: f.input.relativePath });
    const b = await send(w, h264('names-2'), { name: '\u202Ebad\u0000name.mp4', relativePath: 'ignored/x.mp4' });
    expect(b.input.name).toBe('badname.mp4');
    expect(b.input.relativePath).toBeUndefined();
    expect((await w.queue.wait(b.id)).status).toBe('succeeded');
    const p = await send(w, h264('names-3'), { via: 'phone', actor: 'phone:drp_1', dropId: 'drp_1', issuedBy: 'user:local' });
    const pd = await w.queue.wait(p.id);
    expect(asset(w, pd).provenance).toMatchObject({ importedBy: 'phone:drp_1', upload: { via: 'phone', dropId: 'drp_1', jobId: p.id } });
    expect(w.queue.view(pd)).toMatchObject({ state: 'ready', dropId: 'drp_1', via: 'phone', assetId: (pd.output as ImportJobOutput).assetId });
  }, 60_000);
});

describe("import queue: kind 'background' and undo", () => {
  it('one actor: an edit, then a background import; Ctrl+Z undoes the edit and the file stays; redo is still there; the import is reversible by transaction id', async () => {
    const w = world();
    w.store.commit({ projectId: w.pid, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: 'edited' } }] });
    const imp = await w.queue.wait((await send(w, fx.B!)).id);
    const assetId = (imp.output as ImportJobOutput).assetId;
    const tx = w.store.db.prepare('SELECT id, kind FROM transactions WHERE project_id = ? AND idempotency_key = ?').get(w.pid, importIdempotencyKey(imp.id)) as { id: string; kind: string };
    expect(tx.kind).toBe('background');
    w.store.undo(w.pid, 'user:local', 'undo');
    expect(w.store.getProject(w.pid).doc.name).toBe('p');
    expect(w.store.getProject(w.pid).doc.assets[assetId]).toBeDefined();
    w.store.undo(w.pid, 'user:local', 'redo');
    expect(w.store.getProject(w.pid).doc.name).toBe('edited');
    w.store.undo(w.pid, 'user:local', 'undo', tx.id);
    expect(w.store.getProject(w.pid).doc.assets[assetId]).toBeUndefined();
  }, 60_000);

  it("control: the synchronous route's import (kind 'edit') is what Ctrl+Z undoes", async () => {
    const w = world();
    w.store.commit({ projectId: w.pid, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: 'edited' } }] });
    const imp = await w.queue.wait((await send(w, fx.B!, { commitKind: 'edit' })).id);
    const assetId = (imp.output as ImportJobOutput).assetId;
    w.store.undo(w.pid, 'user:local', 'undo');
    expect(w.store.getProject(w.pid).doc.assets[assetId]).toBeUndefined();
    expect(w.store.getProject(w.pid).doc.name).toBe('edited');
  }, 60_000);
});
