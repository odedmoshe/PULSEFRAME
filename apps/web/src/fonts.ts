/**
 * Bundled, pinned text fonts. Canvas text only uses a web font once it is loaded, so every
 * renderer (preview and export) must await this before drawing: otherwise output would silently
 * fall back to a system font and differ between machines.
 * The CSS imports below must list exactly the files of FONT_CATALOG (checked at start-up).
 */
import '@fontsource/heebo/hebrew-400.css';
import '@fontsource/heebo/hebrew-700.css';
import '@fontsource/heebo/latin-400.css';
import '@fontsource/heebo/latin-700.css';
import '@fontsource/rubik/hebrew-400.css';
import '@fontsource/rubik/hebrew-700.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/assistant/hebrew-400.css';
import '@fontsource/assistant/hebrew-700.css';
import '@fontsource/assistant/latin-400.css';
import '@fontsource/assistant/latin-700.css';
import '@fontsource/frank-ruhl-libre/hebrew-400.css';
import '@fontsource/frank-ruhl-libre/hebrew-700.css';
import '@fontsource/frank-ruhl-libre/latin-400.css';
import '@fontsource/frank-ruhl-libre/latin-700.css';
import '@fontsource/secular-one/hebrew-400.css';
import '@fontsource/secular-one/latin-400.css';
import { FONT_CATALOG } from '@pulseframe/core';

const HEBREW = 'אבגדהוזחטיכלמנסעפצקרשת בְּרֵאשִׁית';
const LATIN = 'ABC abc 0123';
/** Load every catalog face and fail loudly if any is missing, so no frame is ever drawn with a fallback font. */
export async function ensureFonts(): Promise<void> {
  const missing: string[] = [];
  await Promise.all(FONT_CATALOG.flatMap((f) => f.weights.map(async (w) => {
    const spec = `${w} 32px "${f.family}"`;
    const [he, la] = await Promise.all([document.fonts.load(spec, HEBREW), document.fonts.load(spec, LATIN)]);
    if ((f.hebrew && he.length === 0) || la.length === 0 || !document.fonts.check(spec, `${HEBREW} ${LATIN}`)) missing.push(spec);
  })));
  if (missing.length) throw new Error(`bundled fonts failed to load: ${missing.join(', ')}`);
}
