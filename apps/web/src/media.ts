/**
 * Frame-exact source decoding via WebCodecs (Mediabunny). One decoder per clip so that two layers
 * showing the same asset never invalidate each other's frame. Sequential requests reuse the decode
 * pipeline; random requests seek from the proper keyframe (Mediabunny handles B-frame/presentation order).
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { FrameImage, FrameProvider, PictureLayer } from '@pulseframe/engine';

class ClipDecoder {
  private cur: VideoSample | null = null;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  lastUsed = 0;
  private constructor(private input: Input, private sink: VideoSampleSink, private frameDur: number) {}

  /** `src` is a local Blob/File or a URL. URLs are read with HTTP range requests through a bounded byte cache; the file is never downloaded whole. */
  static async open(src: Blob | string, fps: number, byteCache: number): Promise<ClipDecoder> {
    const source = typeof src === 'string' ? new UrlSource(src, { requestInit: { credentials: 'same-origin' }, maxCacheSize: byteCache, parallelism: 2, getRetryDelay: (n) => (n < 3 ? 0.2 * 2 ** n : null) }) : new BlobSource(src);
    const input = new Input({ source, formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('asset has no video track');
    if (!(await track.canDecode())) throw new Error(`this browser cannot decode the video codec (${track.codec ?? 'unknown'})`);
    return new ClipDecoder(input, new VideoSampleSink(track), 1 / fps);
  }
  frame(seconds: number): Promise<FrameImage | null> {
    const p = this.chain.then(() => this.get(seconds));
    this.chain = p.catch(() => {});
    return p;
  }
  private covers(s: VideoSample, t: number) {
    return t >= s.timestamp && t < s.timestamp + (s.duration || this.frameDur);
  }
  private wrap(s: VideoSample): FrameImage {
    return { draw: (ctx, dx, dy, dw, dh) => s.draw(ctx, dx, dy, dw, dh) };
  }
  private async get(t: number): Promise<FrameImage | null> {
    if (this.cur && this.covers(this.cur, t)) return this.wrap(this.cur);
    if (this.cur && this.iter && t > this.cur.timestamp && t < this.cur.timestamp + 0.5) {
      for (;;) {
        const n = await this.iter.next();
        if (n.done) break;
        if (n.value.timestamp <= this.cur.timestamp) { n.value.close(); continue; }
        this.cur.close();
        this.cur = n.value;
        if (this.covers(this.cur, t) || this.cur.timestamp > t) break;
      }
      if (this.cur && this.covers(this.cur, t)) return this.wrap(this.cur);
    }
    await this.iter?.return();
    this.iter = null;
    this.cur?.close();
    this.cur = await this.sink.getSample(t); // last frame with PTS <= t
    if (!this.cur) return null;
    this.iter = this.sink.samples(this.cur.timestamp);
    return this.wrap(this.cur);
  }
  async dispose() {
    await this.chain.catch(() => {});
    await this.iter?.return();
    this.cur?.close();
    this.cur = null;
    this.input.dispose();
  }
}

export interface MediaPoolOptions {
  /** URL of the original asset bytes (must answer Range requests). */
  assetUrl(assetId: string): string;
  /** Editor only: URL of a frame-identical proxy when one is ready, else null. Export never sets this. */
  previewUrl?(assetId: string): Promise<string | null>;
  /** Resource budgets (SPEC §8: bounded queues/caches, prompt disposal). */
  maxDecoders?: number;
  maxStills?: number;
  decoderByteCache?: number;
}
export interface MediaPoolStats { decoders: number; stills: number; maxDecoders: number; maxStills: number; decoderByteCacheBytes: number; sources: Record<string, 'local' | 'proxy' | 'original'>; sourcesUsed: Record<string, string[]>; opened: number; disposed: number }

export class MediaPool {
  private local = new Map<string, Blob>();
  private blobs = new Map<string, Promise<Blob>>();
  private decoders = new Map<string, { assetId: string; dec: Promise<ClipDecoder> }>();
  private stills = new Map<string, { used: number; img: Promise<{ bmp: ImageBitmap; image: FrameImage }> }>();
  private sources: Record<string, 'local' | 'proxy' | 'original'> = {};
  /** Every kind of source a decoder was opened on, per asset (for diagnostics and tests). */
  private used: Record<string, string[]> = {};
  private note(assetId: string, kind: 'local' | 'proxy' | 'original') { this.sources[assetId] = kind; if (!this.used[assetId]?.includes(kind)) (this.used[assetId] ??= []).push(kind); }
  private opened = 0;
  private disposed = 0;
  private maxDecoders: number;
  private maxStills: number;
  private byteCache: number;
  constructor(private opts: MediaPoolOptions) {
    this.maxDecoders = opts.maxDecoders ?? 6;
    this.maxStills = opts.maxStills ?? 16;
    this.byteCache = opts.decoderByteCache ?? 16 << 20;
  }

  /** Use an already-local File (e.g. just picked by the user) instead of fetching it. */
  provideLocal(assetId: string, blob: Blob) {
    this.local.set(assetId, blob);
  }
  /** Whole-asset bytes. Only for small things (stills, and audio until the streaming audio path lands). */
  blob(assetId: string): Promise<Blob> {
    const l = this.local.get(assetId);
    if (l) return Promise.resolve(l);
    let b = this.blobs.get(assetId);
    if (!b) {
      b = fetch(this.opts.assetUrl(assetId), { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(`asset ${assetId}: HTTP ${r.status}`); return r.blob(); });
      this.blobs.set(assetId, b);
      b.catch(() => this.blobs.delete(assetId));
    }
    return b;
  }
  private async videoSource(assetId: string, quality: 'draft' | 'full'): Promise<Blob | string> {
    const l = this.local.get(assetId);
    if (l) { this.note(assetId, 'local'); return l; }
    // The proxy is a draft approximation: only playback uses it. A paused (full-quality) frame decodes the original.
    const proxy = quality === 'draft' ? await this.opts.previewUrl?.(assetId).catch(() => null) : null;
    this.note(assetId, proxy ? 'proxy' : 'original');
    return proxy ?? this.opts.assetUrl(assetId);
  }
  private still(assetId: string): Promise<FrameImage> {
    let s = this.stills.get(assetId);
    if (!s) {
      const img = this.blob(assetId).then((b) => createImageBitmap(b)).then((bmp) => ({ bmp, image: { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bmp, dx, dy, dw, dh) } as FrameImage }));
      s = { used: 0, img };
      this.stills.set(assetId, s);
      img.catch(() => this.stills.delete(assetId));
      if (this.stills.size > this.maxStills) {
        const [oldId, old] = [...this.stills].sort((a, b) => a[1].used - b[1].used)[0]!;
        this.stills.delete(oldId);
        void old.img.then((x) => x.bmp.close()).catch(() => {});
      }
    }
    s.used = performance.now();
    return s.img.then((x) => x.image);
  }
  /** Full quality: always the original media (export, agent stills, paused preview). */
  readonly frames: FrameProvider = (layer: PictureLayer) => this.frame(layer, 'full');
  /** Draft quality: the frame-identical proxy when one exists (playback). */
  readonly draftFrames: FrameProvider = (layer: PictureLayer) => this.frame(layer, 'draft');
  private async frame(layer: PictureLayer, quality: 'draft' | 'full'): Promise<FrameImage | null> {
    if (layer.kind === 'image') return this.still(layer.assetId);
    const key = `${layer.clipId}:${quality}`;
    let d = this.decoders.get(key);
    if (!d || d.assetId !== layer.assetId) {
      if (d) void d.dec.then((x) => x.dispose()).catch(() => {});
      const dec = this.videoSource(layer.assetId, quality).then((src) => ClipDecoder.open(src, 30, this.byteCache));
      d = { assetId: layer.assetId, dec };
      this.decoders.set(key, d);
      this.opened++;
      dec.catch(() => this.decoders.delete(key));
      void this.evict();
    }
    const dec = await d.dec;
    dec.lastUsed = performance.now();
    return dec.frame(layer.sourceSeekSeconds);
  }
  /** Bounded decoder count: prompt disposal of the least recently used. */
  private async evict() {
    if (this.decoders.size <= this.maxDecoders) return;
    const entries = await Promise.all([...this.decoders].map(async ([k, v]) => [k, await v.dec.catch(() => null)] as const));
    entries.sort((a, b) => (a[1]?.lastUsed ?? 0) - (b[1]?.lastUsed ?? 0));
    for (const [k, dec] of entries.slice(0, Math.max(0, this.decoders.size - this.maxDecoders))) {
      if (!this.decoders.delete(k)) continue;
      this.disposed++;
      void dec?.dispose();
    }
  }
  /**
   * Streaming audio decode for preview (bounded: the caller pulls a few buffers ahead of the playhead).
   * Always the ORIGINAL asset, read by range requests; the caller must call `dispose` when playback stops.
   */
  async openAudio(assetId: string): Promise<{ sink: AudioBufferSink; dispose(): void } | null> {
    const l = this.local.get(assetId);
    const source = l ? new BlobSource(l) : new UrlSource(this.opts.assetUrl(assetId), { requestInit: { credentials: 'same-origin' }, maxCacheSize: 8 << 20, getRetryDelay: (n) => (n < 3 ? 0.2 * 2 ** n : null) });
    const input = new Input({ source, formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) { input.dispose(); return null; }
    return { sink: new AudioBufferSink(track), dispose: () => input.dispose() };
  }
  /** Drop decoders of one asset (e.g. its proxy just became ready, or the asset was replaced). */
  invalidate(assetId: string) {
    for (const [k, v] of this.decoders) if (v.assetId === assetId) { this.decoders.delete(k); this.disposed++; void v.dec.then((d) => d.dispose()).catch(() => {}); }
  }
  stats(): MediaPoolStats {
    return { decoders: this.decoders.size, stills: this.stills.size, maxDecoders: this.maxDecoders, maxStills: this.maxStills, decoderByteCacheBytes: this.byteCache, sources: { ...this.sources }, sourcesUsed: structuredClone(this.used), opened: this.opened, disposed: this.disposed };
  }
  async dispose() {
    for (const v of this.decoders.values()) void v.dec.then((d) => d.dispose()).catch(() => {});
    for (const v of this.stills.values()) void v.img.then((x) => x.bmp.close()).catch(() => {});
    this.decoders.clear();
    this.stills.clear();
    this.blobs.clear();
  }
}
