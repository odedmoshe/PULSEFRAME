/**
 * Filler candidates from a transcript (SPEC §16): hesitation sounds, immediate word repetitions and, on request, a list of
 * words the caller names. Pure rules over the transcript's words: no model, no audio. Candidates only, never edits.
 *
 * Recognisers often leave hesitation sounds out of their text, so an empty result does not mean the speech has none.
 */
import * as T from '@pulseframe/time';
import type { Transcript } from './schema.ts';

export interface FillerCandidate { kind: 'hesitation' | 'repeat' | 'listed'; segmentId: string; wordIds: string[]; text: string; start: T.RationalTime; end: T.RationalTime }
export interface FillerOptions { /** Mark the first of two identical consecutive words (default true). */ repeats?: boolean; /** Extra words to treat as fillers, compared without punctuation and vowel points. */ words?: string[] }

/** Letters and digits only, lower case, without Hebrew vowel points. */
export const bareWord = (s: string) => s.normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
// "אה", "אממ", "הממ", "אהמ", "מממ" and their lengthened forms; "uh", "um", "uhm", "er", "erm", "hmm", "mm", "ah", "eh".
const HESITATION = /^(?:א+ה+|א+מ+|א+ה+מ+|ה+מ{2,}|מ{2,}|u+h+m*|u+m+|e+r+m*|h+m{2,}|m{2,}|a+h+|e+h+)$/u;
/** Short words whose doubling is ordinary speech, not a stumble ("לא לא", "כן כן", "no no", "very very"). */
const NATURAL_DOUBLES = new Set(['לא', 'כן', 'די', 'טוב', 'מאוד', 'no', 'yes', 'very', 'so', 'bye']);

export function findFillers(tr: Transcript, opts: FillerOptions = {}): { candidates: FillerCandidate[]; skippedPhrases: number } {
  const listed = new Set((opts.words ?? []).map(bareWord).filter(Boolean));
  const out: FillerCandidate[] = [];
  let skipped = 0;
  for (const seg of tr.segments) {
    // Only words whose times came from recognition or were entered as timed words can be cut one by one.
    if (seg.timing !== 'word') { if (seg.words.length || seg.text.trim()) skipped++; continue; }
    for (let i = 0; i < seg.words.length; i++) {
      const w = seg.words[i]!, bare = bareWord(w.text);
      if (!bare || T.isZero(w.duration)) continue;
      const end = T.add(w.start, w.duration);
      const push = (kind: FillerCandidate['kind']) => out.push({ kind, segmentId: seg.id, wordIds: [w.id], text: w.text, start: w.start, end });
      if (HESITATION.test(bare)) push('hesitation');
      else if (listed.has(bare)) push('listed');
      else if (opts.repeats !== false && !NATURAL_DOUBLES.has(bare) && seg.words[i + 1] && bareWord(seg.words[i + 1]!.text) === bare) push('repeat');
    }
  }
  return { candidates: out, skippedPhrases: skipped };
}
