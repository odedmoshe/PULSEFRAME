/**
 * The command bar's grammar (ADR-0027): interpret(text, ctx) → BarResult, against ../commandBarContract.ts. Synchronous,
 * deterministic and pure (no clock, no random source, no DOM, no i18n import).
 *
 * Pipeline (plan §4.1): normalise and tokenize (normalize.ts) → every intent family reads the tokens with its listed words
 * and slots, the longest phrase winning at each position (match.ts, lexicon.ts) → decision:
 *   - exactly one family covers every token with all it needs → its plan or action (plans.ts, after resolve.ts);
 *   - two or more → ambiguous, each reading a complete choice; a reading whose words allow two meanings («ב־3 שניות» with a
 *     title, «בשנייה השלישית», «1,5») → ambiguous too;
 *   - a family covers every token but lacks a required slot → incomplete, with an example;
 *   - otherwise → unknown, with the readings that matched and the spans left unread.
 * No scoring threshold ever turns a partial match into an action.
 */
import type { BarChoice, BarContext, BarResult, Interpret, IntentId } from '../commandBarContract.ts';
import { FAMILIES, INTENT_NAMES } from './lexicon.ts';
import { parseFamily, readingsOf, spansOf, tokenizeBar, type FamilyParse } from './match.ts';
import { PLANNERS, readingSets, type PlanEnv } from './plans.ts';

export { tokenizeBar } from './match.ts';

/** Plan one family's parse: every reading set, an ambiguous answer when the words allow more than one. */
function planFamily(p: FamilyParse, env: Omit<PlanEnv, 'values' | 'heads'>): BarResult {
  const planner = PLANNERS[p.family.id]!;
  const heads = p.hits.filter((h) => h.head);
  const sets = readingSets(p);
  if (sets.length === 1) return planner({ ...env, values: sets[0]!.values, heads });
  const results = sets.map((s) => ({ s, r: planner({ ...env, values: s.values, heads }) }));
  const choices: BarChoice[] = [];
  for (const { s, r } of results) {
    const label = { he: s.labels.map((l) => l.he).join(', '), en: s.labels.map((l) => l.en).join(', ') };
    if (r.kind === 'plan' || r.kind === 'action') choices.push({ ...label, result: r });
    else if (r.kind === 'ambiguous') for (const c of r.choices) choices.push({ he: `${label.he}: ${c.he}`, en: `${label.en}: ${c.en}`, result: c.result });
  }
  if (!choices.length) return results[0]?.r ?? { kind: 'unknown', tokens: env.tokens, readings: env.readings, unread: [], partial: [p.family.intents[0]!] };
  return { kind: 'ambiguous', intent: p.family.intents[0]!, tokens: env.tokens, readings: env.readings, choices, question: { he: 'למה התכוונת?', en: 'What did you mean?' } };
}

export const interpret: Interpret = (text: string, ctx: BarContext): BarResult => {
  const { tokens, unclosedQuote } = tokenizeBar(text);
  if (!tokens.length) return { kind: 'unknown', tokens, readings: [], unread: [], partial: [] };
  const parses = FAMILIES.map((f) => parseFamily(f, tokens, unclosedQuote));
  const covering = parses.filter((p) => p.head && p.unread.length === 0);
  const results = covering.map((p) => planFamily(p, { ctx, tokens, readings: readingsOf(tokens, p.hits) }));
  const full = results.filter((r) => r.kind !== 'incomplete');
  if (full.length === 1) return full[0]!;
  if (full.length > 1) {
    // two families read every word: each reading is a complete choice; nothing is chosen
    const choices: BarChoice[] = [];
    for (const r of full) {
      if (r.kind === 'plan' || r.kind === 'action') choices.push({ ...INTENT_NAMES[r.intent], result: r });
      else if (r.kind === 'ambiguous') choices.push(...r.choices);
    }
    const readings = full.flatMap((r) => r.readings);
    return { kind: 'ambiguous', intent: null, tokens, readings, choices, question: { he: 'יש כמה אפשרויות:', en: 'There are several readings:' } };
  }
  if (results.length) return results[0]!;
  // unknown: the families whose verb was seen are the partial readings; the best of them shows what was read
  const partial = parses.filter((p) => p.head).sort((a, b) => a.unread.length - b.unread.length);
  const best = partial[0];
  const seen = new Set<IntentId>();
  for (const p of partial) seen.add(p.family.intents[0]!);
  return {
    kind: 'unknown', tokens,
    readings: best ? readingsOf(tokens, best.hits) : [],
    unread: spansOf(tokens, best ? best.unread : tokens.map((_, i) => i)),
    partial: [...seen],
  };
};
