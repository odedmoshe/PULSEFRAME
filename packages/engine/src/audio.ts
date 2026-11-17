/**
 * Audio plan (SPEC §10): the one description of what every mixer must produce.
 * Pure. Server export, browser export and preview all consume this plan, so gain, pan, fades and ducking
 * mean the same thing everywhere. Positions are integer samples rounded from absolute times (never accumulated).
 *
 * gain(sample) of a planned clip = gain × fade(sample) × duck(sample), where fade and duck are piecewise-linear
 * envelopes in clip-local samples. Mixers must evaluate them per sample (or with exact linear ramps).
 */
import * as T from '@pulseframe/time';
import { isRamped, sourceEnd, speedEndValue, speedValue, timelineAt, volumePoints, type AudioFxParams, type ProjectDocument, type Sequence, type Track } from '@pulseframe/core';
import type { PlannedFx } from './audiofx/kernel.ts';
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
  /** Samples at plan rate (chainReach). */
  warmWindow: number; warmRing: number;
  /** Output after `length`, already cut at the programme end. */
  tail: number;
  /** Present when the tail was cut: linear fade to 0 over [cutFrom, length + tail). */
  cutFrom?: number;
}
export interface AudioPlan { sampleRate: number; totalSamples: number; clips: PlannedAudioClip[]; loudness: { target: number; truePeak: number } | null;
  cutTails: { clipId: string; seconds: number }[];
  /** Effects of the document this build has no kernel for (left out of the plan; export blocks on them). */
  missingFx: { clipId: string; type: string; version: number }[] }
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

/** Timeline sample ranges in which the source tracks carry speech: transcript phrases where a transcript exists, else whole clips. */
export function speechRanges(doc: ProjectDocument, seq: Sequence, sourceTrackIds: string[]): [number, number][] {
  const sr = doc.settings.sampleRate;
  const out: [number, number][] = [];
  for (const tr of seq.tracks) {
    if (!sourceTrackIds.includes(tr.id) || tr.kind !== 'audio' || tr.muted) continue;
    for (const c of tr.clips) {
      if (c.type !== 'media' || c.gain <= 0) continue;
      const end = T.add(c.start, c.duration), srcEnd = sourceEnd(c);
      const transcript = doc.transcripts?.[c.assetId];
      if (!transcript || c.reverse) { out.push([T.nearestSampleIndex(c.start, sr), T.nearestSampleIndex(end, sr)]); continue; } // a reversed clip is treated as speech throughout: its phrases no longer sit where the transcript says
      for (const seg of transcript.segments) {
        const a = T.max(seg.start, c.sourceIn), b = T.min(T.add(seg.start, seg.duration), srcEnd);
        if (T.lt(a, b)) out.push([T.nearestSampleIndex(timelineAt(c, a), sr), T.nearestSampleIndex(timelineAt(c, b), sr)]);
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

/** Interim body (lead contract): sound effects are not planned yet; `opts.sampleRate` and `bypassFx` are accepted. */
export function audioPlan(doc: ProjectDocument, sequenceId = doc.mainSequenceId, opts: AudioPlanOptions = {}): AudioPlan {
  const seq = doc.sequences[sequenceId]!;
  const sr = opts.sampleRate ?? doc.settings.sampleRate;
  const clips: PlannedAudioClip[] = [];
  let total = 0;
  for (const tr of seq.tracks) for (const c of tr.clips) total = Math.max(total, T.nearestSampleIndex(T.add(c.start, c.duration), sr));
  for (const tr of seq.tracks) {
    if (!audible(tr)) continue;
    const trackGain = tr.audio?.gain ?? 1;
    const d = tr.audio?.duck;
    const ms = (v: number) => Math.round((v * sr) / 1000);
    const duckGlobal = d ? duckEnvelope(speechRanges(doc, seq, d.sourceTrackIds), d.reductionDb, ms(d.attackMs), ms(d.releaseMs)) : FLAT;
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
      clips.push({ ...(vol ? { vol } : {}), ...(c.reverse ? { reverse: true as const } : {}), ...(isRamped(c) ? { speedEnd: speedEndValue(c), ...(c.rampWindow ? { rampOffset: T.nearestSampleIndex(c.rampWindow.offset, sr), rampTotal: T.nearestSampleIndex(c.rampWindow.total, sr) } : {}), ...(c.speedCurve ? { rampCurve: c.speedCurve } : {}) } : c.keepPitch && speedValue(c) !== 1 ? { keepPitch: true as const } : {}), clipId: c.id, trackId: tr.id, assetId: c.assetId, at, length, source: T.nearestSampleIndex(c.sourceIn, sr), speed: speedValue(c), gain, pan: tr.audio?.pan ?? 0, fade, duck: sliceEnv(duckGlobal, at, length) });
    }
  }
  return { sampleRate: sr, totalSamples: total, clips, loudness: doc.settings.loudness ?? null, cutTails: [], missingFx: [] };
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
