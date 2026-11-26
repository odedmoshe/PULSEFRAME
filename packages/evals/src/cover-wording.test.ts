/**
 * Keeps the Hebrew wording of track cover (packages/i18n/src/cover.ts HE_COVER) in step with the fixed English of core
 * stillsContract.ts STILLS_REFUSALS: every sentence, made by the table's own message function, is worded by exactly one cover
 * pattern and by translateRefusal, keeps its numbers, and every pattern is used. Also: the strings exist in both languages with
 * the same placeholders; the label of core matches the dictionary; the new codes have headlines; the stage word exists; nothing
 * calls a frame or a print good, right, sharp, safe or verified; Hebrew addresses the owner in the plural. W1 and W2 add a row
 * per refusal they provoke for real (stills.test.ts, stillExport.test.ts); this table stays the lead's.
 */
import { describe, expect, it } from 'vitest';
import { STILLS_LABEL, STILLS_REFUSALS } from '@pulseframe/core';
import { COVER_EN, COVER_HE, COVER_REFUSAL_PATTERNS, dictionaries, HE_COVER, jobStageLabel, translateRefusal } from '../../i18n/src/index.ts';

/** One sample per refusal (numbers of at least three digits where the row has numbers, so the check that they are kept bites). */
const ARGS: { [K in keyof typeof STILLS_REFUSALS]: Parameters<(typeof STILLS_REFUSALS)[K]['message']> } = {
  notBuilt: [], rangeTooLong: [1200, 600], emptyRange: [400, 400], outsideFile: [913, 1300, 1200], noVideo: ['ast_1'], notPictureClip: ['clp_1'],
  otherFile: ['clp_1', 'ast_2'], inProgress: [], busy: [3], decodeFailed: [598, 600], greyCheck: [240, 12],
  stillNotBuilt: [], stillOptions: ['sequenceId'], stillFormat: ['mp4-h264-aac'], jpegNeedsStill: [], stillScale: [], stillNoPicture: ['ast_3'],
  stillFrame: [1500, 1200], stillTooLarge: [9248, 6936], stillCrop: [3001, 2001], stillPaperShape: ['a4', 'landscape'], ownerRequired: [],
  stillBrowserRoute: [], stillTags: ['comment'],
};
const sentences = () => (Object.keys(STILLS_REFUSALS) as (keyof typeof STILLS_REFUSALS)[]).map((k) => [k, (STILLS_REFUSALS[k].message as (...a: unknown[]) => string)(...(ARGS[k] as unknown[]))] as const);

describe('Hebrew wording of the cover refusals (wave 8)', () => {
  it('every sentence is worded by exactly one cover pattern and by translateRefusal, with its numbers kept', () => {
    for (const [k, s] of sentences()) {
      const hits = COVER_REFUSAL_PATTERNS.filter((re) => re.test(s));
      expect(hits.length, `${k}: ${s}`).toBe(1);
      const he = translateRefusal('he', s)!;
      expect(he, k).toBe(HE_COVER.find(([re]) => re.test(s))![1](hits[0]!.exec(s)!));
      expect(he, k).toMatch(/[א-ת]/);
      for (const num of s.match(/\d{3,}/g) ?? []) if (num !== '8192') expect(he, `${k} keeps ${num}`).toContain(num);
    }
    for (const re of COVER_REFUSAL_PATTERNS) expect(sentences().some(([, s]) => re.test(s)), String(re)).toBe(true);
    // a blocker wrapped by the export routes is worded too
    expect(translateRefusal('he', `export cannot start: ${STILLS_REFUSALS.stillNotBuilt.message()}`)).toMatch(/^אי אפשר להתחיל את הייצוא: /);
  });
  it('the decided Hebrew sentences of the verifier are there word for word', () => {
    const he = (k: keyof typeof STILLS_REFUSALS) => translateRefusal('he', sentences().find(([key]) => key === k)![1])!;
    expect(he('rangeTooLong')).toContain('הקטע ארוך מדי למדידה פריים־פריים');
    expect(he('stillTooLarge')).toContain('התמונה גדולה מ־8192 פיקסלים בצד');
    expect(he('stillTooLarge')).toContain('אי אפשר לשמור אותה בגודל המלא');
    expect(he('ownerRequired')).toContain('שמירת תמונה בגודל המלא — רק בחשבון של בעלי הפרויקט');
  });
  it('the strings exist in both languages with the same placeholders; the label matches core; codes have headlines; the stage word exists', () => {
    expect(Object.keys(COVER_EN).sort()).toEqual(Object.keys(COVER_HE).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(COVER_HE) as (keyof typeof COVER_HE)[]) expect(ph(COVER_EN[k]), k).toEqual(ph(COVER_HE[k]));
    expect(COVER_HE['cover.label']).toBe(STILLS_LABEL.he);
    expect(COVER_EN['cover.label']).toBe(STILLS_LABEL.en);
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const code of new Set(Object.values(STILLS_REFUSALS).map((r) => r.code))) expect(d[`error.code.${code}`], `${lang} ${code}`).toBeTruthy();
    }
    expect(jobStageLabel('measuring sharpness 3/12', 'he')).toBe('מדידת חדות 3/12');
    expect(jobStageLabel('measuring sharpness 3/12', 'en')).toBe('measuring sharpness 3/12');
  });
  it('nothing is called good, right, sharp as a verdict, safe or verified; the tiers are a rule of thumb', () => {
    for (const [k, s] of Object.entries(COVER_HE)) expect(s, k).not.toMatch(/טוב|נכון|בטוח|מאומת|תקין|מושלם/);
    for (const [k, s] of Object.entries(COVER_EN)) expect(s, k).not.toMatch(/\b(good|best|right|correct|safe|verified|perfect)\b/i);
    expect(COVER_HE['cover.rule']).toContain('כלל אצבע');
    for (const [, s] of HE_COVER.map(([re, f]) => [re, f(Object.assign(['', '1', '2', '3'], { index: 0, input: '' }) as RegExpExecArray)] as const)) expect(s).not.toMatch(/טוב|בטוח/);
  });
  it('Hebrew addresses the owner in the plural: no singular masculine or feminine imperative of the verbs used here', () => {
    const all = [...Object.values(COVER_HE), ...HE_COVER.map(([, f]) => f(Object.assign(['', '1', '2', '3'], { index: 0, input: '' }) as RegExpExecArray))].join(' ');
    expect(all).not.toMatch(/(^|\s)(בחר|בחרי|לחץ|לחצי|שמור|שמרי|קצרי|נסה|נסי|הזז|הזיזי|מדוד|השתמש|השתמשי|חכה|חכי|עצור|עצרי|ייבא|ייבאי|דווח|דווחי)(\s|$|[.,:;])/);
  });
});
