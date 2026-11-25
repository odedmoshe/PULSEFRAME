/**
 * The elements drawer (wave 7 library track): tabs «מובנים» (the built-in elements, ElementsBrowser unchanged) / «מהספרייה»
 * (stickers, icons, illustrations, textures and backdrops, video of the owner's library; server PNG thumbnails only — third-party
 * SVG never reaches the browser). WORKER C builds the tabs; until then this is the built-in browser exactly as before.
 */
import { ElementsBrowser } from '../ElementsBrowser.tsx';

export function LibraryElementsDrawer() {
  return <ElementsBrowser />;
}
