/**
 * Story-style render of the new components (ADR-0022) with fixture data, to static markup (the repository has no DOM test
 * environment): the fixed test ids of packs.testids.ts are on the elements, the roles and labels are there, nothing is drawn
 * from a clock, and the text has no emoji. The behaviour behind the buttons is in packs.logic.test.ts and fontPicker.logic.test.ts;
 * the browser proofs (packs-proof, fonts-proof, a11y-audit) walk the real thing.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG } from '@pulseframe/core';
import { FontPicker } from './FontPicker.tsx';
import { PackFields } from './PackFields.tsx';
import { PackPageView, type PackPageViewProps } from './PackPage.tsx';
import { PacksShelf } from './PacksShelf.tsx';
import { FONT_TESTIDS, PACK_TABS, PACK_TESTIDS } from './packs.testids.ts';
import { FIXTURE_BIRTHDAY, FIXTURE_PACK } from './packs.fixture.ts';
import { packView } from './packs.logic.ts';

const count = (html: string, needle: string) => html.split(needle).length - 1;
const noop = () => undefined;
const shelf = (lang: 'he' | 'en', today = { y: 2026, m: 11, d: 17 }) => renderToStaticMarkup(h(PacksShelf, { packs: [FIXTURE_BIRTHDAY, FIXTURE_PACK], today, lang, onOpen: noop }));

describe('PacksShelf', () => {
  it('draws one card per pack with its id, the suggested one first with its reason and a dismiss button', () => {
    const html = shelf('he');
    expect(html).toContain(`data-testid="${PACK_TESTIDS.shelf}"`);
    expect(count(html, `data-testid="${PACK_TESTIDS.card}"`)).toBe(2);
    expect(html.indexOf('data-pack-id="pack.fixture-hanukkah"')).toBeLessThan(html.indexOf('data-pack-id="pack.fixture-birthday"'));
    expect(count(html, `data-testid="${PACK_TESTIDS.suggest}"`)).toBe(1);
    expect(html).toContain('חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים');
    expect(html).toContain(`data-testid="${PACK_TESTIDS.suggestDismiss}"`);
    expect(html).toContain('הסתרת ההצעה לחבילה חנוכה (דוגמה)');
    expect(html).toContain('3 תבניות · 5 אלמנטים');
  });
  it('shows the cover pictures as real element images with no alt text noise', () => {
    const html = shelf('he');
    expect(count(html, 'data:image/svg+xml')).toBeGreaterThanOrEqual(3);
    expect(html).toContain('alt=""');
  });
  it('has no suggestion on another day and says nothing about the date it did not read', () => {
    const html = shelf('he', { y: 2026, m: 6, d: 1 });
    expect(html).not.toContain(PACK_TESTIDS.suggest);
    expect(count(html, `data-testid="${PACK_TESTIDS.card}"`)).toBe(2);
  });
  it('an empty shelf says so', () => {
    const html = renderToStaticMarkup(h(PacksShelf, { packs: [], today: { y: 2026, m: 11, d: 17 }, lang: 'en', onOpen: noop }));
    expect(html).toContain('There are no packs in this build yet.');
    expect(html).toContain('role="status"');
  });
  it('is English in English, with no emoji', () => {
    const html = shelf('en');
    expect(html).toContain('Hanukkah (fixture)');
    expect(html).toContain('Hide the suggestion of the Hanukkah (fixture) pack');
    expect(html).toContain('Hanukkah begins on the evening of 4 December · in 17 days');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

const view = (lang: 'he' | 'en', tab: (typeof PACK_TABS)[number], over: Partial<PackPageViewProps> = {}) => renderToStaticMarkup(h(PackPageView, {
  pack: FIXTURE_PACK, view: packView(FIXTURE_PACK, { 'sfx.fixture-chime': { he: 'צלצול', en: 'Chime' } }), lang, tab, onTab: noop, onBack: noop, onOpenTemplate: noop,
  captionTracks: [{ id: 'c1', name: 'כתוביות' }], captionTrackId: 'c1', onCaptionTrack: noop, fields: {}, onFields: noop, busy: null, status: null,
  onAddTitle: noop, onApplyLook: noop, onApplyCaption: noop, onAddElement: noop, onAddSound: noop, ...over,
}));
describe('PackPageView', () => {
  it('has the page, the back button, the six tabs with the right one selected and its panel', () => {
    for (const t of PACK_TABS) {
      const html = view('he', t);
      expect(html).toContain(`data-testid="${PACK_TESTIDS.page}"`);
      expect(html).toContain(`data-testid="${PACK_TESTIDS.back}"`);
      for (const x of PACK_TABS) expect(html).toContain(`data-testid="${PACK_TESTIDS.tab(x)}"`);
      expect(html).toContain(`data-testid="${PACK_TESTIDS.panel(t)}"`);
      expect(count(html, 'role="tab"')).toBe(6);
      expect(count(html, 'aria-selected="true"')).toBe(1);
      expect(html).toContain('role="tabpanel"');
    }
    expect(view('he', 'templates')).toContain('תבניות');
    expect(view('he', 'sound')).toContain('צליל');
  });
  it('lists templates, titles with their words, elements, looks, caption looks and sounds with their ids', () => {
    expect(count(view('he', 'templates'), `data-testid="${PACK_TESTIDS.template}"`)).toBe(2);
    const titles = view('he', 'titles', { fields: { name: 'דנה' } });
    expect(titles).toContain(`data-testid="${PACK_TESTIDS.title}"`);
    expect(titles).toContain('data-title-id="title.fixture-night"');
    expect(titles).toContain('חג שמח דנה');
    expect(titles).toContain(`data-testid="${PACK_TESTIDS.fields}"`);
    expect(count(view('he', 'elements'), `data-testid="${PACK_TESTIDS.element}"`)).toBe(4);
    expect(view('he', 'looks')).toContain('data-look-id="look.fixture-warm"');
    expect(count(view('he', 'captions'), `data-testid="${PACK_TESTIDS.captionLook}"`)).toBe(2);
    const sound = view('he', 'sound');
    expect(sound).toContain('data-sfx-id="sfx.fixture-chime"');
    expect(sound).toContain('צלצול');
    expect(sound).toContain('data-style-id="music.');
    expect(sound).toContain('עוד לא הושמעה לאף אחד');
  });
  it('says each addition is one undo and that a library file stays', () => {
    expect(view('he', 'titles')).toContain('כל הוספה היא פעולה אחת');
    expect(view('he', 'elements')).toContain('הקובץ נשאר בספרייה');
  });
  it('a caption look cannot be applied without a caption track, and the page says why', () => {
    const html = view('he', 'captions', { captionTracks: [], captionTrackId: null });
    expect(html).toContain('אין רצועת כתוביות בפרויקט');
    expect(html).toContain('aria-disabled="true"');
  });
  it('shows the busy item as busy, and a status as a polite live region (a failure as such)', () => {
    expect(view('he', 'looks', { busy: 'look.fixture-warm' })).toContain('מוסיף…');
    const ok = view('he', 'looks', { status: { kind: 'ok', text: 'נוסף: חמים' } });
    expect(ok).toContain('aria-live="polite"');
    expect(ok).toContain('נוסף: חמים');
    expect(view('en', 'looks', { status: { kind: 'err', text: 'no' } })).toContain('is-err');
  });
  it('an empty tab says so instead of drawing nothing', () => {
    const html = view('he', 'looks', { pack: { ...FIXTURE_PACK, looks: [] }, view: { ...packView(FIXTURE_PACK), looks: [] } });
    expect(html).toContain('אין כאן עדיין פריטים');
  });
  it('says where the pack comes from, and has no emoji', () => {
    const html = view('he', 'looks');
    expect(html).toContain('נוצר בתוכנה הזו');
    for (const t of PACK_TABS) expect(view('en', t)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

const fieldsHtml = (value = {}, candle = true, lang: 'he' | 'en' = 'he') => renderToStaticMarkup(h(PackFields, { fields: ['name', 'name2', 'age', 'night', 'place', 'when'], candle, value, onChange: noop, lang }));
describe('PackFields', () => {
  it('is a fieldset «פרטים» with one field per pack field, in the order given', () => {
    const html = fieldsHtml();
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    expect(html).toContain('פרטים');
    for (const k of ['name', 'name2', 'age', 'place', 'when'] as const) expect(html).toContain(`data-testid="${PACK_TESTIDS.field(k)}"`);
    expect(html).toContain(`data-testid="${PACK_TESTIDS.field('night')}"`);
    expect(html.indexOf(PACK_TESTIDS.field('name'))).toBeLessThan(html.indexOf(PACK_TESTIDS.field('place')));
  });
  it('the names follow their own direction, the age is a number read left to right, the candle has eight choices', () => {
    const html = fieldsHtml();
    expect(html).toMatch(/data-testid="tpl-field-name"[^>]*dir="auto"|dir="auto"[^>]*data-testid="tpl-field-name"/);
    expect(html).toMatch(/inputMode="numeric"|inputmode="numeric"/i);
    expect(count(html, 'role="radio"')).toBe(8);
    expect(html).toContain('נר 8');
  });
  it('a candle template has the date, the live Hebrew date in a bdi inside a polite live region, and the switch on by default', () => {
    const html = fieldsHtml({ date: '2026-12-04' });
    expect(html).toContain(`data-testid="${PACK_TESTIDS.date}"`);
    expect(html).toMatch(/data-testid="tpl-field-hebrew-date"[^>]*aria-live="polite"|aria-live="polite"[^>]*data-testid="tpl-field-hebrew-date"/);
    expect(html).toContain('<bdi dir="rtl" lang="he">כ״ד בכסלו תשפ״ז</bdi>');
    expect(html).toContain('כ״ה בכסלו תשפ״ז');
    expect(html).toContain(`data-testid="${PACK_TESTIDS.atLighting}"`);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('צולם בהדלקת הנרות של אותו ערב');
    expect(html).toContain('חושב מהתאריך: נר 1');
  });
  it('the switch is off when the value says so, and a date that is not Hanukkah says no candle is worked out', () => {
    expect(fieldsHtml({ date: '2026-06-01', atLighting: false })).toContain('aria-checked="false"');
    expect(fieldsHtml({ date: '2026-06-01' })).toContain('אינו בחנוכה');
  });
  it('a template that is not about candles has no date and no switch, but still the candle choice when it holds {night}', () => {
    const html = fieldsHtml({}, false);
    expect(html).not.toContain(PACK_TESTIDS.date);
    expect(html).not.toContain(PACK_TESTIDS.atLighting);
    expect(html).toContain(`data-testid="${PACK_TESTIDS.field('night')}"`);
  });
  it('a value is shown as it is (literal), English in English, no emoji', () => {
    expect(fieldsHtml({ name: 'דנה {n}' })).toContain('value="דנה {n}"');
    const en = fieldsHtml({}, true, 'en');
    expect(en).toContain('Details');
    expect(en).toContain('Filmed at that evening&#x27;s candle lighting');
    expect(en).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('FontPicker', () => {
  const html = (value = { family: 'Heebo', weight: 400 }, lang: 'he' | 'en' = 'he', disabled = false) => renderToStaticMarkup(h(FontPicker, { value, onChange: noop, lang, label: lang === 'he' ? 'גופן' : 'Font', disabled }));
  it('is a listbox with one option per catalogue family, each carrying its family and weight', () => {
    const out = html();
    expect(out).toContain(`data-testid="${FONT_TESTIDS.picker}"`);
    expect(out).toContain('role="listbox"');
    expect(count(out, `data-testid="${FONT_TESTIDS.option}"`)).toBe(FONT_CATALOG.length);
    for (const f of FONT_CATALOG) expect(out).toContain(`data-family="${f.family}"`);
    expect(out).toMatch(/data-family="Heebo"[^>]*data-weight="400"|data-weight="400"[^>]*data-family="Heebo"/);
    expect(out).toMatch(/aria-selected="true"[^>]*/);
    expect(count(out, 'aria-selected="true"')).toBe(1);
  });
  it('draws each option in its own face with the sample «אבג שָׁלוֹם»', () => {
    const out = html();
    for (const f of FONT_CATALOG) expect(out).toContain(`font-family:&quot;${f.family}&quot;`);
    expect(count(out, 'אבג שָׁלוֹם')).toBe(FONT_CATALOG.length);
  });
  it('has the four category chips as pressed-state toggles, the badge «ניקוד נבדק» on proved rows and the pairings line', () => {
    const out = html();
    expect(count(out, `data-testid="${FONT_TESTIDS.category}"`)).toBe(4);
    for (const c of ['סנס', 'סריף', 'כותרת', 'כתב יד']) expect(out).toContain(c);
    expect(count(out, 'aria-pressed="false"')).toBe(4);
    expect(count(out, `data-testid="${FONT_TESTIDS.nikud}"`)).toBe(FONT_CATALOG.filter((f) => f.nikud === 'positioned').length);
    expect(out).toContain('ניקוד נבדק');
    expect(out).toContain(`data-testid="${FONT_TESTIDS.pairs}"`);
    expect(out).toContain('מתאים עם…');
  });
  it('shows the pairings of the chosen family and a weight control for a family with two weights', () => {
    const suez = html({ family: 'Suez One', weight: 400 });
    expect(suez).toContain('Heebo');
    expect(suez).toContain('כותרת עבה ובולטת');
    expect(suez).not.toContain('aria-label="עובי"');
    expect(html({ family: 'David Libre', weight: 700 })).toContain('aria-label="עובי"');
  });
  it('is English in English and honours disabled', () => {
    const en = html({ family: 'Heebo', weight: 400 }, 'en');
    expect(en).toContain('Pairs with…');
    expect(en).toContain('Vowel points checked');
    expect(html({ family: 'Heebo', weight: 400 }, 'he', true)).toContain('aria-disabled="true"');
    expect(en).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
