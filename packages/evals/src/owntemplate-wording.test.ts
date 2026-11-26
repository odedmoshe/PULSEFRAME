/**
 * Keeps the wording of «שמירת הסרט כתבנית» (wave 8 owntemplate; packages/i18n/src/owntemplate.ts) in step with core
 * ownTemplateContract.ts: every refusal sentence, made by the table's own message function, is worded by exactly one pattern and by
 * translateRefusal with its numbers kept, and every pattern is used; every kept kind, not-kept code and axis reason has words in
 * both languages with the same placeholders; the decided sentences are there word for word (the badge, the privacy line, C10);
 * nothing promises "the same cuts" or calls anything good or safe; Hebrew addresses the owner in the plural.
 */
import { describe, expect, it } from 'vitest';
import { OWN_AXIS_REASONS, OWN_KEPT_KINDS, OWN_NOT_KEPT_CODES, OWN_TEMPLATE_REFUSALS } from '@pulseframe/core';
import { dictionaries, HE_OWNTEMPLATE, OWNTEMPLATE_EN, OWNTEMPLATE_HE, OWNTEMPLATE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const ARGS: { [K in keyof typeof OWN_TEMPLATE_REFUSALS]: Parameters<(typeof OWN_TEMPLATE_REFUSALS)[K]['message']> } = {
  ownerRequired: [], notBuilt: ['capture'], nothingToSave: [], tooManySlots: [134, 120], tooManyTemplates: [50], alreadySaved: ['יום הולדת'],
  tooManyOperations: [2140, 2000], entryTooLarge: [300123, 262144], staleRevision: [412, 415], privacyScanFailed: ['slots[3].effects[0].params.text'],
  notOnThisComputer: ['tpl.own-0123456789ab'],
};
const sentences = () => (Object.keys(OWN_TEMPLATE_REFUSALS) as (keyof typeof OWN_TEMPLATE_REFUSALS)[]).map((k) => [k, (OWN_TEMPLATE_REFUSALS[k].message as (...a: unknown[]) => string)(...(ARGS[k] as unknown[]))] as const);
const fill = (f: (m: RegExpExecArray) => string) => f(Object.assign(['', '1', '2', '3'], { index: 0, input: '' }) as RegExpExecArray);

describe('wording of «שמירת הסרט כתבנית» (wave 8)', () => {
  it('every refusal is worded by exactly one pattern and by translateRefusal, with its numbers kept, and every pattern is used', () => {
    for (const [k, s] of sentences()) {
      const hits = OWNTEMPLATE_REFUSAL_PATTERNS.filter((re) => re.test(s));
      expect(hits.length, `${k}: ${s}`).toBe(1);
      const he = translateRefusal('he', s)!;
      expect(he, k).toBe(HE_OWNTEMPLATE.find(([re]) => re.test(s))![1](hits[0]!.exec(s)!));
      expect(he, k).toMatch(/[א-ת]/);
      if (k !== 'staleRevision' && k !== 'notOnThisComputer') for (const num of s.match(/\d{3,}/g) ?? []) expect(he, `${k} keeps ${num}`).toContain(num);
    }
    for (const re of OWNTEMPLATE_REFUSAL_PATTERNS) expect(sentences().some(([, s]) => re.test(s)), String(re)).toBe(true);
  });
  it('the decided sentences are there word for word', () => {
    expect(OWNTEMPLATE_HE['owntemplate.badge']).toBe('נעשתה מהסרט שלכם');
    expect(OWNTEMPLATE_HE['owntemplate.save']).toBe('שמירת הסרט כתבנית');
    expect(OWNTEMPLATE_HE['owntemplate.section']).toBe('התבניות שלכם');
    expect(OWNTEMPLATE_HE['owntemplate.keepWords']).toBe('להשאיר את הטקסט');
    expect(OWNTEMPLATE_HE['owntemplate.privacy']).toBe('התבנית לא שומרת תמונות, שמות קבצים, שמות של אנשים, תאריכים או מילים שלכם');
    expect(translateRefusal('he', OWN_TEMPLATE_REFUSALS.notOnThisComputer.message('tpl.own-0123456789ab'))).toBe('התבנית הזו לא שמורה במחשב הזה; ביטול הפעולה עובד וכל קטע נשאר לעריכה');
    expect(OWN_TEMPLATE_REFUSALS.notOnThisComputer.message('tpl.own-0123456789ab')).toContain('is not saved on this computer; undo still works and every clip stays editable');
  });
  it('both languages have the same keys and placeholders; every kept kind, not-kept code, axis reason and new code has words', () => {
    expect(Object.keys(OWNTEMPLATE_EN).sort()).toEqual(Object.keys(OWNTEMPLATE_HE).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(OWNTEMPLATE_HE) as (keyof typeof OWNTEMPLATE_HE)[]) expect(ph(OWNTEMPLATE_EN[k]), k).toEqual(ph(OWNTEMPLATE_HE[k]));
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const kind of OWN_KEPT_KINDS) expect(d[`owntemplate.kept.${kind}`], `${lang} kept ${kind}`).toBeTruthy();
      for (const code of OWN_NOT_KEPT_CODES) expect(d[`owntemplate.notKept.${code}`], `${lang} notKept ${code}`).toBeTruthy();
      for (const r of [...OWN_AXIS_REASONS, 'beats', 'frames']) expect(d[`owntemplate.axis.${r}`], `${lang} axis ${r}`).toBeTruthy();
      for (const code of new Set(Object.values(OWN_TEMPLATE_REFUSALS).map((x) => x.code))) expect(d[`error.code.${code}`], `${lang} ${code}`).toBeTruthy();
    }
    const notKeptKeys = Object.keys(OWNTEMPLATE_HE).filter((k) => k.startsWith('owntemplate.notKept.')).map((k) => k.slice('owntemplate.notKept.'.length));
    expect(notKeptKeys.sort()).toEqual([...OWN_NOT_KEPT_CODES].sort());
  });
  it('nothing promises the same cuts or calls anything good, right or safe', () => {
    for (const [k, s] of Object.entries(OWNTEMPLATE_HE)) expect(s, k).not.toMatch(/טוב|נכון|בטוח|מאומת|תקין|מושלם|אותם חיתוכים/);
    for (const [k, s] of Object.entries(OWNTEMPLATE_EN)) expect(s, k).not.toMatch(/\b(good|best|right|correct|safe|verified|perfect)\b|same cuts/i);
  });
  it('Hebrew addresses the owner in the plural: no singular imperative of the verbs used here', () => {
    const all = [...Object.values(OWNTEMPLATE_HE), ...HE_OWNTEMPLATE.map(([, f]) => fill(f))].join(' ');
    expect(all).not.toMatch(/(^|\s)(בחר|בחרי|לחץ|לחצי|שמור|שמרי|הוסף|הוסיפי|מחק|מחקי|פתח|פתחי|עברי|אחדי|בדוק|בדקי)(\s|$|[.,:;])/);
  });
});
