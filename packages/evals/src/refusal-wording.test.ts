/**
 * Keeps the Hebrew wording of common refusals (packages/i18n/src/refusals.ts) in step with the server's own messages:
 * each refusal is provoked for real through the operations, and its message must be recognised.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, effectParams, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { REFUSAL_PATTERNS, TEMPLATE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

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
    // a clip with a time effect, and one with a colour effect whose brightness may not follow the beat
    const echoed = tx(d, [{ op: 'add_effect', args: { clipId: a, type: 'time.echo' } }]).doc;
    const adjusted = tx(d, [{ op: 'add_effect', args: { clipId: a, type: 'color.adjust' } }]);
    const adjustId = adjusted.results[0]!.output!.effectId as string;
    // a blur whose radius may follow the beat, and a date stamp whose text is edited
    const blurred = tx(d, [{ op: 'add_effect', args: { clipId: a, type: 'blur.gaussian' } }]);
    const blurId = blurred.results[0]!.output!.effectId as string;
    const stamped = tx(d, [{ op: 'add_effect', args: { clipId: a, type: 'stylize.date-stamp' } }]);
    const stampId = stamped.results[0]!.output!.effectId as string;
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
      ['a second time effect on a clip', echoed, [{ op: 'add_effect', args: { clipId: a, type: 'time.split' } }]],
      ['brightness following the beat', adjusted.doc, [{ op: 'set_effect_modulator', args: { clipId: a, effectId: adjustId, param: 'brightness', modulator: { depth: 0.5 } } }]],
      ['a beat deeper than the range of the parameter', blurred.doc, [{ op: 'set_effect_modulator', args: { clipId: a, effectId: blurId, param: 'radius', modulator: { depth: 0.5 } } }]],
      ['a date stamp added with letters in its text', d, [{ op: 'add_effect', args: { clipId: a, type: 'stylize.date-stamp', params: { text: 'MAY 5' } } }]],
      ['a date stamp text changed to letters', stamped.doc, [{ op: 'update_effect', args: { clipId: a, effectId: stampId, params: { text: 'abc' } } }]],
      ['an effect value outside its range', d, [{ op: 'add_effect', args: { clipId: a, type: 'blur.gaussian', params: { radius: 5 } } }]],
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
      '^decode_budget: this frame needs more than (\\d+) video decoders$',
      '^remove the transition at this clip first$',
      '^the clip is too short for this change of speed at the end of its source$',
      '^the file could not be read as video, sound or a picture$',
      '^this clip is already a freeze frame$',
    ].sort());
    expect(translateRefusal('he', 'something the table does not know')).toBeUndefined();
  });
  it('the visual wave refusals name the parameter and keep the numbers; the date stamp says which characters its text may hold', () => {
    let r = tx(createProject({ id: 'prj_v', name: 'V' }), [{ op: 'import_asset', args: { asset: video } }], true);
    const assetId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }]);
    const clipId = (r.results[0]!.output as any).clipId as string;
    r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'stylize.date-stamp' } }]);
    const [blurId, stampId] = r.results.map((x) => x.output!.effectId as string);
    const refusal = (ops: OpCall[]) => { try { tx(r.doc, ops); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
    const deep = refusal([{ op: 'set_effect_modulator', args: { clipId, effectId: blurId!, param: 'radius', modulator: { depth: -0.5 } } }]);
    expect([deep.code, deep.message]).toEqual(['out_of_bounds', 'depth -0.5 is larger than the range of radius (0…0.2)']);
    expect(translateRefusal('he', deep.message)).toBe('עומק הפעימה ⁦-0.5⁩ חורג מהטווח כולו של "רדיוס" (⁦0⁩ עד ⁦0.2⁩)');
    // bad text through update_effect and through add_effect, too long or with letters: the refusal names the text
    for (const ops of [
      [{ op: 'update_effect', args: { clipId, effectId: stampId!, params: { text: 'abc' } } }],
      [{ op: 'update_effect', args: { clipId, effectId: stampId!, params: { text: '1'.repeat(21) } } }],
      [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { text: 'MAY 5' } } }],
    ] as OpCall[][]) {
      const e = refusal(ops);
      expect([e.code, e.message]).toEqual(['invalid_args', 'invalid parameters for stylize.date-stamp: text']);
      expect(translateRefusal('he', e.message)).toBe('בטקסט של חותמת התאריך מותרים רק ספרות, רווחים והסימנים ⁦. : \' / -⁩, עד 20 תווים');
    }
    // any other bad value names the parameter, with the effect's own name for it
    const big = refusal([{ op: 'update_effect', args: { clipId, effectId: stampId!, params: { size: 1 } } }]);
    expect(big.message).toBe('invalid parameters for stylize.date-stamp: size');
    expect(translateRefusal('he', big.message)).toBe('הערך של "גובה הספרות" אינו תקין');
    const two = refusal([{ op: 'update_effect', args: { clipId, effectId: stampId!, params: { text: 'x', size: 1 } } }]);
    expect(two.message).toBe('invalid parameters for stylize.date-stamp: text, size');
    expect(translateRefusal('he', two.message)).toBe('הערכים של "טקסט", "גובה הספרות" אינם תקינים');
    const unknown = refusal([{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 0.1, wobble: 1 } } }]);
    expect(unknown.message).toBe('invalid parameters for blur.gaussian: wobble');
    const key = refusal([{ op: 'set_effect_keyframe', args: { clipId, effectId: blurId!, param: 'radius', time: f(10), value: 9 } }]);
    expect(key.message).toBe('invalid parameters for blur.gaussian: radius');
    expect(translateRefusal('he', key.message)).toBe('הערך של "רדיוס" אינו תקין');
    // a refusal that names no parameter still reads in Hebrew
    expect(translateRefusal('he', 'invalid parameters for blur.gaussian')).toBe('ערכי הפרמטרים של האפקט אינם תקינים');
  });
  it('every refusal of adjustment layers, replacing media and applying a template (ADR-0016) is provoked and worded in Hebrew; none of their patterns is left unprovoked', () => {
    const short = { ...video, name: 'short.mp4', contentHash: `sha256:${'6'.repeat(64)}`, duration: T.rt(4, 1), video: { ...video.video, frameCount: 120 } };
    const song = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    const lut = { kind: 'lut' as const, name: 'l.cube', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance: prov };
    let r = tx(createProject({ id: 'prj_a', name: 'A' }), [video, still, short, song, lut].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
    const [assetId, stillId, shortId, songId, lutId] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string];
    const empty = r.doc;
    // A at 0…60 (source 1 s…3 s) and B at 60…120 (source 4 s…6 s) with a dissolve into B; a title; a caption cue; a whole-edit adjustment
    r = tx(r.doc, [
      { op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(30), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(120), duration: f(60) } },
      { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } }, { op: 'add_cue', args: { start: f(0), duration: f(30), text: 'שלום' } },
      { op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } },
    ]);
    const a = (r.results[0]!.output as any).clipId as string, aSound = (r.results[0]!.output as any).audioClipId as string, b = (r.results[1]!.output as any).clipId as string;
    const title = r.results[2]!.output!.clipId as string, cue = r.results[3]!.output!.clipId as string, adj = r.results[4]!.output!.clipId as string, fxTrack = r.results[4]!.output!.trackId as string;
    const d = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 15 } }]).doc;
    const seq = d.mainSequenceId, tracks = d.sequences[seq]!.tracks;
    const vTrack = tracks.find((t) => t.kind === 'video')!.id, aTrack = tracks.find((t) => t.kind === 'audio')!.id;
    const clipOf = (doc: ProjectDocument, id: string) => doc.sequences[seq]!.tracks.flatMap((t) => t.clips.map((c) => ({ c, t }))).find((x) => x.c.id === id)!;
    // an entity state written straight in (restore_entities, internal): what the validation codes see
    const restoreAdjustment = (change: (c: any) => void): OpCall[] => { const x = structuredClone(clipOf(d, adj)); change(x.c); return [{ op: 'restore_entities', args: { targets: [{ id: adj, state: { kind: 'clip', sequenceId: seq, trackId: fxTrack, clip: x.c } }] } }]; };
    const fast = tx(d, [{ op: 'set_clip_speed', args: { clipId: a, speed: 2, includeLinked: false } }]).doc;
    const lockedSound = tx(d, [{ op: 'update_track', args: { trackId: aTrack, locked: true } }]).doc;
    // privacy regions (ADR-0015) on A: fixed, and one that follows a motion track of A's file
    const region = (motionTrackId: string | null) => ({ id: 'rgn_1', motionTrackId, shape: 'ellipse', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0.15, feather: 0.01, style: 'blur', strength: 0.8, color: '#000000', onLoss: 'frame', weakIsLost: true });
    const motionTrack = { id: 'mtk_1', assetId, name: 'face', kind: 'point', from: 0, x: [5000], y: [5000], q: [100], st: [4], origin: { method: 'manual', params: {}, createdAt: 'test', createdBy: 'test', edited: false } };
    const withRegion = (motionTrackId: string | null) => tx(d, [{ op: 'restore_entities', args: { targets: [
      ...(motionTrackId ? [{ id: motionTrackId, state: { kind: 'motionTrack', track: motionTrack } }] : []),
      { id: a, state: { kind: 'clip', sequenceId: seq, trackId: vTrack, clip: { ...clipOf(d, a).c, redact: [region(motionTrackId)] } } },
    ] } }], true).doc;
    const replace = (clipId: string, asset: string, extra: Record<string, unknown> = {}): OpCall[] => [{ op: 'replace_clip_media', args: { clipId, assetId: asset, ...extra } }];
    const template = (ops: unknown[], extra: Record<string, unknown> = {}): OpCall[] => [{ op: 'apply_template', args: { templateId: 'tpl.x', templateVersion: 1, params: {}, steps: [], ops, slots: [], ...extra } }];
    const firstRun = tx(d, template([{ op: 'add_track', args: { kind: 'video' } }]), true);
    const runId = firstRun.results[0]!.output!.runId as string;
    const cases: [string, ProjectDocument, OpCall[], boolean?][] = [
      ['a whole-edit adjustment with nothing to cover', empty, [{ op: 'add_adjustment', args: { span: 'edit' } }]],
      ['a time effect on an adjustment', d, [{ op: 'add_effect', args: { clipId: adj, type: 'time.echo' } }]],
      ['an adjustment on a video track', d, [{ op: 'add_adjustment', args: { span: 'edit', trackId: vTrack } }]],
      ['an adjustment of no length', d, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(0) } } }]],
      ['a speed on an adjustment', d, [{ op: 'set_clip_speed', args: { clipId: adj, speed: 2 } }]],
      ['an adjustment moved sideways', d, [{ op: 'set_clip_transform', args: { clipId: adj, transform: { x: 0.1 } } }]],
      ['an adjustment that would pop in', d, [{ op: 'apply_motion_preset', args: { clipId: adj, presetId: 'motion.in.pop' } }]],
      ['a title moved onto an adjustment track', d, [{ op: 'move_clip', args: { clipId: title, start: f(0), trackId: fxTrack } }]],
      ['a mask on a title', d, [{ op: 'set_clip_mask', args: { clipId: title, mask: { shape: 'ellipse' } } }]],
      ['an effect on a caption cue', d, [{ op: 'add_effect', args: { clipId: cue, type: 'blur.gaussian' } }]],
      ['an adjustment written with a position', d, restoreAdjustment((c) => { c.transform.x = 0.1; }), true],
      ['an adjustment written with a chroma key', d, restoreAdjustment((c) => { c.effects = [...c.effects, { id: 'fx_k', type: 'key.chroma', enabled: true, params: effectParams('key.chroma', {}) }]; }), true],
      ['another file for a title', d, replace(title, assetId)],
      ['a colour table as a clip\'s file', d, replace(a, lutId)],
      ['a sound-only file for a picture', d, replace(a, songId, { linked: 'detach' })],
      ['a still for a picture whose sound follows', d, replace(a, stillId)],
      ['a still for a clip at double speed', fast, replace(a, stillId, { linked: 'detach' })],
      ['a still for a clip with a privacy region', withRegion(null), replace(a, stillId, { linked: 'detach' })],
      ['another file for a clip whose region follows a motion track', withRegion('mtk_1'), replace(a, shortId)],
      ['a source start before the file', d, replace(a, shortId, { sourceIn: T.sub(T.ZERO, f(1)) })],
      ['a file too short from that point', d, replace(a, shortId, { sourceIn: f(90) })],
      ['a file without spare frames for the transition after it', d, replace(a, shortId, { sourceIn: f(55) })],
      ['the same file from the same point', d, replace(a, assetId)],
      ['a linked sound on a locked track', lockedSound, replace(a, shortId)],
      ['a template step that names a later one', d, template([{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30), trackId: { $ref: 'later', out: 'trackId' } } }]), true],
      ['a template step that is not a public operation', d, template([{ op: 'import_asset', args: { asset: still } }]), true],
      ['a template slot that names no clip', d, template([{ op: 'add_track', args: { kind: 'video' } }], { slots: [{ key: 's', kind: 'picture', clipId: 'clp_none' }] }), true],
      ['a template asset key given twice', d, template([{ op: 'add_track', args: { kind: 'video' } }], { assets: [{ key: 'p', asset: still }, { key: 'p', asset: still }] }), true],
      ['a template run with too many slots', d, template([{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) }, bind: 't' }], { keepSlots: Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, kind: 'picture', clipId: `clp_${i}` })), slots: [{ key: 't', kind: 'text', clipId: { $ref: 't' } }] }), true],
      ['a template that needs a model', d, template([{ op: 'add_track', args: { kind: 'video' } }], { templateId: 'tpl.3d-zoom' }), true],
      ['regenerating the run of another template', firstRun.doc, [{ op: 'apply_template', args: { ...(template([{ op: 'add_track', args: { kind: 'video' } }])[0]!.args as object), templateId: 'tpl.y', runId } }], true],
    ];
    void aSound;
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops, internal] of cases) {
      let message = '';
      try { tx(doc, ops, internal); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      TEMPLATE_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) matched.add(i); });
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(TEMPLATE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    // the numbers and the reason are kept
    expect(translateRefusal('he', 'the transition into the next clip needs 15 spare source frames after this clip, and the file has only 5')).toBe('המעבר לקליפ הבא צריך 15 פריימים של חומר מקור אחרי הקליפ הזה, ובקובץ יש רק 5');
    expect(translateRefusal('he', "time.echo cannot go on an adjustment: a time effect needs a clip's own source; it cannot act on the picture below")).toBe('האפקט הזה אינו יכול לחול על שכבת התאמה: אפקט זמן צריך את המקור של הקליפ עצמו, ואינו יכול לפעול על התמונה שמתחת. אפשר לשים אותו על הקליפ עצמו');
  });
});
