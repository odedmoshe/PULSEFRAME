import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, EASINGS, timeline, transformAt, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, describeMoment, evaluate, kernelFor, resolveDirection, soundAt, soundTailsOf, type AudioPlan, type PlannedAudioClip, type VideoLayer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
function project() {
  const asset = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: { num: 30000, den: 1001 }, codec: 'h264', rotation: 0, frameCount: 119 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' } };
  const a = applyTransaction(createProject({ id: 'p', name: 'p' }), [{ op: 'import_asset', args: { asset } }], { idSeed: 'a', actor: 't', allowInternal: true });
  const assetId = a.results[0]!.output!.assetId as string;
  return applyTransaction(a.doc, [
    { op: 'add_clip', args: { assetId, start: f(30), sourceIn: T.rt(1, 1), duration: f(60) } },
    { op: 'add_text', args: { text: 'שלום', start: f(45), duration: f(15) } },
  ], { idSeed: 'b', actor: 't' }).doc;
}
describe('evaluate', () => {
  it('uses half-open clip intervals and exact source mapping across differing rates', () => {
    const doc = project();
    expect(evaluate(doc, f(29)).layers).toEqual([]);
    const g = evaluate(doc, f(30));
    expect(g.layers.map((l) => l.kind)).toEqual(['video']);
    const v = g.layers[0]!;
    // sourceTime 1s at 30000/1001 fps -> floor(29.97) = frame 29
    expect(v.kind === 'video' && v.sourceFrameIndex).toBe(29);
    expect(evaluate(doc, f(45)).layers.map((l) => l.kind)).toEqual(['video', 'text']);
    expect(evaluate(doc, f(60)).layers.map((l) => l.kind)).toEqual(['video']);
    expect(evaluate(doc, f(90)).layers).toEqual([]);
    expect(evaluate(doc, f(30)).audio.length).toBe(1);
  });
  it('random access equals sequential evaluation (stateless)', () => {
    const doc = project();
    const seq = Array.from({ length: 100 }, (_, i) => JSON.stringify(evaluate(doc, f(i))));
    for (const i of [77, 3, 45, 30, 89, 0]) expect(JSON.stringify(evaluate(doc, f(i)))).toBe(seq[i]);
  });
  it('resolves paragraph direction from the first strong character', () => {
    expect(resolveDirection('שלום world', 'auto')).toBe('rtl');
    expect(resolveDirection('123 שלום', 'auto')).toBe('rtl');
    expect(resolveDirection('Hello שלום', 'auto')).toBe('ltr');
    expect(resolveDirection('שלום', 'ltr')).toBe('ltr');
  });
});

describe('animated layers', () => {
  it('evaluate applies keyframes per frame and is identical for random and sequential access', () => {
    let doc = project();
    const text = doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips[0]!;
    doc = applyTransaction(doc, [
      { op: 'set_keyframe', args: { clipId: text.id, property: 'y', time: f(0), value: 0.4 } },
      { op: 'set_keyframe', args: { clipId: text.id, property: 'y', time: f(10), value: -0.1, easing: 'ease-out' } },
      { op: 'set_keyframe', args: { clipId: text.id, property: 'opacity', time: f(0), value: 0 } },
      { op: 'set_keyframe', args: { clipId: text.id, property: 'opacity', time: f(5), value: 1 } },
    ], { idSeed: 'k', actor: 't' }).doc;
    const layer = (frame: number) => evaluate(doc, f(frame)).layers.find((l) => l.kind === 'text')!;
    expect(layer(45).transform).toMatchObject({ y: 0.4, opacity: 0 });
    expect(layer(50).transform.y).toBeCloseTo(0.15, 10);
    expect(layer(50).transform.opacity).toBe(1);
    expect(layer(55).transform.y).toBeCloseTo(-0.1, 10);
    const seq = Array.from({ length: 15 }, (_, i) => JSON.stringify(layer(45 + i).transform));
    for (const i of [14, 0, 7, 3, 11]) expect(JSON.stringify(layer(45 + i).transform)).toBe(seq[i]);
  });
});

describe('keyframe curves in the evaluator (ADR-0019)', () => {
  /** Keys with every easing (a custom curve with handles that turn back, too) on x, scale and rotation of both clips. */
  function curved() {
    let doc = project();
    const tracks = doc.sequences.seq_main!.tracks;
    const video = tracks.find((t) => t.kind === 'video')!.clips[0]!, text = tracks.find((t) => t.kind === 'text')!.clips[0]!;
    const ops = [video, text].flatMap((c) => EASINGS.flatMap((easing, i) => (['x', 'scale', 'rotation'] as const).map((property) => ({
      op: 'set_keyframe', args: { clipId: c.id, property, time: f(i * 4), value: property === 'scale' ? 1 + (i % 3) * 0.4 : property === 'rotation' ? (i % 2 ? 30 : -15) : (i % 2 ? 0.3 : -0.2), easing, ...(easing === 'bezier' ? { bezier: [0.2, -0.6, 0.7, 1.7] } : {}) },
    }))));
    doc = applyTransaction(doc, ops, { idSeed: 'kc', actor: 't' }).doc;
    return { doc, videoId: video.id, textId: text.id };
  }
  it('random access equals sequential evaluation with every easing', () => {
    const { doc } = curved();
    const seq = Array.from({ length: 100 }, (_, i) => JSON.stringify(evaluate(doc, f(i))));
    const order = Array.from({ length: 100 }, (_, i) => (i * 37) % 100);
    for (const i of order) expect(JSON.stringify(evaluate(doc, f(i))), `frame ${i}`).toBe(seq[i]);
    // the curves do move the layers (not one static transform)
    expect(new Set(seq.slice(30, 90)).size).toBeGreaterThan(40);
  });
  it('each shutter tap equals transformAt at that tap\'s time', () => {
    const c = curved();
    const doc = applyTransaction(c.doc, [{ op: 'add_effect', args: { clipId: c.videoId, type: 'time.shutter', params: { samples: 8 } } }], { idSeed: 'ks', actor: 't' }).doc;
    const clip = doc.sequences.seq_main!.tracks.find((t) => t.kind === 'video')!.clips[0]!;
    let taps = 0;
    for (let fr = 30; fr < 90; fr++) {
      const layer = evaluate(doc, f(fr)).layers.find((l): l is VideoLayer => l.kind === 'video' && l.clipId === clip.id)!;
      expect(layer.time?.type).toBe('time.shutter');
      for (const tap of layer.time!.taps) {
        const want = transformAt(clip, tap.time);
        for (const p of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) expect(Object.is(tap.layer.transform[p], want[p]), `frame ${fr} ${p}`).toBe(true);
        taps++;
      }
    }
    expect(taps).toBe(60 * 8);
  });
});

describe('sound effects in the agent senses (ADR-0010)', () => {
  const SR = 48000;
  /** A planned clip of 1 s at 2 s with a 1.5 s tail, as the plan gives it to every route. */
  const planned = (clipId: string, at: number, length: number, tail: number, cutFrom?: number): PlannedAudioClip => ({
    clipId, trackId: 'trk_a', assetId: 'ast_a', at, length, source: 0, speed: 1, gain: 1, pan: 0, fade: [{ s: 0, g: 1 }, { s: length, g: 1 }], duck: [{ s: 0, g: 1 }, { s: length + tail, g: 1 }],
    voice: { chain: [{ id: 'afx_1', type: 'voice.robot', version: 1, stage: 3, params: {}, seed: 0 }, { id: 'afx_2', type: 'space.echo', version: 1, stage: 4, params: {}, seed: 0 }], sourceIn: { value: '0', timescale: 1 }, sourceEnd: { value: '1', timescale: 1 }, speed: { num: 1, den: 1 }, reverse: false, sourceRate: SR, warmWindow: 0, warmRing: 0, aheadWindow: 0, tail, ...(cutFrom !== undefined ? { cutFrom } : {}) },
  });
  const plan = (clips: PlannedAudioClip[]): AudioPlan => ({ sampleRate: SR, totalSamples: 10 * SR, clips, loudness: null, cutTails: [], missingFx: [] });
  it('lists the effects of each planned clip and the clips heard only through their tail, with the seconds since their end', () => {
    const p = plan([planned('clp_a', 2 * SR, SR, 1.5 * SR), { ...planned('clp_b', 0, SR, 0), voice: undefined }]);
    const inBody = soundAt(p, 2.5 * SR, new Set(['clp_a']));
    expect(inBody.fx.get('clp_a')).toEqual(['voice.robot', 'space.echo']);
    expect(inBody.fx.has('clp_b')).toBe(false); // no effects: no voice in the plan
    expect(inBody.tails).toEqual([]); // the body covers the moment: it is an ordinary audio entry, not a tail
    expect(soundAt(p, 3.25 * SR, new Set()).tails).toEqual([{ clipId: 'clp_a', trackId: 'trk_a', assetId: 'ast_a', tail: true, secondsAfterEnd: 0.25, fx: ['voice.robot', 'space.echo'] }]);
    expect(soundAt(p, 3 * SR, new Set()).tails.map((x) => x.secondsAfterEnd)).toEqual([0]); // the first sample after the end is tail
    expect(soundAt(p, 4.5 * SR - 1, new Set()).tails.length).toBe(1);
    expect(soundAt(p, 4.5 * SR, new Set()).tails).toEqual([]); // soundEnd is exclusive
    expect(soundAt(p, 1.9 * SR, new Set()).tails).toEqual([]); // before the clip
    expect(soundAt(plan([planned('clp_c', 0, SR, 0)]), SR, new Set()).tails).toEqual([]); // a voice without a ring stage has no tail
  });
  it('describe_moment gives every audio entry its effects; loading the engine connects the planned tails to core timeline()', () => {
    const doc = project();
    const m = describeMoment(doc, f(40));
    expect(m.audio.length).toBe(1);
    expect(m.audio[0]).toMatchObject({ fx: [] });
    const sound = timeline(doc)!.tracks.flatMap((t) => t.clips).find((c) => c.id === m.audio[0]!.clipId) as Record<string, unknown>;
    expect(sound.tailSeconds).toBe(0); // a number, measured by the engine's plan (core on its own says null)
    expect(soundTailsOf(doc).size).toBe(0);
  });
  // Runs once the kernels (W2) and the voice plan (W1) are in the tree; until then the interim plan has no voices to look at.
  it.skipIf(!kernelFor('space.echo', 1))('an echo heard after its clip ends shows as a tail entry in describe_moment and as tailSeconds in timeline()', () => {
    let doc: ProjectDocument = project();
    const sound = doc.sequences.seq_main!.tracks.find((t) => t.kind === 'audio')!.clips[0]!;
    doc = applyTransaction(doc, [
      { op: 'add_audio_effect', args: { clipId: sound.id, type: 'space.echo', params: { delayMs: 250, repeats: 4 } } },
      { op: 'add_text', args: { text: 'סוף', start: f(90), duration: f(90) } }, // the programme runs on 3 s past the clip end, so the 1 s tail is not cut
    ], { idSeed: 'e', actor: 't' }).doc;
    const p = audioPlan(doc).clips.find((c) => c.clipId === sound.id)!;
    expect(p.voice?.tail).toBe(4 * Math.round(0.25 * doc.settings.sampleRate));
    const after = describeMoment(doc, f(105)); // half a second after the clip end (frame 90)
    expect(after.audio).toEqual([expect.objectContaining({ clipId: sound.id, tail: true, fx: ['space.echo'] })]);
    expect((after.audio[0] as { secondsAfterEnd: number }).secondsAfterEnd).toBeCloseTo(0.5, 3);
    expect(describeMoment(doc, f(130)).audio).toEqual([]); // past the tail
    expect(timeline(doc)!.tracks.flatMap((t) => t.clips).find((c) => c.id === sound.id)).toMatchObject({ tailSeconds: 1 });
  });
});

describe('time effects leave other documents alone (ADR-0011)', () => {
  it('a clip without a time effect, or whose first enabled effect is not one, gets no taps and no remap; its effects stay in order', () => {
    let doc = project();
    const track = doc.sequences.seq_main!.tracks.find((t) => t.kind === 'video')!;
    const clipId = track.clips[0]!.id;
    doc = applyTransaction(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'time.echo' } }], { idSeed: 'te', actor: 't' }).doc;
    const layer = evaluate(doc, f(40)).layers[0]!;
    expect(layer.kind === 'video' && [layer.time?.type, layer.effects?.map((e) => e.type)]).toEqual(['time.echo', ['blur.gaussian']]);
    // an older document that holds a time effect after another one (validation reports time_effect_order): not applied
    const old = structuredClone(doc);
    const c = old.sequences.seq_main!.tracks.find((t) => t.kind === 'video')!.clips[0]!;
    if (c.type === 'media') c.effects = [...c.effects!].reverse();
    const l2 = evaluate(old, f(40)).layers[0]!;
    expect(l2.kind === 'video' && [l2.time, l2.remap, l2.effects?.map((e) => e.type)]).toEqual([undefined, undefined, ['blur.gaussian', 'time.echo']]);
    // no effect at all: the layer has neither key
    const plain = evaluate(project(), f(40)).layers[0]!;
    expect('time' in plain || 'remap' in plain).toBe(false);
    const text = evaluate(project(), f(50)).layers.find((l) => l.kind === 'text')!;
    expect('time' in text || 'remap' in text).toBe(false);
  });
});
