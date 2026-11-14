/**
 * Bundled, pinned text fonts. Canvas text only uses a web font once it is loaded, so every
 * renderer (preview and export) must await this before drawing: otherwise output would silently
 * fall back to a system font and differ between machines.
 */
import '@fontsource/heebo/hebrew-400.css';
import '@fontsource/heebo/hebrew-700.css';
import '@fontsource/heebo/latin-400.css';
import '@fontsource/heebo/latin-700.css';

const SAMPLE = 'אבגדהוזחטיכלמנסעפצקרשת בְּרֵאשִׁית ABC abc 0123';
export async function ensureFonts(): Promise<void> {
  const loaded = await Promise.all([document.fonts.load('400 32px "Heebo"', SAMPLE), document.fonts.load('700 32px "Heebo"', SAMPLE)]);
  if (loaded.some((l) => l.length === 0) || !document.fonts.check('700 32px "Heebo"', SAMPLE)) throw new Error('bundled font Heebo failed to load');
}
