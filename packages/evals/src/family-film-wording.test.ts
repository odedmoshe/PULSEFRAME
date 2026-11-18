/**
 * Wording of the family film maker and of measured moments (ADR-0026): every refusal of attach_moments (core momentsOps.ts
 * MOMENTS_REFUSALS) and of the film and moments routes (apps/server/src/familyFilm.ts FILM_API_ERRORS, moments.ts
 * momentsNotBuilt) is provoked for real and worded in Hebrew by translateRefusal; every pattern of HE_FAMILY_FILM is used.
 * The error codes have headlines in both languages, the stage word is translated, and no film or moments string says best,
 * score, quality or viral, or calls the film AI outside the fixed "not AI" disclaimer.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, FAMILY_FILM_DRAFT_LABEL, FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE, MOMENTS_ALGO, MOMENTS_LABEL, MOMENTS_METHOD, MOMENTS_REFUSALS, momentsStage, OpError, type Asset, type MomentsRefusalKey, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, FAMILY_FILM_EN, FAMILY_FILM_HE, FAMILY_FILM_REFUSAL_PATTERNS, jobStageLabel, translateRefusal } from '../../i18n/src/index.ts';
import { FILM_API_ERRORS } from '../../../apps/server/src/familyFilm.ts';
import { momentsNotBuilt } from '../../../apps/server/src/moments.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
function doc(): ProjectDocument {
  const d = createProject({ id: 'prj_fw', name: 'FW', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
  d.assets.v1 = { id: 'v1', kind: 'video', name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov } as Asset;
  d.assets.img = { id: 'img', kind: 'image', name: 'i.png', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } as Asset;
  return d;
}
const item = (assetId: string, windows: unknown[] = [{ peakFrame: 10, fromFrame: 0, toFrame: 60, basis: ['inner-motion'], motion: 40, level: null, sharp: 1, luma: 100 }]) => ({ assetId, algo: MOMENTS_ALGO, data: `sha256:${'a'.repeat(64)}`, measured: { picture: true, sound: false }, file: { motion: 10, level: null }, flat: false, windows });
const refusalOf = (items: unknown[]): string => {
  try { applyTransaction(doc(), [{ op: 'attach_moments', args: { method: MOMENTS_METHOD, createdAt: 'x', items } }], { idSeed: 'fw_', actor: 'server', allowInternal: true }); } catch (e) { if (e instanceof OpError) return e.message; throw e; }
  throw new Error('not refused');
};

describe('family film and moments wording', () => {
  it('every refusal of attach_moments, provoked through the op, is worded in Hebrew', () => {
    const provoked: Record<MomentsRefusalKey, string> = {
      assetMissing: refusalOf([item('nope')]),
      noVideo: refusalOf([item('img')]),
      twice: refusalOf([item('v1'), item('v1')]),
      badWindow: refusalOf([item('v1', [{ peakFrame: 10, fromFrame: 0, toFrame: 999, basis: ['inner-motion'], motion: 40, level: null, sharp: 1, luma: 100 }])]),
    };
    expect(Object.keys(provoked).sort()).toEqual(Object.keys(MOMENTS_REFUSALS).sort());
    for (const [key, message] of Object.entries(provoked)) {
      const he = translateRefusal('he', message);
      expect([key, he && /[֐-׿]/.test(he)]).toEqual([key, true]);
    }
  });
  it('every refusal of the film and moments routes is worded in Hebrew, and every pattern of the table is used', () => {
    const server = [
      FILM_API_ERRORS.notBuilt(), FILM_API_ERRORS.propose(), FILM_API_ERRORS.ages(), FILM_API_ERRORS.badTitle('{nope}'),
      FILM_API_ERRORS.blocked('the music is shorter than the film', []), FILM_API_ERRORS.runNotFound('run_1'), FILM_API_ERRORS.badParams(), momentsNotBuilt(),
    ];
    const op = [refusalOf([item('img')]), refusalOf([item('v1'), item('v1')]), refusalOf([item('v1', [{ peakFrame: 99, fromFrame: 0, toFrame: 60, basis: ['inner-motion'], motion: 40, level: null, sharp: 1, luma: 100 }])])];
    const messages = [...server.map((e) => e.message), ...op];
    for (const m of messages) expect([m, /[֐-׿]/.test(translateRefusal('he', m) ?? '')]).toEqual([m, true]);
    const unused = FAMILY_FILM_REFUSAL_PATTERNS.filter((re) => !messages.some((m) => re.test(m)));
    expect(unused).toEqual([]);
    for (const e of server) for (const lang of ['he', 'en'] as const) expect([e.code, (dictionaries[lang] as Record<string, string>)[`error.code.${e.code}`]?.trim()]).toEqual([e.code, expect.any(String)]);
  });
  it('the shared strings exist in both languages, differ, and the stage word is translated with its count', () => {
    expect(Object.keys(FAMILY_FILM_EN).sort()).toEqual(Object.keys(FAMILY_FILM_HE).sort());
    for (const k of Object.keys(FAMILY_FILM_HE) as (keyof typeof FAMILY_FILM_HE)[]) {
      expect([k, /[֐-׿]/.test(FAMILY_FILM_HE[k])]).toEqual([k, true]);
      if (k !== 'error.code.busy') expect(FAMILY_FILM_HE[k]).not.toBe(FAMILY_FILM_EN[k]);
    }
    expect(FAMILY_FILM_HE['film.draft']).toBe(FAMILY_FILM_DRAFT_LABEL.he);
    expect(FAMILY_FILM_EN['film.draft']).toBe(FAMILY_FILM_DRAFT_LABEL.en);
    expect(FAMILY_FILM_HE['moments.label']).toBe(MOMENTS_LABEL.he);
    expect(jobStageLabel(momentsStage(12, 31), 'he')).toBe('מודד רגעים 12/31');
    expect(jobStageLabel(momentsStage(12, 31), 'en')).toBe('measuring moments 12/31');
  });
  it('no film string says best, score, quality or viral, and «בינה מלאכותית» / AI appears only in the fixed disclaimer', () => {
    const all = [...Object.values(FAMILY_FILM_HE), ...Object.values(FAMILY_FILM_EN)];
    for (const s of all) {
      expect(s).not.toMatch(FILM_FORBIDDEN_WORDS);
      expect(s).not.toMatch(FILM_FORBIDDEN_WORDS_HE);
    }
    const ai = all.filter((s) => /בינה מלאכותית|\bAI\b/.test(s));
    for (const s of ai) expect(s).toMatch(/(לא|בלי) בינה מלאכותית|not an AI model|No AI model/);
  });
});
