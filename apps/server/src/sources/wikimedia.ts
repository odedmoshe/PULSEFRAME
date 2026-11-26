/**
 * Wikimedia Commons (wave 8 `sources`; providers WIKIMEDIA). MediaWiki Action API `GET /w/api.php?action=query&generator=search&
 * gsrnamespace=6&gsrsearch=<words> filetype:<type>&prop=imageinfo&iiprop=url|size|mime|mediatype|extmetadata` (sources-research.md
 * A1; https://www.mediawiki.org/wiki/API:Imageinfo); one item with `pageids=`. No key: every request carries the contact line the
 * owner typed, in the User-Agent its policy asks for (userAgentFor); without one the runtime answers provider_contact_missing and
 * sends nothing. Artist and Credit are HTML in the API: read as text (map.ts htmlToText), never rendered.
 * itemId = the file page's numeric id.
 */
import { commonsLicence, creditText, WIKIMEDIA } from '@pulseframe/providers';
import type { SourceKind } from '@pulseframe/core';
import { badAnswer, callJson, num, str, type SearchArgs, type ServiceAdapter, type ServiceCtx, type ServiceItem } from './service.ts';

const WINDOW = WIKIMEDIA.limits[0]!.perSeconds;
const FILETYPE: Record<SourceKind, string> = { photo: 'bitmap', illustration: 'drawing', video: 'video', sound: 'audio', music: 'audio' };
const IIPROP = 'url|size|mime|mediatype|extmetadata';

function itemOf(page: Record<string, unknown>, asked?: SourceKind): ServiceItem | null {
  const pageid = num(page.pageid);
  const info = Array.isArray(page.imageinfo) ? (page.imageinfo as Record<string, unknown>[])[0] : undefined;
  const url = str(info?.url);
  if (pageid === null || !info || !url) return null;
  const mediatype = String(info.mediatype ?? '').toUpperCase();
  const mime = String(info.mime ?? '');
  const kind: SourceKind = mediatype === 'VIDEO' || mime.startsWith('video/') ? 'video' : mediatype === 'AUDIO' || mime.startsWith('audio/') ? (asked === 'music' ? 'music' : 'sound') : mediatype === 'DRAWING' ? 'illustration' : 'photo';
  const lic = commonsLicence((info.extmetadata ?? {}) as Record<string, { value?: unknown }>);
  const title = (str(page.title) ?? `File ${pageid}`).replace(/^File:/, '').slice(0, 200);
  const pageUrl = str(info.descriptionurl);
  const credit = lic.credit ?? (lic.author ? creditText('wikimedia', { title, author: lic.author, licenceName: lic.name, pageUrl }, 'en') : null);
  const m = /\.([a-z0-9]{2,5})$/i.exec(url.split('?')[0]!);
  return {
    provider: 'wikimedia', itemId: String(pageid), kind, title, author: lic.author, pageUrl,
    durationSeconds: num(info.duration), width: num(info.width) || null, height: num(info.height) || null,
    licence: { id: lic.id, name: lic.name, url: lic.url, from: lic.from }, credit, terms: [...WIKIMEDIA.terms],
    renditions: [{ id: 'original', url, width: num(info.width) || null, height: num(info.height) || null, bytes: num(info.size) || null }],
    previewUrl: kind === 'photo' || kind === 'illustration' ? str(info.thumburl) ?? url : url, thumbUrl: str(info.thumburl),
    ext: m ? m[1]!.toLowerCase() : null,
  };
}
const pagesOf = (body: Record<string, unknown> | null) => Object.values(((body?.query as Record<string, unknown> | undefined)?.pages ?? {}) as Record<string, Record<string, unknown>>);

export const wikimedia: ServiceAdapter = {
  async search(ctx: ServiceCtx, a: SearchArgs) {
    const words = a.kind ? `${a.q} filetype:${FILETYPE[a.kind]}` : a.q;
    const p = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: words, gsrlimit: '20', gsroffset: String((a.page - 1) * 20), prop: 'imageinfo', iiprop: IIPROP, iiurlwidth: '320' });
    const body = await callJson(ctx, `${ctx.baseUrl}/w/api.php?${p}`, { windowSeconds: WINDOW }) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') throw badAnswer('commons search');
    const items = pagesOf(body).sort((x, y) => (num(x.index) ?? 0) - (num(y.index) ?? 0)).map((pg) => itemOf(pg, a.kind)).filter((x): x is ServiceItem => !!x);
    const more = (body.continue as Record<string, unknown> | undefined)?.gsroffset !== undefined;
    return { items, total: null, next: more ? a.page + 1 : null };
  },
  async item(ctx, itemId) {
    if (!/^\d{1,15}$/.test(itemId)) return null;
    const p = new URLSearchParams({ action: 'query', format: 'json', pageids: itemId, prop: 'imageinfo', iiprop: IIPROP, iiurlwidth: '320' });
    const body = await callJson(ctx, `${ctx.baseUrl}/w/api.php?${p}`, { windowSeconds: WINDOW }) as Record<string, unknown> | null;
    const page = pagesOf(body)[0];
    return page ? itemOf(page) : null;
  },
};
