/**
 * The shared contracts of the life line (ADR-0021) that the lead pre-pass owns: the optional schema fields, the event entity
 * with exact undo, the structure checks of events, the operation registry rows with their argument schemas, and the refusal
 * table. Nothing here pins a placeholder body: what W1 builds is listed as todo and tested in its own files.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, CAPTURE_MAX_YEAR, CAPTURE_MIN_YEAR, CaptureSchema, clusterCaptures, createProject, creativeProjection, describeOps, diffEntities, entityMap, fieldSpans, findClip, getOp, isRealWallDate, LIFE_REFUSALS, lifeRefusal, LifeEventSchema, listOps,
  makeFieldIndex, MAX_CAPTURE_SHIFT_MINUTES, MAX_EVENT_FILES, MAX_LIFE_EVENTS,
  OpError, ProjectSchema, resolveFields, restoreEntities, SCHEMA_VERSION, stampText, summarize, TextClipSchema, timeline, validateProject, WALL_DATE, WALL_DATE_TIME, effectParams, findEffect,
  type Capture, type LifeEvent, type LifeRefusalKey, type OpCall, type ProjectDocument, type TextClip,
} from './index.ts';

const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `l${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (hash: string, capture?: Capture) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov, ...(capture ? { capture } : {}) });
const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const HANUKKAH: Capture = { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' };
/** A project with two dated videos, one undated video and a sound file; ids in that order. */
function project() {
  const r = tx(createProject({ id: 'prj_life', name: 'Life' }), [video('a', HANUKKAH), video('b', { at: '2024-03-24', utcOffsetMinutes: null, source: 'filename', circa: true }), video('c'), sound].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  return { doc: r.doc, ids: r.results.map((x) => x.output!.assetId as string) };
}
const event = (id: string, assetIds: string[], over: Partial<LifeEvent> = {}): LifeEvent => ({ id, name: '', afterSunset: null, assetIds, origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: false }, ...over });
/** A document that already holds events, as an archive made by a later build would (the operations that make them are W1's). */
const withEvents = (doc: ProjectDocument, events: LifeEvent[]): ProjectDocument => ({ ...structuredClone(doc), events: Object.fromEntries(events.map((e) => [e.id, e])) });

describe('life line: schema (optional fields, no version bump)', () => {
  it('the schema version is unchanged and a document from before this build still parses, with no events', () => {
    expect(SCHEMA_VERSION).toBe(2);
    const { events: _e, ...old } = createProject({ id: 'p', name: 'P' });
    const parsed = ProjectSchema.parse(old);
    expect(parsed.events).toEqual({});
    expect(validateProject(old as ProjectDocument)).toEqual([]);
    expect(entityMap(old as ProjectDocument).size).toBe(entityMap(parsed).size);
  });
  it('a capture is a wall-clock day or day and time: a real day in 1900–2100, never a zone suffix', () => {
    for (const at of ['2024-12-25', '2024-12-25T17:30:00', '2024-02-29', '1900-01-01', '2100-12-31T23:59:59']) expect(CaptureSchema.safeParse({ at, utcOffsetMinutes: null, source: 'manual' }).success, at).toBe(true);
    for (const at of ['2024-02-30', '2023-02-29', '2024-04-31', '1899-12-31', '2101-01-01', '2024-12-25T24:00:00', '2024-12-25T17:30', '2024-12-25T17:30:00Z', '2024-12-25T17:30:00+02:00', '2024-13-01', '24-12-25', ''])
      expect(CaptureSchema.safeParse({ at, utcOffsetMinutes: null, source: 'manual' }).success, at).toBe(false);
    expect(isRealWallDate('2000-02-29')).toBe(true); // divisible by 400
    expect(isRealWallDate('1900-02-29')).toBe(false); // divisible by 100 only
    expect(WALL_DATE.test('2024-12-25')).toBe(true);
    expect(WALL_DATE.test('2024-12-25T17:30:00')).toBe(false);
    expect(WALL_DATE_TIME.test('2024-12-25T17:30:00')).toBe(true);
    // strict: no location and no unknown key can ride along (GPS is not read or stored)
    expect(CaptureSchema.safeParse({ at: '2024-12-25', utcOffsetMinutes: null, source: 'exif', gps: { lat: 32, lon: 34 } }).success).toBe(false);
    expect(CaptureSchema.safeParse({ at: '2024-12-25', utcOffsetMinutes: 120, source: 'container', circa: true, assumedZone: 'Asia/Jerusalem', shiftedMinutes: -60 }).success).toBe(true);
    expect(CaptureSchema.safeParse({ at: '2024-12-25', utcOffsetMinutes: null, source: 'guess' }).success).toBe(false);
    expect(CaptureSchema.safeParse({ at: '2024-12-25', utcOffsetMinutes: null, source: 'manual', circa: false }).success).toBe(false);
  });
  it('the total a clock was moved by may be as large as the years a capture date can lie in, so shifts that keep the date inside them always fit', () => {
    // counted here year by year, not taken from the constant
    let days = 0;
    for (let y = CAPTURE_MIN_YEAR; y <= CAPTURE_MAX_YEAR; y++) days += isRealWallDate(`${y}-02-29`) ? 366 : 365;
    expect(days).toBe(73414);
    expect(MAX_CAPTURE_SHIFT_MINUTES).toBe(days * 1440);
    const moved = (shiftedMinutes: number) => CaptureSchema.safeParse({ at: '2014-12-28T17:30:00', utcOffsetMinutes: 120, source: 'container', shiftedMinutes }).success;
    // two calls the operation accepts, on one file (a camera clock ten years and an hour out): the file remembers their sum
    const args = getOp('shift_asset_captures')!.args;
    for (const minutes of [-5256000, -60]) expect(args.safeParse({ assetIds: ['a'], minutes }).success, String(minutes)).toBe(true);
    expect(moved(-5256000 - 60)).toBe(true);
    // the furthest a date can travel inside the years: the first minute of 1900 to the last minute of 2100, or back
    expect(moved(MAX_CAPTURE_SHIFT_MINUTES - 1)).toBe(true);
    expect(moved(-MAX_CAPTURE_SHIFT_MINUTES)).toBe(true);
    expect(moved(0)).toBe(true);
    expect(moved(MAX_CAPTURE_SHIFT_MINUTES + 1)).toBe(false);
    expect(moved(-MAX_CAPTURE_SHIFT_MINUTES - 1)).toBe(false);
    expect(moved(0.5)).toBe(false);
  });
  it('an asset carries its capture through import_asset, and an asset without one is stored exactly as before', () => {
    const { doc, ids } = project();
    expect(doc.assets[ids[0]!]!.capture).toEqual(HANUKKAH);
    expect('capture' in doc.assets[ids[2]!]!).toBe(false);
    expect(validateProject(doc)).toEqual([]);
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
  });
  it('an event stores only what a person typed or chose: one-line name, the sunset answer, its files and how it was made', () => {
    expect(LifeEventSchema.safeParse(event('evt_1', ['ast_1'])).success).toBe(true);
    expect(LifeEventSchema.safeParse(event('evt_1', ['ast_1'], { name: 'חנוכה אצל סבתא', afterSunset: true })).success).toBe(true);
    expect(LifeEventSchema.safeParse(event('evt_1', ['ast_1'], { name: 'two\nlines' })).success).toBe(false);
    expect(LifeEventSchema.safeParse(event('evt_1', [])).success).toBe(false);
    // no stored derived name: there is no `named` state to go stale
    expect(LifeEventSchema.safeParse({ ...event('evt_1', ['ast_1']), named: 'auto' }).success).toBe(false);
    expect(Object.keys(LifeEventSchema.shape).sort()).toEqual(['afterSunset', 'assetIds', 'id', 'name', 'origin']);
  });
  it('a title may be marked as holding live fields; absent is the only other state', () => {
    const base = { id: 'c', type: 'text', start: f(0), duration: f(30), transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, text: '{date}', style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.06, color: '#FFFFFF', align: 'center', direction: 'auto', lineHeight: 1.2, background: null, stroke: null, strokeFrac: 0 } };
    expect(TextClipSchema.safeParse(base).success).toBe(true);
    expect(TextClipSchema.safeParse({ ...base, fields: true }).success).toBe(true);
    expect(TextClipSchema.safeParse({ ...base, fields: false }).success).toBe(false);
  });
  it('the date stamp gains source, clock and dateOrder without defaults: an existing stamp keeps its stored parameters, and each value can go back', () => {
    const before = effectParams('stylize.date-stamp', {});
    expect(Object.keys(before).sort()).toEqual(['color', 'corner', 'glow', 'size', 'text']);
    expect(effectParams('stylize.date-stamp', { source: 'capture', clock: true, dateOrder: 'dmy' })).toMatchObject({ source: 'capture', clock: true, dateOrder: 'dmy' });
    expect(effectParams('stylize.date-stamp', { source: 'text', clock: false, dateOrder: 'ymd' })).toMatchObject({ source: 'text', clock: false, dateOrder: 'ymd' });
    expect(() => effectParams('stylize.date-stamp', { source: 'gps' })).toThrow();
    expect(findEffect('stylize.date-stamp')!.version).toBe(1);
    // through the operations: update_effect merges, so capture → text and clock on → off both work
    const { doc, ids } = project();
    let r = tx(doc, [{ op: 'add_clip', args: { assetId: ids[0]!, start: f(0), duration: f(60) } }]);
    const clipId = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture', clock: true } } }]);
    const effectId = r.results[0]!.output!.effectId as string;
    r = tx(r.doc, [{ op: 'update_effect', args: { clipId, effectId, params: { source: 'text', clock: false } } }]);
    expect(r.results[0]!.output!.params).toMatchObject({ source: 'text', clock: false });
  });
});

describe('life line: events as entities, validation and exact undo', () => {
  it('an event is an entity of its own; restoring the before-states of a change brings the document back exactly', () => {
    const { doc, ids } = project();
    const after = withEvents(doc, [event('evt_1', [ids[0]!, ids[1]!], { name: 'חנוכה', afterSunset: true })]);
    expect(validateProject(after)).toEqual([]);
    expect(entityMap(after).get('evt_1')).toEqual({ kind: 'lifeEvent', event: after.events.evt_1 });
    const changes = diffEntities(doc, after);
    expect(changes.map((c) => c.id)).toEqual(['evt_1']);
    const back = structuredClone(after);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
    const again = structuredClone(doc);
    restoreEntities(again, changes.map((c) => ({ id: c.id, state: c.after })));
    expect(creativeProjection(again)).toBe(creativeProjection(after));
    // a document stored before this build has no `events` key: restoring an event into it still works
    const { events: _e, ...old } = structuredClone(doc);
    restoreEntities(old as ProjectDocument, changes.map((c) => ({ id: c.id, state: c.after })));
    expect(creativeProjection(old as ProjectDocument)).toBe(creativeProjection(after));
  });
  it('a capture date rides on the asset entity, so setting or changing one is undone through the asset', () => {
    const { doc, ids } = project();
    const after = structuredClone(doc);
    after.assets[ids[2]!]!.capture = { at: '2021-06-01', utcOffsetMinutes: null, source: 'manual' };
    const changes = diffEntities(doc, after);
    expect(changes.map((c) => c.id)).toEqual([ids[2]]);
    const back = structuredClone(after);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(back.assets[ids[2]!]!.capture).toBeUndefined();
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
  });
  it('validation: an event\'s key is its id, its files exist and are pictures or videos, and a file is in one event only', () => {
    const { doc, ids } = project();
    const codes = (d: ProjectDocument) => validateProject(d).map((i) => i.code);
    expect(codes(withEvents(doc, [event('evt_1', [ids[0]!]), event('evt_2', [ids[1]!, ids[2]!])]))).toEqual([]);
    expect(codes({ ...doc, events: { evt_x: event('evt_1', [ids[0]!]) } })).toEqual(['key_mismatch']);
    expect(codes(withEvents(doc, [event('evt_1', ['ast_gone'])]))).toEqual(['life_event_asset']);
    expect(codes(withEvents(doc, [event('evt_1', [ids[3]!])]))).toEqual(['life_event_asset']); // a sound file
    expect(codes(withEvents(doc, [event('evt_1', ['constructor'])]))).toEqual(['life_event_asset']); // not a file: a name every object answers to
    expect(codes(withEvents(doc, [event('evt_1', [ids[0]!]), event('evt_2', [ids[0]!])]))).toEqual(['life_event_overlap']);
    expect(codes(withEvents(doc, [event('evt_1', [ids[0]!, ids[0]!])]))).toEqual(['life_event_overlap']);
    expect(codes(withEvents(doc, [event(ids[0]!, [ids[0]!])]))).toEqual(['duplicate_id']); // an event id is not another entity's id
    const many = withEvents(doc, Array.from({ length: MAX_LIFE_EVENTS + 1 }, (_, i) => event(`evt_${i}`, [ids[0]!])));
    expect(codes(many)).toContain('life_event_limit');
  });
  it('validation: a capture or an event the stored format cannot hold is an issue, so no operation can commit a project that would not open again', () => {
    const { doc, ids } = project();
    const codes = (d: ProjectDocument) => validateProject(d).map((i) => i.code);
    const withCapture = (capture: Capture): ProjectDocument => { const d = structuredClone(doc); d.assets[ids[0]!]!.capture = capture; return d; };
    /** The same project with `count` more pictures in its library. */
    const withPictures = (count: number) => {
      const d = structuredClone(doc);
      const more = Array.from({ length: count }, (_, i) => `ast_p${i}`);
      for (const id of more) d.assets[id] = { ...structuredClone(d.assets[ids[0]!]!), id };
      return { d, more };
    };
    // the store writes a committed document as it is and parses it only when it is read again, so validation has to agree with the schema here
    const cases: [string, ProjectDocument, string[]][] = [
      ['a total within the bound', withCapture({ ...HANUKKAH, shiftedMinutes: -5256060 }), []],
      ['the largest total', withCapture({ ...HANUKKAH, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES }), []],
      ['a total past the bound', withCapture({ ...HANUKKAH, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES + 1 }), ['life_capture']],
      ['a total that is not whole minutes', withCapture({ ...HANUKKAH, shiftedMinutes: 0.5 }), ['life_capture']],
      ['a date moved out of the years', withCapture({ ...HANUKKAH, at: '2101-01-01T00:00:09' }), ['life_capture']],
      ['a day that does not exist', withCapture({ ...HANUKKAH, at: '2024-02-30' }), ['life_capture']],
      ['an offset no zone has', withCapture({ ...HANUKKAH, utcOffsetMinutes: 900 }), ['life_capture']],
      ['an event without files', withEvents(doc, [event('evt_1', [])]), ['life_event_shape']],
      ['an event with a name of two lines', withEvents(doc, [event('evt_1', [ids[0]!], { name: 'a\nb' })]), ['life_event_shape']],
    ];
    const full = withPictures(MAX_EVENT_FILES);
    cases.push(['an event with as many files as it may hold', withEvents(full.d, [event('evt_1', full.more)]), []]);
    cases.push(['an event with one file too many', withEvents(full.d, [event('evt_1', [...full.more, ids[0]!])]), ['life_event_shape']]);
    for (const [what, d, expected] of cases) {
      expect(codes(d), what).toEqual(expected);
      expect(ProjectSchema.safeParse(d).success, what).toBe(expected.length === 0);
    }
    // the issue says which file or event, and what is wrong with it
    const issue = validateProject(withCapture({ ...HANUKKAH, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES + 1 }))[0]!;
    expect(issue.ids).toEqual([ids[0]]);
    expect(issue.message).toContain('shiftedMinutes');
    expect(validateProject(withEvents(full.d, [event('evt_1', [...full.more, ids[0]!])]))[0]).toMatchObject({ ids: ['evt_1'], message: expect.stringContaining('assetIds') });
    // through a transaction: whatever an operation leaves behind, a document like these is refused, typed, and nothing is committed
    for (const bad of [withCapture({ ...HANUKKAH, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES + 1 }), withEvents(doc, [event('evt_1', [])])]) {
      let thrown: unknown;
      try { tx(bad, [{ op: 'add_text', args: { text: 'T', start: f(0), duration: f(30) } }]); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(OpError);
      expect((thrown as OpError).code).toBe('invalid_result');
    }
  });
  it('get_summary lists each file\'s capture and the events; get_timeline marks a title that holds fields', () => {
    const { doc, ids } = project();
    const s = summarize(withEvents(doc, [event('evt_1', [ids[0]!], { name: 'חנוכה', afterSunset: true })]));
    expect(s.assets.find((a) => a.id === ids[0])!.capture).toEqual({ at: '2024-12-25T17:30:00', source: 'container', circa: false });
    expect(s.assets.find((a) => a.id === ids[1])!.capture).toEqual({ at: '2024-03-24', source: 'filename', circa: true });
    expect('capture' in s.assets.find((a) => a.id === ids[2])!).toBe(false);
    expect(s.events).toMatchObject([{ id: 'evt_1', name: 'חנוכה', files: 1, afterSunset: true, edited: false }]);
    expect(summarize(doc).events).toEqual([]);
    const titled = tx(doc, [{ op: 'add_text', args: { text: 'T', start: f(0), duration: f(30) } }]).doc;
    const text = timeline(titled)!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text')!;
    expect('fields' in text).toBe(false);
  });
  it('remove_asset still works for a file that is in no event and has no dated copies', () => {
    const { doc, ids } = project();
    const r = tx(doc, [{ op: 'remove_asset', args: { assetId: ids[2]! } }]);
    expect(Object.keys(r.doc.assets)).not.toContain(ids[2]);
    expect(r.affectedIds).toEqual([ids[2]]);
  });
});

describe('life line: operation registry and refusal table', () => {
  const PUBLIC = ['set_asset_capture', 'shift_asset_captures', 'set_text_fields', 'cluster_events', 'add_event', 'update_event', 'remove_event'];
  it('seven public operations and one internal one are registered at version 1; people operations are not', () => {
    for (const name of PUBLIC) { const def = getOp(name); expect(def, name).toBeDefined(); expect(def!.version, name).toBe(1); expect(def!.internal, name).toBeFalsy(); expect(def!.description.length, name).toBeGreaterThan(40); }
    expect(getOp('attach_asset_capture')!.internal).toBe(true);
    expect(describeOps().map((o) => o.name)).toEqual(expect.arrayContaining(PUBLIC));
    expect(describeOps().map((o) => o.name)).not.toContain('attach_asset_capture');
    // scope cut: people wait for the owner's approval; "make it plain text" is a helper that returns literal operations, not an operation
    for (const name of ['add_person', 'update_person', 'remove_person', 'freeze_text_fields']) expect(listOps().some((o) => o.name === name), name).toBe(false);
    // an internal operation is refused for an API caller before it runs
    expect(() => tx(createProject({ id: 'p', name: 'P' }), [{ op: 'attach_asset_capture', args: { assetId: 'ast_1', capture: HANUKKAH } }])).toThrow(/internal/);
  });
  it('the argument schemas accept what the contract allows and refuse the rest before any body runs', () => {
    const ok = (op: string, args: unknown) => expect(getOp(op)!.args.safeParse(args).success, `${op} ${JSON.stringify(args)}`).toBe(true);
    const no = (op: string, args: unknown) => expect(getOp(op)!.args.safeParse(args).success, `${op} ${JSON.stringify(args)}`).toBe(false);
    ok('set_asset_capture', { assetId: 'a', capture: null });
    ok('set_asset_capture', { assetId: 'a', capture: { at: '2024-12-25' } });
    ok('set_asset_capture', { assetId: 'a', capture: { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, circa: true } });
    ok('set_asset_capture', { assetId: 'a', capture: { at: '2024-02-30' } }); // the shape passes; the body refuses the day (noSuchDay)
    no('set_asset_capture', { assetId: 'a', capture: { at: '2024-12-25T17:30:00Z' } });
    no('set_asset_capture', { assetId: 'a', capture: { at: '2024-12-25', source: 'exif' } });
    no('set_asset_capture', { assetId: 'a' });
    ok('shift_asset_captures', { assetIds: ['a', 'b'], minutes: -60 });
    no('shift_asset_captures', { assetIds: ['a'], minutes: 0 });
    no('shift_asset_captures', { assetIds: [], minutes: 60 });
    no('shift_asset_captures', { assetIds: ['a'], minutes: 1.5 });
    no('shift_asset_captures', { assetIds: Array.from({ length: 501 }, (_, i) => `a${i}`), minutes: 60 });
    ok('shift_asset_captures', { assetIds: ['a'], minutes: -5256000 });
    no('shift_asset_captures', { assetIds: ['a'], minutes: 5256001 });
    ok('attach_asset_capture', { assetId: 'a', capture: HANUKKAH, overwrite: true });
    no('attach_asset_capture', { assetId: 'a', capture: { at: '2024-02-30', utcOffsetMinutes: null, source: 'exif' } });
    ok('set_text_fields', { clipId: 'c', enabled: true });
    no('set_text_fields', { clipId: 'c' });
    ok('cluster_events', {});
    ok('cluster_events', { gapMinutes: 30 });
    no('cluster_events', { gapMinutes: 29 });
    no('cluster_events', { gapMinutes: 1441 });
    ok('add_event', { assetIds: ['a'] });
    ok('add_event', { assetIds: ['a'], name: 'חנוכה' });
    const files = (count: number) => Array.from({ length: count }, (_, i) => `a${i}`);
    ok('add_event', { assetIds: files(MAX_EVENT_FILES) });
    no('add_event', { assetIds: files(MAX_EVENT_FILES + 1) });
    ok('update_event', { eventId: 'e', addAssetIds: files(MAX_EVENT_FILES) }); // the shape passes; the body refuses what the event cannot hold (eventTooManyFiles)
    no('update_event', { eventId: 'e', addAssetIds: files(MAX_EVENT_FILES + 1) });
    no('add_event', { assetIds: [] });
    no('add_event', { assetIds: ['a'], name: 'a\nb' });
    ok('update_event', { eventId: 'e', afterSunset: null });
    ok('update_event', { eventId: 'e', name: '', addAssetIds: ['a'], removeAssetIds: ['b'] });
    no('update_event', { eventId: 'e', afterSunset: 'yes' });
    ok('remove_event', { eventId: 'e' });
    no('remove_event', {});
  });
  it('every refusal has an existing error code and a fixed English sentence; lifeRefusal builds the typed error with its hint', () => {
    const codes = new Set(['not_found', 'invalid_args', 'incompatible', 'out_of_bounds']);
    for (const [key, r] of Object.entries(LIFE_REFUSALS)) expect(codes.has(r.code), key).toBe(true);
    const e = lifeRefusal('shiftDayOnly', { assetIds: ['a'] }, 2);
    expect(e).toBeInstanceOf(OpError);
    expect(e.toJSON()).toEqual({ code: 'incompatible', message: '2 of the listed file(s) have a date without a time, which moves by whole days only', details: { assetIds: ['a'] }, hint: 'Shift by a multiple of 1440 minutes, or give those files a time first (set_asset_capture).' });
    expect(lifeRefusal('eventNotFound', { eventId: 'evt_9' }, 'evt_9').message).toBe('event evt_9 not found');
    expect(lifeRefusal('tooManyEvents', {}).message).toBe(`a project holds at most ${MAX_LIFE_EVENTS} events`);
    // what an argument schema lets through and the stored format cannot hold has a refusal of its own
    expect(lifeRefusal('shiftTooFar', { assetIds: ['a'] }, 1).toJSON()).toMatchObject({ code: 'out_of_bounds', message: `1 of the listed file(s) would have their clock moved by more than ${MAX_CAPTURE_SHIFT_MINUTES} minutes in all` });
    expect(lifeRefusal('eventTooManyFiles', { eventId: 'evt_1' }).toJSON()).toMatchObject({ code: 'out_of_bounds', message: `an event holds at most ${MAX_EVENT_FILES} files` });
    expect(MAX_EVENT_FILES).toBe(5000);
  });

  // The bodies are W1's (packages/core/src/lifeOps.test.ts and the files beside it hold the full tests); here, one check of each promise the contract made:
  const refused = (doc: ProjectDocument, ops: OpCall[], internal = false): OpError => { try { tx(doc, ops, internal); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error(`not refused: ${JSON.stringify(ops).slice(0, 160)}`); };
  /** The project with a clip of the first video under a title, and a copy of that video that keeps its timing from 2 s on. */
  function scene() {
    const p = project();
    const copy = { ...video('d'), provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_t', capabilityId: 'test.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [p.ids[0]!], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: T.rt(2, 1), audio: 'source-copied' } } };
    const lut = { kind: 'lut' as const, name: 'look.cube', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance: prov };
    let r = tx(p.doc, [{ op: 'import_asset', args: { asset: copy } }, { op: 'import_asset', args: { asset: lut } }], true);
    const [copyId, lutId] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: p.ids[0]!, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: '{date}', start: f(0), duration: f(60) } }]);
    const [a, b, c, s] = p.ids as [string, string, string, string];
    return { doc: r.doc, a, b, c, s, copyId, lutId, clipId: r.results[0]!.output!.clipId as string, titleId: r.results[1]!.output!.clipId as string };
  }
  it('every refusal of LIFE_REFUSALS is provoked through its operation, and nothing else is thrown', () => {
    const x = scene();
    const on: OpCall = { op: 'set_text_fields', args: { clipId: x.titleId, enabled: true } };
    const text = (t: string): OpCall => ({ op: 'update_text', args: { clipId: x.titleId, text: t } });
    const made = tx(x.doc, [{ op: 'add_event', args: { assetIds: [x.a, x.b] } }]);
    const eventId = made.results[0]!.output!.eventId as string;
    const drifted = structuredClone(x.doc);
    drifted.assets[x.a]!.capture = { ...HANUKKAH, shiftedMinutes: -MAX_CAPTURE_SHIFT_MINUTES };
    const crowded = structuredClone(x.doc);
    const many = Array.from({ length: MAX_EVENT_FILES }, (_, i) => `ast_m${i}`);
    for (const id of many) crowded.assets[id] = { ...structuredClone(crowded.assets[x.c]!), id };
    crowded.events = { evt_big: event('evt_big', many) };
    const L = LIFE_REFUSALS;
    /** For each refusal: the document, the call, and the sentence of the table it must be refused with. */
    const cases: Record<LifeRefusalKey, [ProjectDocument, OpCall[], string, boolean?]> = {
      assetNotFound: [x.doc, [{ op: 'attach_asset_capture', args: { assetId: 'ast_none', capture: HANUKKAH } }], L.assetNotFound.message('ast_none'), true],
      eventNotFound: [x.doc, [{ op: 'remove_event', args: { eventId: 'evt_none' } }], L.eventNotFound.message('evt_none')],
      lutHasNoDate: [x.doc, [{ op: 'set_asset_capture', args: { assetId: x.lutId, capture: { at: '2024-12-25' } } }], L.lutHasNoDate.message()],
      noSuchDay: [x.doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: { at: '2024-02-30' } } }], L.noSuchDay.message()],
      dateOutOfRange: [x.doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: { at: '1850-06-01' } } }], L.dateOutOfRange.message()],
      captureUnchanged: [tx(x.doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: { at: '2021-06-01' } } }]).doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: { at: '2021-06-01' } } }], L.captureUnchanged.message()],
      noCaptureToRemove: [x.doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: null } }], L.noCaptureToRemove.message()],
      listedTwice: [x.doc, [{ op: 'shift_asset_captures', args: { assetIds: [x.a, x.a], minutes: 60 } }], L.listedTwice.message()],
      shiftNoDate: [x.doc, [{ op: 'shift_asset_captures', args: { assetIds: [x.c], minutes: 60 } }], L.shiftNoDate.message(1)],
      shiftDayOnly: [x.doc, [{ op: 'shift_asset_captures', args: { assetIds: [x.b], minutes: 60 } }], L.shiftDayOnly.message(1)],
      shiftInherited: [x.doc, [{ op: 'shift_asset_captures', args: { assetIds: [x.copyId], minutes: 60 } }], L.shiftInherited.message(1)],
      shiftTooFar: [drifted, [{ op: 'shift_asset_captures', args: { assetIds: [x.a], minutes: -60 } }], L.shiftTooFar.message(1)],
      notATitle: [x.doc, [{ op: 'set_text_fields', args: { clipId: x.clipId, enabled: true } }], L.notATitle.message()],
      fieldsAlready: [x.doc, [{ op: 'set_text_fields', args: { clipId: x.titleId, enabled: false } }], L.fieldsAlready.message(false)],
      notFields: [x.doc, [text('{weather}'), on], L.notFields.message('{weather}')],
      personFields: [x.doc, [text('{age:per_1}'), on], L.personFields.message('{age:per_1}')],
      fieldsStillThere: [tx(x.doc, [on]).doc, [{ op: 'set_text_fields', args: { clipId: x.titleId, enabled: false } }], L.fieldsStillThere.message()],
      noDatedFiles: [tx(createProject({ id: 'p', name: 'P' }), [{ op: 'import_asset', args: { asset: video('a') } }], true).doc, [{ op: 'cluster_events', args: {} }], L.noDatedFiles.message()],
      tooManyEvents: [withEvents(x.doc, Array.from({ length: MAX_LIFE_EVENTS }, (_, i) => event(`evt_${i}`, [x.a]))), [{ op: 'add_event', args: { assetIds: [x.b] } }], L.tooManyEvents.message()],
      eventFileKind: [x.doc, [{ op: 'add_event', args: { assetIds: [x.s] } }], L.eventFileKind.message()],
      eventLastFile: [made.doc, [{ op: 'update_event', args: { eventId, removeAssetIds: [x.a, x.b] } }], L.eventLastFile.message()],
      eventTooManyFiles: [crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [x.a] } }], L.eventTooManyFiles.message()],
      eventNothingToChange: [made.doc, [{ op: 'update_event', args: { eventId } }], L.eventNothingToChange.message()],
      eventFileNotIn: [made.doc, [{ op: 'update_event', args: { eventId, removeAssetIds: [x.c] } }], L.eventFileNotIn.message()],
      eventAddAndRemove: [made.doc, [{ op: 'update_event', args: { eventId, addAssetIds: [x.c], removeAssetIds: [x.c] } }], L.eventAddAndRemove.message()],
    };
    expect(Object.keys(cases).sort()).toEqual(Object.keys(LIFE_REFUSALS).sort());
    for (const [key, [doc, ops, message, internal]] of Object.entries(cases) as [LifeRefusalKey, [ProjectDocument, OpCall[], string, boolean?]][]) {
      const before = JSON.stringify(doc);
      const e = refused(doc, ops, internal);
      expect(e.toJSON(), key).toMatchObject({ code: LIFE_REFUSALS[key].code, message });
      expect(e.hint, key).toBe(LIFE_REFUSALS[key].hint);
      expect(JSON.stringify(doc), key).toBe(before); // a refusal changes nothing
    }
  });
  it('undo then redo of each operation restores the creative projection exactly', () => {
    const x = scene();
    const made = tx(x.doc, [{ op: 'add_event', args: { assetIds: [x.a] } }]);
    const eventId = made.results[0]!.output!.eventId as string;
    const steps: [string, ProjectDocument, OpCall[], boolean?][] = [
      ['set_asset_capture', x.doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: { at: '2021-06-01T08:00:00', utcOffsetMinutes: 180, circa: true } } }]],
      ['shift_asset_captures', x.doc, [{ op: 'shift_asset_captures', args: { assetIds: [x.a, x.b], minutes: -2880 } }]],
      ['attach_asset_capture', x.doc, [{ op: 'attach_asset_capture', args: { assetId: x.c, capture: HANUKKAH } }], true],
      ['set_text_fields', x.doc, [{ op: 'set_text_fields', args: { clipId: x.titleId, enabled: true } }]],
      ['cluster_events', made.doc, [{ op: 'cluster_events', args: { gapMinutes: 30 } }]],
      ['add_event', made.doc, [{ op: 'add_event', args: { assetIds: [x.a, x.c], name: 'חנוכה' } }]], // empties the event that held the first file
      ['update_event', made.doc, [{ op: 'update_event', args: { eventId, name: 'חנוכה', afterSunset: true, addAssetIds: [x.b] } }]],
      ['remove_event', made.doc, [{ op: 'remove_event', args: { eventId } }]],
    ];
    expect(steps.map((st) => st[0]).sort()).toEqual([...PUBLIC, 'attach_asset_capture'].sort());
    for (const [op, before, ops, internal] of steps) {
      const after = tx(before, ops, internal).doc;
      expect(creativeProjection(after), op).not.toBe(creativeProjection(before));
      const changes = diffEntities(before, after);
      const back = structuredClone(after);
      restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
      expect(creativeProjection(back), `${op}: undo`).toBe(creativeProjection(before));
      restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.after })));
      expect(creativeProjection(back), `${op}: redo`).toBe(creativeProjection(after));
      expect(validateProject(after), op).toEqual([]);
      expect(ProjectSchema.safeParse(after).success, op).toBe(true);
    }
  });
  it('remove_asset takes the file out of its event (an emptied event goes) and hands its capture date down to its copies', () => {
    const x = scene();
    const base = tx(x.doc, [{ op: 'delete_clip', args: { clipId: x.clipId } }, { op: 'add_event', args: { assetIds: [x.a] } }, { op: 'add_event', args: { assetIds: [x.b, x.c] } }]);
    const [alone, pair] = [base.results[1]!.output!.eventId as string, base.results[2]!.output!.eventId as string];
    const r = tx(base.doc, [{ op: 'remove_asset', args: { assetId: x.a } }, { op: 'remove_asset', args: { assetId: x.b } }]);
    expect(Object.keys(r.doc.events)).toEqual([pair]);
    expect(r.doc.events[pair]!.assetIds).toEqual([x.c]);
    expect(r.doc.assets[x.copyId]!.capture).toEqual({ ...HANUKKAH, at: '2024-12-25T17:30:02' }); // what it showed before, now its own
    expect([...r.affectedIds].sort()).toEqual([x.a, x.b, x.copyId, alone, pair].sort());
    const changes = diffEntities(base.doc, r.doc);
    const back = structuredClone(r.doc);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(base.doc));
  });
  it('shift_asset_captures refuses shiftTooFar for a file whose stored total plus the step passes MAX_CAPTURE_SHIFT_MINUTES, and set_asset_capture starts the total again', () => {
    const x = scene();
    const drifted = structuredClone(x.doc);
    drifted.assets[x.a]!.capture = { ...HANUKKAH, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES - 59 };
    expect(refused(drifted, [{ op: 'shift_asset_captures', args: { assetIds: [x.a], minutes: 60 } }]).message).toBe(LIFE_REFUSALS.shiftTooFar.message(1));
    expect(tx(drifted, [{ op: 'shift_asset_captures', args: { assetIds: [x.a], minutes: 59 } }]).doc.assets[x.a]!.capture!.shiftedMinutes).toBe(MAX_CAPTURE_SHIFT_MINUTES);
    const reset = tx(drifted, [{ op: 'set_asset_capture', args: { assetId: x.a, capture: { at: HANUKKAH.at } } }]).doc;
    expect('shiftedMinutes' in reset.assets[x.a]!.capture!).toBe(false);
    expect(tx(reset, [{ op: 'shift_asset_captures', args: { assetIds: [x.a], minutes: 60 } }]).doc.assets[x.a]!.capture).toEqual({ at: '2024-12-25T18:30:00', utcOffsetMinutes: null, source: 'manual', shiftedMinutes: 60 });
    // shifts that keep a date inside the years can never reach the bound: from the first minute of 1900 to the last of 2100, a step at a time
    let d = tx(x.doc, [{ op: 'set_asset_capture', args: { assetId: x.c, capture: { at: '1900-01-01T00:00:00' } } }]).doc;
    for (let moved = 0; moved + 5256000 < MAX_CAPTURE_SHIFT_MINUTES; moved += 5256000) d = tx(d, [{ op: 'shift_asset_captures', args: { assetIds: [x.c], minutes: 5256000 } }]).doc;
    d = tx(d, [{ op: 'shift_asset_captures', args: { assetIds: [x.c], minutes: MAX_CAPTURE_SHIFT_MINUTES - 1 - d.assets[x.c]!.capture!.shiftedMinutes! } }]).doc;
    expect(d.assets[x.c]!.capture).toMatchObject({ at: '2100-12-31T23:59:00', shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES - 1 });
    expect(refused(d, [{ op: 'shift_asset_captures', args: { assetIds: [x.c], minutes: 1 } }]).message).toBe(LIFE_REFUSALS.dateOutOfRange.message()); // the year, before the total
    expect(ProjectSchema.safeParse(d).success).toBe(true);
  });
  it('update_event refuses eventTooManyFiles when the event would end with more than MAX_EVENT_FILES files; clusterCaptures cuts a longer run into clusters of at most that many', () => {
    const x = scene();
    const crowded = structuredClone(x.doc);
    const many = Array.from({ length: MAX_EVENT_FILES }, (_, i) => `ast_m${String(i).padStart(4, '0')}`);
    for (const [i, id] of many.entries()) crowded.assets[id] = { ...structuredClone(crowded.assets[x.c]!), id, capture: { at: `2024-07-01T${String(6 + Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, utcOffsetMinutes: null, source: 'manual' } };
    crowded.events = { evt_big: event('evt_big', many) };
    expect(validateProject(crowded)).toEqual([]);
    expect(refused(crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [x.a] } }]).toJSON()).toMatchObject({ code: 'out_of_bounds', message: `an event holds at most ${MAX_EVENT_FILES} files`, details: { eventId: 'evt_big' } });
    // counted after the call's own removals, and a file it already holds is not counted twice
    expect(tx(crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [x.a, many[5]!], removeAssetIds: [many[0]!] } }]).doc.events.evt_big!.assetIds.length).toBe(MAX_EVENT_FILES);
    expect(refused(crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [x.a, x.b], removeAssetIds: [many[0]!] } }]).message).toBe(LIFE_REFUSALS.eventTooManyFiles.message());
    // the arrangement never refuses for size: one run of 5000 files a second apart, and a file in the minute after them, become two events
    const one = structuredClone(crowded);
    one.events = {};
    one.assets[x.c]!.capture = { at: '2024-07-01T07:24:00', utcOffsetMinutes: null, source: 'manual' }; // the last of them is at 07:23:19
    const r = tx(one, [{ op: 'cluster_events', args: { gapMinutes: 30 } }]);
    const long = Object.values(r.doc.events).filter((e) => e.assetIds.some((id) => id === x.c || many.includes(id))).map((e) => e.assetIds);
    expect(long.map((ids) => ids.length)).toEqual([MAX_EVENT_FILES, 1]);
    expect(long[0]).toEqual(many);
    expect(long[1]).toEqual([x.c]);
    expect(ProjectSchema.safeParse(r.doc).success).toBe(true);
    const run = Array.from({ length: MAX_EVENT_FILES + 1 }, (_, i) => ({ assetId: `f${String(i).padStart(5, '0')}`, wall: '2024-07-01T06:00:00' }));
    expect(clusterCaptures(run, 30).map((c) => c.length)).toEqual([MAX_EVENT_FILES, 1]);
  });
  it('update_text + set_text_fields in one transaction gives the same document as two transactions (no cache on a draft)', () => {
    const x = scene();
    const text: OpCall = { op: 'update_text', args: { clipId: x.titleId, text: '{{כך}} {date:numeric}' } }, on: OpCall = { op: 'set_text_fields', args: { clipId: x.titleId, enabled: true } };
    const together = applyTransaction(x.doc, [text, on], { idSeed: 'k_', actor: 'test' }).doc;
    const apart = applyTransaction(applyTransaction(x.doc, [text], { idSeed: 'k_', actor: 'test' }).doc, [on], { idSeed: 'k2_', actor: 'test' }).doc;
    expect(creativeProjection(together)).toBe(creativeProjection(apart));
    const clip = findClip(together, x.titleId)!.clip as TextClip;
    expect(resolveFields(together, together.mainSequenceId, clip, f(0)).text).toBe('{כך} 25.12.2024');
    // and the other way round in one transaction: the text the second operation checks is the one the first wrote
    const off = applyTransaction(together, [{ op: 'update_text', args: { clipId: x.titleId, text: '{{כך}}' } }, { op: 'set_text_fields', args: { clipId: x.titleId, enabled: false } }], { idSeed: 'k3_', actor: 'test' }).doc;
    expect((findClip(off, x.titleId)!.clip as TextClip).text).toBe('{כך}');
    // a kept index of the document before does not leak into the document after
    const index = makeFieldIndex(x.doc);
    expect(resolveFields(together, together.mainSequenceId, clip, f(0), { index }).text).toBe('{כך} 25.12.2024');
  });
  it('a title without `fields` and every earlier fixture resolve to their stored text unchanged', () => {
    // this file's own fixtures, a document from before this build, and titles whose text holds every kind of brace group
    const x = scene();
    const texts = ['{date}', 'a {date} b {{c}}', '{weather} {', '}{', '{age:per_1}', 'שלום {hebrewDate:noYear}', '{{', 'plain'];
    let d = x.doc;
    for (const [i, text] of texts.entries()) d = tx(d, [{ op: 'add_text', args: { text, start: f(100 + i * 40), duration: f(30) } }]).doc;
    const { events: _e, ...old } = structuredClone(d);
    for (const doc of [d, old as ProjectDocument, project().doc, createProject({ id: 'p', name: 'P' })]) {
      const index = makeFieldIndex(doc);
      for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const clip of track.clips) {
        if (clip.type !== 'text') continue;
        expect('fields' in clip).toBe(false);
        for (const time of [clip.start, T.add(clip.start, f(7))]) for (const opts of [undefined, { index }]) expect(resolveFields(doc, seq.id, clip, time, opts)).toEqual({ text: clip.text, anchor: null, eventId: null, missing: [] });
        expect(fieldSpans(doc, seq.id, clip).map((s) => s.resolved.text)).toEqual([clip.text]);
      }
      expect(validateProject(doc)).toEqual([]);
    }
    // a date stamp on a file without a date has no text (and one with a typed text is not asked at all: evaluate.ts)
    expect(stampText(d, d.mainSequenceId, findClip(d, x.clipId)!.clip, f(0), {})).toBe("'24 12 25");
    const undated = tx(d, [{ op: 'set_asset_capture', args: { assetId: x.a, capture: null } }]).doc;
    expect(stampText(undated, undated.mainSequenceId, findClip(undated, x.clipId)!.clip, f(0), { clock: true })).toBe('');
  });
});
