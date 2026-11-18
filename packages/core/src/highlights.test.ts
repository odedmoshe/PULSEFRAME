/**
 * The shorts ranking (ADR-0018, plan §4.3) on synthetic inputs whose truth is fixed here: statements from a word-timed
 * transcript, audio features written hop by hop (speech at −23 dBFS, one statement 6 dB louder, a noise burst with no word),
 * planted scene cuts and fillers. TEST INPUTS ONLY: no measurement is faked in the product code.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { findFillers } from './fillers.ts';
import { rankShortCandidates, scoreWindows, percentiles, type HighlightInputsWithWords } from './highlights.ts';
import type { Transcript } from './schema.ts';
import { AUDIO_FEATURES_METHOD, FindShortsBodySchema, SCORE_WEIGHTS, SHORTS_RANK_METHOD, type AudioFeatures, type FindShortsBody } from './shortsContract.ts';
import type { ShortReason } from './schema.ts';
import { transcriptStatements } from './statements.ts';

const ms = (n: number) => T.rt(n, 1000);
const VOCAB = ['היום', 'אנחנו', 'מדברים', 'על', 'הדרך', 'שבה', 'עובדים', 'יחד', 'בצוות', 'קטן', 'גדול', 'למדנו', 'הרבה', 'מהטעויות', 'שלנו'];
interface Plan { words: string[]; gain?: number }
/** Statements one after another: words 300 ms + 100 ms gap, 1 s between statements, from 2 s. */
function talk(plans: Plan[], extra: { burstAfter?: number } = {}) {
  let t = 2000, wid = 0;
  const segments: Transcript['segments'] = [];
  const levels: { from: number; to: number; db: number; flat: number }[] = [];
  plans.forEach((p, k) => {
    const words = p.words.map((text) => { const w = { id: `w${++wid}`, text, start: ms(t), duration: ms(300), confidence: 0.9 }; levels.push({ from: t, to: t + 300, db: -23 + (p.gain ?? 0), flat: 0.1 }); t += 400; return w; });
    segments.push({ id: `seg_${k}`, start: words[0]!.start, duration: ms(t - 100 - Number(words[0]!.start.value)), text: p.words.join(' '), original: null, speaker: null, timing: 'word', words });
    t += 900;
    if (extra.burstAfter === k) { levels.push({ from: t + 500, to: t + 2500, db: -10, flat: 0.9 }); t += 3500; }
  });
  const seconds = Math.ceil(t / 1000) + 2;
  const hops = seconds * 10;
  const rmsDb = new Float32Array(hops).fill(-100), flatness = new Float32Array(hops), flux = new Float32Array(hops);
  for (const l of levels) for (let h = Math.round(l.from / 100); h < Math.round(l.to / 100); h++) { rmsDb[h] = l.db; flatness[h] = l.flat; }
  const tr: Transcript = { assetId: 'ast_a', language: 'he', origin: { kind: 'manual', provider: null, model: null, createdAt: 'x', createdBy: 'test' }, segments };
  const features: AudioFeatures = { assetId: 'ast_a', contentHash: `sha256:${'a'.repeat(64)}`, version: 1, hops, analysedSeconds: seconds, partial: false, rmsDb, flatness, flux, method: AUDIO_FEATURES_METHOD };
  return { tr, features, duration: T.rt(seconds, 1) };
}
const sentence = (k: number, n = 7) => { const w = Array.from({ length: n }, (_, i) => VOCAB[(k * 3 + i * 5) % VOCAB.length]!); w[n - 1] += '.'; return w; };
function inputs(t: ReturnType<typeof talk>, o: { features?: boolean; cuts?: T.RationalTime[] | null; transcript?: boolean } = {}): HighlightInputsWithWords {
  const withTr = o.transcript !== false;
  return {
    assetId: 'ast_a', assetDuration: t.duration,
    statements: withTr ? transcriptStatements(t.tr, { fileDuration: t.duration }) : null,
    fillers: withTr ? findFillers(t.tr).candidates : null,
    features: o.features === false ? null : t.features,
    sceneCuts: o.cuts === undefined ? [T.rt(31, 1), T.rt(62, 1)] : o.cuts,
    existingShorts: [],
    words: withTr ? t.tr.segments.flatMap((s) => s.words.map((w) => ({ id: w.id, text: w.text, start: w.start, end: T.add(w.start, w.duration), confidence: w.confidence }))) : null,
  };
}
const body = (b: Partial<FindShortsBody> = {}) => FindShortsBodySchema.parse({ assetId: 'ast_a', ...b });
const plans = (n: number, patch: Record<number, Plan> = {}) => Array.from({ length: n }, (_, k) => patch[k] ?? { words: sentence(k, 6 + (k % 4)) });
const overlap = (a: { start: T.RationalTime; end: T.RationalTime }, b: { start: T.RationalTime; end: T.RationalTime }) =>
  Math.max(0, T.toSeconds(T.min(a.end, b.end)) - T.toSeconds(T.max(a.start, b.start))) / Math.min(T.toSeconds(T.sub(a.end, a.start)), T.toSeconds(T.sub(b.end, b.start)));
const codes = (rs: ShortReason[]) => rs.map((r) => r.code);

describe('rankShortCandidates', () => {
  const t = talk(plans(40, { 6: { words: ['האם', 'שמתם', 'לב', 'כמה', 'זה', 'פשוט', 'בעצם?'], gain: 6 }, 12: { words: ['אז', 'כמו', 'שאמרתי', 'קודם', 'הכול', 'מתחיל', 'בהקשבה.'] }, 18: { words: ['לא', 'נדבר', 'היום', 'על', 'ופוליטיקה', 'בכלל.'] }, 24: { words: ['ואז', 'אממ', 'החלטנו', 'לנסות', 'אממ', 'משהו', 'אחר.'] } }), { burstAfter: 20 });
  it('the same input gives identical JSON; ids are cand_ + 16 hex; ranks count from 1; scores are whole numbers 0..100', () => {
    const a = rankShortCandidates(inputs(t), body()), b = rankShortCandidates(inputs(t), body());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.candidates.length).toBeGreaterThan(2);
    a.candidates.forEach((c, i) => {
      expect(c.id).toMatch(/^cand_[0-9a-f]{16}$/);
      expect(c.rank).toBe(i + 1);
      expect(Number.isInteger(c.score) && c.score >= 0 && c.score <= 100).toBe(true);
      expect(c.reasons.length).toBeLessThanOrEqual(6);
      expect(c.seconds).toBeGreaterThanOrEqual(20);
      expect(c.seconds).toBeLessThanOrEqual(60);
    });
    for (let i = 1; i < a.candidates.length; i++) expect(a.candidates[i - 1]!.score).toBeGreaterThanOrEqual(a.candidates[i]!.score);
    expect(a.method).toBe(SHORTS_RANK_METHOD);
  });
  it('no overlap; with allowOverlap at most 25% of the shorter window', () => {
    const strict = rankShortCandidates(inputs(t), body({ count: 40 })).candidates;
    for (const a of strict) for (const b of strict) if (a !== b) expect(overlap(a, b)).toBe(0);
    const loose = rankShortCandidates(inputs(t), body({ count: 40, allowOverlap: true })).candidates;
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
    for (const a of loose) for (const b of loose) if (a !== b) expect(overlap(a, b)).toBeLessThanOrEqual(0.25 + 1e-9);
  });
  it('an excluded word with the prefix ו is caught and listed with its word and exact time', () => {
    const r = rankShortCandidates(inputs(t), body({ exclude: ['פוליטיקה'], count: 40 }));
    const word = t.tr.segments[18]!.words[4]!;
    expect(r.excluded.length).toBe(1);
    expect(r.excluded[0]!.word).toBe('ופוליטיקה');
    expect(T.eq(r.excluded[0]!.at, word.start)).toBe(true);
    expect(T.lte(r.excluded[0]!.start, word.start) && T.lt(word.start, r.excluded[0]!.end)).toBe(true);
    for (const c of r.candidates) expect(c.statementIds).not.toContain(transcriptStatements(t.tr)[18]!.id);
  });
  it('an include word adds topic_word with its quote and time', () => {
    const r = rankShortCandidates(inputs(t), body({ include: ['מהטעויות'], count: 40 }));
    const withTopic = r.candidates.filter((c) => codes(c.reasons).includes('topic_word'));
    expect(withTopic.length).toBeGreaterThan(0);
    for (const c of withTopic) { const q = c.reasons.find((x) => x.code === 'topic_word')!; expect(q.quote).toBe('מהטעויות'); expect(c.text).toContain('מהטעויות'); expect(T.lte(c.start, q.at!)).toBe(true); }
  });
  it('every candidate edge is T.eq to a statement edge; texts are verbatim', () => {
    const st = transcriptStatements(t.tr);
    for (const c of rankShortCandidates(inputs(t), body({ count: 40 })).candidates) {
      expect(st.some((s) => T.eq(s.start, c.start))).toBe(true);
      expect(st.some((s) => T.eq(s.end, c.end))).toBe(true);
      expect(c.text).toBe(c.statementIds.map((id) => st.find((s) => s.id === id)!.text).join(' '));
      expect(c.text.startsWith(c.firstWords)).toBe(true);
    }
  });
  it('a synthetic +6 dB statement reports louder_than_usual 6.00 ± 0.01 (dB, at the statement)', () => {
    const st = transcriptStatements(t.tr);
    const r = rankShortCandidates(inputs(t), body({ minSeconds: 5, maxSeconds: 8, count: 40 }));
    const c = r.candidates.find((x) => x.statementIds.includes(st[6]!.id))!;
    const loud = c.reasons.find((x) => x.code === 'louder_than_usual')!;
    expect(loud.value!).toBeCloseTo(6, 2);
    expect(Math.abs(loud.value! - 6)).toBeLessThanOrEqual(0.01);
    expect(loud.unit).toBe('dB');
    expect(T.eq(loud.at!, st[6]!.start)).toBe(true);
    expect(c.reasons.find((x) => x.code === 'opens_with_question')?.quote).toBe(st[6]!.text);
  });
  it('the reaction heuristic: a loud noise burst where nobody speaks is a moment; words are not', () => {
    const w = scoreWindows(inputs(t), body()).windows;
    const st = transcriptStatements(t.tr);
    const across = w.filter((x) => T.lte(x.start, st[20]!.end) && T.lte(st[21]!.start, x.end));
    const without = w.filter((x) => T.lte(x.end, st[20]!.end) || T.lte(st[21]!.start, x.start));
    expect(across.every((x) => Math.abs(x.raw.moments! - 2) < 1e-9)).toBe(true);
    expect(without.every((x) => x.raw.moments === 0)).toBe(true);
  });
  it('turning the first statement into a question never lowers opening', () => {
    const before = scoreWindows(inputs(t), body()).windows;
    const q = plans(40, { 0: { words: [...sentence(0, 6).slice(0, 5), 'נכון?'] }, 6: { words: ['האם', 'שמתם', 'לב', 'כמה', 'זה', 'פשוט', 'בעצם?'], gain: 6 }, 12: { words: ['אז', 'כמו', 'שאמרתי', 'קודם', 'הכול', 'מתחיל', 'בהקשבה.'] }, 18: { words: ['לא', 'נדבר', 'היום', 'על', 'ופוליטיקה', 'בכלל.'] }, 24: { words: ['ואז', 'אממ', 'החלטנו', 'לנסות', 'אממ', 'משהו', 'אחר.'] } });
    const after = scoreWindows(inputs(talk(q, { burstAfter: 20 })), body()).windows;
    expect(after.length).toBe(before.length);
    const first = before.filter((w) => w.first === 0);
    expect(first.length).toBeGreaterThan(0);
    for (let i = 0; i < before.length; i++) if (before[i]!.first === 0) expect(after[i]!.components.opening!).toBeGreaterThanOrEqual(before[i]!.components.opening!);
  });
  it('a connective start gets context_added within contextSeconds', () => {
    const ws = Array.from({ length: 50 }, (_, i) => VOCAB[i % VOCAB.length]!);
    ws[0] = 'אז'; ws[49] += '.';
    const c = talk([{ words: ['זה', 'ההקשר.'] }, { words: ws }]);
    const r = rankShortCandidates(inputs(c, { cuts: null }), body({ contextSeconds: 8 }));
    expect(r.candidates.length).toBe(1);
    const st = transcriptStatements(c.tr);
    const note = r.candidates[0]!.reasons.find((x) => x.code === 'context_added')!;
    expect(note.sign).toBe('note');
    expect(note.value!).toBeGreaterThan(0);
    expect(note.value!).toBeLessThanOrEqual(8);
    expect(T.eq(r.candidates[0]!.start, st[0]!.start)).toBe(true);
    expect(r.candidates[0]!.warnings).not.toContain('starts_with_reference');
    // with no room for context it is flagged instead
    const flagged = rankShortCandidates(inputs(c, { cuts: null }), body({ contextSeconds: 0, minSeconds: 15, maxSeconds: 21 })).candidates.find((x) => T.eq(x.start, st[1]!.start))!;
    expect(flagged.warnings).toContain('starts_with_reference');
    expect(codes(flagged.reasons)).toContain('starts_with_reference');
  });
  it('the no-transcript path uses silence edges, gives no word reasons and says no_transcript', () => {
    const r = rankShortCandidates(inputs(t, { transcript: false }), body({ count: 40 }));
    expect(r.candidates.length).toBeGreaterThan(0);
    const rms = t.features.rmsDb;
    const silenceEdge = (time: T.RationalTime, kind: 'start' | 'end') => {
      const h = T.frameIndexAt(time, { num: 10, den: 1 });
      expect(T.isFrameAligned(time, { num: 10, den: 1 })).toBe(true);
      // a block starts right after silence and ends right before it
      if (kind === 'start') { expect(rms[h]!).toBeGreaterThan(-35); expect(rms[h - 1]!).toBeLessThan(-35); }
      else { expect(rms[h - 1]!).toBeGreaterThan(-35); expect(rms[h]!).toBeLessThan(-35); }
    };
    for (const c of r.candidates) {
      silenceEdge(c.start, 'start'); silenceEdge(c.end, 'end');
      expect(c.warnings).toContain('no_transcript');
      expect(c.statementIds).toEqual([]);
      expect(c.text).toBe('');
      expect(c.reasons.every((x) => x.quote === null)).toBe(true);
      expect(codes(c.reasons)).toContain('no_transcript');
      for (const k of ['complete', 'opening', 'pace'] as const) expect(c.components[k]).toBeNull();
    }
  });
  it('a mostly approximate transcript: an excluded word still removes every window over its statement, and the candidates say approximate_timing, not no_transcript', () => {
    // the same talk, but every phrase approximate and without words: the units become speech blocks between silences
    const tr: Transcript = { ...t.tr, segments: t.tr.segments.map((sg) => ({ ...sg, timing: 'approximate' as const, words: [] })) };
    const inp: HighlightInputsWithWords = { ...inputs(t), statements: transcriptStatements(tr, { fileDuration: t.duration }), fillers: findFillers(tr).candidates, words: null };
    const st = inp.statements!.find((x) => x.segmentId === 'seg_18')!;
    const r = rankShortCandidates(inp, body({ exclude: ['פוליטיקה'], count: 40 }));
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.excluded.length).toBe(1);
    expect(r.excluded[0]!.word).toBe('ופוליטיקה');
    expect(T.eq(r.excluded[0]!.at, st.start)).toBe(true);
    for (const c of r.candidates) {
      expect(T.lte(c.end, st.start) || T.lte(st.end, c.start)).toBe(true);
      expect(c.warnings).toContain('approximate_timing');
      expect(c.warnings).not.toContain('no_transcript');
      expect(codes(c.reasons)).not.toContain('no_transcript');
    }
    expect(r.basis.some((b) => b.startsWith('include/exclude: matched in every statement that overlaps'))).toBe(true);
    // an include word is found the same way, quoted verbatim
    const inc = rankShortCandidates(inp, body({ include: ['מהטעויות'], count: 40 }));
    const withTopic = inc.candidates.filter((c) => codes(c.reasons).includes('topic_word'));
    expect(withTopic.length).toBeGreaterThan(0);
    for (const c of withTopic) expect(c.reasons.find((x) => x.code === 'topic_word')!.quote).toBe('מהטעויות');
  });
  it('no transcript: include/exclude cannot be matched and the basis says so', () => {
    const r = rankShortCandidates(inputs(t, { transcript: false }), body({ exclude: ['פוליטיקה'], count: 40 }));
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.excluded).toEqual([]);
    expect(r.basis).toContain('include/exclude: not applied, there is no transcript to match the words in; the candidates may hold an excluded word');
    expect(rankShortCandidates(inputs(t, { transcript: false }), body({ count: 40 })).basis.some((b) => b.startsWith('include/exclude'))).toBe(false);
  });
  it('with features null, voice and moments are null, missing_input is listed and the weights rescale to 100', () => {
    const r = rankShortCandidates(inputs(t, { features: false }), body({ count: 40 }));
    expect(r.candidates.length).toBeGreaterThan(0);
    const present = (['complete', 'opening', 'pace', 'picture', 'clean'] as const);
    const weight = present.reduce((n, k) => n + SCORE_WEIGHTS[k], 0);
    for (const c of r.candidates) {
      expect(c.components.voice).toBeNull();
      expect(c.components.moments).toBeNull();
      const miss = c.reasons.find((x) => x.code === 'missing_input')!;
      expect(miss.value).toBe(SCORE_WEIGHTS.voice + SCORE_WEIGHTS.moments);
      expect(miss.unit).toBe('percent');
      expect(c.score).toBe(Math.round(present.reduce((n, k) => n + c.components[k]! * SCORE_WEIGHTS[k], 0) / weight));
    }
    // all inputs present: no missing_input, and the weights are the contract's
    const full = rankShortCandidates(inputs(t), body({ count: 40 })).candidates;
    for (const c of full) expect(codes(c.reasons)).not.toContain('missing_input');
  });
  it('no scene analysis: picture is null with a warning; nothing at all: no candidates, said so', () => {
    const r = rankShortCandidates(inputs(t, { cuts: null }), body());
    for (const c of r.candidates) { expect(c.components.picture).toBeNull(); expect(c.warnings).toContain('no_scene_cuts'); }
    const none = rankShortCandidates(inputs(t, { cuts: null, features: false, transcript: false }), body());
    expect(none.candidates).toEqual([]);
    expect(none.basis.join(' ')).toMatch(/nothing to rank/);
  });
  it('fillers and long pauses count against clean, with the filler quoted at its time', () => {
    const st = transcriptStatements(t.tr);
    const r = rankShortCandidates(inputs(t), body({ minSeconds: 5, maxSeconds: 12, count: 40, contextSeconds: 0 }));
    const p = r.candidates.find((x) => x.statementIds.includes(st[24]!.id));
    const w = scoreWindows(inputs(t), body({ minSeconds: 5, maxSeconds: 12, contextSeconds: 0 })).windows;
    const withP = w.find((x) => x.first === 24 && x.last === 25)!, plain = w.find((x) => x.first === 26 && x.last === 27)!;
    expect(withP.raw.clean!).toBeLessThan(plain.raw.clean!);
    if (p && codes(p.reasons).includes('fillers')) expect(p.reasons.find((x) => x.code === 'fillers')!.quote).toBe('אממ');
  });
});

describe('percentiles', () => {
  it('midranks: ties share, raising one value never lowers it, single value 50', () => {
    expect(percentiles([5])).toEqual([50]);
    expect(percentiles([1, 2, 3])).toEqual([0, 50, 100]);
    expect(percentiles([1, 1, 3])).toEqual([25, 25, 100]);
    expect(percentiles([2, 2, 2])).toEqual([50, 50, 50]);
  });
});

describe('wording', () => {
  it('no viral, virality, retention or ויראל in the finder, the server shorts, the playbooks or the method (negations aside)', () => {
    const forbidden = /viral|virality|retention|ויראל/i;
    const affirmative = (s: string) => s.replace(/\b(not a|never|no)\b[^;.,]*/gi, '');
    expect(forbidden.test(affirmative(SHORTS_RANK_METHOD))).toBe(false);
    for (const f of ['./highlights.ts', './statements.ts', '../../../apps/server/src/shorts.ts', '../../../apps/server/src/shortsFeatures.ts', '../../../apps/server/src/mcpResources.ts']) {
      const lines = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => forbidden.test(affirmative(l)));
      expect(lines, f).toEqual([]);
    }
  });
});
