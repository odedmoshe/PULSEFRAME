/** Grouping, ordering and the operations of the library views (lifeLibrary.logic.ts), against the real operations. */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, clipEnd, createProject, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import {
  addEventOps, badgeOf, badgeText, captureEcho, clusterNudgeCount, dateGroups, eventHeading, eventModels, eventFilesInOrder, mergePreviousOps, monthLabel, parseCaptureInput, parseLifeView,
  readLifeView, shiftMinutes, shiftability, splitOps, sunsetChoices, writeLifeView, LIFE_VIEW_STORAGE_KEY,
} from './lifeLibrary.logic.ts';

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `l${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const hashOf = (name: string): `sha256:${string}` => `sha256:${[...name].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)}`;
const clip = (name: string, seconds = 10) => ({
  kind: 'video' as const, name, contentHash: hashOf(name), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: seconds * 30 }, provenance,
});
const photo = (name: string) => ({ kind: 'image' as const, name, contentHash: hashOf(name), byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.rt(5, 1), image: { width: 800, height: 600, codec: 'mjpeg', hasAlpha: false }, provenance });

/** Files by name; each is dated by `dates[name]` (a wall string) when given. */
function library(dates: Record<string, string | null>, extra: Record<string, ReturnType<typeof clip> | ReturnType<typeof photo>> = {}) {
  const names = Object.keys(dates);
  let r = tx(createProject({ id: 'prj_l', name: 'L', width: 1920, height: 1080 }), names.map((nm) => ({ op: 'import_asset', args: { asset: extra[nm] ?? (nm.endsWith('.jpg') ? photo(nm) : clip(nm)) } })), true);
  const ids: Record<string, string> = {};
  names.forEach((nm, i) => { ids[nm] = r.results[i]!.output!.assetId as string; });
  const sets = names.filter((nm) => dates[nm]).map((nm) => ({ op: 'set_asset_capture', args: { assetId: ids[nm], capture: { at: dates[nm] } } }));
  if (sets.length) r = tx(r.doc, sets);
  expect(validateProject(r.doc)).toEqual([]);
  return { doc: r.doc, ids };
}

describe('the view choice', () => {
  it('only the three views are known; anything else is the library as it was', () => {
    expect(parseLifeView('date')).toBe('date'); expect(parseLifeView('events')).toBe('events'); expect(parseLifeView('all')).toBe('all');
    expect(parseLifeView('x')).toBe('all'); expect(parseLifeView(null)).toBe('all'); expect(parseLifeView(3)).toBe('all');
  });
  it('is kept in storage when it can be and never throws when it cannot', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(writeLifeView('events', store)).toBe(true);
    expect(mem.get(LIFE_VIEW_STORAGE_KEY)).toBe('events');
    expect(readLifeView(store)).toBe('events');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readLifeView(broken)).toBe('all');
    expect(writeLifeView('date', broken)).toBe(false);
    expect(writeLifeView('date', null)).toBe(false);
  });
});

describe('words and badges', () => {
  it('the badge is day.month.two-digit year without padding', () => {
    expect(badgeText('2024-03-15')).toBe('15.3.24');
    expect(badgeText('2005-12-01T08:00:00')).toBe('1.12.05');
  });
  it('a month is its civil name and year beside the Hebrew month and year', () => {
    expect(monthLabel('he', 2024, 3, 'אדר ב׳ תשפ״ד')).toEqual({ civil: 'מרץ 2024', hebrew: 'אדר ב׳ תשפ״ד' });
    expect(monthLabel('en', 2024, 3, 'אדר ב׳ תשפ״ד').civil).toBe('March 2024');
  });
  it('the live echo names the weekday and the Hebrew date; a bad day gives nothing', () => {
    expect(captureEcho('he', '2024-12-25T10:00:00')).toBe('יום רביעי · כ״ד בכסלו תשפ״ה');
    expect(captureEcho('en', '2024-12-25T10:00:00')).toBe('Wednesday · כ״ד בכסלו תשפ״ה');
    // only the day known: both Hebrew days are shown (the date is never guessed)
    expect(captureEcho('he', '2024-12-25')).toBe('יום רביעי · כ״ד בכסלו תשפ״ה או כ״ה בכסלו תשפ״ה');
    expect(captureEcho('he', '2024-02-30')).toBeNull();
    // a time in the sunset window leaves two readings, both shown
    expect(captureEcho('he', '2024-12-25T17:30:00')).toBe('יום רביעי · כ״ד בכסלו תשפ״ה או כ״ה בכסלו תשפ״ה');
  });
  it('the typed date and time become the stored wall string, or the reason they cannot', () => {
    expect(parseCaptureInput({ date: '2024-12-25', time: '', circa: false })).toEqual({ ok: true, at: '2024-12-25', circa: false });
    expect(parseCaptureInput({ date: '2024-12-25', time: '18:15', circa: true })).toEqual({ ok: true, at: '2024-12-25T18:15:00', circa: true });
    expect(parseCaptureInput({ date: '', time: '', circa: false })).toEqual({ ok: false, reason: 'empty' });
    expect(parseCaptureInput({ date: '2024-02-30', time: '', circa: false })).toEqual({ ok: false, reason: 'bad_day' });
    expect(parseCaptureInput({ date: '1850-01-01', time: '', circa: false })).toEqual({ ok: false, reason: 'out_of_range' });
    expect(parseCaptureInput({ date: '2024-12-25', time: '25:00', circa: false })).toEqual({ ok: false, reason: 'bad_time' });
  });
});

describe('the library by date', () => {
  const { doc, ids } = library({ 'a.mp4': '2024-03-15T10:00:00', 'b.mp4': '2024-03-02T09:00:00', 'c.mp4': '2023-12-31', 'd.mp4': '2024-11-01T12:00:00', 'e.mp4': null, 'f.jpg': '2024-03-20T08:00:00' });
  it('years and months come newest first, files of a month in capture order, with counts; the undated apart', () => {
    const g = dateGroups(doc);
    expect(g.years.map((y) => y.year)).toEqual([2024, 2023]);
    expect(g.years[0]!.months.map((m) => m.month)).toEqual([11, 3]);
    expect(g.years[0]!.months[1]!.assetIds).toEqual([ids['b.mp4'], ids['a.mp4'], ids['f.jpg']]);
    expect(g.years.map((y) => y.count)).toEqual([4, 1]);
    expect(g.dated).toBe(5);
    expect(g.undated).toEqual([ids['e.mp4']]);
    expect(g.years[0]!.months[1]!.hebrew).toContain('תשפ״ד');
  });
  it('a date badge for a dated file, none for an undated one or a sound', () => {
    expect(badgeOf(doc, ids['a.mp4']!)).toMatchObject({ text: '15.3.24', circa: false, inherited: false });
    expect(badgeOf(doc, ids['e.mp4']!)).toBeNull();
    expect(badgeOf(doc, 'nope')).toBeNull();
  });
  it('an estimate from a file name is marked, never shown as a firm date', () => {
    const r = tx(doc, [{ op: 'attach_asset_capture', args: { assetId: ids['e.mp4'], capture: { at: '2022-05-06', utcOffsetMinutes: null, source: 'filename', circa: true } } }], true);
    expect(badgeOf(r.doc, ids['e.mp4']!)).toMatchObject({ text: '6.5.22', circa: true, source: 'filename' });
  });
});

describe('events', () => {
  // two trips: a morning in March, an evening of the first candle of Hanukkah 5787 (4 December 2026, 17:30: the sunset question is open)
  const { doc: base, ids } = library({ 'm1.mp4': '2026-03-15T10:00:00', 'm2.mp4': '2026-03-15T10:20:00', 'h1.mp4': '2026-12-04T17:30:00', 'h2.mp4': '2026-12-04T17:40:00', 'u.mp4': null });
  const arranged = tx(base, [{ op: 'cluster_events', args: {} }]).doc;
  it('the card for arranging appears while dated files exist and no event does', () => {
    expect(clusterNudgeCount(base)).toBe(4);
    expect(clusterNudgeCount(arranged)).toBe(0);
  });
  it('events come newest first, with count, date and a heading that is the name or else the date', () => {
    const rows = eventModels(arranged, 'he');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.count).toBe(2); expect(rows[0]!.dateLabel).toBe('4.12.26'); expect(rows[1]!.dateLabel).toBe('15.3.26');
    expect(eventHeading(rows[1]!, 'x')).toBe(rows[1]!.name || '15.3.26');
  });
  it('the sunset choice is asked only where the answer matters, and is never preselected', () => {
    const rows = eventModels(arranged, 'he');
    const hanukkah = rows[0]!.event, march = rows[1]!.event;
    expect(sunsetChoices(arranged, march, 'he', { before: 'לפני', after: 'אחרי' })).toBeNull();
    const q = sunsetChoices(arranged, hanukkah, 'he', { before: 'לפני השקיעה', after: 'אחרי השקיעה' })!;
    expect(q.selected).toBeNull();
    expect(q.choices.map((c) => c.value)).toEqual([false, true]);
    expect(q.choices[0]!.label).toContain('ערב חנוכה');
    expect(q.choices[1]!.label).toContain('חנוכה');
    expect(q.choices[1]!.label).toContain('נר ראשון');
    // the Hebrew date is not shown while the answer is open
    expect(rows[0]!.hebrewLabel).toBeNull();
  });
  it('one answer names the event by its holiday and shows the Hebrew date; undo is the generic one', () => {
    const id = eventModels(arranged, 'he')[0]!.id;
    const r = tx(arranged, [{ op: 'update_event', args: { eventId: id, afterSunset: true } }]);
    const m = eventModels(r.doc, 'he')[0]!;
    expect(m.nameKind).toBe('holiday');
    expect(m.name).toContain('חנוכה');
    expect(m.hebrewLabel).toBe('כ״ה בכסלו תשפ״ז');
    expect(sunsetChoices(r.doc, m.event, 'he', { before: 'a', after: 'b' })!.selected).toBe(true);
  });
  it('files of an event are in capture order; add-to-timeline is one add_clip per file, one after another', () => {
    const ev = eventModels(arranged, 'he')[1]!.event;
    expect(eventFilesInOrder(arranged, ev)).toEqual([ids['m1.mp4'], ids['m2.mp4']]);
    const ops = addEventOps(arranged, ev, { appendPoint: T.ZERO, playhead: T.ZERO, videoTarget: null });
    expect(ops.map((o) => o.op)).toEqual(['add_clip', 'add_clip']);
    const r = tx(arranged, ops);
    const pictures = r.doc.sequences[r.doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips);
    expect(pictures).toHaveLength(2);
    const sorted = [...pictures].sort((a, b) => T.toSeconds(a.start) - T.toSeconds(b.start));
    expect(T.toSeconds(sorted[0]!.start)).toBe(0);
    expect(T.toSeconds(sorted[1]!.start)).toBe(T.toSeconds(clipEnd(sorted[0]!)));
  });
  it('merge with the previous and split from a file are operations that keep every file in exactly one event', () => {
    const rows = eventModels(arranged, 'he');
    const later = rows[0]!, earlier = rows[1]!;
    expect(mergePreviousOps(arranged, earlier.id, 'he')).toBeNull();
    const merge = mergePreviousOps(arranged, later.id, 'he')!;
    const merged = tx(arranged, merge).doc;
    expect(Object.keys(merged.events)).toHaveLength(1);
    expect(Object.values(merged.events)[0]!.assetIds.length).toBe(4);
    const split = splitOps(merged, Object.keys(merged.events)[0]!, ids['h1.mp4']!)!;
    const again = tx(merged, split).doc;
    expect(Object.keys(again.events)).toHaveLength(2);
    expect(splitOps(merged, Object.keys(merged.events)[0]!, ids['m1.mp4']!)).toBeNull();
  });
});

describe('the clock shift', () => {
  const { doc, ids } = library({ 'a.mp4': '2024-03-15T10:00:00', 'b.mp4': '2024-03-15', 'c.mp4': null });
  it('only files with a date and a time of their own can be shifted, and the others say why', () => {
    const s = shiftability(doc, [ids['a.mp4']!, ids['b.mp4']!, ids['c.mp4']!]);
    expect(s.ok).toEqual([ids['a.mp4']]);
    expect(s.blocked).toEqual({ [ids['b.mp4']!]: 'day_only', [ids['c.mp4']!]: 'no_date' });
  });
  it('the signed minutes of days, hours and minutes; zero and absurd values give nothing', () => {
    expect(shiftMinutes({ days: 0, hours: 2, minutes: 30, later: false })).toBe(-150);
    expect(shiftMinutes({ days: 1, hours: 0, minutes: 0, later: true })).toBe(1440);
    expect(shiftMinutes({ days: 0, hours: 0, minutes: 0, later: true })).toBeNull();
    expect(shiftMinutes({ days: 4000, hours: 0, minutes: 0, later: true })).toBeNull();
    expect(shiftMinutes({ days: 0.5, hours: 0, minutes: 0, later: true })).toBeNull();
    expect(shiftMinutes({ days: -1, hours: 0, minutes: 0, later: true })).toBeNull();
  });
});

describe('saving the capture popover', () => {
  it('keeps the file\'s seconds and stated offset when only «משוער» changes, and drops the offset when the day or time changes', async () => {
    const { saveCaptureOp: save } = await import('./lifeLibrary.logic.ts');
    const own = { at: '2024-12-25T18:15:10', utcOffsetMinutes: 120 };
    expect(save('a', { at: '2024-12-25T18:15:00', circa: true }, own).args).toEqual({ assetId: 'a', capture: { at: '2024-12-25T18:15:10', utcOffsetMinutes: 120, circa: true } });
    expect(save('a', { at: '2024-12-25T18:16:00', circa: false }, own).args).toEqual({ assetId: 'a', capture: { at: '2024-12-25T18:16:00', utcOffsetMinutes: null } });
    expect(save('a', { at: '2024-12-26', circa: false }, own).args).toEqual({ assetId: 'a', capture: { at: '2024-12-26', utcOffsetMinutes: null } });
    expect(save('a', { at: '2024-12-25T18:15:00', circa: false }, null).args).toEqual({ assetId: 'a', capture: { at: '2024-12-25T18:15:00', utcOffsetMinutes: null } });
    expect(save('a', { at: '2024-12-25', circa: true }, { at: '2024-12-25', utcOffsetMinutes: null }).args).toEqual({ assetId: 'a', capture: { at: '2024-12-25', utcOffsetMinutes: null, circa: true } });
  });
});
