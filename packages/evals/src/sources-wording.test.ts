/**
 * Keeps the Hebrew wording of «מאגר» / «ייבוא מקישור» (packages/i18n/src/sources.ts) in step with the fixed English of core
 * sourcesContract.ts: every refusal of use_source_item and of the sources routes is worded in Hebrew by its own pattern with a next
 * step (a plural imperative), every pattern is used, every job failure and warning has a he/en string, the same keys in both
 * languages, nothing is called safe, allowed or verified, and the not-built refusal is provoked through the real op. W3 owns this
 * file after the pre-pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, SOURCE_JOB_FAILURES, SOURCE_TERMS, SOURCE_OP_REFUSALS, SOURCE_WARNING_CODES, SOURCES_API } from '@pulseframe/core';
import { HE_SOURCES, SOURCES_EN, SOURCES_HE, SOURCES_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const SAMPLES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SOURCE_OP_REFUSALS).map(([k, v]) => [k, (v.message as (a?: string) => string)('non-commercial')])),
  ...Object.fromEntries(Object.entries(SOURCES_API).map(([k, v]) => [`api.${k}`, v.message])),
};
const IMPERATIVE = /(ייבאו|עדכנו|נסו|בחרו|פתחו|חברו|הקלידו|בדקו|חכו|הדביקו|השתמשו|הגדילו|פנו|חפשו|העתיקו)/;

describe('sources wording', () => {
  it('every refusal is worded in Hebrew with a next step by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', msg);
      expect(he && /[א-ת]/.test(he), k).toBe(true);
      expect(IMPERATIVE.test(he!), `${k}: says what to do next`).toBe(true);
      const own = HE_SOURCES.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    for (const r of [...Object.values(SOURCE_OP_REFUSALS), ...Object.values(SOURCES_API)]) expect(r.hint.length).toBeGreaterThan(10);
    expect(SOURCES_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('every job failure and warning has its he and en string; failures say what to do next; the same keys in both languages', () => {
    expect(Object.keys(SOURCES_EN).sort()).toEqual(Object.keys(SOURCES_HE).sort());
    for (const r of Object.values(SOURCE_JOB_FAILURES)) {
      const k = `sources.fail.${r.why}` as keyof typeof SOURCES_HE;
      expect(SOURCES_HE[k], k).toBeTruthy();
      expect(IMPERATIVE.test(SOURCES_HE[k]), `${k}: next step`).toBe(true);
    }
    for (const c of [...SOURCE_WARNING_CODES, 'non_commercial_content']) expect(SOURCES_HE[`sources.warn.${c}` as keyof typeof SOURCES_HE], c).toBeTruthy();
  });
  it('licence findings name the licence and quote it; nothing is called safe, allowed or verified; no legal conclusion of ours', () => {
    const all = [...Object.values(SOURCES_HE), ...Object.values(SOURCES_EN)].join('\n');
    expect(all).not.toMatch(/בטוח|מאומת|מותר|אסור|\bsafe\b|\bverified\b|\ballowed\b|forbids/i);
    expect(SOURCES_HE['sources.warn.licence_no_derivatives']).toContain('בלשונו');
    expect(SOURCES_HE['sources.searchHint']).toContain('נשלחות');
  });
  it('every sources.* key the interface names exists in both languages; each deed row of a licence finding is marked as a translation in Hebrew', () => {
    const dir = path.resolve(import.meta.dirname, '../../../apps/web/src/editor/sources');
    const used = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((n) => /\.(tsx?|ts)$/.test(n) && !/test|testids/.test(n))) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/'(sources\.[a-zA-Z_.]+[a-zA-Z_])'/g)) used.add(m[1]!);
    for (const k of used) { if (k.endsWith('.')) continue; expect(Object.keys(SOURCES_HE), k).toContain(k); expect(Object.keys(SOURCES_EN), k).toContain(k); }
    for (const id of ['cc.nd', 'cc.sa']) expect(SOURCE_TERMS[id]!.he, id).toContain('(תרגום');
    expect(SOURCES_HE['sources.quoteTranslation']).toBe('(תרגום)');
  });
  it('provoked for real: use_source_item refuses with the not-built row until W1 builds it', () => {
    const doc = createProject({ id: 'p', name: 'p', frameRate: { num: 30, den: 1 } });
    let err: unknown;
    try { applyTransaction(doc, [{ op: 'use_source_item', args: { asset: { duration: T.ZERO } } }], { idSeed: 's_', actor: 'test', allowInternal: true }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OpError);
    expect((err as OpError).details.why).toBe('sources_not_built');
    expect(translateRefusal('he', (err as OpError).message)).toContain('עדכנו');
  });
});
