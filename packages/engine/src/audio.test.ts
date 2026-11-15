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
  it('reference mixer: chunked mixing equals one-shot mixing, and equals the closed-form gain', () => {
    const clip: PlannedAudioClip = { clipId: 'c', trackId: 't', assetId: 'a', at: 100, length: 1000, source: 0, gain: 0.8, pan: 0.25, fade: [{ s: 0, g: 0 }, { s: 200, g: 1 }, { s: 700, g: 1 }, { s: 1000, g: 0 }], duck: [{ s: 0, g: 1 }, { s: 400, g: 1 }, { s: 500, g: 0.25 }, { s: 1000, g: 0.25 }] };
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
