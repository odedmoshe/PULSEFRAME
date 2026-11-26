/**
 * Audio plan (SPEC §10): the one description of what every mixer must produce.
 * Pure. Server export, browser export and preview all consume this plan, so gain, pan, fades and ducking
 * mean the same thing everywhere. Positions are integer samples rounded from absolute times (never accumulated).
 *
 * gain(sample) of a planned clip = gain × fade(sample) × duck(sample), where fade and duck are piecewise-linear
 * envelopes in clip-local samples. Mixers must evaluate them per sample (or with exact linear ramps).
 */
import * as T from '@pulseframe/time';
import { findAudioEffect, isRamped, sortAudioFx, sourceEnd, speedEndValue, speedOf, speedValue, timelineAt, transcriptFor, volumePoints, type AudioFxParams, type MediaClip, type ProjectDocument, type Sequence, type Track } from '@pulseframe/core';
import type { PlannedFx } from './audiofx/kernel.ts';
import { chainReach, kernelFor } from './audiofx/registry.ts';
import './audiofx/kernels/index.ts'; // every kernel of this build is registered before a plan is made
export type { PlannedFx } from './audiofx/kernel.ts';

export interface EnvPoint { s: number; g: number }
export interface PlannedAudioClip {
  clipId: string; trackId: string; assetId: string;
  /** Timeline sample where the clip starts, its length, and the source sample it starts reading from. */
  at: number; length: number; source: number;
  /** Source samples consumed per output sample (1 = normal). Mixers resample by this ratio, so pitch follows speed. */
  speed: number;
  /** A continuous speed ramp: the rate changes evenly from `speed` at the first sample of the clip to this at its last. Mixers read the stretch at normal rate and resample it with the shared ramp resampler (stretch.ts). */
  speedEnd?: number;
  /** For a ramped clip that is a part of its ramp: where in the ramp the clip starts and how long the whole ramp is, in samples; and the ramp's curve. Absent = the clip is the whole ramp, changing evenly. */
  rampOffset?: number; rampTotal?: number; rampCurve?: 'smooth';
  /** With a speed other than 1: stretch the sound keeping its pitch (stretch.ts) instead of resampling it. Mixers read the stretch at normal rate and run it through the shared stretcher from the start of the clip. */
  keepPitch?: true;
  /** The clip plays its stretch of source, [source, source + length × speed), backwards. Mixers read that stretch and reverse it. */
  reverse?: true;
  /** Clip gain × track gain (linear). */
  gain: number;
  /** -1..1 balance. Left gain = min(1, 1 - pan), right gain = min(1, 1 + pan). */
  pan: number;
  /** Clip-local envelopes; always start at s=0 and end at s=length. */
  fade: EnvPoint[];
  duck: EnvPoint[];
  /** Volume automation of the clip, same shape as the other envelopes. Absent = no automation. */
  vol?: EnvPoint[];
  /** The clip's sound effects (ADR-0010). With a voice, `duck` spans [0, length + tail]. */
  voice?: PlannedVoice;
}
export interface PlannedVoice {
  /** Enabled, non-identity effects in processing order (stage, then registry order). Never empty. */
  chain: PlannedFx[];
  /** Exact source mapping (RationalTimeJson), so every host's time map reads the same positions. */
  sourceIn: { value: string; timescale: number };
  sourceEnd: { value: string; timescale: number };
  speed: { num: number; den: number };
  reverse: boolean;
  /** asset.audio.sampleRate (the server decodes at this rate; browsers open the voice with the decoder's own rate). */
  sourceRate: number;
  /** Samples at plan rate (chainReach). warmWindow includes the look-ahead of the window stages. */
  warmWindow: number; warmRing: number;
  /** Σ look-ahead of the window stages, in samples at plan rate (ADR-0013). The voice reads that much more source after every block
   *  and past the clip end, and compensates it: net latency 0. */
  aheadWindow: number;
  /** Output after `length`, already cut at the programme end. */
  tail: number;
  /** Present when the tail was cut: linear fade to 0 over [cutFrom, length + tail). */
  cutFrom?: number;
}
export interface AudioPlan { sampleRate: number; totalSamples: number; clips: PlannedAudioClip[]; loudness: { target: number; truePeak: number } | null;
  /** Clips whose ring-out would pass the programme end: `seconds` of ring-out removed there (the kept part fades out over at most 10 ms). */
  cutTails: { clipId: string; seconds: number }[];
  /** Effects of the document this build has no kernel for (left out of the plan; export blocks on them). */
  missingFx: { clipId: string; type: string; version: number }[];
  /** The master limiter (wave 7, track send; settings.limiter): present only when the project has one, so every other plan is unchanged. */
  limiter?: { ceiling: number } }
export interface AudioPlanOptions { /** output rate (browser export); default doc.settings.sampleRate */ sampleRate?: number; /** session A/B: plan without effects */ bypassFx?: boolean }


/** Value of a piecewise-linear envelope at sample `s` (clamped to the end values outside its range). */
export function envAt(env: EnvPoint[], s: number): number {
  if (s <= env[0]!.s) return env[0]!.g;
  for (let i = 1; i < env.length; i++) {
    const b = env[i]!;
    if (s <= b.s) { const a = env[i - 1]!; return b.s === a.s ? b.g : a.g + ((b.g - a.g) * (s - a.s)) / (b.s - a.s); }
  }
  return env[env.length - 1]!.g;
}
export const panGains = (pan: number): [number, number] => [Math.min(1, 1 - pan), Math.min(1, 1 + pan)];
const FLAT: EnvPoint[] = [{ s: 0, g: 1 }];
const sliceEnv = (global: EnvPoint[], from: number, length: number): EnvPoint[] => {
  if (global.length === 1) return [{ s: 0, g: global[0]!.g }, { s: length, g: global[0]!.g }];
  const out: EnvPoint[] = [{ s: 0, g: envAt(global, from) }];
  for (const p of global) if (p.s > from && p.s < from + length) out.push({ s: p.s - from, g: p.g });
  out.push({ s: length, g: envAt(global, from + length) });
  return out;
};

/** Timeline sample ranges (at `sr`, default the project rate) in which the source tracks carry speech: transcript phrases where a transcript exists, else whole clips. Sound-effect tails never count as speech. */
export function speechRanges(doc: ProjectDocument, seq: Sequence, sourceTrackIds: string[], sr = doc.settings.sampleRate): [number, number][] {
  const out: [number, number][] = [];
  for (const tr of seq.tracks) {
    if (!sourceTrackIds.includes(tr.id) || tr.kind !== 'audio' || tr.muted) continue;
    for (const c of tr.clips) {
      if (c.type !== 'media' || c.gain <= 0) continue;
      const end = T.add(c.start, c.duration);
      const spoken = transcriptFor(doc, c.assetId); // a derived copy that keeps its source's timing speaks the source's transcript (ADR-0017)
      if (!spoken || c.reverse) { out.push([T.nearestSampleIndex(c.start, sr), T.nearestSampleIndex(end, sr)]); continue; } // a reversed clip is treated as speech throughout: its phrases no longer sit where the transcript says
      const { transcript, offset } = spoken;
      const srcIn = T.add(c.sourceIn, offset), srcEnd = T.add(sourceEnd(c), offset);
      for (const seg of transcript.segments) {
        const a = T.max(seg.start, srcIn), b = T.min(T.add(seg.start, seg.duration), srcEnd);
        if (T.lt(a, b)) out.push([T.nearestSampleIndex(timelineAt(c, T.sub(a, offset)), sr), T.nearestSampleIndex(timelineAt(c, T.sub(b, offset)), sr)]);
      }
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/**
 * Ducking envelope on the timeline. The level reaches the ducked value exactly when speech starts (the attack ramp ends there)
 * and starts recovering exactly when speech ends. Speech ranges closer together than attack + release stay ducked in between.
 */
export function duckEnvelope(ranges: [number, number][], reductionDb: number, attack: number, release: number): EnvPoint[] {
  const low = 10 ** (-reductionDb / 20);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] - last[1] <= attack + release) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  if (merged.length === 0) return FLAT;
  const env: EnvPoint[] = [];
  for (const [a, b] of merged) env.push({ s: a - attack, g: 1 }, { s: a, g: low }, { s: b, g: low }, { s: b + release, g: 1 });
  return env;
}

const audible = (t: Track) => t.kind === 'audio' && !t.muted;

/**
 * The planned effects of a clip (ADR-0010): enabled, non-identity effects in processing order (stage, then registry order), with
 * the registry version and their noise seed. Effects this build cannot run (unknown type, no kernel, invalid settings) are
 * reported in `missing` and left out; export blocks on them, so nothing is ever dropped silently.
 */
function plannedChain(c: MediaClip, missing: AudioPlan['missingFx']): PlannedFx[] {
  const chain: PlannedFx[] = [];
  for (const fx of sortAudioFx(c.audioFx ?? [])) {
    if (!fx.enabled) continue;
    const def = findAudioEffect(fx.type);
    const parsed = def?.params.safeParse(fx.params);
    if (!def || !parsed?.success || !kernelFor(fx.type, def.version)) { missing.push({ clipId: c.id, type: fx.type, version: def?.version ?? 0 }); continue; }
    const params = parsed.data as AudioFxParams;
    if (def.isIdentity(params)) continue;
    chain.push({ id: fx.id, type: fx.type, version: def.version, stage: def.stage, params, seed: def.seeded ? fxSeed(fx.id, params) : 0 });
  }
  return chain;
}

/**
 * The plan of a sequence. `opts.sampleRate` places everything at another output rate (browser export); `opts.bypassFx` plans
 * without sound effects (the session A/B switch). A clip without effects is planned exactly as before effects existed.
 */
export function audioPlan(doc: ProjectDocument, sequenceId = doc.mainSequenceId, opts: AudioPlanOptions = {}): AudioPlan {
  const seq = doc.sequences[sequenceId]!;
  const sr = opts.sampleRate ?? doc.settings.sampleRate;
  const clips: PlannedAudioClip[] = [];
  const cutTails: AudioPlan['cutTails'] = [], missingFx: AudioPlan['missingFx'] = [];
  let total = 0;
  for (const tr of seq.tracks) for (const c of tr.clips) total = Math.max(total, T.nearestSampleIndex(T.add(c.start, c.duration), sr));
  for (const tr of seq.tracks) {
    if (!audible(tr)) continue;
    const trackGain = tr.audio?.gain ?? 1;
    const d = tr.audio?.duck;
    const ms = (v: number) => Math.round((v * sr) / 1000);
    const duckGlobal = d ? duckEnvelope(speechRanges(doc, seq, d.sourceTrackIds, sr), d.reductionDb, ms(d.attackMs), ms(d.releaseMs)) : FLAT;
    for (const c of tr.clips) {
      if (c.type !== 'media' || !doc.assets[c.assetId]?.audio) continue;
      const gain = c.gain * trackGain;
      if (gain <= 0) continue;
      const at = T.nearestSampleIndex(c.start, sr);
      const length = T.nearestSampleIndex(T.add(c.start, c.duration), sr) - at;
      if (length <= 0) continue;
      const fin = Math.min(length, c.fadeIn ? T.nearestSampleIndex(c.fadeIn, sr) : 0);
      const fout = Math.min(length - fin, c.fadeOut ? T.nearestSampleIndex(c.fadeOut, sr) : 0);
      const fade: EnvPoint[] = [];
      if (fin > 0) fade.push({ s: 0, g: 0 }, { s: fin, g: 1 }); else fade.push({ s: 0, g: 1 });
      if (fout > 0) fade.push({ s: length - fout, g: 1 }, { s: length, g: 0 }); else fade.push({ s: length, g: 1 });
      // smooth segments become short straight pieces here, so every mixer follows the same curve
      const vol = c.volume?.length ? sliceEnv(volumePoints(c.volume, (t) => T.nearestSampleIndex(t, sr)).map((p) => ({ s: Math.round(p.x), g: p.value })), 0, length) : undefined;
      const planned: PlannedAudioClip = { ...(vol ? { vol } : {}), ...(c.reverse ? { reverse: true as const } : {}), ...(isRamped(c) ? { speedEnd: speedEndValue(c), ...(c.rampWindow ? { rampOffset: T.nearestSampleIndex(c.rampWindow.offset, sr), rampTotal: T.nearestSampleIndex(c.rampWindow.total, sr) } : {}), ...(c.speedCurve ? { rampCurve: c.speedCurve } : {}) } : c.keepPitch && speedValue(c) !== 1 ? { keepPitch: true as const } : {}), clipId: c.id, trackId: tr.id, assetId: c.assetId, at, length, source: T.nearestSampleIndex(c.sourceIn, sr), speed: speedValue(c), gain, pan: tr.audio?.pan ?? 0, fade, duck: sliceEnv(duckGlobal, at, length) };
      const chain = opts.bypassFx || !c.audioFx?.length ? [] : plannedChain(c, missingFx);
      if (chain.length && (planned.keepPitch || planned.speedEnd !== undefined)) {
        // Wave-1 limit (validation code audio_fx_time_map): the stretcher and the ramp resampler have no seekable time map yet.
        // Such a document cannot be committed; if one is read anyway, its effects are reported as unavailable, never dropped silently.
        for (const fx of chain) missingFx.push({ clipId: c.id, type: fx.type, version: fx.version });
      } else if (chain.length) {
        const asset = doc.assets[c.assetId]!;
        const sp = speedOf(c);
        const reach = chainReach(chain, sr, sp.num / sp.den);
        // Tails ring on past the clip but never past the programme end: there they are cut with a fade of at most 10 ms.
        const tail = Math.min(reach.tail, total - at - length);
        const voice: PlannedVoice = {
          chain, sourceIn: T.normalize(c.sourceIn), sourceEnd: T.normalize(sourceEnd(c)), speed: { ...sp }, reverse: !!c.reverse,
          sourceRate: asset.audio!.sampleRate, warmWindow: reach.warmWindow, warmRing: reach.warmRing, aheadWindow: reach.aheadWindow, tail,
        };
        if (tail < reach.tail) {
          voice.cutFrom = Math.min(length + tail, Math.max(length, total - at - Math.round(0.01 * sr)));
          cutTails.push({ clipId: c.id, seconds: Number(((reach.tail - tail) / sr).toFixed(3)) });
        }
        planned.duck = sliceEnv(duckGlobal, at, length + tail); // a ducked track ducks the tail too
        planned.voice = voice;
      }
      clips.push(planned);
    }
  }
  return { sampleRate: sr, totalSamples: total, clips, loudness: doc.settings.loudness ?? null, cutTails, missingFx, ...(doc.settings.limiter ? { limiter: { ceiling: doc.settings.limiter.ceiling } } : {}) };
}
export const soundEnd = (c: PlannedAudioClip): number => c.at + c.length + (c.voice?.tail ?? 0);
/** FNV-1a 32-bit hash of the instance id, xor params.seed (integer): deterministic per document. */
export function fxSeed(instanceId: string, params: AudioFxParams): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < instanceId.length; i++) { h ^= instanceId.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h ^ ((typeof params.seed === 'number' ? params.seed : 0) | 0)) >>> 0;
}


/**
 * Reference mixer: add `pcm` (interleaved stereo float, the clip's samples starting at clip-local sample `clipOffset`)
 * into `out` (interleaved stereo float covering timeline samples [outStart, outStart + out.length/2)).
 * Used by the server export; the other mixers are tested against the same plan.
 */
export function mixClip(out: Float32Array, outStart: number, clip: PlannedAudioClip, pcm: Float32Array, clipOffset: number) {
  const [gl, gr] = panGains(clip.pan);
  const frames = pcm.length >> 1;
  const outFrames = out.length >> 1;
  let fi = 0, di = 0, vi = 0; // envelope segment cursors (samples only move forward)
  const vol = clip.vol;
  for (let i = 0; i < frames; i++) {
    const local = clipOffset + i;
    const o = clip.at + local - outStart;
    if (o < 0) continue;
    if (o >= outFrames) break;
    while (fi < clip.fade.length - 2 && local > clip.fade[fi + 1]!.s) fi++;
    while (di < clip.duck.length - 2 && local > clip.duck[di + 1]!.s) di++;
    const fa = clip.fade[fi]!, fb = clip.fade[fi + 1] ?? fa, da = clip.duck[di]!, db = clip.duck[di + 1] ?? da;
    const fg = fb.s === fa.s ? fb.g : fa.g + ((fb.g - fa.g) * Math.min(Math.max(local - fa.s, 0), fb.s - fa.s)) / (fb.s - fa.s);
    const dg = db.s === da.s ? db.g : da.g + ((db.g - da.g) * Math.min(Math.max(local - da.s, 0), db.s - da.s)) / (db.s - da.s);
    let vg = 1;
    if (vol) {
      while (vi < vol.length - 2 && local > vol[vi + 1]!.s) vi++;
      const va = vol[vi]!, vb = vol[vi + 1] ?? va;
      vg = vb.s === va.s ? vb.g : va.g + ((vb.g - va.g) * Math.min(Math.max(local - va.s, 0), vb.s - va.s)) / (vb.s - va.s);
    }
    const g = clip.gain * fg * dg * vg;
    out[o * 2] = out[o * 2]! + pcm[i * 2]! * g * gl;
    out[o * 2 + 1] = out[o * 2 + 1]! + pcm[i * 2 + 1]! * g * gr;
  }
}
