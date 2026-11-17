/**
 * The operations of the life line (lifeOps.ts, ADR-0021): what each one does, every refusal of LIFE_REFUSALS provoked
 * through its operation, and exact undo and redo of each through the entity diff, as the store's undo does it.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, findClip, LIFE_OPS_BUILT, LIFE_REFUSALS, MAX_CAPTURE_SHIFT_MINUTES, MAX_EVENT_FILES, MAX_LIFE_EVENTS, OpError, ProjectSchema, restoreEntities, validateProject,
  type Capture, type LifeEvent, type LifeRefusalKey, type OpCall, type ProjectDocument, type TextClip,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (frame: number) => T.frameTime(frame, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `o${n++}_`, actor: 'tester', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (hash: string, capture?: Capture) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov, ...(capture ? { capture } : {}) });
const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const table = { kind: 'lut' as const, name: 'look.cube', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance: prov };
const copyOf = (hash: string, source: string) => ({ ...video(hash), provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_t', capabilityId: 'test.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [source], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: T.rt(2, 1), audio: 'source-copied' } } });
const EVENING: Capture = { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' };
const MORNING: Capture = { at: '2024-12-26T09:00:00', utcOffsetMinutes: null, source: 'exif', assumedZone: 'Asia/Jerusalem' };
const DAY: Capture = { at: '2024-03-24', utcOffsetMinutes: null, source: 'filename', circa: true };

/** A library and a small timeline: videos `evening`, `morning`, `dayOnly` (a date without a time), `undated`; a sound file, a colour table, a copy of `evening`; a clip of `evening` under a plain title. */
function project() {
  let r = tx(createProject({ id: 'prj_ops', name: 'Ops', width: 640, height: 360, frameRate: R }), [video('a', EVENING), video('b', MORNING), video('c', DAY), video('d'), sound, table].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const [evening, morning, dayOnly, undated, soundId, lut] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string, string];
  r = tx(r.doc, [{ op: 'import_asset', args: { asset: copyOf('e', evening) } }], true);
  const copy = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: evening, start: f(0), duration: f(300) } }, { op: 'add_text', args: { text: 'צולם ב־{date}', start: f(0), duration: f(300) } }]);
  return { doc: r.doc, evening, morning, dayOnly, undated, soundId, lut, copy, clipId: r.results[0]!.output!.clipId as string, titleId: r.results[1]!.output!.clipId as string };
}
const event = (id: string, assetIds: string[], over: Partial<LifeEvent> = {}): LifeEvent => ({ id, name: '', afterSunset: null, assetIds, origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: true }, ...over });
const withEvents = (doc: ProjectDocument, events: LifeEvent[]): ProjectDocument => ({ ...structuredClone(doc), events: { ...doc.events, ...Object.fromEntries(events.map((e) => [e.id, e])) } });
const refusal = (doc: ProjectDocument, ops: OpCall[], internal = false): OpError => { try { tx(doc, ops, internal); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error(`not refused: ${JSON.stringify(ops).slice(0, 200)}`); };
/** Undo and redo of one accepted transaction through the entity diff, as the store does it: both must be exact. */
function undoRedo(before: ProjectDocument, after: ProjectDocument, what: string) {
  const changes = diffEntities(before, after);
  const back = structuredClone(after);
  restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back), `${what}: undo`).toBe(creativeProjection(before));
  const again = structuredClone(back);
  restoreEntities(again, changes.map((c) => ({ id: c.id, state: c.after })));
  expect(creativeProjection(again), `${what}: redo`).toBe(creativeProjection(after));
  expect(validateProject(after), what).toEqual([]);
  expect(ProjectSchema.safeParse(after).success, what).toBe(true);
  return changes.map((c) => c.id);
}

describe('capture dates', () => {
  it('the bodies are built', () => { expect(LIFE_OPS_BUILT).toBe(true); });
  it('set_asset_capture sets, corrects and removes a date by hand; the result is marked manual and remembers no earlier shift or zone', () => {
    const p = project();
    let r = tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2021-06-01' } } }]);
    expect(r.doc.assets[p.undated]!.capture).toEqual({ at: '2021-06-01', utcOffsetMinutes: null, source: 'manual' });
    expect(r.results[0]).toMatchObject({ affectedIds: [p.undated], output: { capture: { at: '2021-06-01', utcOffsetMinutes: null, source: 'manual' } }, summary: 'Capture date of "d.mp4" set to 2021-06-01' });
    undoRedo(p.doc, r.doc, 'set a date');
    // a date read from the file, with an assumed zone: correcting it by hand drops the zone and the shift
    const shifted = tx(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.morning], minutes: 60 } }]).doc;
    expect(shifted.assets[p.morning]!.capture).toEqual({ ...MORNING, at: '2024-12-26T10:00:00', shiftedMinutes: 60 });
    r = tx(shifted, [{ op: 'set_asset_capture', args: { assetId: p.morning, capture: { at: '2024-12-26T10:00:00', utcOffsetMinutes: 120, circa: true } } }]);
    expect(r.doc.assets[p.morning]!.capture).toEqual({ at: '2024-12-26T10:00:00', utcOffsetMinutes: 120, source: 'manual', circa: true });
    expect(r.results[0]!.summary).toBe('Capture date of "b.mp4" set to 2024-12-26 10:00:00 (an estimate)');
    undoRedo(shifted, r.doc, 'correct a date');
    // circa false is the same as no circa; a sound file may have a date too
    expect(tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.soundId, capture: { at: '2024-12-25', circa: false } } }]).doc.assets[p.soundId]!.capture).toEqual({ at: '2024-12-25', utcOffsetMinutes: null, source: 'manual' });
    // remove
    r = tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.evening, capture: null } }]);
    expect('capture' in r.doc.assets[p.evening]!).toBe(false);
    expect(r.results[0]).toMatchObject({ output: { capture: null }, summary: 'Removed the capture date of "a.mp4"' });
    undoRedo(p.doc, r.doc, 'remove a date');
    // the edges of the years are inside them
    for (const at of ['1900-01-01', '2100-12-31T23:59:59', '2024-02-29T12:00:00']) expect(tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at } } }]).doc.assets[p.undated]!.capture!.at).toBe(at);
  });
  it('shift_asset_captures moves several clocks together, keeps where each date came from and adds up what it was moved by', () => {
    const p = project();
    let r = tx(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, p.morning], minutes: -90 } }]);
    expect(r.doc.assets[p.evening]!.capture).toEqual({ ...EVENING, at: '2024-12-25T16:00:00', shiftedMinutes: -90 });
    expect(r.doc.assets[p.morning]!.capture).toEqual({ ...MORNING, at: '2024-12-26T07:30:00', shiftedMinutes: -90 });
    expect(r.results[0]).toMatchObject({ affectedIds: [p.evening, p.morning], output: { shifted: 2 }, summary: 'Moved the clock of 2 file(s) by -90 minutes' });
    undoRedo(p.doc, r.doc, 'shift');
    // again: the totals add up; back to where it was: no shift is remembered
    const twice = tx(r.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: -30 } }]).doc;
    expect(twice.assets[p.evening]!.capture).toEqual({ ...EVENING, at: '2024-12-25T15:30:00', shiftedMinutes: -120 });
    const home = tx(twice, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: 120 } }]).doc;
    expect(home.assets[p.evening]!.capture).toEqual(EVENING);
    // a date without a time moves by whole days
    r = tx(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.dayOnly, p.evening], minutes: -2880 } }]);
    expect(r.doc.assets[p.dayOnly]!.capture).toEqual({ ...DAY, at: '2024-03-22', shiftedMinutes: -2880 });
    expect(r.doc.assets[p.evening]!.capture!.at).toBe('2024-12-23T17:30:00');
    undoRedo(p.doc, r.doc, 'shift by days');
    // a clock ten years out, and one more hour: two calls, one total, still a document that opens
    const far = tx(tx(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: -5256000 } }]).doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: -60 } }]).doc;
    expect(far.assets[p.evening]!.capture).toEqual({ ...EVENING, at: '2014-12-28T16:30:00', shiftedMinutes: -5256060 });
    expect(ProjectSchema.safeParse(far).success).toBe(true);
    // all or nothing
    const before = JSON.stringify(p.doc);
    expect(refusal(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, p.undated], minutes: 60 } }]).message).toBe('1 of the listed file(s) have no capture date');
    expect(JSON.stringify(p.doc)).toBe(before);
  });
  it('a total that does not match its date cannot grow past its bound, and setting the date by hand starts the total again', () => {
    const p = project();
    // an archive made by hand: the date is in 2024 but the file claims to have been moved by almost the whole span of the years
    const odd = structuredClone(p.doc);
    odd.assets[p.evening]!.capture = { ...EVENING, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES - 30 };
    expect(validateProject(odd)).toEqual([]);
    const e = refusal(odd, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, p.morning], minutes: 60 } }]);
    expect(e.toJSON()).toMatchObject({ code: 'out_of_bounds', message: `1 of the listed file(s) would have their clock moved by more than ${MAX_CAPTURE_SHIFT_MINUTES} minutes in all`, details: { assetIds: [p.evening] }, hint: 'Set their date by hand instead (set_asset_capture).' });
    expect(tx(odd, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: 30 } }]).doc.assets[p.evening]!.capture!.shiftedMinutes).toBe(MAX_CAPTURE_SHIFT_MINUTES); // up to the bound is fine
    expect(tx(odd, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: -60 } }]).doc.assets[p.evening]!.capture!.shiftedMinutes).toBe(MAX_CAPTURE_SHIFT_MINUTES - 90);
    const negative = structuredClone(odd);
    negative.assets[p.evening]!.capture!.shiftedMinutes = -MAX_CAPTURE_SHIFT_MINUTES;
    expect(refusal(negative, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: -1440 } }]).message).toMatch(/moved by more than/);
    // the way out the hint names: the date set by hand has no total, and can be shifted again
    const reset = tx(odd, [{ op: 'set_asset_capture', args: { assetId: p.evening, capture: { at: EVENING.at, utcOffsetMinutes: 120 } } }]).doc;
    expect(reset.assets[p.evening]!.capture).toEqual({ at: EVENING.at, utcOffsetMinutes: 120, source: 'manual' });
    expect(tx(reset, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: 60 } }]).doc.assets[p.evening]!.capture!.shiftedMinutes).toBe(60);
    // set, shift, set, shift … never drifts: the total is always that of the shifts since the last date set by hand
    let d = p.doc;
    for (let i = 0; i < 5; i++) {
      d = tx(d, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: `201${i}-01-01T00:00:00` } } }, { op: 'shift_asset_captures', args: { assetIds: [p.undated], minutes: 5256000 } }]).doc;
      expect(d.assets[p.undated]!.capture!.shiftedMinutes).toBe(5256000);
    }
  });
  it('attach_asset_capture (internal) gives a file the date read from its bytes, and never replaces what a person set or moved', () => {
    const p = project();
    const read: Capture = { at: '2023-04-05T19:00:00', utcOffsetMinutes: 180, source: 'container' };
    const attach = (doc: ProjectDocument, assetId: string, overwrite?: boolean) => tx(doc, [{ op: 'attach_asset_capture', args: { assetId, capture: read, ...(overwrite === undefined ? {} : { overwrite }) } }], true);
    let r = attach(p.doc, p.undated);
    expect(r.doc.assets[p.undated]!.capture).toEqual(read);
    expect(r.results[0]).toMatchObject({ affectedIds: [p.undated], output: { attached: true } });
    undoRedo(p.doc, r.doc, 'attach');
    // a date read earlier: kept, unless asked to read again
    r = attach(p.doc, p.evening);
    expect(r.doc.assets[p.evening]!.capture).toEqual(EVENING);
    expect(r.results[0]).toMatchObject({ affectedIds: [], output: { attached: false } });
    expect(attach(p.doc, p.evening, true).doc.assets[p.evening]!.capture).toEqual(read);
    // set by hand, or moved by hand: never replaced, even when asked to
    const manual = tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.evening, capture: { at: '2020-01-01' } } }]).doc;
    expect(attach(manual, p.evening, true).results[0]!.output).toEqual({ attached: false });
    const moved = tx(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening], minutes: 60 } }]).doc;
    expect(attach(moved, p.evening, true).results[0]!.output).toEqual({ attached: false });
    // the same date again changes nothing
    expect(tx(p.doc, [{ op: 'attach_asset_capture', args: { assetId: p.evening, capture: EVENING, overwrite: true } }], true).results[0]).toMatchObject({ affectedIds: [], output: { attached: false } });
    // one kept file does not stop the others of a re-read
    const many = tx(p.doc, [p.evening, p.undated, p.morning].map((assetId) => ({ op: 'attach_asset_capture', args: { assetId, capture: read } })), true);
    expect(many.results.map((x) => x.output!.attached)).toEqual([false, true, false]);
    // not for API callers
    expect(refusal(p.doc, [{ op: 'attach_asset_capture', args: { assetId: p.undated, capture: read } }]).code).toBe('forbidden_op');
  });
});

describe('live fields of a title', () => {
  it('set_text_fields turns the fields of a title on, and off again once no field is left, writing doubled braces back as single ones', () => {
    const p = project();
    let r = tx(p.doc, [{ op: 'set_text_fields', args: { clipId: p.titleId, enabled: true } }]);
    expect((findClip(r.doc, p.titleId)!.clip as TextClip).fields).toBe(true);
    expect(r.results[0]).toMatchObject({ affectedIds: [p.titleId], output: { fields: true, text: 'צולם ב־{date}' } });
    undoRedo(p.doc, r.doc, 'fields on');
    // off: only once the text holds no field; {{x}} becomes {x} again, in the master and in each format's wording
    const v = tx(r.doc, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    const plain = tx(v.doc, [{ op: 'update_text', args: { clipId: p.titleId, text: 'חנוכה {{2024}}' } }, { op: 'set_variant_override', args: { variantId, clipId: p.titleId, text: '{{קצר}}' } }]).doc;
    r = tx(plain, [{ op: 'set_text_fields', args: { clipId: p.titleId, enabled: false } }]);
    const clip = findClip(r.doc, p.titleId)!.clip as TextClip;
    expect('fields' in clip).toBe(false);
    expect(clip.text).toBe('חנוכה {2024}');
    expect(r.doc.variants[variantId]!.overrides[p.titleId]!.text).toBe('{קצר}');
    expect(r.results[0]).toMatchObject({ affectedIds: [p.titleId, variantId], output: { fields: false, text: 'חנוכה {2024}' } });
    undoRedo(plain, r.doc, 'fields off');
    // on again needs the braces doubled first: in one transaction
    const again = tx(r.doc, [{ op: 'update_text', args: { clipId: p.titleId, text: 'חנוכה {{2024}} {year}' } }, { op: 'set_variant_override', args: { variantId, clipId: p.titleId, text: null } }, { op: 'set_text_fields', args: { clipId: p.titleId, enabled: true } }]);
    expect((findClip(again.doc, p.titleId)!.clip as TextClip).fields).toBe(true);
  });
});

describe('events', () => {
  it('cluster_events arranges the dated pictures and videos by time, stores no name, and leaves out what has no date', () => {
    const p = project();
    const r = tx(p.doc, [{ op: 'cluster_events', args: {} }]);
    const out = r.results[0]!.output as { created: string[]; kept: string[]; removed: string[]; undated: number };
    // the evening and its copy (two seconds later) are one event; the next morning is 15.5 hours later; the day-only file is a day of its own
    expect(out.created.map((id) => r.doc.events[id]!.assetIds)).toEqual([[p.dayOnly], [p.evening, p.copy], [p.morning]]);
    expect(out).toMatchObject({ kept: [], removed: [], undated: 1 }); // the undated video; the sound file and the colour table are not pictures
    for (const id of out.created) expect(r.doc.events[id]).toMatchObject({ id, name: '', afterSunset: null, origin: { method: 'gap', gapMinutes: 240, createdBy: 'tester', edited: false } });
    expect(r.results[0]!.affectedIds).toEqual(out.created);
    undoRedo(p.doc, r.doc, 'cluster');
    // a day is one event with a gap of a day: the evening, its copy and the next morning
    const wide = tx(p.doc, [{ op: 'cluster_events', args: { gapMinutes: 1440 } }]);
    expect(Object.values(wide.doc.events).map((e) => e.assetIds)).toEqual([[p.dayOnly], [p.evening, p.copy, p.morning]]);
    // again with the same gap: nothing changes, every event is kept with its id
    const again = tx(r.doc, [{ op: 'cluster_events', args: {} }]);
    expect(again.results[0]!.output).toEqual({ created: [], kept: out.created, removed: [], undated: 1 });
    expect(again.affectedIds).toEqual([]);
    expect(creativeProjection(again.doc)).toBe(creativeProjection(r.doc));
    // with another gap: an event whose files did not change keeps its id; the rest are rebuilt
    const regap = tx(r.doc, [{ op: 'cluster_events', args: { gapMinutes: 1440 } }]);
    const o2 = regap.results[0]!.output as { created: string[]; kept: string[]; removed: string[] };
    expect(o2.kept).toEqual([out.created[0]]);
    expect([...o2.removed].sort()).toEqual([out.created[1], out.created[2]].sort());
    expect(o2.created.length).toBe(1);
    expect(regap.doc.events[out.created[0]!]!.origin.gapMinutes).toBe(1440);
    undoRedo(r.doc, regap.doc, 'cluster again');
  });
  it('cluster_events leaves an event a person edited exactly as it is, and its files out of the rebuilt ones', () => {
    const p = project();
    const first = tx(p.doc, [{ op: 'cluster_events', args: {} }]);
    const ids = (first.results[0]!.output as { created: string[] }).created;
    const evening = ids[1]!;
    const answered = tx(first.doc, [{ op: 'update_event', args: { eventId: evening, afterSunset: true, removeAssetIds: [p.copy] } }]).doc;
    expect(answered.events[evening]).toMatchObject({ afterSunset: true, assetIds: [p.evening], origin: { edited: true } });
    const re = tx(answered, [{ op: 'cluster_events', args: { gapMinutes: 1440 } }]);
    expect(re.doc.events[evening]).toEqual(answered.events[evening]); // untouched, whatever the gap
    // its file is not regrouped; the copy, which was taken out of it, is arranged again with the next morning
    const others = Object.values(re.doc.events).filter((e) => e.id !== evening).map((e) => e.assetIds);
    expect(others).toEqual([[p.dayOnly], [p.copy, p.morning]]);
    undoRedo(answered, re.doc, 'cluster beside an edited event');
    // a date changed later: the untouched events follow it at the next arrangement, the edited one stays
    const moved = tx(re.doc, [{ op: 'set_asset_capture', args: { assetId: p.dayOnly, capture: { at: '2024-12-26T09:30:00' } } }]).doc;
    const third = tx(moved, [{ op: 'cluster_events', args: {} }]);
    expect(Object.values(third.doc.events).filter((e) => e.id !== evening).map((e) => e.assetIds)).toEqual([[p.copy], [p.morning, p.dayOnly]]);
    expect(third.doc.events[evening]).toEqual(answered.events[evening]);
  });
  it('add_event groups files by hand; a file moves out of the event it was in, and an event left empty goes', () => {
    const p = project();
    let r = tx(p.doc, [{ op: 'add_event', args: { assetIds: [p.morning, p.undated], name: 'בוקר אצל סבתא' } }]);
    const first = r.results[0]!.output!.eventId as string;
    expect(r.doc.events[first]).toEqual({ id: first, name: 'בוקר אצל סבתא', afterSunset: null, assetIds: [p.morning, p.undated], origin: { method: 'manual', gapMinutes: null, createdBy: 'tester', edited: true } });
    expect(r.results[0]).toMatchObject({ affectedIds: [first], output: { eventId: first, removedEventIds: [] }, summary: 'New event "בוקר אצל סבתא" with 2 file(s)' });
    undoRedo(p.doc, r.doc, 'add event');
    const one = r.doc;
    // take one of its files into a new event: the first event keeps the other, and counts as edited
    r = tx(one, [{ op: 'add_event', args: { assetIds: [p.undated, p.evening] } }]);
    const second = r.results[0]!.output!.eventId as string;
    expect(r.doc.events[first]!.assetIds).toEqual([p.morning]);
    expect(r.doc.events[second]).toMatchObject({ name: '', assetIds: [p.undated, p.evening] });
    expect(r.results[0]).toMatchObject({ affectedIds: [second, first], output: { removedEventIds: [] } });
    undoRedo(one, r.doc, 'add event taking a file');
    // take the last file too: the first event is removed and reported
    const two = r.doc;
    r = tx(two, [{ op: 'add_event', args: { assetIds: [p.morning] } }]);
    expect(Object.keys(r.doc.events)).not.toContain(first);
    expect(r.results[0]).toMatchObject({ affectedIds: [r.results[0]!.output!.eventId, first], output: { removedEventIds: [first] } });
    undoRedo(two, r.doc, 'add event emptying another');
  });
  it('update_event renames, answers the sunset question and moves files; remove_event removes the grouping only', () => {
    const p = project();
    const made = tx(p.doc, [{ op: 'add_event', args: { assetIds: [p.evening] } }, { op: 'add_event', args: { assetIds: [p.morning] } }]);
    const [a, b] = made.results.map((x) => x.output!.eventId as string) as [string, string];
    let r = tx(made.doc, [{ op: 'update_event', args: { eventId: a, name: 'חנוכה', afterSunset: true } }]);
    expect(r.doc.events[a]).toMatchObject({ name: 'חנוכה', afterSunset: true, assetIds: [p.evening] });
    expect(r.results[0]).toMatchObject({ affectedIds: [a], output: { removedEventIds: [] }, summary: 'Changed event "חנוכה": 1 file(s)' });
    undoRedo(made.doc, r.doc, 'rename and answer');
    const named = r.doc;
    // back to no name, and to not decided
    r = tx(named, [{ op: 'update_event', args: { eventId: a, name: '', afterSunset: null } }]);
    expect(r.doc.events[a]).toMatchObject({ name: '', afterSunset: null });
    // add the other event's only file and the undated one, remove its own first file: the other event goes
    r = tx(named, [{ op: 'update_event', args: { eventId: a, addAssetIds: [p.morning, p.undated], removeAssetIds: [p.evening] } }]);
    expect(r.doc.events[a]!.assetIds).toEqual([p.morning, p.undated]);
    expect(Object.keys(r.doc.events)).toEqual([a]);
    expect(r.results[0]).toMatchObject({ affectedIds: [a, b], output: { removedEventIds: [b] } });
    undoRedo(named, r.doc, 'move files');
    // adding a file the event already holds beside a new one: held once
    r = tx(named, [{ op: 'update_event', args: { eventId: a, addAssetIds: [p.evening, p.undated] } }]);
    expect(r.doc.events[a]!.assetIds).toEqual([p.evening, p.undated]);
    // an event made by the arrangement counts as edited once it is changed
    const auto = tx(p.doc, [{ op: 'cluster_events', args: {} }]);
    const autoId = (auto.results[0]!.output as { created: string[] }).created[2]!;
    expect(tx(auto.doc, [{ op: 'update_event', args: { eventId: autoId, afterSunset: false } }]).doc.events[autoId]!.origin).toEqual({ method: 'gap', gapMinutes: 240, createdBy: 'tester', edited: true });
    // remove
    r = tx(named, [{ op: 'remove_event', args: { eventId: a } }]);
    expect(Object.keys(r.doc.events)).toEqual([b]);
    expect(r.doc.assets[p.evening]!.capture).toEqual(EVENING);
    expect(r.results[0]).toMatchObject({ affectedIds: [a], summary: 'Removed the event "חנוכה"; its 1 file(s) stay in the library' });
    undoRedo(named, r.doc, 'remove event');
  });
  it('remove_asset takes the file out of its event (an emptied event goes) and hands its capture date down to its copies', () => {
    const p = project();
    const made = tx(p.doc, [{ op: 'add_event', args: { assetIds: [p.morning, p.undated] } }, { op: 'add_event', args: { assetIds: [p.dayOnly] } }]);
    const [two, one] = made.results.map((x) => x.output!.eventId as string) as [string, string];
    let r = tx(made.doc, [{ op: 'remove_asset', args: { assetId: p.morning } }]);
    expect(r.doc.events[two]!.assetIds).toEqual([p.undated]);
    expect([...r.affectedIds].sort()).toEqual([p.morning, two].sort());
    undoRedo(made.doc, r.doc, 'remove a file of an event');
    r = tx(made.doc, [{ op: 'remove_asset', args: { assetId: p.dayOnly } }]);
    expect(Object.keys(r.doc.events)).toEqual([two]);
    expect([...r.affectedIds].sort()).toEqual([p.dayOnly, one].sort());
    undoRedo(made.doc, r.doc, 'remove the only file of an event');
    // the evening video has a clip on the timeline and a copy that takes its date from it: with the clip gone, removing it dates the copy
    const free = tx(made.doc, [{ op: 'delete_clip', args: { clipId: p.clipId } }]).doc;
    r = tx(free, [{ op: 'remove_asset', args: { assetId: p.evening } }]);
    expect(r.doc.assets[p.copy]!.capture).toEqual({ ...EVENING, at: '2024-12-25T17:30:02' });
    expect([...r.affectedIds].sort()).toEqual([p.evening, p.copy].sort());
    undoRedo(free, r.doc, 'remove a file with a dated copy');
  });
});

describe('every refusal of LIFE_REFUSALS, provoked through its operation', () => {
  it('each is thrown with its code, its fixed sentence and its hint, and leaves the document as it was; nothing else is thrown', () => {
    const p = project();
    const fieldsOn = tx(p.doc, [{ op: 'set_text_fields', args: { clipId: p.titleId, enabled: true } }]).doc;
    const made = tx(p.doc, [{ op: 'add_event', args: { assetIds: [p.evening, p.morning] } }]);
    const eventId = made.results[0]!.output!.eventId as string;
    const text = (t: string): OpCall => ({ op: 'update_text', args: { clipId: p.titleId, text: t } });
    const on: OpCall = { op: 'set_text_fields', args: { clipId: p.titleId, enabled: true } };
    // documents no operation can make in a few steps: as many events as a project holds, an event as full as it can be, a total that does not match its date
    const full = withEvents(p.doc, Array.from({ length: MAX_LIFE_EVENTS }, (_, i) => event(`evt_${i}`, [p.evening])));
    const crowded = structuredClone(p.doc);
    const many = Array.from({ length: MAX_EVENT_FILES }, (_, i) => `ast_many${i}`);
    for (const id of many) crowded.assets[id] = { ...structuredClone(crowded.assets[p.undated]!), id };
    crowded.events = { evt_big: event('evt_big', many) };
    const drifted = structuredClone(p.doc);
    drifted.assets[p.evening]!.capture = { ...EVENING, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES };
    const noDates = tx(createProject({ id: 'prj_n', name: 'N' }), [{ op: 'import_asset', args: { asset: video('a') } }, { op: 'import_asset', args: { asset: { ...sound, capture: DAY } } }], true).doc;

    const cases: [LifeRefusalKey, ProjectDocument, OpCall[], string, boolean?][] = [
      ['assetNotFound', p.doc, [{ op: 'set_asset_capture', args: { assetId: 'ast_none', capture: null } }], 'asset ast_none not found'],
      ['assetNotFound', p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, 'ast_none'], minutes: 60 } }], 'asset ast_none not found'],
      ['assetNotFound', p.doc, [{ op: 'attach_asset_capture', args: { assetId: 'ast_none', capture: EVENING } }], 'asset ast_none not found', true],
      ['assetNotFound', p.doc, [{ op: 'add_event', args: { assetIds: ['ast_none'] } }], 'asset ast_none not found'],
      ['assetNotFound', made.doc, [{ op: 'update_event', args: { eventId, addAssetIds: ['ast_none'] } }], 'asset ast_none not found'],
      ['eventNotFound', p.doc, [{ op: 'update_event', args: { eventId: 'evt_none', name: 'x' } }], 'event evt_none not found'],
      ['eventNotFound', p.doc, [{ op: 'remove_event', args: { eventId: 'evt_none' } }], 'event evt_none not found'],
      ['eventNotFound', { ...p.doc, events: undefined as unknown as ProjectDocument['events'] }, [{ op: 'remove_event', args: { eventId: 'evt_none' } }], 'event evt_none not found'], // a document from before this build
      ['lutHasNoDate', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.lut, capture: { at: '2024-12-25' } } }], 'a colour table (LUT) has no capture date'],
      ['lutHasNoDate', p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.lut], minutes: 60 } }], 'a colour table (LUT) has no capture date'],
      ['lutHasNoDate', p.doc, [{ op: 'attach_asset_capture', args: { assetId: p.lut, capture: EVENING } }], 'a colour table (LUT) has no capture date', true],
      ['noSuchDay', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2024-02-30' } } }], 'that day does not exist in the calendar'],
      ['noSuchDay', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2023-02-29T10:00:00' } } }], 'that day does not exist in the calendar'],
      ['noSuchDay', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '1850-02-30' } } }], 'that day does not exist in the calendar'],
      ['dateOutOfRange', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '1850-06-01' } } }], 'a capture date lies between 1900 and 2100'],
      ['dateOutOfRange', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2101-01-01T00:00:00' } } }], 'a capture date lies between 1900 and 2100'],
      ['dateOutOfRange', tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '1903-01-01T00:00:00' } } }]).doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, p.undated], minutes: -5256000 } }], 'a capture date lies between 1900 and 2100'],
      ['dateOutOfRange', tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2100-12-31' } } }]).doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.undated], minutes: 1440 } }], 'a capture date lies between 1900 and 2100'],
      ['captureUnchanged', tx(p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2021-06-01', circa: true } } }]).doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: { at: '2021-06-01', utcOffsetMinutes: null, circa: true } } }], 'the file already has this capture date'],
      ['noCaptureToRemove', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.undated, capture: null } }], 'the file has no capture date of its own to remove'],
      ['noCaptureToRemove', p.doc, [{ op: 'set_asset_capture', args: { assetId: p.copy, capture: null } }], 'the file has no capture date of its own to remove'], // its date is its source's
      ['listedTwice', p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, p.morning, p.evening], minutes: 60 } }], 'a file is listed more than once'],
      ['listedTwice', p.doc, [{ op: 'add_event', args: { assetIds: [p.evening, p.evening] } }], 'a file is listed more than once'],
      ['listedTwice', made.doc, [{ op: 'update_event', args: { eventId, addAssetIds: [p.undated, p.undated] } }], 'a file is listed more than once'],
      ['listedTwice', made.doc, [{ op: 'update_event', args: { eventId, removeAssetIds: [p.evening, p.evening] } }], 'a file is listed more than once'],
      ['shiftNoDate', p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.undated, p.evening, p.soundId], minutes: 60 } }], '2 of the listed file(s) have no capture date'],
      ['shiftDayOnly', p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.dayOnly, p.evening], minutes: 90 } }], '1 of the listed file(s) have a date without a time, which moves by whole days only'],
      ['shiftInherited', p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.copy, p.evening], minutes: 60 } }], '1 of the listed file(s) take their date from the file they were made from'],
      ['shiftTooFar', drifted, [{ op: 'shift_asset_captures', args: { assetIds: [p.evening, p.morning], minutes: 1 } }], `1 of the listed file(s) would have their clock moved by more than ${MAX_CAPTURE_SHIFT_MINUTES} minutes in all`],
      ['notATitle', p.doc, [{ op: 'set_text_fields', args: { clipId: p.clipId, enabled: true } }], 'only a title can hold live fields'],
      ['fieldsAlready', fieldsOn, [on], 'live fields are already on for this title'],
      ['fieldsAlready', p.doc, [{ op: 'set_text_fields', args: { clipId: p.titleId, enabled: false } }], 'live fields are already off for this title'],
      ['notFields', p.doc, [text('{weather} {date:fancy} a { b {weather}'), on], 'these brace groups are not fields: {weather}, {date:fancy}, {'],
      ['notFields', p.doc, [text('סוף }'), on], 'these brace groups are not fields: }'],
      ['fieldsStillThere', fieldsOn, [{ op: 'set_text_fields', args: { clipId: p.titleId, enabled: false } }], 'this title still holds fields, so turning live fields off would show their names instead of their values'],
      ['noDatedFiles', noDates, [{ op: 'cluster_events', args: {} }], 'no picture or video in the library has a capture date'], // the dated sound file is not a picture
      ['tooManyEvents', full, [{ op: 'add_event', args: { assetIds: [p.morning] } }], `a project holds at most ${MAX_LIFE_EVENTS} events`],
      ['tooManyEvents', withEvents(p.doc, Array.from({ length: MAX_LIFE_EVENTS - 1 }, (_, i) => event(`evt_${i}`, [p.undated]))), [{ op: 'cluster_events', args: {} }], `a project holds at most ${MAX_LIFE_EVENTS} events`],
      ['eventFileKind', p.doc, [{ op: 'add_event', args: { assetIds: [p.evening, p.soundId] } }], 'an event holds pictures and videos only'],
      ['eventFileKind', made.doc, [{ op: 'update_event', args: { eventId, addAssetIds: [p.lut] } }], 'an event holds pictures and videos only'],
      ['eventLastFile', made.doc, [{ op: 'update_event', args: { eventId, removeAssetIds: [p.evening, p.morning] } }], 'an event keeps at least one file'],
      ['eventTooManyFiles', crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [p.evening] } }], `an event holds at most ${MAX_EVENT_FILES} files`],
      ['eventNothingToChange', made.doc, [{ op: 'update_event', args: { eventId } }], 'nothing to change: give name, afterSunset, addAssetIds or removeAssetIds'],
      ['eventNothingToChange', made.doc, [{ op: 'update_event', args: { eventId, addAssetIds: [], removeAssetIds: [] } }], 'nothing to change: give name, afterSunset, addAssetIds or removeAssetIds'],
      ['eventNothingToChange', made.doc, [{ op: 'update_event', args: { eventId, name: '', afterSunset: null, addAssetIds: [p.morning] } }], 'nothing to change: give name, afterSunset, addAssetIds or removeAssetIds'], // all as it is already
      ['eventFileNotIn', made.doc, [{ op: 'update_event', args: { eventId, removeAssetIds: [p.undated] } }], 'a file to remove is not in this event'],
      ['eventAddAndRemove', made.doc, [{ op: 'update_event', args: { eventId, addAssetIds: [p.undated], removeAssetIds: [p.undated] } }], 'a file is listed both to add and to remove'],
    ];
    const seen = new Set<string>();
    for (const [key, doc, ops, message, internal] of cases) {
      const before = JSON.stringify(doc);
      const e = refusal(doc, ops, internal);
      const what = `${key}: ${JSON.stringify(ops).slice(0, 160)}`;
      expect(e.message, what).toBe(message);
      expect(e.code, what).toBe(LIFE_REFUSALS[key].code);
      expect(e.hint, what).toBe(LIFE_REFUSALS[key].hint);
      expect(JSON.stringify(doc), what).toBe(before);
      seen.add(key);
    }
    expect([...seen].sort()).toEqual(Object.keys(LIFE_REFUSALS).sort());
    // the event as full as it can be: swapping a file is fine, and so is adding one it already holds
    expect(tx(crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [p.evening], removeAssetIds: [many[0]!] } }]).doc.events.evt_big!.assetIds.length).toBe(MAX_EVENT_FILES);
    expect(refusal(crowded, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [many[1]!] } }]).message).toBe('nothing to change: give name, afterSunset, addAssetIds or removeAssetIds');
    // the details say which files or groups
    expect(refusal(p.doc, [{ op: 'shift_asset_captures', args: { assetIds: [p.undated, p.evening, p.soundId], minutes: 60 } }]).details).toMatchObject({ assetIds: [p.undated, p.soundId] });
    expect(refusal(p.doc, [text('{weather} {'), on]).details).toMatchObject({ clipId: p.titleId, groups: ['{weather}', '{'] });
  });
  it('the shared refusals of a clip still apply, and names every object answers to are not files or events', () => {
    const p = project();
    expect(refusal(p.doc, [{ op: 'set_text_fields', args: { clipId: 'clp_none', enabled: true } }]).toJSON()).toMatchObject({ code: 'not_found', message: 'clip clp_none not found' });
    const textTrack = Object.values(p.doc.sequences)[0]!.tracks.find((t) => t.kind === 'text')!.id;
    const locked = tx(p.doc, [{ op: 'update_track', args: { trackId: textTrack, locked: true } }]).doc;
    expect(refusal(locked, [{ op: 'set_text_fields', args: { clipId: p.titleId, enabled: true } }]).code).toBe('track_locked');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      for (const ops of [
        [{ op: 'set_asset_capture', args: { assetId: name, capture: null } }], [{ op: 'shift_asset_captures', args: { assetIds: [name], minutes: 60 } }], [{ op: 'add_event', args: { assetIds: [name] } }],
        [{ op: 'update_event', args: { eventId: name, name: 'x' } }], [{ op: 'remove_event', args: { eventId: name } }], [{ op: 'set_text_fields', args: { clipId: name, enabled: true } }],
      ] as OpCall[][]) expect(refusal(p.doc, ops).code, `${name} ${ops[0]!.op}`).toBe('not_found');
    }
  });
});
