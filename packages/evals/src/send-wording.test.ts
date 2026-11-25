/**
 * Keeps the Hebrew wording of track send's refusals (packages/i18n/src/send.ts HE_SEND) in step with their fixed English sentences
 * (core sendContract.ts). The op's refusals are PROVOKED through the real match_clip_loudness; the route, blocker and job-error
 * sentences are built from the table. Every pattern is used, each sentence is worded by exactly one send pattern and keeps its
 * numbers. Also: the shared strings exist in both languages, and no string promises more than bytes.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, SEND_API_REFUSALS, SEND_REFUSALS, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, jobStageLabel, SEND_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { HE_SEND, SEND_EN, SEND_HE } from '../../i18n/src/send.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };
let n = 0;
const tx = (d: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(d, ops, { idSeed: `sw${n++}_`, actor: 't', allowInternal: internal });
function doc() {
  const a = tx(createProject({ id: 'prj_sw', name: 'w' }), [{ op: 'import_asset', args: { asset: sound } }], true);
  const r = tx(a.doc, [{ op: 'add_clip', args: { assetId: a.results[0]!.output!.assetId as string, start: f(0), duration: f(90) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } }]);
  return { doc: r.doc, clip: r.results[0]!.output!.clipId as string, title: r.results[1]!.output!.clipId as string };
}
const provoke = (ops: OpCall[], d: ProjectDocument): OpError => { try { tx(d, ops); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const row = (clipId: string, gain = 1) => ({ clipId, measuredLufs: -20, peakDbfs: -6, gain });

describe('Hebrew wording of the send refusals (wave 7)', () => {
  it('every refusal, provoked or built from the table, is worded by exactly one send pattern, with its numbers kept', () => {
    const p = doc();
    const provoked: [string, OpError][] = [
      ['duplicate', provoke([{ op: 'match_clip_loudness', args: { target: -18, clips: [row(p.clip), row(p.clip)] } }], p.doc)],
      ['notSound', provoke([{ op: 'match_clip_loudness', args: { target: -18, clips: [row(p.title)] } }], p.doc)],
      ['stale', provoke([{ op: 'match_clip_loudness', args: { target: -18, clips: [row(p.clip, 0.5)] } }], p.doc)],
    ];
    for (const [key, e] of provoked) expect(e.hint, key).toBe(SEND_REFUSALS[key as keyof typeof SEND_REFUSALS].hint);
    const built = [
      SEND_API_REFUSALS.clipLoudnessNotBuilt.message(), SEND_API_REFUSALS.sizeFitNotBuilt.message(), SEND_API_REFUSALS.sizeFitFormat.message('webm-vp9-opus'),
      SEND_API_REFUSALS.sizeFitTooSmall.message(1000000, 1234567), SEND_API_REFUSALS.sizeFitMissed.message(16400000, 16000000), SEND_API_REFUSALS.browserRoute.message(),
    ];
    const sentences = [...provoked.map(([, e]) => e.message), ...built];
    for (const s of sentences) {
      const hits = SEND_REFUSAL_PATTERNS.filter((re) => re.test(s));
      expect(hits.length, s).toBe(1);
      const he = translateRefusal('he', s)!;
      expect(he, s).toBe(HE_SEND.find(([re]) => re.test(s))![1](hits[0]!.exec(s)!));
      for (const num of s.match(/\d{3,}/g) ?? []) expect(he, `${s} keeps ${num}`).toContain(num);
    }
    for (const re of SEND_REFUSAL_PATTERNS) expect(sentences.some((s) => re.test(s)), String(re)).toBe(true);
    // a blocker wrapped by the export routes is worded too
    expect(translateRefusal('he', `export cannot start: ${SEND_API_REFUSALS.sizeFitNotBuilt.message()}`)).toMatch(/^אי אפשר להתחיל את הייצוא: /);
  });
  it('every row has a hint (the way forward)', () => {
    for (const [k, r] of [...Object.entries(SEND_REFUSALS), ...Object.entries(SEND_API_REFUSALS)]) expect(r.hint.length, k).toBeGreaterThan(20);
  });
  it('the shared strings exist in both languages; the new codes have headlines; the stage words exist', () => {
    expect(Object.keys(SEND_EN).sort()).toEqual(Object.keys(SEND_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const code of ['size_fit_not_built', 'size_fit_format', 'size_fit_too_small', 'size_fit_missed']) expect(d[`error.code.${code}`], `${lang} ${code}`).toBeTruthy();
      for (const op of ['set_master_limiter', 'match_clip_loudness']) expect(d[`op.${op}`]).toBeTruthy();
    }
    expect(jobStageLabel('fitting size 1/2', 'he')).toBe('מתאים לגודל היעד 1/2');
    expect(jobStageLabel('checking size', 'en')).toBe('checking the file size');
  });
  it('the decided labels are exact, and nothing promises more than bytes', () => {
    expect(SEND_HE['send.tile']).toBe('מתאים לשליחה');
    expect(SEND_HE['send.jump']).toBe('מעבר לקטע');
    expect(SEND_HE['send.notVerified']).toBe('לא אומת');
    for (const s of [...Object.values(SEND_HE), ...Object.values(SEND_EN)]) expect(s).not.toMatch(/תקין|ווטסאפ|וואטסאפ|WhatsApp|safe|fine\b/i);
  });
});
