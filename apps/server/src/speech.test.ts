import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { sanitizeRecognition, SPEECH_MODELS } from './speech.ts';

const w = (text: string, start: number, end: number, probability = 0.9) => ({ text, start, end, probability });
const s = (x: T.RationalTime) => T.toSeconds(x);

describe('sanitizeRecognition', () => {
  it('keeps the recogniser\'s words and times, as exact milliseconds', () => {
    const r = sanitizeRecognition([{ start: 0.5, end: 2, text: ' שלום עולם', words: [w(' שלום', 0.5, 1.1), w(' עולם', 1.1, 2, 0.4)] }], 10);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.text).toBe('שלום עולם');
    expect(r.segments[0]!.words.map((x) => [x.text, s(x.start), s(x.duration), x.confidence])).toEqual([['שלום', 0.5, 0.6, 0.9], ['עולם', 1.1, 0.9, 0.4]]);
    expect(r.stats).toMatchObject({ phrases: 1, words: 2, lowConfidenceWords: 1, adjustedTimes: 0, droppedPhrases: 0, degeneratePhrases: 0 });
  });
  it('makes phrases and words obey the transcript rules by moving times only onto a neighbour or the end of the media', () => {
    const r = sanitizeRecognition([
      { start: 0, end: 3, text: 'a b', words: [w('a', 0, 2), w('b', 1.5, 3)] }, // second word starts inside the first
      { start: 2.5, end: 12, text: 'c', words: [w('c', 2.5, 12)] }, // overlaps the previous phrase and runs past the media
    ], 10);
    const [p1, p2] = r.segments;
    expect(s(p1!.words[1]!.start)).toBe(2);
    expect(s(p2!.start)).toBe(3);
    expect(s(p2!.start) + s(p2!.duration)).toBe(10);
    expect(s(p2!.words[0]!.start)).toBe(3);
    expect(r.stats.adjustedTimes).toBeGreaterThan(0);
    // phrases in order without overlap; words inside their phrase
    let end = 0;
    for (const p of r.segments) { expect(s(p.start)).toBeGreaterThanOrEqual(end); end = s(p.start) + s(p.duration); for (const x of p.words) expect(s(x.start) + s(x.duration)).toBeLessThanOrEqual(end); }
  });
  it('drops phrases without length or text, and words without text', () => {
    const r = sanitizeRecognition([{ start: 4, end: 4, text: 'x', words: [] }, { start: 5, end: 6, text: '  ', words: [w('  ', 5, 6)] }, { start: 7, end: 8, text: 'ok', words: [w('', 7, 7.5), w('ok', 7.5, 8)] }], 10);
    expect(r.segments.map((p) => p.text)).toEqual(['ok']);
    expect(r.segments[0]!.words).toHaveLength(1);
    expect(r.stats.droppedPhrases).toBe(2);
  });
  it('leaves out phrases where the recogniser fell into repetition, and counts them', () => {
    const r = sanitizeRecognition([
      { start: 0, end: 3, text: `טא${'ו'.repeat(120)}`, words: [w(`טא${'ו'.repeat(120)}`, 0, 3)] },
      { start: 3, end: 5, text: 'תודה '.repeat(12), words: [] },
      { start: 5, end: 6, text: 'fine', compressionRatio: 3.1, words: [w('fine', 5, 6)] },
      { start: 6, end: 7, text: 'אני מאוד מתרגשת', compressionRatio: 0.9, words: [w('אני', 6, 6.3), w('מאוד', 6.3, 6.6), w('מתרגשת', 6.6, 7)] },
    ], 10);
    expect(r.segments.map((p) => p.text)).toEqual(['אני מאוד מתרגשת']);
    expect(r.stats.degeneratePhrases).toBe(3);
  });
  it('ordinary emphasis is not treated as repetition', () => {
    const r = sanitizeRecognition([{ start: 0, end: 2, text: 'לאאאא! די די די', words: [] }], 10);
    expect(r.segments).toHaveLength(1);
  });
});

describe('reviewed speech models', () => {
  it('every file is pinned by revision, size, digest and an https source on the model host', () => {
    for (const m of SPEECH_MODELS) for (const f of m.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.source).toMatch(new RegExp(`^https://huggingface\\.co/.+/resolve/${f.revision}/`));
      expect(f.path.startsWith(`${m.dir}/`)).toBe(true);
      expect(f.license).toBeTruthy();
    }
  });
});
