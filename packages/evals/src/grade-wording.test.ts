/**
 * Colour curves wording (wave 8 grade): every refusal of set_grade_curves, provoked for real, and the pass's not-built reason are
 * worded in Hebrew by HE_GRADE with a next step; every pattern is used; the strings exist in both languages with the same keys; the
 * ready-made curves are «עקומות מוכנות» (the editor's word for ready-made looks), never «הערכות» (grade-verify C12); nothing is
 * called good, right, safe or checked, and the skin-tone line is stated as a convention.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, GradeCurvesNotBuilt, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, GRADE_EN, GRADE_HE, GRADE_REFUSAL_PATTERNS, HE_GRADE, translateRefusal } from '../../i18n/src/index.ts';

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `gw${n++}_`, actor: 'test', allowInternal });
const refused = (doc: ProjectDocument, ops: OpCall[]): string => { try { tx(doc, ops); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

function doc() {
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
  const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };
  let r = tx(createProject({ id: 'prj_gw', name: 'gw', frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: T.ZERO, duration: T.frameTime(60, R) } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string };
}

describe('colour curves wording', () => {
  it('every refusal and the not-built reason is worded in Hebrew with a next step, and every pattern is used', () => {
    const { doc: d, clipId } = doc();
    const full = tx(d, Array.from({ length: 16 }, () => ({ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }))).doc;
    const set = (curves: unknown): OpCall[] => [{ op: 'set_grade_curves', args: { clipId, curves } }];
    const messages: [string, string][] = [
      ['count', refused(d, set({ r: [[0, 0]] }))],
      ['value', refused(d, set({ g: [[0, 0], [255, 300]] }))],
      ['points', refused(d, set({ master: [[0, 0], [2, 4], [255, 255]] }))],
      ['full', refused(full, set({ b: [[0, 4], [255, 255]] }))],
      ['notBuilt', new GradeCurvesNotBuilt('color.grade').message],
    ];
    const used = new Set<RegExp>();
    for (const [k, msg] of messages) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. ') || he!.includes('; ') || he!.includes(', ולכן'), `${k}: says what to do next`).toBe(true);
      const own = HE_GRADE.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    expect(translateRefusal('he', refused(d, set({ r: [[0, 0]] })))).toContain('האדומה');
    expect(GRADE_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('the strings exist in both languages with the same keys, including the honest lines', () => {
    expect(Object.keys(GRADE_EN).sort()).toEqual(Object.keys(GRADE_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const k of ['grade.curves', 'grade.presetsUnseen', 'grade.skinNote', 'grade.zebraNote', 'grade.zebraPaused', 'grade.lookKeepsCurves', 'grade.matchKeepsCurves', 'op.set_grade_curves']) expect(d[k], `${lang} ${k}`).toBeTruthy();
    }
    expect(GRADE_HE['grade.presets']).toBe('עקומות מוכנות');
    expect(GRADE_HE['grade.presetsUnseen']).toContain('איש עוד לא בדק');
    expect(GRADE_HE['grade.skin']).toContain('מוסכמה');
    expect(GRADE_HE['grade.skinNote']).toContain('לא שיפוט');
    expect(GRADE_HE['grade.in']).toBe('כניסה');
    expect(GRADE_HE['grade.out']).toBe('יציאה');
  });
  it('no string uses «הערכות» for the presets, or calls anything good, right, safe or checked', () => {
    for (const v of Object.values(GRADE_HE)) { expect(v.includes('הערכות'), v).toBe(false); for (const w of ['בטוח', 'מאומת', 'נכון', 'מושלם']) expect(v.includes(w), v).toBe(false); }
    for (const v of Object.values(GRADE_EN)) for (const re of [/\bsafe\b/i, /\bverified\b/i, /\bcorrect\b/i, /\bgood\b/i, /\bperfect\b/i]) expect(re.test(v), v).toBe(false);
  });
});
