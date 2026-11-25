/** The bar's strings: he/en parity (same keys, no empty string, same placeholders) and a word for every code of the contract. */
import { describe, expect, it, vi } from 'vitest';
import { BAR_ACTION_KINDS, BAR_MISSING, BAR_NOTE_CODES, BAR_REFUSAL_CODES, EXPORT_DESTINATION_IDS, INTENT_IDS } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { BAR_EN, BAR_HE, BAR_TEXT, barText, fill, placeholdersOf, plain, ltr, auto, dict } = await import('./commandBar.strings.ts');
const { COMMAND_BAR_TESTIDS } = await import('./commandBar.testids.ts');

describe('string parity', () => {
  it('has the same keys in Hebrew and English', () => {
    expect(Object.keys(BAR_EN).sort()).toEqual(Object.keys(BAR_HE).sort());
  });
  it('has no empty string and the same placeholders in both languages', () => {
    for (const k of Object.keys(BAR_HE) as (keyof typeof BAR_HE)[]) {
      expect(BAR_HE[k].trim(), `he ${k}`).not.toBe('');
      expect(BAR_EN[k].trim(), `en ${k}`).not.toBe('');
      expect(placeholdersOf(BAR_EN[k]), k).toEqual(placeholdersOf(BAR_HE[k]));
    }
  });
  it('Hebrew strings hold Hebrew and English strings hold none (apart from names and keys)', () => {
    for (const k of Object.keys(BAR_HE) as (keyof typeof BAR_HE)[]) {
      expect(BAR_EN[k], `en ${k}`).not.toMatch(/[֐-׿]/);
    }
  });
});

describe('a word for every code of the contract', () => {
  for (const lang of ['he', 'en'] as const) {
    it(`${lang}: refusals (reason and next step), intents, missing, notes, actions, destinations`, () => {
      for (const c of BAR_REFUSAL_CODES) { expect(dict(lang, `bar.refusal.${c}`)).not.toBe(`bar.refusal.${c}`); expect(BAR_TEXT[lang][`hint.${c}`]).toBeTruthy(); }
      for (const i of INTENT_IDS) expect(BAR_TEXT[lang][`intent.${i}`]).toBeTruthy();
      for (const m of BAR_MISSING) expect(BAR_TEXT[lang][`missing.${m}`]).toBeTruthy();
      for (const n of BAR_NOTE_CODES) expect(BAR_TEXT[lang][`note.${n}`]).toBeTruthy();
      for (const d of EXPORT_DESTINATION_IDS) expect(BAR_TEXT[lang][`dest.${d}`]).toBeTruthy();
      expect(BAR_ACTION_KINDS.length).toBeGreaterThan(0);
    });
  }
  it('the fixed Hebrew product wording is the shared dictionary\'s', () => {
    expect(dictionaries.he['bar.projectChanged']).toBe('הפרויקט השתנה — בדקו שוב');
    expect(BAR_HE['stale.line']).toBe(dictionaries.he['bar.projectChanged']);
    expect(BAR_EN['stale.line']).toBe(dictionaries.en['bar.projectChanged']);
    expect(dictionaries.he['assistant.notConnected']).toBe('עוזר השפה לא מחובר');
    expect(dictionaries.he['assistant.howToConnect']).toBe('איך מחברים');
    expect(BAR_HE['understood']).toBe('הבנתי:');
    expect(BAR_HE['footer.plan']).toBe('Enter לביצוע · פעולה אחת לביטול');
  });
  it('no string says the assistant is connected', () => {
    for (const s of [...Object.values(BAR_HE), ...Object.values(BAR_EN)]) expect(s).not.toMatch(/מחובר ופועל|is connected and/i);
  });
});

describe('the local assistant\'s words are the bar\'s own (wave 7, moved from localAssistant.logic.ts)', () => {
  it('every key the local row and Settings use is in both dictionaries of this file', async () => {
    const { LOCAL_TEXT_KEYS } = await import('./localAssistant.logic.ts');
    expect(LOCAL_TEXT_KEYS.length).toBeGreaterThan(15);
    for (const k of LOCAL_TEXT_KEYS) { expect(BAR_HE[k], k).toMatch(/[א-ת]/); expect(BAR_EN[k], k).toBeTruthy(); }
  });
});

describe('helpers', () => {
  it('fill replaces placeholders and keeps unknown ones; plain removes isolates', () => {
    expect(fill('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
    expect(plain(`${ltr('0:03')} ${auto('שלום')}`)).toBe('0:03 שלום');
    expect(barText('he', 'detail.count', { n: 2, of: 5 })).toBe('2 מתוך 5');
  });
  it('the test ids are the fixed ones', () => {
    expect(COMMAND_BAR_TESTIDS.live).toBe('bar-live');
  });
});
