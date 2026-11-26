/**
 * The booth's scene builder (wave 8 booth): real ops, the REAL test-picture hashes, one deterministic document per item.
 * (Exporter.plan accepting it is a server test: apps/server/src/booth/media.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { BOOTH_FIRST_TRANSITIONS, GPU_EFFECT_IDS, GPU_TRANSITION_IDS, OP_ONLY_EFFECTS, validateProject } from '../index.ts';
import { BOOTH_SCENE_H, BOOTH_SCENE_W, boothScene } from './scene.ts';

const pics = { a: { contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1234 }, b: { contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 2345 } };

describe('boothScene', () => {
  it('a transition: picture a then b, the transition on b, the still in its middle, play 56–78', () => {
    const s = boothScene({ route: 'scene', scene: 'transition', id: 'film-burn' }, pics);
    const doc = s.doc;
    expect(doc.settings.width).toBe(BOOTH_SCENE_W);
    expect(doc.settings.height).toBe(BOOTH_SCENE_H);
    expect(Object.values(doc.assets).map((x) => [x.contentHash, x.byteSize])).toEqual([[pics.a.contentHash, 1234], [pics.b.contentHash, 2345]]);
    const clips = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips;
    expect(clips.length).toBe(2);
    expect((clips[1] as { transition?: { type: string } }).transition?.type).toBe('film-burn');
    expect(s.still).toBe(67);
    expect(s.play).toEqual({ first: 56, count: 23 });
    expect(validateProject(doc)).toEqual([]);
    expect(JSON.stringify(boothScene({ route: 'scene', scene: 'transition', id: 'film-burn' }, pics))).toBe(JSON.stringify(s));
  });
  it('every GPU transition and effect builds; an unknown id or a fake hash throws', () => {
    for (const id of GPU_TRANSITION_IDS) boothScene({ route: 'scene', scene: 'transition', id }, pics);
    // an effect only its own op adds (livingContract OP_ONLY_EFFECTS: «תמונה חיה») is never a booth scene: the booth lists it as content-dependent
    for (const id of GPU_EFFECT_IDS.filter((x) => !Object.hasOwn(OP_ONLY_EFFECTS, x))) expect(boothScene({ route: 'scene', scene: 'effect', id }, pics).still).toBe(id === 'light.strobe' ? 1 : 12);
    expect(boothScene({ route: 'scene', scene: 'transition', id: 'flash' }, pics).still).toBe(64);
    expect(() => boothScene({ route: 'scene', scene: 'transition', id: 'nope' }, pics)).toThrow();
    expect(() => boothScene({ route: 'scene', scene: 'effect', id: 'film-burn' }, pics)).toThrow();
    expect(() => boothScene({ route: 'scene', scene: 'effect', id: 'light.glow' }, { ...pics, a: { contentHash: 'sha256:aaaa', byteSize: 1 } })).toThrow();
    expect(BOOTH_FIRST_TRANSITIONS.length).toBe(7);
  });
});
