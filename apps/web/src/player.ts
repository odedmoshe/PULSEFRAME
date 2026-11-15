/**
 * Preview transport. Playback follows the audio clock (AudioContext.currentTime) when an audio
 * device is running, and a monotonic clock otherwise (SPEC §10). Rendering uses the shared
 * evaluator + compositor; frames that cannot be drawn in time are skipped, never queued unbounded.
 */
import * as T from '@pulseframe/time';
import { sequenceDuration, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, drawGraph, evaluate } from '@pulseframe/engine';
import { plannedClipInput } from './audioGraph.ts';
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
  /** Bumped on every play/pause so stale audio pumps stop themselves. */
  private generation = 0;
  /** Seconds of audio scheduled ahead of the clock (bounded lookahead instead of decoding whole files). */
  static readonly AUDIO_LOOKAHEAD = 1.5;
  private scheduledAheadMax = 0;
  private onsets: number[] = [];
  /** Measurement only (tests set window.__pfAudioTap): output level per 50 ms window, in timeline seconds. */
  private levels: { t: number; peak: number }[] = [];
  private tap: AudioWorkletNode | null = null;
  private tapLoaded = false;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array | null = null;
  private origin = { clock: 0, frame: 0 };
  /** Index of the frame most recently painted, for tests and the UI. */
  painted = -1;
  /** Playback instrumentation: how late (seconds) each painted frame appeared relative to the clock that drives audio. */
  private late: number[] = [];
  private requested = 0;
  private now: () => number = () => performance.now() / 1000;

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
        // Draft resolution while playing; FULL project resolution when paused, so a still preview is the real picture (SPEC §8).
        const scale = this.playing ? Math.min(1, 960 / height) : 1;
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        const g = evaluate(doc, T.frameTime(frame, frameRate));
        await drawGraph(this.canvas.getContext('2d', { alpha: false })!, { ...g, width: w, height: h }, scale === 1 ? this.pool.frames : this.pool.draftFrames);
        this.painted = frame;
        if (this.playing) {
          const { num, den } = frameRate;
          this.late.push(this.now() - (this.origin.clock + ((frame - this.origin.frame) * den) / num));
          if (this.late.length > 3000) this.late.shift();
        }
        this.canvas.dataset.frame = String(frame);
        this.canvas.dataset.quality = scale === 1 ? 'full' : 'draft';
        this.canvas.dataset.source = scale === 1 ? 'original' : 'proxy-or-original';
        this.onTick();
      }
    } catch (e) {
      this.onError(e);
    } finally {
      this.busy = false;
    }
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
    const plan = audioPlan(doc);
    if (audioOk && (globalThis as any).__pfAudioTap && !this.tapLoaded) {
      // AudioWorklet tap: sample-accurate (currentFrame), unlike ScriptProcessor whose callbacks lag by a block.
      const code = `registerProcessor('pf-onset-tap', class extends AudioWorkletProcessor {
        constructor() { super(); this.quiet = 0; this.peak = 0; this.n = 0; this.t0 = 0; }
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch) for (let i = 0; i < ch.length; i++) {
            const f = currentFrame + i, a = Math.abs(ch[i]);
            if (f >= this.quiet && a > 0.15) { this.port.postMessage(f / sampleRate); this.quiet = f + sampleRate * 0.3; }
            // Level windows of 50 ms: the peak of each window, stamped with the window's start time on the audio clock.
            if (this.n === 0) this.t0 = f;
            if (a > this.peak) this.peak = a;
            if (++this.n >= sampleRate * 0.05) { this.port.postMessage({ t: this.t0 / sampleRate, peak: this.peak }); this.n = 0; this.peak = 0; }
          }
          return true;
        }
      });`;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await this.actx!.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      this.tapLoaded = true;
    }
    if (this.doc !== doc) return;
    this.playing = true;
    const gen = ++this.generation;
    this.clock = audioOk ? 'audio' : 'monotonic';
    const now = () => (audioOk ? this.actx!.currentTime : performance.now() / 1000);
    this.now = now;
    this.late = [];
    this.requested = 0;
    this.scheduledAheadMax = 0;
    const lead = audioOk ? 0.12 : 0;
    this.origin = { clock: now() + lead, frame: startFrame };
    const originClock = this.origin.clock;
    // All clips mix into one master node. Optional measurement tap (tests set window.__pfAudioTap): records when
    // signal onsets actually reach the output stage, in timeline seconds on the same clock that drives the picture.
    const master = audioOk ? this.actx!.createGain() : null;
    master?.connect(this.actx!.destination);
    this.onsets = [];
    this.levels = [];
    if (master) {
      // Level meter tap (observation only; the analyser has no output so it does not change what is heard).
      const an = this.actx!.createAnalyser();
      an.fftSize = 2048;
      master.connect(an);
      this.analyser = an;
      this.meterBuf = new Float32Array(an.fftSize);
    }
    if (master && (globalThis as any).__pfAudioTap) {
      const tap = new AudioWorkletNode(this.actx!, 'pf-onset-tap', { numberOfOutputs: 0 });
      tap.port.onmessage = (e) => {
        if (typeof e.data === 'number') this.onsets.push(+(e.data - originClock + t0).toFixed(5));
        else this.levels.push({ t: +((e.data as { t: number }).t - originClock + t0).toFixed(4), peak: +(e.data as { peak: number }).peak.toFixed(4) });
      };
      master.connect(tap);
      this.tap = tap;
    }
    if (audioOk)
      for (const c of plan.clips) {
        // Clip timing comes from the shared audio plan (integer samples), the same numbers export uses.
        const start = c.at / plan.sampleRate;
        const end = start + c.length / plan.sampleRate;
        if (end <= t0) continue;
        const sourceIn = c.source / plan.sampleRate;
        // One pump per audible clip: decode forward from the playhead and schedule buffers a bounded time ahead.
        void (async () => {
          const opened = await this.pool.openAudio(c.assetId).catch(() => null);
          if (!opened) return;
          if (gen !== this.generation) return opened.dispose();
          try {
          const fromLocal = Math.max(0, Math.round((t0 - start) * plan.sampleRate));
          const gain = plannedClipInput(this.actx!, c, plan.sampleRate, master!, originClock + (start - t0), fromLocal);
          const srcFrom = sourceIn + Math.max(0, t0 - start);
          const srcTo = sourceIn + (end - start);
          for await (const b of opened.sink.buffers(srcFrom, srcTo)) {
            if (gen !== this.generation) break;
            // Portion of this buffer inside [srcFrom, srcTo), then its position on the playback clock.
            const from = Math.max(b.timestamp, srcFrom);
            const to = Math.min(b.timestamp + b.duration, srcTo);
            if (to <= from) continue;
            const when = originClock + (start + (from - sourceIn) - t0);
            const node = this.actx!.createBufferSource();
            node.buffer = b.buffer;
            node.connect(gain);
            const late = Math.max(0, now() - when); // decode fell behind: skip the part already in the past
            if (to - from - late <= 0) continue;
            node.start(Math.max(when, now()), from - b.timestamp + late, to - from - late);
            this.nodes.push(node);
            node.onended = () => { const i = this.nodes.indexOf(node); if (i >= 0) this.nodes.splice(i, 1); node.disconnect(); };
            const ahead = when - now();
            this.scheduledAheadMax = Math.max(this.scheduledAheadMax, ahead);
            if (ahead > Player.AUDIO_LOOKAHEAD) await new Promise((r) => setTimeout(r, (ahead - Player.AUDIO_LOOKAHEAD) * 1000));
          }
          } finally {
            // The pump owns its input: it is released only after the iterator has stopped, never mid-read.
            opened.dispose();
          }
        })().catch((e) => { if (gen === this.generation) this.onError(e); });
      }
    const tick = () => {
      if (!this.playing) return;
      const elapsed = Math.max(0, now() - this.origin.clock);
      // Frame from absolute elapsed time: no accumulated per-frame rounding.
      const f = this.origin.frame + Math.floor((elapsed * rate.num) / rate.den);
      if (f >= this.frameCount) { this.pause(); this.frame = this.frameCount - 1; this.request(this.frame); this.onTick(); return; }
      if (f !== this.frame) { this.frame = f; this.requested++; this.request(f); this.onTick(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.onTick();
  }
  pause() {
    this.playing = false;
    this.generation++;
    cancelAnimationFrame(this.raf);
    if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
    if (this.tap) { this.tap.port.onmessage = null; this.tap.disconnect(); this.tap = null; }
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }
    this.nodes = [];
    if (this.doc) this.request(this.frame); // repaint the paused frame at full quality
    this.onTick();
  }
  /** Current sample peak of the master mix in dBFS (-Infinity for silence); null when not playing or no audio output. */
  peakDb(): number | null {
    if (!this.playing || !this.analyser || !this.meterBuf) return null;
    this.analyser.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) { const a = Math.abs(this.meterBuf[i]!); if (a > p) p = a; }
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  }
  /** Measured, not estimated. `clock` says which timebase the numbers refer to. */
  syncStats() {
    const v = [...this.late].sort((a, b) => a - b);
    const q = (p: number) => (v.length ? +(v[Math.min(v.length - 1, Math.floor(v.length * p))]! * 1000).toFixed(2) : null);
    return { clock: this.clock, audioContextState: this.actx?.state ?? 'none', outputLatencyMs: this.actx ? +(((this.actx.outputLatency || 0) + (this.actx.baseLatency || 0)) * 1000).toFixed(2) : null, audioScheduledAheadMaxMs: +(this.scheduledAheadMax * 1000).toFixed(1), audioLookaheadMs: Player.AUDIO_LOOKAHEAD * 1000, liveAudioNodes: this.nodes.length, audioOnsetsTimelineSeconds: [...this.onsets], audioLevels: [...this.levels], framesRequested: this.requested, framesPainted: v.length, paintLatenessMs: { median: q(0.5), p95: q(0.95), max: q(1) } };
  }
  dispose() {
    this.pause();
    void this.actx?.close();
  }
}
