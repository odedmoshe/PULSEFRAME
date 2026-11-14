/**
 * Bundled font catalog (SPEC §15). The single list of families that preview and export can draw.
 * Every entry is an npm package pinned to an exact version whose licence file ships in the build's notices.
 * `hebrew: true` means the package declares a Hebrew subset AND the renderer verifies at start-up that a Hebrew
 * sample (letters + niqqud) resolves to this font rather than a fallback. It is not a typographic quality review.
 */
export interface FontEntry {
  family: string;
  /** File-name prefix of the emitted font files (`<slug>-hebrew-400-normal.woff2`). */
  slug: string;
  package: string;
  version: string;
  license: 'OFL-1.1';
  weights: readonly number[];
  category: 'sans' | 'serif' | 'display';
  hebrew: boolean;
}
export const FONT_CATALOG: readonly FontEntry[] = [
  { family: 'Heebo', slug: 'heebo', package: '@fontsource/heebo', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true },
  { family: 'Rubik', slug: 'rubik', package: '@fontsource/rubik', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true },
  { family: 'Assistant', slug: 'assistant', package: '@fontsource/assistant', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'sans', hebrew: true },
  { family: 'Frank Ruhl Libre', slug: 'frank-ruhl-libre', package: '@fontsource/frank-ruhl-libre', version: '5.3.0', license: 'OFL-1.1', weights: [400, 700], category: 'serif', hebrew: true },
  { family: 'Secular One', slug: 'secular-one', package: '@fontsource/secular-one', version: '5.3.0', license: 'OFL-1.1', weights: [400], category: 'display', hebrew: true },
];
export const findFont = (family: string) => FONT_CATALOG.find((f) => f.family === family);
/** The bundled weight actually used for a requested weight (nearest available; never synthesized silently). */
export const resolveWeight = (font: FontEntry, weight: number) => font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]!);
