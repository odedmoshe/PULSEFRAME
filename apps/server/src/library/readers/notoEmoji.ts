/** noto-emoji: `emoji_u<hex>[_<hex>…].svg` → code points → CLDR Hebrew and English words; title from the CLDR short name. SVG: listed only where a rasteriser exists. */
import { walk, type Reader } from './types.ts';

export const NOTO_NAME = /^emoji_u([0-9a-f]{2,6}(?:_[0-9a-f]{2,6}){0,9})\.svg$/i;
export const notoEmoji: Reader = {
  id: 'noto-emoji',
  async rows(ctx, emit) {
    await walk(ctx, '', async (rel, name) => {
      const m = NOTO_NAME.exec(name);
      if (!m) return;
      const unicode = m[1]!.toLowerCase().split('_').filter((h) => h !== 'fe0f').map((h) => parseInt(h, 16).toString(16)).join('_');
      const st = await ctx.stat(rel);
      if (!st) return;
      const w = ctx.shared.cldr.get(unicode);
      const title = w?.ttsEn ?? w?.en[0] ?? `emoji ${unicode.split('_').map((h) => `U+${h.toUpperCase()}`).join(' ')}`;
      await emit({ rel, kind: 'sticker', title: title.slice(0, 200), meta: { genre: [], mood: [], instruments: [], tags: [], unicode }, words: w ? [...w.he, ...w.en, ...(w.ttsHe ? [w.ttsHe] : [])] : [], bytes: st.size, mtimeMs: st.mtimeMs, format: 'svg' });
    });
  },
};
