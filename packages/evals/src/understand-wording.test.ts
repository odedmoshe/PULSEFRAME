/**
 * Keeps the Hebrew wording of «מה יש בקליפ» (packages/i18n/src/understand.ts) in step with the fixed English of core understandContract.ts
 * and understandOps.ts: every refusal of attach_footage_notes (provoked through the real op) and of the understand routes is worded in
 * Hebrew with a next step; every own pattern is used; every state, describer state and failure reason has its he/en string; the same keys
 * in both languages; one feature name; no gendered singular participle («מתאר»); nothing is called checked, right or verified (only «לא
 * נבדק»). W3 owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, ASSET_UNDERSTAND_STATES, createProject, DESCRIBER_STATES, NOTE_FAILURES, OpError, UNDERSTAND_API, UNDERSTAND_OP_REFUSALS, type ProjectDocument } from '@pulseframe/core';
import { HE_UNDERSTAND, translateRefusal, UNDERSTAND_EN, UNDERSTAND_HE, UNDERSTAND_REFUSAL_PATTERNS } from '../../i18n/src/index.ts';

const IMPERATIVE = /(עדכנו|נסו|בחרו|חברו|חכו|עצרו|התחילו|סמנו)/;
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: { origin: 'upload' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } };
const sound = { kind: 'audio' as const, name: 'a.wav', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } };
function project(): { doc: ProjectDocument; v: string; a: string } {
  const r = applyTransaction(createProject({ id: 'p', name: 'p', frameRate: { num: 30, den: 1 } }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: sound } }], { idSeed: 'uw_', actor: 'test', allowInternal: true });
  return { doc: r.doc, v: r.results[0]!.output!.assetId as string, a: r.results[1]!.output!.assetId as string };
}
const item = (assetId: string, over: Record<string, unknown> = {}) => ({ assetId, producer: '0123456789abcdef', model: 'TEST-DOUBLE-describer/1', data: `sha256:${'c'.repeat(64)}`, spans: 3, described: 2, failed: 1, ...over });
const refusalOf = (doc: ProjectDocument, items: unknown[]): OpError => {
  try { applyTransaction(doc, [{ op: 'attach_footage_notes', args: { method: 'test', createdAt: 'x', items } }], { idSeed: 'uw2_', actor: 'server:understand', allowInternal: true }); } catch (e) { if (e instanceof OpError) return e; throw e; }
  throw new Error('accepted');
};

describe('understand wording', () => {
  it('every refusal of attach_footage_notes, provoked through the op, is worded in Hebrew', () => {
    const { doc, v, a } = project();
    const provoked = [refusalOf(doc, [item('ast_none')]), refusalOf(doc, [item(a)]), refusalOf(doc, [item(v), item(v)]), refusalOf(doc, [item(v, { failed: 0 })])];
    expect(provoked.map((e) => e.code)).toEqual(Object.values(UNDERSTAND_OP_REFUSALS).map((r) => r.code));
    for (const e of provoked) expect(translateRefusal('he', e.message), e.message).toMatch(/[א-ת]/);
  });
  it('every route refusal has its own pattern with a next step, and every own pattern is used', () => {
    const { doc, v, a } = project();
    const used = new Set<RegExp>();
    const msgs = [...Object.values(UNDERSTAND_API).map((r) => r.message), refusalOf(doc, [item(a)]).message, refusalOf(doc, [item(v, { failed: 0 })]).message];
    for (const msg of msgs) {
      const own = HE_UNDERSTAND.find(([re]) => re.test(msg));
      expect(own, `${msg}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      const he = translateRefusal('he', msg)!;
      expect(he, `${msg}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
      expect(IMPERATIVE.test(he) || /לתארים|נעשים/.test(he), `${msg}: says what to do next`).toBe(true);
    }
    for (const r of Object.values(UNDERSTAND_API)) expect(r.hint.length).toBeGreaterThan(10);
    expect(UNDERSTAND_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('states, describer states and failures have he and en strings; the same keys; one feature name; no gendered participle; nothing called checked', () => {
    expect(Object.keys(UNDERSTAND_EN).sort()).toEqual(Object.keys(UNDERSTAND_HE).sort());
    const he = UNDERSTAND_HE as Record<string, string>;
    for (const s of ASSET_UNDERSTAND_STATES) expect(he[`understand.state.${s}`], s).toBeTruthy();
    for (const s of DESCRIBER_STATES) expect(he[`understand.describer.${s}`], s).toBeTruthy();
    for (const w of NOTE_FAILURES) expect(he[`understand.why.${w}`], w).toBeTruthy();
    for (const c of Object.values(UNDERSTAND_API)) expect(he[`error.code.${c.code}`] ?? (c.code === 'asset_not_found' ? 'x' : undefined), c.code).toBeTruthy();
    const all = Object.values(UNDERSTAND_HE).join('\n');
    expect(all).not.toMatch(/מתאר |הבנת צילומים|מה יש בצילום/);
    expect(all.replace(/(ו?לא) נבדקו?/g, '')).not.toMatch(/נבדק|בדוק|נכון|מדויק/);
    expect([...Object.values(UNDERSTAND_EN)].join('\n')).not.toMatch(/\b(verified|accurate|correct)\b/i);
    expect(UNDERSTAND_HE['understand.by']).toContain('לא נבדק');
    expect(UNDERSTAND_HE['understand.progress']).toBe('בתיאור: {done} מתוך {total}');
  });
});
