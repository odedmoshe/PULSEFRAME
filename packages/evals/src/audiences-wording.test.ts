/**
 * Keeps the Hebrew wording of the audiences refusals (packages/i18n/src/audiences.ts HE_AUDIENCES) in step with the fixed English of
 * core audienceContract.ts AUDIENCE_REFUSALS and AUDIENCE_API_REFUSALS: every sentence is worded in Hebrew, says what to do next, and
 * every pattern is used. Also: the strings exist in both languages with the same keys, the calm version's honest sentences are there,
 * and no string calls a version safe or checked. W1: every refusal of the three operations is provoked through its op (notBuilt from the table).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, AUDIENCE_API_REFUSALS, AUDIENCE_NOT_HANDLED, AUDIENCE_PROJECTION_BUILT, AUDIENCE_REFUSALS, createProject, OpError, SOUND_ROLE_ORDER, type ProjectDocument } from '@pulseframe/core';
import { AUDIENCES_EN, AUDIENCES_HE, AUDIENCES_REFUSAL_PATTERNS, dictionaries, HE_AUDIENCES, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

/**
 * Every refusal of the three operations, provoked through applyTransaction on a synthetic document (no file is read), in the order
 * AUDIENCE_REFUSALS lists. notBuilt cannot be provoked while the projection is built (AUDIENCE_PROJECTION_BUILT): it comes from
 * the table, as the sentence an older build or a stub would give.
 */
function provoked(): Record<keyof typeof AUDIENCE_REFUSALS, string> {
  let n = 0;
  const R = { num: 30, den: 1 };
  const f = (k: number) => T.frameTime(k, R);
  const tx = (doc: ProjectDocument, op: string, args: unknown) => applyTransaction(doc, [{ op, args }], { idSeed: `awp${n++}_`, actor: 'user:owner' });
  const run = (doc: ProjectDocument, op: string, args: unknown) => caught(() => tx(doc, op, args));
  let doc = createProject({ id: 'prj_awp', name: 'W', width: 640, height: 360, frameRate: R });
  doc.assets.ast_m = { id: 'ast_m', kind: 'audio', name: 'm.wav', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } };
  const placed = applyTransaction(doc, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId: 'ast_m', start: f(0), withLinkedAudio: false } }, { op: 'add_variant', args: { profileId: 'square-1x1' } }], { idSeed: 'awp_base_', actor: 'test' });
  doc = placed.doc;
  const title = placed.results[0]!.output!.clipId as string, soundClip = placed.results[1]!.output!.clipId as string, format = placed.results[2]!.output!.variantId as string;
  const calmAdd = tx(doc, 'add_audience_version', { profile: 'calm' });
  const calm = calmAdd.results[0]!.output!.variantId as string;
  doc = calmAdd.doc;
  const video = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  return {
    notBuilt: AUDIENCE_REFUSALS.notBuilt.message('add_audience_version'),
    notFound: run(doc, 'update_audience_version', { variantId: 'var_none' }),
    notAudience: run(doc, 'set_audience_keep', { variantId: format, clipId: title, rule: 'effect', keep: true }),
    trackNotFound: run(doc, 'update_audience_version', { variantId: calm, sound: { trackId: 'trk_none', role: 'music' } }),
    trackNotSound: run(doc, 'update_audience_version', { variantId: calm, sound: { trackId: video, role: 'music' } }),
    clipNotFound: run(doc, 'set_audience_keep', { variantId: calm, clipId: 'clp_none', rule: 'effect', keep: true }),
    clipIsSound: run(doc, 'set_audience_keep', { variantId: calm, clipId: soundClip, rule: 'effect', keep: true }),
    notKeepable: run(doc, 'set_audience_keep', { variantId: calm, clipId: title, rule: 'title_size', keep: true }),
    ruleNotForClip: run(doc, 'set_audience_keep', { variantId: calm, clipId: title, rule: 'transition', keep: true }),
  };
}
const SAMPLES = provoked();
const FORBIDDEN_EN = [/\bsafe\b/i, /\bverified\b/i, /\bapproved\b/i, /\bsuitable for\b/i];
const FORBIDDEN_HE = ['בטוח', 'מאומת', 'אומת'];

describe('audiences wording', () => {
  it('every refusal of the three operations is provoked through its operation and equals the table', () => {
    expect(AUDIENCE_PROJECTION_BUILT).toBe(true);
    const m = (k: keyof typeof AUDIENCE_REFUSALS, ...v: string[]) => (AUDIENCE_REFUSALS[k].message as (...a: string[]) => string)(...v);
    expect(SAMPLES.notFound).toBe(m('notFound', 'var_none'));
    expect(SAMPLES.trackNotFound).toBe(m('trackNotFound', 'trk_none'));
    expect(SAMPLES.clipNotFound).toBe(m('clipNotFound', 'clp_none'));
    expect(SAMPLES.notKeepable).toBe(m('notKeepable', 'title_size', 'calm'));
    expect(SAMPLES.notAudience).toMatch(/^format var_\S+ is a format, not a version for an audience$/);
    expect(SAMPLES.trackNotSound).toMatch(/^track \S+ is not a sound track; only sound tracks have a role$/);
    expect(SAMPLES.clipIsSound).toMatch(/^clip \S+ is a sound clip; the kept rules are about pictures and titles$/);
    expect(SAMPLES.ruleNotForClip).toMatch(/^rule transition does not apply to clip \S+$/);
  });
  it('every refusal and the route\'s not-built sentence is worded in Hebrew with a next step, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of [...Object.entries(SAMPLES), ['api.notBuilt', AUDIENCE_API_REFUSALS.notBuilt.message()]] as [string, string][]) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. ') || he!.includes('; '), `${k}: says what to do next`).toBe(true);
      const own = HE_AUDIENCES.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    for (const k of Object.keys(AUDIENCE_REFUSALS) as (keyof typeof AUDIENCE_REFUSALS)[]) expect(AUDIENCE_REFUSALS[k].hint.length, k).toBeGreaterThan(10);
    expect(AUDIENCES_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('the strings exist in both languages, including every honest sentence and every sound-role reason', () => {
    expect(Object.keys(AUDIENCES_EN).sort()).toEqual(Object.keys(AUDIENCES_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const k of AUDIENCE_NOT_HANDLED) expect(d[`audience.notHandled.${k}`], `${lang} ${k}`).toBeTruthy();
      for (const k of SOUND_ROLE_ORDER) expect(d[`audience.why.${k}`], `${lang} ${k}`).toBeTruthy();
      for (const k of ['music_level', 'ducking']) expect(d[`audience.rule.${k}`], `${lang} ${k}`).toMatch(/dB/);
    }
    expect(AUDIENCES_HE['audience.rule.music_level']).toContain('ביחס לשאר הקול');
    expect(AUDIENCES_HE['audience.notHandled.pace']).toContain('לא משנה את קצב החיתוכים');
    expect(AUDIENCES_HE['audience.notHandled.not_medical']).toContain('לא הבטחה רפואית');
  });
  it('no string calls a version safe, suitable or checked', () => {
    for (const v of Object.values(AUDIENCES_EN)) for (const re of FORBIDDEN_EN) expect(re.test(v), v).toBe(false);
    for (const v of Object.values(AUDIENCES_HE)) for (const w of FORBIDDEN_HE) expect(v.includes(w), v).toBe(false);
  });
});
