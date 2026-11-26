/**
 * Keeps the Hebrew wording of the sound-effect refusals (packages/i18n/src/refusals.ts, AUDIO_FX_REFUSAL_PATTERNS) in step with
 * the operations' own messages (ADR-0010): each refusal is provoked for real, and every pattern must be provoked by one case.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, OpError, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { AUDIO_FX_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `fw${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm' }, provenance: prov };

describe('Hebrew wording of the sound-effect refusals', () => {
  it('every sound-effect refusal is recognised and worded in Hebrew, and every pattern is provoked', () => {
    let r = tx(createProject({ id: 'prj_fw', name: 'W' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: music } }], true);
    const [vid, mus] = r.results.map((x) => x.output!.assetId as string);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(60) } }, { op: 'add_clip', args: { assetId: mus, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }]);
    const picture = r.results[0]!.output!.clipId as string, sound = r.results[0]!.output!.audioClipId as string, song = r.results[1]!.output!.clipId as string, title = r.results[2]!.output!.clipId as string;
    const d = r.doc;
    const echo = tx(d, [{ op: 'add_audio_effect', args: { clipId: song, type: 'space.echo' } }, { op: 'add_audio_effect', args: { clipId: song, type: 'voice.robot' } }]).doc;
    const echoId = (findClip(echo, song)!.clip as MediaClip).audioFx![0]!.id;
    const kept = tx(d, [{ op: 'set_clip_pitch', args: { clipId: song, keepPitch: true } }, { op: 'set_clip_speed', args: { clipId: song, speed: 2 } }]).doc;
    const full = structuredClone(d);
    (findClip(full, song)!.clip as MediaClip).audioFx = Array.from({ length: 8 }, (_, i) => ({ id: `afx_f${i}`, type: `future.fx${i}`, enabled: true, params: {} }));
    // a picture linked to two sound clips: its own, and the song beside it
    const twoSounds = tx(d, [{ op: 'unlink_clip', args: { clipId: picture } }, { op: 'link_clips', args: { clipIds: [picture, sound, song] } }, { op: 'add_audio_effect', args: { clipId: song, type: 'voice.radio', includeLinked: false } }]).doc;
    const cases: [string, ProjectDocument, OpCall[]][] = [
      ['a title has no sound', d, [{ op: 'add_audio_effect', args: { clipId: title, type: 'voice.robot' } }]],
      ['an effect that does not exist', d, [{ op: 'add_audio_effect', args: { clipId: song, type: 'voice.chipmunk' } }]],
      ['parameters out of range', d, [{ op: 'add_audio_effect', args: { clipId: song, type: 'space.echo', params: { delayMs: 5000 } } }]],
      ['the same effect twice', echo, [{ op: 'add_audio_effect', args: { clipId: song, type: 'space.echo' } }]],
      ['a second character voice', echo, [{ op: 'add_audio_effect', args: { clipId: song, type: 'voice.radio' } }]],
      ['a full list', full, [{ op: 'add_audio_effect', args: { clipId: song, type: 'tone.bassboost' } }]],
      ['effects on a sound that keeps its pitch at double speed', kept, [{ op: 'add_audio_effect', args: { clipId: song, type: 'space.echo' } }]],
      ['a gradual speed change of a sound with effects', echo, [{ op: 'set_clip_speed_ramp', args: { clipId: song, from: 1, to: 2 } }]],
      ['an effect id that is not on the clip', echo, [{ op: 'update_audio_effect', args: { clipId: song, effectId: 'afx_none', enabled: false } }]],
      ['an update that changes nothing', echo, [{ op: 'update_audio_effect', args: { clipId: song, effectId: echoId } }]],
      ['a preset that does not exist', d, [{ op: 'apply_audio_preset', args: { clipId: song, presetId: 'chipmunk' } }]],
      ['clearing a clip without effects', d, [{ op: 'apply_audio_preset', args: { clipId: song, presetId: null } }]],
      ['copying from a clip without effects', d, [{ op: 'copy_audio_effects', args: { fromClipId: sound, toClipIds: [song] } }]],
      ['copying a clip onto itself', echo, [{ op: 'copy_audio_effects', args: { fromClipId: song, toClipIds: [song] } }]],
      ['copying from a picture with two sounds', twoSounds, [{ op: 'copy_audio_effects', args: { fromClipId: picture, toClipIds: [title] } }]],
    ];
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops] of cases) {
      let message = '';
      try { tx(doc, ops); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      AUDIO_FX_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) matched.add(i); });
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(AUDIO_FX_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
  });
});
