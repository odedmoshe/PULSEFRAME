import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findAudioEffect, findClip, isRamped, sourceEnd, speedEndValue, speedValue, validateProject, volumePoints, type AudioFxInstance, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, chainReach, duckEnvelope, envAt, fxSeed, kernelFor, mixClip, panGains, registerKernel, soundEnd, speechRanges, type EnvPoint, type FxKernel, type PlannedAudioClip } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `a${n++}_`, actor: 'test', allowInternal });
const mkAsset = (h: string, name: string) => ({
  kind: 'audio' as const, name, contentHash: `sha256:${h.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1),
  audio: { sampleRate: 48000, channels: 2, codec: 'pcm' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
});
function project() {
  let r = tx(createProject({ id: 'p', name: 'p' }), [{ op: 'import_asset', args: { asset: mkAsset('1', 'voice.wav') } }, { op: 'import_asset', args: { asset: mkAsset('2', 'music.wav') } }], true);
  const [voice, music] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  r = tx(r.doc, [{ op: 'add_track', args: { kind: 'audio', name: 'voice' } }, { op: 'add_track', args: { kind: 'audio', name: 'music' } }]);
  const [vt, mt] = r.results.map((x) => x.output!.trackId as string) as [string, string];
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: voice, start: f(60), trackId: vt, duration: f(90) } }, { op: 'add_clip', args: { assetId: music, start: f(0), trackId: mt } }]);
  const [vc, mc] = r.results.map((x) => (x.output!.audioClipId ?? x.output!.clipId) as string) as [string, string];
  return { doc: r.doc, voice, music, vt, mt, vc, mc };
}

describe('audio plan', () => {
  it('envelopes: fades are exact linear ramps in samples; plan positions come from absolute times', () => {
    const p = project();
    const d = tx(p.doc, [{ op: 'set_clip_fades', args: { clipId: p.mc, fadeIn: T.rt(1, 2), fadeOut: T.rt(1, 1) } }, { op: 'set_track_audio', args: { trackId: p.mt, gain: 0.5, pan: -0.5 } }]).doc;
    expect(validateProject(d)).toEqual([]);
    const m = audioPlan(d).clips.find((c) => c.clipId === p.mc)!;
    expect([m.at, m.length, m.source, m.gain, m.pan]).toEqual([0, 480000, 0, 0.5, -0.5]);
    expect(m.fade).toEqual([{ s: 0, g: 0 }, { s: 24000, g: 1 }, { s: 432000, g: 1 }, { s: 480000, g: 0 }]);
    expect([envAt(m.fade, 0), envAt(m.fade, 12000), envAt(m.fade, 24000), envAt(m.fade, 456000), envAt(m.fade, 480000)]).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(panGains(-0.5)).toEqual([1, 0.5]);
    expect(panGains(0)).toEqual([1, 1]);
  });
  it('ducking: fully down exactly when speech starts, starts recovering exactly when it ends; close phrases stay ducked', () => {
    const env = duckEnvelope([[1000, 2000], [2100, 3000], [9000, 9500]], 20, 100, 200);
    expect(env).toEqual([{ s: 900, g: 1 }, { s: 1000, g: 0.1 }, { s: 3000, g: 0.1 }, { s: 3200, g: 1 }, { s: 8900, g: 1 }, { s: 9000, g: 0.1 }, { s: 9500, g: 0.1 }, { s: 9700, g: 1 }]);
    expect(envAt(env, 950)).toBeCloseTo(0.55, 9);
    expect(envAt(env, 2050)).toBe(0.1);
    expect(duckEnvelope([], 20, 100, 200)).toEqual([{ s: 0, g: 1 }]);
  });
  it('ducking in the plan uses clip ranges, and transcript phrases when the voice has a transcript', () => {
    const p = project();
    let d = tx(p.doc, [{ op: 'set_ducking', args: { trackId: p.mt, sourceTrackIds: [p.vt], reductionDb: 20, attackMs: 100, releaseMs: 200 } }]).doc;
    let m = audioPlan(d).clips.find((c) => c.clipId === p.mc)!;
    // voice clip at 2 s..5 s -> samples 96000..240000; attack 4800, release 9600
    expect(m.duck).toEqual([{ s: 0, g: 1 }, { s: 91200, g: 1 }, { s: 96000, g: 0.1 }, { s: 240000, g: 0.1 }, { s: 249600, g: 1 }, { s: 480000, g: 1 }]);
    // speech only in source 0.5..1.0 s of the voice file -> timeline 2.5..3.0 s
    d = tx(d, [{ op: 'set_transcript', args: { assetId: p.voice, language: 'he', segments: [{ start: T.rt(1, 2), duration: T.rt(1, 2), text: 'שלום' }] } }]).doc;
    m = audioPlan(d).clips.find((c) => c.clipId === p.mc)!;
    expect(m.duck.filter((x) => x.g < 1).map((x) => x.s)).toEqual([120000, 144000]);
    // moving the voice moves the dip; muting the voice track removes it
    const moved = tx(d, [{ op: 'move_clip', args: { clipId: p.vc, start: f(120) } }]).doc;
    expect(audioPlan(moved).clips.find((c) => c.clipId === p.mc)!.duck.filter((x) => x.g < 1).map((x) => x.s)).toEqual([216000, 240000]);
    const muted = tx(d, [{ op: 'set_track_audio', args: { trackId: p.vt, muted: true } }]).doc;
    expect(audioPlan(muted).clips.map((c) => c.clipId)).toEqual([p.mc]);
    expect(audioPlan(muted).clips[0]!.duck.every((x) => x.g === 1)).toBe(true);
  });
  it('fades survive edits sensibly: split keeps them on the outer edges; a shorter clip clamps them; undo-safe validity', () => {
    const p = project();
    let d = tx(p.doc, [{ op: 'set_clip_fades', args: { clipId: p.mc, fadeIn: T.rt(2, 1), fadeOut: T.rt(2, 1) } }]).doc;
    const s = tx(d, [{ op: 'split_clip', args: { clipId: p.mc, at: f(150) } }]);
    const left = findClip(s.doc, p.mc)!.clip as any, right = findClip(s.doc, s.results[0]!.output!.rightClipId as string)!.clip as any;
    expect([left.fadeIn, left.fadeOut, right.fadeIn, right.fadeOut]).toEqual([T.rt(2, 1), undefined, undefined, T.rt(2, 1)]);
    d = tx(d, [{ op: 'trim_clip', args: { clipId: p.mc, edge: 'end', to: f(90) } }]).doc; // 3 s left for 2 s + 2 s of fades
    const c = findClip(d, p.mc)!.clip as any;
    expect([c.fadeIn, c.fadeOut]).toEqual([T.rt(2, 1), T.rt(1, 1)]);
    expect(validateProject(d)).toEqual([]);
  });
  it('crossfade: the earlier clip is extended into its source handle and the two linear fades overlap exactly; removable; needs handle', () => {
    const p = project();
    // music clip split at 3 s: left = source 0..3, right = source 3..10 starting at 3 s
    const s1 = tx(p.doc, [{ op: 'split_clip', args: { clipId: p.mc, at: f(90) } }]);
    const right = s1.results[0]!.output!.rightClipId as string;
    const x = tx(s1.doc, [{ op: 'set_audio_crossfade', args: { clipId: right, duration: f(15) } }]).doc;
    expect(validateProject(x)).toEqual([]);
    const plan = audioPlan(x).clips;
    const L = plan.find((c) => c.clipId === p.mc)!, Rr = plan.find((c) => c.clipId === right)!;
    expect([L.at, L.length, Rr.at]).toEqual([0, 168000, 144000]); // left now runs 0.5 s into the right clip
    for (const s of [144000, 150000, 156000, 162000, 167999]) {
      const gl = envAt(L.fade, s - L.at), gr = envAt(Rr.fade, s - Rr.at);
      expect(gl + gr).toBeCloseTo(1, 9); // equal-gain: the two fades always sum to one
    }
    expect(L.source + (150000 - L.at)).toBe(Rr.source + (150000 - Rr.at)); // both read the same source sample there: seamless on continuous material
    const off = tx(x, [{ op: 'set_audio_crossfade', args: { clipId: right, duration: f(0) } }]).doc;
    expect(findClip(off, p.mc)!.clip).toEqual(findClip(s1.doc, p.mc)!.clip);
    expect(findClip(off, right)!.clip).toEqual(findClip(s1.doc, right)!.clip);
    // changing the length replaces the old crossfade rather than stacking on it
    const longer = tx(x, [{ op: 'set_audio_crossfade', args: { clipId: right, duration: f(30) } }]).doc;
    expect((findClip(longer, p.mc)!.clip as any).duration).toEqual(f(120));
    // no handle: a clip that already plays to the end of its source cannot be extended
    const whole = tx(p.doc, [{ op: 'add_clip', args: { assetId: p.music, start: f(300), trackId: p.mt } }]);
    const second = (whole.results[0]!.output!.audioClipId ?? whole.results[0]!.output!.clipId) as string;
    expect(() => tx(whole.doc, [{ op: 'set_audio_crossfade', args: { clipId: second, duration: f(15) } }])).toThrow(/unused source/);
  });
  it('volume automation: keys become a clip-local envelope (held outside, straight lines between), follow a start trim, and the mixer applies it on top of gain and fades', () => {
    const p = project();
    let d = tx(p.doc, [
      { op: 'set_volume_keyframe', args: { clipId: p.mc, time: f(30), value: 1 } },
      { op: 'set_volume_keyframe', args: { clipId: p.mc, time: f(90), value: 0.25 } },
      { op: 'set_clip_gain', args: { clipId: p.mc, gain: 0.5 } },
    ]).doc;
    expect(validateProject(d)).toEqual([]);
    let m = audioPlan(d).clips.find((c) => c.clipId === p.mc)!;
    expect(m.vol!.map((x) => [x.s, x.g])).toEqual([[0, 1], [48000, 1], [144000, 0.25], [m.length, 0.25]]);
    expect(envAt(m.vol!, 96000)).toBeCloseTo(0.625, 9); // halfway down the ramp
    const pcm = new Float32Array(m.length * 2).fill(1);
    const out = new Float32Array(m.length * 2);
    mixClip(out, 0, m, pcm, 0);
    expect(out[10 * 2]).toBeCloseTo(0.5, 6);
    expect(out[96000 * 2]).toBeCloseTo(0.5 * 0.625, 6);
    expect(out[200000 * 2]).toBeCloseTo(0.5 * 0.25, 6);
    // trimming 2 s off the start keeps the automation attached to the sound: the ramp is now 1 s in
    d = tx(d, [{ op: 'trim_clip', args: { clipId: p.mc, edge: 'start', to: f(60) } }]).doc;
    m = audioPlan(d).clips.find((c) => c.clipId === p.mc)!;
    expect(envAt(m.vol!, 0)).toBeCloseTo(0.625, 9);
    expect(envAt(m.vol!, 48000)).toBeCloseTo(0.25, 9);
    // removing one key, then all
    d = tx(d, [{ op: 'delete_volume_keyframe', args: { clipId: p.mc, time: f(30) } }]).doc;
    expect((findClip(d, p.mc)!.clip as any).volume).toHaveLength(1);
    d = tx(d, [{ op: 'delete_volume_keyframe', args: { clipId: p.mc } }]).doc;
    expect((findClip(d, p.mc)!.clip as any).volume).toBeUndefined();
    expect(audioPlan(d).clips.find((c) => c.clipId === p.mc)!.vol).toBeUndefined();
    expect(() => tx(d, [{ op: 'set_volume_keyframe', args: { clipId: p.mc, time: T.rt(1, 7), value: 1 } }])).toThrow();
    expect(() => tx(d, [{ op: 'set_volume_keyframe', args: { clipId: p.mc, time: f(100000), value: 1 } }])).toThrow();
  });
  it('reference mixer: chunked mixing equals one-shot mixing, and equals the closed-form gain', () => {
    const clip: PlannedAudioClip = { clipId: 'c', trackId: 't', assetId: 'a', at: 100, length: 1000, source: 0, speed: 1, gain: 0.8, pan: 0.25, fade: [{ s: 0, g: 0 }, { s: 200, g: 1 }, { s: 700, g: 1 }, { s: 1000, g: 0 }], duck: [{ s: 0, g: 1 }, { s: 400, g: 1 }, { s: 500, g: 0.25 }, { s: 1000, g: 0.25 }] };
    const pcm = new Float32Array(2000).fill(1);
    const whole = new Float32Array(2400);
    mixClip(whole, 0, clip, pcm, 0);
    for (const s of [0, 100, 250, 450, 650, 900, 999]) {
      const g = 0.8 * envAt(clip.fade, s) * envAt(clip.duck, s);
      expect(whole[(100 + s) * 2]).toBeCloseTo(g * 0.75, 6);
      expect(whole[(100 + s) * 2 + 1]).toBeCloseTo(g, 6);
    }
    expect(whole[99 * 2]).toBe(0);
    expect(whole[1100 * 2]).toBe(0);
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 500 }), (cuts, win) => {
      const out = new Float32Array(2400);
      // feed the clip in arbitrary pieces into arbitrary output windows
      let off = 0;
      for (const len of [...cuts, 1000]) {
        const take = Math.min(len, 1000 - off);
        if (take <= 0) break;
        for (let w = 0; w < 1200; w += win) mixClip(out.subarray(w * 2, Math.min(1200, w + win) * 2), w, clip, pcm.subarray(off * 2, (off + take) * 2), off);
        off += take;
      }
      for (let i = 0; i < out.length; i++) if (Math.abs(out[i]! - whole[i]!) > 1e-6) return false;
      return true;
    }), { numRuns: 40 });
  });
});

/**
 * The plan as it was before sound effects existed (frozen copy of the interim body, ADR-0010): a document without effects
 * must still be planned exactly like this.
 */
function planBeforeEffects(doc: ProjectDocument) {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const sr = doc.settings.sampleRate;
  const FLAT: EnvPoint[] = [{ s: 0, g: 1 }];
  const sliceEnv = (global: EnvPoint[], from: number, length: number): EnvPoint[] => {
    if (global.length === 1) return [{ s: 0, g: global[0]!.g }, { s: length, g: global[0]!.g }];
    const out: EnvPoint[] = [{ s: 0, g: envAt(global, from) }];
    for (const p of global) if (p.s > from && p.s < from + length) out.push({ s: p.s - from, g: p.g });
    out.push({ s: length, g: envAt(global, from + length) });
    return out;
  };
  const clips: PlannedAudioClip[] = [];
  let total = 0;
  for (const tr of seq.tracks) for (const c of tr.clips) total = Math.max(total, T.nearestSampleIndex(T.add(c.start, c.duration), sr));
  for (const tr of seq.tracks) {
    if (tr.kind !== 'audio' || tr.muted) continue;
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
      const vol = c.volume?.length ? sliceEnv(volumePoints(c.volume, (t) => T.nearestSampleIndex(t, sr)).map((p) => ({ s: Math.round(p.x), g: p.value })), 0, length) : undefined;
      clips.push({ ...(vol ? { vol } : {}), ...(c.reverse ? { reverse: true as const } : {}), ...(isRamped(c) ? { speedEnd: speedEndValue(c), ...(c.rampWindow ? { rampOffset: T.nearestSampleIndex(c.rampWindow.offset, sr), rampTotal: T.nearestSampleIndex(c.rampWindow.total, sr) } : {}), ...(c.speedCurve ? { rampCurve: c.speedCurve } : {}) } : c.keepPitch && speedValue(c) !== 1 ? { keepPitch: true as const } : {}), clipId: c.id, trackId: tr.id, assetId: c.assetId, at, length, source: T.nearestSampleIndex(c.sourceIn, sr), speed: speedValue(c), gain, pan: tr.audio?.pan ?? 0, fade, duck: sliceEnv(duckGlobal, at, length) });
    }
  }
  return { sampleRate: sr, totalSamples: total, clips, loudness: doc.settings.loudness ?? null };
}

// Kernels for the real effect types, for builds where the kernels worker's registrations are absent (labelled test kernels:
// they pass the sound through and declare a reach of the same shape). With the real kernels present those are used instead;
// every expectation below derives its numbers from chainReach, so it holds for either.
const passThrough = (type: string, stage: FxKernel['stage'], reach: FxKernel['reach']): void => { if (!kernelFor(type, findAudioEffect(type)!.version)) registerKernel({ type, version: findAudioEffect(type)!.version, stage, reach, create: () => ({ process() {} }) }); };
passThrough('voice.telephone', 3, () => ({ warm: 600, tail: 0 }));
passThrough('voice.robot', 3, (_p, sr) => ({ warm: Math.round(0.0165 * sr), tail: 0 }));
passThrough('tone.bassboost', 2, () => ({ warm: 4000, tail: 0 }));
passThrough('space.echo', 4, (p, sr) => { const n = Number(p.repeats) * Math.round((Number(p.delayMs) * sr) / 1000); return { warm: n, tail: n }; });
passThrough('space.reverb', 4, (p, sr) => { const n = Math.round(2.41 * Number(p.decaySeconds) * sr) + 3000; return { warm: n, tail: n }; });
passThrough('utility.width', 6, () => ({ warm: 0, tail: 0 }));

const withFx = (doc: ProjectDocument, clipId: string, list: AudioFxInstance[]): ProjectDocument => {
  const d = structuredClone(doc);
  (findClip(d, clipId)!.clip as any).audioFx = list;
  return d;
};
const inst = (id: string, type: string, params: Record<string, number | string | boolean> = {}, enabled = true): AudioFxInstance => ({ id, type, enabled, params });

describe('audio plan with sound effects (ADR-0010)', () => {
  /** Documents covering what the plan has to express without effects. */
  function fixtures() {
    const p = project();
    const docs: Record<string, ProjectDocument> = { plain: p.doc };
    docs.fadesAndTrack = tx(p.doc, [{ op: 'set_clip_fades', args: { clipId: p.mc, fadeIn: T.rt(1, 2), fadeOut: T.rt(1, 1) } }, { op: 'set_track_audio', args: { trackId: p.mt, gain: 0.5, pan: -0.5 } }]).doc;
    const ducked = tx(p.doc, [{ op: 'set_ducking', args: { trackId: p.mt, sourceTrackIds: [p.vt], reductionDb: 20, attackMs: 100, releaseMs: 200 } }]).doc;
    docs.ducked = ducked;
    docs.duckedTranscript = tx(ducked, [{ op: 'set_transcript', args: { assetId: p.voice, language: 'he', segments: [{ start: T.rt(1, 2), duration: T.rt(1, 2), text: 'שלום' }] } }]).doc;
    const split = tx(p.doc, [{ op: 'split_clip', args: { clipId: p.mc, at: f(90) } }]);
    docs.crossfade = tx(split.doc, [{ op: 'set_audio_crossfade', args: { clipId: split.results[0]!.output!.rightClipId as string, duration: f(15) } }]).doc;
    docs.volumeKeys = tx(p.doc, [{ op: 'set_volume_keyframe', args: { clipId: p.mc, time: f(30), value: 1 } }, { op: 'set_volume_keyframe', args: { clipId: p.mc, time: f(90), value: 0.25 } }, { op: 'set_clip_gain', args: { clipId: p.mc, gain: 0.5 } }]).doc;
    docs.reversedFast = tx(p.doc, [{ op: 'set_clip_speed', args: { clipId: p.vc, speed: 1.5 } }, { op: 'set_clip_reverse', args: { clipId: p.mc, reverse: true } }]).doc;
    docs.keepPitch = tx(p.doc, [{ op: 'set_clip_speed', args: { clipId: p.vc, speed: 0.5 } }, { op: 'set_clip_pitch', args: { clipId: p.vc, keepPitch: true } }]).doc;
    docs.ramp = tx(p.doc, [{ op: 'set_clip_speed_ramp', args: { clipId: p.vc, from: 1, to: 0.5 } }]).doc;
    docs.muted = tx(ducked, [{ op: 'set_track_audio', args: { trackId: p.vt, muted: true } }]).doc;
    for (const [name, d] of Object.entries(docs)) expect(validateProject(d), name).toEqual([]);
    return { p, docs };
  }

  it('a document without sound effects is planned exactly as before effects existed, with cutTails [] and missingFx []', () => {
    const { docs } = fixtures();
    for (const [name, d] of Object.entries(docs)) {
      const plan = audioPlan(d);
      const { cutTails, missingFx, ...rest } = plan;
      expect(JSON.stringify(rest), name).toBe(JSON.stringify(planBeforeEffects(d)));
      expect([cutTails, missingFx], name).toEqual([[], []]);
      expect(plan.clips.some((c) => c.voice), name).toBe(false);
      // and the bypass (session A/B) plan is the same plan
      expect(audioPlan(d, undefined, { bypassFx: true }), name).toEqual(plan);
    }
  });

  it('disabled effects and effects at their identity settings give no voice; the other clips are unchanged', () => {
    const { p } = fixtures();
    const before = audioPlan(p.doc);
    for (const list of [[inst('afx_1', 'voice.telephone', {}, false)], [inst('afx_1', 'voice.telephone', { amount: 0 })], [inst('afx_1', 'utility.width', { stereoWidth: 1 }), inst('afx_2', 'space.echo', { amount: 0 }, true), inst('afx_3', 'voice.robot', {}, false)]]) {
      const d = withFx(p.doc, p.vc, list);
      expect(validateProject(d)).toEqual([]);
      const plan = audioPlan(d);
      expect(plan).toEqual(before);
    }
  });

  it('voice fields: chain in stage order with registry versions and seeds, exact source mapping, reach from chainReach, duck over length + tail', () => {
    const { p, docs } = fixtures();
    // listed out of order on purpose: the plan processes in the fixed stage order
    const list = [inst('afx_w', 'utility.width', { stereoWidth: 0.5 }), inst('afx_e', 'space.echo', { delayMs: 200, repeats: 3 }), inst('afx_t', 'voice.telephone', { hiss: 0.5, seed: 9 }), inst('afx_b', 'tone.bassboost')];
    const d = withFx(docs.ducked!, p.mc, list);
    expect(validateProject(d)).toEqual([]);
    const plan = audioPlan(d);
    const m = plan.clips.find((c) => c.clipId === p.mc)!;
    const v = m.voice!;
    expect(v.chain.map((x) => x.type)).toEqual(['tone.bassboost', 'voice.telephone', 'space.echo', 'utility.width']);
    expect(v.chain.map((x) => [x.id, x.version, x.stage])).toEqual([['afx_b', 1, 2], ['afx_t', 1, 3], ['afx_e', 1, 4], ['afx_w', 1, 6]]);
    const tel = v.chain[1]!;
    expect(tel.params).toEqual({ amount: 1, grit: 0.4, hiss: 0.5, seed: 9 }); // defaults filled in
    expect(tel.seed).toBe(fxSeed('afx_t', tel.params));
    expect(v.chain.filter((x) => x.type !== 'voice.telephone').every((x) => x.seed === 0)).toBe(true);
    const clip = findClip(d, p.mc)!.clip as any;
    expect([v.sourceIn, v.sourceEnd, v.speed, v.reverse, v.sourceRate]).toEqual([T.normalize(clip.sourceIn), T.normalize(sourceEnd(clip)), { num: 1, den: 1 }, false, 48000]);
    const reach = chainReach(v.chain, 48000);
    expect([v.warmWindow, v.warmRing]).toEqual([reach.warmWindow, reach.warmRing]);
    // the music clip ends at the programme end: its whole tail is cut there (none of it is kept)
    expect(m.at + m.length).toBe(plan.totalSamples);
    expect(v.tail).toBe(0);
    expect(v.cutFrom).toBe(m.length);
    expect(plan.cutTails).toEqual([{ clipId: p.mc, seconds: Number((reach.tail / 48000).toFixed(3)) }]);
    expect(soundEnd(m)).toBe(plan.totalSamples);
    // everything else about the clip is as without effects
    const { voice, ...rest } = m;
    void voice;
    expect(rest).toEqual(audioPlan(docs.ducked!).clips.find((c) => c.clipId === p.mc));
    expect(plan.missingFx).toEqual([]);

    // on the voice clip (2 s .. 5 s of a 10 s programme) the tail is kept whole, and a ducked track ducks it
    const dv = tx(withFx(docs.ducked!, p.vc, [inst('afx_e', 'space.echo', { delayMs: 200, repeats: 3 })]), [{ op: 'set_ducking', args: { trackId: p.vt, sourceTrackIds: [p.mt], reductionDb: 12, attackMs: 50, releaseMs: 50 } }]).doc;
    expect(validateProject(dv)).toEqual([]);
    const pv = audioPlan(dv);
    const vc = pv.clips.find((c) => c.clipId === p.vc)!;
    const echoTail = chainReach(vc.voice!.chain, 48000).tail;
    expect(echoTail).toBeGreaterThan(0);
    expect([vc.voice!.tail, vc.voice!.cutFrom, pv.cutTails]).toEqual([echoTail, undefined, []]);
    expect(vc.duck.at(-1)!.s).toBe(vc.length + echoTail);
    // music plays under the whole voice clip, so the voice track is ducked over the clip and its tail alike
    expect(vc.duck.every((x) => x.g < 1)).toBe(true);
    // tails never trigger ducking: the music under the voice is ducked exactly as without the echo
    expect(pv.clips.find((c) => c.clipId === p.mc)!.duck).toEqual(audioPlan(docs.ducked!).clips.find((c) => c.clipId === p.mc)!.duck);
  });

  it('a tail that would pass the programme end is cut there with a fade of at most 10 ms, and reported', () => {
    const { p } = fixtures();
    // the voice clip moved to end 0.5 s before the programme end, with an echo of 1.2 s
    const moved = tx(p.doc, [{ op: 'move_clip', args: { clipId: p.vc, start: f(195) } }]).doc;
    const d = withFx(moved, p.vc, [inst('afx_e', 'space.echo', { delayMs: 300, repeats: 4 })]);
    expect(validateProject(d)).toEqual([]);
    const plan = audioPlan(d);
    const c = plan.clips.find((x) => x.clipId === p.vc)!;
    const full = chainReach(c.voice!.chain, 48000).tail;
    expect(full).toBeGreaterThan(24000);
    expect(c.at + c.length).toBe(plan.totalSamples - 24000);
    expect(c.voice!.tail).toBe(24000);
    expect(c.voice!.cutFrom).toBe(c.length + 24000 - 480);
    expect(soundEnd(c)).toBe(plan.totalSamples);
    expect(plan.cutTails).toEqual([{ clipId: p.vc, seconds: Number(((full - 24000) / 48000).toFixed(3)) }]);
    expect(c.duck.at(-1)!.s).toBe(c.length + 24000);
    // a programme that ends 3 ms after the clip: the fade covers what is left of the tail, never the clip itself
    const short = tx(p.doc, [{ op: 'trim_clip', args: { clipId: p.mc, edge: 'end', to: f(150) } }]).doc;
    const d2 = withFx(short, p.vc, [inst('afx_e', 'space.echo', { delayMs: 300, repeats: 4 })]);
    const c2 = audioPlan(d2).clips.find((x) => x.clipId === p.vc)!;
    expect([c2.voice!.tail, c2.voice!.cutFrom]).toEqual([0, c2.length]);
  });

  it('effects this build cannot run are reported in missingFx and left out; the wave-1 time-map limit too', () => {
    const { p, docs } = fixtures();
    const d = withFx(p.doc, p.vc, [inst('afx_x', 'voice.future'), inst('afx_e', 'space.echo')]);
    const plan = audioPlan(d);
    expect(plan.missingFx).toEqual([{ clipId: p.vc, type: 'voice.future', version: 0 }]);
    expect(plan.clips.find((c) => c.clipId === p.vc)!.voice!.chain.map((x) => x.type)).toEqual(['space.echo']);
    // a clip that keeps its pitch at another speed (refused by validation as audio_fx_time_map) gets no voice and is reported
    const kp = withFx(docs.keepPitch!, p.vc, [inst('afx_e', 'space.echo')]);
    expect(validateProject(kp).map((i) => i.code)).toContain('audio_fx_time_map');
    const kpPlan = audioPlan(kp);
    expect(kpPlan.clips.find((c) => c.clipId === p.vc)!.voice).toBeUndefined();
    expect(kpPlan.missingFx).toEqual([{ clipId: p.vc, type: 'space.echo', version: 1 }]);
    // the bypass plan has no voices and reports nothing
    const bypass = audioPlan(d, undefined, { bypassFx: true });
    expect([bypass.clips.some((c) => c.voice), bypass.missingFx, bypass.cutTails]).toEqual([false, [], []]);
    expect(bypass).toEqual(audioPlan(p.doc));
  });

  it('a reversed clip at another speed carries the exact rational mapping; split parts keep their own sources', () => {
    const { p } = fixtures();
    const d0 = tx(p.doc, [{ op: 'set_clip_speed', args: { clipId: p.vc, speed: 1.5 } }, { op: 'set_clip_reverse', args: { clipId: p.vc, reverse: true } }]).doc;
    const d = withFx(d0, p.vc, [inst('afx_r', 'voice.robot')]);
    expect(validateProject(d)).toEqual([]);
    const c = audioPlan(d).clips.find((x) => x.clipId === p.vc)!;
    const clip = findClip(d, p.vc)!.clip as any;
    expect([c.voice!.speed, c.voice!.reverse, c.voice!.sourceIn, c.voice!.sourceEnd]).toEqual([{ num: 3, den: 2 }, true, T.normalize(clip.sourceIn), T.normalize(sourceEnd(clip))]);
    expect(c.voice!.tail).toBe(0); // a window stage has no tail
  });

  it('opts.sampleRate places every clip and speech range at that rate (a 48 kHz document at 44.1 kHz)', () => {
    const { p, docs } = fixtures();
    for (const [name, d] of Object.entries(docs)) {
      const at44 = audioPlan(d, undefined, { sampleRate: 44100 });
      const asIf44 = planBeforeEffects({ ...d, settings: { ...d.settings, sampleRate: 44100 } });
      expect(JSON.stringify({ ...at44, cutTails: undefined, missingFx: undefined }), name).toBe(JSON.stringify(asIf44));
    }
    const m = audioPlan(docs.ducked!, undefined, { sampleRate: 44100 }).clips.find((c) => c.clipId === p.mc)!;
    // voice clip at 2 s..5 s -> 88200..220500 at 44.1 kHz; attack 100 ms = 4410, release 200 ms = 8820
    expect(m.duck).toEqual([{ s: 0, g: 1 }, { s: 83790, g: 1 }, { s: 88200, g: 0.1 }, { s: 220500, g: 0.1 }, { s: 229320, g: 1 }, { s: 441000, g: 1 }]);
    expect(speechRanges(docs.ducked!, docs.ducked!.sequences[docs.ducked!.mainSequenceId]!, [p.vt], 44100)).toEqual([[88200, 220500]]);
    const v = audioPlan(docs.ducked!, undefined, { sampleRate: 44100 }).clips.find((c) => c.clipId === p.vc)!;
    expect([v.at, v.length]).toEqual([88200, 132300]);
    // a voice planned at 44.1 kHz: reach and tail in samples of that rate
    const fx44 = audioPlan(withFx(p.doc, p.vc, [inst('afx_e', 'space.echo')]), undefined, { sampleRate: 44100 }).clips.find((c) => c.clipId === p.vc)!.voice!;
    expect(fx44.tail).toBe(chainReach(fx44.chain, 44100).tail);
  });
});
