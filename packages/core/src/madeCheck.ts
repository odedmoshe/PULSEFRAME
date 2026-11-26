/**
 * The page and field checks of «קליפ מקוד» (wave 8 motioncode). W2 owns this file: replace the bodies (verify C4: case-sensitive identifiers
 * at word boundaries, outside strings and comments where possible; problems only for size, NUL and not UTF-8; everything else a warning
 * with its character offset; SMIL named). Never repairs a page.
 */
import { MadeNotBuiltError, type MadeField } from './madeContract.ts';

/** A warning from the static scan of a page (verify C4: case-sensitive identifiers at word boundaries; warnings only, with offsets). */
export interface MadePageWarning { what: string; at: number }
/** Facts that make a page undrawable as sent (size, NUL, not UTF-8): the only things the static check refuses. */
export interface MadePageProblem { what: 'too_large' | 'nul' | 'not_utf8'; at: number }
/** W2 (madeCheck.ts): scan a page. Never repairs; refuses only `problems`; everything else is a warning. */
export function checkMadePage(_html: string): { problems: MadePageProblem[]; warnings: MadePageWarning[] } {
  throw new MadeNotBuiltError('checkMadePage');
}
/** W2: validate field values against their fields (colour #rrggbb, numbers in min..max, text within maxLength); returns problems by key. */
export function madeFieldsCheck(_fields: readonly MadeField[], _values: Readonly<Record<string, string>>): { key: string; why: 'unknown' | 'colour' | 'number' | 'range' | 'length' }[] {
  throw new MadeNotBuiltError('madeFieldsCheck');
}
