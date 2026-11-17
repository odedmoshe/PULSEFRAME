/**
 * Frame-exact source decoding via WebCodecs (Mediabunny). One decoder per clip and decode lane, so that two layers
 * showing the same asset, or the earlier pictures a time effect merges (ADR-0011), never invalidate each other's frame.
 * Sequential requests reuse the decode pipeline; random requests seek from the proper keyframe (Mediabunny handles
 * B-frame/presentation order).
 *
 * Decoders used while a frame is drawn are pinned to that drawing (FrameProvider.begin/end): the budget never disposes them under it, whatever other drawings do.
 * A frame that needs more decoders than the budget gets null for the extra pictures, with the reason (`decode_budget`),
 * never a rejection: the compositor then leaves the time effect out and says why.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, UrlSource, VideoSampleSink, type Source, type VideoSample } from 'mediabunny';
import { LUT_MAX_TEXT_LENGTH, LutError, lutStrip } from '@pulseframe/core';
import { decodeBudgetReason, type FrameImage, type FrameProvider, type LutStrip, type PictureLayer } from '@pulseframe/engine';

/** What the pool needs of a decoder: the picture at a time from the stream's first frame, and prompt disposal. */
export interface PoolDecoder {
  frame(seconds: number): Promise<FrameImage | null>;
  dispose(): Promise<void>;
}
/** A byte source several decoders of one clip may share (its lanes), and the call that gives it back when one of them is done. */
interface SharedSource { source: Source; release(): void }

class ClipDecoder implements PoolDecoder {
  private cur: VideoSample | null = null;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /** `first` is the timestamp of this file's first video frame; requests are relative to it (original and proxy may differ in container offset). */
  private constructor(private release: () => void, private sink: VideoSampleSink, private frameDur: number, private first: number) {}

  /**
   * `src` is a local Blob/File or a shared URL source. URLs are read with HTTP range requests through a bounded byte cache;
   * the file is never downloaded whole. Mediabunny counts the inputs that read one source (Source.ref): the source is
   * disposed with the last of them.
   */
  static async open(src: Blob | SharedSource, fps: number): Promise<ClipDecoder> {
    const shared = src instanceof Blob ? null : src;
    let input: Input | null = null;
    let opened = false;
    try {
      input = new Input({ source: shared ? shared.source : new BlobSource(src as Blob), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('asset has no video track');
      if (!(await track.canDecode())) throw new Error(`this browser cannot decode the video codec (${track.codec ?? 'unknown'})`);
      // A negative first timestamp marks frames that are not meant to be shown; presentation starts at 0 then.
      const own = input;
      const dec = new ClipDecoder(() => { own.dispose(); shared?.release(); }, new VideoSampleSink(track), 1 / fps, Math.max(0, await track.getFirstTimestamp()));
      opened = true;
      return dec;
    } finally { if (!opened) { input?.dispose(); shared?.release(); } }
  }
  /** `seconds` is measured from the first frame of the stream (see evaluate.ts). */
  frame(seconds: number): Promise<FrameImage | null> {
    const p = this.chain.then(() => this.get(this.first + seconds));
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
    this.release();
    this.release = () => {};
  }
}

export interface MediaPoolOptions {
  /** URL of the original asset bytes (must answer Range requests). */
  assetUrl(assetId: string): string;
  /** Editor only: URL of a frame-identical proxy when one is ready, else null. Export never sets this. */
  previewUrl?(assetId: string): Promise<string | null>;
  /**
   * Resource budgets (SPEC §8: bounded queues/caches, prompt disposal). `maxDecoders` counts video decoders, one per
   * clip, quality and decode lane (default 10 in the editor; the render worker and browser export set 12; ADR-0005, to be
   * amended for ADR-0011). `decoderByteCache` is the byte cache of one clip's URL source, shared by that clip's lanes.
   */
  maxDecoders?: number;
  maxStills?: number;
  decoderByteCache?: number;
  /**
   * TEST ONLY (media.lanes.test.ts): opens a decoder in place of Mediabunny, so the pool's keys, pinning and budget can be
   * checked without a browser. `src` is what a real decoder would read. Never set by the editor, the render worker or export.
   */
  openDecoder?(src: Blob | string, what: { assetId: string; clipId: string; quality: 'draft' | 'full'; lane: number }): Promise<PoolDecoder>;
}
export interface MediaPoolStats {
  decoders: number; stills: number; maxDecoders: number; maxStills: number; decoderByteCacheBytes: number; sources: Record<string, 'local' | 'proxy' | 'original'>; sourcesUsed: Record<string, string[]>; opened: number; disposed: number;
  /** The most decoders that were open at once. */
  peakDecoders: number;
  /** Pictures refused because their frame needed more decoders than `maxDecoders` (decode_budget). */
  refused: number;
}

let pools = 0;
export class MediaPool {
  private local = new Map<string, Blob>();
  private blobs = new Map<string, Promise<Blob>>();
  /** By `${clipId}:${quality}:${lane}`: the decoder, when it was last asked for, and the drawings (begin tokens) that hold it. */
  private decoders = new Map<string, { assetId: string; dec: Promise<PoolDecoder>; used: number; pins: Set<number> }>();
  /** URL sources shared by the lanes of one clip, by `${clipId}:${quality}\n${url}`, with how many decoders read each. */
  private urlSources = new Map<string, { source: UrlSource; users: number }>();
  /** Why the last request for a decoder key resolved null (the budget), by key. */
  private refusals = new Map<string, string>();
  /** The drawing whose frames are being asked for now (frames are asked for synchronously right after begin), 0 for none. */
  private drawing = 0;
  private drawings = 0;
  private useClock = 0;
  private peak = 0;
  private refused = 0;
  private stills = new Map<string, { used: number; img: Promise<{ bmp: ImageBitmap; image: FrameImage }> }>();
  private luts = new Map<string, Promise<LutStrip>>();
  /** Colour tables that could not be loaded: the error, how many times in a row, and until when it is given again without another try. */
  private lutFailures = new Map<string, { error: unknown; tries: number; until: number }>();
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
    this.maxDecoders = opts.maxDecoders ?? 10; // editor default (ADR-0005 budget; to be amended for ADR-0011 decode lanes)
    this.maxStills = opts.maxStills ?? 16;
    this.byteCache = opts.decoderByteCache ?? 16 << 20;
  }

  /** Use an already-local File (e.g. just picked by the user) instead of fetching it. */
  provideLocal(assetId: string, blob: Blob) {
    this.local.set(assetId, blob);
  }
  /** Whole-asset bytes. Only for small things (stills, and audio until the streaming audio path lands). `fresh`: ask the server again, past the browser's own cache. */
  blob(assetId: string, fresh = false): Promise<Blob> {
    const l = this.local.get(assetId);
    if (l) return Promise.resolve(l);
    let b = this.blobs.get(assetId);
    if (!b) {
      b = fetch(this.opts.assetUrl(assetId), { credentials: 'same-origin', ...(fresh ? { cache: 'reload' as const } : {}) }).then((r) => { if (!r.ok) throw new Error(`asset ${assetId}: HTTP ${r.status}`); return r.blob(); });
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
  /**
   * A colour table asset (.cube) as the strip a render pass samples: the file's bytes, read as text and turned into the strip
   * by core's lutStrip, the one function every context uses. Parsed once per asset. `key` is the content hash of the bytes, or,
   * where the browser offers no digest (a page that is not a secure context), this pool's own name for the asset: an asset id
   * never changes its content.
   * A failed load is not kept for good, but it is not repeated for every drawn frame either: the same error is given for a
   * short while (one second, doubling with each failure in a row, at most thirty), and the next request after that starts from
   * nothing, asking the server for the bytes again past the browser's cache, so a file that was put right is picked up
   * without reloading the page. A file larger than a .cube may be is refused before it is read into memory.
   */
  lut(assetId: string): Promise<LutStrip> {
    let l = this.luts.get(assetId);
    if (l) return l;
    const failed = this.lutFailures.get(assetId);
    if (failed && performance.now() < failed.until) return Promise.reject(failed.error);
    if (failed) this.blobs.delete(assetId);
    l = this.blob(assetId, !!failed).then(async (b) => {
      if (b.size > LUT_MAX_TEXT_LENGTH) throw new LutError('too_large', `the file is larger than a .cube file may be (${LUT_MAX_TEXT_LENGTH} bytes)`);
      const bytes = await b.arrayBuffer();
      const strip = lutStrip(new TextDecoder('utf-8').decode(bytes));
      const digest = globalThis.crypto?.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('') : null;
      return { ...strip, key: digest ? `sha256:${digest}` : `${this.name}:${assetId}` };
    });
    this.luts.set(assetId, l);
    l.then(() => { this.lutFailures.delete(assetId); }, (error) => {
      if (this.luts.get(assetId) !== l) return; // the pool was emptied meanwhile
      this.luts.delete(assetId);
      this.blobs.delete(assetId); // bytes that could not be read as a table are not kept either
      const tries = (failed?.tries ?? 0) + 1;
      this.lutFailures.set(assetId, { error, tries, until: performance.now() + Math.min(30_000, 1000 * 2 ** (tries - 1)) });
    });
    return l;
  }
  private readonly name = `pool${++pools}`;
  /** Full quality: always the original media (export, agent stills, paused preview). */
  readonly frames: FrameProvider = Object.assign((layer: PictureLayer) => this.frame(layer, 'full'), { lut: (assetId: string) => this.lut(assetId), begin: () => this.begin(), end: (t: unknown) => this.end(t), refusal: (layer: PictureLayer) => this.refusal(layer, 'full') });
  /** Draft quality: the frame-identical proxy when one exists (playback). A colour table has no proxy: both providers give the same one. */
  readonly draftFrames: FrameProvider = Object.assign((layer: PictureLayer) => this.frame(layer, 'draft'), { lut: (assetId: string) => this.lut(assetId), begin: () => this.begin(), end: (t: unknown) => this.end(t), refusal: (layer: PictureLayer) => this.refusal(layer, 'draft') });
  /**
   * A new drawing starts: the decoders it asks for are pinned to its token until it ends, whatever other drawings (another
   * player on the same pool, such as the source viewer's) start and end meanwhile. Under a shared counter, a second
   * drawing's begin released the first one's decoders while it was still drawing, and the budget could dispose one of them
   * mid-frame ('VideoSample is closed').
   */
  private begin(): number { this.drawing = ++this.drawings; return this.drawing; }
  private end(token: unknown) {
    if (typeof token !== 'number') return;
    for (const d of this.decoders.values()) d.pins.delete(token);
    for (const d of [...this.retiring]) { d.pins.delete(token); if (d.pins.size === 0) { this.retiring.delete(d); void d.dec.then((x) => x.dispose()).catch(() => {}); } }
    if (this.drawing === token) this.drawing = 0;
  }
  /** Decoders taken out of use while a drawing still held their picture: disposed when the last such drawing ends. */
  private retiring = new Set<{ assetId: string; dec: Promise<PoolDecoder>; used: number; pins: Set<number> }>();
  /**
   * Take a decoder out of use (its asset was replaced, or a proxy became ready). One that a drawing in progress holds is
   * closed only when that drawing ends: closing it at once released the picture that drawing was about to paint
   * ('VideoSample is closed', seen in the editor when a proxy finished while a frame was being drawn).
   */
  private retire(key: string, v: { assetId: string; dec: Promise<PoolDecoder>; used: number; pins: Set<number> }) {
    this.decoders.delete(key);
    this.disposed++;
    if (v.pins.size) this.retiring.add(v);
    else void v.dec.then((x) => x.dispose()).catch(() => {});
  }
  private keyOf(layer: PictureLayer, quality: 'draft' | 'full') { return `${layer.clipId}:${quality}:${layer.kind === 'video' ? layer.lane ?? 0 : 0}`; }
  private refusal(layer: PictureLayer, quality: 'draft' | 'full'): string | null { return layer.kind === 'image' ? null : this.refusals.get(this.keyOf(layer, quality)) ?? null; }
  /**
   * The decoder for a key, opened if need be. Everything up to the open happens synchronously, so the requests of one frame
   * (all made at once by drawGraph) are pinned in the order they are made. Null: the budget is full of pinned decoders.
   */
  private decoderFor(layer: Extract<PictureLayer, { kind: 'video' }>, quality: 'draft' | 'full', key: string): Promise<PoolDecoder> | null {
    let d = this.decoders.get(key);
    if (d && d.assetId !== layer.assetId) { this.retire(key, d); d = undefined; }
    if (!d) {
      if (!this.makeRoom()) return null;
      const lane = layer.lane ?? 0;
      const dec = this.videoSource(layer.assetId, quality).then((src) => this.opts.openDecoder
        ? this.opts.openDecoder(src, { assetId: layer.assetId, clipId: layer.clipId, quality, lane })
        : ClipDecoder.open(typeof src === 'string' ? this.urlSource(`${layer.clipId}:${quality}`, src) : src, 30));
      const entry = { assetId: layer.assetId, dec, used: 0, pins: new Set<number>() };
      d = entry;
      this.decoders.set(key, entry);
      this.opened++;
      this.peak = Math.max(this.peak, this.decoders.size);
      dec.catch(() => { if (this.decoders.get(key) === entry) this.decoders.delete(key); });
    }
    d.used = ++this.useClock;
    if (this.drawing) d.pins.add(this.drawing);
    return d.dec;
  }
  private frame(layer: PictureLayer, quality: 'draft' | 'full'): Promise<FrameImage | null> {
    if (layer.kind === 'image') return this.still(layer.assetId);
    const key = this.keyOf(layer, quality);
    const dec = this.decoderFor(layer, quality, key);
    if (!dec) {
      this.refused++;
      this.refusals.set(key, decodeBudgetReason(this.maxDecoders));
      return Promise.resolve(null);
    }
    this.refusals.delete(key);
    return dec.then((x) => x.frame(layer.sourceSeekSeconds));
  }
  /**
   * The URL source of one clip's lanes (one byte cache for all of them: the lanes of a time effect read nearby parts of the
   * same file). Each decoder that reads it gives it back once; the last one to do so lets it go.
   */
  private urlSource(group: string, url: string): SharedSource {
    const k = `${group}\n${url}`;
    let s = this.urlSources.get(k);
    if (!s) {
      s = { source: new UrlSource(url, { requestInit: { credentials: 'same-origin' }, maxCacheSize: this.byteCache, parallelism: 2, getRetryDelay: (n) => (n < 3 ? 0.2 * 2 ** n : null) }), users: 0 };
      this.urlSources.set(k, s);
    }
    const entry = s;
    entry.users++;
    let given = false;
    return { source: entry.source, release: () => { if (given) return; given = true; if (--entry.users === 0 && this.urlSources.get(k) === entry) this.urlSources.delete(k); } };
  }
  /**
   * Bounded decoder count: before a decoder is opened, the least recently used ones that the current drawing does not use
   * are disposed until there is room. False when every open decoder is in use by the current drawing (pinned).
   */
  private makeRoom(): boolean {
    while (this.decoders.size >= this.maxDecoders) {
      let oldest: string | null = null, at = Infinity;
      for (const [k, v] of this.decoders) if (v.pins.size === 0 && v.used < at) { at = v.used; oldest = k; }
      if (oldest === null) return false;
      const v = this.decoders.get(oldest)!;
      this.decoders.delete(oldest);
      this.disposed++;
      void v.dec.then((x) => x.dispose()).catch(() => {});
    }
    return true;
  }
  /**
   * Streaming audio decode for preview (bounded: the caller pulls a few buffers ahead of the playhead).
   * Always the ORIGINAL asset, read by range requests; the caller must call `dispose` when playback stops.
   */
  async openAudio(assetId: string): Promise<{ sink: AudioBufferSink; /** This reader's time zero for the file (see Asset.timeOrigin): subtract it from the sink's timestamps. */ origin: number; /** The track's sample rate as the container states it (sound effects open their voice at the decoder's rate; the first decoded buffer confirms it). */ sampleRate: number; dispose(): void } | null> {
    const l = this.local.get(assetId);
    const source = l ? new BlobSource(l) : new UrlSource(this.opts.assetUrl(assetId), { requestInit: { credentials: 'same-origin' }, maxCacheSize: 8 << 20, getRetryDelay: (n) => (n < 3 ? 0.2 * 2 ** n : null) });
    const input = new Input({ source, formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) { input.dispose(); return null; }
      return { sink: new AudioBufferSink(track), origin: Math.max(0, await input.getFirstTimestamp()), sampleRate: await track.getSampleRate(), dispose: () => input.dispose() };
    } catch (e) { input.dispose(); throw e; }
  }
  /** Drop decoders of one asset (e.g. its proxy just became ready, or the asset was replaced). */
  invalidate(assetId: string) {
    for (const [k, v] of [...this.decoders]) if (v.assetId === assetId) this.retire(k, v);
  }
  stats(): MediaPoolStats {
    return { decoders: this.decoders.size, stills: this.stills.size, maxDecoders: this.maxDecoders, maxStills: this.maxStills, decoderByteCacheBytes: this.byteCache, sources: { ...this.sources }, sourcesUsed: structuredClone(this.used), opened: this.opened, disposed: this.disposed, peakDecoders: this.peak, refused: this.refused };
  }
  async dispose() {
    for (const v of this.decoders.values()) void v.dec.then((d) => d.dispose()).catch(() => {});
    for (const v of this.retiring) void v.dec.then((d) => d.dispose()).catch(() => {});
    this.retiring.clear();
    for (const v of this.stills.values()) void v.img.then((x) => x.bmp.close()).catch(() => {});
    this.decoders.clear();
    this.refusals.clear();
    this.stills.clear();
    this.luts.clear();
    this.lutFailures.clear();
    this.blobs.clear();
  }
}
