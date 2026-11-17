/**
 * Interface fonts, bundled (no network). NOT canvas fonts: fonts.ts and FONT_CATALOG stay exactly as they are, so the
 * canvas and export text is deterministic. All three families are SIL OFL 1.1 (notices are emitted at build time).
 *  - IBM Plex Sans Hebrew 400/500/600/700: the UI (Hebrew + Latin subsets)
 *  - IBM Plex Mono 400/500: timecode and numbers (Latin)
 *  - Karantina 400/700: display moments only, at 28px and above (Hebrew + Latin)
 * Heebo (bundled by fonts.ts) is the fallback in --pf-font, so a failed face degrades gracefully.
 */

import './uiFonts.css';

export const UI_FONT_FAMILIES = ['IBM Plex Sans Hebrew', 'IBM Plex Mono', 'Karantina'] as const;
