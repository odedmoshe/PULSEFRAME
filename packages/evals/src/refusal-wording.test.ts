/**
 * Keeps the Hebrew wording of common refusals (packages/i18n/src/refusals.ts) in step with the server's own messages:
 * each refusal is provoked for real through the operations, and its message must be recognised.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `w${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };

describe('Hebrew wording of common refusals', () => {
  it('every refusal provoked here is recognised and worded in Hebrew; patterns that are not provoked are listed', () => {
    let r = tx(createProject({ id: 'prj_w', name: 'W' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
    const assetId = r.results[0]!.output!.assetId as string, stillId = r.results[1]!.output!.assetId as string;
    // two clips of the middle of the source, touching: 1 s..3 s at frames 0..60 and 3 s..5 s at frames 60..120
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(30), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(90), duration: f(60) } }, { op: 'add_clip', args: { assetId: stillId, start: f(300), duration: f(30) } }, { op: 'add_marker', args: { time: f(10) } }]);
    const a = (r.results[0]!.output as any).clipId as string, aSound = (r.results[0]!.output as any).audioClipId as string, b = (r.results[1]!.output as any).clipId as string, bSound = (r.results[1]!.output as any).audioClipId as string, pic = (r.results[2]!.output as any).clipId as string;
    const d = r.doc;
    const vTrack = Object.values(d.sequences)[0]!.tracks.find((t) => t.kind === 'video')!.id;
    const locked = tx(d, [{ op: 'update_track', args: { trackId: vTrack, locked: true } }]).doc;
    const ramped = tx(d, [{ op: 'delete_clip', args: { clipId: b } }, { op: 'set_clip_speed_ramp', args: { clipId: a, from: 1, to: 2 } }]).doc;
    const kept = tx(d, [{ op: 'set_clip_pitch', args: { clipId: aSound, keepPitch: true } }]).doc;
    // a clip that plays the very end of the source (6 s..8 s), followed directly by another: nothing is left after it for a transition
    const tail = tx(d, [{ op: 'add_clip', args: { assetId, start: f(120), sourceIn: f(180), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(180), duration: f(60) } }]);
    const cases: [string, ProjectDocument, OpCall[]][] = [
      ['a move onto another clip', d, [{ op: 'move_clip', args: { clipId: a, start: f(30), includeLinked: false } }]],
      ['an edit on a locked track', locked, [{ op: 'delete_clip', args: { clipId: a } }]],
      ['a trim to nothing', d, [{ op: 'trim_clip', args: { clipId: a, edge: 'end', to: f(0) } }]],
      ['a trim to nothing at the start', d, [{ op: 'trim_clip', args: { clipId: a, edge: 'start', to: f(60) } }]],
      ['extending past the end of the source', tx(d, [{ op: 'move_clip', args: { clipId: b, start: f(400) } }]).doc, [{ op: 'trim_clip', args: { clipId: b, edge: 'end', to: f(700) } }]],
      ['extending before the start of the source', tx(d, [{ op: 'move_clip', args: { clipId: a, start: f(500) } }]).doc, [{ op: 'trim_clip', args: { clipId: a, edge: 'start', to: f(400) } }]],
      ['a slip too far', d, [{ op: 'slip_clip', args: { clipId: a, by: f(200) } }]],
      ['reversing a ramped clip', ramped, [{ op: 'set_clip_reverse', args: { clipId: a, reverse: true } }]],
      ['a ramp between equal speeds', d, [{ op: 'set_clip_speed_ramp', args: { clipId: a, from: 2, to: 2 } }]],
      ['a speed on a still picture', d, [{ op: 'set_clip_speed', args: { clipId: pic, speed: 2 } }]],
      ['a volume key outside the clip', d, [{ op: 'set_volume_keyframe', args: { clipId: aSound, time: f(90), value: 1 } }]],
      ['a transition longer than the clip', d, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 100 } }]],
      ['a transition without enough spare source', tail.doc, [{ op: 'set_transition', args: { clipId: (tail.results[1]!.output as any).clipId as string, type: 'dissolve', frames: 20 } }]],
      ['forwards when already forwards', d, [{ op: 'set_clip_reverse', args: { clipId: a, reverse: false } }]],
      ['removing a file in use', d, [{ op: 'remove_asset', args: { assetId } }]],
      ['splitting at scenes without an analysis', d, [{ op: 'split_at_scenes', args: { clipId: a } }]],
      ['a second marker on a frame', d, [{ op: 'add_marker', args: { time: f(10) } }]],
      ['fades longer than the clip', d, [{ op: 'set_clip_fades', args: { clipId: aSound, fadeIn: f(50), fadeOut: f(50) } }]],
      ['a crossfade with nothing before', d, [{ op: 'set_audio_crossfade', args: { clipId: aSound, duration: f(10) } }]],
      ['a ramp on a sound that keeps its pitch', kept, [{ op: 'set_clip_speed_ramp', args: { clipId: a, from: 1, to: 2 } }]],
      ['pitch follows speed when it already does', d, [{ op: 'set_clip_pitch', args: { clipId: aSound, keepPitch: false } }]],
      ['a copy before the start', d, [{ op: 'duplicate_clips', args: { clipIds: [a], offset: T.sub(T.ZERO, f(30)) } }]],
      ['a freeze of a ramped clip', ramped, [{ op: 'freeze_frame', args: { clipId: a, at: f(10), duration: f(30) } }]],
    ];
    void bSound;
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops] of cases) {
      let message = '';
      try { tx(doc, ops); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) matched.add(i); });
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    // patterns for refusals this test does not provoke (they come from the importer, or need a longer set-up); listed so that a new pattern is either provoked or named here
    const notProvoked = REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source);
    expect(notProvoked.sort()).toEqual([
      '^a freeze frame has no speed$',
      '^remove the transition at this clip first$',
      '^the clip is too short for this change of speed at the end of its source$',
      '^the file could not be read as video, sound or a picture$',
      '^this clip is already a freeze frame$',
    ].sort());
    expect(translateRefusal('he', 'something the table does not know')).toBeUndefined();
  });
});
