/**
 * Statements (ADR-0018 shorts, plan §4.3): sentence marks after closing quotes, not inside tokens, initials or abbreviations;
 * pauses and phrase ends; long spans split at their largest gap; whole segment and approximate phrases; verbatim text and
 * exact times.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Transcript } from './schema.ts';
import { isConnective, sentenceMark, transcriptStatements } from './statements.ts';

const ms = (n: number) => T.rt(n, 1000);
let wid = 0;
/** A word-timed segment: [text, startMs, endMs] per word. */
function wordSeg(id: string, words: [string, number, number][], confidence: number | null = 0.9): Transcript['segments'][number] {
  const first = words[0]!, last = words[words.length - 1]!;
  return {
    id, start: ms(first[1]), duration: ms(last[2] - first[1]), text: words.map((w) => w[0]).join(' '), original: null, speaker: null, timing: 'word',
    words: words.map(([text, s, e]) => ({ id: `w${++wid}`, text, start: ms(s), duration: ms(e - s), confidence })),
  };
}
/** Words of `texts`, 300 ms each with 100 ms gaps, from `at` ms. */
const evenly = (texts: string[], at = 0): [string, number, number][] => texts.map((t, i) => [t, at + i * 400, at + i * 400 + 300]);
const tr = (segments: Transcript['segments']): Transcript => ({ assetId: 'ast_a', language: 'he', origin: { kind: 'manual', provider: null, model: null, createdAt: 'x', createdBy: 'test' }, segments });
const texts = (t: Transcript) => transcriptStatements(t).map((s) => s.text);

describe('sentence marks', () => {
  it('reads the tail after closing quotes and brackets, with vowel points', () => {
    expect(sentenceMark('שָׁלוֹם.')).toBe('period');
    expect(sentenceMark('בעצם?״')).toBe('question');
    expect(sentenceMark('נכון!)')).toBe('exclaim');
    expect(sentenceMark('ובכן…')).toBe('ellipsis');
    expect(sentenceMark('ובכן...')).toBe('ellipsis');
    expect(sentenceMark('באמת?!')).toBe('question');
    expect(sentenceMark('”done.”')).toBe('period');
  });
  it('is not a mark inside a token, after a single letter or after an abbreviation', () => {
    for (const t of ['צה״ל', 'צה"ל', '3.5', 'וכו׳', 'וכו׳.', 'ד״ר', 'ד״ר.', 'Mr.', 'e.g.', 'א.', 'J.', 'פרופ׳']) expect(sentenceMark(t), t).toBeNull();
    expect(sentenceMark('צה״ל.')).toBe('period');
  });
  it('connectives, also after one Hebrew prefix letter', () => {
    for (const w of ['אבל', 'אז', 'ואז', 'כי', 'לכן', 'ולכן', 'וגם', 'And', 'but,', 'So', 'because']) expect(isConnective(w), w).toBe(true);
    for (const w of ['אזור', 'היום', 'android', 'sober']) expect(isConnective(w), w).toBe(false);
  });
});

describe('transcriptStatements', () => {
  it('Hebrew with vowel points and ״: צה״ל, 3.5, וכו׳ and Mr. end nothing; ? and … end statements', () => {
    const t = tr([wordSeg('seg_1', evenly(['חַיָּלֵי', 'צה״ל', 'קיבלו', '3.5', 'מליון', 'ספרים', 'וכו׳', 'ופגשו', 'את', 'Mr.', 'Cohen', 'אתמול?', 'כן…', 'זה', 'נגמר.']))]);
    expect(texts(t)).toEqual(['חַיָּלֵי צה״ל קיבלו 3.5 מליון ספרים וכו׳ ופגשו את Mr. Cohen אתמול?', 'כן…', 'זה נגמר.']);
    const st = transcriptStatements(t);
    expect(st.map((s) => s.endKind)).toEqual(['question', 'ellipsis', 'period']);
    expect(st.map((s) => s.question)).toEqual([true, false, false]);
    expect(st.every((s) => s.endsSentence && s.timing === 'word')).toBe(true);
  });
  it('a gap of 0.7 s splits (pause); 0.69 s does not; the phrase end ends the last one', () => {
    const t = tr([wordSeg('seg_1', [['אחת', 0, 300], ['שתיים', 990, 1300], ['שלוש', 2000, 2300], ['ארבע', 2400, 2700]])]);
    const st = transcriptStatements(t);
    expect(st.map((s) => s.text)).toEqual(['אחת שתיים', 'שלוש ארבע']);
    expect(st.map((s) => s.endKind)).toEqual(['pause', 'phrase']);
    expect(st.map((s) => s.endsSentence)).toEqual([false, true]);
  });
  it('segment and approximate phrases are whole; approximate ones are padded by ±0.25 s (clamped) and flagged', () => {
    const seg = (id: string, timing: 'segment' | 'approximate', s: number, e: number, text: string): Transcript['segments'][number] => ({ id, start: ms(s), duration: ms(e - s), text, original: null, speaker: 'A', timing, words: [] });
    const t = tr([seg('seg_1', 'segment', 1000, 4000, 'אז זה. וזה עוד משפט.'), seg('seg_2', 'approximate', 100, 3000, 'בערך כך'), seg('seg_3', 'approximate', 9000, 9900, 'סוף?')]);
    const st = transcriptStatements(t, { fileDuration: ms(10000) });
    expect(st.map((s) => s.text)).toEqual(['אז זה. וזה עוד משפט.', 'בערך כך', 'סוף?']);
    expect(st.map((s) => s.timing)).toEqual(['segment', 'approximate', 'approximate']);
    expect(T.eq(st[0]!.start, ms(1000)) && T.eq(st[0]!.end, ms(4000))).toBe(true);
    expect(T.eq(st[1]!.start, ms(0)) && T.eq(st[1]!.end, ms(3250))).toBe(true); // clamped at 0
    expect(T.eq(st[2]!.start, ms(8750)) && T.eq(st[2]!.end, ms(10000))).toBe(true); // clamped to the file
    expect(st.map((s) => s.endKind)).toEqual(['period', 'phrase', 'question']);
    expect(st[0]!.startsWithConnective).toBe(true);
    expect(st[0]!.speaker).toBe('A');
  });
  it('a 31 s span splits at its largest gap (endKind split)', () => {
    // 31 words one second apart (0.5 s gaps), with a 0.6 s gap after the 20th
    const ws: [string, number, number][] = [];
    let at = 0;
    for (let i = 0; i < 31; i++) { ws.push([`מילה${i}`, at, at + 500]); at += i === 19 ? 1100 : 1000; }
    const st = transcriptStatements(tr([wordSeg('seg_1', ws)]));
    expect(T.toSeconds(T.sub(st[0]!.end, st[0]!.start)) + T.toSeconds(T.sub(st[1]!.end, st[1]!.start))).toBeGreaterThan(29);
    expect(st.map((s) => s.wordIds.length)).toEqual([20, 11]);
    expect(st.map((s) => s.endKind)).toEqual(['split', 'phrase']);
    expect(st[0]!.endsSentence).toBe(false);
    for (const s of st) expect(T.toSeconds(T.sub(s.end, s.start))).toBeLessThanOrEqual(30);
  });
  it('every word id appears exactly once, in order; times are T.eq to the source words; text verbatim', () => {
    const segs = [wordSeg('seg_1', evenly(['אז', 'כמו', 'שאמרתי.', 'נכון?', 'כן'])), wordSeg('seg_2', evenly(['ואז', 'אממ', 'החלטנו', 'לנסות.'], 5000), null)];
    const t = tr(segs);
    const st = transcriptStatements(t);
    const words = segs.flatMap((s) => s.words);
    expect(st.flatMap((s) => s.wordIds)).toEqual(words.map((w) => w.id));
    for (const s of st) {
      const first = words.find((w) => w.id === s.wordIds[0])!, last = words.find((w) => w.id === s.wordIds[s.wordIds.length - 1])!;
      expect(T.eq(s.start, first.start)).toBe(true);
      expect(T.eq(s.end, T.add(last.start, last.duration))).toBe(true);
      expect(s.text).toBe(s.wordIds.map((id) => words.find((w) => w.id === id)!.text).join(' '));
      expect(s.id).toMatch(/^st_[0-9a-f]{16}$/);
    }
    expect(st.map((s) => s.startsWithConnective)).toEqual([true, false, false, true]);
    expect(st.map((s) => s.minConfidence)).toEqual([0.9, 0.9, 0.9, null]);
    expect(new Set(st.map((s) => s.id)).size).toBe(st.length);
    expect(transcriptStatements(t)).toEqual(st); // deterministic
  });
});
