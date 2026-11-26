/**
 * Capture-date arithmetic (capture.ts, ADR-0021): wall-clock strings moved exactly, the date a copy takes from the file it
 * was made from, which Hebrew day a clock time belongs to, and the date handed down when the original is removed.
 * Date is used here only as an oracle for the arithmetic; the code under test never calls it.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  addWallSeconds, applyTransaction, captureOf, createProject, creativeProjection, diffEntities, formatWall, handDownCapture, hebrewDayReadings, hebrewFromRd, parseWall, rdFromGregorian, restoreEntities, shownCapture, validateProject,
  type Capture, type OpCall, type ProjectDocument,
} from './index.ts';

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `c${n++}_`, actor: 'test', allowInternal });
const R = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (hash: string, capture?: Capture) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov, ...(capture ? { capture } : {}) });
/** A copy made from `source` by a provider (a labelled fixture: no provider ran); with `start` it keeps its source's timing from there on. */
const copyOf = (hash: string, source: string, start?: T.RationalTime, capture?: Capture) => ({
  ...video(hash, capture),
  provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_t', capabilityId: 'test.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [source], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, ...(start ? { sourceRangeStart: start, audio: 'source-copied' } : {}) } },
});
const importAll = (doc: ProjectDocument, assets: unknown[]) => { const r = tx(doc, assets.map((asset) => ({ op: 'import_asset', args: { asset } })), true); return { doc: r.doc, ids: r.results.map((x) => x.output!.assetId as string) }; };
const EVENING: Capture = { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' };
const rd = (iso: string) => rdFromGregorian(parseWall(iso).date);

describe('wall-clock strings', () => {
  it('a day, or a day and a time, in parts; anything else is a RangeError', () => {
    expect(parseWall('2024-12-25')).toEqual({ date: { y: 2024, m: 12, d: 25 }, seconds: null });
    expect(parseWall('2024-12-25T17:30:09')).toEqual({ date: { y: 2024, m: 12, d: 25 }, seconds: 17 * 3600 + 30 * 60 + 9 });
    expect(parseWall('2024-12-25T00:00:00').seconds).toBe(0);
    for (const bad of ['', '2024-12-25T17:30', '2024-12-25T17:30:00Z', '2024-12-25T24:00:00', '2024-13-01', '24-12-25', '2024-12-25 17:30:00', '2024-12-25T17:30:00+02:00']) expect(() => parseWall(bad), bad).toThrow(RangeError);
    expect(() => parseWall(undefined as unknown as string)).toThrow(RangeError);
    expect(formatWall(rd('2024-02-29'), null)).toBe('2024-02-29');
    expect(formatWall(rd('2024-02-29'), 86399)).toBe('2024-02-29T23:59:59');
    expect(() => formatWall(-400, null)).toThrow(RangeError);
  });
  it('moves exactly across minutes, midnights, months, leap days and years, in both directions', () => {
    const cases: [string, number, string][] = [
      ['2024-12-25T17:30:00', 60, '2024-12-25T17:31:00'],
      ['2024-12-25T23:59:59', 1, '2024-12-26T00:00:00'],
      ['2024-12-26T00:00:00', -1, '2024-12-25T23:59:59'],
      ['2024-12-31T23:59:30', 45, '2025-01-01T00:00:15'],
      ['2024-02-28T12:00:00', 86400, '2024-02-29T12:00:00'],
      ['2023-02-28T12:00:00', 86400, '2023-03-01T12:00:00'],
      ['2024-03-01T00:00:00', -86400, '2024-02-29T00:00:00'],
      ['2024-12-25T17:30:00', 0, '2024-12-25T17:30:00'],
      ['2024-12-25T17:30:00', -5256000 * 60, '2014-12-28T17:30:00'], // ten years of 365 days back
      ['1900-01-01T00:00:00', -1, '1899-12-31T23:59:59'], // the operations check the years; the arithmetic does not stop there
    ];
    for (const [at, seconds, want] of cases) expect(addWallSeconds(at, seconds), `${at} ${seconds}`).toBe(want);
    expect(() => addWallSeconds('2024-12-25T17:30:00', 0.5)).toThrow(RangeError);
    expect(() => addWallSeconds('9999-12-31T23:59:59', 1)).toThrow(RangeError);
    expect(() => addWallSeconds('tomorrow', 1)).toThrow(RangeError);
  });
  it('a day-only date moves by whole days only: less than a day leaves it as it is', () => {
    expect(addWallSeconds('2024-12-25', 3600)).toBe('2024-12-25');
    expect(addWallSeconds('2024-12-25', 86399)).toBe('2024-12-25');
    expect(addWallSeconds('2024-12-25', 86400)).toBe('2024-12-26');
    expect(addWallSeconds('2024-12-25', -1)).toBe('2024-12-24'); // floored: a second back is already the day before
    expect(addWallSeconds('2024-12-25', -86400)).toBe('2024-12-24');
    expect(addWallSeconds('2024-12-25', 7 * 86400 + 5)).toBe('2025-01-01');
  });
  it('agrees with the machine\'s own clock arithmetic on 3000 random moves, and every move can be taken back', () => {
    let s = 20241225;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const pad = (x: number, w = 2) => String(x).padStart(w, '0');
    for (let i = 0; i < 3000; i++) {
      const start = Date.UTC(1900 + Math.floor(rnd() * 201), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28), Math.floor(rnd() * 24), Math.floor(rnd() * 60), Math.floor(rnd() * 60));
      const move = Math.round((rnd() - 0.5) * 2 * 5256000 * 60);
      const show = (ms: number) => { const d = new Date(ms); return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
      const at = show(start), moved = addWallSeconds(at, move);
      expect(moved, `${at} + ${move}`).toBe(show(start + move * 1000));
      expect(addWallSeconds(moved, -move)).toBe(at);
    }
  });
});

describe('the capture a file shows', () => {
  it('its own; none; and never an entry that is not a file', () => {
    const { doc, ids } = importAll(createProject({ id: 'p', name: 'P' }), [video('a', EVENING), video('b')]);
    expect(captureOf(doc, ids[0]!)).toEqual({ capture: EVENING, offsetSeconds: 0, inherited: false });
    expect(shownCapture(doc, ids[0]!)).toEqual({ capture: EVENING, wall: EVENING.at, inherited: false });
    expect(captureOf(doc, ids[1]!)).toBeNull();
    for (const id of ['ast_none', 'constructor', '__proto__', 'toString', '']) expect(captureOf(doc, id), id).toBeNull();
  });
  it('a time-preserving copy takes the date of the file it was made from, moved by where it starts in it (whole seconds)', () => {
    const base = importAll(createProject({ id: 'p', name: 'P' }), [video('a', EVENING), video('b')]);
    const [a, b] = base.ids as [string, string];
    const { doc, ids } = importAll(base.doc, [copyOf('c', a, T.ZERO), copyOf('d', a, T.rt(5, 2)), copyOf('e', a), copyOf('f', b, T.rt(4, 1)), copyOf('9', a, T.rt(90, 1), { at: '2020-01-01', utcOffsetMinutes: null, source: 'manual' })]);
    const [whole, part, unrelated, ofUndated, ownDate] = ids as [string, string, string, string, string];
    expect(captureOf(doc, whole)).toEqual({ capture: EVENING, offsetSeconds: 0, inherited: true });
    expect(captureOf(doc, part)).toEqual({ capture: EVENING, offsetSeconds: 2, inherited: true }); // 2.5 s into its source: two whole seconds
    expect(shownCapture(doc, part)!.wall).toBe('2024-12-25T17:30:02');
    expect(captureOf(doc, unrelated)).toBeNull(); // made from the file, but not keeping its timing: no date of its own
    expect(captureOf(doc, ofUndated)).toBeNull();
    expect(captureOf(doc, ownDate)).toMatchObject({ offsetSeconds: 0, inherited: false, capture: { at: '2020-01-01' } }); // its own date wins
  });
  it('follows a chain two deep with the offsets added before rounding, stops at the nearest dated file, and ends on a cycle', () => {
    const base = importAll(createProject({ id: 'p', name: 'P' }), [video('a', EVENING)]);
    const a = base.ids[0]!;
    const one = importAll(base.doc, [copyOf('b', a, T.rt(3, 2))]); // 1.5 s in
    const two = importAll(one.doc, [copyOf('c', one.ids[0]!, T.rt(3, 2))]); // 1.5 s into that: 3 s in all
    expect(captureOf(two.doc, two.ids[0]!)).toEqual({ capture: EVENING, offsetSeconds: 3, inherited: true }); // not 1 + 1
    expect(shownCapture(two.doc, two.ids[0]!)!.wall).toBe('2024-12-25T17:30:03');
    // the middle file gets a date of its own: the copy of it now follows that one
    const middle = structuredClone(two.doc);
    middle.assets[one.ids[0]!]!.capture = { at: '2021-06-01T10:00:00', utcOffsetMinutes: null, source: 'manual' };
    expect(captureOf(middle, two.ids[0]!)).toMatchObject({ offsetSeconds: 1, inherited: true, capture: { at: '2021-06-01T10:00:00' } });
    // a cycle (an archive made by hand): the walk ends, and without a date on the way there is none
    const cyclic = structuredClone(two.doc);
    delete cyclic.assets[a]!.capture;
    cyclic.assets[a]!.provenance = structuredClone(cyclic.assets[one.ids[0]!]!.provenance);
    cyclic.assets[a]!.provenance.derived!.sourceAssetIds = [two.ids[0]!];
    for (const id of [a, one.ids[0]!, two.ids[0]!]) expect(captureOf(cyclic, id), id).toBeNull();
    // a source that is no longer in the project ends the chain
    const orphan = structuredClone(two.doc);
    delete orphan.assets[a];
    expect(captureOf(orphan, two.ids[0]!)).toBeNull();
  });
});

describe('which Hebrew day a clock time belongs to', () => {
  const D = rd('2024-12-25');
  const read = (capture: Partial<Capture>, at: string, afterSunset: boolean | null = null) => hebrewDayReadings({ at, utcOffsetMinutes: null, source: 'manual', ...capture }, at, afterSunset).map((r) => `${r.rd - D}${r.part === 'day' ? 'd' : 'n'}`).join(' ');
  it('on an Israeli clock: night until 05:00, day until 16:00, unsure until 21:00, then the next day', () => {
    const il = { utcOffsetMinutes: 120 };
    expect(read(il, '2024-12-25T00:00:00')).toBe('0n');
    expect(read(il, '2024-12-25T04:59:59')).toBe('0n');
    expect(read(il, '2024-12-25T05:00:00')).toBe('0d');
    expect(read(il, '2024-12-25T15:59:59')).toBe('0d');
    expect(read(il, '2024-12-25T16:00:00')).toBe('0d 1n');
    expect(read(il, '2024-12-25T17:30:00')).toBe('0d 1n');
    expect(read(il, '2024-12-25T20:59:59')).toBe('0d 1n');
    expect(read(il, '2024-12-25T21:00:00')).toBe('1n');
    expect(read(il, '2024-12-25T23:59:59')).toBe('1n');
    // the evening of 25 December 2024 after sunset is 25 Kislev; before it, 24 Kislev
    expect(hebrewFromRd(D + 1)).toEqual({ y: 5785, m: 'kislev', d: 25 });
  });
  it('the Israeli windows apply only to a clock that is provably Israel\'s; otherwise nothing from 14:00 on is certain', () => {
    const at = (month: string, time: string) => `2024-${month}-10T${time}`;
    // +02:00 is Israel's winter clock (November–February); in summer it is somewhere else
    for (const month of ['11', '12', '01', '02']) expect(read({ utcOffsetMinutes: 120 }, at(month, '21:30:00')), month).toMatch(/^-?\d+n$/);
    for (const month of ['03', '04', '07', '10']) expect(read({ utcOffsetMinutes: 120 }, at(month, '21:30:00')), month).toMatch(/^-?\d+d -?\d+n$/);
    // +03:00 is Israel's summer clock (April–September)
    for (const month of ['04', '06', '09']) expect(read({ utcOffsetMinutes: 180 }, at(month, '15:00:00')), month).toMatch(/^-?\d+d$/);
    for (const month of ['10', '12', '03']) expect(read({ utcOffsetMinutes: 180 }, at(month, '15:00:00')), month).toMatch(/^-?\d+d -?\d+n$/);
    // no stated offset: Israel's unless another home zone was assumed
    expect(read({}, '2024-12-25T15:00:00')).toBe('0d');
    expect(read({ assumedZone: 'Asia/Jerusalem' }, '2024-12-25T21:30:00')).toBe('1n');
    expect(read({ assumedZone: 'Europe/Amsterdam' }, '2024-12-25T21:30:00')).toBe('0d 1n');
    // any other clock: day until 14:00, then unsure to midnight
    const far = { utcOffsetMinutes: -300 };
    expect(read(far, '2024-12-25T04:00:00')).toBe('0n');
    expect(read(far, '2024-12-25T13:59:59')).toBe('0d');
    expect(read(far, '2024-12-25T14:00:00')).toBe('0d 1n');
    expect(read(far, '2024-12-25T23:59:59')).toBe('0d 1n');
  });
  it('a date without a time is unsure; the event\'s answer settles it, and before dawn nothing needs settling', () => {
    expect(read({}, '2024-12-25')).toBe('0d 1n');
    expect(read({}, '2024-12-25', true)).toBe('1n');
    expect(read({}, '2024-12-25', false)).toBe('0d');
    const il = { utcOffsetMinutes: 120 };
    // after sunset: from noon on it is the next Hebrew day; a 01:00 clip of the same night is already on it; a morning clip is the day
    expect(read(il, '2024-12-25T17:30:00', true)).toBe('1n');
    expect(read(il, '2024-12-25T12:00:00', true)).toBe('1n');
    expect(read(il, '2024-12-25T11:59:59', true)).toBe('0d');
    expect(read(il, '2024-12-26T01:00:00', true)).toBe('1n'); // civil 26 December, before dawn: the same Hebrew day as the evening before
    // before sunset: the same day, whatever the window said
    expect(read(il, '2024-12-25T17:30:00', false)).toBe('0d');
    expect(read(il, '2024-12-25T22:00:00', false)).toBe('0d');
    expect(read(il, '2024-12-25T03:00:00', false)).toBe('0n');
    expect(read({ utcOffsetMinutes: -300 }, '2024-12-25T19:00:00', true)).toBe('1n');
  });
});

describe('removing a file whose copies take their date from it', () => {
  it('each copy keeps the moment it showed, written onto it; undo takes it off again; files with their own date are untouched', () => {
    const base = importAll(createProject({ id: 'p', name: 'P' }), [video('a', { ...EVENING, circa: true, shiftedMinutes: 60 })]);
    const a = base.ids[0]!;
    const one = importAll(base.doc, [copyOf('b', a, T.rt(3, 2)), copyOf('d', a), copyOf('e', a, T.ZERO, { at: '2020-01-01', utcOffsetMinutes: null, source: 'manual' })]);
    const [b, unrelated, own] = one.ids as [string, string, string];
    const two = importAll(one.doc, [copyOf('c', b, T.rt(3, 2))]);
    const c = two.ids[0]!;
    const before = two.doc;
    const r = tx(before, [{ op: 'remove_asset', args: { assetId: a } }]);
    expect(Object.keys(r.doc.assets)).not.toContain(a);
    // the other fields are kept; `at` is moved by each copy's own offset, rounded once over its whole chain
    expect(r.doc.assets[b]!.capture).toEqual({ at: '2024-12-25T17:30:01', utcOffsetMinutes: 120, source: 'container', circa: true, shiftedMinutes: 60 });
    expect(r.doc.assets[c]!.capture).toEqual({ at: '2024-12-25T17:30:03', utcOffsetMinutes: 120, source: 'container', circa: true, shiftedMinutes: 60 });
    expect(r.doc.assets[unrelated]!.capture).toBeUndefined();
    expect(r.doc.assets[own]!.capture).toEqual({ at: '2020-01-01', utcOffsetMinutes: null, source: 'manual' });
    expect([...r.affectedIds].sort()).toEqual([a, b, c].sort());
    // what each copy shows did not change
    for (const id of [b, c]) expect(shownCapture(r.doc, id)!.wall, id).toBe(shownCapture(before, id)!.wall);
    expect(validateProject(r.doc)).toEqual([]);
    // exact undo and redo through the entities
    const changes = diffEntities(before, r.doc);
    const back = structuredClone(r.doc);
    restoreEntities(back, changes.map((ch) => ({ id: ch.id, state: ch.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(before));
    const again = structuredClone(before);
    restoreEntities(again, changes.map((ch) => ({ id: ch.id, state: ch.after })));
    expect(creativeProjection(again)).toBe(creativeProjection(r.doc));
  });
  it('removing the middle of a chain hands the date to the copy behind it; removing a copy changes nobody else', () => {
    const base = importAll(createProject({ id: 'p', name: 'P' }), [video('a', EVENING)]);
    const a = base.ids[0]!;
    const one = importAll(base.doc, [copyOf('b', a, T.rt(10, 1))]);
    const two = importAll(one.doc, [copyOf('c', one.ids[0]!, T.rt(5, 1))]);
    const b = one.ids[0]!, c = two.ids[0]!;
    const middle = tx(two.doc, [{ op: 'remove_asset', args: { assetId: b } }]);
    expect(middle.doc.assets[c]!.capture).toEqual({ ...EVENING, at: '2024-12-25T17:30:15' });
    expect(middle.doc.assets[a]!.capture).toEqual(EVENING);
    const leaf = tx(two.doc, [{ op: 'remove_asset', args: { assetId: c } }]);
    expect(leaf.affectedIds).toEqual([c]);
    expect(leaf.doc.assets[b]!.capture).toBeUndefined();
    // nothing to hand down from a file that is not there, or that no copy depends on
    expect(handDownCapture(structuredClone(two.doc), 'ast_none')).toEqual([]);
    expect(handDownCapture(structuredClone(two.doc), 'constructor')).toEqual([]);
    expect(handDownCapture(structuredClone(two.doc), c)).toEqual([]);
  });
  it('a moment past the end of the years a capture can be stored in is not written: the copy is left without a date', () => {
    const base = importAll(createProject({ id: 'p', name: 'P' }), [video('a', { at: '2100-12-31T23:59:30', utcOffsetMinutes: null, source: 'manual' })]);
    const one = importAll(base.doc, [copyOf('b', base.ids[0]!, T.rt(45, 1)), copyOf('c', base.ids[0]!, T.rt(10, 1))]);
    const r = tx(one.doc, [{ op: 'remove_asset', args: { assetId: base.ids[0]! } }]);
    expect(r.doc.assets[one.ids[0]!]!.capture).toBeUndefined();
    expect(r.doc.assets[one.ids[1]!]!.capture!.at).toBe('2100-12-31T23:59:40');
    expect(validateProject(r.doc)).toEqual([]);
  });
});
