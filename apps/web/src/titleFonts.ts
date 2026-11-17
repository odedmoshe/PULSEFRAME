/**
 * The CSS imports of the title fonts the content packs bring (ADR-0022; core fonts.ts TITLE_FONT_ROWS): exactly the hebrew and
 * latin file of every weight of every row, the same per-subset files as fonts.ts imports for the catalogue.
 *
 * Imported by fonts.ts, so every page that draws text loads them: the editor, the render worker's page and the browser export all
 * call ensureFonts (fonts.ts), which fails loudly for a catalogue face without a loaded file, and the export manifest pins the
 * files by SHA-256. The rows are in FONT_CATALOG (core fonts.ts) because apps/web/src/fonts.glyphs.test.ts proved them.
 * Karantina: the interface already loads the same woff2 files (ds/uiFonts.css points at the same files), so the bundle emits
 * each file once; check:notices confirms it.
 * apps/web/src/fonts.imports.test.ts (W2) holds this list equal to the rows.
 */
import '@fontsource/suez-one/hebrew-400.css';
import '@fontsource/suez-one/latin-400.css';
import '@fontsource/david-libre/hebrew-400.css';
import '@fontsource/david-libre/hebrew-700.css';
import '@fontsource/david-libre/latin-400.css';
import '@fontsource/david-libre/latin-700.css';
import '@fontsource/karantina/hebrew-400.css';
import '@fontsource/karantina/hebrew-700.css';
import '@fontsource/karantina/latin-400.css';
import '@fontsource/karantina/latin-700.css';
import '@fontsource/amatic-sc/hebrew-400.css';
import '@fontsource/amatic-sc/hebrew-700.css';
import '@fontsource/amatic-sc/latin-400.css';
import '@fontsource/amatic-sc/latin-700.css';
import '@fontsource/fredoka/hebrew-400.css';
import '@fontsource/fredoka/hebrew-700.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/gveret-levin/hebrew-400.css';
import '@fontsource/gveret-levin/latin-400.css';

/** The families this file loads (equal to TITLE_FONT_ROWS; fonts.imports.test.ts checks it). */
export const TITLE_FONT_FAMILIES = ['Suez One', 'David Libre', 'Karantina', 'Amatic SC', 'Fredoka', 'Gveret Levin'] as const;
