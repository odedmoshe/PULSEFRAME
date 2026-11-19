/**
 * Preview transport. Playback follows the audio clock (AudioContext.currentTime) when an audio
 * device is running, and a monotonic clock otherwise (SPEC §10). Rendering uses the shared
 * evaluator + compositor; frames that cannot be drawn in time are skipped, never queued unbounded.
 *
 * Sound effects (ADR-0010): a clip with a planned voice is rendered ahead of the clock by the shared engine runtime
 * (openClipVoice, the same code as both exports) on this thread, and its finished samples are scheduled into the master mix
 * on the sample grid. The effects never run as WebAudio nodes. A voice that cannot run here plays its clip dry and says why.
 */
import * as T from '@pulseframe/time';
import { canonical, sequenceDuration, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, drawGraph, evaluate, fillPlayingOrder, FlashGuard, isDecodeBudgetReason, openClipVoice, PitchStretcher, RampResampler, rampSourceFrames, rampSpanOf, soundEnd, type PlannedAudioClip } from '@pulseframe/engine';
import { interleaved, plannedClipInput, reversedBuffer } from './audioGraph.ts';
import type { MediaPool } from './media.ts';

/** One playback (or audition) of the sound: what every per-clip pump needs to place its buffers on the audio clock. */
interface SoundSession {
  gen: number;
  sr: number;
  /** Timeline seconds at the origin, and the same as a timeline sample. */
  t0: number; t0Sample: number;
  now: () => number;
  /** Resolves once the origin is set (or the session was abandoned: pumps then see a new generation and stop). */
  ready: Promise<void>;
  /** Set when `ready` resolves: the context time of the origin, the context frame of timeline sample 0 (K + s plays sample s), and the mix input. */
  originClock: number; K: number; master: AudioNode | null;
  /** Audition only: the timeline sample after which nothing more is played. */
  until?: number;
}
/** A voice that cannot run in this browser, with the reason the editor shows. */
class FxUnavailable extends Error {}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Real time in seconds (the flash guard's clock: monotonic, never the audio clock). */
const realTime = () => performance.now() / 1000;
/** Give the page a turn (rendering, input) between slices of effect processing. */
const yieldToPage = (): Promise<void> => {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
};
/** A decoded buffer as interleaved stereo (a mono buffer fills both sides). */
function interleave(b: AudioBuffer): Float32Array {
  const n = b.length, l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l, out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { out[i * 2] = l[i]!; out[i * 2 + 1] = r[i]!; }
  return out;
}
/** What a failed voice is remembered by: the clip and its exact chain (a changed chain is tried again). */
const fxKey = (c: PlannedAudioClip) => `${c.clipId}|${JSON.stringify(c.voice?.chain ?? [])}`;

/** Player options (ADR-0020). */
export interface PlayerOptions {
  /** Angle viewer: never plays sound; always draws from pool.draftFrames (proxy) at a scale that keeps the height at most maxHeight px. */
  draftOnly?: { maxHeight: number };
}

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
  /** At most this long is waited, before the clock starts, for the effects of clips sounding at the start (ADR-0010). */
  static readonly FX_PRIME_MAX_MS = 500;
  private scheduledAheadMax = 0;
  private onsets: number[] = [];
  /** Measurement only (tests set window.__pfAudioTap): output level (left channel peak) per 50 ms window, in timeline seconds exact to the sample. */
  private levels: { t: number; peak: number }[] = [];
  private tap: AudioWorkletNode | null = null;
  private tapLoaded = false;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array | null = null;
  private origin = { clock: 0, frame: 0 };
  /**
   * SAFETY: whatever the transport does (shuttle, stepping, loop, jumps, edits during playback), the screen never shows
   * a rise of strobe or transition light less than a third of a second after the last one (engine strobeSchedule.ts
   * FlashGuard). pump() tells it what each frame painted and when the frame reached the screen.
   */
  readonly flashGuard = new FlashGuard();
  /** Session setting: hear the mix without sound effects (A/B). Never stored in the project. */
  bypassAudioFx = false;
  /** Switch the A/B setting; playing sound is planned again from the same point, as an edit would (setDoc). */
  setBypassAudioFx(on: boolean): void {
    if (this.bypassAudioFx === on) return;
    this.bypassAudioFx = on;
    if ((this.playing && !this.shuttleRate) || this.starting) { this.pause(); void this.play(); }
    else this.onTick();
  }
  /** Sound clips whose effects could not run in this browser, by clip id: why. They play without effects; the editor says so. */
  unavailableAudioFx: Record<string, string> = {};
  /** Voices that failed during this session (by clip and chain): played dry from then on, with their reason. */
  private fxFailed = new Map<string, string>();
  /**
   * Instrumentation of the last playback. fxPrimeMs: how long the voices sounding at the start took to render their warm-up and
   * first output, measured to the end even when the clock did not wait for them; fxPrimeTimedOut: the clock started at
   * FX_PRIME_MAX_MS before they were ready (fxPrimeMs then grows to the real time once they are). fxLateStarts: voices whose
   * first sound came late; fxLateSkips: parts of voices skipped because they came late.
   */
  private fxPrimeMs = 0;
  private fxPrimeTimedOut = false;
  private fxLateStarts = 0;
  private fxLateSkips = 0;
  private fxVoices = 0;
  /** True while audition() plays a draft clip. */
  auditioning = false;
  private auditionDone: (() => void) | null = null;
  private auditionTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Play `seconds` of one clip's sound from a draft document (nothing is committed, the revision does not change): from the
   * playhead when it lies in the clip's sound, else from the clip's start; the clip alone, through the same path as playback.
   * Resolves when it ends or is stopped (by stopAudition or any transport action).
   */
  async audition(draft: ProjectDocument, clipId: string, seconds = 4): Promise<void> {
    this.stopAudition();
    if (this.playing || this.starting) this.pause();
    const plan = audioPlan(draft, undefined, { bypassFx: false });
    const c = plan.clips.find((x) => x.clipId === clipId);
    if (!c) return;
    const sr = plan.sampleRate;
    const gen = ++this.generation;
    if (!(await this.ensureAudio(sr)) || gen !== this.generation) return;
    const head = this.doc ? T.nearestSampleIndex(T.frameTime(this.frame, this.doc.settings.frameRate), sr) : c.at;
    const startSample = head >= c.at && head < soundEnd(c) ? head : c.at;
    const until = Math.min(soundEnd(c), startSample + Math.max(1, Math.round(seconds * sr)));
    this.auditioning = true;
    const finished = new Promise<void>((r) => { this.auditionDone = r; });
    this.onTick();
    const session = await this.startSound([c], sr, startSample / sr, startSample, gen, until);
    if (!session || gen !== this.generation) {
      // Abandoned. Whatever moved the generation on (stopAudition, a transport action, the next audition) has already ended this
      // audition and resolved `finished`; endAudition acts on the current audition, which may by now be the next one.
      if (gen === this.generation) this.endAudition();
      return finished;
    }
    this.auditionTimer = setTimeout(() => { if (gen === this.generation) this.stopAudition(); }, Math.max(0, ((session.K + until) / sr - session.now()) * 1000) + 50);
    return finished;
  }
  stopAudition(): void {
    if (!this.auditioning) return;
    this.generation++;
    this.stopNodes();
    this.endAudition();
    this.onTick();
  }
  private endAudition() {
    if (this.auditionTimer) { clearTimeout(this.auditionTimer); this.auditionTimer = null; }
    this.auditioning = false;
    const done = this.auditionDone;
    this.auditionDone = null;
    done?.();
  }
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
  /** Measurement only (ADR-0020 U4): the frame and how late (seconds) it was painted, for the last playback, so lateness at chosen frames can be read. */
  private lateFrames: [number, number][] = [];
  private requested = 0;
  private now: () => number = () => performance.now() / 1000;

  constructor(private canvas: HTMLCanvasElement, private pool: MediaPool, private onTick: () => void, private onError: (e: unknown) => void, private opts: PlayerOptions = {}) {
    // Measurement only: with the audio tap on (tests), the first player of the page is reachable for the preview proofs
    // (the angle viewer's draft-only player is never the one).
    const g = globalThis as { __pfAudioTap?: unknown; __pfPlayer?: Player };
    if (g.__pfAudioTap && !g.__pfPlayer && !opts.draftOnly) g.__pfPlayer = this;
  }

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
  /**
   * ADR-0020: replace the drawn document WITHOUT stopping playback when the sound plan is unchanged (canonical audioPlan clips,
   * totalSamples and loudness equal: true for a switch_angles projection in master-sound mode, where only picture clips change);
   * otherwise exactly setDoc (playback restarts from the same frame). Returns true when no restart happened.
   */
  setPictureDoc(doc: ProjectDocument): boolean {
    const old = this.doc;
    if (this.starting) { this.setDoc(doc); return false; } // play() is still waiting for the audio device: it planned its sound from the old document, so it starts again (setDoc)
    if (!old || this.opts.draftOnly) { this.doc = doc; this.painted = -1; this.request(this.frame); return true; }
    const key = (d: ProjectDocument) => { const p = audioPlan(d, undefined, { bypassFx: this.bypassAudioFx }); return canonical({ clips: p.clips, totalSamples: p.totalSamples, loudness: p.loudness }); };
    if (key(old) !== key(doc)) { this.setDoc(doc); return false; }
    this.doc = doc;
    this.frame = Math.min(this.frame, Math.max(0, this.frameCount - 1));
    this.request(this.frame);
    return true;
  }
  /** Playing, or asked to play and waiting for the audio device (a pause-and-resume inside setDoc passes through neither). */
  get active(): boolean { return this.playing || this.starting; }
  /** Draw `frame` of the current document now (coalesced like request()); no transport, no sound. */
  follow(frame: number): void {
    if (!this.doc) return;
    this.frame = Math.max(0, Math.min(frame, Math.max(0, this.frameCount - 1)));
    this.request(this.frame);
  }
  seek(frame: number) {
    this.stopAudition();
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
        const draftMax = this.opts.draftOnly?.maxHeight;
        const scale = draftMax ? Math.min(1, draftMax / height) : this.playing ? Math.min(1, 960 / height) : 1;
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        if (!this.shown && (this.canvas.width !== w || this.canvas.height !== h)) { this.canvas.width = w; this.canvas.height = h; } // the layout gets the right shape at once
        const back = (this.back ??= document.createElement('canvas'));
        if (back.width !== w || back.height !== h) { back.width = w; back.height = h; }
        // SAFETY (ADR-0009 decision 2): the guard decides on this frame's light relative to the light ON SCREEN before the draw,
        // copies a rise only a third of a second after the last rise reached the screen (timed from the copy, not from the
        // decision: the draw takes as long as it takes), and records what was painted (an effect that could not run drew no light).
        const drawn = await this.flashGuard.paint(evaluate(doc, T.frameTime(frame, frameRate)), {
          now: realTime, // real time, never the audio clock (it can stand still)
          draw: (g) => drawGraph(back.getContext('2d', { alpha: false })!, { ...g, width: w, height: h }, draftMax || scale !== 1 ? this.pool.draftFrames : this.pool.frames),
          copy: () => {
            // the finished frame replaces the one on screen at once (resizing the visible canvas clears it, so only now)
            if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
            this.canvas.getContext('2d', { alpha: false })!.drawImage(back, 0, 0);
            this.shown = true;
          },
          sleep: (s) => sleep(Math.ceil(s * 1000)),
          ...(typeof requestAnimationFrame === 'function' ? { nextFrame: (run: () => void) => { requestAnimationFrame(run); } } : {}),
        });
        /** GPU effects of the frame on screen that could not run in this browser (shown without them; the editor says so). */
        this.unavailableEffects = drawn.unavailableEffects;
        this.unavailableReasons = drawn.unavailableReasons ?? {};
        this.retryLater(doc, frame);
        this.painted = frame;
        if (this.playing) {
          const { num, den } = frameRate;
          const lateBy = this.now() - (this.origin.clock + ((frame - this.origin.frame) * den) / num);
          this.late.push(lateBy);
          this.lateFrames.push([frame, lateBy]);
          if (this.lateFrames.length > 3000) this.lateFrames.shift();
          if (this.late.length > 3000) this.late.shift();
        }
        this.canvas.dataset.frame = String(frame);
        this.canvas.dataset.flashesHeld = String(this.flashGuard.leftOut); // frames on which the safety guard held a strobe flash back
        this.canvas.dataset.quality = draftMax || scale !== 1 ? 'draft' : 'full';
        this.canvas.dataset.source = draftMax || scale !== 1 ? 'proxy-or-original' : 'original';
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
    if (Object.values(this.unavailableReasons).every(isDecodeBudgetReason)) return; // over the decoder budget: waiting changes nothing (an edit or a seek redraws anyway)
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

  /** The audio device at `rate` (a context at another rate is replaced while nothing plays on it); true when it runs. */
  private async ensureAudio(rate: number): Promise<boolean> {
    if (this.actx && this.actx.sampleRate !== rate && this.nodes.length === 0) { void this.actx.close(); this.actx = null; this.tapLoaded = false; }
    this.actx ??= new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
    await Promise.race([this.actx.resume(), new Promise((r) => setTimeout(r, 300))]);
    const ok = this.actx.state === 'running';
    if (ok && (globalThis as any).__pfAudioTap && !this.tapLoaded) {
      // AudioWorklet tap: sample-accurate (currentFrame), unlike ScriptProcessor whose callbacks lag by a block.
      await this.actx.audioWorklet.addModule('/pf-onset-tap.js'); // static file: see apps/web/public (no blob: scripts, so the content security policy can stay strict)
      this.tapLoaded = true;
    }
    return ok;
  }

  async play() {
    if (!this.doc || this.playing || this.frameCount === 0 || this.opts.draftOnly) return; // the angle viewer never plays sound
    this.stopAudition();
    const doc = this.doc;
    const rate = doc.settings.frameRate;
    this.starting = true;
    if (this.frame >= this.frameCount - 1) this.frame = 0;
    const startFrame = this.frame;
    const t0 = T.toSeconds(T.frameTime(startFrame, rate));
    const audioOk = await this.ensureAudio(doc.settings.sampleRate);
    if (this.doc !== doc || !this.starting) return; // the project changed while waiting (setDoc has already started playback again with the new one), or playback was stopped
    const plan = audioPlan(doc, undefined, { bypassFx: this.bypassAudioFx });
    this.starting = false;
    this.playing = true;
    const gen = ++this.generation;
    this.clock = audioOk ? 'audio' : 'monotonic';
    const now = () => (audioOk ? this.actx!.currentTime : performance.now() / 1000);
    this.now = now;
    this.late = [];
    this.lateFrames = [];
    this.requested = 0;
    if (audioOk) {
      const session = await this.startSound(plan.clips, plan.sampleRate, t0, T.nearestSampleIndex(T.frameTime(startFrame, rate), plan.sampleRate), gen);
      if (!session || gen !== this.generation) return;
      this.origin = { clock: session.originClock, frame: startFrame };
    } else {
      this.scheduledAheadMax = 0;
      this.origin = { clock: now(), frame: startFrame };
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
   * Start the sound of `clips` from timeline second `t0` (= sample t0Sample) on the running audio device: voices sounding at
   * t0 are rendered ahead first (at most FX_PRIME_MAX_MS), then the origin is set on the sample grid and every clip's pump
   * schedules against it. Returns null if the session was abandoned meanwhile.
   */
  private async startSound(clips: readonly PlannedAudioClip[], sr: number, t0: number, t0Sample: number, gen: number, until?: number): Promise<SoundSession | null> {
    const ctx = this.actx!;
    const now = () => ctx.currentTime;
    let markReady!: () => void;
    const s: SoundSession = { gen, sr, t0, t0Sample, now, ready: new Promise<void>((r) => { markReady = r; }), originClock: 0, K: 0, master: null, ...(until !== undefined ? { until } : {}) };
    this.scheduledAheadMax = 0;
    this.fxPrimeMs = 0; this.fxPrimeTimedOut = false; this.fxLateStarts = 0; this.fxLateSkips = 0; this.fxVoices = 0;
    this.unavailableAudioFx = {};
    const rateOk = ctx.sampleRate === sr;
    const dry: PlannedAudioClip[] = [];
    const primes: Promise<void>[] = [];
    for (const c of clips) {
      const end = c.voice ? soundEnd(c) : c.at + c.length;
      if (end <= t0Sample || (until !== undefined && c.at >= until)) continue;
      if (!c.voice) { dry.push(c); continue; }
      const failed = this.fxFailed.get(fxKey(c));
      if (!rateOk || failed) {
        this.unavailableAudioFx[c.clipId] = failed ?? `the audio device runs at ${ctx.sampleRate} Hz, not at the project's ${sr} Hz: this clip plays without its sound effects`;
        if (c.at + c.length > t0Sample) dry.push({ ...c, voice: undefined });
        continue;
      }
      this.fxVoices++;
      const v = this.pumpVoice(c, s);
      if (c.at <= t0Sample) primes.push(v.primed);
    }
    if (Object.keys(this.unavailableAudioFx).length) this.onTick();
    if (primes.length) {
      const started = performance.now();
      let primedAll = false;
      // measured to the end, not to the cap: a voice that is not ready by then still marks itself primed when it is (pumpVoice)
      const all = Promise.all(primes).then(() => { primedAll = true; if (gen === this.generation) this.fxPrimeMs = Math.round(performance.now() - started); });
      await Promise.race([all, sleep(Player.FX_PRIME_MAX_MS)]);
      if (!primedAll && gen === this.generation) { this.fxPrimeTimedOut = true; this.fxPrimeMs = Math.round(performance.now() - started); }
    }
    if (gen !== this.generation) { markReady(); return null; }
    const lead = 0.12;
    // The origin sits on the sample grid of the device, so every buffer starts exactly on a sample (no sub-sample interpolation).
    const originFrame = Math.ceil((now() + lead) * sr);
    s.K = originFrame - t0Sample;
    s.originClock = originFrame / sr - (t0Sample / sr - t0); // the picture's clock: timeline second t0 (t0Sample/sr differs by under half a sample)
    s.master = this.openOutput(s.originClock, t0);
    markReady();
    for (const c of dry) void this.pumpDry(c, s).catch((e) => { if (gen === this.generation) this.onError(e); });
    return s;
  }

  /** The master mix of one session, with the level meter and (tests) the measurement tap. */
  private openOutput(originClock: number, t0: number): GainNode {
    const ctx = this.actx!;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.onsets = [];
    this.levels = [];
    // Level meter tap (observation only; the analyser has no output so it does not change what is heard).
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    master.connect(an);
    this.analyser = an;
    this.meterBuf = new Float32Array(an.fftSize);
    if ((globalThis as any).__pfAudioTap && this.tapLoaded) {
      // Optional measurement tap (tests set window.__pfAudioTap): records when signal onsets actually reach the output stage,
      // in timeline seconds on the same clock that drives the picture.
      const tap = new AudioWorkletNode(ctx, 'pf-onset-tap', { numberOfOutputs: 0 });
      tap.port.onmessage = (e) => {
        if (typeof e.data === 'number') this.onsets.push(+(e.data - originClock + t0).toFixed(5));
        // t to the microsecond: a window starts on a device sample, and a reader must be able to find that sample again (at 0.1 ms it
        // could be 2 samples off whenever the tap's first block does not fall on the 0.1 ms grid, and a peak at the edge changed windows)
        else this.levels.push({ t: +((e.data as { t: number }).t - originClock + t0).toFixed(6), peak: +(e.data as { peak: number }).peak.toFixed(4) });
      };
      master.connect(tap);
      this.tap = tap;
    }
    return master;
  }
  private track(node: AudioBufferSourceNode) {
    this.nodes.push(node);
    node.onended = () => { const i = this.nodes.indexOf(node); if (i >= 0) this.nodes.splice(i, 1); node.disconnect(); };
  }

  /**
   * One clip through its sound effects: decode its playing-order source in windows (forwards, or backwards for a reversed
   * clip), push it through the shared voice, and schedule the finished samples on the sample grid: timeline sample at + n plays
   * at context frame K + at + n. `primed` resolves once a little output is ready (or the voice gave up). A voice that fails
   * before any of its sound was scheduled plays its clip dry instead; the reason goes to unavailableAudioFx either way.
   */
  private pumpVoice(c: PlannedAudioClip, s: SoundSession): { primed: Promise<void>; done: Promise<void> } {
    let markPrimed!: () => void;
    const primed = new Promise<void>((r) => { markPrimed = r; });
    const live = () => s.gen === this.generation;
    const done = (async () => {
      const sr = s.sr;
      let opened: Awaited<ReturnType<MediaPool['openAudio']>> = null;
      let scheduledAny = false;
      try {
        if (c.at > s.t0Sample) {
          // A clip that starts later: begin rendering only when its sound (after its warm-up) is about to be needed.
          await s.ready;
          if (!live()) return;
          const warmSeconds = (c.voice!.warmWindow + c.voice!.warmRing) / sr;
          const wait = (s.K + c.at) / sr - s.now() - (Player.AUDIO_LOOKAHEAD + 1 + warmSeconds / 20);
          if (wait > 0) await sleep(wait * 1000);
          if (!live()) return;
        }
        opened = await this.pool.openAudio(c.assetId).catch(() => null);
        if (!opened) throw new FxUnavailable('the sound of this clip cannot be decoded in this browser');
        if (!live()) return;
        const decRate = opened.sampleRate, readerZero = opened.origin;
        const from = Math.max(0, s.t0Sample - c.at);
        const to = Math.min(soundEnd(c), s.until ?? Infinity) - c.at;
        const voice = openClipVoice(c, sr, decRate, from, to);
        const inp = voice.input;
        // output bookkeeping: frames produced but not yet scheduled, and the clip-local frame of the next one to schedule
        const pending: Float32Array[] = [];
        let pendingFrames = 0, outPos = from, produced = from, first = true;
        const PRIME = Math.round(0.25 * sr), CHUNK = Math.round(0.1 * sr);
        let slice = performance.now();
        const schedule = () => {
          if (!pendingFrames || !s.master) return;
          const n = pendingFrames, data = new Float32Array(n * 2);
          let o = 0;
          for (const p of pending) { data.set(p, o); o += p.length; }
          pending.length = 0; pendingFrames = 0;
          const when = (s.K + c.at + outPos) / sr;
          outPos += n;
          const late = Math.max(0, s.now() - when);
          if (late > 0) { this.fxLateSkips++; if (first) this.fxLateStarts++; }
          first = false;
          if (n / sr - late <= 0) return;
          const buf = this.actx!.createBuffer(2, n, sr);
          const l = buf.getChannelData(0), r = buf.getChannelData(1);
          for (let i = 0; i < n; i++) { l[i] = data[i * 2]!; r[i] = data[i * 2 + 1]!; }
          const node = this.actx!.createBufferSource();
          node.buffer = buf;
          node.connect(s.master);
          node.start(Math.max(when, s.now()), late);
          this.track(node);
          scheduledAny = true;
          this.scheduledAheadMax = Math.max(this.scheduledAheadMax, when - s.now());
        };
        const take = async (out: Float32Array, last = false) => {
          if (out.length) { pending.push(out.slice()); pendingFrames += out.length >> 1; produced += out.length >> 1; } // copied: the voice may reuse its output buffer
          if (produced - from >= PRIME || last) {
            markPrimed(); // also when the clock did not wait for it: priming is measured to the end (startSound)
            if (!s.master) {
              // enough is rendered ahead of the start: wait for the clock to be set
              await s.ready;
              if (!live()) return;
            }
          }
          if (s.master) {
            if (pendingFrames >= CHUNK || last) schedule();
            const ahead = (s.K + c.at + produced) / sr - s.now();
            if (ahead > Player.AUDIO_LOOKAHEAD) { await sleep((ahead - Player.AUDIO_LOOKAHEAD) * 1000); slice = performance.now(); return; }
          }
          if (performance.now() - slice > 12) { await yieldToPage(); slice = performance.now(); } // effect work in slices: the page stays responsive
        };
        const checkRate = (b: AudioBuffer) => { if (b.sampleRate !== decRate) throw new FxUnavailable(`the decoder gives ${b.sampleRate} Hz where the file states ${decRate} Hz: this clip plays without its sound effects`); };
        const SILENCE = Math.max(1024, Math.round(decRate / 4));
        const silence = async (frames: number) => { for (let left = frames; left > 0 && live(); left -= SILENCE) await take(voice.push(new Float32Array(Math.min(left, SILENCE) * 2))); };
        let next = inp.first;
        if (!inp.reverse) {
          // forwards: P[k] = native[origin + k]; native indices below 0 lie before the file and are silence
          const before = Math.min(inp.last, -inp.origin);
          if (next < before) { await silence(before - next); next = before; }
          if (next < inp.last && live()) {
            for await (const raw of opened.sink.buffers((inp.origin + next) / decRate + readerZero, (inp.origin + inp.last) / decRate + readerZero)) {
              if (!live()) break;
              checkRate(raw.buffer);
              const ns = Math.round((raw.timestamp - readerZero) * decRate), k0 = ns - inp.origin;
              if (k0 > next) { const gap = Math.min(k0, inp.last) - next; await silence(gap); next += gap; } // a gap in the decoded stream is silence
              const a = Math.max(next, k0), e = Math.min(k0 + raw.buffer.length, inp.last);
              if (e > a) {
                const dst = new Float32Array((e - a) * 2);
                fillPlayingOrder(dst, a, inp, { start: ns, data: interleave(raw.buffer) });
                await take(voice.push(dst));
                next = e;
              }
              if (next >= inp.last || !live()) break;
            }
          }
        } else {
          // backwards: P[k] = native[origin − 1 − k]; the decoder only runs forwards, so windows of P are decoded and copied backwards
          const WINDOW = Math.round(decRate);
          while (next < inp.last && live()) {
            const k1 = Math.min(inp.last, next + WINDOW), hi = inp.origin - next, lo = inp.origin - k1;
            const dst = new Float32Array((k1 - next) * 2);
            if (hi > 0) for await (const raw of opened.sink.buffers(Math.max(0, lo) / decRate + readerZero, hi / decRate + readerZero)) {
              if (!live()) break;
              checkRate(raw.buffer);
              fillPlayingOrder(dst, next, inp, { start: Math.round((raw.timestamp - readerZero) * decRate), data: interleave(raw.buffer) });
            }
            if (!live()) break;
            await take(voice.push(dst));
            next = k1;
          }
        }
        if (live()) await take(voice.finish(), true);
      } catch (e) {
        if (!live()) return;
        const why = e instanceof FxUnavailable ? e.message : `the sound effects could not run in this browser (${String((e as Error)?.message ?? e).slice(0, 160)}): this clip plays without them`;
        this.fxFailed.set(fxKey(c), why);
        this.unavailableAudioFx = { ...this.unavailableAudioFx, [c.clipId]: why };
        this.onTick();
        opened?.dispose();
        opened = null;
        markPrimed();
        if (!scheduledAny) {
          await s.ready;
          if (live() && c.at + c.length > s.t0Sample) await this.pumpDry({ ...c, voice: undefined }, s);
        }
      } finally {
        markPrimed();
        opened?.dispose();
      }
    })();
    done.catch((e) => { if (live()) this.onError(e); });
    return { primed, done };
  }

  /** One clip without effects: decode forward (or backwards in windows) from the playhead and schedule buffers through the WebAudio clip chain. */
  private async pumpDry(c: PlannedAudioClip, s: SoundSession): Promise<void> {
    const sr = s.sr, gen = s.gen, t0 = s.t0, originClock = s.originClock, now = s.now, master = s.master!;
    // Clip timing comes from the shared audio plan (integer samples), the same numbers export uses.
    const start = c.at / sr;
    const end = (s.until !== undefined ? Math.min(c.at + c.length, s.until) : c.at + c.length) / sr;
    if (end <= t0) return;
    const sourceIn = c.source / sr;
    // One pump per audible clip: decode forward from the playhead and schedule buffers a bounded time ahead.
    const opened = await this.pool.openAudio(c.assetId).catch(() => null);
    if (!opened) return;
    if (gen !== this.generation) return opened.dispose();
    try {
      const fromLocal = Math.max(0, Math.round((t0 - start) * sr));
      const gain = plannedClipInput(this.actx!, c, sr, master, originClock + (start - t0), fromLocal);
      // Source seconds advance `speed` times as fast as the playback clock (varispeed: pitch follows speed, as in export).
      const speed = c.speed;
      // A continuous speed ramp: after x seconds of the clip, speed·x + (speedEnd − speed)·x²/(2·length) seconds of source have played.
      const ramp = c.speedEnd !== undefined;
      const rs = rampSpanOf(c, 1 / sr); // the ramp in seconds
      const srcAfter = (x: number) => (ramp ? rampSourceFrames(rs.v0, rs.v1, rs.total, rs.offset + x, rs.curve) - rampSourceFrames(rs.v0, rs.v1, rs.total, rs.offset, rs.curve) : x * speed);
      const srcFrom = sourceIn + srcAfter(Math.max(0, t0 - start));
      const srcTo = sourceIn + srcAfter(end - start) + (ramp ? 4 / sr : 0); // the resampler reads a few frames past the last position
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
          const S1 = sourceIn + (c.length / sr) * speed;
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
        const emit = (out: Float32Array, rate: number) => {
          const room = Math.max(0, Math.round((end - playFrom) * rate) - outPos); // never past the end of the clip
          const frames = Math.min(out.length >> 1, room);
          if (frames <= 0) return;
          const when = startAt + outPos / rate;
          outPos += frames;
          const late = Math.max(0, now() - when);
          if (frames / rate - late <= 0) return;
          const buf = this.actx!.createBuffer(2, frames, rate);
          const l = buf.getChannelData(0), r = buf.getChannelData(1);
          for (let i = 0; i < frames; i++) { l[i] = out[i * 2]!; r[i] = out[i * 2 + 1]!; }
          const node = this.actx!.createBufferSource();
          node.buffer = buf;
          node.connect(gain);
          node.start(Math.max(when, now()), late);
          this.track(node);
          this.scheduledAheadMax = Math.max(this.scheduledAheadMax, when - now());
        };
        let rateOfSource = 0;
        for await (const ch of chunks()) {
          if (gen !== this.generation) break;
          stretcher ??= ramp ? new RampResampler(rampSpanOf(c, ch.sr / sr), Math.round((playFrom - start) * ch.sr)) : new PitchStretcher(speed, ch.sr);
          rateOfSource = ch.sr;
          emit(stretcher.push(ch.data), ch.sr);
          const ahead = startAt + outPos / ch.sr - now();
          if (ahead > Player.AUDIO_LOOKAHEAD) await sleep((ahead - Player.AUDIO_LOOKAHEAD) * 1000);
        }
        if (stretcher && gen === this.generation) emit(stretcher.finish(), rateOfSource);
        return;
      }
      if (c.reverse) {
        // Backwards: clip-local time x plays source S1 − x·speed. The decoder only runs forwards, so the remaining stretch is
        // taken in windows from its end towards its start; each window is decoded, then its buffers are scheduled last-first, reversed.
        const S1 = sourceIn + (c.length / sr) * speed;
        let hi = S1 - Math.max(0, t0 - start) * speed;
        const stopAt = sourceIn + Math.max(0, (c.length / sr) - (end - start)) * speed; // an audition may end before the clip does
        const WINDOW = 2 * speed; // source seconds per window: about two seconds of playback
        while (hi > Math.max(sourceIn, stopAt) + 1e-6 && gen === this.generation) {
          const lo = Math.max(sourceIn, stopAt, hi - WINDOW);
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
            this.track(node);
            this.scheduledAheadMax = Math.max(this.scheduledAheadMax, when - now());
          }
          hi = lo;
          const ahead = originClock + (start + (S1 - hi) / speed - t0) - now(); // how far ahead of the clock the next window starts
          if (ahead > Player.AUDIO_LOOKAHEAD) await sleep((ahead - Player.AUDIO_LOOKAHEAD) * 1000);
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
        this.track(node);
        const ahead = when - now();
        this.scheduledAheadMax = Math.max(this.scheduledAheadMax, ahead);
        if (ahead > Player.AUDIO_LOOKAHEAD) await sleep((ahead - Player.AUDIO_LOOKAHEAD) * 1000);
      }
    } finally {
      // The pump owns its input: it is released only after the iterator has stopped, never mid-read.
      opened.dispose();
    }
  }
  /**
   * Move through the timeline at `rate` times real time, backwards when negative. Silent (sound is only played at normal speed)
   * and timed by the monotonic clock; frames that cannot be drawn in time are skipped, never queued. Stops at either end.
   * `rate` 1 is ordinary playback with sound; 0 pauses.
   */
  shuttle(rate: number) {
    if (!this.doc || this.frameCount === 0) return;
    this.stopAudition();
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
  private stopNodes() {
    if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
    if (this.tap) { this.tap.port.onmessage = null; this.tap.disconnect(); this.tap = null; }
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }
    this.nodes = [];
  }
  pause() {
    this.playing = false;
    this.starting = false;
    this.shuttleRate = 0;
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.stopNodes();
    this.endAudition();
    if (this.doc) this.request(this.frame); // repaint the paused frame at full quality
    this.onTick();
  }
  /** Current sample peak of the master mix in dBFS (-Infinity for silence); null when not playing or no audio output. */
  peakDb(): number | null {
    if ((!this.playing && !this.auditioning) || !this.analyser || !this.meterBuf) return null;
    this.analyser.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) { const a = Math.abs(this.meterBuf[i]!); if (a > p) p = a; }
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  }
  /** Measured, not estimated. `clock` says which timebase the numbers refer to. */
  syncStats() {
    const v = [...this.late].sort((a, b) => a - b);
    const q = (p: number) => (v.length ? +(v[Math.min(v.length - 1, Math.floor(v.length * p))]! * 1000).toFixed(2) : null);
    return { clock: this.clock, audioContextState: this.actx?.state ?? 'none', audioSampleRate: this.actx?.sampleRate ?? null, outputLatencyMs: this.actx ? +(((this.actx.outputLatency || 0) + (this.actx.baseLatency || 0)) * 1000).toFixed(2) : null, audioScheduledAheadMaxMs: +(this.scheduledAheadMax * 1000).toFixed(1), audioLookaheadMs: Player.AUDIO_LOOKAHEAD * 1000, liveAudioNodes: this.nodes.length, loops: this.loops, audioOnsetsTimelineSeconds: [...this.onsets], audioLevels: [...this.levels], framesRequested: this.requested, framesPainted: v.length, paintLatenessByFrameMs: this.lateFrames.map(([f, v]) => [f, +(v * 1000).toFixed(2)] as [number, number]), paintLatenessMs: { median: q(0.5), p95: q(0.95), max: q(1) }, fxVoices: this.fxVoices, fxPrimeMs: this.fxPrimeMs, fxPrimeTimedOut: this.fxPrimeTimedOut, fxLateStarts: this.fxLateStarts, fxLateSkips: this.fxLateSkips, bypassAudioFx: this.bypassAudioFx, auditioning: this.auditioning, unavailableAudioFx: { ...this.unavailableAudioFx } };
  }
  dispose() {
    this.pause();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    void this.actx?.close();
  }
  // ---- perform mode (ADR-0025): the two methods of perform/contract.ts PerformPlayerPort (W3; nothing else of the player changed) ----
  private monitorCache = new Map<string, AudioBuffer[] | Promise<void>>();
  /**
   * Timeline seconds HEARD at a `performance` time (a key's or pointer's event.timeStamp): playback's own clock, the audio clock
   * when sound plays (AudioContext.getOutputTimestamp: the context time being output at a performance time), else the monotonic
   * one. null when nothing plays at normal speed (stopped, paused, shuttling). The tap calibration is subtracted by the caller.
   */
  timelineSecondsAt(perfMs: number): number | null {
    if (!this.playing || this.shuttleRate || !this.doc) return null;
    const t0 = T.toSeconds(T.frameTime(this.origin.frame, this.doc.settings.frameRate));
    let clock = perfMs / 1000;
    const ctx = this.actx;
    if (this.clock === 'audio' && ctx) {
      const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
      if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) clock = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      else clock = ctx.currentTime - (ctx.outputLatency || 0) + (perfMs - performance.now()) / 1000; // no output timestamp in this browser: the context's clock less its stated output latency
    }
    return t0 + (clock - this.origin.clock);
  }
  /**
   * Play a library sound once, now, for monitoring during a take: straight to the output, never in the mix and never exported.
   * The first call for an asset decodes it (gain 0 decodes without a sound: the view warms its sound pads that way when a take
   * is armed); a tap that arrives while it is still decoding is silent rather than late.
   */
  monitorSound(assetId: string, gain: number): void {
    const ctx = this.actx;
    if (!ctx || ctx.state !== 'running') return;
    const have = this.monitorCache.get(assetId);
    if (Array.isArray(have)) {
      if (gain <= 0) return;
      let when = ctx.currentTime;
      for (const b of have) {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = b; g.gain.value = gain;
        src.connect(g); g.connect(ctx.destination);
        src.start(when);
        when += b.duration;
      }
      return;
    }
    if (have) return;
    const bufs: AudioBuffer[] = [];
    const pending = (async () => {
      const opened = await this.pool.openAudio(assetId).catch(() => null);
      if (!opened) { this.monitorCache.delete(assetId); return; }
      try {
        for await (const raw of opened.sink.buffers(opened.origin, opened.origin + 10)) bufs.push(raw.buffer);
        this.monitorCache.set(assetId, bufs);
      } catch { this.monitorCache.delete(assetId); } finally { opened.dispose(); }
    })();
    this.monitorCache.set(assetId, pending);
  }
  // ---- end of the perform block ----
}
