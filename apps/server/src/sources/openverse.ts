/**
 * Openverse (wave 8 `sources`; providers OPENVERSE). Search `GET /v1/images/` and `/v1/audio/` with q, page, page_size and the
 * category / aspect filters only; one item `GET /v1/{images,audio}/<id>/`; the owner's client (optional) exchanges its id and
 * secret at `POST /v1/auth_tokens/token/` for a bearer token kept in memory. Field names from sources-research.md A1/A2 (the
 * project's own example answers); the deployed API was not readable (BLOCKERS S1). Openverse aggregates other hosts, so a file URL
 * of its answer is NOT bound to its API host (C10): the safe downloader's address floor checks it.
 * itemId = `image:<id>` or `audio:<id>` (the endpoint is part of the id).
 */
import { creditText, openverseLicence, OPENVERSE } from '@pulseframe/providers';
import type { SourceKind } from '@pulseframe/core';
import { badAnswer, callJson, num, str, type SearchArgs, type ServiceAdapter, type ServiceCtx, type ServiceItem } from './service.ts';

const WINDOW = OPENVERSE.limits[0]!.perSeconds;
type Media = 'images' | 'audio';
const mediaOf = (kind: SourceKind | undefined): Media => (kind === 'music' || kind === 'sound' ? 'audio' : 'images');
const CATEGORY: Partial<Record<SourceKind, string>> = { photo: 'photograph', illustration: 'illustration', music: 'music', sound: 'sound_effect' };

function itemOf(media: Media, r: Record<string, unknown>): ServiceItem | null {
  const id = str(r.id), url = str(r.url);
  if (!id || !url) return null;
  const licence = openverseLicence(String(r.license ?? ''), str(r.license_version), str(r.license_url));
  const title = (str(r.title) ?? '').slice(0, 200);
  const author = str(r.creator);
  const pageUrl = str(r.foreign_landing_url);
  const category = str(r.category);
  const kind: SourceKind = media === 'audio' ? (category === 'music' ? 'music' : 'sound') : category === 'illustration' || category === 'digitized_artwork' ? 'illustration' : 'photo';
  const ms = num(r.duration);
  const ext = str(r.filetype);
  return {
    provider: 'openverse', itemId: `${media === 'audio' ? 'audio' : 'image'}:${id}`, kind, title, author, pageUrl,
    durationSeconds: media === 'audio' && ms !== null ? ms / 1000 : null, width: num(r.width), height: num(r.height),
    licence, credit: creditText('openverse', { title, author, attribution: str(r.attribution), licenceName: licence.name, pageUrl }, 'en'), terms: [...OPENVERSE.terms],
    renditions: [{ id: 'original', url, width: num(r.width), height: num(r.height), bytes: num(r.filesize) }],
    previewUrl: media === 'audio' ? url : str(r.thumbnail) ?? url, thumbUrl: str(r.thumbnail),
    ext: ext && /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : null,
  };
}
const authOf = (ctx: ServiceCtx): Record<string, string> => (ctx.secret ? { authorization: `Bearer ${ctx.secret}` } : {});

export const openverse: ServiceAdapter = {
  async search(ctx, a: SearchArgs) {
    const media = mediaOf(a.kind);
    const p = new URLSearchParams({ q: a.q, page: String(a.page), page_size: '20' });
    if (a.kind && CATEGORY[a.kind]) p.set('category', CATEGORY[a.kind]!);
    if (media === 'images' && a.orientation) p.set('aspect_ratio', a.orientation === 'vertical' ? 'tall' : 'wide');
    const body = await callJson(ctx, `${ctx.baseUrl}/v1/${media}/?${p}`, { headers: authOf(ctx), windowSeconds: WINDOW }) as Record<string, unknown> | null;
    if (!body || !Array.isArray(body.results)) throw badAnswer('openverse search');
    const items = (body.results as Record<string, unknown>[]).map((r) => itemOf(media, r)).filter((x): x is ServiceItem => !!x);
    const pageCount = num(body.page_count);
    return { items, total: num(body.result_count), next: pageCount !== null && a.page < pageCount ? a.page + 1 : null };
  },
  async item(ctx, itemId) {
    const m = /^(image|audio):([A-Za-z0-9-]{1,100})$/.exec(itemId);
    if (!m) return null;
    const media: Media = m[1] === 'audio' ? 'audio' : 'images';
    const body = await callJson(ctx, `${ctx.baseUrl}/v1/${media}/${m[2]}/`, { headers: authOf(ctx), windowSeconds: WINDOW }) as Record<string, unknown> | null;
    return body ? itemOf(media, body) : null;
  },
};

/** The owner's client → a bearer token (client credentials). A refused client is provider_key_rejected. */
export async function openverseToken(ctx: ServiceCtx, client: { clientId: string; clientSecret: string }): Promise<{ token: string; expiresInSeconds: number }> {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: client.clientId, client_secret: client.clientSecret }).toString();
  const r = await callJson({ ...ctx, secret: null }, `${ctx.baseUrl}/v1/auth_tokens/token/`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, windowSeconds: WINDOW }) as Record<string, unknown> | null;
  const token = str(r?.access_token);
  if (!token) throw badAnswer('openverse token');
  return { token, expiresInSeconds: num(r?.expires_in) ?? 3600 };
}
