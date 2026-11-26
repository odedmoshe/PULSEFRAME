/**
 * Pure, table-driven mappings of the services' answers to the source record (wave 8 `sources`, plan §4). SIGNATURES (lead); bodies
 * by W2 with unit tests over the research's example answers (sources-research.md A2), never a live call.
 *
 * - openverseLicence: Openverse `license` + `license_version` → an exact SPDX id (`by`→CC-BY-<v>, `by-nc-sa`→CC-BY-NC-SA-<v>,
 *   `cc0`→CC0-1.0, `pdm`→PDM-1.0); an unmapped value keeps the name verbatim with id 'unknown'.
 * - commonsLicence: Commons `extmetadata` (LicenseShortName, UsageTerms, Artist, AttributionRequired, Credit) → id, name, credit
 *   text (Artist is HTML in the API: stripped to text, never rendered), credit due when AttributionRequired is "true".
 * - creditText: Openverse's own `attribution` verbatim, cut to 500 characters keeping title, author and licence (tested); Pixabay
 *   the courtesy line «<user> מ־Pixabay» / "<user> on Pixabay" with due false; Commons from extmetadata.
 * - canonicalLink: http(s) only; lower-case host; fragment dropped; every query parameter dropped except a per-host allow-list;
 *   Dropbox `dl=0` → `dl=1` for the REQUEST only (never in pageUrl). itemId = first 32 hex of sha256(canonical) — the hash is the
 *   caller's (no crypto here: the web reads this file).
 *
 * Nothing here concludes anything about a licence: an id the patterns below do not match exactly is 'unknown' with the service's
 * own words kept as the name.
 */
export interface MappedLicence { id: string; name: string; url: string | null; from: 'item' | 'provider' | 'none' }

const CREDIT_MAX = 500;
const CC_CODES = new Set(['by', 'by-sa', 'by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd']);
const VERSION = /^\d\.\d$/;

/** Openverse `license` (lower-case code) and `license_version` → an exact id; anything else keeps its words with id 'unknown'. */
export function openverseLicence(license: string, version: string | null, url: string | null): MappedLicence {
  const code = (license ?? '').trim().toLowerCase();
  const v = (version ?? '').trim();
  const u = url && /^https?:\/\//i.test(url) ? url.slice(0, 500) : null;
  if (CC_CODES.has(code) && VERSION.test(v)) return { id: `CC-${code.toUpperCase()}-${v}`, name: `CC ${code.toUpperCase()} ${v}`, url: u, from: 'item' };
  if (code === 'cc0') return { id: 'CC0-1.0', name: 'CC0 1.0', url: u, from: 'item' };
  if (code === 'pdm') return { id: 'PDM-1.0', name: 'Public Domain Mark 1.0', url: u, from: 'item' };
  if (!code) return { id: 'unknown', name: '', url: u, from: 'none' };
  return { id: 'unknown', name: `${license}${v ? ` ${v}` : ''}`.slice(0, 200), url: u, from: 'item' };
}

/** HTML of the API (Artist, Credit) as plain text: tags dropped, the common entities decoded, white space folded. Never rendered. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => { const c = Number(n); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
const meta = (m: Record<string, { value?: unknown }>, k: string): string => { const v = Object.hasOwn(m, k) ? m[k]?.value : undefined; return typeof v === 'string' ? v : ''; };

/** Commons' short licence names as the API writes them ("CC BY-SA 4.0", "CC0", "Public domain") → an exact id, or 'unknown'. */
function commonsId(short: string): string {
  const s = short.trim();
  const cc = /^CC (BY(?:-NC)?(?:-SA|-ND)?) (\d\.\d)$/i.exec(s);
  if (cc && CC_CODES.has(cc[1]!.toLowerCase())) return `CC-${cc[1]!.toUpperCase()}-${cc[2]}`;
  if (/^CC0( 1\.0)?$/i.test(s)) return 'CC0-1.0';
  return 'unknown';
}
/** Commons `extmetadata` → licence, credit (when the file asks for attribution) and the author as text. */
export function commonsLicence(extmetadata: Record<string, { value?: unknown }>): MappedLicence & { credit: { text: string; due: boolean } | null; author: string | null } {
  const m = extmetadata ?? {};
  const short = htmlToText(meta(m, 'LicenseShortName'));
  const usage = htmlToText(meta(m, 'UsageTerms'));
  const urlRaw = meta(m, 'LicenseUrl').trim();
  const url = /^https?:\/\//i.test(urlRaw) ? urlRaw.slice(0, 500) : /^\/\//.test(urlRaw) ? `https:${urlRaw}`.slice(0, 500) : null;
  const author = htmlToText(meta(m, 'Artist')).slice(0, 200) || null;
  const name = (short || usage).slice(0, 200);
  const id = name ? commonsId(short) : 'unknown';
  const due = meta(m, 'AttributionRequired').trim().toLowerCase() === 'true';
  const creditWords = htmlToText(meta(m, 'Attribution')) || [author, name].filter(Boolean).join(', ');
  const credit = due || /^CC-BY/.test(id) ? { text: cut(creditWords || name || 'Wikimedia Commons', CREDIT_MAX), due: due || /^CC-BY/.test(id) } : null;
  return { id, name, url, from: name ? 'item' : 'none', credit, author };
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
/**
 * The credit line of one item. Openverse: its own attribution verbatim when it fits; else a shorter line that still names the title,
 * the author and the licence (the title is cut first). Pixabay: a courtesy line, not due. Commons: author, title, licence and page.
 */
export function creditText(provider: 'openverse' | 'pixabay' | 'wikimedia', item: { title: string; author: string | null; attribution?: string | null; licenceName: string; pageUrl: string | null }, lang: 'he' | 'en'): { text: string; due: boolean } | null {
  const title = item.title.trim(), author = (item.author ?? '').trim(), lic = item.licenceName.trim();
  if (provider === 'pixabay') {
    if (!author) return null;
    return { text: cut(lang === 'he' ? `${author} מ־Pixabay` : `${author} on Pixabay`, CREDIT_MAX), due: false };
  }
  if (provider === 'openverse') {
    const a = (item.attribution ?? '').trim();
    if (a && a.length <= CREDIT_MAX) return { text: a, due: true };
    const tail = `${author ? ` by ${author}` : ''}${lic ? ` is licensed under ${lic}` : ''}.`;
    const room = CREDIT_MAX - tail.length - 2;
    if (room < 1) return { text: cut(`${author}${lic ? `, ${lic}` : ''}`, CREDIT_MAX), due: true };
    return { text: `"${cut(title || 'Untitled', room)}"${tail}`, due: true };
  }
  const parts = [author, title, lic, item.pageUrl ?? ''].filter(Boolean);
  if (!parts.length) return null;
  return { text: cut(parts.join(', '), CREDIT_MAX), due: true };
}

export interface CanonicalLink { canonical: string; host: string; requestUrl: string; pageUrl: string }
/** Query parameters that name the file (not a token) and so stay in the canonical form, per host. Everything else is dropped. */
const KEEP_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'drive.google.com': ['id'],
  'drive.usercontent.google.com': ['id'],
};
const DROPBOX = /(^|\.)dropbox\.com$/;
/** A pasted link: http(s) only (anything else throws `link_not_http`). See the header for what each form keeps. */
export function canonicalLink(url: string): CanonicalLink {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw Object.assign(new Error('the link is not a web address'), { code: 'link_not_http' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('only http and https links can be imported'), { code: 'link_not_http' });
  if (!u.hostname) throw Object.assign(new Error('the link names no host'), { code: 'link_not_http' });
  const host = u.hostname.toLowerCase();
  const port = u.port ? `:${u.port}` : '';
  const keep = KEEP_PARAMS[host] ?? [];
  const kept = [...u.searchParams.entries()].filter(([k]) => keep.includes(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const q = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  const canonical = `${u.protocol}//${host}${port}${u.pathname}${q}`;
  const req = new URL(u.href);
  req.hash = '';
  if (DROPBOX.test(host)) req.searchParams.set('dl', '1'); // a share page answers HTML; dl=1 answers the file
  return { canonical, host, requestUrl: req.href, pageUrl: canonical.slice(0, 500) };
}
