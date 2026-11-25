/**
 * Keeps the Hebrew wording of «כלים מוקלטים» (packages/i18n/src/instruments.ts HE_INSTRUMENTS) in step with the fixed English of
 * apps/server/src/instruments/contract.ts INSTRUMENTS_SERVER_REFUSALS: every sentence is worded in Hebrew with a next step and every
 * pattern is used. Also: the strings exist in both languages, the labels of core match the dictionary, and no instruments string says a
 * recorded kit sounds better, real, warm or natural (core INSTRUMENTS_FORBIDDEN_WORDS). Builder W2 owns this file after the pre-pass
 * (it adds a row per refusal provoked for real through the recorded path).
 */
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS_FORBIDDEN_WORDS, INSTRUMENTS_FORBIDDEN_WORDS_HE, MUSIC_RECORDED_HEARD_LABEL, MUSIC_RECORDED_UNHEARD_LABEL } from '@pulseframe/core';
import { INSTRUMENTS_SERVER_REFUSALS } from '../../../apps/server/src/instruments/contract.ts';
import { dictionaries, INSTRUMENTS_EN, INSTRUMENTS_HE, INSTRUMENTS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

/** One sample sentence per refusal, made by the table's own message function. */
const ARGS: Record<keyof typeof INSTRUMENTS_SERVER_REFUSALS, unknown[]> = {
  notBuilt: [], libraryNotSet: [], noKit: ['music.pop'], kitNotReady: ['kit.calm.vsco@1'], itemMissing: ['vsco-2-ce/repo'], itemVersion: ['vsco-2-ce/repo'],
  licence: ['vsco-2-ce/repo', 'licence_share_alike'], fileMissing: ['Strings/a.wav'], fileChanged: ['Strings/a.wav'], pathEscape: [], unreadable: ['Strings/a.wav', 'truncated data chunk'],
  format: ['Strings/a.flac', 'flac'], range: ['piano'], tooLarge: [96], notFittable: [], ownerOnly: [],
};
const samples: string[] = (Object.keys(INSTRUMENTS_SERVER_REFUSALS) as (keyof typeof INSTRUMENTS_SERVER_REFUSALS)[]).map((k) => (INSTRUMENTS_SERVER_REFUSALS[k].message as (...a: unknown[]) => string)(...ARGS[k]));
const heb = /[֐-׿]/;
const enWord = (w: string) => new RegExp(`\\b${w}\\b`, 'i');
const heWord = (w: string) => new RegExp(`(^|[^\\u0590-\\u05FF])${w}([^\\u0590-\\u05FF]|$)`);

describe('instruments refusals in Hebrew', () => {
  it('every sentence of the server table is worded, in Hebrew, with a next step', () => {
    for (const s of samples) {
      const he = translateRefusal('he', s);
      expect(he, s).toBeTruthy();
      expect(heb.test(he!), s).toBe(true);
      // a next step: a second sentence after the reason
      expect(/[.;—]\s|\. |, /.test(he!) || he!.includes('. '), s).toBe(true);
    }
  });
  it('each sentence is worded by its own pattern, and every pattern is used', () => {
    const used = new Set<number>();
    for (const s of samples) {
      const i = INSTRUMENTS_REFUSAL_PATTERNS.findIndex((re) => re.test(s));
      expect(i, s).toBeGreaterThanOrEqual(0);
      used.add(i);
    }
    expect(used.size).toBe(INSTRUMENTS_REFUSAL_PATTERNS.length);
  });
  it('every refusal carries an English hint (the next step) and an instruments_ or owner code', () => {
    for (const r of Object.values(INSTRUMENTS_SERVER_REFUSALS)) { expect(r.hint.length).toBeGreaterThan(10); expect(/^(instruments_|owner_required$)/.test(r.code)).toBe(true); }
  });
  it.todo('W2: each refusal of the recorded path is provoked for real (synthetic library, labelled test kit) and equals the table');
});

describe('instruments strings', () => {
  it('Hebrew first, English for the same keys, both served by the dictionaries', () => {
    expect(Object.keys(INSTRUMENTS_EN).sort()).toEqual(Object.keys(INSTRUMENTS_HE).sort());
    for (const k of Object.keys(INSTRUMENTS_HE) as (keyof typeof INSTRUMENTS_HE)[]) {
      expect(heb.test(INSTRUMENTS_HE[k]) || /^[אב]$/.test(INSTRUMENTS_HE[k]), k).toBe(true);
      expect(dictionaries.he[k]).toBe(INSTRUMENTS_HE[k]);
      expect(dictionaries.en[k]).toBe(INSTRUMENTS_EN[k]);
    }
  });
  it('the labels of core are the dictionary\'s', () => {
    expect(INSTRUMENTS_HE['instruments.unheard']).toBe(MUSIC_RECORDED_UNHEARD_LABEL.he);
    expect(INSTRUMENTS_EN['instruments.unheard']).toBe(MUSIC_RECORDED_UNHEARD_LABEL.en);
    expect(INSTRUMENTS_HE['instruments.heardOn']).toBe(MUSIC_RECORDED_HEARD_LABEL.he);
    expect(INSTRUMENTS_EN['instruments.heardOn']).toBe(MUSIC_RECORDED_HEARD_LABEL.en);
  });
  it('nothing says a recorded kit sounds better, real, warm or natural', () => {
    const texts = [...Object.values(INSTRUMENTS_HE), ...Object.values(INSTRUMENTS_EN), ...samples, ...samples.map((s) => translateRefusal('he', s) ?? ''),
      ...Object.values(INSTRUMENTS_SERVER_REFUSALS).map((r) => r.hint), MUSIC_RECORDED_UNHEARD_LABEL.he, MUSIC_RECORDED_UNHEARD_LABEL.en, MUSIC_RECORDED_HEARD_LABEL.he, MUSIC_RECORDED_HEARD_LABEL.en];
    for (const s of texts) {
      for (const w of INSTRUMENTS_FORBIDDEN_WORDS) expect({ s, w, hit: enWord(w).test(s) }).toEqual({ s, w, hit: false });
      for (const w of INSTRUMENTS_FORBIDDEN_WORDS_HE) expect({ s, w, hit: heWord(w).test(s) }).toEqual({ s, w, hit: false });
    }
  });
});
