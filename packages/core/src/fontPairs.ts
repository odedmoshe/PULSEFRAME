/**
 * Pairings of the bundled fonts for the font picker («מתאים עם…», ADR-0022): a heading family and a body family that suit
 * each other, with a short note in Hebrew and English.
 *
 * CONTRACT FILE (lead pre-pass): the export and its type (fonts.ts FontPair) are fixed; W2 supplies the rows. Every family
 * and weight of a row must be in FONT_CATALOG (fontPairs.test.ts). Empty until then: no pairing is claimed that nobody chose.
 */
import type { FontPair } from './fonts.ts';

export const FONT_PAIRS: readonly FontPair[] = [];
