/**
 * Keeps the Hebrew wording of the growing refusals (packages/i18n/src/growing.ts HE_GROWING) in step with the fixed English of core
 * growingContract.ts (GROWING_REFUSALS) and apps/server/src/growing.ts (GROWING_API_ERRORS): every sentence is worded in Hebrew with
 * a next step, no pattern is unused, the shared strings exist in both languages, the Hebrew is plural (no gendered imperative), and
 * nothing is called sharp, perfect, right or AI. The server refusals are provoked for real in apps/server/src/growing.test.ts; the
 * planner's come from the table until W1's planGrowing exists (W1 then provokes each, todo below; W1 may edit only that line).
 */
import { describe, expect, it } from 'vitest';
import { GROWING_REFUSALS } from '@pulseframe/core';
import { GROWING_API_ERRORS } from '../../../apps/server/src/growing.ts';
import { dictionaries, GROWING_EN, GROWING_HE, GROWING_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const core = Object.values(GROWING_REFUSALS).map((r) => (r.message as (...a: unknown[]) => string)(11));
core.push(GROWING_REFUSALS.badParams.message('picks: Too small'));
const E = GROWING_API_ERRORS;
const server = [E.ownerRequired(), E.notBuilt(), E.runNotFound('run_x')];
const all = [...core, ...server.map((e) => e.message)];

describe('growing refusals in Hebrew', () => {
  it('every sentence is worded, in Hebrew, with a next step', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, nextStep: /[.:;—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of HE_GROWING is used, and each sentence is answered by the growing table', () => {
    expect(GROWING_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
    for (const en of all) expect({ en, ours: GROWING_REFUSAL_PATTERNS.some((re) => re.test(en)) }).toEqual({ en, ours: true });
  });
  it('the shared strings: same keys in both languages, in the dictionaries, the C7 privacy sentence word for word, nothing forbidden', () => {
    expect(Object.keys(GROWING_EN).sort()).toEqual(Object.keys(GROWING_HE).sort());
    for (const k of Object.keys(GROWING_HE)) { expect((dictionaries.he as Record<string, string>)[k]).toBe((GROWING_HE as Record<string, string>)[k]); expect((dictionaries.en as Record<string, string>)[k]).toBe((GROWING_EN as Record<string, string>)[k]); }
    expect(GROWING_HE['growing.privacy']).toBe('מיקום התמונות בסרט נשמר כמו כל עריכה, ואפשר לחשב ממנו היכן היו העיניים. הסימונים עצמם לא נשמרים.');
    const texts = [...Object.values(GROWING_HE), ...Object.values(GROWING_EN), ...all.map((en) => translateRefusal('he', en)!)];
    for (const s of texts) {
      expect({ s, forbidden: /\b(sharp|perfect|perfectly|correct|verified|AI)\b|מושלם|(^|\s)חד(ה|ות|ים)?(\s|$)|מאומת|בינה מלאכותית|לעולם לא מגיע/i.test(s) }).toEqual({ s, forbidden: false });
      // plural, ungendered Hebrew: no singular imperatives of the usual verbs
      expect({ s, gendered: /(^|\s)(בחר|בחרי|לחץ|לחצי|סמן|סמני|פתח|פתחי|הסר|הסירי)(\s|$|\.)/.test(s) }).toEqual({ s, gendered: false });
    }
  });
  it.todo('W1: each GROWING_REFUSALS sentence is provoked through the real planGrowing and answers its code');
});
