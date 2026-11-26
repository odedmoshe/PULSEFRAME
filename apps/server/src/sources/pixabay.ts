/**
 * Pixabay (wave 8 `sources`; providers PIXABAY). `GET /api/` (photos, illustrations) and `GET /api/videos/` with the owner's key,
 * q, lang, image_type, orientation, page, per_page; one item with `id=`. Field names from https://pixabay.com/api/docs/ (read
 * 2026-11-26, sources-research.md A1). Its answers name no licence: the record carries the descriptor's fixed row
 * (`provider:pixabay`, unconfirmed: the licence page could not be read) and its term rows; the credit is a courtesy line, not due.
 * The key travels in the query (Pixabay's form): a URL of these calls is never logged or stored; errors carry no URL.
 * itemId = `photo:<id>` (pictures) or `video:<id>`. Video renditions large/medium/small/tiny with their bytes.
 */
import { creditText, PIXABAY } from '@pulseframe/providers';
import type { SourceKind } from '@pulseframe/core';
import { badAnswer, callJson, num, str, type Rendition, type SearchArgs, type ServiceAdapter, type ServiceCtx, type ServiceItem } from './service.ts';

const WINDOW = PIXABAY.limits[0]!.perSeconds;
const FIXED = PIXABAY.licence.mode === 'fixed' ? PIXABAY.licence : null;
const extOf = (url: string | null) => { try { const m = url ? /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname) : null; return m ? m[1]!.toLowerCase() : null; } catch { return null; } };

function itemOf(video: boolean, r: Record<string, unknown>): ServiceItem | null {
  const id = num(r.id);
  if (id === null) return null;
  const author = str(r.user);
  const title = (str(r.tags) ?? `Pixabay ${id}`).slice(0, 200);
  const pageUrl = str(r.pageURL);
  const licence = { id: FIXED!.id, name: FIXED!.name, url: FIXED!.url, from: 'provider' as const };
  const credit = creditText('pixabay', { title, author, licenceName: licence.name, pageUrl }, 'en');
  let renditions: Rendition[] = [], kind: SourceKind, preview: string | null, thumb: string | null;
  if (video) {
    const v = (r.videos ?? {}) as Record<string, Record<string, unknown> | undefined>;
    renditions = (['large', 'medium', 'small', 'tiny'] as const).flatMap((k) => { const x = v[k]; const url = str(x?.url); return url ? [{ id: k, url, width: num(x?.width), height: num(x?.height), bytes: num(x?.size) || null }] : []; });
    kind = 'video';
    preview = str(v.tiny?.url) ?? renditions.at(-1)?.url ?? null;
    thumb = str(v.tiny?.thumbnail) ?? str(v.small?.thumbnail);
  } else {
    const large = str(r.largeImageURL) ?? str(r.webformatURL);
    if (large) renditions = [{ id: 'large', url: large, width: num(r.imageWidth), height: num(r.imageHeight), bytes: num(r.imageSize) || null }];
    kind = r.type === 'illustration' || r.type === 'vector/svg' ? 'illustration' : 'photo';
    preview = str(r.webformatURL) ?? large;
    thumb = str(r.previewURL);
  }
  if (!renditions.length) return null;
  return {
    provider: 'pixabay', itemId: `${video ? 'video' : 'photo'}:${id}`, kind, title, author, pageUrl,
    durationSeconds: video ? num(r.duration) : null, width: renditions[0]!.width, height: renditions[0]!.height,
    licence, credit, terms: [...PIXABAY.terms], renditions, previewUrl: preview, thumbUrl: thumb, ext: extOf(renditions[0]!.url),
  };
}
const base = (ctx: ServiceCtx, video: boolean, p: URLSearchParams) => { p.set('key', ctx.secret ?? ''); return `${ctx.baseUrl}/api/${video ? 'videos/' : ''}?${p}`; };

export const pixabay: ServiceAdapter = {
  async search(ctx, a: SearchArgs) {
    const video = a.kind === 'video';
    const p = new URLSearchParams({ q: a.q, page: String(a.page), per_page: '20' });
    if (a.lang) p.set('lang', a.lang);
    if (!video) { p.set('image_type', a.kind === 'illustration' ? 'illustration' : 'photo'); if (a.orientation) p.set('orientation', a.orientation); }
    const body = await callJson(ctx, base(ctx, video, p), { windowSeconds: WINDOW }) as Record<string, unknown> | null;
    if (!body || !Array.isArray(body.hits)) throw badAnswer('pixabay search');
    const items = (body.hits as Record<string, unknown>[]).map((r) => itemOf(video, r)).filter((x): x is ServiceItem => !!x);
    const totalHits = num(body.totalHits);
    return { items, total: num(body.total), next: totalHits !== null && a.page * 20 < totalHits ? a.page + 1 : null };
  },
  async item(ctx, itemId) {
    const m = /^(photo|video):(\d{1,15})$/.exec(itemId);
    if (!m) return null;
    const video = m[1] === 'video';
    const body = await callJson(ctx, base(ctx, video, new URLSearchParams({ id: m[2]! })), { windowSeconds: WINDOW }) as Record<string, unknown> | null;
    const hit = Array.isArray(body?.hits) ? (body!.hits as Record<string, unknown>[])[0] : undefined;
    return hit ? itemOf(video, hit) : null;
  },
};
