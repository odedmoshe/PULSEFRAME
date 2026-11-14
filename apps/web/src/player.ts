/**
 * Preview transport. Playback follows the audio clock (AudioContext.currentTime) when an audio
 * device is running, and a monotonic clock otherwise (SPEC §10). Rendering uses the shared
 * evaluator + compositor; frames that cannot be drawn in time are skipped, never queued unbounded.
 */
import * as T from '@pulseframe/time';
import { sequenceDuration, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate } from '@pulseframe/engine';
import type { MediaPool } from './media.ts';

export class Player {
  doc: ProjectDocument | null = null;
  frame = 0;
  playing = false;
  clock: 'audio' | 'monotonic' = 'monotonic';
  private busy = false;
  private want: number | null = null;
  private raf = 0;
  private actx: AudioContext | null = null;
  private nodes: AudioBufferSourceNode[] = [];
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private origin = { clock: 0, frame: 0 };
  /** Index of the frame most recently painted, for tests and the UI. */
  painted = -1;

  constructor(private canvas: HTMLCanvasElement, private pool: MediaPool, private onTick: () => void, private onError: (e: unknown) => void) {}

  get frameCount() {
    return this.doc ? T.frameCount(sequenceDuration(this.doc), this.doc.settings.frameRate) : 0;
  }
  setDoc(doc: ProjectDocument) {
    this.doc = doc;
    if (this.playing) this.pause();
    this.frame = Math.min(this.frame, Math.max(0, this.frameCount - 1));
    this.painted = -1;
    this.request(this.frame);
  }
  seek(frame: number) {
    if (this.playing) this.pause();
    this.frame = Math.max(0, Math.min(frame, Math.max(0, this.frameCount - 1)));
    this.request(this.frame);
    this.onTick();
  }
  /** Coalesce: only the most recent requested frame is rendered once the current draw finishes. */
  private request(frame: number) {
    this.want = frame;
    if (!this.busy) void this.pump();
  }
  private async pump() {
    this.busy = true;
    try {
      while (this.want !== null && this.doc) {
        const frame = this.want;
        this.want = null;
        const doc = this.doc;
        const { width, height, frameRate } = doc.settings;
        // Preview may reduce resolution; layout is resolution-independent so semantics are unchanged.
        const scale = Math.min(1, 960 / height);
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        const g = evaluate(doc, T.frameTime(frame, frameRate));
        await drawGraph(this.canvas.getContext('2d', { alpha: false })!, { ...g, width: w, height: h }, this.pool.frames);
        this.painted = frame;
        this.canvas.dataset.frame = String(frame);
        this.onTick();
      }
    } catch (e) {
      this.onError(e);
    } finally {
      this.busy = false;
    }
  }

  private audioBuffer(assetId: string): Promise<AudioBuffer> {
    let b = this.buffers.get(assetId);
    if (!b) {
      b = this.pool.blob(assetId).then((blob) => blob.arrayBuffer()).then((ab) => this.actx!.decodeAudioData(ab));
      this.buffers.set(assetId, b);
      b.catch(() => this.buffers.delete(assetId));
    }
    return b;
  }
  async play() {
    if (!this.doc || this.playing || this.frameCount === 0) return;
    const doc = this.doc;
    const rate = doc.settings.frameRate;
    if (this.frame >= this.frameCount - 1) this.frame = 0;
    const startFrame = this.frame;
    const t0 = T.toSeconds(T.frameTime(startFrame, rate));
    this.actx ??= new AudioContext({ sampleRate: doc.settings.sampleRate, latencyHint: 'interactive' });
    await Promise.race([this.actx.resume(), new Promise((r) => setTimeout(r, 300))]);
    const audioOk = this.actx.state === 'running';
    const clips = doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'audio' && !t.muted).flatMap((t) => t.clips);
    const decoded = audioOk ? await Promise.all(clips.map((c) => (c.type === 'media' ? this.audioBuffer(c.assetId).catch(() => null) : null))) : [];
    if (this.doc !== doc) return;
    this.playing = true;
    this.clock = audioOk ? 'audio' : 'monotonic';
    const now = () => (audioOk ? this.actx!.currentTime : performance.now() / 1000);
    const lead = audioOk ? 0.06 : 0;
    this.origin = { clock: now() + lead, frame: startFrame };
    clips.forEach((c, i) => {
      const buf = decoded[i];
      if (!buf || c.type !== 'media') return;
      const start = T.toSeconds(c.start);
      const end = start + T.toSeconds(c.duration);
      if (end <= t0) return;
      const skip = Math.max(0, t0 - start);
      const src = this.actx!.createBufferSource();
      const gain = this.actx!.createGain();
      gain.gain.value = c.gain;
      src.buffer = buf;
      src.connect(gain).connect(this.actx!.destination);
      src.start(this.origin.clock + Math.max(0, start - t0), T.toSeconds(c.sourceIn) + skip, end - start - skip);
      this.nodes.push(src);
    });
    const tick = () => {
      if (!this.playing) return;
      const elapsed = Math.max(0, now() - this.origin.clock);
      // Frame from absolute elapsed time: no accumulated per-frame rounding.
      const f = this.origin.frame + Math.floor((elapsed * rate.num) / rate.den);
      if (f >= this.frameCount) { this.pause(); this.frame = this.frameCount - 1; this.request(this.frame); this.onTick(); return; }
      if (f !== this.frame) { this.frame = f; this.request(f); this.onTick(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.onTick();
  }
  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }
    this.nodes = [];
    this.onTick();
  }
  dispose() {
    this.pause();
    void this.actx?.close();
  }
}
