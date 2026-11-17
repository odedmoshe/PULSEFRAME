/**
 * Timing of transitions (ADR-0012, transitionTiming.ts): the eased progress with and without a beat lock, where the switch
 * falls, the velocity ramp's frame offsets and source needs, the light envelope, and the beat a transition locks to.
 * Exhaustive over every length a transition may have (1 … 150 frames).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';
import { beatSwitchFrame, lightEnvelope, lightStartFrame, LIGHT_SECONDS, smooth, switchFrame, transitionProgress, velocityNeeds, velocityOffsets } from './transitionTiming.ts';

/** The ease as it was written in packages/engine/src/evaluate.ts before ADR-0012 (b6b5be9:98), copied here, not imported. */
const OLD_EASE = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const LENGTHS = Array.from({ length: 150 }, (_, i) => i + 1);

describe('transition timing', () => {
  it('without a beat lock, progress is bit-equal to the ease every transition had before, and switchFrame is the old middle', () => {
    const bad: string[] = [];
    for (let n = 1; n <= 150; n++) for (let l = 0; l < n; l++) {
      const p = transitionProgress(l, n, null);
      if (p !== smooth((l + 1) / (n + 1)) || p !== OLD_EASE((l + 1) / (n + 1))) bad.push(`n=${n} l=${l}`);
    }
    expect(bad).toEqual([]);
    for (const n of [1, 2, 3, 29, 30]) expect(switchFrame(n, null)).toBe(Math.ceil((n - 1) / 2));
    // literal values of the old ease, so a change of `smooth` itself cannot pass unnoticed
    expect([smooth(0), smooth(0.25), smooth(0.5), smooth(0.75), smooth(1)]).toEqual([0, 0.0625, 0.5, 0.9375, 1]);
    expect(transitionProgress(0, 29, null)).toBeCloseTo(4 / 27000, 15);
    expect(transitionProgress(14, 29, null)).toBe(0.5);
    expect(transitionProgress(28, 29, null)).toBeCloseTo(1 - 4 / 27000, 15);
  });

  it('for n = 1..150 and every k in 1..n−1 (and none): progress strictly increasing, inside (0,1); switchFrame is the first frame with p >= 0.5', () => {
    const bad: string[] = [];
    let cases = 0;
    for (const n of LENGTHS) {
      for (let k: number | null = null; k === null || k <= n - 1; k = k === null ? 1 : k + 1) {
        cases++;
        let prev = -Infinity, first = -1;
        for (let l = 0; l < n; l++) {
          const p = transitionProgress(l, n, k);
          if (!(p > 0 && p < 1)) bad.push(`outside (0,1): n=${n} k=${k} l=${l} ${p}`);
          if (!(p > prev)) bad.push(`not increasing: n=${n} k=${k} l=${l}`);
          if (first < 0 && p >= 0.5) first = l;
          prev = p;
        }
        if (switchFrame(n, k) !== first) bad.push(`switch: n=${n} k=${k} ${switchFrame(n, k)} vs ${first}`);
        if (k !== null && first !== k) bad.push(`the lock does not switch on its beat: n=${n} k=${k} first=${first}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(cases).toBe(150 + (149 * 150) / 2);
  });

  it('velocity for v = 2, 3, 4 and n = 1..150: l + out and l − in strictly increasing; in(n−1) = 0; max(l + out) + 1 = outFrames and in(0) = headFrames', () => {
    const bad: string[] = [];
    for (const v of [2, 3, 4]) for (const n of LENGTHS) {
      const o = Array.from({ length: n }, (_, l) => velocityOffsets(n, v, l));
      for (let l = 0; l < n; l++) {
        if (!(Number.isInteger(o[l]!.out) && Number.isInteger(o[l]!.in) && o[l]!.out >= 0 && o[l]!.in >= 0)) bad.push(`whole frames: v=${v} n=${n} l=${l}`);
        if (l > 0 && !(l + o[l]!.out > l - 1 + o[l - 1]!.out)) bad.push(`out: v=${v} n=${n} l=${l}`);
        if (l > 0 && !(l - o[l]!.in > l - 1 - o[l - 1]!.in)) bad.push(`in: v=${v} n=${n} l=${l}`);
      }
      const need = velocityNeeds(n, v);
      if (o[0]!.out !== 0) bad.push(`out(0): v=${v} n=${n}`); // the outgoing picture leaves its end at its own speed
      if (o[n - 1]!.in !== 0) bad.push(`in(n-1): v=${v} n=${n}`); // the incoming picture lands on sourceIn + n − 1: back on the clip's own timing
      if (Math.max(...o.map((x, l) => l + x.out)) + 1 !== need.outFrames) bad.push(`outFrames: v=${v} n=${n}`);
      if (o[0]!.in !== need.headFrames) bad.push(`headFrames: v=${v} n=${n}`);
      if (need.outFrames - n !== need.headFrames) bad.push(`symmetry: v=${v} n=${n}`); // as far past the previous clip's end as before the clip's start
    }
    expect(bad.slice(0, 10)).toEqual([]);
    // the figures the refusals quote for n = 15 (trendpack.test.ts checks the ops against them)
    expect([2, 3, 4].map((v) => velocityNeeds(15, v).outFrames)).toEqual([22, 29, 36]);
    expect([2, 3, 4].map((v) => velocityNeeds(15, v).headFrames)).toEqual([7, 14, 21]);
  });

  it('lightEnvelope is 1 on the switch frame, 0 outside D frames, symmetric, and 1 for n = 1', () => {
    const bad: string[] = [];
    for (const fps of [24, 25, 30, 60]) for (const n of LENGTHS) for (const k of [null, ...(n >= 3 ? [1, Math.floor(n / 2), n - 1] : [])]) {
      const sw = switchFrame(n, k), D = Math.min(LIGHT_SECONDS * fps, n), at = `fps=${fps} n=${n} k=${k}`;
      if (lightEnvelope(n, fps, sw, sw) !== 1) bad.push(`peak: ${at}`);
      let lit = 0, first = -1;
      for (let l = 0; l < n; l++) {
        const e = lightEnvelope(n, fps, sw, l);
        if (!(e >= 0 && e <= 1)) bad.push(`range: ${at} l=${l}`);
        if (Math.abs(l - sw) >= D / 2) { if (e !== 0) bad.push(`outside D: ${at} l=${l} ${e}`); }
        else { if (!(e > 0)) bad.push(`inside D: ${at} l=${l}`); lit++; }
        if (first < 0 && e > 0) first = l;
        // symmetric about the switch frame (as a function of the frame, also past the transition's ends)
        if (Math.abs(lightEnvelope(n, fps, sw, 2 * sw - l) - e) > 1e-12) bad.push(`symmetry: ${at} l=${l}`);
        // it rises once and falls once
        if (l > 0) { const a = lightEnvelope(n, fps, sw, l - 1); if (l <= sw ? e < a : e > a) bad.push(`shape: ${at} l=${l}`); }
      }
      if (lit > Math.ceil(D)) bad.push(`lasts too long: ${at} ${lit}`);
      if (lightStartFrame(n, fps, sw) !== first) bad.push(`start: ${at}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    for (const fps of [24, 30, 60]) expect(lightEnvelope(1, fps, 0, 0)).toBe(1);
    // the light lasts min(0.4 s, the transition): 12 frames at 30 fps, so a 29-frame transition lights 11 frames around frame 14
    expect(Array.from({ length: 29 }, (_, l) => lightEnvelope(29, 30, 14, l) > 0).filter(Boolean).length).toBe(11);
  });
});

// ---------- beat lock ----------
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seq = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `tt${seq++}_`, actor: 'test', allowInternal });
const fixture = (kind: 'video' | 'audio', c: string) => ({
  kind, name: `${c}.${kind === 'video' ? 'mp4' : 'wav'}`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: kind === 'video' ? 'mp4' : 'wav', mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav', duration: T.rt(10, 1),
  ...(kind === 'video' ? { video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 } } : { audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' } }),
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
});
/**
 * A at timeline frames 0–60 (source 30–90), B at 60–120 (source 100–160) with a beat-locked dissolve of `n` frames (window
 * 60 … 60+n−1), and a song from timeline 0 whose beats are set by hand with edit_analysis at the given timeline frames.
 */
function locked(beatFrames: number[], n = 29) {
  let r = tx(createProject({ id: 'prj_tt', name: 'tt', frameRate: R }), [{ op: 'import_asset', args: { asset: fixture('video', 'a') } }, { op: 'import_asset', args: { asset: fixture('audio', 'b') } }], true);
  const [video, song] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: video, start: f(0), sourceIn: f(30), duration: f(60), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: video, start: f(60), sourceIn: f(100), duration: f(60), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: song, start: f(0) } },
  ]);
  const b = r.results[1]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: n } }, { op: 'set_transition_options', args: { clipId: b, sync: 'beat' } }]);
  if (beatFrames.length) r = tx(r.doc, [{ op: 'edit_analysis', args: { assetId: song!, kind: 'beats', replace: beatFrames.map(f) } }]);
  return { doc: r.doc, clip: () => findClip(r.doc, b)!.clip as MediaClip };
}

describe('beat lock', () => {
  it('beatSwitchFrame with beats at frames 70, 75, 80 and the window 60..88 returns 15; a tie returns the earlier beat', () => {
    const p = locked([70, 75, 80]);
    expect(beatSwitchFrame(p.doc, p.clip())).toBe(15);
    // moved by +2: the beat nearest the middle (14.5) is now frame 72 (k = 12, 2.5 away) against 77 (k = 17, 2.5 away): a tie, the earlier one
    const moved = locked([72, 77, 82]);
    expect(beatSwitchFrame(moved.doc, moved.clip())).toBe(12);
    // an exact tie around the middle of an odd window: frames 74 and 75 are 0.5 from 14.5
    const tie = locked([74, 75]);
    expect(beatSwitchFrame(tie.doc, tie.clip())).toBe(14);
    // 28 frames: the middle is frame 14 itself
    const even = locked([73, 74, 75], 28);
    expect(beatSwitchFrame(even.doc, even.clip())).toBe(14);
  });

  it('only beats strictly inside the window count (k in 1..n−1); with none there, or without the lock, it is null', () => {
    const outside = locked([60, 89, 100]);
    expect(beatSwitchFrame(outside.doc, outside.clip())).toBeNull(); // frame 60 is k = 0, frame 89 is past the window
    const edge = locked([61, 88]);
    expect(beatSwitchFrame(edge.doc, edge.clip())).toBe(1); // 1 and 28 are both 13.5 from the middle: the earlier one
    const none = locked([]);
    expect(beatSwitchFrame(none.doc, none.clip())).toBeNull();
    const p = locked([70, 75, 80]);
    const off = tx(p.doc, [{ op: 'set_transition_options', args: { clipId: p.clip().id, sync: null } }]).doc;
    expect(beatSwitchFrame(off, findClip(off, p.clip().id)!.clip as MediaClip)).toBeNull();
  });

  it('the locked progress crosses 0.5 exactly on the beat frame', () => {
    const p = locked([70, 75, 80]);
    const k = beatSwitchFrame(p.doc, p.clip())!;
    const progress = Array.from({ length: 29 }, (_, l) => transitionProgress(l, 29, k));
    expect(progress.findIndex((x) => x >= 0.5)).toBe(15);
    expect(60 + switchFrame(29, k)).toBe(75);
  });
});
