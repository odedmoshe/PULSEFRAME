/**
 * The shared contracts of the life line (ADR-0021) that the lead pre-pass owns: the optional schema fields, the event entity
 * with exact undo, the structure checks of events, the operation registry rows with their argument schemas, and the refusal
 * table. Nothing here pins a placeholder body: what W1 builds is listed as todo and tested in its own files.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, CaptureSchema, createProject, creativeProjection, describeOps, diffEntities, entityMap, getOp, isRealWallDate, LIFE_REFUSALS, lifeRefusal, LifeEventSchema, listOps, MAX_LIFE_EVENTS,
  OpError, ProjectSchema, restoreEntities, SCHEMA_VERSION, summarize, TextClipSchema, timeline, validateProject, WALL_DATE, WALL_DATE_TIME, effectParams, findEffect,
  type Capture, type LifeEvent, type OpCall, type ProjectDocument,
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
  });

  // W1 (packages/core/src/lifeOps.test.ts and the files beside it) makes these pass:
  it.todo('every refusal of LIFE_REFUSALS is provoked through its operation, and nothing else is thrown');
  it.todo('undo then redo of each operation restores the creative projection exactly');
  it.todo('remove_asset takes the file out of its event (an emptied event goes) and hands its capture date down to its copies');
  it.todo('update_text + set_text_fields in one transaction gives the same document as two transactions (no cache on a draft)');
  it.todo('a title without `fields` and every earlier fixture resolve to their stored text unchanged');
});
