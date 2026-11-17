/**
 * Sound-effect operations (ADR-0010; plan sections 6 and 9, W3): every op's success and refusals, linked targeting, the preset as
 * one undoable step, fresh ids on copy, effects kept by split and speed_ramp, the validation codes, and the explicit refusals of
 * the speed and pitch operations. Core only: no engine is loaded here, so op outputs report tailSeconds null unless a test
 * connects a measure (see queries.ts provideSoundTails).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, AUDIO_EFFECTS, AUDIO_PRESETS, audioEffectParams, createProject, creativeProjection, describeAudioCatalog, diffEntities, findClip, OpError, provideSoundTails, sortAudioFx, timeline,
  validateProject, type Clip, type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `afx${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };

/** A picture with its linked sound (0–4 s), a music clip of its own (0–6 s, another track), a still and a title. */
function project() {
  let r = tx(createProject({ id: 'prj_afx', name: 'afx' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: still } }], true);
  const [vid, mus, pic] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(120) } },
    { op: 'add_clip', args: { assetId: mus, start: f(0), duration: f(180) } },
    { op: 'add_clip', args: { assetId: pic, start: f(200), duration: f(30) } },
    { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } },
  ]);
  const o = r.results.map((x) => x.output!);
  return { doc: r.doc, picture: o[0]!.clipId as string, sound: o[0]!.audioClipId as string, music: o[1]!.clipId as string, still: o[2]!.clipId as string, title: o[3]!.clipId as string };
}
const clipOf = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const fxOf = (d: ProjectDocument, id: string) => (clipOf(d, id).audioFx ?? []);
const typesOf = (d: ProjectDocument, id: string) => fxOf(d, id).map((x) => x.type);

afterEach(() => provideSoundTails(null));

describe('add_audio_effect', () => {
  it('adds an effect with its defaults to a sound clip, keeps the list in processing order, and leaves the picture alone', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.reverb', params: { room: 'cave' } } }, { op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.telephone' } }, { op: 'add_audio_effect', args: { clipId: p.music, type: 'tone.bassboost', enabled: false } }]);
    expect(typesOf(a.doc, p.music)).toEqual(['tone.bassboost', 'voice.telephone', 'space.reverb']); // stage 2, 3, 4 whatever the order of adding
    expect(fxOf(a.doc, p.music)[2]!.params).toEqual(audioEffectParams('space.reverb', { room: 'cave' }));
    expect(fxOf(a.doc, p.music)[0]!.enabled).toBe(false);
    const out = a.results[0]!.output as { effects: { clipId: string; effectId: string; params: Record<string, unknown> }[]; tailSeconds: number | null };
    expect(out.effects).toEqual([{ clipId: p.music, effectId: fxOf(a.doc, p.music)[2]!.id, params: fxOf(a.doc, p.music)[2]!.params }]);
    expect(out.effects[0]!.effectId).toMatch(/^afx_/);
    expect(out.tailSeconds).toBeNull(); // core alone has no engine to plan the tail
    expect(validateProject(a.doc)).toEqual([]);
    expect(sortAudioFx(fxOf(a.doc, p.music))).toEqual(fxOf(a.doc, p.music));
  });
  it('a picture clip resolves to the sound linked to it; with includeLinked=false it has no sound of its own', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.picture, type: 'voice.robot' } }]);
    expect(typesOf(a.doc, p.sound)).toEqual(['voice.robot']);
    expect(clipOf(a.doc, p.picture).audioFx).toBeUndefined();
    expect(a.results[0]!.affectedIds).toEqual([p.sound]);
    const e = refusal(() => tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.picture, type: 'voice.robot', includeLinked: false } }]));
    expect([e.code, e.message]).toEqual(['incompatible', 'this clip has no sound clip']);
    expect(e.hint).toMatch(/includeLinked/);
    // a title, a still and a clip that does not exist have no sound
    for (const id of [p.title, p.still]) expect(refusal(() => tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: id, type: 'voice.robot' } }])).code).toBe('incompatible');
    expect(refusal(() => tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: 'clp_nope', type: 'voice.robot' } }])).code).toBe('not_found');
  });
  it('refuses an unknown effect, bad parameters, a second effect of a type, a second character voice and a full list, each with a way out', () => {
    const p = project();
    const unknown = refusal(() => tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.chipmunk' } }]));
    expect(unknown.code).toBe('not_found');
    expect(unknown.hint).toMatch(/list_catalog/);
    expect(unknown.details.available).toEqual(AUDIO_EFFECTS.map((e) => e.id));
    const bad = refusal(() => tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo', params: { delayMs: 5000 } } }]));
    expect(bad.code).toBe('invalid_args');
    expect((bad.details.issues as unknown[]).length).toBeGreaterThan(0);
    expect(refusal(() => tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo', params: { delay: 200 } } }])).code).toBe('invalid_args'); // unknown names are refused, not ignored
    const once = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo' } }, { op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.radio' } }]).doc;
    const twice = refusal(() => tx(once, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo' } }]));
    expect([twice.code, twice.message]).toEqual(['invalid_args', 'this clip already has the sound effect space.echo']);
    expect(twice.hint).toMatch(/update_audio_effect/);
    const voice = refusal(() => tx(once, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.megaphone' } }]));
    expect([voice.code, voice.message]).toEqual(['invalid_args', 'this clip already has a character voice (voice.radio)']);
    expect(voice.hint).toMatch(/apply_audio_preset/);
    // eight entries (from a later build: types this build does not know) fill the list; the refusal comes before validation
    const full = structuredClone(p.doc);
    clipOf(full, p.music).audioFx = Array.from({ length: 8 }, (_, i) => ({ id: `afx_future${i}`, type: `future.fx${i}`, enabled: true, params: {} }));
    expect(refusal(() => tx(full, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'tone.bassboost' } }])).code).toBe('out_of_bounds');
  });
  it('refuses a locked sound track, but a picture on a locked track does not stop an edit of its unlocked sound', () => {
    const p = project();
    const tracks = p.doc.sequences[p.doc.mainSequenceId]!.tracks;
    const soundTrack = tracks.find((t) => t.clips.some((c) => c.id === p.sound))!.id, pictureTrack = tracks.find((t) => t.clips.some((c) => c.id === p.picture))!.id;
    const lockedSound = tx(p.doc, [{ op: 'update_track', args: { trackId: soundTrack, locked: true } }]).doc;
    expect(refusal(() => tx(lockedSound, [{ op: 'add_audio_effect', args: { clipId: p.picture, type: 'voice.robot' } }])).code).toBe('track_locked');
    const lockedPicture = tx(p.doc, [{ op: 'update_track', args: { trackId: pictureTrack, locked: true } }]).doc;
    expect(typesOf(tx(lockedPicture, [{ op: 'add_audio_effect', args: { clipId: p.picture, type: 'voice.robot' } }]).doc, p.sound)).toEqual(['voice.robot']);
  });
  it('refuses a sound that keeps its pitch at another speed, or changes speed gradually (wave-1 limit), with a hint', () => {
    const p = project();
    const kept = tx(p.doc, [{ op: 'set_clip_pitch', args: { clipId: p.music, keepPitch: true } }, { op: 'set_clip_speed', args: { clipId: p.music, speed: 2 } }]).doc;
    const e = refusal(() => tx(kept, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo' } }]));
    expect([e.code, e.message]).toEqual(['incompatible', 'this sound keeps its pitch at another speed or changes speed gradually, so it cannot carry sound effects yet']);
    expect(e.hint).toMatch(/set_clip_pitch keepPitch=false/);
    // turned off, the effect may stay on such a clip (validation checks enabled effects only)
    expect(typesOf(tx(kept, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo', enabled: false } }]).doc, p.music)).toEqual(['space.echo']);
    const ramped = tx(p.doc, [{ op: 'set_clip_speed_ramp', args: { clipId: p.music, from: 1, to: 2 } }]).doc;
    expect(refusal(() => tx(ramped, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.robot' } }])).code).toBe('incompatible');
    // keeping the pitch at speed 1 changes nothing, so effects are allowed
    const keptAtOne = tx(p.doc, [{ op: 'set_clip_pitch', args: { clipId: p.music, keepPitch: true } }]).doc;
    expect(typesOf(tx(keptAtOne, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.robot' } }]).doc, p.music)).toEqual(['voice.robot']);
  });
  it('reports the planned tail when an engine has connected its measure', () => {
    const p = project();
    provideSoundTails((doc) => new Map(findClip(doc, p.music) && clipOf(doc, p.music).audioFx?.some((x) => x.type === 'space.echo') ? [[p.music, { seconds: 1.23456, cut: false }]] : []));
    expect((tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo' } }]).results[0]!.output as { tailSeconds: number }).tailSeconds).toBe(1.235);
    expect((tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.robot' } }]).results[0]!.output as { tailSeconds: number }).tailSeconds).toBe(0);
    // a measure that cannot read a draft gives null, never an error that is not a refusal
    provideSoundTails(() => { throw new Error('no plan'); });
    expect((tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo' } }]).results[0]!.output as { tailSeconds: unknown }).tailSeconds).toBeNull();
  });
});

describe('update_audio_effect and remove_audio_effect', () => {
  it('merges parameters, turns an effect off and on, finds an effect through the linked picture, and removes the field with the last effect', () => {
    const p = project();
    const a = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.picture, type: 'space.echo', params: { delayMs: 300 } } }]);
    const id = fxOf(a.doc, p.sound)[0]!.id;
    const b = tx(a.doc, [{ op: 'update_audio_effect', args: { clipId: p.sound, effectId: id, params: { repeats: 6 } } }, { op: 'update_audio_effect', args: { clipId: p.picture, effectId: id, enabled: false } }]);
    expect(fxOf(b.doc, p.sound)[0]).toMatchObject({ id, enabled: false, params: { ...audioEffectParams('space.echo', {}), delayMs: 300, repeats: 6 } });
    expect(b.results[1]!.output).toMatchObject({ enabled: false, effects: [{ clipId: p.sound, effectId: id }] });
    expect(refusal(() => tx(a.doc, [{ op: 'update_audio_effect', args: { clipId: p.sound, effectId: id, params: { repeats: 99 } } }])).code).toBe('invalid_args');
    expect(refusal(() => tx(a.doc, [{ op: 'update_audio_effect', args: { clipId: p.sound, effectId: id } }])).code).toBe('invalid_args');
    const missing = refusal(() => tx(a.doc, [{ op: 'update_audio_effect', args: { clipId: p.music, effectId: id, enabled: false } }]));
    expect(missing.code).toBe('not_found');
    expect(missing.hint).toMatch(/get_timeline/);
    // enabling an effect again on a sound that now keeps its pitch at another speed is refused with the same reason as adding
    const kept = tx(b.doc, [{ op: 'set_clip_pitch', args: { clipId: p.sound, keepPitch: true } }, { op: 'set_clip_speed', args: { clipId: p.picture, speed: 2 } }]).doc;
    expect(refusal(() => tx(kept, [{ op: 'update_audio_effect', args: { clipId: p.sound, effectId: id, enabled: true } }])).code).toBe('incompatible');
    const c = tx(a.doc, [{ op: 'remove_audio_effect', args: { clipId: p.picture, effectId: id } }]);
    expect(clipOf(c.doc, p.sound).audioFx).toBeUndefined();
    expect(c.results[0]!.output).toMatchObject({ clipId: p.sound, effects: [] });
    expect(refusal(() => tx(c.doc, [{ op: 'remove_audio_effect', args: { clipId: p.sound, effectId: id } }])).code).toBe('not_found');
    expect(validateProject(c.doc)).toEqual([]);
  });
});

describe('apply_audio_preset', () => {
  it('replaces the whole list in one operation, and one undo (the before-states restored) gives back the document exactly', () => {
    const p = project();
    const before = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'voice.robot' } }, { op: 'add_audio_effect', args: { clipId: p.music, type: 'utility.width', params: { stereoWidth: 0.2 } } }]).doc;
    const r = tx(before, [{ op: 'apply_audio_preset', args: { clipId: p.music, presetId: 'stadium' } }]);
    expect(r.results.length).toBe(1);
    expect(typesOf(r.doc, p.music)).toEqual(['voice.megaphone', 'space.echo', 'space.reverb']);
    const stadium = AUDIO_PRESETS.find((x) => x.id === 'stadium')!;
    for (const e of stadium.effects) expect(fxOf(r.doc, p.music).find((x) => x.type === e.type)!.params).toEqual(audioEffectParams(e.type, e.params));
    expect((r.results[0]!.output as { effects: unknown[] }).effects.length).toBe(3);
    expect(validateProject(r.doc)).toEqual([]);
    const changes = diffEntities(before, r.doc);
    expect(changes.map((c) => c.id)).toEqual([p.music]);
    const undone = tx(r.doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
    expect(creativeProjection(undone)).toBe(creativeProjection(before));
  });
  it('every preset is valid; null clears; a picture sets its linked sound; unknown presets and clearing nothing are refused', () => {
    const p = project();
    for (const preset of AUDIO_PRESETS) {
      const d = tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.music, presetId: preset.id } }]).doc;
      expect(validateProject(d)).toEqual([]);
      expect(typesOf(d, p.music)).toEqual(sortAudioFx(fxOf(d, p.music)).map((x) => x.type));
      expect(typesOf(d, p.music).length).toBe(preset.effects.length);
    }
    const a = tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.picture, presetId: 'telephone' } }]).doc;
    expect(typesOf(a, p.sound)).toEqual(['voice.telephone']);
    const cleared = tx(a, [{ op: 'apply_audio_preset', args: { clipId: p.sound, presetId: null } }]);
    expect(clipOf(cleared.doc, p.sound).audioFx).toBeUndefined();
    expect(cleared.results[0]!.output).toMatchObject({ presetId: null, effects: [] });
    expect(refusal(() => tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.music, presetId: null } }])).message).toBe('this clip has no sound effects to remove');
    const unknown = refusal(() => tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.music, presetId: 'chipmunk' } }]));
    expect(unknown.code).toBe('not_found');
    expect(unknown.details.available).toEqual(AUDIO_PRESETS.map((x) => x.id));
    expect(refusal(() => tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.music, presetId: '__proto__' } }])).code).toBe('not_found');
  });
});

describe('copy_audio_effects', () => {
  it('copies with fresh ids (so seeded noise differs per clip), replaces or joins the target list, and refuses targets without sound', () => {
    const p = project();
    const src = tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.music, presetId: 'radio' } }, { op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo', params: { repeats: 2 } } }]).doc;
    const withOwn = tx(src, [{ op: 'add_audio_effect', args: { clipId: p.sound, type: 'voice.robot' } }, { op: 'add_audio_effect', args: { clipId: p.sound, type: 'tone.bassboost' } }]).doc;
    const joined = tx(withOwn, [{ op: 'copy_audio_effects', args: { fromClipId: p.music, toClipIds: [p.picture] } }]);
    expect(typesOf(joined.doc, p.sound)).toEqual(['tone.bassboost', 'voice.radio', 'space.echo']); // the voice is replaced by the copied one; the bass boost stays
    const srcIds = new Set(fxOf(src, p.music).map((x) => x.id));
    expect(fxOf(joined.doc, p.sound).filter((x) => x.type !== 'tone.bassboost').every((x) => !srcIds.has(x.id))).toBe(true);
    expect(fxOf(joined.doc, p.sound).find((x) => x.type === 'space.echo')!.params).toEqual(fxOf(src, p.music).find((x) => x.type === 'space.echo')!.params);
    expect((joined.results[0]!.output as { effects: unknown[]; clipIds: string[] })).toMatchObject({ clipIds: [p.sound] });
    expect((joined.results[0]!.output as { effects: unknown[] }).effects.length).toBe(2);
    const replaced = tx(withOwn, [{ op: 'copy_audio_effects', args: { fromClipId: p.music, toClipIds: [p.sound], replace: true } }]).doc;
    expect(typesOf(replaced, p.sound)).toEqual(['voice.radio', 'space.echo']);
    expect(validateProject(replaced)).toEqual([]);
    expect(refusal(() => tx(src, [{ op: 'copy_audio_effects', args: { fromClipId: p.music, toClipIds: [p.title] } }])).code).toBe('incompatible');
    expect(refusal(() => tx(src, [{ op: 'copy_audio_effects', args: { fromClipId: p.music, toClipIds: [p.still] } }])).code).toBe('incompatible');
    expect(refusal(() => tx(src, [{ op: 'copy_audio_effects', args: { fromClipId: p.music, toClipIds: [p.music] } }])).message).toBe('a clip cannot take its own sound effects');
    expect(refusal(() => tx(src, [{ op: 'copy_audio_effects', args: { fromClipId: p.sound, toClipIds: [p.music] } }])).message).toBe('the clip to copy from has no sound effects');
    expect(refusal(() => tx(src, [{ op: 'copy_audio_effects', args: { fromClipId: p.music, toClipIds: Array.from({ length: 201 }, () => p.sound) } }])).code).toBe('invalid_args');
  });
});

describe('effects through other edits', () => {
  it('split_clip and speed_ramp copy the effects to every part with the same ids (seeded noise runs on across the cut)', () => {
    const p = project();
    const d = tx(p.doc, [{ op: 'apply_audio_preset', args: { clipId: p.picture, presetId: 'radio' } }]).doc;
    const id = fxOf(d, p.sound)[0]!.id;
    const s = tx(d, [{ op: 'split_clip', args: { clipId: p.picture, at: f(60) } }]);
    const parts = s.doc.sequences[s.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c): c is MediaClip => c.type === 'media' && !!c.audioFx);
    expect(parts.length).toBe(2);
    for (const c of parts) expect(c.audioFx!.map((x) => x.id)).toEqual([id]);
    expect(validateProject(s.doc)).toEqual([]);
    const ramp = tx(d, [{ op: 'speed_ramp', args: { clipId: p.picture, from: 1, to: 2, steps: 3 } }]);
    const steps = ramp.doc.sequences[ramp.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'audio' && t.clips.some((c) => c.id === p.sound))!.clips;
    expect(steps.length).toBe(3);
    for (const c of steps as Clip[]) expect(c.type === 'media' && c.audioFx?.map((x) => x.id)).toEqual([id]);
    expect(validateProject(ramp.doc)).toEqual([]);
  });
  it('the gradual-speed and pitch operations refuse a sound with effects, with a hint, before validation has to', () => {
    const p = project();
    const d = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.picture, type: 'space.reverb' } }]).doc;
    const ramp = refusal(() => tx(d, [{ op: 'set_clip_speed_ramp', args: { clipId: p.picture, from: 1, to: 2 } }]));
    expect([ramp.code, ramp.message]).toEqual(['incompatible', 'this sound has sound effects, which cannot follow a gradual change of speed or a stretch that keeps the pitch yet']);
    expect(ramp.hint).toMatch(/apply_audio_preset with presetId null/);
    const curve = refusal(() => tx(d, [{ op: 'apply_speed_curve', args: { clipId: p.picture, preset: 'hero' } }]));
    expect(curve.code).toBe('incompatible');
    expect(curve.hint).toMatch(/update_audio_effect enabled=false/);
    // a curve without gradual changes plays at one speed: allowed with effects
    expect(validateProject(tx(d, [{ op: 'apply_speed_curve', args: { clipId: p.picture, points: [{ at: 0, speed: 2 }, { at: 1, speed: 2 }] } }]).doc)).toEqual([]);
    const fast = tx(d, [{ op: 'set_clip_speed', args: { clipId: p.picture, speed: 2 } }]).doc; // pitch follows the speed: allowed
    const pitch = refusal(() => tx(fast, [{ op: 'set_clip_pitch', args: { clipId: p.sound, keepPitch: true } }]));
    expect(pitch.code).toBe('incompatible');
    expect(pitch.hint).toMatch(/remove its sound effects|Remove its sound effects/i);
    const keptAtOne = tx(d, [{ op: 'set_clip_pitch', args: { clipId: p.sound, keepPitch: true } }]).doc; // at speed 1: allowed
    expect(refusal(() => tx(keptAtOne, [{ op: 'set_clip_speed', args: { clipId: p.picture, speed: 2 } }])).code).toBe('incompatible');
    expect(refusal(() => tx(keptAtOne, [{ op: 'speed_ramp', args: { clipId: p.picture, from: 1, to: 2, steps: 2 } }])).code).toBe('incompatible');
    // turned off, the effects do not stand in the way
    const off = tx(d, [{ op: 'update_audio_effect', args: { clipId: p.sound, effectId: fxOf(d, p.sound)[0]!.id, enabled: false } }]).doc;
    expect(validateProject(tx(off, [{ op: 'set_clip_speed_ramp', args: { clipId: p.picture, from: 1, to: 2 } }]).doc)).toEqual([]);
  });
});

describe('validation of stored sound effects', () => {
  const issueCodes = (mutate: (c: MediaClip) => void) => {
    const p = project();
    const d = structuredClone(p.doc);
    mutate(clipOf(d, p.music));
    return validateProject(d).map((i) => i.code);
  };
  const fx = (type: string, params: Record<string, number | string | boolean> = {}, id = `afx_${type}`) => ({ id, type, enabled: true, params: audioEffectParams(type, params) });
  it('names each rule that a hand-made or older document breaks', () => {
    expect(issueCodes((c) => { c.audioFx = [{ id: 'afx_x', type: 'voice.chipmunk', enabled: true, params: {} }]; })).toContain('unknown_audio_effect');
    expect(issueCodes((c) => { c.audioFx = [{ ...fx('space.echo'), params: { ...fx('space.echo').params, repeats: 40 } }]; })).toContain('audio_effect_params');
    expect(issueCodes((c) => { c.audioFx = [fx('space.echo', {}, 'afx_1'), fx('space.echo', {}, 'afx_2')]; })).toContain('audio_effect_duplicate');
    expect(issueCodes((c) => { c.audioFx = [fx('voice.robot'), fx('voice.radio')]; })).toContain('audio_effect_voice');
    expect(issueCodes((c) => { c.audioFx = [fx('voice.robot')]; c.keepPitch = true; c.speed = { num: 2, den: 1 }; })).toContain('audio_fx_time_map');
    expect(issueCodes((c) => { c.audioFx = [fx('voice.robot')]; c.speedEnd = { num: 2, den: 1 }; })).toContain('audio_fx_time_map');
    expect(issueCodes((c) => { c.audioFx = [{ ...fx('voice.robot'), enabled: false }]; c.speedEnd = { num: 2, den: 1 }; })).not.toContain('audio_fx_time_map');
    expect(issueCodes((c) => { c.audioFx = [fx('voice.robot'), fx('space.reverb')]; })).toEqual([]);
  });
});

describe('agent views', () => {
  it('timeline() lists the sound fields of sound clips, and tracks say whether they are muted', () => {
    const p = project();
    const d = tx(p.doc, [{ op: 'add_audio_effect', args: { clipId: p.music, type: 'space.echo' } }, { op: 'set_clip_fades', args: { clipId: p.music, fadeIn: f(15) } }, { op: 'set_clip_reverse', args: { clipId: p.music, reverse: true } }, { op: 'set_volume_keyframe', args: { clipId: p.music, time: f(10), value: 0.5 } }]).doc;
    const tl = timeline(d)!;
    const c = tl.tracks.flatMap((t) => t.clips).find((x) => x.id === p.music) as Record<string, unknown>;
    expect(c).toMatchObject({ fadeInSeconds: 0.5, fadeOutSeconds: 0, fadeOut: null, reverse: true, keepPitch: false, volumeKeys: 1, tailSeconds: null });
    expect(c.audioFx).toEqual([{ id: fxOf(d, p.music)[0]!.id, type: 'space.echo', enabled: true, params: audioEffectParams('space.echo', {}) }]);
    expect('audioFx' in (tl.tracks.flatMap((t) => t.clips).find((x) => x.id === p.picture) as object)).toBe(false); // pictures have no sound fields
    expect(tl.tracks.every((t) => typeof t.muted === 'boolean')).toBe(true);
    provideSoundTails(() => new Map([[p.music, { seconds: 2.5, cut: true }]]));
    expect(timeline(d)!.tracks.flatMap((t) => t.clips).find((x) => x.id === p.music)).toMatchObject({ tailSeconds: 2.5, tailCutAtEnd: true });
  });
  it('the catalogue describes every sound effect and preset with a JSON schema and its defaults', () => {
    const cat = describeAudioCatalog();
    expect(cat.audioEffects.map((e) => e.id)).toEqual(AUDIO_EFFECTS.map((e) => e.id));
    for (const e of cat.audioEffects) { expect((e.paramsSchema as { type: string }).type).toBe('object'); expect(audioEffectParams(e.id, e.defaults)).toEqual(e.defaults); }
    expect(cat.audioPresets.map((x) => x.id)).toEqual(AUDIO_PRESETS.map((x) => x.id));
  });
});
