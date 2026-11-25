/**
 * «כלים מוקלטים» in the editor (wave 7 instruments track; builder W3): the pure helpers, the strings in both languages (no forbidden
 * word), the choice rendered in every state (words and next step, radiogroup, duties before an add), and the request body.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { INSTRUMENTS_FORBIDDEN_WORDS, INSTRUMENTS_FORBIDDEN_WORDS_HE, KIT_STATES, type MusicKitStatus } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { addDecision, auditionBit, auditionOrder, auditionPair, dutiesOf, instrumentsPreviewUrl, kitView, levelScale, licenceWhy, parseLevelScale, refusalWords, type KitView } from './instruments.logic.ts';
import { INSTRUMENTS_UI_STRINGS, instrumentsT } from './instruments.strings.ts';
import { INSTRUMENTS_TESTIDS as ID } from './instruments.testids.ts';
import { InstrumentsChoice } from './InstrumentsChoice.tsx';
import { addBody, lengthChoices, musicRows } from '../music.logic.ts';
import { MUSIC_STRINGS } from '../music.strings.ts';

const kit = (over: Partial<MusicKitStatus> = {}): MusicKitStatus => ({
  kitId: 'kit.calm.vsco', version: 1, styleId: 'music.calm', state: 'ready', reason: null,
  parts: [{ part: 'pad', instrument: 'strings', title: { he: 'מיתרים', en: 'Strings' } }, { part: 'arp', instrument: 'piano', title: { he: 'פסנתר', en: 'Piano' } }],
  sources: [], label: { he: 'כלים מוקלטים — עוד לא הושמעו לאף אחד', en: 'Recorded instruments — nobody has listened yet' }, heard: null, ...over,
});
const view = (over: Partial<MusicKitStatus> = {}): KitView => kitView({ phase: 'ok', kits: [kit(over)] }, 'music.calm');
const html = (v: KitView, value: 'synth' | 'recorded', lang: 'he' | 'en' = 'he') =>
  renderToStaticMarkup(createElement(InstrumentsChoice, { styleId: 'music.calm', lang, bars: 16, seed: 1, value, onChange: () => undefined, view: v, onRecheck: () => undefined }));

describe('instruments logic', () => {
  it('the blind order maps a bit to «א»/«ב»; the preview URL asks for recorded and the level match only when chosen', () => {
    expect(auditionOrder(0)).toEqual({ a: 'recorded', b: 'synth' });
    expect(auditionOrder(1)).toEqual({ a: 'synth', b: 'recorded' });
    expect(instrumentsPreviewUrl('music.calm', 16, 1, 'synth')).toBe('/api/v1/music/music.calm/audio?bars=16&seed=1');
    expect(instrumentsPreviewUrl('music.calm', 16, 1, 'recorded', true)).toBe('/api/v1/music/music.calm/audio?bars=16&seed=1&instruments=recorded&match=1');
    expect([levelScale('0.5'), levelScale('1.2'), levelScale(null), levelScale('x'), levelScale('0')]).toEqual([0.5, 1, 1, 1, 1]);
  });
  it('the strict level scale: a decimal in (0, 1] or null (then the pair is not played)', () => {
    expect(['0.5', '1', '1.0', '0.0712'].map(parseLevelScale)).toEqual([0.5, 1, 1, 0.0712]);
    for (const bad of [null, '', '0', '0.0', '1.2', '-1', 'x', '1e-1', '0.5 db']) expect(parseLevelScale(bad), String(bad)).toBeNull();
  });
  it('the order is a pure function of the request: pinned vectors, same twice, about half each way, both changes with the seed', () => {
    const pinned = [['music.calm', 16, 1], ['music.calm', 16, 2], ['music.calm', 8, 1], ['music.pop', 16, 1]] as const;
    const bits = pinned.map(([s, b, d]) => auditionBit(s, b, d));
    expect(pinned.map(([s, b, d]) => auditionBit(s, b, d))).toEqual(bits);
    expect(bits).toEqual([1, 1, 0, 0]); // vectors recorded from this function once: they pin it against a change
    let ones = 0;
    for (let seed = 0; seed < 2000; seed++) ones += auditionBit('music.calm', 16, seed);
    expect(ones).toBeGreaterThan(900);
    expect(ones).toBeLessThan(1100);
    expect(auditionPair('music.calm', 16, 1)).toEqual(auditionOrder(bits[0]!));
  });
  it('a recorded request is allowed only when chosen and the kit is ready; synth is always allowed and carries nothing', () => {
    expect(addDecision('synth', view({ state: 'not_calibrated' }))).toEqual({ send: true });
    expect(addDecision('recorded', view())).toEqual({ send: true, instruments: 'recorded' });
    for (const st of KIT_STATES.filter((s) => s !== 'ready')) expect(addDecision('recorded', view({ state: st })), st).toEqual({ send: false, phase: st });
    expect(addDecision('recorded', kitView({ phase: 'loading' }, 'music.calm'))).toEqual({ send: false, phase: 'checking' });
    expect(addDecision('recorded', kitView({ phase: 'failed', why: 'x' }, 'music.calm'))).toEqual({ send: false, phase: 'failed' });
    expect(addDecision('recorded', kitView({ phase: 'ok', kits: [] }, 'music.calm'))).toEqual({ send: false, phase: 'no_kit' });
  });
  it('duties: whose credit, non-commercial, no duty; licences in words', () => {
    const d = dutiesOf([
      { sourceId: 'a', title: 'A', licenceId: 'CC-BY-4.0', credit: true, nonCommercial: false, shareable: true },
      { sourceId: 'b', title: 'B', licenceId: 'CC-BY-NC-4.0', credit: true, nonCommercial: true, shareable: false },
      { sourceId: 'c', title: 'C', licenceId: 'CC0-1.0', credit: false, nonCommercial: false, shareable: true },
    ]);
    expect(d).toEqual({ credit: ['A', 'B'], nonCommercial: true, none: ['C'] });
    expect(['CC-BY-SA-4.0', 'CC-BY-ND-4.0', 'custom:x', 'CC0-1.0'].map(licenceWhy)).toEqual(['sa', 'nd', 'unknown', 'other']);
  });
  it('a refusal is worded in Hebrew with its next step; in English it keeps the server sentence and hint', () => {
    const f = { message: 'recorded instruments are not built in this build yet', hint: 'Choose the synthesised sounds.' };
    expect(refusalWords('he', f)).toContain('«מסונתז»');
    expect(refusalWords('en', f)).toBe('recorded instruments are not built in this build yet. Choose the synthesised sounds.');
  });
});

describe('instruments strings', () => {
  it('Hebrew and English have the same keys; every key resolves; no forbidden word, in either language', () => {
    expect(Object.keys(INSTRUMENTS_UI_STRINGS.en).sort()).toEqual(Object.keys(INSTRUMENTS_UI_STRINGS.he).sort());
    const words = (lang: 'he' | 'en') => {
      const t = instrumentsT(lang);
      const own = Object.keys(INSTRUMENTS_UI_STRINGS[lang]).map((k) => t(k));
      const shared = ['sound', 'synth', 'recorded', 'unheard', 'heardOn', 'parts', 'allOrNothing', 'state.checking', 'state.ready', 'state.item_missing', 'audition', 'reveal', 'revealed', 'levelNote', 'heard', 'heardSaved', 'notHeard', 'credits', 'nonCommercial'].map((k) => t(k));
      return [...own, ...shared];
    };
    for (const w of words('he')) { expect(w).not.toMatch(/\{\w+\}[^]*instruments\./); for (const bad of INSTRUMENTS_FORBIDDEN_WORDS_HE) expect(w.includes(bad), `${bad} in ${w}`).toBe(false); }
    for (const w of words('en')) for (const bad of INSTRUMENTS_FORBIDDEN_WORDS) expect(new RegExp(`\\b${bad}\\b`, 'i').test(w), `${bad} in ${w}`).toBe(false);
    // the not-downloaded state says so plainly, and the unheard label is the kit's
    expect(instrumentsT('he')('state.not_calibrated')).toContain('לא הורדה ולא נבדקה');
    expect(instrumentsT('en')('state.not_calibrated')).toContain('not been downloaded and checked');
    // no word of this page shadows a shared i18n key (they moved to packages/i18n/src/instruments.ts at integration)
    for (const lang of ['he', 'en'] as const) expect(Object.keys(INSTRUMENTS_UI_STRINGS[lang]).filter((k) => `instruments.${k}` in dictionaries[lang])).toEqual([]);
  });
  it('every state has its words and its next step, in both languages', () => {
    for (const lang of ['he', 'en'] as const) {
      const t = instrumentsT(lang);
      for (const ph of [...KIT_STATES, 'failed', 'no_kit']) {
        expect(t(`state.${ph}`), `${lang} state.${ph}`).not.toBe(`state.${ph}`);
        expect(t(`next.${ph}`), `${lang} next.${ph}`).not.toBe(`next.${ph}`);
      }
    }
  });
});

describe('«צליל» rendered', () => {
  it('a radiogroup with two radios (one tab stop), the state line with its state, the badge', () => {
    const out = html(view(), 'synth');
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/role="radio"/g)).toHaveLength(2);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('data-choice="synth"');
    expect(out).toContain('data-choice="recorded"');
    expect(out).toContain(`data-testid="${ID.state}" data-state="ready"`);
    expect(out).toContain(`data-testid="${ID.unheard}" data-heard="false"`);
    expect(out).toContain('עוד לא הושמעו לאף אחד');
    expect(out).not.toContain(ID.audition);
  });
  it('recorded stays selectable in every state and every state shows its words and next step', () => {
    for (const st of KIT_STATES.filter((s) => s !== 'ready')) for (const lang of ['he', 'en'] as const) {
      const t = instrumentsT(lang);
      const out = html(view({ state: st }), 'recorded', lang);
      expect(out, st).toContain(`data-state="${st}"`);
      expect(out, st).toContain('aria-checked="true"');
      expect(out, st).toContain(t(`next.${st}`).replace(/'/g, '&#x27;').replace(/«/g, '«'));
      // the add of a recorded kit is refused, the pair and the mark say why they cannot be used
      expect(out, st).toContain('aria-disabled="true"');
    }
    expect(html(view({ state: 'not_calibrated' }), 'recorded')).toContain('ערכת הכלים עוד לא הורדה ולא נבדקה במחשב הזה');
  });
  it('the licence refusal names the source and why; a missing kit and a failed load have their own words', () => {
    const out = html(view({ state: 'licence', sources: [{ sourceId: 's', title: 'Src', licenceId: 'CC-BY-SA-4.0', credit: true, nonCommercial: false, shareable: false }] }), 'recorded');
    expect(out).toContain('CC-BY-SA-4.0');
    expect(out).toContain('מיקס של הדגימות');
    expect(html(kitView({ phase: 'ok', kits: [] }, 'music.calm'), 'recorded')).toContain('data-state="no_kit"');
    expect(html(kitView({ phase: 'failed', why: 'HTTP 500' }, 'music.calm'), 'recorded')).toContain('HTTP 500');
  });
  it('a ready kit says its duties before the add: credit, non-commercial, no duty; all-or-nothing', () => {
    const out = html(view({ sources: [
      { sourceId: 'a', title: 'Cred Source', licenceId: 'CC-BY-4.0', credit: true, nonCommercial: false, shareable: true },
      { sourceId: 'b', title: 'NC Source', licenceId: 'CC-BY-NC-4.0', credit: true, nonCommercial: true, shareable: false },
      { sourceId: 'c', title: 'Free Source', licenceId: 'CC0-1.0', credit: false, nonCommercial: false, shareable: true },
    ] }), 'recorded');
    expect(out).toContain('data-duty="credit"');
    expect(out).toContain('בתיאור הסרטון יופיע: Cred Source');
    expect(out).toContain('לשימוש לא מסחרי בלבד');
    expect(out).toContain('data-duty="none"');
    expect(out).toContain('כל החלקים של הערכה מוקלטים');
    for (const id of [ID.audition, ID.heard]) expect(out).toContain(`data-testid="${id}"`);
  });
  it('the owner\'s mark shows its date in its own left-to-right run; «שמעתי» turns into the way back', () => {
    const out = html(view({ heard: { at: '2026-11-25T10:00:00.000Z' } }), 'recorded');
    expect(out).toContain('<bdi dir="ltr">2026-11-25</bdi>');
    expect(out).toContain('data-heard="true"');
    expect(out).toContain('ביטול הסימון');
  });
  it('no recorded claim anywhere in a rendered page, in either language', () => {
    for (const lang of ['he', 'en'] as const) {
      const out = html(view(), 'recorded', lang).replace(/<[^>]*>/g, ' ');
      for (const bad of lang === 'he' ? INSTRUMENTS_FORBIDDEN_WORDS_HE : INSTRUMENTS_FORBIDDEN_WORDS) expect(out.includes(bad), `${bad}`).toBe(false);
    }
  });
});

describe('the add body', () => {
  const pop = musicRows('en').find((r) => r.id === 'music.calm')!.style;
  const c16 = lengthChoices(pop, '20', MUSIC_STRINGS.en)[1]!;
  it('an ordinary request is byte for byte what it was before this track', () => {
    expect(JSON.stringify(addBody('music.calm', c16, 3))).toBe(JSON.stringify({ styleId: 'music.calm', bars: 16, seed: 3, start: T.ZERO }));
    expect(JSON.stringify(addBody('music.calm', c16, 3))).toBe('{"styleId":"music.calm","bars":16,"seed":3,"start":{"value":"0","timescale":1}}');
    expect('instruments' in addBody('music.calm', c16, 3, undefined)).toBe(false);
  });
  it('only a recorded request carries the field', () => {
    expect(JSON.stringify(addBody('music.calm', c16, 3, 'recorded'))).toBe('{"styleId":"music.calm","bars":16,"seed":3,"start":{"value":"0","timescale":1},"instruments":"recorded"}');
  });
});
