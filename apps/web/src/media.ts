/**
 * Frame-exact source decoding via WebCodecs (Mediabunny). One decoder per clip so that two layers
 * showing the same asset never invalidate each other's frame. Sequential requests reuse the decode
 * pipeline; random requests seek from the proper keyframe (Mediabunny handles B-frame/presentation order).
 */
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { FrameImage, FrameProvider, PictureLayer } from '@pulseframe/engine';

class ClipDecoder {
  private cur: VideoSample | null = null;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  lastUsed = 0;
  private constructor(private input: Input, private sink: VideoSampleSink, private frameDur: number) {}

  static async open(blob: Blob, fps: number): Promise<ClipDecoder> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
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

export class MediaPool {
  private blobs = new Map<string, Promise<Blob>>();
  private decoders = new Map<string, Promise<ClipDecoder>>();
  private stills = new Map<string, Promise<FrameImage>>();
  constructor(private fetchAsset: (assetId: string) => Promise<Blob>, private maxDecoders = 6) {}

  /** Use an already-local File (e.g. just picked by the user) instead of downloading it again. */
  provideLocal(assetId: string, blob: Blob) {
    this.blobs.set(assetId, Promise.resolve(blob));
  }
  blob(assetId: string): Promise<Blob> {
    let b = this.blobs.get(assetId);
    if (!b) { b = this.fetchAsset(assetId); this.blobs.set(assetId, b); b.catch(() => this.blobs.delete(assetId)); }
    return b;
  }
  /** Still images decode once per asset. Straight (non-premultiplied) alpha is preserved by the 2D canvas source-over draw. */
  private still(assetId: string): Promise<FrameImage> {
    let s = this.stills.get(assetId);
    if (!s) {
      s = this.blob(assetId).then((b) => createImageBitmap(b, { colorSpaceConversion: 'default', premultiplyAlpha: 'default' })).then((bmp) => ({ draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bmp, dx, dy, dw, dh) }) as FrameImage);
      this.stills.set(assetId, s);
      s.catch(() => this.stills.delete(assetId));
    }
    return s;
  }
  readonly frames: FrameProvider = async (layer: PictureLayer) => {
    if (layer.kind === 'image') return this.still(layer.assetId);
    let d = this.decoders.get(layer.clipId);
    if (!d) {
      d = this.blob(layer.assetId).then((b) => ClipDecoder.open(b, 30));
      this.decoders.set(layer.clipId, d);
      d.catch(() => this.decoders.delete(layer.clipId));
      void this.evict();
    }
    const dec = await d;
    dec.lastUsed = performance.now();
    return dec.frame(layer.sourceSeekSeconds);
  };
  /** Bounded decoder count: prompt disposal of the least recently used (SPEC §8 resource lifetimes). */
  private async evict() {
    if (this.decoders.size <= this.maxDecoders) return;
    const entries = await Promise.all([...this.decoders].map(async ([k, p]) => [k, await p.catch(() => null)] as const));
    entries.sort((a, b) => (a[1]?.lastUsed ?? 0) - (b[1]?.lastUsed ?? 0));
    for (const [k, dec] of entries.slice(0, this.decoders.size - this.maxDecoders)) { this.decoders.delete(k); void dec?.dispose(); }
  }
  async dispose() {
    for (const p of this.decoders.values()) void p.then((d) => d.dispose()).catch(() => {});
    this.decoders.clear();
    this.stills.clear();
    this.blobs.clear();
  }
}
