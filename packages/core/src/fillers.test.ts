import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { bareWord, findFillers } from './fillers.ts';
import type { Transcript } from './schema.ts';

const tr = (phrases: { timing?: 'word' | 'segment' | 'approximate'; words: string[] }[]): Transcript => {
  let t = 0, n = 0;
  return { assetId: 'a', language: 'he', origin: { kind: 'asr', provider: 'x', model: 'y', createdAt: 'now', createdBy: 'me' }, segments: phrases.map((p, i) => {
    const start = t;
    const words = p.words.map((text) => ({ id: `w${n++}`, text, start: T.rt(t++, 1), duration: T.rt(1, 1), confidence: 0.9 }));
    return { id: `s${i}`, start: T.rt(start, 1), duration: T.rt(Math.max(1, p.words.length), 1), text: p.words.join(' '), original: null, speaker: null, timing: p.timing ?? 'word', words };
  }) };
};

describe('findFillers', () => {
  it('finds hesitation sounds in Hebrew and English, with punctuation and lengthening', () => {
    const r = findFillers(tr([{ words: ['אז', 'אה,', 'רציתי', 'אממממ', 'להגיד', 'הממ...', 'um', 'that', 'Uhh', 'erm'] }]));
    expect(r.candidates.filter((c) => c.kind === 'hesitation').map((c) => c.text)).toEqual(['אה,', 'אממממ', 'הממ...', 'um', 'Uhh', 'erm']);
  });
  it('does not mistake ordinary words for hesitations', () => {
    const r = findFillers(tr([{ words: ['אמא', 'אהבה', 'אם', 'מה', 'הם', 'אמת', 'her', 'am', 'he', 'me', 'hem'] }]));
    expect(r.candidates).toEqual([]);
  });
  it('marks the first of two identical consecutive words, but not natural doubles, and not across phrases', () => {
    const r = findFillers(tr([{ words: ['אני', 'אני', 'רוצה', 'לא', 'לא', 'ככה'] }, { words: ['ככה', 'זה'] }]));
    expect(r.candidates.map((c) => [c.kind, c.wordIds[0]])).toEqual([['repeat', 'w0']]);
    expect(findFillers(tr([{ words: ['אני', 'אני'] }]), { repeats: false }).candidates).toEqual([]);
  });
  it('treats words the caller lists as fillers, compared without points or punctuation', () => {
    const r = findFillers(tr([{ words: ['זה', 'כְּאִילּוּ', 'ממש', 'כאילו,', 'טוב'] }]), { words: ['כאילו'] });
    expect(r.candidates.map((c) => c.kind)).toEqual(['listed', 'listed']);
    expect(bareWord('כְּאִלּוּ,')).toBe('כאלו'); // points removed; spelling with and without the extra letter stays different
  });
  it('skips phrases whose words are not individually timed, and says how many', () => {
    const r = findFillers(tr([{ timing: 'segment', words: ['אה'] }, { timing: 'approximate', words: ['אממ'] }, { words: ['אה'] }]));
    expect(r.candidates).toHaveLength(1);
    expect(r.skippedPhrases).toBe(2);
  });
  it('reports source times of each candidate', () => {
    const c = findFillers(tr([{ words: ['שלום', 'אה', 'עולם'] }])).candidates[0]!;
    expect([T.toSeconds(c.start), T.toSeconds(c.end)]).toEqual([1, 2]);
  });
});
