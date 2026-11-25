/**
 * «Grammar first» for the local language assistant (wave 7; .artifacts/wave7/assistant-decisions.md §4). LEAD pre-pass, built and
 * tested: what the model-free grammar understands never goes to the model.
 *
 * barUnderstands(text) is true exactly when some grammar family reads EVERY word of the text with its verb, which is exactly when
 * interpret(text, ctx) answers anything but 'unknown' — for every context, because interpret() decides 'unknown' before it looks at
 * the project (commandBar/index.ts: no covering family → unknown; a covering family → a plan, an action, a question, a missing item or
 * a refusal). So the server can apply it without the owner's editor state: a local request whose text the grammar reads is refused
 * with 409 grammar_understood (no job, nothing sent), and a phrase the server rendered from a model answer must pass it.
 */
import { FAMILIES } from './lexicon.ts';
import { parseFamily, tokenizeBar } from './match.ts';

export function barUnderstands(text: string): boolean {
  const { tokens, unclosedQuote } = tokenizeBar(text);
  if (!tokens.length) return false;
  return FAMILIES.some((f) => { const p = parseFamily(f, tokens, unclosedQuote); return p.head && p.unread.length === 0; });
}
