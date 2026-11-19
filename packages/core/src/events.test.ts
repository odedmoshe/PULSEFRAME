/**
 * Events of the life line (events.ts, ADR-0021): gap clustering as a property over 500 seeds, the name an event is shown by
 * (typed, or the holiday its files fall on, never while a file's Hebrew day is unsure), the library by date, and on this day.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  addWallSeconds, applyTransaction, calendarGroups, clusterCaptures, createProject, eventCandidates, eventDisplayName, eventForCapture, eventNeedsSunsetAnswer, eventOfAsset, eventSpan, MAX_EVENT_FILES, onThisDay, parseWall, rdFromGregorian, summarize,
  type Capture, type DatedAsset, type LifeEvent, type OpCall, type ProjectDocument,
} from './index.ts';

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `e${n++}_`, actor: 'test', allowInternal });
const R = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const hex = (i: number) => i.toString(16).padStart(64, '0');
const video = (i: number, capture?: Capture) => ({ kind: 'video' as const, name: `v${i}.mp4`, contentHash: `sha256:${hex(i)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov, ...(capture ? { capture } : {}) });
const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
/** Israeli clock, no stated offset. */
const at = (wall: string, extra: Partial<Capture> = {}): Capture => ({ at: wall, utcOffsetMinutes: null, source: 'manual', ...extra });
/** A project whose library holds one video per capture given (undefined = no date), ids in that order. */
function library(captures: (Capture | undefined)[], extra: unknown[] = []) {
  const r = tx(createProject({ id: 'prj_ev', name: 'Events' }), [...captures.map((c, i) => video(i + 1, c)), ...extra].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  return { doc: r.doc, ids: r.results.map((x) => x.output!.assetId as string) };
}
const event = (id: string, assetIds: string[], over: Partial<LifeEvent> = {}): LifeEvent => ({ id, name: '', afterSunset: null, assetIds, origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: true }, ...over });
const withEvents = (doc: ProjectDocument, events: LifeEvent[]): ProjectDocument => ({ ...structuredClone(doc), events: Object.fromEntries(events.map((e) => [e.id, e])) });
const minutes = (wall: string) => { const w = parseWall(wall); return rdFromGregorian(w.date) * 1440 + Math.floor((w.seconds ?? 0) / 60); };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A random library: bursts of timed files around a few days, with some day-only files among them and on days of their own. */
function randomItems(seed: number): DatedAsset[] {
  const rnd = mulberry32(seed), int = (k: number) => Math.floor(rnd() * k);
  const items: DatedAsset[] = [];
  const count = 1 + int(60);
  let base = `20${10 + int(15)}-0${1 + int(9)}-1${int(9)}T0${int(10)}:00:00`;
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.25) base = addWallSeconds(base, int(4) === 0 ? int(40) * 86400 : int(20000) * 60);
    const wall = addWallSeconds(base, int(900) * 60 + int(60));
    items.push({ assetId: `ast_${seed}_${i.toString().padStart(3, '0')}`, wall: rnd() < 0.2 ? wall.slice(0, 10) : wall });
  }
  return items;
}

describe('clusterCaptures: properties over 500 seeds', () => {
  const GAPS = [30, 45, 240, 1440];
  it('every file is in exactly one cluster; inside a cluster no pause is longer than the gap, between clusters every pause is; the order of the input does not matter; a longer gap never gives more clusters', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const items = randomItems(seed);
      const wallOf = new Map(items.map((x) => [x.assetId, x.wall]));
      let before = Infinity;
      for (const gap of GAPS) {
        const clusters = clusterCaptures(items, gap);
        const where = `seed ${seed}, gap ${gap}`;
        // a partition
        expect(clusters.flat().sort(), where).toEqual(items.map((x) => x.assetId).sort());
        expect(clusters.every((c) => c.length > 0), where).toBe(true);
        // timed files: single linkage on a line
        const timed = (c: string[]) => c.filter((id) => wallOf.get(id)!.length > 10).map((id) => minutes(wallOf.get(id)!));
        const runs = clusters.map(timed).filter((c) => c.length > 0);
        for (const run of runs) for (let i = 1; i < run.length; i++) { expect(run[i]! - run[i - 1]!, where).toBeGreaterThanOrEqual(0); expect(run[i]! - run[i - 1]!, where).toBeLessThanOrEqual(gap); }
        const sortedRuns = [...runs].sort((a, b) => a[0]! - b[0]!);
        for (let i = 1; i < sortedRuns.length; i++) expect(sortedRuns[i]![0]! - sortedRuns[i - 1]![sortedRuns[i - 1]!.length - 1]!, where).toBeGreaterThan(gap);
        // a file with only a day: with timed files of that civil day when there are any, else with the other day-only files of that day and nothing else
        for (const c of clusters) for (const id of c) {
          const wall = wallOf.get(id)!;
          if (wall.length > 10) continue;
          const sameDayTimed = items.some((x) => x.wall.length > 10 && x.wall.slice(0, 10) === wall);
          if (sameDayTimed) expect(c.some((other) => wallOf.get(other)!.length > 10 && wallOf.get(other)!.slice(0, 10) === wall), `${where}: ${id}`).toBe(true);
          else expect(c.every((other) => wallOf.get(other) === wall), `${where}: ${id}`).toBe(true);
        }
        // members in (time, id) order (a day-only file at the midnight of its day); clusters in the order their timed files begin
        const key = (id: string): [number, number, string] => [minutes(wallOf.get(id)!), wallOf.get(id)!.length > 10 ? 1 : 0, id];
        const inOrder = (a: [number, number, string], b: [number, number, string]) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
        for (const c of clusters) for (let i = 1; i < c.length; i++) expect(inOrder(key(c[i - 1]!), key(c[i]!)), `${where}: ${c[i - 1]} before ${c[i]}`).toBe(true);
        const begins = (c: string[]) => key(c.find((id) => wallOf.get(id)!.length > 10) ?? c[0]!);
        for (let i = 1; i < clusters.length; i++) expect(inOrder(begins(clusters[i - 1]!), begins(clusters[i]!)), where).toBe(true);
        // input order does not matter
        const rnd = mulberry32(seed * 7919 + gap);
        const shuffled = [...items].map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
        expect(clusterCaptures(shuffled, gap), where).toEqual(clusters);
        expect(clusterCaptures([...items].reverse(), gap), where).toEqual(clusters);
        // a longer gap never gives more clusters
        expect(clusters.length, where).toBeLessThanOrEqual(before);
        before = clusters.length;
        // clustering the result again changes nothing
        expect(clusterCaptures(clusters.flat().map((id) => ({ assetId: id, wall: wallOf.get(id)! })), gap), where).toEqual(clusters);
      }
    }
  }, 120_000);
  it('the boundary: a pause of exactly the gap stays together, one minute more starts a new event; seconds do not count', () => {
    const items = (walls: string[]) => walls.map((wall, i) => ({ assetId: `a${i}`, wall }));
    expect(clusterCaptures(items(['2024-12-25T10:00:00', '2024-12-25T14:00:00']), 240)).toEqual([['a0', 'a1']]);
    expect(clusterCaptures(items(['2024-12-25T10:00:00', '2024-12-25T14:01:00']), 240)).toEqual([['a0'], ['a1']]);
    expect(clusterCaptures(items(['2024-12-25T10:00:59', '2024-12-25T14:00:00']), 240)).toEqual([['a0', 'a1']]);
    expect(clusterCaptures(items(['2024-12-25T23:50:00', '2024-12-26T00:10:00']), 30)).toEqual([['a0', 'a1']]); // across midnight
    expect(clusterCaptures([], 240)).toEqual([]);
    // a file listed twice is one file
    expect(clusterCaptures([{ assetId: 'a', wall: '2024-12-25T10:00:00' }, { assetId: 'a', wall: '2024-12-25T10:00:00' }], 240)).toEqual([['a']]);
  });
  it('a file with only a day joins the event with the most files on that day (the earliest of equals), else its day is an event', () => {
    const c = clusterCaptures([
      { assetId: 'm1', wall: '2024-12-25T08:00:00' }, { assetId: 'e1', wall: '2024-12-25T18:00:00' }, { assetId: 'e2', wall: '2024-12-25T18:30:00' },
      { assetId: 'd1', wall: '2024-12-25' }, { assetId: 'x1', wall: '2024-12-27' }, { assetId: 'x2', wall: '2024-12-27' }, { assetId: 'y1', wall: '2024-12-28' },
    ], 240);
    expect(c).toEqual([['m1'], ['d1', 'e1', 'e2'], ['x1', 'x2'], ['y1']]);
    const tie = clusterCaptures([{ assetId: 'm1', wall: '2024-12-25T08:00:00' }, { assetId: 'e1', wall: '2024-12-25T18:00:00' }, { assetId: 'd1', wall: '2024-12-25' }], 240);
    expect(tie).toEqual([['d1', 'm1'], ['e1']]);
  });
  it('a run longer than an event can hold is cut, in order, into consecutive clusters', () => {
    const items = Array.from({ length: MAX_EVENT_FILES * 2 + 3 }, (_, i) => ({ assetId: `a${String(i).padStart(5, '0')}`, wall: addWallSeconds('2024-07-01T06:00:00', i * 5) }));
    const clusters = clusterCaptures(items, 30);
    expect(clusters.map((c) => c.length)).toEqual([MAX_EVENT_FILES, MAX_EVENT_FILES, 3]);
    expect(clusters.flat()).toEqual(items.map((x) => x.assetId));
  });
});

describe('the event of a file, and its span', () => {
  it('finds the event a file is in; a copy without its own date and event belongs to the event of the file it was made from', () => {
    const { doc, ids } = library([at('2024-12-25T17:30:00'), at('2024-12-26T09:00:00'), undefined]);
    const d = withEvents(doc, [event('evt_1', [ids[0]!, ids[2]!])]);
    expect(eventOfAsset(d, ids[0]!)!.id).toBe('evt_1');
    expect(eventOfAsset(d, ids[1]!)).toBeNull();
    expect(eventOfAsset(d, 'constructor')).toBeNull();
    expect(eventOfAsset({ ...d, events: undefined as unknown as ProjectDocument['events'] }, ids[0]!)).toBeNull(); // a document from before this build
    expect(eventSpan(d, d.events.evt_1!)).toEqual({ first: '2024-12-25T17:30:00', last: '2024-12-25T17:30:00' });
    const two = withEvents(doc, [event('evt_1', [ids[1]!, ids[0]!, ids[2]!])]);
    expect(eventSpan(two, two.events.evt_1!)).toEqual({ first: '2024-12-25T17:30:00', last: '2024-12-26T09:00:00' });
    expect(eventSpan(two, event('evt_x', [ids[2]!]))).toBeNull();
    // an enhanced copy of the first file
    const copy = { ...video(77), provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'j', capabilityId: 't.f', capabilityVersion: '0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [ids[0]!], outputName: 'o', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: T.rt(2, 1), audio: 'source-copied' } } };
    const r = tx(d, [{ op: 'import_asset', args: { asset: copy } }], true);
    const copyId = r.results[0]!.output!.assetId as string;
    expect(eventOfAsset(r.doc, copyId)).toBeNull();
    expect(eventForCapture(r.doc, copyId)!.id).toBe('evt_1');
    expect(eventForCapture(r.doc, ids[1]!)).toBeNull();
  });
});

describe('the name an event is shown by', () => {
  const name = (doc: ProjectDocument, e: LifeEvent, lang: 'he' | 'en' = 'he') => eventDisplayName(doc, e, lang);
  it('what a person typed wins; otherwise the holiday all its files fall on; otherwise nothing', () => {
    const { doc, ids } = library([at('2024-12-26T10:00:00'), at('2024-12-26T11:30:00'), at('2024-07-10T10:00:00'), undefined]);
    expect(name(doc, event('e', [ids[0]!, ids[1]!], { name: 'אצל סבתא' }))).toEqual({ name: 'אצל סבתא', kind: 'manual' });
    expect(name(doc, event('e', [ids[0]!, ids[1]!]))).toEqual({ name: 'חנוכה — היום הראשון', kind: 'holiday' });
    expect(name(doc, event('e', [ids[0]!, ids[1]!]), 'en')).toEqual({ name: 'Hanukkah, day 1', kind: 'holiday' });
    expect(name(doc, event('e', [ids[2]!]))).toEqual({ name: '', kind: 'none' }); // an ordinary day
    expect(name(doc, event('e', [ids[0]!, ids[2]!]))).toEqual({ name: '', kind: 'none' }); // one file is not on the holiday
    expect(name(doc, event('e', [ids[3]!]))).toEqual({ name: '', kind: 'none' }); // no date at all
    expect(name(doc, event('e', [ids[0]!, ids[3]!]))).toEqual({ name: 'חנוכה — היום הראשון', kind: 'holiday' }); // a file without a date says nothing
  });
  it('the same holiday on different days gives the holiday alone; different holidays give nothing', () => {
    const { doc, ids } = library([at('2024-12-26T10:00:00'), at('2024-12-28T10:00:00'), at('2024-04-22T10:00:00'), at('2024-04-23T10:00:00'), at('2024-04-30T10:00:00')]);
    expect(name(doc, event('e', [ids[0]!, ids[1]!]))).toEqual({ name: 'חנוכה', kind: 'holiday' });
    expect(name(doc, event('e', [ids[2]!, ids[3]!]))).toEqual({ name: 'פסח', kind: 'holiday' }); // the eve and the first day
    expect(name(doc, event('e', [ids[2]!, ids[3]!]), 'en')).toEqual({ name: 'Pesach', kind: 'holiday' });
    expect(name(doc, event('e', [ids[3]!, ids[4]!]))).toEqual({ name: '', kind: 'none' }); // Pesach and Mimouna
  });
  it('never a derived name while the Hebrew day of any file is unsure; the sunset answer gives one', () => {
    // 17:30 on 25 December 2024 on an Israeli clock: before sunset it is the eve of Hanukkah, after it the first candle
    const { doc, ids } = library([{ at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' }, at('2024-12-26T10:00:00'), at('2024-12-25')]);
    const unsure = event('e', [ids[0]!]);
    expect(eventNeedsSunsetAnswer(doc, unsure)).toBe(true);
    expect(name(doc, unsure)).toEqual({ name: '', kind: 'none' });
    expect(name(doc, { ...unsure, afterSunset: true })).toEqual({ name: 'חנוכה — נר ראשון', kind: 'holiday' });
    expect(name(doc, { ...unsure, afterSunset: false })).toEqual({ name: 'ערב חנוכה', kind: 'holiday' });
    // one unsure file is enough to hold the name back, even beside a certain one
    expect(name(doc, event('e', [ids[1]!, ids[0]!]))).toEqual({ name: '', kind: 'none' });
    expect(name(doc, event('e', [ids[1]!, ids[0]!], { afterSunset: true }))).toEqual({ name: 'חנוכה', kind: 'holiday' }); // candle 1 and day 1
    // a date without a time is unsure too
    expect(name(doc, event('e', [ids[2]!]))).toEqual({ name: '', kind: 'none' });
    expect(name(doc, event('e', [ids[2]!], { afterSunset: false }))).toEqual({ name: 'ערב חנוכה', kind: 'holiday' });
    // the name is derived at read: nothing of it is stored, and get_summary shows it beside the typed name
    const d = withEvents(doc, [event('evt_1', [ids[0]!], { afterSunset: true })]);
    expect(d.events.evt_1!.name).toBe('');
    expect(summarize(d).events).toMatchObject([{ id: 'evt_1', name: '', shownAs: 'Hanukkah, candle 1', nameKind: 'holiday', afterSunset: true }]);
  });
  it('the names an event could take: one per sunset answer that gives a holiday, or one that holds either way', () => {
    const { doc, ids } = library([{ at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' }, at('2024-12-26T10:00:00'), at('2024-12-27T17:30:00'), at('2024-07-10T18:00:00'), at('2024-10-02T18:30:00')]);
    expect(eventCandidates(doc, event('e', [ids[0]!]))).toEqual([
      { afterSunset: false, name: 'ערב חנוכה', holidayId: 'erev-hanukkah', kind: 'holiday' },
      { afterSunset: true, name: 'חנוכה — נר ראשון', holidayId: 'hanukkah-candle-1', kind: 'holiday' },
    ]);
    expect(eventCandidates(doc, event('e', [ids[0]!]), 'en').map((c) => c.name)).toEqual(['Erev Hanukkah', 'Hanukkah, candle 1']);
    // certain: one name, whatever the answer
    expect(eventCandidates(doc, event('e', [ids[1]!]))).toEqual([{ afterSunset: null, name: 'חנוכה — היום הראשון', holidayId: 'hanukkah-day-1', kind: 'holiday' }]);
    // unsure, and both answers give the same holiday as a whole
    expect(eventCandidates(doc, event('e', [ids[1]!, ids[2]!]))).toEqual([{ afterSunset: null, name: 'חנוכה', holidayId: 'hanukkah', kind: 'holiday' }]);
    // an ordinary evening: nothing to offer
    expect(eventCandidates(doc, event('e', [ids[3]!]))).toEqual([]);
    // the evening of 2 October 2024: the eve of Rosh Hashana before sunset, Rosh Hashana after it
    expect(eventCandidates(doc, event('e', [ids[4]!])).map((c) => [c.afterSunset, c.name])).toEqual([[false, 'ערב ראש השנה'], [true, 'ראש השנה']]);
    // the candidates never depend on the answer already given, and are never stored
    expect(eventCandidates(doc, event('e', [ids[0]!], { afterSunset: true })).length).toBe(2);
  });
});

describe('the library by capture date', () => {
  it('years newest first, months with their Hebrew month, files in capture order, and the files without a date', () => {
    const { doc, ids } = library([at('2024-03-24T11:00:00'), at('2024-03-05'), at('2024-12-25T17:30:00'), undefined, at('2021-06-01T08:00:00'), at('2024-03-24T09:00:00')], [sound]);
    const g = calendarGroups(doc);
    expect(g.years.map((y) => y.year)).toEqual([2024, 2021]);
    expect(g.years[0]!.months).toEqual([
      { month: 12, hebrew: 'כסלו תשפ״ה', assetIds: [ids[2]] },
      { month: 3, hebrew: 'אדר ב׳ תשפ״ד', assetIds: [ids[1], ids[5], ids[0]] },
    ]);
    expect(g.years[1]!.months).toEqual([{ month: 6, hebrew: 'תמוז תשפ״א', assetIds: [ids[4]] }]);
    expect(g.undated).toEqual([ids[3]]); // the sound file is not a picture: it is in neither list
    expect(calendarGroups(createProject({ id: 'p', name: 'P' }))).toEqual({ years: [], undated: [] });
  });
});

describe('on this day', () => {
  const project = (id: string, captures: (Capture | undefined)[], events: (ids: string[]) => LifeEvent[] = () => []) => { const { doc, ids } = library(captures); return { projectId: id, projectName: `Project ${id}`, doc: withEvents(doc, events(ids)), ids }; };
  it('files taken on this day and month in earlier years, newest first, each once, with the years gone by', () => {
    const p = project('p1', [at('2023-12-25T10:00:00'), at('2021-12-25'), at('2024-12-25T09:00:00'), at('2023-12-24T10:00:00'), undefined, at('2020-12-25T10:00:00', { circa: true })], (ids) => [event('evt_1', [ids[0]!], { name: 'אצל סבתא' })]);
    const items = onThisDay([p], '2024-12-25');
    expect(items.map((i) => [i.assetId, i.yearsAgo, i.match])).toEqual([[p.ids[0], 1, 'gregorian'], [p.ids[1], 3, 'gregorian'], [p.ids[5], 4, 'gregorian']]);
    expect(items[0]).toEqual({ projectId: 'p1', projectName: 'Project p1', assetId: p.ids[0], assetName: 'v1.mp4', wall: '2023-12-25T10:00:00', circa: false, yearsAgo: 1, match: 'gregorian', hebrewDate: null, eventName: 'אצל סבתא' });
    expect(items[2]!.circa).toBe(true);
    expect(items[1]!.eventName).toBeNull();
    expect(onThisDay([p], '2024-12-25', 2).length).toBe(2);
    expect(onThisDay([p], '2024-12-25', 0)).toEqual([]);
    expect(onThisDay([p], '2020-12-25')).toEqual([]); // nothing from the same year or later
    expect(onThisDay([], '2024-12-25')).toEqual([]);
    expect(() => onThisDay([p], 'today')).toThrow(RangeError);
  });
  it('a match by the Hebrew date, where the file\'s Hebrew day is certain; Adar of a common year matches Adar II', () => {
    // 25 Kislev: 26 December 2024 (5785), 8 December 2023 (5784), 19 December 2022 (5783)
    const p = project('p1', [at('2023-12-08T10:00:00'), at('2022-12-18T17:30:00'), at('2022-12-18T22:00:00'), at('2022-12-19')], (ids) => [event('evt_1', [ids[3]!], { afterSunset: false })]);
    const items = onThisDay([p], '2024-12-26');
    // the 17:30 file is unsure and is left out; the 22:00 one is after sunset for certain; the day-only one was answered
    expect(items.map((i) => [i.assetId, i.yearsAgo, i.match, i.hebrewDate])).toEqual([
      [p.ids[0], 1, 'hebrew', 'כ״ה בכסלו תשפ״ד'], [p.ids[3], 2, 'hebrew', 'כ״ה בכסלו תשפ״ג'], [p.ids[2], 2, 'hebrew', 'כ״ה בכסלו תשפ״ג'],
    ]);
    expect(items[1]!.eventName).toBe('חנוכה — היום הראשון');
    // Purim: 14 Adar 5785 is 14 March 2025; 14 Adar II 5784 was 24 March 2024; 14 Adar I 5784 was 23 February 2024
    const purim = project('p2', [at('2024-03-24T10:00:00'), at('2024-02-23T10:00:00'), at('2023-03-07T10:00:00')]);
    expect(onThisDay([purim], '2025-03-14').map((i) => [i.assetId, i.yearsAgo, i.hebrewDate])).toEqual([[purim.ids[0], 1, 'י״ד באדר ב׳ תשפ״ד'], [purim.ids[2], 2, 'י״ד באדר תשפ״ג']]);
    // and the other way: from Adar II of a leap year back to Adar of a common one
    expect(onThisDay([purim], '2024-03-24').map((i) => i.assetId)).toEqual([purim.ids[2]]);
    // across projects, newest first
    expect(onThisDay([p, purim], '2024-12-26').map((i) => i.projectId)).toEqual(['p1', 'p1', 'p1']);
  });
});
