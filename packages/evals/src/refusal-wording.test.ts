/**
 * Keeps the Hebrew wording of common refusals (packages/i18n/src/refusals.ts) in step with the server's own messages:
 * each refusal is provoked for real through the operations, and its message must be recognised.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, type OpCall, type ProjectDocument, MAX_MOTION_TRACKS, MAX_PROJECT_TRACK_SAMPLES, MAX_REDACT_REGIONS, MAX_TRACK_SAMPLES, effectParams, LIFE_REFUSALS, MAX_CAPTURE_SHIFT_MINUTES, MAX_EVENT_FILES, MAX_LIFE_EVENTS, type Capture, type LifeEvent, type LifeRefusalKey, KEYFRAME_REFUSALS } from '@pulseframe/core';
import { REFUSAL_PATTERNS, translateRefusal, TREND_REFUSAL_PATTERNS, TRACKING_REFUSAL_PATTERNS, TEMPLATE_REFUSAL_PATTERNS, LIFE_REFUSAL_PATTERNS, TIMELINE_REFUSAL_PATTERNS, KEYFRAME_REFUSAL_PATTERNS, MULTICAM_W1_REFUSAL_PATTERNS } from '../../i18n/src/index.ts';

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
    // a colour grade whose exposure is animated (colour match writes fixed values, ADR-0014)
    const graded = tx(d, [{ op: 'set_colour_grade', args: { clipId: a, params: { exposure: 0.2 } } }]);
    const gradeId = graded.results[0]!.output!.effectId as string;
    const animatedGrade = tx(graded.doc, [{ op: 'set_effect_keyframe', args: { clipId: a, effectId: gradeId, param: 'exposure', time: f(0), value: 0 } }]).doc;
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
      ['a fixed colour value over an animated one', animatedGrade, [{ op: 'set_colour_grade', args: { clipId: a, params: { exposure: 0.5 } } }]],
    ];
    // a title with live fields (ADR-0021) left holding a brace group that is not a field, in its text and in a format's wording
    const titled = tx(d, [{ op: 'add_text', args: { text: '{date}', start: f(0), duration: f(60) } }]);
    const titleId = titled.results[0]!.output!.clipId as string;
    const fielded = tx(titled.doc, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }, { op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const fieldVariant = fielded.results[1]!.output!.variantId as string;
    cases.push(['a brace group that is not a field in a title with fields', fielded.doc, [{ op: 'update_text', args: { clipId: titleId, text: '{date} {weather}' } }]]);
    cases.push(['a brace group that is not a field in a format\'s wording of a title with fields', fielded.doc, [{ op: 'set_variant_override', args: { variantId: fieldVariant, clipId: titleId, text: 'a } b' } }]]);
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
  it('the transition-option refusals (ADR-0012) are each provoked and worded in Hebrew, with their numbers', () => {
    let r = tx(createProject({ id: 'prj_t', name: 'T' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
    const assetId = r.results[0]!.output!.assetId as string, stillId = r.results[1]!.output!.assetId as string;
    // A at 0..60 leaves 22 source frames after its end; B at 60..120 has 10 source frames before its start
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(158), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(10), duration: f(60) } },
      { op: 'add_clip', args: { assetId: stillId, start: f(300), duration: f(30) } }, { op: 'add_clip', args: { assetId: stillId, start: f(330), duration: f(30) } }]);
    const a = (r.results[0]!.output as any).clipId as string, b = (r.results[1]!.output as any).clipId as string, s2 = (r.results[3]!.output as any).clipId as string;
    const d = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 15 } }, { op: 'set_transition', args: { clipId: s2, type: 'dissolve', frames: 10 } }]).doc;
    const two = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 2 } }]).doc;
    const reversed = tx(r.doc, [{ op: 'set_clip_reverse', args: { clipId: a, reverse: true } }, { op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 15 } }]).doc;
    const echoed = tx(d, [{ op: 'add_effect', args: { clipId: a, type: 'time.echo' } }]).doc;
    const opt = (clipId: string, args: Record<string, unknown>): OpCall[] => [{ op: 'set_transition_options', args: { clipId, ...args } }];
    const cases: [string, ProjectDocument, OpCall[], string][] = [
      ['velocity past the previous clip\'s handle', d, opt(b, { velocity: 3 }), 'לקליפ הקודם נשארו רק 22 פריימים של חומר מקור אחרי סופו; מעבר עם רמפת מהירות ⁦×3⁩ צריך 29'],
      ['velocity past the clip\'s head', tx(d, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 9 } }]).doc, opt(b, { velocity: 4 }), 'לקליפ נשארו רק 10 פריימים של חומר מקור לפני תחילתו; מעבר עם רמפת מהירות ⁦×4⁩ צריך 12'],
      ['velocity on a reversed side', reversed, opt(b, { velocity: 2 }), 'רמפת מהירות אינה אפשרית כשאחד הקליפים מתנגן לאחור או הוא פריים קפוא'],
      ['velocity on a side with a time effect first', echoed, opt(b, { velocity: 2 }), 'רמפת מהירות אינה אפשרית כשהאפקט הראשון של אחד הקליפים הוא אפקט זמן'],
      ['velocity between two stills', d, opt(s2, { velocity: 2 }), 'רמפת מהירות צריכה וידאו לפחות בצד אחד של המעבר; בתמונה סטטית אין תנועה להאיץ'],
      ['a beat lock on 2 frames', two, opt(b, { sync: 'beat' }), 'מעבר שננעל לפעימה צריך לפחות 3 פריימים; במעבר הזה יש 2'],
      ['a colour on a type without one', d, opt(b, { color: '#FF0000' }), 'לסוג המעבר הזה אין בחירת צבע'],
      ['a seed on a type without one', d, opt(b, { seed: 4 }), 'לסוג המעבר הזה אין וריאציות'],
      ['options with no transition', r.doc, opt(a, { sync: 'beat' }), 'אין מעבר בתחילת הקליפ הזה; יש לבחור קודם סוג מעבר'],
    ];
    const matched = new Set<number>();
    for (const [what, doc, ops, he] of cases) {
      let message = '';
      try { tx(doc, ops); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      expect(translateRefusal('he', message), `${what}: ${message}`).toBe(he);
      expect(translateRefusal('en', message)).toBeUndefined();
      TREND_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) matched.add(i); });
    }
    expect(TREND_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
  });

  it('every refusal of the motion tracking operations (ADR-0015) is provoked and worded in Hebrew; none of their patterns is left unprovoked', () => {
    const long = { ...video, name: 'long.mp4', contentHash: `sha256:${'5'.repeat(64)}`, duration: T.frameTime(20_000, R), video: { ...video.video, frameCount: 20_000 } };
    let r = tx(createProject({ id: 'prj_t', name: 'T' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }, { op: 'import_asset', args: { asset: long } }], true);
    const assetId = r.results[0]!.output!.assetId as string, stillId = r.results[1]!.output!.assetId as string, longId = r.results[2]!.output!.assetId as string;
    r = tx(r.doc, [
      { op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }, { op: 'add_clip', args: { assetId: stillId, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } },
      { op: 'create_motion_track', args: { assetId, kind: 'point', frame: 10, x: 5000, y: 5000 } }, { op: 'create_motion_track', args: { assetId, kind: 'region', frame: 10, x: 5000, y: 5000, w: 1000, h: 1000 } }, { op: 'create_motion_track', args: { assetId: longId, kind: 'point', frame: 0, x: 1, y: 1 } },
    ]);
    const clip = (r.results[0]!.output as any).clipId as string, sound = (r.results[0]!.output as any).audioClipId as string, V1 = (r.results[0]!.output as any).trackId as string;
    const pic = (r.results[1]!.output as any).clipId as string, V2 = (r.results[1]!.output as any).trackId as string, title = (r.results[2]!.output as any).clipId as string;
    const [point, region, longTrack] = [3, 4, 5].map((i) => r.results[i]!.output!.motionTrackId as string) as [string, string, string];
    const d = r.doc;
    const follow = (motionTrackId: string, targetTrackId: string) => ({ motionTrackId, targetTrackId, scale: false, smooth: 0 });
    const attach = (motionTrackId: string, from: number, k: number, extra: Record<string, unknown> = {}): OpCall[] => [{ op: 'attach_motion_track', args: { motionTrackId, from, x: Array(k).fill(1), y: Array(k).fill(1), q: Array(k).fill(90), st: Array(k).fill(1), method: 'test', params: {}, createdAt: 'test', ...extra } }];
    // a track at its cap, and a project whose tracks hold exactly the project cap (the two one-sample tracks included)
    const fullTrack = tx(d, attach(longTrack, 0, MAX_TRACK_SAMPLES), true).doc;
    let fullProject = fullTrack;
    for (const k of [MAX_TRACK_SAMPLES, MAX_TRACK_SAMPLES, MAX_PROJECT_TRACK_SAMPLES - 3 * MAX_TRACK_SAMPLES - 2]) { const c = tx(fullProject, [{ op: 'create_motion_track', args: { assetId: longId, kind: 'point', frame: 0, x: 1, y: 1 } }]); fullProject = tx(c.doc, attach(c.results[0]!.output!.motionTrackId as string, 0, k), true).doc; }
    let manyTracks = d;
    for (let i = Object.keys(d.motionTracks).length; i < MAX_MOTION_TRACKS; i++) manyTracks = tx(manyTracks, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: 0, x: 1, y: 1 } }]).doc;
    const lostStart = tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: point, set: [{ frame: 20, x: 1, y: 1 }], markLost: { from: 10, to: 15 } } }]).doc;
    const following = tx(d, [{ op: 'set_clip_follow', args: { clipId: title, follow: follow(point, V1) } }]).doc;
    const picFollows = tx(d, [{ op: 'set_clip_follow', args: { clipId: pic, follow: follow(point, V1) } }]).doc;
    const echoed = tx(d, [{ op: 'add_effect', args: { clipId: title, type: 'time.echo' } }]).doc;
    const regions = tx(d, Array.from({ length: MAX_REDACT_REGIONS }, () => ({ op: 'set_redact_region', args: { clipId: clip, region: {} } }))).doc;
    const unused = tx(following, [{ op: 'delete_clip', args: { clipId: clip } }]).doc;
    const cases: [string, ProjectDocument, OpCall[], boolean?][] = [
      ['a motion track that does not exist', d, [{ op: 'edit_motion_track', args: { motionTrackId: 'mtk_none', name: 'x' } }]],
      ['following a track that does not exist', d, [{ op: 'set_clip_follow', args: { clipId: title, follow: follow(point, 'trk_none') } }]],
      ['tracking a still', d, [{ op: 'create_motion_track', args: { assetId: stillId, kind: 'point', frame: 0, x: 1, y: 1 } }]],
      ['a seed past the end', d, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: 240, x: 1, y: 1 } }]],
      ['measured samples past the end', d, attach(point, 239, 2), true],
      ['a region without its box', d, [{ op: 'create_motion_track', args: { assetId, kind: 'region', frame: 0, x: 1, y: 1 } }]],
      ['a point with a box', d, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: 0, x: 1, y: 1, w: 100, h: 100 } }]],
      ['measured region samples without sizes', d, attach(region, 10, 1), true],
      ['a size on a point track', d, [{ op: 'edit_motion_track', args: { motionTrackId: point, set: [{ frame: 11, x: 1, y: 1, s: 1000 }] } }]],
      ['columns of different lengths', d, attach(point, 10, 1, { y: [1, 2] }), true],
      ['measured samples marked manual', d, attach(point, 10, 1, { st: [4] }), true],
      ['one track too many', manyTracks, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: 0, x: 1, y: 1 } }]],
      ['a track over its cap', fullTrack, attach(longTrack, MAX_TRACK_SAMPLES, 1), true],
      ['a project over its cap', fullProject, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: 0, x: 1, y: 1 } }]],
      ['an edit that changes nothing', d, [{ op: 'edit_motion_track', args: { motionTrackId: point } }]],
      ['a frame placed twice', d, [{ op: 'edit_motion_track', args: { motionTrackId: point, set: [{ frame: 3, x: 1, y: 1 }, { frame: 3, x: 2, y: 2 }] } }]],
      ['an empty stretch', d, [{ op: 'edit_motion_track', args: { motionTrackId: point, markLost: { from: 10, to: 10 } } }]],
      ['a stretch outside the track', d, [{ op: 'edit_motion_track', args: { motionTrackId: point, interpolate: { from: 0, to: 12 } } }]],
      ['filling in without a usable sample before', lostStart, [{ op: 'edit_motion_track', args: { motionTrackId: point, interpolate: { from: 10, to: 12 } } }]],
      ['deleting a track a title follows', following, [{ op: 'remove_motion_track', args: { motionTrackId: point } }]],
      ['removing a file a title follows a track of', unused, [{ op: 'remove_asset', args: { assetId } }]],
      ['a sound that would follow', d, [{ op: 'set_clip_follow', args: { clipId: sound, follow: follow(point, V1) } }]],
      ['following a sound track', d, [{ op: 'set_clip_follow', args: { clipId: title, follow: follow(point, Object.values(d.sequences)[0]!.tracks.find((t) => t.kind === 'audio')!.id) } }]],
      ['following its own track', d, [{ op: 'set_clip_follow', args: { clipId: pic, follow: follow(point, V2) } }]],
      ['a title with a time effect that would follow', echoed, [{ op: 'set_clip_follow', args: { clipId: title, follow: follow(point, V1) } }]],
      ['following a picture that follows', picFollows, [{ op: 'set_clip_follow', args: { clipId: title, follow: follow(point, V2) } }]],
      ['a followed picture that would follow', following, [{ op: 'set_clip_follow', args: { clipId: clip, follow: follow(point, V2) } }]],
      ['a privacy region on a title', d, [{ op: 'set_redact_region', args: { clipId: title, region: {} } }]],
      ['a privacy region on a still', d, [{ op: 'set_redact_region', args: { clipId: pic, region: {} } }]],
      ['deleting a region without naming it', d, [{ op: 'set_redact_region', args: { clipId: clip, region: null } }]],
      ['a region that does not exist', d, [{ op: 'set_redact_region', args: { clipId: clip, regionId: 'rgn_none', region: null } }]],
      ['one region too many', regions, [{ op: 'set_redact_region', args: { clipId: clip, region: {} } }]],
      ['a region on a track of another file', d, [{ op: 'set_redact_region', args: { clipId: clip, region: { motionTrackId: longTrack } } }]],
    ];
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops, internal] of cases) {
      let message = '';
      try { tx(doc, ops, internal); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      TRACKING_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) matched.add(i); });
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(TRACKING_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    // the numbers are kept
    expect(translateRefusal('he', 'frame 240 is past the last frame of the video (239)')).toBe('הפריים 240 נמצא אחרי הפריים האחרון של הווידאו (239)');
    expect(translateRefusal('he', 'interpolate: the stretch must lie inside the track (source frames 10 to 20)')).toBe('הקטע חייב להיות בתוך מסלול המעקב (פריימי מקור 10 עד 20)');
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
      // the op's own schema refuses a step's arguments: z.prettifyError writes it over more than one line
      ['a template step whose arguments fail its operation', d, template([{ op: 'add_text', args: { text: 'x', start: f(0) } }]), true],
      ['a template step given a list where one id is needed', d, template([{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'blur.gaussian' }] }, bind: 'l' }, { op: 'remove_effect', args: { clipId: { $ref: 'l', out: 'clipId' }, effectId: { $ref: 'l', out: 'effectIds' } } }]), true],
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
    // a step refused by its operation's own schema (two lines from z.prettifyError) is worded as a fault of the template
    expect(translateRefusal('he', 'template step 0 (add_text): ✖ Invalid input: expected object, received undefined\n  → at duration')).toBe('אחד השלבים של התבנית אינו תקין, ולכן היא לא הוחלה. זו תקלה בתבנית, לא בעריכה שלך');
    // the numbers and the reason are kept
    expect(translateRefusal('he', 'the transition into the next clip needs 15 spare source frames after this clip, and the file has only 5')).toBe('המעבר לקליפ הבא צריך 15 פריימים של חומר מקור אחרי הקליפ הזה, ובקובץ יש רק 5');
    expect(translateRefusal('he', "time.echo cannot go on an adjustment: a time effect needs a clip's own source; it cannot act on the picture below")).toBe('האפקט הזה אינו יכול לחול על שכבת התאמה: אפקט זמן צריך את המקור של הקליפ עצמו, ואינו יכול לפעול על התמונה שמתחת. אפשר לשים אותו על הקליפ עצמו');
  });

  it('life line (ADR-0021): every refusal of the capture, event and title-field operations is provoked through its operation and worded in Hebrew', () => {
    const evening: Capture = { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' };
    const dated = (hash: string, capture?: Capture) => ({ ...video, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, ...(capture ? { capture } : {}) });
    const copy = (hash: string, source: string) => ({ ...dated(hash), provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_t', capabilityId: 'test.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [source], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: T.rt(2, 1), audio: 'source-copied' } } });
    const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    const table = { kind: 'lut' as const, name: 'look.cube', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance: prov };
    let r = tx(createProject({ id: 'prj_life_w', name: 'W' }), [dated('a', evening), dated('b', { at: '2024-03-24', utcOffsetMinutes: null, source: 'filename', circa: true }), dated('c'), sound, table].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
    const [a, dayOnly, undated, soundId, lut] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string];
    r = tx(r.doc, [{ op: 'import_asset', args: { asset: copy('d', a) } }], true);
    const copyId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: '{date}', start: f(0), duration: f(60) } }, { op: 'add_event', args: { assetIds: [a, dayOnly] } }]);
    const d = r.doc, clipId = (r.results[0]!.output as any).clipId as string, titleId = (r.results[1]!.output as any).clipId as string, eventId = (r.results[2]!.output as any).eventId as string;
    const on: OpCall = { op: 'set_text_fields', args: { clipId: titleId, enabled: true } };
    const text = (t: string): OpCall => ({ op: 'update_text', args: { clipId: titleId, text: t } });
    const event = (id: string, assetIds: string[]): LifeEvent => ({ id, name: '', afterSunset: null, assetIds, origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: true } });
    // documents no short run of operations makes: a project with as many events as it may hold, an event as full as it can be, a clock total that does not match its date
    const full: ProjectDocument = { ...structuredClone(d), events: Object.fromEntries(Array.from({ length: MAX_LIFE_EVENTS }, (_, i) => [`evt_${i}`, event(`evt_${i}`, [undated])])) };
    const crowded = structuredClone(d);
    const many = Array.from({ length: MAX_EVENT_FILES }, (_, i) => `ast_many${i}`);
    for (const id of many) crowded.assets[id] = { ...structuredClone(crowded.assets[undated]!), id };
    crowded.events = { evt_big: event('evt_big', many) };
    const drifted = structuredClone(d);
    drifted.assets[a]!.capture = { ...evening, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES };
    const cases: Record<LifeRefusalKey, [ProjectDocument, OpCall[], boolean?][]> = {
      assetNotFound: [[d, [{ op: 'set_asset_capture', args: { assetId: 'ast_none', capture: null } }]], [d, [{ op: 'attach_asset_capture', args: { assetId: 'ast_none', capture: evening } }], true]],
      eventNotFound: [[d, [{ op: 'update_event', args: { eventId: 'evt_none', name: 'x' } }]], [d, [{ op: 'remove_event', args: { eventId: 'evt_none' } }]]],
      lutHasNoDate: [[d, [{ op: 'set_asset_capture', args: { assetId: lut, capture: { at: '2024-12-25' } } }]]],
      noSuchDay: [[d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2024-02-30' } } }]]],
      dateOutOfRange: [[d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '1850-06-01' } } }]], [tx(d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2100-12-31T23:00:00' } } }]).doc, [{ op: 'shift_asset_captures', args: { assetIds: [undated], minutes: 90 } }]]],
      captureUnchanged: [[tx(d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2021-06-01' } } }]).doc, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2021-06-01' } } }]]],
      noCaptureToRemove: [[d, [{ op: 'set_asset_capture', args: { assetId: copyId, capture: null } }]]],
      listedTwice: [[d, [{ op: 'add_event', args: { assetIds: [undated, undated] } }]]],
      shiftNoDate: [[d, [{ op: 'shift_asset_captures', args: { assetIds: [undated, soundId, a], minutes: 60 } }]]],
      shiftDayOnly: [[d, [{ op: 'shift_asset_captures', args: { assetIds: [dayOnly], minutes: 90 } }]]],
      shiftInherited: [[d, [{ op: 'shift_asset_captures', args: { assetIds: [copyId], minutes: 60 } }]]],
      shiftTooFar: [[drifted, [{ op: 'shift_asset_captures', args: { assetIds: [a], minutes: 60 } }]]],
      notATitle: [[d, [{ op: 'set_text_fields', args: { clipId, enabled: true } }]]],
      fieldsAlready: [[d, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: false } }]], [tx(d, [on]).doc, [on]]],
      notFields: [[d, [text('{weather} {date:fancy} a { b'), on]]],
      fieldsStillThere: [[tx(d, [on]).doc, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: false } }]]],
      noDatedFiles: [[tx(createProject({ id: 'prj_none', name: 'N' }), [{ op: 'import_asset', args: { asset: dated('a') } }], true).doc, [{ op: 'cluster_events', args: {} }]]],
      tooManyEvents: [[full, [{ op: 'add_event', args: { assetIds: [a] } }]]],
      eventFileKind: [[d, [{ op: 'add_event', args: { assetIds: [soundId] } }]]],
      eventLastFile: [[d, [{ op: 'update_event', args: { eventId, removeAssetIds: [a, dayOnly] } }]]],
      eventTooManyFiles: [[crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [a] } }]]],
      eventNothingToChange: [[d, [{ op: 'update_event', args: { eventId } }]]],
      eventFileNotIn: [[d, [{ op: 'update_event', args: { eventId, removeAssetIds: [undated] } }]]],
      eventAddAndRemove: [[d, [{ op: 'update_event', args: { eventId, addAssetIds: [undated], removeAssetIds: [undated] } }]]],
    };
    expect(Object.keys(cases).sort()).toEqual(Object.keys(LIFE_REFUSALS).sort());
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    const messages: Partial<Record<LifeRefusalKey, string[]>> = {};
    for (const [key, list] of Object.entries(cases) as [LifeRefusalKey, [ProjectDocument, OpCall[], boolean?][]][]) for (const [doc, ops, internal] of list) {
      let message = '';
      let code = '';
      try { tx(doc, ops, internal); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; code = e.code; }
      (messages[key] ??= []).push(message);
      expect(code, `${key}: ${message}`).toBe(LIFE_REFUSALS[key].code);
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${key}: ${message}`);
      const hits = LIFE_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${key}: ${message} is recognised by exactly one life-line pattern`).toBe(1);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message), key).toBeUndefined(); // English shows the operation's own sentence
    }
    expect(unrecognised).toEqual([]);
    expect(LIFE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    // the numbers, the years and the brace groups a person needs are kept in the Hebrew sentence
    expect(translateRefusal('he', messages.shiftNoDate![0]!)).toContain('2');
    expect(translateRefusal('he', messages.dateOutOfRange![0]!)).toMatch(/1900.*2100/);
    expect(translateRefusal('he', messages.notFields![0]!)).toContain('{weather}, {date:fancy}, {');
    expect(translateRefusal('he', messages.eventTooManyFiles![0]!)).toContain(String(MAX_EVENT_FILES));
    expect(translateRefusal('he', messages.tooManyEvents![0]!)).toContain(String(MAX_LIFE_EVENTS));
    expect(translateRefusal('he', messages.fieldsAlready![0]!)).not.toBe(translateRefusal('he', messages.fieldsAlready![1]!)); // off, and on
  });
  it('timeline behaviour (UX redesign wave A): every refusal of set_timeline_behaviour and ripple_delete_clips is provoked and worded in Hebrew', () => {
    const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'3'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    let r = tx(createProject({ id: 'prj_tl', name: 'TL' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: sound } }], true);
    const assetId = r.results[0]!.output!.assetId as string, soundId = r.results[1]!.output!.assetId as string;
    // three clips with their sounds, the third after a gap: 0..60, 60..120, 160..220
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(0), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(60), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(160), sourceIn: f(120), duration: f(60) } }]);
    const b = (r.results[1]!.output as any).clipId as string, bSound = (r.results[1]!.output as any).audioClipId as string;
    const d = r.doc;
    const soundTrack = Object.values(d.sequences)[0]!.tracks.find((t) => t.clips.some((c) => c.id === bSound))!.id;
    // a loose sound in the gap on the same sound track: deleting it with the middle clip would move the last picture and its sound by different amounts
    const loose = tx(d, [{ op: 'add_clip', args: { assetId: soundId, start: f(125), duration: f(10), trackId: soundTrack } }]);
    const looseId = (loose.results[0]!.output as any).clipId as string;
    const lockedSound = tx(d, [{ op: 'update_track', args: { trackId: soundTrack, locked: true } }]).doc;
    // a J-cut into the second clip: the first clip's sound ends at 50 and the second clip's sound starts there, before its picture;
    // deleting the first clip would move that sound to -10
    const first = (r.results[0]!.output as any).clipId as string, firstSound = (r.results[0]!.output as any).audioClipId as string;
    const jcut = tx(d, [{ op: 'trim_clip', args: { clipId: firstSound, edge: 'end', to: f(50), includeLinked: false } }, { op: 'trim_clip', args: { clipId: bSound, edge: 'start', to: f(50), includeLinked: false } }]).doc;
    const cases: [string, ProjectDocument, OpCall[]][] = [
      ['a behaviour change that changes nothing', d, [{ op: 'set_timeline_behaviour', args: {} }]],
      ['a ripple delete of a clip that is gone', d, [{ op: 'ripple_delete_clips', args: { clipIds: ['clp_gone'] } }]],
      ['linked clips that would move by different amounts', loose.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [b, looseId] } }]],
      ['a sound slid over a sound that stays', d, [{ op: 'ripple_delete_clips', args: { clipIds: [b], includeLinked: false } }]],
      ['a picture deleted alone while its sound is on a locked track', lockedSound, [{ op: 'ripple_delete_clips', args: { clipIds: [b], includeLinked: false } }]],
      ['a sound that starts before its picture moved before 0', jcut, [{ op: 'ripple_delete_clips', args: { clipIds: [first] } }]],
    ];
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops] of cases) {
      let message = '';
      try { tx(doc, ops); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      const hits = TIMELINE_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${what}: ${message}`).toBe(1);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(TIMELINE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
  });
});

describe('Hebrew wording of the multicam operation bodies (ADR-0020 W1)', () => {
  it('every refusal the bodies raise outside the contract table is provoked through its operation and worded in Hebrew by exactly one of their patterns; none is left unprovoked', () => {
    const mic = { kind: 'audio' as const, name: 'mic.wav', contentHash: `sha256:${'5'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    const cam2 = { ...video, name: 'b.mp4', contentHash: `sha256:${'6'.repeat(64)}` };
    const cam3 = { ...video, name: 'c.mp4', contentHash: `sha256:${'7'.repeat(64)}` };
    let r = tx(createProject({ id: 'prj_mc', name: 'MC', frameRate: R }), [{ op: 'import_asset', args: { asset: mic } }, { op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: cam2 } }, { op: 'import_asset', args: { asset: cam3 } }], true);
    const [M, A, B, C] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string];
    r = tx(r.doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [M] }, { assetIds: [A] }, { assetIds: [B, C] }] } }]);
    const { groupId, angleIds } = r.results[0]!.output as { groupId: string; angleIds: [string, string, string] };
    const [mc, ca, cb] = angleIds;
    r = tx(r.doc, [
      { op: 'set_multicam_sync', args: { groupId, angleId: ca, pieceIndex: 0, offset: T.ZERO } },
      { op: 'set_multicam_sync', args: { groupId, angleId: cb, pieceIndex: 0, offset: T.ZERO } },
      { op: 'place_multicam', args: { groupId, at: T.ZERO, angleId: ca, range: { from: T.ZERO, to: T.rt(6, 1) } } },
    ]);
    const placed = r.doc;
    const quality = { verdict: 'confident' as const, peakZ: 12, peakRatio: 2, anchorsUsed: 3, anchorsRejected: 0, residualSamples: 1, driftPpm: 0, overlapSeconds: 8, candidates: [], chainDepth: 0, jobId: null };
    const cases: [string, ProjectDocument, OpCall[], boolean?][] = [
      ['a reference index past the angles', placed, [{ op: 'create_multicam', args: { angles: [{ assetIds: [A] }, { assetIds: [M] }], referenceAngleIndex: 4 } }]],
      ['a program of a sound angle', placed, [{ op: 'switch_angles', args: { groupId, cuts: [{ at: f(0), angleId: mc }] } }]],
      ['a range under one frame, before group time 0', placed, [{ op: 'place_multicam', args: { groupId, at: T.ZERO, angleId: ca, range: { from: T.rt(-1, 1), to: T.rt(-1, 1) } } }]],
      ['a sync change that pushes a segment out of its file', placed, [{ op: 'set_multicam_sync', args: { groupId, angleId: ca, pieceIndex: 0, offset: T.rt(5, 1) } }]],
      ['two files of one camera at the same time', placed, [{ op: 'set_multicam_sync', args: { groupId, angleId: cb, pieceIndex: 1, offset: T.rt(4, 1) } }]],
      ['a speaker framed by a sound angle', placed, [{ op: 'update_multicam', args: { groupId, speakers: [{ label: 'מארחת', micAngleId: mc, channel: null, shotAngleId: mc }] } }]],
      ['two speakers with one id', placed, [{ op: 'update_multicam', args: { groupId, speakers: [{ id: 'spk_a', label: 'א', micAngleId: mc, channel: 0, shotAngleId: null }, { id: 'spk_a', label: 'ב', micAngleId: mc, channel: 1, shotAngleId: null }] } }]],
      ['a measured result without anchors that says it placed the file', placed, [{ op: 'attach_multicam_sync', args: { groupId, createdAt: 'x', method: 'm', params: {}, overwrite: true, pieces: [{ angleId: cb, pieceIndex: 1, anchors: [], quality }] } }], true],
      ['a cut to an angle with no picture before group time 0', tx(placed, [{ op: 'set_multicam_sync', args: { groupId, angleId: cb, pieceIndex: 0, offset: T.rt(-5, 1) } }, { op: 'set_multicam_sync', args: { groupId, angleId: ca, pieceIndex: 0, offset: T.rt(-2, 1) } }]).doc, [{ op: 'switch_angles', args: { groupId, cuts: [{ at: f(0), angleId: cb }] } }]],
      ['a program laid before the timeline starts', placed, [{ op: 'place_multicam', args: { groupId, at: f(-1), angleId: ca } }]],
    ];
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops, internal] of cases) {
      let message = '';
      try { tx(doc, ops, internal); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he) || !/אפשר|יש ל/.test(he)) unrecognised.push(`${what}: ${message}`);
      const hits = MULTICAM_W1_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${what}: ${message}`).toBe(1);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(MULTICAM_W1_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    // the numbers survive, minus signs included
    expect(translateRefusal('he', 'angle "B" has no picture from -2.500s to 3.000s of group time')).toMatch(/-2\.500.*3\.000/);
  });
});

describe('Hebrew wording of the refusals of the people operations (ADR-0021, people section)', () => {
  it('every refusal of PEOPLE_REFUSALS is provoked through its operation, carries its code, and is recognised by exactly one people pattern; no birth date in the Hebrew', async () => {
    const { PEOPLE_REFUSALS, MAX_PEOPLE } = await import('@pulseframe/core');
    const { PEOPLE_REFUSAL_PATTERNS } = await import('../../i18n/src/index.ts');
    let r = tx(createProject({ id: 'prj_people', name: 'People' }), [{ op: 'add_text', args: { text: 'T', start: f(0), duration: f(30) } }, { op: 'add_person', args: { name: 'נועה', birthDate: '2016-11-04', form: 'f' } }, { op: 'add_person', args: { name: 'איתי' } }]);
    const titleId = r.results[0]!.output!.clipId as string, noa = r.results[1]!.output!.personId as string, itai = r.results[2]!.output!.personId as string;
    const d = r.doc;
    const named = tx(d, [{ op: 'update_text', args: { clipId: titleId, text: `{name:${noa}}` } }]).doc;
    r = tx(createProject({ id: 'prj_full', name: 'Full' }), Array.from({ length: MAX_PEOPLE }, (_, i) => ({ op: 'add_person', args: { name: `p${i}` } })));
    const full = r.doc;
    const cases: Record<keyof typeof PEOPLE_REFUSALS, [ProjectDocument, OpCall[]][]> = {
      personNotFound: [[d, [{ op: 'update_person', args: { personId: 'per_gone', name: 'x' } }]], [d, [{ op: 'remove_person', args: { personId: 'per_gone' } }]]],
      personNameCharacters: [[d, [{ op: 'add_person', args: { name: 'a{b' } }]], [d, [{ op: 'update_person', args: { personId: noa, name: 'x:y' } }]]],
      personNameEmpty: [[d, [{ op: 'add_person', args: { name: '   ' } }]]],
      noSuchBirthDay: [[d, [{ op: 'add_person', args: { name: 'z', birthDate: '2021-02-30' } }]], [d, [{ op: 'update_person', args: { personId: itai, birthDate: '2023-02-29' } }]]],
      birthDateOutOfRange: [[d, [{ op: 'add_person', args: { name: 'z', birthDate: '1850-06-01' } }]]],
      personNameTaken: [[d, [{ op: 'add_person', args: { name: ' נועה ' } }]], [d, [{ op: 'update_person', args: { personId: itai, name: 'נועה' } }]]],
      tooManyPeople: [[full, [{ op: 'add_person', args: { name: 'one more' } }]]],
      personNothingToChange: [[d, [{ op: 'update_person', args: { personId: noa } }]]],
      personUnchanged: [[d, [{ op: 'update_person', args: { personId: noa, form: 'f' } }]]],
      personInUse: [[named, [{ op: 'remove_person', args: { personId: noa } }]]],
      unknownPerson: [[d, [{ op: 'update_text', args: { clipId: titleId, text: '{name:per_x} {age:per_x:words}' } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]]],
    };
    expect(Object.keys(cases).sort()).toEqual(Object.keys(PEOPLE_REFUSALS).sort());
    const matched = new Set<number>();
    const messages: Record<string, string> = {};
    for (const [key, list] of Object.entries(cases) as [keyof typeof PEOPLE_REFUSALS, [ProjectDocument, OpCall[]][]][]) for (const [doc, ops] of list) {
      let message = '(not refused)', code = '';
      try { tx(doc, ops); } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; code = e.code; }
      messages[key] = message;
      expect(code, `${key}: ${message}`).toBe(PEOPLE_REFUSALS[key].code);
      const he = translateRefusal('he', message);
      expect(he, `${key}: ${message}`).toMatch(/[֐-׿]/);
      expect(he, key).not.toMatch(/2016|11-04|\d{1,2}[./]\d{1,2}[./]\d{2,4}/);
      const hits = PEOPLE_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${key}: ${message} is recognised by exactly one people pattern`).toBe(1);
      expect(LIFE_REFUSAL_PATTERNS.some((re) => re.test(message)), key).toBe(false);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message), key).toBeUndefined();
    }
    expect(PEOPLE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', messages.personNameTaken!)).toContain('נועה');
    expect(translateRefusal('he', messages.tooManyPeople!)).toContain(String(MAX_PEOPLE));
    expect(translateRefusal('he', messages.personInUse!)).toContain('1');
    expect(translateRefusal('he', messages.birthDateOutOfRange!)).toMatch(/1900.*2100/);
  });
});

describe('Hebrew wording of the refusals of keyframe curves (ADR-0019), provoked through their operations', () => {
  it('every KEYFRAME_REFUSALS sentence a built operation raises, and the three it shares, is worded in Hebrew; no keyframe pattern is left unprovoked', () => {
    let doc = createProject({ id: 'prj_kf', name: 'kf' });
    const t = tx(doc, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(90) } }]);
    const clipId = t.results[0]!.output!.clipId as string;
    const fx = tx(t.doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'color.grade' } }]);
    const [blur, grade] = fx.results.map((r) => r.output!.effectId as string) as [string, string];
    const adj = tx(fx.doc, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(30) } } }]);
    const adjustId = adj.results[0]!.output!.clipId as string;
    doc = tx(adj.doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: [{ time: f(0), value: 0, easing: 'linear' }, { time: f(10), value: 0.2, easing: 'linear' }] } }]).doc;
    const full = tx(doc, [{ op: 'replace_effect_keyframes', args: { clipId, effectId: blur, param: 'radius', keys: Array.from({ length: 500 }, (_, i) => ({ time: f(i), value: 0.01, easing: 'linear' })) } }]).doc;
    const key = (fr: number, extra: Record<string, unknown> = {}) => ({ time: f(fr), value: 0.1, easing: 'linear', ...extra });
    const cases: [string, ProjectDocument, OpCall[]][] = [
      ['bezier without handles', doc, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: 0, easing: 'bezier' } }]],
      ['handles with a named curve', doc, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: 0, easing: 'gentle', bezier: [0.2, 0, 0.8, 1] } }]],
      ['overshoot on opacity', doc, [{ op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(0), value: 0.5, easing: 'overshoot' } }]],
      ['spring on a colour grade', doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId: grade, param: 'exposure', time: f(0), value: 0.5, easing: 'spring' } }]],
      ['a channel the adjustment cannot carry', doc, [{ op: 'set_keyframe_curve', args: { clipId: adjustId, channels: [{ property: 'x' }], times: [f(0)], side: 'after', easing: 'gentle' } }]],
      ['from without to', doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'y', from: f(0), keys: [key(0)] } }]],
      ['from after to', doc, [{ op: 'replace_effect_keyframes', args: { clipId, effectId: blur, param: 'radius', from: f(9), to: f(1), keys: [key(2)] } }]],
      ['a key outside the range', doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'y', from: f(0), to: f(5), keys: [key(6)] } }]],
      ['one key too many', full, [{ op: 'set_effect_keyframe', args: { clipId, effectId: blur, param: 'radius', time: f(700), value: 0.02 } }]],
      ['no key at these times', doc, [{ op: 'set_keyframe_curve', args: { clipId, channels: [{ property: 'x' }], times: [f(5)], side: 'both', easing: 'smooth' } }]],
      ['a value out of range', doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: [{ time: f(0), value: 9, easing: 'smooth' }] } }]],
      ['a parameter that cannot be animated', doc, [{ op: 'replace_effect_keyframes', args: { clipId, effectId: blur, param: 'nope', keys: [key(0)] } }]],
      ['an effect that is not there', doc, [{ op: 'replace_effect_keyframes', args: { clipId, effectId: 'fx_none', param: 'radius', keys: null } }]],
    ];
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, d, ops] of cases) {
      let message = '';
      try { tx(d, ops); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      const hits = KEYFRAME_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) unrecognised.push(`${what}: ${hits.length} keyframe patterns match "${message}"`);
      hits.forEach((i) => matched.add(i));
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(KEYFRAME_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', KEYFRAME_REFUSALS.curveFlash.message('spring', 'color.grade.exposure'))).toContain('color.grade.exposure');
  });
});
