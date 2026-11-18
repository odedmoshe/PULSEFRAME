/**
 * Keeps the Hebrew wording of perform mode's refusals (packages/i18n/src/perform.ts HE_PERFORM) in step with their fixed English
 * sentences (core performRefusals.ts; ADR-0025). The op's refusals are PROVOKED through the real apply_take; the route's are built
 * from the table (the route answers 501 until W1). Every pattern is used, each sentence is worded by ITS row (no earlier table
 * catches it first) and keeps its numbers. Also: the shared strings exist in both languages, every held reason and camera refusal
 * has words, the decided labels are exact, and nothing calls a take "in sync" before the owner's calibration.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, CAMERA_REFUSALS, createProject, HELD_REASONS, OpError, PERFORM_API_REFUSALS, PERFORM_REFUSALS, SNAP_MODES, TEMPO_MODES, type OpCall, type ProjectDocument, type TemplateStep } from '@pulseframe/core';
import { dictionaries, PERFORM_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { HE_PERFORM, PERFORM_EN, PERFORM_HE } from '../../i18n/src/perform.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const doc = (): ProjectDocument => applyTransaction(createProject({ id: 'prj_pw', name: 'w', width: 640, height: 360, frameRate: R }), [{ op: 'add_text', args: { text: 'במה', start: T.ZERO, duration: f(300) } }], { idSeed: 'w_', actor: 't' }).doc;
const take = (steps: TemplateStep[]): OpCall => ({ op: 'apply_take', args: { take: { snap: 'beat', tempo: 'normal', parity: 0, strength: 1, taps: 1, hits: 1, held: 0, summary: [] }, steps } });
const adj = (start: number, frames: number, type = 'color.grayscale'): TemplateStep => ({ op: 'add_adjustment', args: { span: { start: f(start), duration: f(frames) }, effects: [{ type }] } });
let n = 0;
const provoke = (steps: TemplateStep[]): OpError => {
  try { applyTransaction(doc(), [take(steps)], { idSeed: `pw${n++}_`, actor: 'u', allowInternal: true }); } catch (e) { if (e instanceof OpError) return e; throw e; }
  throw new Error('not refused');
};

describe('Hebrew wording of the perform refusals (ADR-0025)', () => {
  it('every refusal of apply_take, provoked for real, is worded by exactly one perform pattern, with its numbers kept', () => {
    const provoked: [string, OpError][] = [
      ['forbiddenStep', provoke([{ op: 'freeze_frame', args: {} }])],
      ['bindTwice', provoke([{ op: 'add_track', args: { kind: 'audio' }, bind: 'a' }, { op: 'add_track', args: { kind: 'audio' }, bind: 'a' }])],
      ['assetBinding', provoke([{ op: 'add_clip', args: { assetId: { $asset: 'x' }, start: T.ZERO } }])],
      ['parse', provoke([{ op: 'add_track', args: { kind: 'nonsense' } }])],
      ['tooManyTracks', provoke(Array.from({ length: 9 }, () => ({ op: 'add_track', args: { kind: 'audio' } })))],
      ['flashGap', provoke([adj(0, 20), adj(4, 20, 'color.invert')])],
      ['flashLight', provoke([adj(60, 60, 'light.strobe'), adj(70, 20)])],
      ['flashShort', provoke([adj(30, 4)])],
    ];
    for (const [key, e] of provoked) {
      const hits = PERFORM_REFUSAL_PATTERNS.filter((re) => re.test(e.message));
      expect(hits.length, `${key}: ${e.message}`).toBe(1);
      const he = translateRefusal('he', e.message)!;
      expect(he, key).toBe(HE_PERFORM.find(([re]) => re.test(e.message))![1](hits[0]!.exec(e.message)!));
      for (const num of e.message.match(/\d+/g) ?? []) if (key !== 'forbiddenStep' && key !== 'bindTwice' && key !== 'assetBinding' && key !== 'parse') expect(he, `${key} keeps ${num}`).toContain(num);
      if (key in PERFORM_REFUSALS) expect(e.hint, key).toBe(PERFORM_REFUSALS[key as keyof typeof PERFORM_REFUSALS].hint);
    }
    // the route's refusals, from the table
    for (const [key, row] of Object.entries(PERFORM_API_REFUSALS)) {
      const msg = row.message(12);
      expect(PERFORM_REFUSAL_PATTERNS.filter((re) => re.test(msg)).length, key).toBe(1);
      expect(translateRefusal('he', msg), key).toBe(HE_PERFORM.find(([re]) => re.test(msg))![1](HE_PERFORM.find(([re]) => re.test(msg))![0].exec(msg)!));
      expect(row.hint.length, key).toBeGreaterThan(20);
    }
    // no pattern is left without a sentence
    const sentences = [...provoked.map(([, e]) => e.message), ...Object.values(PERFORM_API_REFUSALS).map((r) => r.message(12))];
    for (const re of PERFORM_REFUSAL_PATTERNS) expect(sentences.some((s) => re.test(s)), String(re)).toBe(true);
  });
  it('every refusal row has a hint (the way forward)', () => {
    for (const [k, r] of Object.entries(PERFORM_REFUSALS)) expect(r.hint.length, k).toBeGreaterThan(20);
  });
  it('the shared strings exist in both languages; every held reason, camera refusal, snap and tempo has words; route headlines differ', () => {
    expect(Object.keys(PERFORM_EN).sort()).toEqual(Object.keys(PERFORM_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const r of HELD_REASONS) expect(d[`perform.held.${r}`]?.length, `${lang} ${r}`).toBeGreaterThan(5);
      for (const r of CAMERA_REFUSALS) expect(d[`perform.camera.${r}`]?.length, `${lang} ${r}`).toBeGreaterThan(5);
      for (const s of SNAP_MODES) expect(d[`perform.snap.${s}`], `${lang} ${s}`).toBeTruthy();
      for (const s of TEMPO_MODES) expect(d[`perform.tempo.${s}`], `${lang} ${s}`).toBeTruthy();
      expect(d['op.apply_take']).toBeTruthy();
    }
    for (const row of Object.values(PERFORM_API_REFUSALS)) {
      if (row.code === 'insufficient_scope') continue; // shared headline
      const he = (dictionaries.he as Record<string, string>)[`error.code.${row.code}`], en = (dictionaries.en as Record<string, string>)[`error.code.${row.code}`];
      expect(he && en && he !== en, row.code).toBe(true);
    }
  });
  it('the decided labels are exact (wave5-decisions.md)', () => {
    expect(PERFORM_HE['perform.mode']).toBe('הופעה');
    expect(PERFORM_EN['perform.mode']).toBe('Perform');
    expect(PERFORM_HE['perform.notCalibrated']).toBe('לא כויל');
    expect(PERFORM_HE['perform.needsGpu']).toBe('דורש כרטיס מסך');
    expect(PERFORM_HE['perform.beatStrobe']).toBe('הבזק על הפעימה');
    expect(PERFORM_HE['perform.addToLibrary']).toBe('הוסיפו לספרייה');
    expect(PERFORM_HE['perform.ghostBanner']).toBe('תצוגה מקדימה של ההופעה — עדיין לא נשמר');
    expect(PERFORM_HE['perform.camera']).toBe('צלם');
    expect(PERFORM_HE['perform.noFlashes']).toBe('בלי הבזקים');
  });
  it('nothing calls a take in sync (latency is not checked; the calibration has not been run on the laptop)', () => {
    for (const v of [...Object.values(PERFORM_HE), ...Object.values(PERFORM_EN)]) { expect(v).not.toMatch(/in sync|synchron/i); expect(v).not.toMatch(/מסונכרן|בסנכרון/); }
    // and the workspace is never called "stage" (that word names the viewer)
    for (const v of Object.values(PERFORM_EN)) expect(v).not.toMatch(/\bstage\b/i);
  });
});
