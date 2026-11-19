import { describe, expect, it } from 'vitest';
import { PERFORM_STRINGS, performT, type PerformKey } from './perform.strings.ts';

const he = PERFORM_STRINGS.he, en = PERFORM_STRINGS.en;
const keys = Object.keys(he) as PerformKey[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('perform strings', () => {
  it('Hebrew and English have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
  });
  it('no string is empty or blank', () => {
    for (const k of keys) { expect(he[k].trim(), `he ${k}`).not.toBe(''); expect(en[k].trim(), `en ${k}`).not.toBe(''); }
  });
  it('both languages use the same placeholders', () => {
    for (const k of keys) expect(placeholders(en[k]), k).toEqual(placeholders(he[k]));
  });
  it('Hebrew strings are Hebrew (a bare number format aside) and English strings carry no Hebrew letters', () => {
    for (const k of keys) { if (k !== 'pv.strengthValue') expect(/[\u0590-\u05ff]/.test(he[k]), `he ${k}`).toBe(true); expect(/[\u0590-\u05ff]/.test(en[k]), `en ${k}`).toBe(false); }
  });
  it('nothing calls a take in sync (latency is not checked; the calibration is only an offset); the one note that denies it is the exception', () => {
    for (const k of keys) {
      expect(/in sync/i.test(en[k]), `en ${k}`).toBe(false);
      if (k !== 'pv.cal.note') { expect(/synchronised|synchronized/i.test(en[k]), `en ${k}`).toBe(false); expect(/מסונכרנ/.test(he[k]), `he ${k}`).toBe(false); }
    }
  });
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(performT('en')('pv.cal.progress', { n: 5 })).toBe('Taps: 5 of 16');
    expect(performT('he')('pv.chip.label', { pad: 3, frame: 40, state: 'x' })).toBe('לחצן 3, פריים 40: x');
    expect(performT('en')('pv.counts', { kept: 1 })).toBe('1 kept · {merged} merged · {held} will not show');
  });
});
