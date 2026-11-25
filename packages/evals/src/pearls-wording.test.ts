/**
 * Keeps the Hebrew wording of the marked-range refusals (packages/i18n/src/pearls.ts HE_PEARLS) in step with the fixed English of core
 * sourceRangesContract.ts SOURCE_RANGE_REFUSALS and of the server's guards (apps/server/src/peoplePrivacy.ts HUMAN_TAG_REFUSALS,
 * apps/server/src/pearls.ts): every sentence is worded in Hebrew, says what to do next, and every pattern is used. notBuilt is
 * provoked for real while the bodies are not built; once built, every other refusal is provoked through its operation. Also: the pearls strings exist in both languages and never judge a cut. Builder A owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MAX_SOURCE_RANGES, OpError, PEARL_FORBIDDEN_WORDS, PEARL_FORBIDDEN_WORDS_HE, SCREEN_TIME_LABEL, SCREEN_TIME_TITLE, SOURCE_RANGE_OPS, SOURCE_RANGE_OPS_BUILT, SOURCE_RANGE_REFUSALS, type SourceRangeRefusalKey } from '@pulseframe/core';
import { HUMAN_TAG_REFUSALS } from '../../../apps/server/src/peoplePrivacy.ts';
import { PEARLS_SERVER_REFUSALS } from '../../../apps/server/src/pearls.ts';
import { dictionaries, PEARLS_EN, PEARLS_HE, PEARLS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const hash = (c: string) => `sha256:${c.repeat(64)}`;
/** A project with a 10 s video, a still, a colour table, one person, a pearl [1, 2.5) s, a presence tag and a whole-file pearl. */
function fixture() {
  const assets = [
    { kind: 'video', name: 'v.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: f(300), video: { width: 64, height: 36, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov },
    { kind: 'image', name: 's.png', contentHash: hash('2'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 36, codec: 'png', hasAlpha: false }, provenance: prov },
    { kind: 'lut', name: 'l.cube', contentHash: hash('3'), byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, provenance: prov },
  ];
  let r = applyTransaction(createProject({ id: 'prj_pw', name: 'PW' }), assets.map((asset) => ({ op: 'import_asset', args: { asset } })), { idSeed: 'pw0_', actor: 'test', allowInternal: true });
  const [vid, still, lut] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = applyTransaction(r.doc, [{ op: 'add_person', args: { name: 'אלף' } }], { idSeed: 'pw1_', actor: 'test' });
  const personId = r.results[0]!.output!.personId as string;
  r = applyTransaction(r.doc, [
    { op: 'add_source_range', args: { assetId: vid, start: f(30), end: f(75), label: 'סופגנייה' } },
    { op: 'add_source_range', args: { assetId: vid, kind: 'presence', people: [personId] } },
    { op: 'add_source_range', args: { assetId: still } },
  ], { idSeed: 'pw2_', actor: 'user:local' });
  const [pearl, presence, whole] = r.results.map((x) => x.output!.rangeId as string) as [string, string, string];
  return { doc: r.doc, vid, still, lut, personId, pearl, presence, whole };
}
let seq = 0;
/** Every refusal of the three operations provoked through its operation, in the order SOURCE_RANGE_REFUSALS lists them for add, then update, then remove. */
export function provokedRefusals(): { key: SourceRangeRefusalKey; op: string; message: string }[] {
  const x = fixture();
  const call = (op: string, args: Record<string, unknown>) => caught(() => applyTransaction(x.doc, [{ op, args }], { idSeed: `pwr${seq++}_`, actor: 'user:local' }));
  const span = { start: f(30), end: f(75) };
  const rows: [SourceRangeRefusalKey, string, Record<string, unknown>][] = [
    ['assetNotFound', 'add_source_range', { assetId: 'ast_x' }],
    ['rangeNoTime', 'add_source_range', { assetId: x.lut }],
    ['rangeHalfSpan', 'add_source_range', { assetId: x.vid, start: f(1) }],
    ['rangeStillSpan', 'add_source_range', { assetId: x.still, ...span }],
    ['rangeBounds', 'add_source_range', { assetId: x.vid, start: f(30), end: f(400) }],
    ['rangeLabelLine', 'add_source_range', { assetId: x.vid, start: f(1), end: f(2), label: 'a\nb' }],
    ['presenceNeedsPeople', 'add_source_range', { assetId: x.still, kind: 'presence' }],
    ['rangePersonNotFound', 'add_source_range', { assetId: x.vid, start: f(1), end: f(2), people: ['per_x'] }],
    ['rangeDuplicate', 'add_source_range', { assetId: x.vid, ...span }],
    ['rangeNotFound', 'update_source_range', { rangeId: 'rng_x', label: 'x' }],
    ['rangeNothingToChange', 'update_source_range', { rangeId: x.pearl }],
    ['rangeWholeAndSpan', 'update_source_range', { rangeId: x.pearl, whole: true, ...span }],
    ['rangeHalfSpan', 'update_source_range', { rangeId: x.pearl, end: f(80) }],
    ['rangeStillSpan', 'update_source_range', { rangeId: x.whole, ...span }],
    ['rangeBounds', 'update_source_range', { rangeId: x.pearl, start: f(80), end: f(70) }],
    ['rangeLabelLine', 'update_source_range', { rangeId: x.pearl, label: 'a\rb' }],
    ['presenceNeedsPeople', 'update_source_range', { rangeId: x.presence, people: [] }],
    ['rangePersonNotFound', 'update_source_range', { rangeId: x.pearl, people: ['per_x'] }],
    ['rangeUnchanged', 'update_source_range', { rangeId: x.pearl, label: 'סופגנייה' }],
    ['rangeNotFound', 'remove_source_range', { rangeId: 'rng_x' }],
  ];
  return rows.map(([key, op, args]) => ({ key, op, message: call(op, args) }));
}
/** tooManyRanges needs 2000 ranges: provoked on a document filled by hand (the op refuses before it adds). */
function provokeTooMany(): string {
  const x = fixture();
  const full = structuredClone(x.doc);
  for (let i = 0; i < MAX_SOURCE_RANGES; i++) full.sourceRanges![`rng_f${i}`] = { id: `rng_f${i}`, assetId: x.vid, kind: 'pearl', span: { start: f(i % 299), end: f(300 - Math.floor(i / 299)) }, label: '', createdBy: 't' };
  return caught(() => applyTransaction(full, [{ op: 'add_source_range', args: { assetId: x.vid, start: f(5), end: f(7) } }], { idSeed: 'pwt_', actor: 'user:local' }));
}

function opSentences(): Record<SourceRangeRefusalKey, string[]> {
  const S = SOURCE_RANGE_REFUSALS;
  const doc = createProject({ id: 'prj_pw', name: 'PW' });
  const notBuilt = SOURCE_RANGE_OPS_BUILT
    ? SOURCE_RANGE_OPS.map((op) => S.notBuilt.message(op))
    : [caught(() => applyTransaction(doc, [{ op: 'add_source_range', args: { assetId: 'ast_x' } }], { idSeed: 'pw1_', actor: 'test' })),
      caught(() => applyTransaction(doc, [{ op: 'update_source_range', args: { rangeId: 'rng_x', label: 'x' } }], { idSeed: 'pw2_', actor: 'test' })),
      caught(() => applyTransaction(doc, [{ op: 'remove_source_range', args: { rangeId: 'rng_x' } }], { idSeed: 'pw3_', actor: 'test' }))];
  const out = { notBuilt } as Record<SourceRangeRefusalKey, string[]>;
  for (const r of provokedRefusals()) (out[r.key] ??= []).push(r.message);
  out.tooManyRanges = [provokeTooMany()];
  return out;
}
const serverSentences = (): string[] => [...Object.values(HUMAN_TAG_REFUSALS), ...Object.values(PEARLS_SERVER_REFUSALS).map((r) => r.message)];

describe('pearls refusals in Hebrew', () => {
  const ops = opSentences();
  const all = [...Object.values(ops).flat(), ...serverSentences()];
  it('notBuilt is provoked for real until the bodies are built', () => {
    if (!SOURCE_RANGE_OPS_BUILT) expect(ops.notBuilt).toEqual(SOURCE_RANGE_OPS.map((op) => SOURCE_RANGE_REFUSALS.notBuilt.message(op)));
  });
  it('every sentence is worded, in Hebrew, with a next step, and no reason falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence', () => {
    expect(PEARLS_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
  });
  it('no refusal, summary-free English or Hebrew holds a label: the sentences carry ids and numbers only', () => {
    for (const en of all) expect(en).not.toMatch(/סופגנייה|dinosaur/);
  });
  it('each refusal of add/update/remove_source_range is provoked for real through its operation, in the order of SOURCE_RANGE_REFUSALS, and equals the table', () => {
    const S = SOURCE_RANGE_REFUSALS as Record<SourceRangeRefusalKey, { message: (...a: string[]) => string }>;
    const rows = provokedRefusals();
    for (const r of rows) {
      const want = r.key === 'assetNotFound' ? S[r.key].message('ast_x') : r.key === 'rangeBounds' ? S[r.key].message('10') : r.key === 'rangePersonNotFound' ? S[r.key].message('per_x') : r.key === 'rangeNotFound' ? S[r.key].message('rng_x') : S[r.key].message();
      expect({ key: r.key, op: r.op, message: r.message }).toEqual({ key: r.key, op: r.op, message: want });
    }
    expect(provokeTooMany()).toBe(SOURCE_RANGE_REFUSALS.tooManyRanges.message());
    // every key but notBuilt is provoked, and the add rows and the update rows each follow the table's order
    const keys = Object.keys(SOURCE_RANGE_REFUSALS) as SourceRangeRefusalKey[];
    expect(keys.filter((k) => k !== 'notBuilt' && k !== 'tooManyRanges' && !rows.some((r) => r.key === k))).toEqual([]);
    const ADD_ORDER = ['assetNotFound', 'rangeNoTime', 'rangeHalfSpan', 'rangeStillSpan', 'rangeBounds', 'rangeLabelLine', 'presenceNeedsPeople', 'rangePersonNotFound', 'rangeDuplicate', 'tooManyRanges'];
    const UPDATE_ORDER = ['rangeNotFound', 'rangeNothingToChange', 'rangeWholeAndSpan', 'rangeHalfSpan', 'rangeStillSpan', 'rangeBounds', 'rangeLabelLine', 'presenceNeedsPeople', 'rangePersonNotFound', 'rangeDuplicate', 'rangeUnchanged'];
    const inOrder = (op: string, order: string[]) => { const ix = rows.filter((r) => r.op === op).map((r) => order.indexOf(r.key)); return ix.every((v, i) => v >= 0 && (i === 0 || v > ix[i - 1]!)); };
    expect(inOrder('add_source_range', ADD_ORDER)).toBe(true);
    expect(inOrder('update_source_range', UPDATE_ORDER)).toBe(true);
  });
});

describe('pearls strings', () => {
  it('the shared strings exist in both languages, Hebrew in Hebrew', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = [...SOURCE_RANGE_OPS.map((op) => `op.${op}`), 'cmd.viewPearls', 'error.code.human_tag_required', 'error.code.pearls_not_built', ...Object.keys(PEARLS_HE)].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    for (const [k, v] of Object.entries(PEARLS_HE)) expect({ k, hebrew: /[א-ת]/.test(v) }).toEqual({ k, hebrew: true });
  });
  it('the measurement and the list never judge a cut (no fair, balanced, should; no «הוגן», «מאוזן», «צריך»)', () => {
    const texts = [...Object.values(PEARLS_HE), ...Object.values(PEARLS_EN), ...Object.values(SCREEN_TIME_LABEL), ...Object.values(SCREEN_TIME_TITLE)];
    for (const s of texts) { expect({ s, en: PEARL_FORBIDDEN_WORDS.test(s) }).toEqual({ s, en: false }); expect({ s, he: PEARL_FORBIDDEN_WORDS_HE.test(s) }).toEqual({ s, he: false }); }
    expect(PEARLS_HE['pearl.screenLabel']).toBe(SCREEN_TIME_LABEL.he);
    expect(PEARLS_EN['pearl.screenLabel']).toBe(SCREEN_TIME_LABEL.en);
    expect(PEARLS_HE['pearl.screenTitle']).toBe(SCREEN_TIME_TITLE.he);
  });
  it('a rational time in a refusal is said in seconds, never a fraction', () => { expect(SOURCE_RANGE_REFUSALS.rangeBounds.message(String(T.toSeconds(T.rt(124, 10))))).toContain('12.4 s'); });
});
