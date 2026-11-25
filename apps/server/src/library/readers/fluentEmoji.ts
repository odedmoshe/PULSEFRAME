/**
 * fluent-emoji: each folder of assets/ holds metadata.json (keywords, group, unicode, tts) and a 3D PNG (256 px, RGBA): one
 * sticker row per 3D PNG (the default skin tone where there are several). The vector (Color SVG) path is out this wave.
 */
import { MAX_READ_BYTES } from '../contract.ts';
import { cut, cpKey, list, pngInfo, type Reader } from './types.ts';

export const fluentEmoji: Reader = {
  id: 'fluent-emoji',
  async rows(ctx, emit) {
    const top = (await ctx.list('assets')) ?? [];
    top.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const d of top) {
      if (ctx.cancelled()) return;
      if (d.type !== 'dir') continue;
      const base = `assets/${d.name}`;
      const metaBytes = await ctx.read(`${base}/metadata.json`, MAX_READ_BYTES);
      let meta: Record<string, unknown> = {};
      try { meta = metaBytes ? JSON.parse(metaBytes.toString('utf8')) : {}; } catch { ctx.problem(`${ctx.entry.item}: ${base}/metadata.json is not JSON`); }
      let dir3d = `${base}/3D`;
      let pngs = (await ctx.list(dir3d))?.filter((f) => f.type === 'file' && /\.png$/i.test(f.name));
      if (!pngs?.length) { dir3d = `${base}/Default/3D`; pngs = (await ctx.list(dir3d))?.filter((f) => f.type === 'file' && /\.png$/i.test(f.name)); }
      if (!pngs?.length) continue;
      const unicode = typeof meta.unicode === 'string' ? cpKey(meta.unicode.split(/\s+/).map((h) => parseInt(h, 16)).filter((n) => Number.isFinite(n))) : '';
      const words = ctx.shared.cldr.get(unicode);
      for (const f of pngs.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const rel = `${dir3d}/${f.name}`;
        const st = await ctx.stat(rel);
        const head = await ctx.head(rel, 4096);
        const info = head ? pngInfo(head) : null;
        if (!st || !info) continue;
        await emit({
          rel, kind: 'sticker', title: cut(meta.tts ?? meta.cldr) || d.name,
          meta: { genre: [], mood: [], instruments: [], tags: [...list(meta.keywords), ...list(meta.group)], ...(unicode ? { unicode } : {}), width: info.width, height: info.height, ...(info.animated ? { animated: true } : {}) },
          words: [d.name, ...(words ? [...words.he, ...words.en] : [])], bytes: st.size, mtimeMs: st.mtimeMs, format: 'png', ...(info.animated ? { animated: true as const } : {}),
        });
      }
    }
  },
};
