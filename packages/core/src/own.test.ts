/**
 * Ids that name something every object inherits ("__proto__", "constructor", "toString") name nothing in a project.
 * Before own.ts, `rename_asset` with assetId "__proto__" found Object.prototype in the asset record and renamed it for
 * the whole process; other ops with the same lookup crashed instead of answering not_found.
 *
 * Two layers stop it: the guard in applyTransaction (refuseInheritedIds, inheritedIds.test.ts) refuses an id-like
 * argument before the op runs, and every lookup of a caller-supplied key reads only the record's own entries (own.ts).
 * The tests here hold through a transaction whichever layer answers; where a layer is tested on its own it says so.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, COLOR_LOOKS, createProject, describeOps, findClip, isInheritedName, OpError, own, planRecipe, projectVariant, RecipeError,
  followedBeats, mainTrackOf, readingSpeedIssues, restoreEntities, sequenceDuration, staleTranslations, TEXT_PRESETS, timeLineage, timeline, transcriptFor, transcriptView, validateProject, type EntityState, type OpCall, type ProjectDocument,
} from './index.ts';

const HOSTILE = ['__proto__', 'constructor', 'toString'] as const;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `p${seed++}_`, actor: 'test', allowInternal });
const failure = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('expected an OpError'); };

// ---- what "Object.prototype is unchanged" means here: same members, same values, same accessors, same flags ----
const protoSnapshot = () => Reflect.ownKeys(Object.prototype).map((k) => { const d = Object.getOwnPropertyDescriptor(Object.prototype, k)!; return [k, d.value, d.get, d.set, d.writable, d.enumerable, d.configurable] as const; });
const PRISTINE = protoSnapshot();
function protoDamage(): string[] {
  const now = new Map(protoSnapshot().map((row) => [row[0], row]));
  const out: string[] = [];
  for (const row of PRISTINE) {
    const cur = now.get(row[0]);
    if (!cur) out.push(`removed ${String(row[0])}`);
    else if (!cur.every((v, j) => Object.is(v, row[j]))) out.push(`changed ${String(row[0])}`);
    now.delete(row[0]);
  }
  for (const k of now.keys()) out.push(`added ${String(k)}`);
  return out;
}
/** Paths of objects in a document whose prototype is not the plain one: what `record['__proto__'] = entry` leaves behind. */
function oddPrototypes(v: unknown, path = 'doc', out: string[] = []): string[] {
  if (Array.isArray(v)) { if (Object.getPrototypeOf(v) !== Array.prototype) out.push(path); v.forEach((x, i) => oddPrototypes(x, `${path}[${i}]`, out)); }
  else if (v && typeof v === 'object') { if (Object.getPrototypeOf(v) !== Object.prototype) out.push(path); for (const [k, x] of Object.entries(v)) oddPrototypes(x, `${path}.${k}`, out); }
  return out;
}
// A failing test must not leave its damage behind for the tests after it.
afterEach(() => { for (const k of Reflect.ownKeys(Object.prototype)) if (!PRISTINE.some((row) => row[0] === k)) delete (Object.prototype as Record<PropertyKey, unknown>)[k]; });

// ---- a project with one of everything an id can name ----
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance,
};
const table = { kind: 'lut' as const, name: 'film.cube', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 100, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 17, title: null }, provenance };
function studio() {
  let doc = createProject({ id: 'prj_x', name: 'X' });
  const run = (op: string, args: unknown, internal = false) => { const r = tx(doc, [{ op, args }], internal); doc = r.doc; return (r.results[0]!.output ?? {}) as Record<string, any>; };
  const assetId = run('import_asset', { asset: video }, true).assetId as string;
  const lutId = run('import_asset', { asset: table }, true).assetId as string;
  const placed = run('add_clip', { assetId, start: f(0), duration: f(120) });
  const clipId = placed.clipId as string, audioClipId = placed.audioClipId as string, trackId = placed.trackId as string;
  const audioTrackId = findClip(doc, audioClipId)!.track.id;
  const textId = run('add_text', { text: 'Title', start: f(0), duration: f(60) }).clipId as string;
  const captionTrackId = run('add_caption_track', { mode: 'manual' }).trackId as string;
  const cueId = run('add_cue', { trackId: captionTrackId, text: 'hello', start: f(0), duration: f(30) }).clipId as string;
  run('add_cue', { trackId: captionTrackId, text: 'again', start: f(30), duration: f(30) });
  const markerId = run('add_marker', { time: f(30), label: 'note' }).markerId as string;
  const variantId = run('add_variant', { width: 1080, height: 1080 }).variantId as string;
  run('set_variant_override', { variantId, clipId, transform: { scale: 1.2 } });
  const said = run('set_transcript', { assetId, language: 'en', segments: [{ start: f(0), duration: f(60), text: 'one two', words: [{ text: 'one', start: f(0), duration: f(30) }, { text: 'two', start: f(30), duration: f(30) }] }] });
  const segmentId = said.segmentIds[0] as string, [fromWordId, toWordId] = said.wordIds[0] as [string, string];
  run('edit_analysis', { assetId, kind: 'scenes', replace: [T.rt(2, 1)] });
  run('edit_analysis', { assetId, kind: 'beats', replace: [T.rt(1, 1), T.rt(2, 1), T.rt(3, 1)] });
  const effectId = run('add_effect', { clipId, type: 'blur.gaussian' }).effectId as string;
  run('set_asset_capture', { assetId, capture: { at: '2026-05-01T10:00:00' } });
  const eventId = run('add_event', { assetIds: [assetId], name: 'Trip' }).eventId as string;
  const personId = run('add_person', { name: 'Dana' }).personId as string;
  const secondId = run('import_asset', { asset: { ...video, name: 'b.mp4', contentHash: `sha256:${'d'.repeat(64)}` } }, true).assetId as string;
  const multicam = run('create_multicam', { angles: [{ assetIds: [assetId] }, { assetIds: [secondId] }] });
  const groupId = multicam.groupId as string, angleIds = multicam.angleIds as string[];
  const shortId = run('add_sequence', { name: 'Short' }).sequenceId as string;
  const motionTrackId = run('create_motion_track', { assetId, kind: 'point', frame: 0, x: 100, y: 100 }).motionTrackId as string;
  const audioEffectId = (run('add_audio_effect', { clipId: audioClipId, type: 'tone.bassboost' }).effects as { effectId: string }[])[0]!.effectId;
  run('set_effect_keyframe', { clipId, effectId, param: 'radius', time: f(0), value: 0.02 });
  const runId = run('apply_recipe', { recipeId: 'fixture', params: {}, steps: ['add a title'], ops: [{ op: 'add_text', args: { text: 'From a recipe', start: f(150), duration: f(30) } }] }, true).runId as string;
  expect(validateProject(doc)).toEqual([]);
  return { doc, assetId, lutId, clipId, audioClipId, trackId, audioTrackId, textId, captionTrackId, cueId, markerId, variantId, segmentId, fromWordId, toWordId, effectId, audioEffectId, motionTrackId, eventId, personId, shortId, groupId, angleIds, runId };
}

describe('own', () => {
  it('answers with what the record itself holds and with nothing else', () => {
    const record: Record<string, number> = { a: 1, zero: 0 };
    expect(own(record, 'a')).toBe(1);
    expect(own(record, 'zero')).toBe(0);
    expect(own(record, 'b')).toBeUndefined();
    for (const key of [...HOSTILE, 'hasOwnProperty', 'valueOf', '__defineGetter__']) {
      expect((record as Record<string, unknown>)[key]).toBeDefined(); // what a plain lookup finds
      expect(own(record, key)).toBeUndefined();
      expect(isInheritedName(key)).toBe(true);
    }
    expect(own(undefined, 'a')).toBeUndefined();
    expect(own(null, 'a')).toBeUndefined();
    expect(own(record, undefined)).toBeUndefined();
    expect(isInheritedName('ast_1')).toBe(false);
  });

  it('finds an entry that is really stored under such a name (a parsed document can hold the key "constructor")', () => {
    const record = JSON.parse('{"constructor":{"id":"constructor"},"__proto__":{"id":"__proto__"}}') as Record<string, { id: string }>;
    expect(own(record, 'constructor')).toEqual({ id: 'constructor' });
    expect(own(record, '__proto__')).toEqual({ id: '__proto__' });
    expect(own(record, 'toString')).toBeUndefined();
  });
});

describe('ops given an id that names an inherited member', () => {
  it('the reported case: rename_asset with "__proto__" is refused with not_found and ({}).name stays undefined', () => {
    const doc = createProject({ id: 'prj_x', name: 'X' });
    const e = failure(() => applyTransaction(doc, [{ op: 'rename_asset', args: { assetId: '__proto__', name: 'polluted' } }], { idSeed: 'a_', actor: 'agent:test' }));
    expect(e.code).toBe('not_found');
    expect(e.message).toContain('__proto__');
    expect(({} as { name?: string }).name).toBeUndefined();
    expect(protoDamage()).toEqual([]);
  });

  it('rename_asset, add_clip, remove_asset, add_effect (color.lut) and apply_lut refuse "__proto__", "constructor" and "toString" with not_found, in an empty library and in a full one', () => {
    const full = studio();
    for (const doc of [createProject({ id: 'prj_x', name: 'X' }), full.doc]) {
      for (const id of HOSTILE) {
        const calls: OpCall[] = [
          { op: 'rename_asset', args: { assetId: id, name: 'polluted' } },
          { op: 'add_clip', args: { assetId: id, start: f(300) } },
          { op: 'remove_asset', args: { assetId: id } },
        ];
        // the colour-table ops need a clip to be given at all
        if (doc === full.doc) calls.push({ op: 'add_effect', args: { clipId: full.clipId, type: 'color.lut', params: { lut: id } } }, { op: 'apply_lut', args: { clipId: full.clipId, assetId: id } });
        for (const call of calls) {
          const e = failure(() => tx(doc, [call]));
          expect([call.op, id, e.code]).toEqual([call.op, id, 'not_found']);
          expect(e.message).toContain(id);
          expect(protoDamage()).toEqual([]);
        }
      }
    }
    // the same ops still do their work with the real ids
    expect(tx(full.doc, [{ op: 'rename_asset', args: { assetId: full.assetId, name: 'b.mp4' } }]).doc.assets[full.assetId]!.name).toBe('b.mp4');
    expect(tx(full.doc, [{ op: 'apply_lut', args: { clipId: full.clipId, assetId: full.lutId } }]).summary).toBe('Applied colour table "film.cube"');
    expect(tx(full.doc, [{ op: 'remove_asset', args: { assetId: full.lutId } }]).doc.assets[full.lutId]).toBeUndefined();
  });

  it('every other lookup of a caller-supplied id answers not_found the same way: formats, markers, transcripts, analyses, sequences, recipe runs', () => {
    const s = studio();
    for (const id of HOSTILE) {
      const calls: [OpCall, boolean?][] = [
        [{ op: 'set_asset_colour', args: { assetId: id, readAs: 'bt601' } }],
        [{ op: 'update_variant', args: { variantId: id, name: 'polluted', width: 640 } }],
        [{ op: 'remove_variant', args: { variantId: id } }],
        [{ op: 'set_variant_override', args: { variantId: id, clipId: s.clipId, hidden: true } }],
        [{ op: 'set_variant_override', args: { variantId: s.variantId, clipId: id, hidden: true } }],
        [{ op: 'set_variant_phrase_text', args: { variantId: s.variantId, assetId: id, segmentId: s.segmentId, text: 'x' } }],
        [{ op: 'set_variant_phrase_text', args: { variantId: s.variantId, assetId: s.assetId, segmentId: id, text: 'x' } }],
        [{ op: 'update_marker', args: { markerId: id, label: 'polluted', color: 'red' } }],
        [{ op: 'remove_marker', args: { markerId: id } }],
        [{ op: 'edit_analysis', args: { assetId: id, kind: 'scenes' } }],
        [{ op: 'attach_analysis', args: { assetId: id, kind: 'scenes', method: 'm', params: {}, createdAt: 'now', times: [] } }, true],
        [{ op: 'set_transcript', args: { assetId: id, language: 'en', segments: [{ start: f(0), duration: f(30), text: 'x' }] } }],
        [{ op: 'import_transcript', args: { assetId: id, language: 'en', content: '1\n00:00:00,000 --> 00:00:01,000\nx\n' } }],
        [{ op: 'attach_word_timing', args: { assetId: id, segments: [{ segmentId: s.segmentId, approximate: false, words: [{ text: 'x', start: f(0), duration: f(1) }] }] } }, true],
        [{ op: 'correct_transcript', args: { assetId: id, segmentId: s.segmentId, text: 'x' } }],
        [{ op: 'delete_transcript_range', args: { assetId: id, fromWordId: s.fromWordId, toWordId: s.toWordId } }],
        [{ op: 'add_track', args: { sequenceId: id, kind: 'video' } }],
        [{ op: 'cut_range', args: { sequenceId: id, start: f(0), end: f(30) } }],
        [{ op: 'apply_recipe', args: { runId: id, recipeId: 'fixture', params: {}, steps: [], ops: [{ op: 'add_marker', args: { time: f(200) } }] } }, true],
      ];
      for (const [call, internal] of calls) {
        const e = failure(() => tx(s.doc, [call], internal));
        expect([call.op, id, e.code]).toEqual([call.op, id, 'not_found']);
        expect(protoDamage()).toEqual([]);
      }
    }
  });

  it('a recipe run can only be regenerated under the id of a run the project holds; without an id a new run is recorded', () => {
    const s = studio();
    const again = tx(s.doc, [{ op: 'apply_recipe', args: { runId: s.runId, recipeId: 'fixture', params: {}, steps: ['again'], ops: [{ op: 'add_marker', args: { time: f(200) } }] } }], true);
    expect(again.results[0]!.output!.runId).toBe(s.runId);
    expect(again.doc.recipeRuns[s.runId]!.steps).toEqual(['again']);
    expect(failure(() => tx(s.doc, [{ op: 'apply_recipe', args: { runId: 'run_nope', recipeId: 'fixture', params: {}, steps: [], ops: [{ op: 'add_marker', args: { time: f(200) } }] } }], true)).code).toBe('not_found');
    const fresh = tx(s.doc, [{ op: 'apply_recipe', args: { recipeId: 'fixture', params: {}, steps: [], ops: [{ op: 'add_marker', args: { time: f(200) } }] } }], true);
    expect(Object.keys(fresh.doc.recipeRuns)).toHaveLength(2);
    expect(oddPrototypes(fresh.doc)).toEqual([]);
  });

  it('a keyframed effect parameter is looked up the same way: delete_effect_keyframe with such a name finds no keyframe', () => {
    const s = studio();
    for (const param of HOSTILE) {
      expect(failure(() => tx(s.doc, [{ op: 'delete_effect_keyframe', args: { clipId: s.clipId, effectId: s.effectId, param, time: f(0) } }])).code).toBe('not_found');
      expect(failure(() => tx(s.doc, [{ op: 'set_effect_keyframe', args: { clipId: s.clipId, effectId: s.effectId, param, time: f(0), value: 0.01 } }])).code).toBe('invalid_args');
    }
    const removed = tx(s.doc, [{ op: 'delete_effect_keyframe', args: { clipId: s.clipId, effectId: s.effectId, param: 'radius', time: f(0) } }]);
    expect(removed.results[0]!.output).toEqual({ keyframeCount: 0 });
    expect(protoDamage()).toEqual([]);
  });

  it('such a name as a KEY inside arguments (as JSON.parse delivers it) is refused or dropped by the argument check, never copied onto anything', () => {
    const s = studio();
    for (const key of HOSTILE) {
      const calls: OpCall[] = [
        { op: 'add_effect', args: { clipId: s.clipId, type: 'blur.gaussian', params: JSON.parse(`{"${key}":{"polluted":true},"radius":0.05}`) } },
        { op: 'update_effect', args: { clipId: s.clipId, effectId: s.effectId, params: JSON.parse(`{"${key}":{"polluted":true}}`) } },
        { op: 'add_effect', args: JSON.parse(`{"clipId":"${s.clipId}","type":"blur.gaussian","${key}":{"polluted":true}}`) },
        { op: 'set_clip_transform', args: { clipId: s.clipId, transform: JSON.parse(`{"${key}":{"polluted":true},"x":0.1}`) } },
        { op: 'set_variant_override', args: { variantId: s.variantId, clipId: s.clipId, transform: JSON.parse(`{"${key}":1}`) } },
      ];
      for (const call of calls) {
        let doc: ProjectDocument | undefined;
        try { doc = tx(s.doc, [call]).doc; } catch (e) { expect(e).toBeInstanceOf(OpError); expect((e as OpError).code).toBe('invalid_args'); }
        if (doc) { expect(oddPrototypes(doc)).toEqual([]); expect(JSON.stringify(doc)).not.toContain('polluted'); }
        expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
        expect(protoDamage()).toEqual([]);
      }
    }
  });

  it('undo data that names such an id is refused, through a transaction and by restoreEntities itself, and never becomes the prototype of a record', () => {
    const s = studio();
    const states: [string, unknown][] = [
      ['asset', { kind: 'asset', asset: { ...video, id: '__proto__' } }],
      ['variant', { kind: 'variant', variant: { ...s.doc.variants[s.variantId]!, id: '__proto__' } }],
      ['marker', { kind: 'marker', marker: { ...s.doc.markers[s.markerId]!, id: '__proto__' } }],
      ['transcript', { kind: 'transcript', transcript: { ...s.doc.transcripts[s.assetId]!, assetId: '__proto__' } }],
      ['analysis', { kind: 'analysis', analysis: { ...s.doc.analyses[s.assetId]!, assetId: '__proto__' } }],
      ['recipeRun', { kind: 'recipeRun', run: { ...s.doc.recipeRuns[s.runId]!, id: '__proto__' } }],
    ];
    for (const [kind, state] of states) {
      // through a transaction (the guard answers first: the id is an argument named `id` or `assetId`)
      const e = failure(() => tx(s.doc, [{ op: 'restore_entities', args: { targets: [{ id: '__proto__', state }] } }], true));
      expect([kind, e.code]).toEqual([kind, 'not_found']);
      // the write side on its own: restoreEntities refuses to assign under the id instead of replacing a record's prototype
      const draft = structuredClone(s.doc);
      expect(() => restoreEntities(draft, [{ id: '__proto__', state: state as EntityState }]), kind).toThrow(/reserved/);
      expect(oddPrototypes(draft), kind).toEqual([]);
    }
    expect(protoDamage()).toEqual([]);
  });
});

// ---- every registered op, every string argument ----
type Json = Record<string, any>;
/** Arguments an op accepts, built from its published schema: ids are the fixture's, times are small frame counts, the rest the first allowed value. */
function sample(schema: Json, name: string, ids: Record<string, unknown>): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return sample(schema.anyOf.find((x: Json) => x.type !== 'null') ?? schema.anyOf[0], name, ids);
  if (schema.type === 'object') {
    if (schema.properties?.value && schema.properties?.timescale) return /duration|end|to$/i.test(name) ? f(60) : f(30);
    const out: Json = {};
    for (const [k, v] of Object.entries<Json>(schema.properties ?? {})) if (schema.required?.includes(k) || ids[k] !== undefined) out[k] = sample(v, k, ids);
    return out;
  }
  if (schema.type === 'array') return name in ids ? ids[name] : Array.from({ length: Math.max(1, schema.minItems ?? 1) }, () => sample(schema.items ?? {}, name.replace(/s$/, ''), ids));
  if (schema.type === 'string') return name in ids ? ids[name] : 'x'.repeat(Math.max(2, schema.minLength ?? 1));
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : Math.min(1, schema.maximum ?? 1));
  if (schema.type === 'boolean') return false;
  return {};
}
/** Every place in `args` that holds a string, as a path from the top. */
function stringPaths(v: unknown, path: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  if (typeof v === 'string') out.push(path);
  else if (Array.isArray(v)) v.forEach((x, i) => stringPaths(x, [...path, i], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) stringPaths(x, [...path, k], out);
  return out;
}
function withStringAt(args: unknown, path: (string | number)[], value: string): unknown {
  const copy = structuredClone(args) as any;
  let at = copy;
  for (const k of path.slice(0, -1)) at = at[k];
  at[path.at(-1)!] = value;
  return copy;
}

describe('every registered op', () => {
  it('answers such an id, in any string argument, with a typed refusal or an ordinary result: never another exception, never a change to Object.prototype or to a record\'s prototype', () => {
    const s = studio();
    const ids: Record<string, unknown> = {
      assetId: s.assetId, clipId: s.clipId, trackId: s.trackId, audioTrackId: s.audioTrackId, linkedTrackId: s.audioTrackId, sequenceId: 'seq_main', variantId: s.variantId, markerId: s.markerId,
      effectId: s.effectId, motionTrackId: s.motionTrackId, targetTrackId: s.trackId, eventId: s.eventId, personId: s.personId, groupId: s.groupId, segmentId: s.segmentId, fromWordId: s.fromWordId, toWordId: s.toWordId, runId: s.runId, presetId: TEXT_PRESETS[0]!.id, lookId: COLOR_LOOKS[0]!.id, type: 'blur.gaussian', param: 'radius',
      language: 'en', clipIds: [s.clipId, s.audioClipId], trackIds: [s.trackId], sourceTrackIds: [s.trackId], preferTrackIds: [s.trackId], removeClipIds: [s.textId], keepIds: [s.clipId],
    };
    // The clip or track an op is about, where it is not the picture clip on the picture track.
    const sound = { clipId: s.audioClipId }, title = { clipId: s.textId }, cue = { clipId: s.cueId }, soundTrack = { trackId: s.audioTrackId }, captions = { trackId: s.captionTrackId };
    const about: Record<string, Record<string, unknown>> = {
      apply_text_preset: title, update_text: title, set_text_animation: title, add_text: { trackId: undefined }, update_cue: cue, merge_cues: cue,
      set_volume_keyframe: sound, draw_volume: sound, delete_volume_keyframe: sound, set_clip_fades: sound, set_audio_crossfade: sound, fit_music: sound,
      set_track_audio: soundTrack, add_adjustment: { trackId: undefined }, set_clip_follow: title, set_text_fields: title,
      add_audio_effect: sound, apply_audio_preset: sound, update_audio_effect: { ...sound, effectId: s.audioEffectId }, remove_audio_effect: { ...sound, effectId: s.audioEffectId }, set_ducking: { ...soundTrack, sourceTrackIds: [s.trackId] }, set_caption_style: captions, apply_caption_look: captions, add_cue: captions,
    };
    // Arguments the schema alone cannot make meaningful.
    const exact: Record<string, unknown> = {
      import_asset: { asset: { ...video, contentHash: `sha256:${'c'.repeat(64)}` } },
      set_project_format: { width: 1280 },
      remove_asset: { assetId: s.lutId },
      add_clip: { sequenceId: 'seq_main', assetId: s.assetId, trackId: s.trackId, audioTrackId: s.audioTrackId, start: f(300) },
      update_track: { sequenceId: 'seq_main', trackId: s.trackId, name: 'Picture' },
      add_marker: { time: f(60), label: 'x' },
      add_variant: { profileId: 'square-1x1', name: 'Square' },
      duplicate_clips: { clipIds: [s.clipId, s.audioClipId], offset: f(300), preferTrackIds: [s.trackId] },
      set_effect_keyframe: { clipId: s.clipId, effectId: s.effectId, param: 'radius', time: f(30), value: 0.05 },
      add_audio_effect: { clipId: s.audioClipId, type: 'cleanup.dehum' },
      edit_motion_track: { motionTrackId: s.motionTrackId, name: 'Renamed' },
      set_asset_capture: { assetId: s.assetId, capture: { at: '2026-05-02' } },
      update_event: { eventId: s.eventId, name: 'Renamed trip' },
      set_text_fields: { clipId: s.textId, enabled: true },
      set_timeline_behaviour: { mainMagnet: true },
      update_sequence: { sequenceId: 'seq_main', name: 'Main edit' },
      remove_sequence: { sequenceId: s.shortId, withContents: true },
      update_person: { personId: s.personId, name: 'Dana B' },
      update_multicam: { groupId: s.groupId, name: 'Two cameras' },
      set_multicam_sync: { groupId: s.groupId, angleId: s.angleIds[1], pieceIndex: 0, clear: true },
      set_angle_look: { groupId: s.groupId, angleId: s.angleIds[0], clear: true },
      place_multicam: { groupId: s.groupId, at: f(0), angleId: s.angleIds[0], newSequence: { name: 'Program' } },
      set_keyframe_curve: { clipId: s.clipId, channels: [{ effectId: s.effectId, param: 'radius' }], times: [f(0)], side: 'after', easing: 'smooth' },
      replace_effect_keyframes: { clipId: s.clipId, effectId: s.effectId, param: 'radius', keys: null },
      attach_asset_capture: { assetId: s.assetId, capture: { at: '2026-05-03T09:00:00', utcOffsetMinutes: null, source: 'exif' }, overwrite: true },
      update_audio_effect: { clipId: s.audioClipId, effectId: s.audioEffectId, enabled: false },
      apply_audio_preset: { clipId: s.audioClipId, presetId: 'telephone' },
      set_effect_modulator: { clipId: s.clipId, effectId: s.effectId, param: 'radius', modulator: { depth: 0.05 } },
      import_captions: { sequenceId: 'seq_main', trackId: s.captionTrackId, content: '1\n00:00:05,000 --> 00:00:06,000\nhello\n' },
      add_effect: { clipId: s.clipId, type: 'color.lut', params: { lut: s.lutId } },
      apply_lut: { clipId: s.clipId, assetId: s.lutId },
      update_effect: { clipId: s.clipId, effectId: s.effectId, params: { radius: 0.05 } },
      delete_effect_keyframe: { clipId: s.clipId, effectId: s.effectId, param: 'radius', time: f(0) },
      set_variant_override: { variantId: s.variantId, clipId: s.textId, text: 'Other wording', textStyle: { fontFamily: 'Heebo' } },
      set_variant_phrase_text: { variantId: s.variantId, assetId: s.assetId, segmentId: s.segmentId, text: 'shorter' },
      correct_transcript: { assetId: s.assetId, segmentId: s.segmentId, text: 'one too' },
      delete_transcript_range: { assetId: s.assetId, fromWordId: s.fromWordId, toWordId: s.toWordId },
      attach_word_timing: { assetId: s.assetId, segments: [{ segmentId: s.segmentId, approximate: false, words: [{ text: 'one', start: f(0), duration: f(30) }] }] },
      edit_analysis: { assetId: s.assetId, kind: 'beats', add: [T.rt(4, 1)] },
      attach_analysis: { assetId: s.assetId, kind: 'scenes', method: 'm', params: {}, createdAt: 'now', times: [T.rt(1, 1)] },
      import_transcript: { assetId: s.assetId, language: 'en', content: '1\n00:00:00,000 --> 00:00:01,000\nhello\n' },
      apply_recipe: { runId: s.runId, recipeId: 'fixture', params: {}, steps: ['again'], removeClipIds: [], keepIds: [s.clipId], ops: [{ op: 'add_marker', args: { time: f(200) } }] },
      restore_entities: { targets: [{ id: s.markerId, state: null }] },
      split_clip: { clipId: s.clipId, at: f(60) },
      rename_asset: { assetId: s.assetId, name: 'b.mp4' },
      remove_marker: { markerId: s.markerId },
      update_marker: { markerId: s.markerId, label: 'x' },
      update_variant: { variantId: s.variantId, name: 'Square' },
      remove_variant: { variantId: s.variantId },
    };
    const ops = describeOps({ includeInternal: true });
    expect(ops.length).toBeGreaterThan(80);
    const attempt = (op: string, args: unknown) => { try { return { doc: tx(s.doc, [{ op, args }], true).doc }; } catch (error) { return { error }; } };
    let tried = 0;
    const worked: string[] = [], stubs: string[] = [], faults: string[] = [];
    for (const o of ops) {
      const base = exact[o.name] ?? sample(o.argsSchema as Json, '', { ...ids, ...about[o.name] });
      const first = attempt(o.name, base);
      if ('doc' in first) worked.push(o.name);
      // an op whose contract is registered before its body: no argument can make it do its work (it is swept all the same)
      else if (first.error instanceof OpError && /\bnot built yet\b/.test(first.error.message)) stubs.push(o.name);
      const paths = stringPaths(base);
      const variants: [string, unknown][] = [];
      for (const id of HOSTILE) {
        for (const path of paths) variants.push([`${path.join('.')}=${id}`, withStringAt(base, path, id)]);
        if (paths.length > 1) variants.push([`every string=${id}`, paths.reduce((args, path) => withStringAt(args, path, id), base)]);
      }
      for (const [what, args] of variants) {
        tried++;
        const r = attempt(o.name, args);
        if ('error' in r && !(r.error instanceof OpError)) faults.push(`${o.name} (${what}): ${String(r.error)}`);
        if ('doc' in r && oddPrototypes(r.doc).length) faults.push(`${o.name} (${what}): changed the prototype of ${oddPrototypes(r.doc).join(', ')}`);
        const damage = protoDamage();
        if (damage.length) { faults.push(`${o.name} (${what}): Object.prototype ${damage.join(', ')}`); for (const d of damage) if (d.startsWith('added ')) delete (Object.prototype as Record<string, unknown>)[d.slice(6)]; }
      }
    }
    expect(faults).toEqual([]);
    // The sweep is only worth something if the unmodified calls get past argument checks: most ops must do their work with them.
    expect(tried).toBeGreaterThan(400);
    expect(worked.length / (ops.length - stubs.length)).toBeGreaterThan(0.75);
    expect(stubs.length).toBeLessThan(ops.length / 10); // a stub-only registry would make the floor meaningless
    for (const must of ['rename_asset', 'add_clip', 'remove_marker', 'add_effect', 'apply_lut', 'update_variant', 'set_variant_override', 'set_variant_phrase_text', 'edit_analysis', 'correct_transcript', 'delete_transcript_range', 'delete_effect_keyframe', 'apply_recipe', 'restore_entities']) expect(worked).toContain(must);
  });
});

describe('a document that carries such an id', () => {
  it('is refused by validation: no asset, sequence, track, clip, marker, motion track or format may be named that way', () => {
    const s = studio();
    expect(validateProject(s.doc)).toEqual([]);
    for (const id of [...HOSTILE, 'hasOwnProperty']) {
      const clip = structuredClone(s.doc);
      findClip(clip, s.textId)!.clip.id = id;
      expect(validateProject(clip).map((i) => [i.code, i.ids])).toEqual([['reserved_id', [id]]]);
      const marker = structuredClone(s.doc);
      const m = marker.markers[s.markerId]!;
      delete marker.markers[s.markerId];
      Object.defineProperty(marker.markers, id, { value: { ...m, id }, enumerable: true, writable: true, configurable: true });
      expect(validateProject(marker).map((i) => i.code)).toEqual(['reserved_id']);
      // a motion track is kept by id like a marker
      const tracked = structuredClone(s.doc);
      const mt = tracked.motionTracks[s.motionTrackId]!;
      delete tracked.motionTracks[s.motionTrackId];
      Object.defineProperty(tracked.motionTracks, id, { value: { ...mt, id }, enumerable: true, writable: true, configurable: true });
      expect(validateProject(tracked).map((i) => i.code)).toEqual(['reserved_id']);
    }
    const mismatched = structuredClone(s.doc);
    mismatched.motionTracks.mtk_other = { ...mismatched.motionTracks[s.motionTrackId]!, id: 'mtk_b' };
    expect(validateProject(mismatched).map((i) => i.code)).toEqual(['key_mismatch']);
  });

  it('is not taken to refer to something: a clip of asset "__proto__", a main sequence "constructor", a marker in sequence "toString" are all dangling', () => {
    const s = studio();
    for (const id of HOSTILE) {
      const clip = structuredClone(s.doc);
      (findClip(clip, s.clipId)!.clip as { assetId: string }).assetId = id;
      expect(validateProject(clip).map((i) => i.code)).toContain('missing_asset');
      const main = structuredClone(s.doc);
      main.mainSequenceId = id;
      expect(validateProject(main).map((i) => i.code)).toContain('missing_sequence');
      const marker = structuredClone(s.doc);
      marker.markers[s.markerId]!.sequenceId = id;
      expect(validateProject(marker).map((i) => i.code)).toEqual(['missing_sequence']);
    }
  });
});

describe('a phrase or word named that way (data, as an imported transcript may carry it)', () => {
  it('validates, except "__proto__", which cannot key the records a phrase id keys', () => {
    const s = studio();
    for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
      const phrase = structuredClone(s.doc);
      phrase.transcripts[s.assetId]!.segments[0]!.id = id;
      expect(validateProject(phrase), id).toEqual([]);
      const word = structuredClone(s.doc);
      word.transcripts[s.assetId]!.segments[0]!.words[0]!.id = id;
      expect(validateProject(word), id).toEqual([]);
    }
    for (const where of ['phrase', 'word'] as const) {
      const d = structuredClone(s.doc);
      const seg = d.transcripts[s.assetId]!.segments[0]!;
      if (where === 'phrase') seg.id = '__proto__'; else seg.words[0]!.id = '__proto__';
      expect(validateProject(d).map((i) => i.code), where).toEqual(['reserved_id']);
    }
  });

  it('a format shows its own wording of such a phrase and otherwise the master wording, never an inherited value', () => {
    const s = studio();
    const d = structuredClone(s.doc);
    d.transcripts[s.assetId]!.segments[0]!.id = 'constructor';
    expect(validateProject(d)).toEqual([]);
    // the format rewords some other phrase but not this one: the master text stays (a plain lookup found the Object function here)
    d.variants[s.variantId]!.phraseText = { seg_elsewhere: 'other wording' };
    const plain = projectVariant(d, s.variantId).transcripts[s.assetId]!.segments[0]!;
    expect(plain.text).toBe('one two');
    expect(plain.words).toHaveLength(2);
    // the format's own wording of it is used (stored in the document: ops refuse such a segmentId before they run)
    d.variants[s.variantId]!.phraseText = { constructor: 'shorter' };
    expect(validateProject(d)).toEqual([]);
    expect(projectVariant(d, s.variantId).transcripts[s.assetId]!.segments[0]!.text).toBe('shorter');
    expect(protoDamage()).toEqual([]);
  });
});

describe('read helpers given such an id', () => {
  it('find nothing: no format, no timeline, no transcript, no duration, no recipe input, no lineage, no track, no translation', () => {
    const s = studio();
    for (const id of HOSTILE) {
      expect(() => projectVariant(s.doc, id)).toThrow(`variant ${id} not found`);
      expect(timeline(s.doc, id)).toBeNull();
      expect(transcriptView(s.doc, id)).toBeNull();
      expect(sequenceDuration(s.doc, id)).toEqual(T.ZERO);
      expect(timeLineage(s.doc, id)).toEqual({ rootAssetId: id, offset: T.ZERO, chain: [id] });
      expect(transcriptFor(s.doc, id)).toBeNull();
      expect(followedBeats(s.doc, 0, 10, id)).toEqual([]);
      expect(mainTrackOf(s.doc, id)).toBeUndefined();
      expect(staleTranslations(s.doc, id)).toEqual([]);
      expect(readingSpeedIssues(s.doc, id, {})).toEqual([]);
      let caught: unknown;
      try { planRecipe(s.doc, 'tidy-speech', { assetId: id }, { silences: { [id]: [] } }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(RecipeError);
      expect((caught as RecipeError).code).toBe('not_found');
    }
    expect(projectVariant(s.doc, s.variantId).settings.width).toBe(1080);
    expect(timeline(s.doc)!.sequenceId).toBe('seq_main');
    expect(transcriptView(s.doc, s.assetId)!.segments).toHaveLength(1);
    expect(protoDamage()).toEqual([]);
  });
});
