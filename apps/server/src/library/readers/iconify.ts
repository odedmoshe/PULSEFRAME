/**
 * iconify: collections.json names each set's licence; only sets whose SPDX id is in core ICON_SET_LICENCES are read, never the
 * prefixes of ICON_SET_EXCLUDED (GPL, OFL, share-alike, non-commercial and no-derivatives sets are not indexed at all). Each
 * admitted set's json/<prefix>.json is parsed one at a time (cap MAX_METADATA_BYTES) and gives one icon row per visible icon,
 * with the set's own licence and, where it needs one, the credit `<set name> by <author> — <licence title> (<licence url>)`.
 */
import { ICON_SET_EXCLUDED, ICON_SET_LICENCES } from '@pulseframe/core';
import { MAX_METADATA_BYTES } from '../contract.ts';
import { cut, type Reader } from './types.ts';

interface SetInfo { name?: unknown; author?: { name?: unknown; url?: unknown }; license?: { title?: unknown; spdx?: unknown; url?: unknown }; category?: unknown; hidden?: unknown }
export const ICON_PREFIX = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function admittedSets(collections: Record<string, SetInfo>): string[] {
  return Object.keys(collections).filter((p) => ICON_PREFIX.test(p) && !(ICON_SET_EXCLUDED as readonly string[]).includes(p)
    && (ICON_SET_LICENCES as readonly string[]).includes(String(collections[p]?.license?.spdx ?? ''))).sort();
}
export const iconify: Reader = {
  id: 'iconify',
  async rows(ctx, emit) {
    const cb = await ctx.read('collections.json', MAX_METADATA_BYTES);
    if (!cb) return ctx.problem(`${ctx.entry.item}: collections.json could not be read`);
    let collections: Record<string, SetInfo>;
    try { collections = JSON.parse(cb.toString('utf8')); } catch { return ctx.problem(`${ctx.entry.item}: collections.json is not JSON`); }
    if (!collections || typeof collections !== 'object') return;
    for (const prefix of admittedSets(collections)) {
      if (ctx.cancelled()) return;
      const info = collections[prefix]!;
      const rel = `json/${prefix}.json`;
      const st = await ctx.stat(rel);
      const b = st ? await ctx.read(rel, MAX_METADATA_BYTES) : null;
      if (!st || !b) { ctx.problem(`${ctx.entry.item}: ${rel} could not be read`); continue; }
      let set: { icons?: Record<string, { body?: unknown; width?: unknown; height?: unknown; hidden?: unknown }>; width?: unknown; height?: unknown; categories?: Record<string, unknown> };
      try { set = JSON.parse(b.toString('utf8')); } catch { ctx.problem(`${ctx.entry.item}: ${rel} is not JSON`); continue; }
      const setName = cut(info.name) || prefix, author = cut(info.author?.name);
      const spdx = String(info.license?.spdx), url = cut(info.license?.url, 500);
      const credit = spdx.startsWith('CC-BY') ? (author ? `${setName} by ${author} — ${cut(info.license?.title) || spdx}${url ? ` (${url})` : ''}`.slice(0, 500) : null) : null;
      const cats = new Map<string, string[]>();
      for (const [cat, names] of Object.entries(set.categories ?? {})) if (Array.isArray(names)) for (const n of names) if (typeof n === 'string') cats.set(n, [...(cats.get(n) ?? []), cut(cat, 64)]);
      const icons = set.icons && typeof set.icons === 'object' ? set.icons : {};
      for (const name of Object.keys(icons).sort()) {
        const icon = icons[name]!;
        if (!icon || typeof icon.body !== 'string' || icon.hidden === true || !ICON_PREFIX.test(name)) continue;
        const w = Number(icon.width ?? set.width ?? 16), h = Number(icon.height ?? set.height ?? 16);
        await emit({
          rel, member: name, kind: 'icon', title: name.replace(/-/g, ' '), ...(author ? { author } : {}),
          licence: { spdx, ...(url ? { url } : {}) }, credit,
          meta: { genre: [], mood: [], instruments: [], tags: [setName, ...(cats.get(name) ?? [])], ...(Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : {}) },
          words: [prefix, setName, ...(cats.get(name) ?? [])], bytes: st.size, mtimeMs: st.mtimeMs, format: 'svg',
        });
      }
    }
  },
};
