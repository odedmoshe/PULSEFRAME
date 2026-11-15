/**
 * Ingest derivatives (SPEC §7): thumbnails sprite sheet, multiresolution waveform peaks and an editing proxy.
 * Rows are keyed by (content hash, kind), so identical files are processed once. Every derivative is a
 * content-addressed blob plus an exact mapping record in `meta`. Failures are recorded per row, never thrown.
 * Work is bounded (default one ffmpeg at a time); all ffmpeg calls use argument arrays, no shell.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Asset } from '@pulseframe/core';
import { ffprobe } from './ingest.ts';
import type { Store } from './store.ts';

export type DerivativeKind = 'thumbnails' | 'waveform' | 'proxy';
export interface DerivativeRow { assetHash: string; kind: DerivativeKind; status: 'queued' | 'running' | 'ready' | 'failed' | 'not-applicable'; blobHash: string | null; bytes: number | null; mimeType: string | null; meta: Record<string, unknown> | null; error: string | null; updatedAt: string }

const KINDS: DerivativeKind[] = ['thumbnails', 'waveform', 'proxy'];
const FFMPEG_TIMEOUT_MS = 10 * 60_000;
/** Tile height of the thumbnail sprite (a 16-bit barcode is still readable at this size). */
export const THUMB_TILE_HEIGHT = 90;
export const WAVEFORM_SAMPLE_RATE = 48000;
const BUCKET_SIZES = [256, 1024, 4096] as const; // each is an exact multiple of the first
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

type Outcome = { status: 'ready'; file: string; mime: string; meta: Record<string, unknown> } | { status: 'not-applicable' };

export class Derivatives {
  private queue: { hash: string; kind: DerivativeKind }[] = [];
  private pending = new Set<string>();
  private active = 0;
  private stopped = false;
  private children = new Set<ChildProcess>();
  private waiters: (() => void)[] = [];
  private readonly concurrency: number;

  constructor(private store: Store, opts: { concurrency?: number } = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    store.db.exec(`CREATE TABLE IF NOT EXISTS derivatives (
      asset_hash TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, blob_hash TEXT, bytes INTEGER, mime_type TEXT, meta TEXT, error TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (asset_hash, kind))`);
  }

  private rowOf = (r: any): DerivativeRow => ({ assetHash: r.asset_hash, kind: r.kind, status: r.status, blobHash: r.blob_hash, bytes: r.bytes, mimeType: r.mime_type, meta: r.meta ? JSON.parse(r.meta) : null, error: r.error, updatedAt: r.updated_at });
  list(assetHash: string): DerivativeRow[] {
    return (this.store.db.prepare('SELECT * FROM derivatives WHERE asset_hash = ? ORDER BY kind').all(assetHash) as any[]).map(this.rowOf);
  }
  get(assetHash: string, kind: DerivativeKind): DerivativeRow | null {
    const r = this.store.db.prepare('SELECT * FROM derivatives WHERE asset_hash = ? AND kind = ?').get(assetHash, kind);
    return r ? this.rowOf(r) : null;
  }
  private write(hash: string, kind: DerivativeKind, p: Partial<Omit<DerivativeRow, 'assetHash' | 'kind' | 'updatedAt'>> & { status: DerivativeRow['status'] }) {
    this.store.db
      .prepare(`INSERT INTO derivatives (asset_hash, kind, status, blob_hash, bytes, mime_type, meta, error, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(asset_hash, kind) DO UPDATE SET status = excluded.status, blob_hash = excluded.blob_hash, bytes = excluded.bytes, mime_type = excluded.mime_type, meta = excluded.meta, error = excluded.error, updated_at = excluded.updated_at`)
      .run(hash, kind, p.status, p.blobHash ?? null, p.bytes ?? null, p.mimeType ?? null, p.meta ? JSON.stringify(p.meta) : null, p.error ?? null, new Date().toISOString());
    this.store.events.emit('derivative', this.get(hash, kind));
  }

  /** Idempotent: queue missing derivatives for this asset. Returns immediately. */
  ensure(asset: Asset): DerivativeRow[] {
    const hash = asset.contentHash;
    const applicable: Record<DerivativeKind, boolean> = { thumbnails: asset.kind === 'video', proxy: asset.kind === 'video', waveform: asset.kind !== 'image' && !!asset.audio };
    for (const kind of KINDS) {
      if (this.get(hash, kind)) continue;
      if (!applicable[kind]) this.write(hash, kind, { status: 'not-applicable' });
      else {
        this.write(hash, kind, { status: 'queued' });
        this.enqueue(hash, kind);
      }
    }
    return this.list(hash);
  }

  /** After a restart: rows left running go back to queued and everything queued is processed. */
  recover(): void {
    this.store.db.prepare("UPDATE derivatives SET status = 'queued', updated_at = ? WHERE status = 'running'").run(new Date().toISOString());
    for (const r of this.store.db.prepare("SELECT asset_hash, kind FROM derivatives WHERE status = 'queued' ORDER BY updated_at").all() as any[]) this.enqueue(r.asset_hash, r.kind);
  }

  idle(): Promise<void> {
    if (this.settled()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  async stop(): Promise<void> {
    this.stopped = true;
    for (const c of this.children) c.kill('SIGKILL');
    await this.idle();
  }

  private settled = () => this.active === 0 && (this.stopped || this.queue.length === 0);
  private enqueue(hash: string, kind: DerivativeKind) {
    const key = `${hash}|${kind}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.queue.push({ hash, kind });
    queueMicrotask(() => this.pump());
  }
  private pump() {
    while (!this.stopped && this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void this.process(job.hash, job.kind).finally(() => {
        this.active--;
        this.pending.delete(`${job.hash}|${job.kind}`);
        this.pump();
        if (this.settled()) for (const w of this.waiters.splice(0)) w();
      });
    }
    if (this.settled()) for (const w of this.waiters.splice(0)) w();
  }

  private async process(hash: string, kind: DerivativeKind) {
    let file: string | null = null;
    try {
      this.write(hash, kind, { status: 'running' });
      const out = await this.build(hash, kind);
      if (out.status === 'not-applicable') return this.write(hash, kind, { status: 'not-applicable' });
      file = out.file;
      if (this.stopped) return; // leave the row 'running': recoverable
      const { blobHash, bytes } = await this.intern(out.file, out.mime);
      file = null;
      this.write(hash, kind, { status: 'ready', blobHash, bytes, mimeType: out.mime, meta: out.meta });
    } catch (e) {
      if (this.stopped) return;
      this.write(hash, kind, { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) });
    } finally {
      if (file) fs.rmSync(file, { force: true });
    }
  }

  /** Hash the temp file (streaming) and move it into the content-addressed store. */
  private async intern(file: string, mime: string) {
    const h = createHash('sha256');
    let bytes = 0;
    for await (const chunk of fs.createReadStream(file)) { h.update(chunk as Buffer); bytes += (chunk as Buffer).length; }
    const blobHash = `sha256:${h.digest('hex')}`;
    this.store.putBlob(blobHash, file, bytes, mime);
    return { blobHash, bytes };
  }

  private tmp(ext: string) {
    return path.join(this.store.tmpDir, `dv_${randomBytes(8).toString('hex')}.${ext}`);
  }

  /** ffmpeg with an argument array, no stdin, bounded runtime; stdout streamed to `onData` when given. */
  private ff(args: string[], onData?: (b: Buffer) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) return reject(new Error('stopped'));
      const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(p);
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, FFMPEG_TIMEOUT_MS);
      p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
      p.stdout.on('data', (d: Buffer) => onData?.(d));
      p.on('error', (e) => { clearTimeout(timer); this.children.delete(p); reject(e); });
      p.on('close', (code, sig) => {
        clearTimeout(timer);
        this.children.delete(p);
        if (code === 0) resolve();
        else reject(new Error(timedOut ? 'ffmpeg timed out' : `ffmpeg exited ${code ?? sig}: ${err.trim()}`));
      });
    });
  }
  private input = (file: string) => ['-protocol_whitelist', 'file,pipe', '-i', file];

  private async build(hash: string, kind: DerivativeKind): Promise<Outcome> {
    const src = this.store.blobPath(hash);
    const probe = await ffprobe(src);
    const streams: any[] = probe.streams ?? [];
    const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    const a = streams.find((s) => s.codec_type === 'audio');
    const isImage = v && (probe.format?.format_name ?? '').split(',').some((f: string) => /image2|_pipe$/.test(f));
    if (kind === 'waveform') return a ? this.waveform(src) : { status: 'not-applicable' };
    if (!v || isImage) return { status: 'not-applicable' };
    const frameCount = Number(v.nb_frames);
    if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error('source does not state a frame count (nb_frames)');
    const m = /^(\d+)\/(\d+)$/.exec(String(v.r_frame_rate));
    if (!m || +m[1]! <= 0 || +m[2]! <= 0) throw new Error('source has no usable frame rate');
    const info = { width: Number(v.width), height: Number(v.height), rate: { num: +m[1]!, den: +m[2]! }, rateText: String(v.r_frame_rate), frameCount };
    return kind === 'thumbnails' ? this.thumbnails(src, info) : this.proxy(src, info);
  }

  private async thumbnails(src: string, s: { width: number; height: number; rate: { num: number; den: number }; frameCount: number }): Promise<Outcome> {
    const seconds = Math.floor((s.frameCount * s.rate.den + s.rate.num - 1) / s.rate.num); // exact integer ceil
    const n = Math.min(60, Math.max(1, seconds));
    // Frame indices chosen by index, never by float seconds: round(i * frameCount / n) in integer arithmetic.
    const frameIndices = [...new Set(Array.from({ length: n }, (_, i) => Math.min(s.frameCount - 1, Math.floor((2 * i * s.frameCount + n) / (2 * n)))))];
    const count = frameIndices.length;
    const tileHeight = THUMB_TILE_HEIGHT;
    const tileWidth = even((s.width * tileHeight) / s.height);
    const columns = Math.min(count, 10);
    const rows = Math.ceil(count / columns);
    const out = this.tmp('jpg');
    try {
      const select = frameIndices.map((k) => `eq(n,${k})`).join('+');
      await this.ff([...this.input(src), '-map', '0:v:0', '-an', '-vf', `select='${select}',scale=${tileWidth}:${tileHeight},tile=${columns}x${rows}`, '-fps_mode', 'passthrough', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '3', '-pix_fmt', 'yuvj420p', '-f', 'image2', '-y', out]);
    } catch (e) { fs.rmSync(out, { force: true }); throw e; }
    return { status: 'ready', file: out, mime: 'image/jpeg', meta: { tileWidth, tileHeight, columns, rows, count, frameIndices } };
  }

  /**
   * Peaks are computed on a mono s16le 48 kHz decode. That resample is for DISPLAY only; it is not the mix path.
   * The PCM is streamed; only the level-0 (256-sample) min/max pairs are kept. Levels 1024/4096 are exact
   * min/max folds of level 0 (their bucket sizes are multiples of 256).
   */
  private async waveform(src: string): Promise<Outcome> {
    const base = BUCKET_SIZES[0];
    const mins: number[] = [];
    const maxs: number[] = [];
    let lo = 32767, hi = -32768, inBucket = 0, total = 0;
    let carry: Buffer | null = null;
    const onData = (chunk: Buffer) => {
      let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      carry = usable < buf.length ? buf.subarray(usable) : null;
      for (let o = 0; o < usable; o += 2) {
        const x = buf.readInt16LE(o);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
        if (++inBucket === base) { mins.push(lo); maxs.push(hi); lo = 32767; hi = -32768; inBucket = 0; }
      }
      total += usable / 2;
    };
    await this.ff([...this.input(src), '-vn', '-map', '0:a:0', '-af', `aresample=${WAVEFORM_SAMPLE_RATE}:first_pts=0` /* the waveform is drawn on the file's own clock, also when its sound starts late */, '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE), '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], onData);
    if (inBucket > 0) { mins.push(lo); maxs.push(hi); }
    if (total === 0) throw new Error('no audio samples decoded');
    const levels: { samplesPerBucket: number; buckets: number; byteOffset: number }[] = [];
    const parts: Buffer[] = [];
    let offset = 0;
    for (const size of BUCKET_SIZES) {
      const fold = size / base;
      const buckets = Math.ceil(mins.length / fold);
      const b = Buffer.alloc(buckets * 4);
      for (let i = 0; i < buckets; i++) {
        let l = 32767, h = -32768;
        for (let j = i * fold; j < Math.min(mins.length, (i + 1) * fold); j++) { if (mins[j]! < l) l = mins[j]!; if (maxs[j]! > h) h = maxs[j]!; }
        b.writeInt16LE(l, i * 4);
        b.writeInt16LE(h, i * 4 + 2);
      }
      levels.push({ samplesPerBucket: size, buckets, byteOffset: offset });
      parts.push(b);
      offset += b.length;
    }
    const out = this.tmp('bin');
    fs.writeFileSync(out, Buffer.concat(parts), { mode: 0o600 });
    return { status: 'ready', file: out, mime: 'application/octet-stream', meta: { sampleRate: WAVEFORM_SAMPLE_RATE, totalSamples: total, levels } };
  }

  private async proxy(src: string, s: { width: number; height: number; rate: { num: number; den: number }; rateText: string; frameCount: number }): Promise<Outcome> {
    const proxyHeight = s.height <= 540 ? Math.max(2, s.height - (s.height % 2)) : 540;
    const proxyWidth = even((s.width * proxyHeight) / s.height);
    const gop = Math.max(1, Math.round(s.rate.num / s.rate.den / 2));
    const out = this.tmp('mp4');
    try {
      await this.ff([
        ...this.input(src), '-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=${proxyWidth}:${proxyHeight}`, '-fps_mode', 'passthrough',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-bf', '0', '-g', String(gop), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', '-y', out]);
      const pv = ((await ffprobe(out)).streams ?? []).find((x: any) => x.codec_type === 'video');
      if (!pv) throw new Error('proxy has no video stream');
      if (Number(pv.nb_frames) !== s.frameCount) throw new Error(`proxy frame count ${pv.nb_frames} != original ${s.frameCount}`);
      if (pv.r_frame_rate !== s.rateText) throw new Error(`proxy frame rate ${pv.r_frame_rate} != original ${s.rateText}`);
      return {
        status: 'ready', file: out, mime: 'video/mp4',
        meta: {
          original: { width: s.width, height: s.height, frameRate: s.rate, frameCount: s.frameCount },
          proxy: { width: Number(pv.width), height: Number(pv.height), frameRate: s.rate, frameCount: Number(pv.nb_frames), codec: String(pv.codec_name), gop },
          frameMapping: 'identity',
          scale: Number(pv.height) / s.height,
        },
      };
    } catch (e) { fs.rmSync(out, { force: true }); throw e; }
  }
}
