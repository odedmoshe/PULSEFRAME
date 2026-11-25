/**
 * The scorer of the local assistant's fixtures (wave 7; .artifacts/wave7/assistant-decisions.md §5 builder A). Pure: no clock, no
 * network, no model. The 51 fixtures (A29 B7 C5 D5 E5) are packages/evals/fixtures/assistant-local-fixtures.json. A fixture whose
 * text the grammar already reads (barUnderstands) is expected as 'GRAMMAR': the server refuses it with grammar_understood and it is
 * never sent (e.g. «תחתוך בשנייה הרביעית», which the bar asks about itself).
 *
 * One row per fixture, from the model's raw answer text:
 *  - valid: the text is JSON under core LocalAnswerSchema;
 *  - the answer is grounded (core groundLocalAnswer) exactly as the server does, then compared with `expect` (the answer AFTER
 *    grounding): intentMatch, slotsMatch (numbers as exact rationals, text verbatim);
 *  - guessed: kept slots the request did not say. A second, independent grounding of the KEPT answer is the oracle; with the
 *    server's grounding this is zero by construction, and the test plants a broken grounding to show the column catches it;
 *  - droppedUngrounded: slots the grounding dropped as not said;
 *  - noneHandled: 'none' answered exactly when 'none' is expected;
 *  - wouldChange: the phrase would make the bar plan an EDIT (every required slot present, not a view action) that was not expected:
 *    the error that matters (it still needs the owner's Enter);
 *  - outcome: what the bar would do with the phrase (acts, asks, none, no_phrase when no grammar phrase fits, invalid, grammar).
 * Nothing here is a verdict on a model: the numbers are counts over designer-written fixtures.
 */
import {
  barUnderstands, groundLocalAnswer, LocalAnswerSchema, localMissing, localPhrase, exFromDecimal, exText,
  type GroundedAnswer, type LocalAnswer, type LocalAnswerIntent, type LocalIntent, type LocalSlots,
} from '@pulseframe/core';

export const LOCAL_FIXTURE_COUNT = 51;
/** The groups and their sizes (A free paraphrases, B actions, C a missing detail, D nothing to propose, E English and variants). */
export const LOCAL_FIXTURE_GROUPS: Readonly<Record<'A' | 'B' | 'C' | 'D' | 'E', number>> = { A: 29, B: 7, C: 5, D: 5, E: 5 };
export interface LocalFixture {
  id: string; text: string; lang: 'he' | 'en'; expect: { intent: LocalAnswerIntent; slots: LocalSlots } | 'ASK' | 'NONE' | 'GRAMMAR';
  /** A LABELLED STAND-IN answer written by the designer (never a model's); some plant a detail the owner did not say. */
  standIn?: LocalAnswer;
}
export type LocalOutcome = 'acts' | 'asks' | 'none' | 'no_phrase' | 'invalid' | 'grammar';
export interface LocalScoreRow {
  id: string; valid: boolean; intentMatch: boolean; slotsMatch: boolean; wouldChange: boolean; droppedUngrounded: number; wallMs: number | null;
  /** Kept slots the request did not say (zero after the server's grounding). */
  guessed: number;
  /** 'none' answered exactly when expected; null for a GRAMMAR fixture or an invalid answer. */
  noneHandled: boolean | null;
  outcome: LocalOutcome;
  /** The bar phrase rendered from the grounded answer in the fixture's language (null: none, invalid, grammar, or no phrase fits). */
  phrase: string | null;
  /** The answer after grounding (null when invalid or GRAMMAR). */
  grounded: GroundedAnswer | null;
}
export interface LocalScoreOptions { ground?: (request: string, answer: LocalAnswer) => GroundedAnswer }

/** Intents that change nothing in the project (view and transport actions; export only opens the sheet). */
const VIEW_ONLY: ReadonlySet<LocalAnswerIntent> = new Set(['play', 'pause', 'seek', 'zoom_in', 'zoom_out', 'workspace', 'export_to']);
const NUMERIC = new Set(['atSeconds', 'forSeconds', 'db', 'factor']);
/** The slots as compared: numbers as exact decimal text, the rest verbatim, keys sorted. */
function normSlots(slots: LocalSlots): string {
  const o: Record<string, string> = {};
  for (const k of Object.keys(slots).sort()) {
    const v = (slots as Record<string, string | undefined>)[k];
    if (v === undefined) continue;
    const e = NUMERIC.has(k) ? exFromDecimal(v) : null;
    o[k] = e ? exText(e) : v;
  }
  return JSON.stringify(o);
}
const acts = (g: GroundedAnswer, lang: 'he' | 'en') => g.intent !== 'none' && localPhrase(g.intent, g.slots, lang) !== null && localMissing(g.intent, g.slots).length === 0;

export function scoreLocalAnswer(fixture: LocalFixture, answerText: string | null, wallMs: number | null, opts: LocalScoreOptions = {}): LocalScoreRow {
  const base = { id: fixture.id, wallMs, guessed: 0, droppedUngrounded: 0, phrase: null, grounded: null };
  if (fixture.expect === 'GRAMMAR') {
    // never sent: the row says whether the grammar really reads the text (a fixture marked GRAMMAR that it does not read is wrong)
    const reads = barUnderstands(fixture.text);
    return { ...base, valid: reads, intentMatch: reads, slotsMatch: reads, wouldChange: false, noneHandled: null, outcome: 'grammar' };
  }
  const invalid: LocalScoreRow = { ...base, valid: false, intentMatch: false, slotsMatch: false, wouldChange: false, noneHandled: null, outcome: 'invalid' };
  if (answerText === null) return invalid;
  let json: unknown;
  try { json = JSON.parse(answerText); } catch { return invalid; }
  const parsed = LocalAnswerSchema.safeParse(json);
  if (!parsed.success) return invalid;
  const g = (opts.ground ?? groundLocalAnswer)(fixture.text, parsed.data);
  // the oracle: the server's grounding of the KEPT answer drops nothing it kept
  const guessed = groundLocalAnswer(fixture.text, { intent: g.intent, slots: g.slots }).dropped.length;
  const droppedUngrounded = g.dropped.filter((d) => d.why === 'ungrounded').length;
  const phrase = g.intent === 'none' ? null : localPhrase(g.intent as LocalIntent, g.slots, fixture.lang);
  const outcome: LocalOutcome = g.intent === 'none' ? 'none' : phrase === null ? 'no_phrase' : localMissing(g.intent as LocalIntent, g.slots).length ? 'asks' : 'acts';

  const exp = fixture.expect === 'NONE' ? { intent: 'none' as const, slots: {} } : fixture.expect;
  let intentMatch: boolean, slotsMatch: boolean, expectedActs: boolean;
  if (exp === 'ASK') {
    intentMatch = outcome === 'asks' || outcome === 'none';
    slotsMatch = intentMatch;
    expectedActs = false;
  } else {
    intentMatch = g.intent === exp.intent;
    slotsMatch = intentMatch && normSlots(g.slots) === normSlots(exp.slots);
    expectedActs = exp.intent !== 'none' && acts({ intent: exp.intent, slots: exp.slots, dropped: [] }, fixture.lang);
  }
  const expectsNone = exp !== 'ASK' && exp.intent === 'none';
  const changes = outcome === 'acts' && !VIEW_ONLY.has(g.intent);
  const wouldChange = changes && !(expectedActs && slotsMatch);
  return { ...base, valid: true, intentMatch, slotsMatch, wouldChange, droppedUngrounded, guessed, noneHandled: expectsNone === (g.intent === 'none'), outcome, phrase, grounded: g };
}

export interface LocalScoreSummary {
  fixtures: number; grammar: number; sent: number; valid: number; intentMatch: number; slotsMatch: number; guessed: number; droppedUngrounded: number;
  noneExpected: number; noneHandled: number; wouldChange: string[]; noPhrase: string[];
}
/** Counts over the rows (GRAMMAR fixtures are counted apart: they are never sent). */
export function summarizeLocalScores(fixtures: readonly LocalFixture[], rows: readonly LocalScoreRow[]): LocalScoreSummary {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const sent = rows.filter((r) => r.outcome !== 'grammar');
  const isNone = (r: LocalScoreRow) => { const e = byId.get(r.id)?.expect; return e === 'NONE' || (typeof e === 'object' && e.intent === 'none'); };
  return {
    fixtures: rows.length, grammar: rows.length - sent.length, sent: sent.length,
    valid: sent.filter((r) => r.valid).length, intentMatch: sent.filter((r) => r.intentMatch).length, slotsMatch: sent.filter((r) => r.slotsMatch).length,
    guessed: sent.reduce((n, r) => n + r.guessed, 0), droppedUngrounded: sent.reduce((n, r) => n + r.droppedUngrounded, 0),
    noneExpected: sent.filter(isNone).length, noneHandled: sent.filter((r) => isNone(r) && r.noneHandled === true).length,
    wouldChange: sent.filter((r) => r.wouldChange).map((r) => r.id), noPhrase: sent.filter((r) => r.outcome === 'no_phrase').map((r) => r.id),
  };
}

/** The fixture file's shape check (ids unique and in the groups, sizes as LOCAL_FIXTURE_GROUPS). Throws with the first problem. */
export function checkLocalFixtures(fixtures: readonly LocalFixture[]): void {
  if (fixtures.length !== LOCAL_FIXTURE_COUNT) throw new Error(`expected ${LOCAL_FIXTURE_COUNT} fixtures, found ${fixtures.length}`);
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  for (const f of fixtures) {
    if (ids.has(f.id)) throw new Error(`duplicate fixture id ${f.id}`);
    ids.add(f.id);
    const g = f.id[0]!;
    if (!(g in LOCAL_FIXTURE_GROUPS) || !/^[A-E]\d{2}$/.test(f.id)) throw new Error(`fixture id ${f.id} is not in a group`);
    counts[g] = (counts[g] ?? 0) + 1;
  }
  for (const [g, n] of Object.entries(LOCAL_FIXTURE_GROUPS)) if (counts[g] !== n) throw new Error(`group ${g} has ${counts[g] ?? 0} fixtures, expected ${n}`);
}
