/**
 * Statements of a transcript (ADR-0018 shorts, plan §4.3): the units the finder ranks and the planner snaps to. Pure rules over
 * the transcript's words; no model, no audio. Text is verbatim; times stay exact rationals (ADR-0003).
 *
 * - A 'word' phrase ends a statement after a word whose tail, once closing quotes and brackets (also ״ ׳) are stripped, is
 *   . ? ! … (or ...) or ?! — but not inside a token (צה״ל, 3.5: the mark is not the tail), not after a single letter (א. J.),
 *   and not after a listed abbreviation (וכו׳, ד״ר, Mr., e.g.). It also ends at the phrase end ('phrase') and at a gap of at
 *   least pauseSeconds before the next word ('pause').
 * - A statement longer than maxSeconds is split at its largest word gap; the first part ends with endKind 'split'.
 * - 'segment' and 'approximate' phrases are whole statements. Approximate ones are padded outward by approximatePadSeconds
 *   (clamped to 0 and, when given, to the file) and keep timing 'approximate', so nothing word-precise is cut by them.
 * - startsWithConnective: fillers.ts bareWord of the first word, also after one prefix letter (ו ה ב ל מ ש כ), is one of a short
 *   Hebrew and English list of words that lean on what came before (אבל, אז, כי, לכן, וגם; and, but, so, because …).
 */
import * as T from '@pulseframe/time';
import { fingerprint } from './entities.ts';
import { bareWord } from './fillers.ts';
import type { Transcript } from './schema.ts';
import { STATEMENT_DEFAULTS, type Statement, type StatementOptions } from './shortsContract.ts';

/** Options of transcriptStatements: the contract's, plus the file duration that approximate padding is clamped to. */
export interface StatementBuildOptions extends StatementOptions { fileDuration?: T.RationalTime }

/** One Hebrew prefix letter (and, the, in, to, from, that, as) that may stand before a listed word. */
export const HEBREW_PREFIX_LETTERS = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'] as const;
/** Words that open a statement leaning on an earlier one (compared with bareWord, also after one prefix letter). */
export const CONNECTIVE_WORDS = {
  he: ['אבל', 'אז', 'כי', 'לכן', 'וגם', 'גם', 'אך', 'אולם', 'ולכן', 'כלומר', 'בנוסף', 'משום', 'בגלל', 'עוד', 'כאמור', 'אלא'],
  en: ['and', 'but', 'so', 'because', 'also', 'then', 'or', 'however', 'therefore', 'plus', 'which', 'thus'],
} as const;
/** Abbreviations whose final mark does not end a sentence (compared without vowel points, case-insensitive, ״/׳ as "/'). */
export const ABBREVIATIONS = {
  he: ['וכו׳', 'וכד׳', 'ד״ר', 'פרופ׳', 'עו״ד', 'רו״ח', 'גב׳', 'מס׳', 'רח׳', 'עמ׳', 'וגו׳', 'בע״מ'],
  en: ['mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'no.', 'approx.', 'inc.', 'ltd.'],
} as const;

const CONNECTIVES = new Set<string>([...CONNECTIVE_WORDS.he, ...CONNECTIVE_WORDS.en].map(bareWord));
/** Vowel points and other combining marks removed; Hebrew geresh / gershayim and curly quotes as ASCII ' and ". */
const plain = (s: string) => s.normalize('NFC').replace(/\p{M}/gu, '').replace(/[׳’‘`]/g, "'").replace(/[״”“„]/g, '"').toLowerCase();
const ABBREVS = new Set<string>([...ABBREVIATIONS.he, ...ABBREVIATIONS.en].map(plain));
/** Closing quotes and brackets stripped from the end of a token before its tail is read. */
const CLOSERS = /["')\]}»›]+$/u;

/** Is `bare` (fillers.ts bareWord) one of `set`, also after stripping one Hebrew prefix letter? */
export function inWordSet(bare: string, set: ReadonlySet<string>): boolean {
  if (!bare) return false;
  if (set.has(bare)) return true;
  return bare.length > 1 && (HEBREW_PREFIX_LETTERS as readonly string[]).includes(bare[0]!) && set.has(bare.slice(1));
}
/** Does this word open a statement leaning on what came before? */
export const isConnective = (word: string) => inWordSet(bareWord(word), CONNECTIVES);

type EndMark = 'period' | 'question' | 'exclaim' | 'ellipsis';
/** The sentence mark this token ends with, or null (none, inside a token, after a single letter, after an abbreviation). */
export function sentenceMark(token: string): EndMark | null {
  const p = plain(token.trim());
  const t = p.replace(CLOSERS, '');
  if (!t) return null;
  let mark: EndMark | null = null, body = t;
  if (/(\?!|!\?)$/.test(t)) { mark = 'question'; body = t.slice(0, -2); }
  else if (/(…|\.\.\.)$/.test(t)) { mark = 'ellipsis'; body = t.replace(/(…|\.\.\.)$/, ''); }
  else if (t.endsWith('?')) { mark = 'question'; body = t.slice(0, -1); }
  else if (t.endsWith('!')) { mark = 'exclaim'; body = t.slice(0, -1); }
  else if (t.endsWith('.')) { mark = 'period'; body = t.slice(0, -1); }
  if (!mark) return null;
  const letters = bareWord(body);
  if (!letters) return mark === 'period' ? null : mark; // a lone "." is no sentence; a lone "?" closes the one before it
  if (mark === 'period' || mark === 'ellipsis') {
    if (letters.length === 1 && /^\p{L}$/u.test(letters)) return null; // a single letter: an initial or a list item ("א.", "J.")
    // an abbreviation, with or without its own closing mark ("וכו׳." / "Mr." / "e.g.")
    const head = t.replace(/(…|\.\.\.|\.)$/, '');
    if (ABBREVS.has(t) || ABBREVS.has(head) || ABBREVS.has(`${head}.`)) return null;
  }
  return mark;
}

const statementId = (segmentId: string, anchor: string | T.RationalTime) =>
  `st_${fingerprint(typeof anchor === 'string' ? { segmentId, firstWordId: anchor } : { segmentId, start: T.normalize(anchor) })}`;

interface W { id: string; text: string; start: T.RationalTime; end: T.RationalTime; confidence: number | null }
const minConf = (ws: readonly { confidence: number | null }[]) => {
  const c = ws.map((w) => w.confidence).filter((x): x is number => x !== null);
  return c.length ? Math.min(...c) : null;
};
const endsSentenceKind = (k: Statement['endKind']) => k === 'period' || k === 'question' || k === 'exclaim' || k === 'ellipsis' || k === 'phrase';

/** Split a run of words at its largest gap until every part lasts at most `max` (a single word is never split). */
function splitLong(words: W[], kind: Statement['endKind'], max: T.RationalTime): { words: W[]; kind: Statement['endKind'] }[] {
  if (words.length < 2 || T.lte(T.sub(words[words.length - 1]!.end, words[0]!.start), max)) return [{ words, kind }];
  let at = 0, best: T.RationalTime | null = null;
  for (let i = 0; i < words.length - 1; i++) {
    const gap = T.sub(words[i + 1]!.start, words[i]!.end);
    if (best === null || T.lt(best, gap)) { best = gap; at = i; } // the first of equal largest gaps
  }
  return [...splitLong(words.slice(0, at + 1), 'split', max), ...splitLong(words.slice(at + 1), kind, max)];
}

/** The statements of a transcript, in transcript order. Every word id appears exactly once, in order. */
export function transcriptStatements(tr: Transcript, o: StatementBuildOptions = {}): Statement[] {
  const pause = T.fromSeconds(o.pauseSeconds ?? STATEMENT_DEFAULTS.pauseSeconds);
  const max = T.fromSeconds(o.maxSeconds ?? STATEMENT_DEFAULTS.maxSeconds);
  const pad = T.fromSeconds(o.approximatePadSeconds ?? STATEMENT_DEFAULTS.approximatePadSeconds);
  const out: Statement[] = [];
  for (const seg of tr.segments) {
    const segEnd = T.add(seg.start, seg.duration);
    if (seg.timing === 'word' && seg.words.length) {
      const words: W[] = seg.words.map((w) => ({ id: w.id, text: w.text, start: w.start, end: T.add(w.start, w.duration), confidence: w.confidence }));
      let run: W[] = [];
      const close = (kind: Statement['endKind']) => {
        for (const part of splitLong(run, kind, max)) {
          const first = part.words[0]!, last = part.words[part.words.length - 1]!;
          out.push({
            id: statementId(seg.id, first.id), segmentId: seg.id, wordIds: part.words.map((w) => w.id), start: first.start, end: last.end,
            text: part.words.map((w) => w.text).join(' '), endKind: part.kind, endsSentence: endsSentenceKind(part.kind), question: part.kind === 'question',
            startsWithConnective: isConnective(first.text), timing: 'word', minConfidence: minConf(part.words), speaker: seg.speaker,
          });
        }
        run = [];
      };
      words.forEach((w, i) => {
        run.push(w);
        const mark = sentenceMark(w.text);
        const next = words[i + 1];
        if (!next) close(mark ?? 'phrase');
        else if (mark) close(mark);
        else if (T.lte(pause, T.sub(next.start, w.end))) close('pause');
      });
      continue;
    }
    const text = seg.text.trim();
    if (!text && !seg.words.length) continue;
    const tokens = text.split(/\s+/u).filter(Boolean);
    const lastToken = tokens[tokens.length - 1] ?? seg.words[seg.words.length - 1]?.text ?? '';
    const kind: Statement['endKind'] = sentenceMark(lastToken) ?? 'phrase';
    const approximate = seg.timing === 'approximate';
    let start = seg.start, end = segEnd;
    if (approximate) {
      start = T.max(T.ZERO, T.sub(seg.start, pad));
      end = T.add(segEnd, pad);
      if (o.fileDuration) end = T.max(start, T.min(end, o.fileDuration));
    }
    out.push({
      id: statementId(seg.id, seg.start), segmentId: seg.id, wordIds: seg.words.map((w) => w.id), start, end,
      text: text || seg.words.map((w) => w.text).join(' '), endKind: kind, endsSentence: endsSentenceKind(kind), question: kind === 'question',
      startsWithConnective: isConnective(tokens[0] ?? seg.words[0]?.text ?? ''), timing: approximate ? 'approximate' : 'segment',
      minConfidence: minConf(seg.words), speaker: seg.speaker,
    });
  }
  return out;
}
