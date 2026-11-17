/**
 * Voice cleanup and colour match contracts in core (ADR-0013, ADR-0014): the noise-profile codec, the strength table, the cleanup
 * registry rows and their catalogue text, and the two operations clean_voice and set_colour_grade (success, refusals, exact undo).
 * Core only: no engine is loaded, so tailSeconds is null.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, audioEffectParams, CLEANUP_TYPES, cleanVoiceEffects, createProject, creativeProjection, decodeNoiseProfile, describeAudioCatalog, diffEntities, encodeNoiseProfile, findAudioEffect, findClip,
  GENERIC_NOISE_PROFILE, NOISE_BAND_EDGES_HZ, NOISE_BANDS, NOISE_PROFILE_PATTERN, OpError, restoreEntities, sortAudioFx, validateProject, type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `vc${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const voice = { kind: 'audio' as const, name: 'voice.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };

/** A picture with its linked sound (0–4 s), a voice clip on its own track (0–6 s) and a title. */
function project() {
  let r = tx(createProject({ id: 'prj_vc', name: 'vc' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: voice } }], true);
  const [vid, vox] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(120) } },
    { op: 'add_clip', args: { assetId: vox, start: f(0), duration: f(180) } },
    { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } },
  ]);
  const o = r.results.map((x) => x.output!);
  return { doc: r.doc, voiceAsset: vox!, picture: o[0]!.clipId as string, sound: o[0]!.audioClipId as string, voice: o[1]!.clipId as string, title: o[2]!.clipId as string };
}
const clipOf = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const fxOf = (d: ProjectDocument, id: string) => clipOf(d, id).audioFx ?? [];
/** One undo, as the store does it: the step's entity changes applied backwards restore the document exactly. */
function undone(before: ProjectDocument, after: ProjectDocument): ProjectDocument {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return back;
}

describe('noise profile codec (ADR-0013 D4)', () => {
  it('24 ERB-spaced bands from 50 Hz to 20 kHz', () => {
    expect(NOISE_BANDS).toBe(24);
    expect(NOISE_BAND_EDGES_HZ.length).toBe(25);
    expect([NOISE_BAND_EDGES_HZ[0], NOISE_BAND_EDGES_HZ[24]]).toEqual([50, 20000]);
    for (let j = 1; j < 25; j++) expect(NOISE_BAND_EDGES_HZ[j]!).toBeGreaterThan(NOISE_BAND_EDGES_HZ[j - 1]!);
  });
  it('round-trips in 0.05 dB steps, 48 base64url characters, high 6 bits first; clamps to 0..−140 dB', () => {
    const bands = Array.from({ length: 24 }, (_, j) => -20 - j * 3.35);
    const s = encodeNoiseProfile(bands);
    expect(s).toMatch(NOISE_PROFILE_PATTERN);
    expect(decodeNoiseProfile(s)).toEqual(bands.map((b) => -Math.round(-b * 20) / 20));
    expect(encodeNoiseProfile(Array(24).fill(0))).toBe('A'.repeat(48));
    expect(encodeNoiseProfile(Array(24).fill(-0.05))).toBe('AB'.repeat(24));
    expect(encodeNoiseProfile(Array(24).fill(-3.2))).toBe('BA'.repeat(24)); // code 64: the high character carries 64
    expect(decodeNoiseProfile(encodeNoiseProfile(Array(24).fill(-500)))).toEqual(Array(24).fill(-140));
    expect(decodeNoiseProfile(encodeNoiseProfile(Array(24).fill(6)))).toEqual(Array(24).fill(0));
    expect(decodeNoiseProfile('A'.repeat(48)).every((v) => Object.is(v, 0))).toBe(true); // never −0
  });
  it('refuses a wrong band count, a non-finite level and a string that is not a profile', () => {
    expect(() => encodeNoiseProfile(Array(23).fill(-60))).toThrow(/24 bands/);
    expect(() => encodeNoiseProfile([...Array(23).fill(-60), Number.NaN])).toThrow(/finite/);
    for (const bad of ['', 'A'.repeat(47), 'A'.repeat(49), `${'A'.repeat(47)}=`, `${'A'.repeat(47)}+`]) expect(() => decodeNoiseProfile(bad)).toThrow(/not a noise profile/);
  });
  it('the generic profile is a −70 dB floor in every band and is the denoise default', () => {
    expect(decodeNoiseProfile(GENERIC_NOISE_PROFILE)).toEqual(Array(24).fill(-70));
    expect(audioEffectParams('cleanup.denoise', {}).profile).toBe(GENERIC_NOISE_PROFILE);
  });
});

describe('strength table (cleanVoiceEffects)', () => {
  it('0 gives nothing; otherwise dehum only with a mains frequency, then denoise and speech, every set valid for the registry', () => {
    expect(cleanVoiceEffects({ strength: 0, mainsHz: '50' })).toEqual([]);
    const all = cleanVoiceEffects({ strength: 0.6, mainsHz: '50', profile: GENERIC_NOISE_PROFILE, source: 'ast_1' });
    expect(all.map((e) => e.type)).toEqual([...CLEANUP_TYPES]);
    expect(all[0]!.params).toEqual({ amount: 1, mainsHz: '50', harmonics: 4, width: 0.5 });
    expect(all[1]!.params).toEqual({ amount: 1, reductionDb: 14.4, sensitivityDb: 0.6, profile: GENERIC_NOISE_PROFILE, source: 'ast_1' });
    expect(all[2]!.params).toEqual({ amount: 1, lowCutHz: 80, presence: 0.5, levelDb: 8.4, targetDb: -20, ceilingDb: -1 });
    for (const e of all) expect(audioEffectParams(e.type, e.params)).toEqual(e.params);
    expect(cleanVoiceEffects({ strength: 0.8, mainsHz: '60' })[0]!.params.harmonics).toBe(6);
    expect(cleanVoiceEffects({ strength: 0.6 }).map((e) => e.type)).toEqual(['cleanup.denoise', 'cleanup.speech']);
    expect(cleanVoiceEffects({ strength: 0.6, mainsHz: null, denoise: false }).map((e) => e.type)).toEqual(['cleanup.speech']);
    expect(cleanVoiceEffects({ strength: 0.6, speech: false }).map((e) => e.type)).toEqual(['cleanup.denoise']);
    expect(cleanVoiceEffects({ strength: 0.6 })[0]!.params.source).toBe('');
    expect(() => cleanVoiceEffects({ strength: 1.5 })).toThrow(RangeError);
  });
  it('monotone in strength, never −0, and valid at every strength', () => {
    let prev: ReturnType<typeof cleanVoiceEffects> | null = null;
    for (let k = 1; k <= 100; k++) {
      const s = k / 100, cur = cleanVoiceEffects({ strength: s, mainsHz: '50' });
      for (const e of cur) { expect(audioEffectParams(e.type, e.params)).toEqual(e.params); for (const v of Object.values(e.params)) if (typeof v === 'number') expect(Object.is(v, -0)).toBe(false); }
      if (prev) for (const [j, key] of [[1, 'reductionDb'], [1, 'sensitivityDb'], [2, 'presence'], [2, 'levelDb'], [0, 'harmonics']] as const) expect(cur[j]!.params[key] as number).toBeGreaterThanOrEqual(prev[j]!.params[key] as number);
      prev = cur;
    }
  });
});

describe('cleanup registry rows and catalogue (ADR-0013)', () => {
  it('the three cleanup effects come first, in stage 2, before the bass boost; dry at amount 0', () => {
    for (const type of CLEANUP_TYPES) { const d = findAudioEffect(type)!; expect([d.stage, d.category, d.maxTailSeconds, d.exclusive]).toEqual([2, 'cleanup', 0, undefined]); expect(d.isIdentity(audioEffectParams(type, { amount: 0 }))).toBe(true); }
    expect(sortAudioFx([{ id: 'a', type: 'tone.bassboost', enabled: true, params: {} }, { id: 'b', type: 'cleanup.speech', enabled: true, params: {} }, { id: 'c', type: 'cleanup.dehum', enabled: true, params: {} }, { id: 'd', type: 'cleanup.denoise', enabled: true, params: {} }]).map((x) => x.id)).toEqual(['c', 'd', 'b', 'a']);
  });
  it('the catalogue states the look-ahead per effect; the other effects keep "none (0 samples)"', () => {
    const cat = describeAudioCatalog().audioEffects;
    const by = (id: string) => cat.find((e) => e.id === id)!;
    expect([by('cleanup.dehum').aheadMs, by('cleanup.denoise').aheadMs, by('cleanup.speech').aheadMs, by('space.echo').aheadMs]).toEqual([0, 50, 250, 0]);
    expect(by('cleanup.speech').latency).toMatch(/reads up to 250 ms ahead and compensates it/);
    expect(by('cleanup.dehum').latency).toBe('none (0 samples)');
    expect(by('voice.robot').latency).toBe('none (0 samples)');
    expect(by('cleanup.denoise').limits).toMatch(/not yet listened to/);
  });
  it('a profile param must be a profile', () => {
    expect(() => audioEffectParams('cleanup.denoise', { profile: 'x' })).toThrow();
    expect(() => audioEffectParams('cleanup.denoise', { profile: encodeNoiseProfile(Array(24).fill(-50)), source: 'x'.repeat(65) })).toThrow();
  });
});

describe('clean_voice', () => {
  const profile = encodeNoiseProfile(Array.from({ length: 24 }, (_, j) => -50 - j));
  it('sets the three cleanup effects first, keeps the other sound effects, and reports them', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.voice, type: 'space.reverb' } }, { op: 'clean_voice', args: { clipId: p.voice, strength: 0.6, profile, source: p.voiceAsset, mainsHz: '50' } }]);
    expect(fxOf(a.doc, p.voice).map((x) => x.type)).toEqual(['cleanup.dehum', 'cleanup.denoise', 'cleanup.speech', 'space.reverb']);
    expect(fxOf(a.doc, p.voice)[1]!.params).toEqual({ amount: 1, reductionDb: 14.4, sensitivityDb: 0.6, profile, source: p.voiceAsset });
    const out = a.results[1]!.output as { effects: { clipId: string; effectId: string; type: string }[]; removed: unknown[]; tailSeconds: number | null };
    expect(out.effects.map((e) => [e.clipId, e.type])).toEqual(CLEANUP_TYPES.map((t) => [p.voice, t]));
    expect(out.effects.every((e) => /^afx_/.test(e.effectId))).toBe(true);
    expect(out.removed).toEqual([]);
    expect(out.tailSeconds).toBeNull();
    expect(validateProject(a.doc)).toEqual([]);
  });
  it('again: the cleanup is replaced in place with the same ids and turned on; a type no longer wanted is removed; strength 0 removes it all', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'clean_voice', args: { clipId: p.voice, strength: 0.6, profile, mainsHz: '50' } }]);
    const ids = fxOf(a.doc, p.voice).map((x) => x.id);
    const off = tx(a.doc, [{ op: 'update_audio_effect', args: { clipId: p.voice, effectId: ids[1]!, enabled: false } }]).doc;
    const b = tx(off, [{ op: 'clean_voice', args: { clipId: p.voice, strength: 0.9, profile, mainsHz: null } }]);
    expect(fxOf(b.doc, p.voice).map((x) => [x.id, x.type, x.enabled])).toEqual([[ids[1], 'cleanup.denoise', true], [ids[2], 'cleanup.speech', true]]);
    expect(fxOf(b.doc, p.voice)[0]!.params.reductionDb).toBe(18.6);
    expect((b.results[0]!.output as { removed: unknown[] }).removed).toEqual([{ clipId: p.voice, effectId: ids[0], type: 'cleanup.dehum' }]);
    const c = tx(tx(b.doc, [{ op: 'add_audio_effect', args: { clipId: p.voice, type: 'voice.robot' } }]).doc, [{ op: 'clean_voice', args: { clipId: p.voice, strength: 0 } }]);
    expect(fxOf(c.doc, p.voice).map((x) => x.type)).toEqual(['voice.robot']);
    expect(c.results[0]!.summary).toBe('Removed the voice cleanup');
  });
  it('a picture clip cleans the sound linked to it; one undo restores the document exactly', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'clean_voice', args: { clipId: p.picture } }]);
    expect(a.results[0]!.affectedIds).toEqual([p.sound]);
    expect(fxOf(a.doc, p.sound).map((x) => x.type)).toEqual(['cleanup.denoise', 'cleanup.speech']); // default strength 0.6, no hum found
    expect(fxOf(a.doc, p.sound)[0]!.params.profile).toBe(GENERIC_NOISE_PROFILE);
    expect(clipOf(a.doc, p.picture).audioFx).toBeUndefined();
    expect(diffEntities(p.doc, a.doc).every((c) => c.id.startsWith('clip:') || c.id.includes(p.sound))).toBe(true);
    expect(creativeProjection(undone(p.doc, a.doc))).toBe(creativeProjection(p.doc));
  });
  it('refuses a full list, a sound that keeps its pitch at another speed (with its way out), a title, a bad profile and a bad strength', () => {
    const p = project();
    const full = tx(p.doc, ['voice.robot', 'texture.8bit', 'space.echo', 'space.reverb', 'utility.width', 'tone.bassboost'].map((type) => ({ op: 'add_audio_effect', args: { clipId: p.voice, type } })));
    const e = refusal(() => tx(full.doc, [{ op: 'clean_voice', args: { clipId: p.voice, mainsHz: '50' } }]));
    expect([e.code, e.message]).toEqual(['out_of_bounds', 'a clip can carry at most 8 sound effects']);
    expect(fxOf(tx(full.doc, [{ op: 'clean_voice', args: { clipId: p.voice } }]).doc, p.voice).length).toBe(8); // two more fit
    const kept = tx(p.doc, [{ op: 'set_clip_pitch', args: { clipId: p.voice, keepPitch: true } }, { op: 'set_clip_speed', args: { clipId: p.voice, speed: 2 } }]).doc;
    const k = refusal(() => tx(kept, [{ op: 'clean_voice', args: { clipId: p.voice } }]));
    expect(k.code).toBe('incompatible');
    expect(k.hint).toMatch(/set_clip_pitch keepPitch=false/);
    expect(refusal(() => tx(p.doc, [{ op: 'clean_voice', args: { clipId: p.title } }])).code).toBe('incompatible');
    expect(refusal(() => tx(p.doc, [{ op: 'clean_voice', args: { clipId: p.voice, profile: 'short' } }])).code).toBe('invalid_args');
    expect(refusal(() => tx(p.doc, [{ op: 'clean_voice', args: { clipId: p.voice, strength: 1.5 } }])).code).toBe('invalid_args');
    expect(refusal(() => tx(p.doc, [{ op: 'clean_voice', args: { clipId: 'clp_nope' } }])).code).toBe('not_found');
  });
});

describe('set_colour_grade (ADR-0014)', () => {
  const gradeOf = (d: ProjectDocument, id: string) => clipOf(d, id).effects?.find((e) => e.type === 'color.grade');
  it('adds a grade first (after a time effect) with the defaults for values not given; a second call replaces it in place', () => {
    const p = project();
    const withTime = tx(p.doc, [{ op: 'add_effect', args: { clipId: p.picture, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId: p.picture, type: 'time.echo' } }]).doc;
    const a = tx(withTime, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 0.4, temperature: -0.2 } } }]);
    expect(clipOf(a.doc, p.picture).effects!.map((e) => e.type)).toEqual(['time.echo', 'color.grade', 'blur.gaussian']);
    const g = gradeOf(a.doc, p.picture)!;
    expect(g.params).toEqual({ exposure: 0.4, temperature: -0.2, tint: 0, contrast: 1, saturation: 1, shadows: 0, highlights: 0, fade: 0 });
    expect(a.results[0]!.output).toEqual({ effectId: g.id, params: g.params, droppedKeyframes: [] });
    const off = tx(a.doc, [{ op: 'update_effect', args: { clipId: p.picture, effectId: g.id, enabled: false } }]).doc;
    const b = tx(off, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { tint: 0.1 } } }]);
    expect([gradeOf(b.doc, p.picture)!.id, gradeOf(b.doc, p.picture)!.enabled, gradeOf(b.doc, p.picture)!.params.exposure, gradeOf(b.doc, p.picture)!.params.tint]).toEqual([g.id, true, 0, 0.1]);
    const m = tx(a.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { tint: 0.1 }, mode: 'merge' } }]);
    expect(gradeOf(m.doc, p.picture)!.params).toMatchObject({ exposure: 0.4, temperature: -0.2, tint: 0.1 });
    expect(validateProject(m.doc)).toEqual([]);
    expect(creativeProjection(undone(p.doc, tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 1 } } }]).doc))).toBe(creativeProjection(p.doc));
  });
  it('refuses keyframed values unless dropKeyframes, which removes exactly those keyframes', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 0.2 } } }]);
    const id = gradeOf(a.doc, p.picture)!.id;
    const keyed = tx(a.doc, [{ op: 'set_effect_keyframe', args: { clipId: p.picture, effectId: id, param: 'exposure', time: f(0), value: 0 } }, { op: 'set_effect_keyframe', args: { clipId: p.picture, effectId: id, param: 'exposure', time: f(30), value: 1 } }, { op: 'set_effect_keyframe', args: { clipId: p.picture, effectId: id, param: 'fade', time: f(0), value: 0.2 } }]).doc;
    const e = refusal(() => tx(keyed, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { temperature: 0.3 } } }]));
    expect([e.code, e.message, e.details.params]).toEqual(['incompatible', 'these colour values are animated with keyframes, so a fixed setting would be ignored', ['exposure', 'fade']]);
    expect(e.hint).toMatch(/dropKeyframes=true/);
    // merge touches only the given values: an animated value not given keeps its animation
    const merged = tx(keyed, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { temperature: 0.3 }, mode: 'merge' } }]);
    expect(Object.keys(gradeOf(merged.doc, p.picture)!.keyframes!).sort()).toEqual(['exposure', 'fade']);
    expect(refusal(() => tx(keyed, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { fade: 0.1 }, mode: 'merge' } }])).details.params).toEqual(['fade']);
    const dropped = tx(keyed, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { fade: 0.1 }, mode: 'merge', dropKeyframes: true } }]);
    expect(Object.keys(gradeOf(dropped.doc, p.picture)!.keyframes!)).toEqual(['exposure']);
    expect((dropped.results[0]!.output as { droppedKeyframes: string[] }).droppedKeyframes).toEqual(['fade']);
    const all = tx(keyed, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 0.5 }, dropKeyframes: true } }]);
    expect(gradeOf(all.doc, p.picture)!.keyframes).toBeUndefined();
    expect(gradeOf(all.doc, p.picture)!.params.exposure).toBe(0.5);
  });
  it('refuses out-of-range values, unknown values, a sound clip and a full effect list', () => {
    const p = project();
    const r = refusal(() => tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { saturation: 3 } } }]));
    expect([r.code, r.message]).toEqual(['invalid_args', 'invalid parameters for color.grade: saturation']);
    expect(refusal(() => tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { gamma: 1 } } }])).code).toBe('invalid_args');
    expect(refusal(() => tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.sound, params: {} } }])).code).toBe('incompatible');
    const full = tx(p.doc, Array.from({ length: 16 }, () => ({ op: 'add_effect', args: { clipId: p.picture, type: 'blur.gaussian' } }))).doc;
    expect(refusal(() => tx(full, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: {} } }])).code).toBe('out_of_bounds');
  });
});
