/**
 * Perform mode W1 (ADR-0025), properties over seeded random documents and takes, all through the REAL op apply_take:
 * - the planned arguments apply cleanly and leave a document that passes validateProject (200 documents);
 * - kept changes of light are never closer than flashGapFrames to each other or to the changes of light already there, at
 *   24, 25, 29.97, 30 and 60 fps, and the op agrees (it would refuse otherwise);
 * - a zoom punch changes nothing outside [a, b): every other frame of the punched clip samples the same before and after.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, defaultBank, flashGapFrames, lightChanges, lightRanges, MOVES, PAD_COUNT, performGrid, planPerformance, quantiseTaps,
  sampleKeyframes, TAKE_STEP_OPS, TRANSFORM_RANGE, validateProject,
  type Clip, type MoveSpec, type OpCall, type PadBank, type ProjectDocument, type QuantiseSettings, type Tap,
} from './index.ts';

const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;
const RATES: T.Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `p${n++}_`, actor: 'test', allowInternal: true });
const outOf = (r: ReturnType<typeof tx>) => r.results[0]!.output as Record<string, string>;
const move = (id: string) => structuredClone(MOVES.find((m) => m.id === id)!);
const clipsOf = (doc: ProjectDocument, seqId = doc.mainSequenceId) => doc.sequences[seqId]!.tracks.flatMap((t) => t.clips);

interface World { doc: ProjectDocument; rate: T.Rate; frames: number; assets: (string | null)[]; seqId: string }
/** A seeded random project: pictures with gaps and keys, titles, the owner's own adjustments and strobes, maybe music, maybe a locked track or a short. */
function world(seed: number, fixedRate?: T.Rate): World {
  const r = rng(seed), pick = <X>(xs: readonly X[]) => xs[Math.floor(r() * xs.length)]!;
  const rate = fixedRate ?? pick(RATES), fps = rate.num / rate.den;
  const fr = (k: number) => T.frameTime(Math.max(0, Math.round(k)), rate);
  let doc = createProject({ id: `prj_w${seed}`, name: 'w', width: 640, height: 360, frameRate: rate });
  const imp = (asset: object) => { const x = tx(doc, [{ op: 'import_asset', args: { asset } }]); doc = x.doc; return outOf(x).assetId!; };
  const video = imp({ kind: 'video', name: 'v.mp4', contentHash: hash(`1${seed % 7}`), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(120, 1), video: { width: 640, height: 360, frameRate: rate, codec: 'h264', rotation: 0, frameCount: Math.round(120 * fps) }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance });
  const sound = imp({ kind: 'audio', name: 's.wav', contentHash: hash(`2${seed % 5}`), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.fromSeconds((0.2 + r() * 1.5).toFixed(3)), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance });
  const still = imp({ kind: 'image', name: 'e.png', contentHash: hash(`3${seed % 3}`), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 100, height: 100, codec: 'png', hasAlpha: true }, provenance });
  let seqId = doc.mainSequenceId;
  if (r() < 0.15) { const s = tx(doc, [{ op: 'add_sequence', args: { name: 'short' } }]); doc = s.doc; seqId = outOf(s).sequenceId!; }
  const seqArg = seqId === doc.mainSequenceId ? {} : { sequenceId: seqId };
  const frames = Math.round(fps * (6 + r() * 20));
  // pictures: one or two tracks, with gaps
  let at = 0;
  while (at < frames) {
    const len = Math.round(fps * (1 + r() * 6));
    const x = tx(doc, [{ op: 'add_clip', args: { ...seqArg, assetId: video, start: fr(at), duration: fr(Math.min(len, frames - at)), withLinkedAudio: r() < 0.5 } }]);
    doc = x.doc;
    const clipId = outOf(x).clipId!;
    const k = r();
    if (k < 0.2) doc = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: fr(0), value: 1 } }, { op: 'set_keyframe', args: { clipId, property: 'scale', time: fr(len / 2), value: 1.4, easing: pick(['linear', 'hold', 'ease-out'] as const) } }]).doc;
    else if (k < 0.3) doc = tx(doc, [{ op: 'set_clip_transform', args: { clipId, transform: { x: Math.round((r() - 0.5) * 100) / 1000, scale: 1 + Math.round(r() * 50) / 100 } } }]).doc;
    at += len + (r() < 0.3 ? Math.round(fps * r() * 2) : 0);
  }
  if (r() < 0.4) doc = tx(doc, [{ op: 'add_clip', args: { ...seqArg, assetId: video, start: fr(fps * r() * 4), duration: fr(fps * 2), withLinkedAudio: false } }]).doc;
  if (r() < 0.6) doc = tx(doc, [{ op: 'add_text', args: { ...seqArg, text: 'שלום', start: fr(frames * r() * 0.5), duration: fr(fps * (1 + r() * 3)) } }]).doc;
  // the owner's adjustments, a strobe among them sometimes
  for (let i = 0, m = Math.floor(r() * 4); i < m; i++) doc = tx(doc, [{ op: 'add_adjustment', args: { ...seqArg, span: { start: fr(r() * frames * 0.9), duration: fr(fps * (0.3 + r() * 2)) }, effects: [{ type: pick(['color.sepia', 'blur.gaussian', 'color.invert', 'light.strobe']) }] } }]).doc;
  if (r() < 0.4) {
    const song = imp({ kind: 'audio', name: 'song.wav', contentHash: hash(`4${seed % 4}`), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });
    const period = 0.4 + r() * 0.3;
    doc = tx(doc, [{ op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z', times: Array.from({ length: Math.floor(58 / period) }, (_, i) => T.fromSeconds((0.2 + i * period).toFixed(3))), bpm: Math.round(60 / period) } }]).doc;
    doc = tx(doc, [{ op: 'add_clip', args: { ...seqArg, assetId: song, start: T.ZERO, duration: fr(frames) } }]).doc;
  }
  if (r() < 0.15) { const t = doc.sequences[seqId]!.tracks.find((x) => x.kind === 'video')!; doc = tx(doc, [{ op: 'update_track', args: { ...seqArg, trackId: t.id, locked: true } }]).doc; }
  return { doc, rate, frames, assets: [sound, still], seqId };
}
/** Random taps: bursts of key mashing, holds, taps past the end. */
function taps(seed: number, seconds: number, count: number): Tap[] {
  const r = rng(seed * 31 + 1);
  return Array.from({ length: count }, () => { const down = Math.round(r() * (seconds + 1) * 1000) / 1000; return { pad: Math.floor(r() * PAD_COUNT), down, up: down + (r() < 0.2 ? r() * 2 : r() * 0.2) }; });
}
const assetsFor = (bank: PadBank, w: World) => bank.map((m) => (m?.kind === 'sound' ? w.assets[0]! : m?.kind === 'sticker' ? w.assets[1]! : null));

describe('properties of the planner (through the real apply_take)', () => {
  it('for 200 random documents the planned arguments apply and leave a document that passes validateProject', () => {
    let kept = 0, held = 0;
    const seen = new Map<string, number>(), reasons = new Set<string>();
    for (let s = 1; s <= 200; s++) {
      const w = world(s), r = rng(s * 7);
      const bank = [...defaultBank(r() < 0.5 ? 'canvas' : 'gpu')];
      if (r() < 0.3) bank[s % PAD_COUNT] = move('move.beat-strobe');
      if (r() < 0.2) bank[(s + 3) % PAD_COUNT] = null;
      const settings: QuantiseSettings = { snap: (['off', 'beat', 'half'] as const)[s % 3]!, tempo: (['half', 'normal', 'double'] as const)[(s >> 2) % 3]!, strength: Math.round(r() * 100) / 100, parity: (s & 1) as 0 | 1 };
      const grid = performGrid(w.doc, settings, w.seqId);
      const seconds = T.toSeconds(T.frameTime(w.frames, w.rate));
      const hits = quantiseTaps(taps(s, seconds, 5 + Math.floor(r() * 80)), grid, settings, w.rate, bank);
      const input = { ...(w.seqId !== w.doc.mainSequenceId ? { sequenceId: w.seqId } : {}), hits, bank, assets: assetsFor(bank, w), settings, gpu: r() < 0.5 };
      const plan = planPerformance(w.doc, input);
      expect(plan.chips.length).toBeLessThanOrEqual(hits.length);
      kept += plan.chips.filter((c) => c.state === 'kept').length; held += plan.chips.filter((c) => c.state === 'held').length;
      if (!plan.args) continue;
      for (const step of plan.args.steps) { expect((TAKE_STEP_OPS as readonly string[]).includes(step.op), step.op).toBe(true); seen.set(step.op, (seen.get(step.op) ?? 0) + 1); }
      for (const c of plan.chips) if (c.reason) reasons.add(c.reason);
      if (plan.args.steps.some((st) => st.op === 'add_adjustment' && JSON.stringify(st.args).includes('light.strobe'))) seen.set('strobe', (seen.get('strobe') ?? 0) + 1);
      const after = tx(w.doc, [{ op: 'apply_take', args: plan.args }]).doc;
      expect(validateProject(after), `document ${s}`).toEqual([]);
      // a second take on top of the first (lanes reused, earlier changes of light respected)
      if (s % 5 === 0) {
        const again = planPerformance(after, { ...input, hits: quantiseTaps(taps(s + 1000, seconds, 30), grid, settings, w.rate, bank) });
        if (again.args) expect(validateProject(tx(after, [{ op: 'apply_take', args: again.args }]).doc), `second take ${s}`).toEqual([]);
      }
      // the same input plans byte-identically
      expect(JSON.stringify(planPerformance(structuredClone(w.doc), input).args)).toBe(JSON.stringify(plan.args));
    }
    expect(kept).toBeGreaterThan(1000);
    expect(held).toBeGreaterThan(100);
    // every kind of step was exercised, and the common reasons to hold
    for (const op of ['add_track', 'add_adjustment', 'set_effect_keyframe', 'set_keyframe', 'replace_clip_keyframes', 'add_clip', 'add_text', 'set_clip_transform', 'apply_motion_preset', 'strobe']) expect(seen.get(op) ?? 0, op).toBeGreaterThan(0);
    for (const why of ['flash_limit', 'needs_gpu', 'no_picture', 'has_motion', 'outside_edit', 'no_music']) expect(reasons.has(why), why).toBe(true);
  });

  for (const rate of RATES) {
    const fps = rate.num / rate.den;
    it(`at ${Number(fps.toFixed(3))} fps kept changes of light keep the gap from each other and from those already there`, () => {
      const gap = flashGapFrames(fps);
      const bank: PadBank = [move('move.black-white'), move('move.colour-split'), move('move.confetti'), move('move.title-wow'), move('move.sticker-star'), move('move.speed-lines'), move('move.blur-hit'), move('move.punch')];
      let checked = 0;
      for (let s = 1; s <= 30; s++) {
        const w = world(s * 101, rate);
        const seconds = T.toSeconds(T.frameTime(w.frames, w.rate));
        const settings: QuantiseSettings = { snap: 'off', tempo: 'normal', strength: 1, parity: 0 };
        // key mashing: 20 taps a second alternating pads
        const mash: Tap[] = Array.from({ length: Math.floor(seconds * 20) }, (_, i) => ({ pad: i % 6, down: i / 20, up: i / 20 + 0.02 }));
        const hits = quantiseTaps(mash, [], settings, w.rate, bank);
        const input = { ...(w.seqId !== w.doc.mainSequenceId ? { sequenceId: w.seqId } : {}), hits, bank, assets: assetsFor(bank, w), settings, gpu: false };
        const plan = planPerformance(w.doc, input);
        if (!plan.args) continue;
        const before = new Set(clipsOf(w.doc, w.seqId).map((c) => c.id));
        const after = tx(w.doc, [{ op: 'apply_take', args: plan.args }]).doc; // the op re-checks the rule and would throw
        const made = new Set(clipsOf(after, w.seqId).map((c) => c.id).filter((id) => !before.has(id)));
        const all = lightChanges(after, made, w.seqId);
        const mine = all.filter((c) => made.has(c.clipId));
        const ranges = lightRanges(after, w.seqId);
        for (const c of mine) {
          for (const o of all) if (o !== c && !(o.clipId === c.clipId && c.kind !== 'key' && o.kind === 'key')) expect(Math.abs(o.frame - c.frame), `${c.clipId}@${c.frame} vs ${o.clipId}@${o.frame}`).toBeGreaterThanOrEqual(gap);
          for (const x of ranges) expect(c.frame < x.from - gap || c.frame >= x.to + gap).toBe(true);
          expect(c.frames).toBeGreaterThanOrEqual(gap);
          checked++;
        }
        // every held flash_limit says how close it came
        for (const c of plan.chips) if (c.reason === 'flash_limit') expect(typeof c.since).toBe('number');
      }
      expect(checked).toBeGreaterThan(20);
    });
  }

  it('a zoom punch changes nothing outside [a, b): every other frame of the clip samples the same before and after', () => {
    const bank: PadBank = [move('move.punch'), { ...(move('move.punch') as Extract<MoveSpec, { kind: 'punch' }>), id: 'move.punch-big', scale: 1.6, releaseSeconds: 0.3 }, null, null, null, null, null, null];
    let punched = 0;
    for (let s = 1; s <= 60; s++) {
      const w = world(s * 13 + 5), r = rng(s);
      const seconds = T.toSeconds(T.frameTime(w.frames, w.rate));
      const settings: QuantiseSettings = { snap: 'off', tempo: 'normal', strength: 1, parity: 0 };
      const t = taps(s * 3, seconds, 10 + Math.floor(r() * 30)).map((x) => ({ ...x, pad: x.pad % 2 }));
      const hits = quantiseTaps(t, [], settings, w.rate, bank);
      const plan = planPerformance(w.doc, { ...(w.seqId !== w.doc.mainSequenceId ? { sequenceId: w.seqId } : {}), hits, bank, assets: Array(PAD_COUNT).fill(null), settings, gpu: false });
      if (!plan.args) continue;
      const after = tx(w.doc, [{ op: 'apply_take', args: plan.args }]).doc;
      // the hits each clip took, from the scale steps: [a, b) clip-local (a − 1 carries the rest value when a is not the first frame)
      const hitsOn = new Map<string, [number, number][]>();
      for (const st of plan.args.steps) {
        const a = st.args as { clipId: string; property: string; keys: { value: number }[]; from: T.RationalTime; to: T.RationalTime };
        if (st.op !== 'replace_clip_keyframes' || a.property !== 'scale') continue;
        const from = T.frameIndexAt(a.from, w.rate), to = T.frameIndexAt(a.to, w.rate);
        const la = a.keys[0]!.value === a.keys.at(-1)!.value ? from + 1 : from;
        hitsOn.set(a.clipId, [...(hitsOn.get(a.clipId) ?? []), [la, to]]);
      }
      const value = (c: Clip, p: 'x' | 'y' | 'scale', local: number) => (c.keyframes?.[p]?.length ? sampleKeyframes(c.keyframes[p]!, T.frameTime(local, w.rate), TRANSFORM_RANGE[p]) : c.transform[p]);
      for (const c0 of clipsOf(w.doc, w.seqId)) {
        const c1 = clipsOf(after, w.seqId).find((c) => c.id === c0.id)!;
        const mine = hitsOn.get(c0.id) ?? [];
        if (!mine.length) { expect(JSON.stringify(c1)).toBe(JSON.stringify(c0)); continue; }
        punched++;
        const len = T.frameIndexAt(c0.duration, w.rate);
        for (let k = 0; k < len; k++) for (const p of ['x', 'y', 'scale'] as const) {
          if (mine.some(([a, b]) => k >= a && k < b)) continue;
          expect(value(c1, p, k), `clip ${c0.id} ${p} at ${k}`).toBe(value(c0, p, k));
        }
        // inside each hit the zoom is there from its first frame
        for (const [a] of mine) expect(value(c1, 'scale', a)).toBeGreaterThan(value(c0, 'scale', a));
      }
    }
    expect(punched).toBeGreaterThan(20);
  });
});
