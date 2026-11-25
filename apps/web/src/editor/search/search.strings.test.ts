import { describe, expect, it } from 'vitest';
import { FOOTAGE_FORBIDDEN_WORDS } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { FOOTAGE_LOCAL_STRINGS, footageT } from './search.strings.ts';

const SHOWN_KEYS = ['footage.title', 'footage.sectionExact', 'footage.sectionPicture', 'footage.modelLabel', 'footage.hebrewAsTyped', 'footage.nothing', 'footage.found', 'footage.pressEnter', 'footage.notInstalled', 'footage.setupSteps', 'footage.ownerOnly', 'footage.notScanned', 'footage.stale', 'footage.scanned', 'footage.scan', 'footage.scanning', 'footage.stop', 'footage.scanNote', 'footage.scanTime', 'footage.forget', 'footage.forgetConfirm', 'footage.forgotten', 'footage.textOnly', 'footage.experimental', 'footage.wholeFile'];
const everySentence = (lang: 'he' | 'en'): [string, string][] => [
  ...Object.entries(FOOTAGE_LOCAL_STRINGS[lang]),
  ...SHOWN_KEYS.map((k): [string, string] => [k, (dictionaries[lang] as Record<string, string>)[k]!]),
];

describe('the words of footage search in the editor', () => {
  it('both languages have the same local keys and every shared key the component reads exists', () => {
    expect(Object.keys(FOOTAGE_LOCAL_STRINGS.en).sort()).toEqual(Object.keys(FOOTAGE_LOCAL_STRINGS.he).sort());
    for (const k of SHOWN_KEYS) { expect((dictionaries.he as Record<string, string>)[k], k).toBeTruthy(); expect((dictionaries.en as Record<string, string>)[k], k).toBeTruthy(); }
  });
  it('Hebrew is Hebrew and no local sentence is empty', () => {
    for (const [k, v] of Object.entries(FOOTAGE_LOCAL_STRINGS.he)) { expect(v, k).toBeTruthy(); if (!k.startsWith('footage.setupDetail')) expect(/[֐-׿]/.test(v), k).toBe(true); }
  });
  it('no sentence offers a query by example, claims to know who someone is, or shows a score', () => {
    for (const lang of ['he', 'en'] as const) for (const [k, v] of everySentence(lang)) {
      const low = v.toLowerCase();
      for (const w of FOOTAGE_FORBIDDEN_WORDS) expect(low.includes(w.toLowerCase()), `${lang} ${k}: ${w}`).toBe(false);
      expect(/\b(score|percent|stars?|confidence|accuracy)\b|ציון|אחוז|כוכב|ביטחון|דיוק|זיהוי פנים של|מזהה/i.test(v) && !/no face recognition|בלי זיהוי פנים/i.test(v), `${lang} ${k}`).toBe(false);
      expect(/\d+\s?%/.test(v), `${lang} ${k}`).toBe(false);
    }
  });
  it('the picture part says it is a model\'s ranking aid, may be wrong, and was not tested in Hebrew', () => {
    expect(footageT('he')('footage.modelLabel')).toContain('לא נבדק בעברית');
    expect(footageT('he')('footage.pictureHint')).toMatch(/עזר בלבד/);
    expect(footageT('he')('footage.pictureHint')).toMatch(/לטעות|לפספס/);
    expect(footageT('he')('footage.pictureHint')).toMatch(/באנגלית/);
    expect(footageT('en')('footage.pictureHint')).toMatch(/only an aid/);
    expect(footageT('en')('footage.pictureHint')).toMatch(/not tested in Hebrew/);
    expect(footageT('he')('footage.nothing')).toMatch(/^לא נמצא דבר/);
    expect(footageT('en')('footage.nothing')).toMatch(/^Nothing found/);
  });
  it('every setup reason pairs the reason with a next step or says plainly that it is not built', () => {
    for (const lang of ['he', 'en'] as const) for (const code of ['engine_not_configured', 'engine_not_working', 'engine_unverified', 'model_missing', 'licence_blocked', 'disk_insufficient']) {
      expect(footageT(lang)(`footage.setup.${code}`), `${lang} ${code}`).toMatch(/השלב הבא|השלבים הבאים|Next step/);
    }
  });
  it('the forget confirmation says what is deleted and what is kept, with the numbers filled', () => {
    const he = footageT('he')('footage.forgetWhat', { files: 3, size: '2.9 MB' });
    expect(he).toContain('3');
    expect(he).toContain('2.9 MB');
    expect(he).toMatch(/יימחק/);
    expect(he).toMatch(/לא ייפגעו/);
    expect(footageT('en')('footage.forgetWhat', { files: 3, size: '2.9 MB' })).toMatch(/deletes .* 3 videos.* 2\.9 MB.*not touched/);
  });
  it('a value is put in as it is, never read as a placeholder; an unknown key is itself', () => {
    expect(footageT('en')('footage.forgetCount', { files: '{size} $&' })).toContain('{size} $&');
    expect(footageT('he')('footage.nope')).toBe('footage.nope');
  });
  it('the interface never says it recognises faces or people; the scan note says it does not', () => {
    expect(footageT('he')('footage.scanNote')).toContain('בלי זיהוי פנים');
    expect(footageT('en')('footage.scanNote')).toContain('no face recognition');
  });
});
