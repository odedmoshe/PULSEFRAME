/**
 * Bundled font catalog (SPEC §15). The single list of families that preview and export can draw.
 * Every entry is an npm package pinned to an exact version whose licence file ships in the build's notices.
 * `hebrew: true` means the package declares a Hebrew subset AND the renderer verifies at start-up that a Hebrew
 * sample (letters + niqqud) resolves to this font rather than a fallback. It is not a typographic quality review.
 *
 * Title fonts of the content packs (ADR-0022) come in two steps, because a family may only be offered once every page that
 * draws text loads it (the editor, the render worker's page and the browser export all call ensureFonts, which fails loudly
 * for a catalogue face without a loaded file, and the export manifest pins the files by SHA-256):
 *   1. TITLE_FONT_ROWS below: families whose licence was read at the package, pinned at an exact version in
 *      apps/web/package.json, with their CSS imports listed in apps/web/src/titleFonts.ts. NOT offered yet.
 *   2. The lead moves the rows into FONT_CATALOG and imports titleFonts.ts from apps/web/src/fonts.ts in ONE commit, after the
 *      owner has approved the families by name (content-pack plan, ORDER 1) and after a browser run (ensureFonts,
 *      check:notices, proof:fonts). From then on preview, stills and export draw them alike.
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
export const FONT_CATALOG: readonly FontEntry[] = [
  { family: 'Heebo', slug: 'heebo', package: '@fontsource/heebo', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true },
  { family: 'Rubik', slug: 'rubik', package: '@fontsource/rubik', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true },
  { family: 'Assistant', slug: 'assistant', package: '@fontsource/assistant', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true },
  { family: 'Frank Ruhl Libre', slug: 'frank-ruhl-libre', package: '@fontsource/frank-ruhl-libre', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'serif', hebrew: true },
  { family: 'Secular One', slug: 'secular-one', package: '@fontsource/secular-one', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'display', hebrew: true },
];
/**
 * Title families pinned for the content packs and NOT offered yet (step 1 of the header). Licences read on 2026-11-17 in each
 * package's LICENSE (the SIL OFL 1.1 text; none of these reserves its own name) and at the publishers the plan lists.
 * - Fredoka: the designer's own repository answered 404, so its licence rests on the package's LICENSE and Google Fonts'
 *   OFL.txt. Flagged for the owner.
 * - Karantina: the same package the interface already bundles (apps/web/src/ds/uiFonts.css). As a title font its files must
 *   be emitted once: the lead checks that with check:notices when the rows go live.
 * `nikud` is left out until apps/web/src/fonts.glyphs.test.ts has measured the row.
 * The owner's approval of these families by name is NOT recorded yet (the wave-5 approvals cover people, the holiday symbols
 * and phone drop). The pins are inert until it is: nothing imports titleFonts.ts and check:notices reads FONT_CATALOG only.
 * Without that approval the rows must not go live; should the owner say no, the pins come out with their rows.
 */
export const TITLE_FONT_ROWS: readonly FontEntry[] = [
  { family: 'Suez One', slug: 'suez-one', package: '@fontsource/suez-one', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'display', hebrew: true, tags: ['bold'] },
  { family: 'David Libre', slug: 'david-libre', package: '@fontsource/david-libre', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'serif', hebrew: true, tags: ['classic'] },
  { family: 'Karantina', slug: 'karantina', package: '@fontsource/karantina', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'display', hebrew: true, tags: ['condensed'] },
  { family: 'Amatic SC', slug: 'amatic-sc', package: '@fontsource/amatic-sc', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'handwriting', hebrew: true, tags: ['playful'] },
  { family: 'Fredoka', slug: 'fredoka', package: '@fontsource/fredoka', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true, tags: ['rounded', 'playful'] },
  { family: 'Gveret Levin', slug: 'gveret-levin', package: '@fontsource/gveret-levin', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'handwriting', hebrew: true, tags: ['cursive'] },
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
export const findFont = (family: string) => FONT_CATALOG.find((f) => f.family === family);
/** The bundled weight actually used for a requested weight (nearest available; never synthesized silently). */
export const resolveWeight = (font: FontEntry, weight: number) => font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]!);
/** A heading family with a body family that suits it (fontPairs.ts FONT_PAIRS). Both are families of FONT_CATALOG at weights it bundles. */
export interface FontPair { heading: string; headingWeight: number; body: string; bodyWeight: number; note: { he: string; en: string } }
