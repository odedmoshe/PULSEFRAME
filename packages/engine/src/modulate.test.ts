/**
 * Beat modulators (modulate.ts, ADR-0011): value = clamp(base + depth·e^(−decay·since), min, max), with `since` the seconds
 * since the last hit of the music under the clip (every Nth beat counted from the first bar start). The beat positions here
 * come from core's beatPositionAt on a document with analysed music, and through `evaluate`, exactly as the renderer gets them.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, beatPositionAt, createProject, findClip, type EffectInstance, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { applyModulators } from './modulate.ts';
import { evaluate } from './evaluate.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `mod${seed++}_`, actor: 'test', allowInternal });
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };

/**
 * Music with a beat every half second from second 1 (bars of four beats, so beat index 0 is at second 1), placed at the
 * timeline start; over it a title with blur.gaussian (radius 0.01) for 10 s. With every = 2 the hits are seconds 1, 2, 3, …
 */
function fixture(withMusic = true) {
  let r = tx(createProject({ id: 'prj_mod', name: 'Mod', frameRate: R }), [{ op: 'import_asset', args: { asset: song } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  const times = Array.from({ length: 100 }, (_, i) => T.rt(1000 + i * 500, 1000));
  r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z', times, bpm: 120, downbeats: times.filter((_, i) => i % 4 === 0), meter: 4 } }], true);
  if (withMusic) r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
  r = tx(r.doc, [{ op: 'add_text', args: { text: 'X', start: f(0), duration: f(300) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 0.01 } } }]);
  const effectId = r.results[0]!.output!.effectId as string;
  return { doc: r.doc, clipId, effectId };
}
const modulate = (doc: ProjectDocument, clipId: string, effectId: string, param: string, modulator: unknown) => tx(doc, [{ op: 'set_effect_modulator', args: { clipId, effectId, param, modulator } }]).doc;
/** The radius the compositor receives for the title's blur on frame `frame`. */
const radiusAt = (doc: ProjectDocument, frame: number) => {
  const layer = evaluate(doc, f(frame)).layers.find((l) => l.kind === 'text') as { effects?: { type: string; params: Record<string, unknown> }[] };
  return layer.effects!.find((e) => e.type === 'blur.gaussian')!.params.radius as number;
};
const instance = (doc: ProjectDocument, clipId: string) => findClip(doc, clipId)!.clip.effects![0]!;

describe('beat modulators', () => {
  it('the value is base + depth·e^(−decay·since) on every frame, and exactly base + depth on the hit frames', () => {
    const { doc, clipId, effectId } = fixture();
    const d = modulate(doc, clipId, effectId, 'radius', { depth: 0.05 }); // every 2, decay 6 by default
    expect(instance(d, clipId).modulate).toEqual({ radius: { by: 'beat', every: 2, depth: 0.05, decay: 6 } });
    for (let frame = 30; frame < 300; frame++) {
      const since = ((frame - 30) % 30) / 30; // hits at seconds 1, 2, 3, …: every second beat from the first bar start
      const want = 0.01 + 0.05 * Math.exp(-6 * since);
      expect(Math.abs(radiusAt(d, frame) - want), `frame ${frame}`).toBeLessThanOrEqual(1e-9);
      // the same through applyModulators with the beat position core gives the renderer
      const beat = beatPositionAt(d, f(frame))!;
      expect(Math.abs((applyModulators(instance(d, clipId), { radius: 0.01 }, beat).radius as number) - want), `frame ${frame}`).toBeLessThanOrEqual(1e-9);
    }
    for (const hit of [30, 60, 90, 120, 270]) expect(Math.abs(radiusAt(d, hit) - 0.06), `hit frame ${hit}`).toBeLessThanOrEqual(1e-9);
    // a beat between two hits (every = 2) is not a hit: half a second after the hit
    expect(Math.abs(radiusAt(d, 45) - (0.01 + 0.05 * Math.exp(-3)))).toBeLessThanOrEqual(1e-9);
  });

  it('every = 1 hits every beat; decay sets how fast it settles; the grid continues before the first beat', () => {
    const { doc, clipId, effectId } = fixture();
    const d = modulate(doc, clipId, effectId, 'radius', { depth: 0.04, every: 1, decay: 12 });
    for (let frame = 0; frame < 120; frame++) {
      const since = (frame % 15) / 15 / 2; // a beat every 15 frames (half a second), continuing back from second 1 to second 0
      expect(Math.abs(radiusAt(d, frame) - (0.01 + 0.04 * Math.exp(-12 * since))), `frame ${frame}`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('a keyframed base value is the base the kick is added to', () => {
    const { doc, clipId, effectId } = fixture();
    let d = tx(doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId, param: 'radius', time: f(0), value: 0.01 } }, { op: 'set_effect_keyframe', args: { clipId, effectId, param: 'radius', time: f(300), value: 0.11 } }]).doc;
    d = modulate(d, clipId, effectId, 'radius', { depth: 0.02 });
    for (const frame of [60, 75, 150, 151]) {
      const base = 0.01 + (0.1 * frame) / 300, since = ((frame - 30) % 30) / 30;
      expect(Math.abs(radiusAt(d, frame) - (base + 0.02 * Math.exp(-6 * since))), `frame ${frame}`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('without analysed music (none placed, or its track muted) the parameter keeps its base value', () => {
    const silent = fixture(false);
    const d = modulate(silent.doc, silent.clipId, silent.effectId, 'radius', { depth: 0.05 });
    for (const frame of [0, 30, 45, 60, 299]) expect(radiusAt(d, frame)).toBe(0.01);
    expect(applyModulators(instance(d, silent.clipId), { radius: 0.01 }, null)).toEqual({ radius: 0.01 });
    expect(applyModulators(instance(d, silent.clipId), { radius: 0.01 }, undefined)).toEqual({ radius: 0.01 });
    const loud = fixture();
    let m = modulate(loud.doc, loud.clipId, loud.effectId, 'radius', { depth: 0.05 });
    const audio = m.sequences[m.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')!;
    m = tx(m, [{ op: 'update_track', args: { trackId: audio.id, muted: true } }]).doc;
    for (const frame of [30, 45, 60]) expect(radiusAt(m, frame)).toBe(0.01);
  });

  it('the value is kept inside the parameter\'s range at both ends', () => {
    const { doc, clipId, effectId } = fixture();
    const up = modulate(tx(doc, [{ op: 'update_effect', args: { clipId, effectId, params: { radius: 0.15 } } }]).doc, clipId, effectId, 'radius', { depth: 0.2 });
    expect(radiusAt(up, 30)).toBe(0.2); // 0.35 asked, 0.2 is the most the schema allows
    expect(radiusAt(up, 59)).toBeLessThanOrEqual(0.2);
    expect(radiusAt(up, 59)).toBeGreaterThan(0.15);
    const down = modulate(doc, clipId, effectId, 'radius', { depth: -0.2 });
    expect(radiusAt(down, 30)).toBe(0); // -0.19 asked, 0 is the least
    expect(radiusAt(down, 59)).toBeGreaterThanOrEqual(0);
    expect(radiusAt(down, 59)).toBeLessThan(0.01);
  });

  it('a parameter that may not follow the beat is left alone (a hand-edited or older document)', () => {
    const { doc } = fixture();
    const beat = beatPositionAt(doc, f(30))!;
    expect(beat).not.toBeNull();
    const bright: EffectInstance = { id: 'fx_b', type: 'color.adjust', enabled: true, params: { brightness: 1, contrast: 1, saturation: 1, hue: 0 }, modulate: { brightness: { by: 'beat', every: 1, depth: 2, decay: 6 } } };
    expect(applyModulators(bright, bright.params, beat)).toEqual(bright.params);
    const strobe: EffectInstance = { id: 'fx_s', type: 'light.strobe', enabled: true, params: { rate: 2, amount: 0.6, color: '#FFFFFF', follow: 'steady', every: 1 }, modulate: { amount: { by: 'beat', every: 1, depth: 0.4, decay: 6 } } };
    expect(applyModulators(strobe, strobe.params, beat)).toEqual(strobe.params);
    // on an effect that has a modulatable parameter, only that one moves
    const bulge: EffectInstance = { id: 'fx_g', type: 'distort.bulge', enabled: true, params: { amount: 0.5, radius: 0.35, x: 0.5, y: 0.5 }, modulate: { x: { by: 'beat', every: 1, depth: 0.3, decay: 6 }, amount: { by: 'beat', every: 2, depth: 0.25, decay: 6 }, nothing: { by: 'beat', every: 1, depth: 1, decay: 6 } } };
    const out = applyModulators(bulge, bulge.params, beat);
    expect(out.x).toBe(0.5);
    expect(out.radius).toBe(0.35);
    expect(out.amount).toBeCloseTo(0.75, 9);
    expect('nothing' in out).toBe(false);
  });

  it('is pure and deterministic: inputs are not changed, the same moment gives the same value in any order', () => {
    const { doc, clipId, effectId } = fixture();
    const d = modulate(doc, clipId, effectId, 'radius', { depth: 0.05, every: 1 });
    const fx = instance(d, clipId), before = structuredClone(fx), params = { radius: 0.01 };
    const beat = beatPositionAt(d, f(37))!;
    const a = applyModulators(fx, params, beat), b = applyModulators(fx, params, beat);
    expect(a).toEqual(b);
    expect(a).not.toBe(params);
    expect(params).toEqual({ radius: 0.01 });
    expect(fx).toEqual(before);
    const frames = Array.from({ length: 300 }, (_, i) => i);
    const inOrder = frames.map((n) => radiusAt(d, n));
    const shuffled = [...frames].sort((x, y) => ((x * 7919) % 300) - ((y * 7919) % 300));
    for (const n of shuffled) expect(radiusAt(d, n)).toBe(inOrder[n]);
  });

  it('removing the modulator (null) gives the base value back', () => {
    const { doc, clipId, effectId } = fixture();
    const d = modulate(doc, clipId, effectId, 'radius', { depth: 0.05 });
    expect(radiusAt(d, 30)).not.toBe(0.01);
    const removed = modulate(d, clipId, effectId, 'radius', null);
    expect(instance(removed, clipId).modulate).toBeUndefined();
    expect(radiusAt(removed, 30)).toBe(0.01);
  });
});
