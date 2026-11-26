/**
 * Which row of the palette Enter acts on before the owner has arrowed to one (ADR-0027; .artifacts/command-bar-plan.md §6).
 *
 * The command bar's answer is the first option and is active by default (plan §6 "Mount"). One exception keeps the palette's
 * older promise: when the typed text IS a registry command's name (either language, compared as the palette search compares,
 * so case, niqqud and punctuation do not matter) and the bar has nothing to run for it (an unknown, incomplete, ambiguous or
 * refused answer), that command's row is active, so Enter runs that command as it did before the bar.
 *
 * - A request the grammar plans or acts on keeps the bar's previewed answer: its intent stands beside the same registry command
 *   (plan §4.4), and a plan runs only from its rendered preview (§6 "Enter").
 * - A near miss («track up», «close empty gaps») is not a name: it stays an unknown request, Enter runs nothing, and the bar offers
 *   the nearest commands (plan, Brief: «an ambiguous or unknown request is never guessed»; proof check 6).
 */
import { normalize, type SearchItem } from './palette.search.ts';

/** The registry command whose Hebrew or English name is exactly `text` (normalised), else null. The first in registry order wins. */
export function exactCommandId(text: string | null | undefined, items: readonly SearchItem[]): string | null {
  const q = normalize(text ?? '');
  if (!q) return null;
  for (const item of items) if (normalize(item.he) === q || normalize(item.en) === q) return item.id;
  return null;
}

export interface DefaultActiveInput {
  /** Every selectable key in display order (the bar's keys first, then commands, catalogue, media). */
  keys: readonly string[];
  /** The bar's answer for the current text runs something on Enter (a plan or an action), as opposed to a row that only says something. */
  barRuns: boolean;
  /** exactCommandId of the typed text (or of its other-layout rescue). */
  exactId: string | null;
}

/** The active key when the owner has not chosen one. */
export function defaultActiveKey({ keys, barRuns, exactId }: DefaultActiveInput): string | null {
  if (exactId && !barRuns && keys.includes(exactId)) return exactId;
  return keys[0] ?? null;
}
