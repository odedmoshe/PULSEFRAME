import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, duckEnvelope, envAt, mixClip, panGains, type PlannedAudioClip } from './index.ts';

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
