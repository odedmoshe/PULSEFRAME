/**
 * Statements of a transcript (ADR-0018 shorts, plan §4.3): the units the finder ranks and the planner snaps to. W2 builds
 * the body; this pre-pass fixes the signature and refuses honestly (it throws, it never returns made-up statements).
 *
 * Rules (W2 brief): a 'word' phrase ends a statement after a word whose tail, once closing quotes and brackets (also ״ ׳) are
 * stripped, is . ? ! … or ?! — but not inside a token (צה״ל, 3.5), not after a single letter, not after a listed abbreviation
 * (וכו׳, ד״ר, Mr., e.g.) — and also at the phrase end or at a gap of at least pauseSeconds. Spans over maxSeconds split at
 * their largest gap (endKind 'split'). 'segment' and 'approximate' phrases are whole statements; approximate ones are padded
 * by ±approximatePadSeconds and flagged, and never drive word-precise cuts. startsWithConnective uses fillers.ts bareWord of
 * the first word, also after one prefix letter (ו ה ב ל מ ש כ). Text is verbatim; times stay exact rationals.
 */
import type { Transcript } from './schema.ts';
import type { Statement, StatementOptions } from './shortsContract.ts';

export function transcriptStatements(_tr: Transcript, _o: StatementOptions = {}): Statement[] {
  throw new Error('transcriptStatements is not built yet (shorts W2)');
}
