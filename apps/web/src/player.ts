/**
 * Preview transport. Playback follows the audio clock (AudioContext.currentTime) when an audio
 * device is running, and a monotonic clock otherwise (SPEC §10). Rendering uses the shared
 * evaluator + compositor; frames that cannot be drawn in time are skipped, never queued unbounded.
 */
import * as T from '@pulseframe/time';
import { sequenceDuration, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, drawGraph, evaluate, FlashGuard, PitchStretcher, RampResampler, rampSourceFrames, rampSpanOf } from '@pulseframe/engine';
import { interleaved, plannedClipInput, reversedBuffer } from './audioGraph.ts';
import type { MediaPool } from './media.ts';

export class Player {
  /** See drawFrame: effect ids the last painted frame had to leave out. */
  unavailableEffects: string[] = [];
  /**
   * For those of them whose cause is not the graphics adapter but their own material (a colour table that could not be loaded):
   * why, by effect id. The editor shows it over the preview, so a picture drawn without its table is never shown silently.
   */
  unavailableReasons: Record<string, string> = {};
  /** While paused, a frame that was drawn without such an effect is drawn again a little later: the table may be loadable by then. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  static readonly RETRY_FIRST_MS = 2000;
  static readonly RETRY_MAX_MS = 30_000;
  doc: ProjectDocument | null = null;
  frame = 0;
  playing = false;
  /** Restart from the beginning when the end is reached. Session setting; never stored in the project. */
  loop = false;
  /** How many times playback wrapped around since it was created (for tests and diagnostics). */
  loops = 0;
  clock: 'audio' | 'monotonic' = 'monotonic';
  /** Shuttle speed in multiples of real time (negative = backwards); 0 when not shuttling. Normal playback is not a shuttle. */
  shuttleRate = 0;
  private starting = false;
  static readonly SHUTTLE_MAX = 8;
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
  /**
   * SAFETY: whatever the transport does (shuttle, stepping, loop, jumps, edits during playback), the screen never shows
   * a strobe flash start less than a third of a second after the last one (engine strobeSchedule.ts FlashGuard).
   */
  readonly flashGuard = new FlashGuard();
  /**
   * Frames are drawn here first and copied to the visible canvas in one step when complete. drawGraph paints the
   * background and then waits (for decoded pictures, colour tables and GPU passes) in the middle of a frame; drawn
   * straight onto the visible canvas, the screen could show those half-drawn states between frames: a dark flicker.
   */
  private back: HTMLCanvasElement | null = null;
  /** Whether a frame has been copied to the visible canvas yet (before that, sizing it early clears nothing anyone sees). */
  private shown = false;
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
    // A change to the project (the user's own edit or another participant's) must not stop playback:
    // stop the old schedule (its sound was planned from the old document) and continue from the same frame at the same speed.
    const resume = this.playing ? (this.shuttleRate || 1) : this.starting ? 1 : 0; // `starting`: play() was asked for and is still waiting for the audio device
    this.doc = doc;
    if (this.playing) this.pause();
    this.frame = Math.min(this.frame, Math.max(0, this.frameCount - 1));
    this.painted = -1;
    this.request(this.frame);
    if (resume && this.frame < this.frameCount - 1) this.shuttle(resume);
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
        if (!this.shown && (this.canvas.width !== w || this.canvas.height !== h)) { this.canvas.width = w; this.canvas.height = h; } // the layout gets the right shape at once
        const back = (this.back ??= document.createElement('canvas'));
        if (back.width !== w || back.height !== h) { back.width = w; back.height = h; }
        const g = this.flashGuard.apply(evaluate(doc, T.frameTime(frame, frameRate)), performance.now() / 1000); // real time, never the audio clock (it can stand still)
        const drawn = await drawGraph(back.getContext('2d', { alpha: false })!, { ...g, width: w, height: h }, scale === 1 ? this.pool.frames : this.pool.draftFrames);
        // the finished frame replaces the one on screen at once (resizing the visible canvas clears it, so only now)
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        this.canvas.getContext('2d', { alpha: false })!.drawImage(back, 0, 0);
        this.shown = true;
        /** GPU effects of the frame on screen that could not run in this browser (shown without them; the editor says so). */
        this.unavailableEffects = drawn.unavailableEffects;
        this.unavailableReasons = drawn.unavailableReasons ?? {};
        this.retryLater(doc, frame);
        this.painted = frame;
        if (this.playing) {
          const { num, den } = frameRate;
          this.late.push(this.now() - (this.origin.clock + ((frame - this.origin.frame) * den) / num));
          if (this.late.length > 3000) this.late.shift();
        }
        this.canvas.dataset.frame = String(frame);
        this.canvas.dataset.flashesHeld = String(this.flashGuard.leftOut); // frames on which the safety guard held a strobe flash back
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

  /**
   * After a frame was painted: if it had to leave out an effect whose material could not be loaded, ask for the same frame again
   * after a wait (2 s, doubling, at most 30 s), as long as it is still the frame on screen. Playback draws anyway, so only a
   * paused preview needs this; without it the picture would stay ungraded until the next seek or edit.
   */
  private retryLater(doc: ProjectDocument, frame: number) {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (Object.keys(this.unavailableReasons).length === 0) { this.retries = 0; return; }
    if (this.playing) return; // the playback loop draws; the frame it stops on is painted again on pause and comes back through here
    // The wait grows only with tries made from here, not with frames the user asks for meanwhile.
    const wait = Math.min(Player.RETRY_MAX_MS, Player.RETRY_FIRST_MS * 2 ** this.retries);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.playing || this.doc !== doc || this.frame !== frame) return;
      this.retries++;
      this.request(frame);
    }, wait);
  }

  async play() {
    if (!this.doc || this.playing || this.frameCount === 0) return;
    const doc = this.doc;
    const rate = doc.settings.frameRate;
    this.starting = true;
    if (this.frame >= this.frameCount - 1) this.frame = 0;
    const startFrame = this.frame;
    const t0 = T.toSeconds(T.frameTime(startFrame, rate));
    this.actx ??= new AudioContext({ sampleRate: doc.settings.sampleRate, latencyHint: 'interactive' });
    await Promise.race([this.actx.resume(), new Promise((r) => setTimeout(r, 300))]);
    const audioOk = this.actx.state === 'running';
    const plan = audioPlan(doc);
    if (audioOk && (globalThis as any).__pfAudioTap && !this.tapLoaded) {
      // AudioWorklet tap: sample-accurate (currentFrame), unlike ScriptProcessor whose callbacks lag by a block.
      await this.actx!.audioWorklet.addModule('/pf-onset-tap.js'); // static file: see apps/web/public (no blob: scripts, so the content security policy can stay strict)
      this.tapLoaded = true;
    }
    if (this.doc !== doc) return; // the project changed while waiting: setDoc has already started playback again with the new one
    this.starting = false;
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
          // Source seconds advance `speed` times as fast as the playback clock (varispeed: pitch follows speed, as in export).
          const speed = c.speed;
          // A continuous speed ramp: after x seconds of the clip, speed·x + (speedEnd − speed)·x²/(2·length) seconds of source have played.
          const ramp = c.speedEnd !== undefined;
          const rs = rampSpanOf(c, 1 / plan.sampleRate); // the ramp in seconds
          const srcAfter = (x: number) => (ramp ? rampSourceFrames(rs.v0, rs.v1, rs.total, rs.offset + x, rs.curve) - rampSourceFrames(rs.v0, rs.v1, rs.total, rs.offset, rs.curve) : x * speed);
          const srcFrom = sourceIn + srcAfter(Math.max(0, t0 - start));
          const srcTo = sourceIn + srcAfter(end - start) + (ramp ? 4 / plan.sampleRate : 0); // the resampler reads a few frames past the last position
          // The decoder reports the file's raw timestamps; source times here are measured from the file's own start as this reader sees it.
          const origin = opened.origin;
          if (c.keepPitch || ramp) {
            // Keep the pitch: the source is read at normal rate in playing order (backwards in windows for a reversed clip), run
            // through the shared stretcher, and its output is scheduled piece after piece at normal rate. The stretcher starts at
            // the playhead here, where export starts it at the clip's start: the two can differ by a few milliseconds of alignment.
            const playFrom = Math.max(start, t0);
            const startAt = originClock + (playFrom - t0);
            const pool = this;
            async function* chunks(): AsyncGenerator<{ sr: number; data: Float32Array }> {
              if (!c.reverse) {
                for await (const raw of opened!.sink.buffers(srcFrom + origin, srcTo + origin)) {
                  const ts = raw.timestamp - origin, from = Math.max(ts, srcFrom), to = Math.min(ts + raw.duration, srcTo);
                  if (to > from) yield interleaved(raw.buffer, from - ts, to - ts, false);
                }
                return;
              }
              const S1 = sourceIn + (end - start) * speed;
              let hi = S1 - Math.max(0, t0 - start) * speed;
              const WINDOW = 2 * speed;
              while (hi > sourceIn + 1e-6 && gen === pool.generation) {
                const lo = Math.max(sourceIn, hi - WINDOW);
                const got: { buffer: AudioBuffer; duration: number; timestamp: number }[] = [];
                for await (const raw of opened!.sink.buffers(lo + origin, hi + origin)) { if (gen !== pool.generation) break; got.push({ buffer: raw.buffer, duration: raw.duration, timestamp: raw.timestamp - origin }); }
                for (const b of got.reverse()) {
                  const from = Math.max(b.timestamp, lo), to = Math.min(b.timestamp + b.duration, hi);
                  if (to > from) yield interleaved(b.buffer, from - b.timestamp, to - b.timestamp, true);
                }
                hi = lo;
              }
            }
            // (a ramped clip takes the same route, with the ramp resampler in place of the stretcher: its pitch glides with the speed)
            let stretcher: PitchStretcher | RampResampler | null = null;
            let outPos = 0; // output frames scheduled so far
            const emit = (out: Float32Array, sr: number) => {
              const room = Math.max(0, Math.round((end - playFrom) * sr) - outPos); // never past the end of the clip
              const frames = Math.min(out.length >> 1, room);
              if (frames <= 0) return;
              const when = startAt + outPos / sr;
              outPos += frames;
              const late = Math.max(0, now() - when);
              if (frames / sr - late <= 0) return;
              const buf = this.actx!.createBuffer(2, frames, sr);
              const l = buf.getChannelData(0), r = buf.getChannelData(1);
              for (let i = 0; i < frames; i++) { l[i] = out[i * 2]!; r[i] = out[i * 2 + 1]!; }
              const node = this.actx!.createBufferSource();
              node.buffer = buf;
              node.connect(gain);
              node.start(Math.max(when, now()), late);
              this.nodes.push(node);
              node.onended = () => { const i = this.nodes.indexOf(node); if (i >= 0) this.nodes.splice(i, 1); node.disconnect(); };
              this.scheduledAheadMax = Math.max(this.scheduledAheadMax, when - now());
            };
            let rateOfSource = 0;
            for await (const ch of chunks()) {
              if (gen !== this.generation) break;
              stretcher ??= ramp ? new RampResampler(rampSpanOf(c, ch.sr / plan.sampleRate), Math.round((playFrom - start) * ch.sr)) : new PitchStretcher(speed, ch.sr);
              rateOfSource = ch.sr;
              emit(stretcher.push(ch.data), ch.sr);
              const ahead = startAt + outPos / ch.sr - now();
              if (ahead > Player.AUDIO_LOOKAHEAD) await new Promise((r) => setTimeout(r, (ahead - Player.AUDIO_LOOKAHEAD) * 1000));
            }
            if (stretcher && gen === this.generation) emit(stretcher.finish(), rateOfSource);
            return;
          }
          if (c.reverse) {
            // Backwards: clip-local time x plays source S1 − x·speed. The decoder only runs forwards, so the remaining stretch is
            // taken in windows from its end towards its start; each window is decoded, then its buffers are scheduled last-first, reversed.
            const S1 = sourceIn + (end - start) * speed;
            let hi = S1 - Math.max(0, t0 - start) * speed;
            const WINDOW = 2 * speed; // source seconds per window: about two seconds of playback
            while (hi > sourceIn + 1e-6 && gen === this.generation) {
              const lo = Math.max(sourceIn, hi - WINDOW);
              const got: { buffer: AudioBuffer; duration: number; timestamp: number }[] = [];
              for await (const raw of opened.sink.buffers(lo + origin, hi + origin)) { if (gen !== this.generation) break; got.push({ buffer: raw.buffer, duration: raw.duration, timestamp: raw.timestamp - origin }); }
              if (gen !== this.generation) break;
              for (const b of got.reverse()) {
                const from = Math.max(b.timestamp, lo), to = Math.min(b.timestamp + b.duration, hi);
                if (to <= from) continue;
                const when = originClock + (start + (S1 - to) / speed - t0);
                const node = this.actx!.createBufferSource();
                node.buffer = reversedBuffer(this.actx!, b.buffer);
                node.playbackRate.value = speed;
                node.connect(gain);
                const late = Math.max(0, now() - when) * speed;
                if (to - from - late <= 0) continue;
                node.start(Math.max(when, now()), b.timestamp + b.duration - to + late, to - from - late);
                this.nodes.push(node);
                node.onended = () => { const i = this.nodes.indexOf(node); if (i >= 0) this.nodes.splice(i, 1); node.disconnect(); };
                this.scheduledAheadMax = Math.max(this.scheduledAheadMax, when - now());
              }
              hi = lo;
              const ahead = originClock + (start + (S1 - hi) / speed - t0) - now(); // how far ahead of the clock the next window starts
              if (ahead > Player.AUDIO_LOOKAHEAD) await new Promise((r) => setTimeout(r, (ahead - Player.AUDIO_LOOKAHEAD) * 1000));
            }
            return;
          }
          for await (const raw of opened.sink.buffers(srcFrom + origin, srcTo + origin)) {
            const b = { buffer: raw.buffer, duration: raw.duration, timestamp: raw.timestamp - origin };
            if (gen !== this.generation) break;
            // Portion of this buffer inside [srcFrom, srcTo), then its position on the playback clock.
            const from = Math.max(b.timestamp, srcFrom);
            const to = Math.min(b.timestamp + b.duration, srcTo);
            if (to <= from) continue;
            const when = originClock + (start + (from - sourceIn) / speed - t0);
            const node = this.actx!.createBufferSource();
            node.buffer = b.buffer;
            node.playbackRate.value = speed;
            node.connect(gain);
            const late = Math.max(0, now() - when) * speed; // decode fell behind: skip the part already in the past (in source seconds)
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
      if (f >= this.frameCount) {
        this.pause();
        // Loop: start again from the first frame (audio is rescheduled from there, so picture and sound stay locked).
        if (this.loop && this.frameCount > 1) { this.frame = 0; this.loops++; this.request(0); this.onTick(); void this.play(); return; }
        this.frame = this.frameCount - 1; this.request(this.frame); this.onTick(); return;
      }
      if (f !== this.frame) { this.frame = f; this.requested++; this.request(f); this.onTick(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.onTick();
  }
  /**
   * Move through the timeline at `rate` times real time, backwards when negative. Silent (sound is only played at normal speed)
   * and timed by the monotonic clock; frames that cannot be drawn in time are skipped, never queued. Stops at either end.
   * `rate` 1 is ordinary playback with sound; 0 pauses.
   */
  shuttle(rate: number) {
    if (!this.doc || this.frameCount === 0) return;
    if (this.playing) this.pause();
    if (rate === 0) return;
    if (rate === 1) { void this.play(); return; }
    const r = Math.max(-Player.SHUTTLE_MAX, Math.min(Player.SHUTTLE_MAX, rate));
    const last = this.frameCount - 1;
    if ((r < 0 && this.frame <= 0) || (r > 0 && this.frame >= last)) return; // nowhere to go
    const fps = this.doc.settings.frameRate, from = this.frame, t0 = performance.now();
    this.playing = true; this.shuttleRate = r; this.clock = 'monotonic'; this.generation++;
    const tick = () => {
      if (!this.playing || this.shuttleRate !== r) return;
      const f = from + Math.trunc((((performance.now() - t0) / 1000) * r * fps.num) / fps.den); // from absolute elapsed time: no accumulated rounding
      if (f <= 0 || f >= last) { this.frame = f <= 0 ? 0 : last; this.pause(); return; }
      if (f !== this.frame) { this.frame = f; this.request(f); this.onTick(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.onTick();
  }
  pause() {
    this.playing = false;
    this.starting = false;
    this.shuttleRate = 0;
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
    return { clock: this.clock, audioContextState: this.actx?.state ?? 'none', outputLatencyMs: this.actx ? +(((this.actx.outputLatency || 0) + (this.actx.baseLatency || 0)) * 1000).toFixed(2) : null, audioScheduledAheadMaxMs: +(this.scheduledAheadMax * 1000).toFixed(1), audioLookaheadMs: Player.AUDIO_LOOKAHEAD * 1000, liveAudioNodes: this.nodes.length, loops: this.loops, audioOnsetsTimelineSeconds: [...this.onsets], audioLevels: [...this.levels], framesRequested: this.requested, framesPainted: v.length, paintLatenessMs: { median: q(0.5), p95: q(0.95), max: q(1) } };
  }
  dispose() {
    this.pause();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    void this.actx?.close();
  }
}
