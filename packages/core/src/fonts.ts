/**
 * Bundled font catalog (SPEC §15). The single list of families that preview and export can draw.
 * Every entry is an npm package pinned to an exact version whose licence file ships in the build's notices.
 * `hebrew: true` means the package declares a Hebrew subset AND the renderer verifies at start-up that a Hebrew
 * sample (letters + niqqud) resolves to this font rather than a fallback. It is not a typographic quality review.
 *
 * Title fonts of the content packs (ADR-0022): TITLE_FONT_ROWS below are families whose licence was read at the package, pinned at
 * an exact version in apps/web/package.json, with their CSS imports in apps/web/src/titleFonts.ts (imported by fonts.ts). They
 * are rows of FONT_CATALOG (appended after the first five), so every page that draws text loads them through the same
 * ensureFonts, preview, stills and export draw them alike, and the export manifest pins their files. A row is `nikud:
 * 'positioned'` only when apps/web/src/fonts.glyphs.test.ts proved it.
 * HELD_TITLE_FONTS names the families that wait for an owner decision and are not pinned.
 */
export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting';
export type FontTag = 'rounded' | 'classic' | 'condensed' | 'playful' | 'cursive' | 'bold';
export interface FontEntry {
  family: string;
  /** File-name prefix of the emitted font files (`<slug>-hebrew-400-normal.woff2`). No slug followed by `-` may begin another slug: the export pins a family's files by that prefix. */
  slug: string;
  package: string;
  version: string;
  license: 'OFL-1.1';
  weights: readonly number[];
  category: FontCategory;
  hebrew: boolean;
  /**
   * 'positioned' = the Hebrew file of every weight holds the 27 letters, the 16 vowel points (U+05B0–05BC, 05C1, 05C2, 05C7),
   * maqaf, geresh, gershayim and the sheqel sign, and its GPOS has the `mark` feature, proved for the row by
   * apps/web/src/fonts.glyphs.test.ts (never asserted by hand). Absent = not measured.
   */
  nikud?: 'positioned';
  /** What the face looks like, for the font picker's chips. */
  tags?: readonly FontTag[];
}
const BASE_FONTS: readonly FontEntry[] = [
  { family: 'Heebo', slug: 'heebo', package: '@fontsource/heebo', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true, nikud: 'positioned' },
  { family: 'Rubik', slug: 'rubik', package: '@fontsource/rubik', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true, nikud: 'positioned' },
  { family: 'Assistant', slug: 'assistant', package: '@fontsource/assistant', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true, nikud: 'positioned' },
  { family: 'Frank Ruhl Libre', slug: 'frank-ruhl-libre', package: '@fontsource/frank-ruhl-libre', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'serif', hebrew: true, nikud: 'positioned' },
  { family: 'Secular One', slug: 'secular-one', package: '@fontsource/secular-one', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'display', hebrew: true, nikud: 'positioned' },
];
/**
 * Title families of the content packs (see the header). Licences read on 2026-11-17 in each
 * package's LICENSE (the SIL OFL 1.1 text; none of these reserves its own name) and at the publishers the plan lists.
 * - Fredoka: the designer's own repository answered 404, so its licence rests on the package's LICENSE and Google Fonts'
 *   OFL.txt. Flagged for the owner.
 * - Karantina: the same package the interface already bundles (apps/web/src/ds/uiFonts.css). As a title font its files must
 *   be emitted once: the lead checks that with check:notices when the rows go live.
 * `nikud: 'positioned'` is set on a row only because apps/web/src/fonts.glyphs.test.ts measured it.
 * The lead accepted these families under the owner's standing direction (.artifacts/wave5-decisions.md, 2026-11-17).
 */
export const TITLE_FONT_ROWS: readonly FontEntry[] = [
  { family: 'Suez One', slug: 'suez-one', package: '@fontsource/suez-one', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'display', hebrew: true, nikud: 'positioned', tags: ['bold'] },
  { family: 'David Libre', slug: 'david-libre', package: '@fontsource/david-libre', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'serif', hebrew: true, nikud: 'positioned', tags: ['classic'] },
  { family: 'Karantina', slug: 'karantina', package: '@fontsource/karantina', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'display', hebrew: true, nikud: 'positioned', tags: ['condensed'] },
  { family: 'Amatic SC', slug: 'amatic-sc', package: '@fontsource/amatic-sc', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'handwriting', hebrew: true, nikud: 'positioned', tags: ['playful'] },
  { family: 'Fredoka', slug: 'fredoka', package: '@fontsource/fredoka', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true, nikud: 'positioned', tags: ['rounded', 'playful'] },
  { family: 'Gveret Levin', slug: 'gveret-levin', package: '@fontsource/gveret-levin', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'handwriting', hebrew: true, nikud: 'positioned', tags: ['cursive'] },
];
/**
 * Families of the plan that are NOT pinned: they wait for the owner. Both are OFL 1.1 and are published with their own
 * names reserved, and the files a build would ship are Google Fonts' subsets under those names; none of the bundled families
 * has such a clause, so there is no precedent in this project.
 */
export const HELD_TITLE_FONTS: readonly { family: string; package: string; version: string; reason: string }[] = [
  { family: 'Alef', package: '@fontsource/alef', version: '5.3.0', reason: 'OFL-1.1 with Reserved Font Name "Alef" (upstream OFL.txt; the package LICENSE drops that line). Held until the owner decides whether subset files under a reserved name may ship.' },
  { family: 'Varela Round', package: '@fontsource/varela-round', version: '5.3.0', reason: 'OFL-1.1 with Reserved Font Names "Varela" and "Varela Round". Held until the owner decides whether subset files under a reserved name may ship.' },
];
/** The families preview, stills and export can draw: the first five and the title fonts of the content packs. */
export const FONT_CATALOG: readonly FontEntry[] = [...BASE_FONTS, ...TITLE_FONT_ROWS];
export const findFont = (family: string) => FONT_CATALOG.find((f) => f.family === family);
/** The bundled weight actually used for a requested weight (nearest available; never synthesized silently). */
export const resolveWeight = (font: FontEntry, weight: number) => font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]!);
/** A heading family with a body family that suits it (fontPairs.ts FONT_PAIRS). Both are families of FONT_CATALOG at weights it bundles. */
export interface FontPair { heading: string; headingWeight: number; body: string; bodyWeight: number; note: { he: string; en: string } }
