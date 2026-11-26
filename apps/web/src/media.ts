/**
 * Frame-exact source decoding via WebCodecs (Mediabunny). One decoder per clip and decode lane, so that two layers
 * showing the same asset, or the earlier pictures a time effect merges (ADR-0011), never invalidate each other's frame.
 * Sequential requests reuse the decode pipeline; random requests seek from the proper keyframe (Mediabunny handles
 * B-frame/presentation order): in one decode that the frames after the sought one continue, or, when seek follows seek
 * (scrubbing), by a lookup that decodes to the sought frame and no further (ClipDecoder.get has the rule).
 *
 * Decoders used while a frame is drawn are pinned to that drawing (FrameProvider.begin/end): the budget never disposes them under it, whatever other drawings do.
 * A frame that needs more decoders than the budget gets null for the extra pictures, with the reason (`decode_budget`),
 * never a rejection: the compositor then leaves the time effect out and says why.
 *
 * Warm decoders (prefetch, multicam live switching): `warm()` keeps decoders of assets that are likely to be shown next open
 * and decoded up to a given time, inside ONE byte budget, so that a clip that appears (a live cut, the next segment) takes an
 * open decoder instead of opening one. A warm decoder is an ordinary decoder of the same source a fresh one would read; its
 * answer for a time does not depend on what it was asked before, so taking one over changes when a picture is ready, never
 * which picture it is (ADR-0005). Warm decoders count towards `maxDecoders`, are never pinned, and give their slot to a drawing
 * before any decoder a drawing used lately does.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, UrlSource, VideoSampleSink, type Source } from 'mediabunny';
import { depthGrid, depthKey, LUT_MAX_TEXT_LENGTH, LutError, lutStrip } from '@pulseframe/core';
import { decodeBudgetReason, depthStrip, type DepthStrip, type FrameImage, type FrameProvider, type ImageLayer, type LutStrip, type PictureLayer } from '@pulseframe/engine';

/** What the pool needs of a decoder: the picture at a time from the stream's first frame, and prompt disposal. */
export interface PoolDecoder {
  frame(seconds: number): Promise<FrameImage | null>;
  dispose(): Promise<void>;
}
/** A byte source several decoders of one clip may share (its lanes), and the call that gives it back when one of them is done. */
interface SharedSource { source: Source; release(): void }
/** A decoder of the pool: when it was last asked for (use clock and real time), and the drawings (begin tokens) that hold it. */
interface DecoderEntry { assetId: string; dec: Promise<PoolDecoder>; used: number; pins: Set<number>; last: number }
/** A warm decoder (see MediaPool.warm): its asset and quality, the bytes the budget counts for it, and whether a decode is running. */
interface WarmEntry { assetId: string; quality: 'draft' | 'full'; dec: Promise<PoolDecoder>; bytes: number; busy: boolean }
const now = () => performance.now();

/** A decoded picture as a decoder holds it: Mediabunny's VideoSample (media.seek.test.ts counts with a stand-in). */
export interface ClipSample { timestamp: number; duration: number; close(): void; draw(ctx: Parameters<FrameImage['draw']>[0], dx: number, dy: number, dw: number, dh: number): void }
/** What a decoder needs of its samples: VideoSampleSink's lookup by time, and its iterator in presentation order from a time on. */
export interface ClipSampleSource { getSample(t: number): Promise<ClipSample | null>; samples(start?: number): AsyncGenerator<ClipSample, void, unknown> }

/** Mediabunny's getSample (1.66.0, mediaSamplesAtTimestamps) takes a sample as started at `t` up to this many seconds before its timestamp. */
const LOOKUP_TOLERANCE = 1e-10;

export class ClipDecoder implements PoolDecoder {
  private cur: ClipSample | null = null;
  private iter: AsyncGenerator<ClipSample, void, unknown> | null = null;
  /** The sample after `cur`, taken from `iter` by the seek that found `cur`. */
  private ahead: ClipSample | null = null;
  /** The last request that was not for the frame held was a jump (see `get`). */
  private jumped = false;
  private chain: Promise<unknown> = Promise.resolve();
  /** `first` is the timestamp of this file's first video frame; requests are relative to it (original and proxy may differ in container offset). */
  private constructor(private release: () => void, private sink: ClipSampleSource, private frameDur: number, private first: number) {}
  /** TEST ONLY (media.seek.test.ts): a decoder over a stand-in for Mediabunny's sample sink, so what it decodes can be counted without a browser. */
  static over(sink: ClipSampleSource, fps: number, first: number): ClipDecoder { return new ClipDecoder(() => {}, sink, 1 / fps, first); }

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
  private covers(s: ClipSample, t: number) {
    return t >= s.timestamp && t < s.timestamp + (s.duration || this.frameDur);
  }
  private wrap(s: ClipSample): FrameImage {
    return { draw: (ctx, dx, dy, dw, dh) => s.draw(ctx, dx, dy, dw, dh) };
  }
  /** The next sample in presentation order: the one a seek already took from the iterator, else the iterator's. */
  private async following(): Promise<ClipSample | null> {
    const a = this.ahead;
    this.ahead = null;
    if (a) return a;
    const n = await this.iter!.next();
    return n.done ? null : n.value;
  }
  /**
   * The picture at `t`. What a request costs depends on the requests before it, never on the clock; which picture it gets
   * depends on neither (media.seek.test.ts holds the decoder of before both changes as the reference):
   *   the frame held covers `t`                     that frame; nothing changes
   *   a step (after the frame held, by under 0.5 s) the next samples of the iterator, which is started at the frame held if a
   *                                                 lookup found it (play starts from a frame scrubbing reached: that one
   *                                                 time the frames from its key frame are decoded again)
   *   a jump (anything else), the first request     one decode from the key frame that the steps after it continue (`seek`):
   *     or the first since a step                   jump, then play
   *   a jump after a jump, no step in between       the lookup only (getSample: decode to `t`, flush, nothing ahead):
   *                                                 scrubbing, stepping back, a clip played in reverse
   */
  private async get(t: number): Promise<FrameImage | null> {
    if (this.cur && this.covers(this.cur, t)) return this.wrap(this.cur);
    const step = !!this.cur && t > this.cur.timestamp && t < this.cur.timestamp + 0.5;
    const lookupOnly = !step && this.jumped;
    this.jumped = !step;
    if (this.cur && step) {
      this.iter ??= this.sink.samples(this.cur.timestamp);
      for (;;) {
        const n = await this.following();
        if (!n) break;
        if (n.timestamp <= this.cur.timestamp) { n.close(); continue; }
        this.cur.close();
        this.cur = n;
        if (this.covers(this.cur, t) || this.cur.timestamp > t) break;
      }
      if (this.cur && this.covers(this.cur, t)) return this.wrap(this.cur);
    }
    await this.drop();
    if (lookupOnly || !(await this.seek(t))) this.cur = await this.sink.getSample(t); // last frame with PTS <= t
    return this.cur && this.wrap(this.cur);
  }
  /**
   * A seek as ONE decode from the key frame: the iterator that gives the frames after `t` also gives the frame at `t`, its
   * first sample (the last one that starts at or before `t`; the stream's first when none does). Asking getSample(t) for that
   * frame and then starting an iterator at it decodes the frames from the key frame to `t` twice.
   * False: only getSample can say which frame it is, or the iterator failed where getSample, which decodes no further than
   * `t`, may not; nothing is held then.
   */
  private async seek(t: number): Promise<boolean> {
    const iter = this.sink.samples(t);
    let at: ClipSample | null = null, next: ClipSample | null = null;
    try {
      at = (await iter.next()).value ?? null;
      if (at && at.timestamp <= t) {
        next = (await iter.next()).value ?? null; // already decoded when `at` starts before `t`: the iterator knew `at` by seeing this one
        // getSample takes a sample that starts within its tolerance after `t` as started, if it was decoded on the way to `t`
        // (B-frames). No time evaluate asks for (the middle of a frame) is this close to a frame's start.
        if (!next || next.timestamp - t > LOOKUP_TOLERANCE) {
          this.cur = at;
          this.iter = iter;
          this.ahead = next;
          return true;
        }
      }
    } catch { /* getSample is asked below */ }
    const before = !!at && at.timestamp > t; // `t` is before the first frame: no picture, as getSample answers
    at?.close();
    next?.close();
    await iter.return().catch(() => {});
    return before;
  }
  /** Close the pipeline and every sample held. */
  private async drop() {
    const { iter, cur, ahead } = this;
    this.iter = this.cur = this.ahead = null;
    cur?.close();
    ahead?.close();
    await iter?.return();
  }
  async dispose() {
    await this.chain.catch(() => {});
    await this.drop();
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
  /** Prefetch (see `warm`): what is held, within which budget, and what it did. */
  warm: WarmStats;
}
/** A decoder to keep warm: an asset at a quality, decoded up to `seconds` (from the stream's first frame, as sourceSeekSeconds). */
export interface WarmRequest { assetId: string; quality: 'draft' | 'full'; seconds: number; width: number; height: number }
export interface WarmStats {
  /** Warm decoders held now, and the bytes the budget counts for them. */
  decoders: number; bytes: number; budgetBytes: number;
  /** Why nothing is kept warm (the budget is 0, e.g. on a low-memory device), or null. */
  off: string | null;
  /** Warm decoders opened; taken over from a decoder no drawing used lately; taken over by a picture (the point of it); disposed because the plan or the budget no longer held them. */
  opened: number; reused: number; adopted: number; evicted: number;
  /** Of those evicted, the ones disposed to give their slot to a drawing's decoder. */
  gaveRoom: number;
  /** Requests left out because they did not fit the budget (last call), or because no decoder slot was free. */
  overBudget: number; noRoom: number;
}
/**
 * Decoded pictures one decoder may hold at once (the picture shown and its pipeline's queue), at 4 bytes a pixel: deliberately
 * more than a YUV decoder holds, so the estimate errs on the side of memory.
 */
export const WARM_FRAMES_HELD = 8;
/** What the budget counts for one warm decoder: its byte cache (the most it may read ahead) and the pictures it may hold. */
export const warmCostBytes = (width: number, height: number, byteCache: number): number => byteCache + Math.max(1, width) * Math.max(1, height) * 4 * WARM_FRAMES_HELD;
/**
 * The requests that are kept, in order, within `budgetBytes`: the first of each asset and quality, and only while the running
 * total fits (a request that does not fit is skipped and a cheaper one after it may still fit). Pure: the eviction rule.
 */
export function fitWarmBudget<R extends WarmRequest>(list: readonly R[], budgetBytes: number, cost: (r: R) => number): { keep: R[]; over: R[] } {
  const keep: R[] = [], over: R[] = [], seen = new Set<string>();
  let used = 0;
  for (const r of list) {
    const k = `${r.assetId}:${r.quality}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const c = cost(r);
    if (used + c <= budgetBytes) { keep.push(r); used += c; } else over.push(r);
  }
  return { keep, over };
}
/**
 * The prefetch budget for this device, from navigator.deviceMemory (GB, as the browser rounds it; undefined where the browser
 * does not say). Under 2 GB nothing is kept warm (the honest fallback: switches open their decoder when they happen, as before).
 */
export function prefetchBudget(deviceMemoryGB: number | undefined): { bytes: number; off: string | null } {
  const MB = 1 << 20;
  if (deviceMemoryGB === undefined || !Number.isFinite(deviceMemoryGB)) return { bytes: 64 * MB, off: null }; // not reported: a small budget
  if (deviceMemoryGB < 2) return { bytes: 0, off: 'low_memory' };
  return { bytes: (deviceMemoryGB < 4 ? 64 : 160) * MB, off: null };
}

/** The code of a stored file that is missing on disk: the server's answer (404 missing_media) and the reason a picture is left out. */
export const MISSING_MEDIA = 'missing_media';
/** Depth strips kept at once (wave 8 living): each at most 256×256×4 bytes for a hand drawing. */
export const MAX_DEPTHS = 16;

let pools = 0;
export class MediaPool {
  private local = new Map<string, Blob>();
  private blobs = new Map<string, Promise<Blob>>();
  /** By `${clipId}:${quality}:${lane}`: the decoder, when it was last asked for, and the drawings (begin tokens) that hold it. */
  private decoders = new Map<string, DecoderEntry>();
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
  /** Warm decoders by `${assetId}:${quality}`, in the order of the last plan (the last is the first to go). */
  private warmed = new Map<string, WarmEntry>();
  private warmStats: WarmStats = { decoders: 0, bytes: 0, budgetBytes: 0, off: null, opened: 0, reused: 0, adopted: 0, evicted: 0, gaveRoom: 0, overBudget: 0, noRoom: 0 };
  private maxDecoders: number;
  private maxStills: number;
  private byteCache: number;
  constructor(private opts: MediaPoolOptions) {
    this.maxDecoders = opts.maxDecoders ?? 10; // editor default (ADR-0005 budget; to be amended for ADR-0011 decode lanes)
    this.maxStills = opts.maxStills ?? 16;
    this.byteCache = opts.decoderByteCache ?? 16 << 20;
  }

  /**
   * Assets whose stored file the server reports missing (GET …/missing-media; editor only). Their pictures are not asked for:
   * the layer is left out of the frame with the reason `missing_media`, the same thing the compositor does for any picture it
   * cannot have, and their sound is not opened. The render worker never sets this: the export plan refuses such an asset first.
   */
  private missing = new Set<string>();
  setMissing(ids: readonly string[]): boolean {
    const next = new Set(ids);
    if (next.size === this.missing.size && [...next].every((id) => this.missing.has(id))) return false;
    for (const id of this.missing) if (!next.has(id)) this.invalidate(id); // a file put back is decoded afresh
    for (const id of next) if (!this.missing.has(id)) { this.invalidate(id); this.blobs.delete(id); this.stills.delete(id); }
    this.missing = next;
    return true;
  }
  isMissing(assetId: string) { return this.missing.has(assetId); }
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
  /**
   * «תמונה חיה» (wave 8 living): the drawn depth of a photo layer as the strip its pass samples. Core depthGrid (integer, the same
   * bytes in every context) at the grid size of the picture as shown, rasterised ONCE per record and shown size and kept here by
   * depthKey, never per frame (verifier C14 d: up to 24 M integer steps). The texture key is depthKey plus the grid size, so two
   * photos of other shapes with the same drawing never share a texture. null when the layer has no depth; a grid that cannot be
   * made rejects (the compositor then reports the living picture unavailable with that reason). The pass reads any grid of this
   * shape whoever made it.
   */
  depth(layer: ImageLayer): Promise<DepthStrip | null> {
    if (!layer.depth) return Promise.resolve(null);
    const shown = { width: layer.sourceWidth, height: layer.sourceHeight };
    const key = `${depthKey(layer.depth)}@${shown.width}x${shown.height}`;
    let d = this.depths.get(key);
    if (d) { this.depths.delete(key); this.depths.set(key, d); return d; } // most recently used last
    const depth = layer.depth;
    d = Promise.resolve().then(() => { const grid = depthGrid(depth, shown); return depthStrip(grid, `${depthKey(depth)}@${grid.width}x${grid.height}`); });
    this.depths.set(key, d);
    d.catch(() => { if (this.depths.get(key) === d) this.depths.delete(key); }); // a failure is not kept: the next frame tries again
    while (this.depths.size > MAX_DEPTHS) this.depths.delete(this.depths.keys().next().value!);
    return d;
  }
  private depths = new Map<string, Promise<DepthStrip>>();
  private readonly name = `pool${++pools}`;
  /** Full quality: always the original media (export, agent stills, paused preview). */
  readonly frames: FrameProvider = Object.assign((layer: PictureLayer) => this.frame(layer, 'full'), { lut: (assetId: string) => this.lut(assetId), depth: (layer: ImageLayer) => this.depth(layer), begin: () => this.begin(), end: (t: unknown) => this.end(t), refusal: (layer: PictureLayer) => this.refusal(layer, 'full') });
  /** Draft quality: the frame-identical proxy when one exists (playback). A colour table has no proxy: both providers give the same one. */
  readonly draftFrames: FrameProvider = Object.assign((layer: PictureLayer) => this.frame(layer, 'draft'), { lut: (assetId: string) => this.lut(assetId), depth: (layer: ImageLayer) => this.depth(layer), begin: () => this.begin(), end: (t: unknown) => this.end(t), refusal: (layer: PictureLayer) => this.refusal(layer, 'draft') });
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
  private retiring = new Set<DecoderEntry>();
  /**
   * Take a decoder out of use (its asset was replaced, or a proxy became ready). One that a drawing in progress holds is
   * closed only when that drawing ends: closing it at once released the picture that drawing was about to paint
   * ('VideoSample is closed', seen in the editor when a proxy finished while a frame was being drawn).
   */
  private retire(key: string, v: DecoderEntry) {
    this.decoders.delete(key);
    this.disposed++;
    if (v.pins.size) this.retiring.add(v);
    else void v.dec.then((x) => x.dispose()).catch(() => {});
  }
  private keyOf(layer: PictureLayer, quality: 'draft' | 'full') { return `${layer.clipId}:${quality}:${layer.kind === 'video' ? layer.lane ?? 0 : 0}`; }
  private refusal(layer: PictureLayer, quality: 'draft' | 'full'): string | null {
    if (this.missing.has(layer.assetId) && !this.local.has(layer.assetId)) return `${MISSING_MEDIA}: the stored file of asset ${layer.assetId} is missing`;
    return layer.kind === 'image' ? null : this.refusals.get(this.keyOf(layer, quality)) ?? null;
  }
  /**
   * The decoder for a key, opened if need be. Everything up to the open happens synchronously, so the requests of one frame
   * (all made at once by drawGraph) are pinned in the order they are made. Null: the budget is full of pinned decoders.
   */
  private decoderFor(layer: Extract<PictureLayer, { kind: 'video' }>, quality: 'draft' | 'full', key: string): Promise<PoolDecoder> | null {
    let d = this.decoders.get(key);
    if (d && d.assetId !== layer.assetId) { this.retire(key, d); d = undefined; }
    if (!d) {
      const w = this.warmed.get(`${layer.assetId}:${quality}`);
      if (w) {
        // a warm decoder of this asset and quality: the same source a fresh one would read, already open and decoded near here
        this.warmed.delete(`${layer.assetId}:${quality}`);
        this.warmStats.adopted++;
        d = { assetId: layer.assetId, dec: w.dec, used: 0, pins: new Set<number>(), last: 0 };
        this.decoders.set(key, d);
        const entry = d;
        w.dec.catch(() => { if (this.decoders.get(key) === entry) this.decoders.delete(key); });
      }
    }
    if (!d) {
      if (!this.makeRoom()) return null;
      const lane = layer.lane ?? 0;
      const dec = this.videoSource(layer.assetId, quality).then((src) => this.opts.openDecoder
        ? this.opts.openDecoder(src, { assetId: layer.assetId, clipId: layer.clipId, quality, lane })
        : ClipDecoder.open(typeof src === 'string' ? this.urlSource(`${layer.clipId}:${quality}`, src) : src, 30));
      const entry = { assetId: layer.assetId, dec, used: 0, pins: new Set<number>(), last: 0 };
      d = entry;
      this.decoders.set(key, entry);
      this.opened++;
      this.peak = Math.max(this.peak, this.decoders.size + this.warmed.size);
      dec.catch(() => { if (this.decoders.get(key) === entry) this.decoders.delete(key); });
    }
    d.used = ++this.useClock;
    d.last = now();
    if (this.drawing) d.pins.add(this.drawing);
    return d.dec;
  }
  private frame(layer: PictureLayer, quality: 'draft' | 'full'): Promise<FrameImage | null> {
    if (this.missing.has(layer.assetId) && !this.local.has(layer.assetId)) return Promise.resolve(null);
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
   * Bounded decoder count: before a decoder is opened, decoders the current drawing does not use are disposed until there is
   * room: first those no drawing used in the last STALE_MS (least recently used first), then warm ones (the least wanted
   * first), then the least recently used of the rest. False when every open decoder is in use by the current drawing (pinned).
   */
  private makeRoom(): boolean {
    while (this.decoders.size + this.warmed.size >= this.maxDecoders && this.warmed.size) {
      if (this.freeStaleSlot()) continue;
      const [k, w] = [...this.warmed].at(-1)!;
      this.warmStats.gaveRoom++;
      this.dropWarm(k, w);
    }
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
   * Keep decoders warm for `list` (in order of how likely each is to be shown next), within `budgetBytes` (fitWarmBudget with
   * warmCostBytes): a warm decoder of each kept asset and quality, decoded up to the time asked for. Warm decoders the list no
   * longer holds, or that no longer fit, are disposed at once (eviction); `warm([], …)` lets them all go. A warm decoder is:
   * one already held; else a decoder of that asset and quality that no drawing used in the last STALE_MS (it is taken out of the
   * drawn ones, so nothing is opened); else a new one, only while a decoder slot is free or a stale decoder can give its slot
   * (a decoder a drawing holds or used lately is never touched). A decode still running for an entry is not asked again (no
   * queue builds up). Nothing here changes what any drawing gets for a picture.
   */
  warm(list: readonly WarmRequest[], budgetBytes: number, off: string | null = null): WarmStats {
    const cost = (r: WarmRequest) => warmCostBytes(r.width, r.height, this.byteCache);
    const usable = list.filter((r) => !(this.missing.has(r.assetId) && !this.local.has(r.assetId)));
    const { keep, over } = fitWarmBudget(usable, Math.max(0, budgetBytes), cost);
    Object.assign(this.warmStats, { budgetBytes: Math.max(0, budgetBytes), off: budgetBytes > 0 ? null : off ?? 'no_budget', overBudget: over.length, noRoom: 0 });
    const want = new Map<string, WarmRequest>(keep.map((r) => [`${r.assetId}:${r.quality}`, r]));
    for (const [k, w] of [...this.warmed]) if (!want.has(k)) this.dropWarm(k, w);
    const next = new Map<string, WarmEntry>();
    for (const [k, r] of want) {
      let w = this.warmed.get(k) ?? this.reuseStale(r) ?? undefined;
      if (!w) {
        if (this.decoders.size + this.warmed.size + next.size >= this.maxDecoders && !this.freeStaleSlot()) { this.warmStats.noRoom++; continue; }
        const dec = this.videoSource(r.assetId, r.quality).then((src) => this.opts.openDecoder
          ? this.opts.openDecoder(src, { assetId: r.assetId, clipId: `warm:${r.assetId}`, quality: r.quality, lane: 0 })
          : ClipDecoder.open(typeof src === 'string' ? this.urlSource(`warm:${k}`, src) : src, 30));
        w = { assetId: r.assetId, quality: r.quality, dec, bytes: cost(r), busy: false };
        this.warmStats.opened++;
        const entry = w;
        dec.catch(() => { if (this.warmed.get(k) === entry) this.warmed.delete(k); });
      }
      w.bytes = cost(r);
      this.warmed.delete(k);
      next.set(k, w);
      if (!w.busy) {
        const entry = w;
        entry.busy = true;
        void entry.dec.then((x) => x.frame(r.seconds)).catch(() => null).finally(() => { entry.busy = false; });
      }
    }
    this.warmed = next; // in the order of this plan
    this.peak = Math.max(this.peak, this.decoders.size + this.warmed.size);
    return this.stats().warm;
  }
  /** A decoder no drawing holds or used in the last STALE_MS, of this asset and quality, moved out of the drawn ones; null when none. */
  private reuseStale(r: WarmRequest): WarmEntry | null {
    const t = now();
    let best: [string, DecoderEntry] | null = null;
    for (const [k, v] of this.decoders) {
      if (v.assetId !== r.assetId || !k.includes(`:${r.quality}:`) || v.pins.size || t - v.last < MediaPool.STALE_MS) continue;
      if (!best || v.used > best[1].used) best = [k, v];
    }
    if (!best) return null;
    this.decoders.delete(best[0]);
    this.warmStats.reused++;
    return { assetId: r.assetId, quality: r.quality, dec: best[1].dec, bytes: 0, busy: false };
  }
  /** Dispose the least recently used decoder that no drawing holds or used lately, so a warm one can have its slot. */
  private freeStaleSlot(): boolean {
    const t = now();
    let oldest: string | null = null, at = Infinity;
    for (const [k, v] of this.decoders) if (v.pins.size === 0 && t - v.last >= MediaPool.STALE_MS && v.used < at) { at = v.used; oldest = k; }
    if (oldest === null) return false;
    const v = this.decoders.get(oldest)!;
    this.decoders.delete(oldest);
    this.disposed++;
    void v.dec.then((x) => x.dispose()).catch(() => {});
    return true;
  }
  private dropWarm(k: string, w: WarmEntry) {
    if (this.warmed.get(k) === w) this.warmed.delete(k);
    this.warmStats.evicted++;
    void w.dec.then((x) => x.dispose()).catch(() => {});
  }
  /** A decoder that no drawing used for this long may give its slot to, or become, a warm decoder. */
  static readonly STALE_MS = 250;
  /**
   * Streaming audio decode for preview (bounded: the caller pulls a few buffers ahead of the playhead).
   * Always the ORIGINAL asset, read by range requests; the caller must call `dispose` when playback stops.
   */
  async openAudio(assetId: string): Promise<{ sink: AudioBufferSink; /** This reader's time zero for the file (see Asset.timeOrigin): subtract it from the sink's timestamps. */ origin: number; /** The track's sample rate as the container states it (sound effects open their voice at the decoder's rate; the first decoded buffer confirms it). */ sampleRate: number; dispose(): void } | null> {
    const l = this.local.get(assetId);
    if (!l && this.missing.has(assetId)) return null;
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
    for (const [k, w] of [...this.warmed]) if (w.assetId === assetId) this.dropWarm(k, w);
  }
  stats(): MediaPoolStats {
    const warm = { ...this.warmStats, decoders: this.warmed.size, bytes: [...this.warmed.values()].reduce((a, w) => a + w.bytes, 0) };
    return { warm, decoders: this.decoders.size, stills: this.stills.size, maxDecoders: this.maxDecoders, maxStills: this.maxStills, decoderByteCacheBytes: this.byteCache, sources: { ...this.sources }, sourcesUsed: structuredClone(this.used), opened: this.opened, disposed: this.disposed, peakDecoders: this.peak, refused: this.refused };
  }
  async dispose() {
    for (const v of this.decoders.values()) void v.dec.then((d) => d.dispose()).catch(() => {});
    for (const w of this.warmed.values()) void w.dec.then((d) => d.dispose()).catch(() => {});
    this.warmed.clear();
    for (const v of this.retiring) void v.dec.then((d) => d.dispose()).catch(() => {});
    this.retiring.clear();
    for (const v of this.stills.values()) void v.img.then((x) => x.bmp.close()).catch(() => {});
    this.decoders.clear();
    this.refusals.clear();
    this.stills.clear();
    this.luts.clear();
    this.lutFailures.clear();
    this.depths.clear();
    this.blobs.clear();
  }
}
