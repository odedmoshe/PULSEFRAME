import { describe, expect, it } from 'vitest';
import { createProject, PACK_FIELD_KEYS, PackFieldsInputSchema, TEMPLATES } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { PACK_I18N_KEYS, PACK_STRINGS } from './packs.strings.ts';
import { PACK_TABS } from './packs.testids.ts';
import { FIXTURE_BIRTHDAY, FIXTURE_PACK, docWithCaptionTracks } from './packs.fixture.ts';
import {
  CANDLES, DISMISS_KEY, FIELD_MAX, addDays, atLightingOn, captionAction, captionTargets, countLine, coverOf, dateProblem, derivedCandle, dismissKey, elementColours, fieldWasCut, fieldsProblem, hebrewDateOf, isPackTab, localDay,
  lookAction, packView, parseWallDate, pickCaptionTarget, readDismissed, setAtLighting, setCandle, setDate, setField, shelfOrder, shownCandle, suggestionsFor, tabCounts, tabSpecs, titleAction, titleFieldValues, wallDate, writeDismissed,
  type StorageLike,
} from './packs.logic.ts';

const day = (y: number, m: number, d: number) => ({ y, m, d });
const memory = (): StorageLike & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }; };
const PACKS = [FIXTURE_BIRTHDAY, FIXTURE_PACK];

describe('suggestions for the client\'s day', () => {
  it('suggests the holiday pack 17 days before the evening that begins it, with the reason as the pack data words it', () => {
    const s = suggestionsFor(PACKS, day(2026, 11, 17));
    expect([...s.keys()]).toEqual(['pack.fixture-hanukkah']);
    const h = s.get('pack.fixture-hanukkah')!;
    expect(h.daysAway).toBe(17);
    expect(h.reason.he).toBe('חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים');
    expect(h.eveningBefore).toBe(true);
  });
  it('suggests nothing outside the window, and a birthday pack only from a hint', () => {
    expect(suggestionsFor(PACKS, day(2026, 11, 13)).size).toBe(0);
    expect(suggestionsFor(PACKS, day(2027, 1, 5)).size).toBe(0);
    const s = suggestionsFor(PACKS, day(2026, 6, 1), [{ kind: 'birthday', on: day(2026, 6, 5), name: 'דנה' }]);
    expect(s.get('pack.fixture-birthday')?.daysAway).toBe(4);
  });
  it('a day that does not exist suggests nothing', () => { expect(suggestionsFor(PACKS, day(2026, 2, 30)).size).toBe(0); });
  it('works from the date it is given: nothing reads a clock (the same day twice gives the same answer)', () => {
    expect(suggestionsFor(PACKS, day(2026, 12, 1))).toEqual(suggestionsFor(PACKS, day(2026, 12, 1)));
    expect(suggestionsFor(PACKS, day(2026, 12, 1)).get('pack.fixture-hanukkah')?.daysAway).toBe(3);
  });
  it('the client\'s own local day comes from the Date it is handed', () => { expect(localDay(new Date(2026, 11, 4, 23, 59))).toEqual(day(2026, 12, 4)); });
});

describe('shelf order and dismissals', () => {
  const sug = suggestionsFor(PACKS, day(2026, 11, 17));
  it('puts the suggested pack first and keeps the others in their order', () => {
    const rows = shelfOrder(PACKS, sug, new Set());
    expect(rows.map((r) => r.pack.id)).toEqual(['pack.fixture-hanukkah', 'pack.fixture-birthday']);
    expect(rows[0]!.suggestion?.daysAway).toBe(17);
    expect(rows[1]!.suggestion).toBeNull();
  });
  it('a dismissed suggestion goes back to its place in the list and loses its badge', () => {
    const key = dismissKey(sug.get('pack.fixture-hanukkah')!);
    expect(key).toBe('pack.fixture-hanukkah@2026-12-05');
    const rows = shelfOrder(PACKS, sug, new Set([key]));
    expect(rows.map((r) => r.pack.id)).toEqual(['pack.fixture-birthday', 'pack.fixture-hanukkah']);
    expect(rows.every((r) => r.suggestion === null)).toBe(true);
  });
  it('a dismissal belongs to its occurrence: next year\'s holiday is suggested again', () => {
    const old = dismissKey({ packId: 'pack.fixture-hanukkah', firstDay: day(2025, 12, 15) });
    const rows = shelfOrder(PACKS, sug, new Set([old]));
    expect(rows[0]!.suggestion).not.toBeNull();
  });
  it('several suggestions sort nearest first', () => {
    const both = suggestionsFor(PACKS, day(2026, 12, 1), [{ kind: 'birthday', on: day(2026, 12, 2) }]);
    expect(shelfOrder(PACKS, both, new Set()).map((r) => r.pack.id)).toEqual(['pack.fixture-birthday', 'pack.fixture-hanukkah']);
  });
  it('keeps and reads dismissals in the store, kept in a list that stays short', () => {
    const store = memory();
    expect(writeDismissed(new Set(['a', 'b']), store)).toBe(true);
    expect([...readDismissed(store)]).toEqual(['a', 'b']);
    writeDismissed(new Set(Array.from({ length: 100 }, (_, i) => `k${i}`)), store);
    expect(readDismissed(store).size).toBe(40);
    expect(readDismissed(store).has('k99')).toBe(true);
  });
  it('a missing, refusing or damaged store never throws: no store keeps nothing, a refusing one says so, garbage reads as empty', () => {
    expect(writeDismissed(new Set(['a']), null)).toBe(false);
    expect(readDismissed(null).size).toBe(0);
    const refusing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(writeDismissed(new Set(['a']), refusing)).toBe(false);
    expect(readDismissed(refusing).size).toBe(0);
    const bad = memory(); bad.data.set(DISMISS_KEY, '{not json'); expect(readDismissed(bad).size).toBe(0);
    bad.data.set(DISMISS_KEY, JSON.stringify({ a: 1 })); expect(readDismissed(bad).size).toBe(0);
    bad.data.set(DISMISS_KEY, JSON.stringify(['a', 3, null])); expect([...readDismissed(bad)]).toEqual(['a']);
  });
});

describe('the count line, the cover and the tabs', () => {
  it('words the count in Hebrew and English, with the singular', () => {
    expect(countLine({ templateIds: ['a', 'b', 'c', 'd'], elementIds: Array(25).fill('x') }, PACK_STRINGS.he)).toBe('4 תבניות · 25 אלמנטים');
    expect(countLine({ templateIds: ['a'], elementIds: ['x'] }, PACK_STRINGS.he)).toBe('תבנית אחת · אלמנט אחד');
    expect(countLine({ templateIds: ['a', 'b'], elementIds: ['x'] }, PACK_STRINGS.en)).toBe('2 templates · 1 element');
  });
  it('draws only the cover elements this build has, on the pack palette', () => {
    const c = coverOf({ ...FIXTURE_PACK, coverElementIds: [...FIXTURE_PACK.coverElementIds.slice(0, 2), 'element.nope'] });
    expect(c.ids).toHaveLength(2);
    expect(c).toMatchObject({ color: '#FFD166', color2: '#3DE0C8', ground: '#1B2A4A' });
    expect(coverOf({ coverElementIds: [], palette: ['#112233'] })).toMatchObject({ ids: [], color: '#112233', color2: '#112233', ground: '#112233' });
  });
  it('has the six tabs in order with their counts', () => {
    expect(PACK_TABS).toEqual(['templates', 'titles', 'elements', 'looks', 'captions', 'sound']);
    expect(tabCounts(FIXTURE_PACK)).toEqual({ templates: 3, titles: 1, elements: 5, looks: 1, captions: 2, sound: 2 });
    expect(tabSpecs(FIXTURE_PACK, PACK_STRINGS.he.tab).map((t) => t.label)).toEqual(['תבניות', 'כותרות', 'אלמנטים', 'מראה', 'כתוביות', 'צליל']);
    expect(isPackTab('looks')).toBe(true);
    expect(isPackTab('music')).toBe(false);
  });
});

describe('the items of a pack with their names', () => {
  it('resolves what the build knows and leaves out an id it does not (never invents one)', () => {
    const v = packView(FIXTURE_PACK, { 'sfx.fixture-chime': { he: 'צלצול', en: 'Chime' } });
    expect(v.templates.map((t) => t.id)).toEqual([TEMPLATES[0]!.id, TEMPLATES[1]!.id]);
    expect(v.elements).toHaveLength(4);
    expect(v.captionLooks).toHaveLength(2);
    expect(v.music).toHaveLength(1);
    expect(v.sfx).toEqual([{ id: 'sfx.fixture-chime', name: { he: 'צלצול', en: 'Chime' } }]);
    expect(packView(FIXTURE_PACK).sfx).toEqual([{ id: 'sfx.fixture-chime', name: null }]);
  });
});

describe('the one operation behind each action', () => {
  const rate = { num: 30, den: 1 };
  const start = { value: '0', timescale: 1 } as never;
  it('a title is ONE add_text with its words, text style and place; a field written in is literal', () => {
    const a = titleAction(FIXTURE_PACK.titles[0]!, { lang: 'he', start, rate, fields: { name: 'דנה {n}', date: '2026-12-04' }, motion: 'full' });
    expect(a.op.op).toBe('add_text');
    expect(a.op.args).toMatchObject({ text: 'חג שמח דנה {n}', presetId: 'clean-white', transform: { x: 0, y: 0.1 }, style: { sizeFrac: 0.08 } });
    expect(a.fallbackUsed).toBe(false);
    expect(a.label).toBe('נר ראשון');
  });
  it('a field left empty uses the title\'s fallback words, and says so', () => {
    const a = titleAction(FIXTURE_PACK.titles[0]!, { lang: 'en', start, rate, fields: {}, motion: 'none' });
    expect(a.op.args).toMatchObject({ text: 'Happy holiday' });
    expect(a.fallbackUsed).toBe(true);
  });
  it('a look is ONE commit: an add_adjustment over the whole edit (nothing to move in a project without graphic elements)', () => {
    const a = lookAction(FIXTURE_PACK.looks[0]!, 'he', createProject({ id: 'prj_look', name: 'look', width: 540, height: 960 }));
    expect(a.ops).toHaveLength(1);
    expect(a.ops[0]).toMatchObject({ op: 'add_adjustment', args: { span: 'edit', label: 'חמים' } });
    expect(lookAction(FIXTURE_PACK.looks[0]!, 'he', null).ops).toEqual([]);
  });
  it('a caption look is ONE apply_caption_look', () => { expect(captionAction('t1', 'look-x')).toEqual({ op: 'apply_caption_look', args: { trackId: 't1', lookId: 'look-x' } }); });
  it('finds the caption tracks of the main sequence and keeps the chosen one while it is there', () => {
    const doc = docWithCaptionTracks([{ id: 'c1', name: 'כתוביות 1' }, { id: 'c2', name: 'כתוביות 2' }]);
    const t = captionTargets(doc);
    expect(t.map((x) => x.id)).toEqual(['c1', 'c2']);
    expect(pickCaptionTarget(t, 'c2')).toBe('c2');
    expect(pickCaptionTarget(t, 'gone')).toBe('c1');
    expect(captionTargets(null)).toEqual([]);
    expect(pickCaptionTarget([], null)).toBeNull();
  });
  it('an element is made in the pack\'s colours', () => {
    expect(elementColours(FIXTURE_PACK)).toEqual({ color: '#FFD166', color2: '#3DE0C8' });
    expect(elementColours({ palette: [] })).toEqual({ color: '#FFFFFF' });
  });
  it('the title\'s field values leave out the date and the lighting switch (they belong to the template dialog)', () => {
    expect(titleFieldValues({ name: 'דנה', date: '2026-12-04', atLighting: false, night: '3', age: '' })).toEqual({ name: 'דנה', night: '3' });
  });
});

describe('the fields of the template dialog', () => {
  it('writes a field, leaves it out when empty, turns a newline to a space and cuts at 80', () => {
    expect(setField({}, 'name', 'דנה')).toEqual({ name: 'דנה' });
    expect(setField({ name: 'דנה' }, 'name', '   ')).toEqual({});
    expect(setField({}, 'place', 'ים\nהמלח')).toEqual({ place: 'ים המלח' });
    expect(setField({}, 'when', 'x'.repeat(200)).when).toHaveLength(FIELD_MAX);
    expect(fieldWasCut('when', 'x'.repeat(81))).toBe('long');
    expect(fieldWasCut('name', 'דנה')).toBeNull();
  });
  it('the age takes digits only, three at most', () => {
    expect(setField({}, 'age', '7a')).toEqual({ age: '7' });
    expect(setField({}, 'age', '1234')).toEqual({ age: '123' });
    expect(setField({ age: '7' }, 'age', 'abc')).toEqual({});
    expect(fieldWasCut('age', '7a')).toBe('age');
  });
  it('never makes a value the route would refuse', () => {
    const v = setField(setField(setCandle(setDate({}, '2026-12-04'), 3), 'name', 'דנה'), 'age', '6');
    expect(fieldsProblem(v)).toBeNull();
    expect(PackFieldsInputSchema.safeParse(v).success).toBe(true);
    for (const k of Object.keys(v)) expect([...PACK_FIELD_KEYS, 'date', 'atLighting']).toContain(k);
    expect(fieldsProblem({ date: '2026-13-40' })).not.toBeNull();
  });
  it('the candle is 1 to 8, picked or worked out from the date', () => {
    expect(CANDLES).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(setCandle({}, 5)).toEqual({ night: '5' });
    expect(setCandle({ night: '5' }, null)).toEqual({});
    expect(setCandle({}, 9)).toEqual({});
    expect(shownCandle({})).toEqual({ n: null, by: 'none' });
    expect(shownCandle({ night: '4' })).toEqual({ n: 4, by: 'picked' });
    expect(shownCandle({ night: '4', date: '2026-12-04' })).toEqual({ n: 4, by: 'picked' });
    expect(shownCandle({ night: 'x' })).toEqual({ n: null, by: 'none' });
  });
  it('works the candle out from the date and the switch: 4 December 2026 at the lighting is candle 1, its daytime is not Hanukkah yet', () => {
    expect(atLightingOn({})).toBe(true);
    expect(derivedCandle({ date: '2026-12-04' })).toBe(1);
    expect(derivedCandle({ date: '2026-12-04', atLighting: false })).toBeNull();
    expect(derivedCandle({ date: '2026-12-05', atLighting: false })).toBe(1);
    expect(derivedCandle({ date: '2026-12-11' })).toBe(8);
    expect(derivedCandle({ date: '2026-06-01' })).toBeNull();
    expect(derivedCandle({})).toBeNull();
    expect(shownCandle({ date: '2026-12-04' })).toEqual({ n: 1, by: 'date' });
  });
  it('the switch is on unless turned off, and on is not written into the value', () => {
    expect(setAtLighting({ atLighting: false }, true)).toEqual({});
    expect(setAtLighting({}, false)).toEqual({ atLighting: false });
    expect(atLightingOn({ atLighting: false })).toBe(false);
  });
  it('keeps a valid date and drops one that is not a real day or is outside 1900 to 2100', () => {
    expect(setDate({}, '2026-12-04')).toEqual({ date: '2026-12-04' });
    expect(setDate({ date: '2026-12-04' }, '')).toEqual({});
    for (const bad of ['2026-02-30', '1899-12-31', '2101-01-01', '2026-1-4', 'x']) { expect(parseWallDate(bad), bad).toBeNull(); expect(dateProblem(bad), bad).toBe(true); }
    expect(dateProblem('')).toBe(false);
  });
  it('words the live Hebrew date from the life line\'s calendar, with the evening\'s day when the switch is on', () => {
    expect(hebrewDateOf('2026-12-05', false)).toEqual({ day: 'כ״ה בכסלו תשפ״ז', evening: null });
    expect(hebrewDateOf('2026-12-04', true)).toEqual({ day: 'כ״ד בכסלו תשפ״ז', evening: 'כ״ה בכסלו תשפ״ז' });
    expect(hebrewDateOf(undefined, true)).toBeNull();
    expect(hebrewDateOf('2026-02-30', true)).toBeNull();
  });
  it('day helpers agree', () => { expect(wallDate(addDays(day(2026, 12, 31), 1))).toBe('2027-01-01'); });
});

describe('strings', () => {
  const keys = (o: unknown, p = ''): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}${k}.`)) : [p.slice(0, -1)]);
  it('Hebrew and English cover the same keys and the same function shapes', () => {
    expect(keys(PACK_STRINGS.en).sort()).toEqual(keys(PACK_STRINGS.he).sort());
    for (const k of Object.keys(PACK_STRINGS.he) as (keyof typeof PACK_STRINGS.he)[]) expect(typeof PACK_STRINGS.en[k]).toBe(typeof PACK_STRINGS.he[k]);
  });
  it('the shared words come from i18n, in both languages', () => {
    for (const k of PACK_I18N_KEYS) { expect(dictionaries.he[k], k).toBeTruthy(); expect(dictionaries.en[k], k).toBeTruthy(); }
    expect(PACK_STRINGS.he.fields.atLighting).toBe('צולם בהדלקת הנרות של אותו ערב');
    expect(PACK_STRINGS.he.fields.legend).toBe('פרטים');
    for (const k of PACK_FIELD_KEYS) expect(PACK_STRINGS.he.fields.label[k]).toBeTruthy();
  });
  it('has Hebrew letters in every Hebrew sentence, no emoji anywhere', () => {
    const all = JSON.stringify(PACK_STRINGS, (_k, v) => (typeof v === 'function' ? v(2, 'x') ?? String(v) : v));
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(PACK_STRINGS.he.shelfTitle).toBe('חבילות');
    expect(PACK_STRINGS.he.tab.sound).toBe('צליל');
  });
});
