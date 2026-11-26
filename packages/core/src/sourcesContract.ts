/**
 * «מאגר» and «ייבוא מקישור» — stock sources and import from a direct link (wave 8 `sources`, part A of the lead's split).
 * Pre-pass contract (lead): the record kept on a fetched asset (`provenance.source`), limits, the op's arguments and refusals, the
 * route wire types, the API error and job failure tables (English here, Hebrew in packages/i18n/src/sources.ts HE_SOURCES), the term
 * rows quoted verbatim at their source, and pure-function SIGNATURES whose bodies the builders write. Imports only zod.
 *
 * Order of authority: the owner's decisions of 2026-11-26 (general-purpose editor; autonomy first, open by default) >
 * .artifacts/wave8/decisions.md «sources» > sources-verify.md (C1–C17) > sources-plan.md. So:
 * - Connecting a service is the consent; there is no approval step. Any credential that may edit searches, imports and places
 *   (C16: an agent may search, import and place). The ONLY owner-only routes store a credential (the owner types keys into the app).
 * - ONE licence rule (C14/C15): a licence finding is a WARNING that quotes the licence's own deed sentence (SOURCE_TERMS cc.*), never a
 *   refusal. Refusals remain only for data facts: a record weaker than its own licence id, a credit its licence names but the record
 *   lacks, a hash that does not match the bytes, an unknown sequence.
 * - Version 1 providers: Openverse (no key; the anonymous hourly limit shown as a number, C9; the owner may connect a client),
 *   Pixabay (the owner's key; video and photos), Wikimedia Commons (no key; the owner types the contact line its User-Agent policy
 *   asks for — the editor never invents one), and `link` (a direct media link through the safe downloader, C8).
 *   NOT in this track: YouTube publish, thumbnails, the folder destination (track `publish`), yt-dlp (track `engines`), Freesound.
 */
import { z } from 'zod';

/** The durable job of a fetch (provider item or link): download → import → place. */
export const SOURCE_JOB_TYPE = 'source_fetch' as const;
/** The internal op that brings fetched bytes in with their record. */
export const SOURCE_OP = 'use_source_item' as const;

/** Version 1 providers (descriptors in packages/providers/src/connectors/). `link` is a pasted direct link, not a service. */
export const SOURCE_PROVIDERS = ['openverse', 'pixabay', 'wikimedia', 'link'] as const;
export type SourceProviderId = (typeof SOURCE_PROVIDERS)[number];
/** Services that are searched (the link is not). */
export const SEARCHABLE_SOURCES = ['openverse', 'pixabay', 'wikimedia'] as const;
export type SearchableSourceId = (typeof SEARCHABLE_SOURCES)[number];
export const SOURCE_KINDS = ['video', 'photo', 'illustration', 'music', 'sound'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Limits (plan §3.4 with C6, C9, C11). Capacity and facts, not policy. */
export const SOURCES_LIMITS = {
  /** words of a search, as sent (Pixabay's own cap is 100) */ queryChars: 100,
  /** rows per answer page */ pageSize: 20, maxPage: 50,
  /** redirects followed by the safe downloader, each one checked again (C8) */ redirects: 5,
  headerTimeoutMs: 20_000, idleTimeoutMs: 30_000,
  /** the free space is checked again every this many bytes while downloading (C6) */ diskCheckEveryBytes: 64 * 1024 ** 2,
  /** a preview is streamed, never stored: at most this many bytes, through a handle that lives this long */ previewBytes: 32 * 1024 ** 2, previewHandleMs: 30 * 60_000,
  /** answers of a service are kept in memory (never on disk): Pixabay asks 24 h (its terms), the others 1 h (C9) */ cacheMsPixabay: 24 * 3_600_000, cacheMsDefault: 3_600_000,
  /** credit text kept on the record (a cut credit must still contain title, author and licence) */ creditChars: 500,
  /** a link as pasted */ linkChars: 4096,
} as const;
/**
 * The largest download (C6): the owner's setting (Settings › «חיבורים», or PF_SOURCES_MAX_BYTES) but NEVER above the import queue's
 * upload limit (cfg.maxUploadBytes, default 2 GiB), because the bytes go through `imports.receive`, which caps at that limit. The card
 * says so. Pure.
 */
export function sourcesMaxBytes(setting: number | null | undefined, maxUploadBytes: number): number {
  return setting && setting > 0 ? Math.min(setting, maxUploadBytes) : maxUploadBytes;
}

// ---------------------------------------------------------------- the record on the asset (schema.ts provenance.source)
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const T_ = z.literal(true).optional();
/** The same values as schema.ts CREDIT_PLACEMENTS (sourcesContracts.test.ts checks they agree; this file imports only zod). */
const PLACEMENTS = ['description', 'on_screen', 'either'] as const;
/**
 * Asset.provenance.source: where a fetched file came from and what its licence says. Written only by the internal op use_source_item
 * (sourceOps.ts), issued by the server after the bytes were stored and checked. Rules (validate.ts source_provenance, C5):
 * - origin 'upload' with no provenance.upload and no provenance.library beside it; or origin 'derived' with provenance.fitted (a song
 *   shortened by «התאמה לאורך» carries its one source's record, C4a);
 * - for origin 'upload': `'sha256:' + sha256` equals `conform?.originalContentHash ?? contentHash` (the bytes exactly as fetched);
 * - provider 'link' carries `link`, the other providers do not;
 * - the record is not weaker than its own licence id (libraryDuties.ts licenceFacts): a non-commercial id is flagged nonCommercial
 *   and notShareable, a share-alike id shareAlike, a no-derivatives id noDerivatives, an id the table does not know
 *   licenceUnconfirmed; a licence that names a credit has one, due. These are data facts (C14), not licence policy.
 * Bytes already present as a LIBRARY copy keep the library record; the source record is not attached (C5.1).
 * "Same record" compares without fetchedAt and byteSize (C5.2; sourceRecordKey).
 */
export const SourceRecordSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  /** the provider's id; for a link the first 32 hex of sha256(canonical URL) (providers connectors/map.ts canonicalLink) */
  itemId: z.string().min(1).max(200),
  kind: z.enum(SOURCE_KINDS),
  title: z.string().max(200),
  author: z.string().max(200).optional(),
  /** the landing page; never a key or a tokened query (query stripped except a per-host allow-list) */
  pageUrl: z.string().max(500).optional(),
  /** ISO UTC when the last byte arrived */
  fetchedAt: z.string().max(40),
  /** SHA-256 (hex, no prefix) of the bytes exactly as fetched */
  sha256: Hex64,
  byteSize: z.number().int().nonnegative(),
  licence: z.object({
    /** exact SPDX id when the item names one ('CC-BY-4.0', 'CC0-1.0', 'PDM-1.0'); else 'provider:<id>' or 'unknown' */
    id: z.string().min(1).max(80),
    /** the provider's own words, verbatim */
    name: z.string().max(200),
    url: z.string().max(500).optional(),
    /** the item's own answer, the provider's fixed row, or nothing stated */
    from: z.enum(['item', 'provider', 'none']),
  }).strict(),
  credit: z.object({ text: z.string().min(1).max(SOURCES_LIMITS.creditChars), placement: z.enum(PLACEMENTS), due: z.boolean() }).strict().optional(),
  flags: z.object({ nonCommercial: T_, noDerivatives: T_, shareAlike: T_, licenceUnconfirmed: T_, notShareable: T_, people: T_, aiGenerated: T_, siteTerms: T_ }).strict(),
  /** ids of SOURCE_TERMS rows that apply (shown on the asset and at export) */
  terms: z.array(z.string().regex(/^[a-z0-9_.-]{1,64}$/)).max(8).optional(),
  /** a pasted link: how it was fetched (`downloader` is reserved for the engines track's yt-dlp; this track writes `direct` only) */
  link: z.object({
    via: z.enum(['direct', 'downloader']),
    host: z.string().max(253),
    tool: z.object({ name: z.literal('yt-dlp'), version: z.string().max(40) }).strict().optional(),
    extractor: z.string().max(64).optional(),
    siteLicence: z.string().max(200).optional(),
  }).strict().optional(),
}).strict();
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
/** The record without fetchedAt and byteSize, canonical (sorted keys): two records are "the same" when their keys are equal (C5.2). */
export function sourceRecordKey(r: SourceRecord): string {
  const { fetchedAt: _f, byteSize: _b, ...rest } = r;
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(canon(rest));
}

// ---------------------------------------------------------------- term rows (verbatim, with the date read)
/**
 * Sentences of a service's terms or a licence's deed that the editor shows BESIDE the item, on the asset and at export, verbatim
 * with their link and the day they were read (`he` is a translation and is marked as one). Nothing here is the editor's legal
 * conclusion (C15). Quotes from .artifacts/wave8/sources-research.md (read 2026-11-26) and sources-verify.md C15 (CC deeds, read
 * 2026-11-26). A row whose page could not be read says so.
 */
export interface SourceTermRow { provider: string; quote: string; url: string; readOn: string; he: string; en: string }
export const SOURCE_TERMS: Readonly<Record<string, SourceTermRow>> = {
  'pixabay.show_source': { provider: 'pixabay', quote: 'If you make use of the API, show your users where the images and videos are from, whenever search results are displayed.', url: 'https://pixabay.com/api/docs/', readOn: '2026-11-26',
    he: 'Pixabay מבקשת להראות מאיפה התמונות והסרטונים בכל פעם שמוצגות תוצאות חיפוש (תרגום).', en: 'Pixabay asks that search results show where the pictures and videos come from.' },
  'pixabay.cache_24h': { provider: 'pixabay', quote: 'requests must be cached for 24 hours. Also, the API is made for real human requests; do not send lots of automated queries. Systematic mass downloads are not allowed.', url: 'https://pixabay.com/api/docs/', readOn: '2026-11-26',
    he: 'Pixabay: יש לשמור תשובות 24 שעות; ה־API נועד לבקשות של בני אדם; הורדה המונית שיטתית אסורה (תרגום).', en: 'Pixabay: answers are kept for 24 hours; the API is for real human requests; systematic mass downloads are not allowed.' },
  'pixabay.hotlink': { provider: 'pixabay', quote: 'permanent hotlinking of images (using Pixabay URLs in your app) is not allowed. If you intend to use the images, please download them to your server first.', url: 'https://pixabay.com/api/docs/', readOn: '2026-11-26',
    he: 'Pixabay: אין לקשר דרך קבע לתמונות שלה; מורידים אותן קודם (תרגום). העורך מוריד כל קובץ לפני שימוש.', en: 'Pixabay: no permanent hotlinking; download first. The editor downloads every file before use.' },
  'pixabay.licence_unread': { provider: 'pixabay', quote: 'The licence page could not be read on 2026-11-26 (HTTP 403); read it at https://pixabay.com/service/license-summary/', url: 'https://pixabay.com/service/license-summary/', readOn: '2026-11-26',
    he: 'דף הרישיון של Pixabay לא נקרא (הדף סירב לגישה). קראו אותו בעצמכם בקישור.', en: 'Pixabay\'s licence page could not be read here. Read it yourself at the link.' },
  'wikimedia.user_agent': { provider: 'wikimedia', quote: 'Do not use generic agents such as "curl", "lwp", "Python-urllib"', url: 'https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy', readOn: '2026-11-26',
    he: 'ויקימדיה מבקשת שכל תוכנה תזדהה עם פרטי קשר (תרגום). העורך שולח את השורה שהקלדתם בחיבור, ולא ממציא אחת.', en: 'Wikimedia asks every program to identify itself with contact details. The editor sends the line you typed when connecting and never invents one.' },
  'wikimedia.people': { provider: 'wikimedia', quote: 'commercial use of images of people may require the explicit agreement of the subject', url: 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia', readOn: '2026-11-26',
    he: 'ויקישיתוף: שימוש מסחרי בתמונות של אנשים עשוי לדרוש את הסכמתם (תרגום).', en: 'Wikimedia Commons: commercial use of pictures of people may need their agreement.' },
  'wikimedia.attribution': { provider: 'wikimedia', quote: 'some licenses require that the original creator be attributed', url: 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia', readOn: '2026-11-26',
    he: 'ויקישיתוף: חלק מהרישיונות דורשים לתת קרדיט ליוצר (תרגום).', en: 'Wikimedia Commons: some licences ask that the creator be credited.' },
  'cc.nd': { provider: 'creativecommons', quote: 'If you remix, transform, or build upon the material, you may not distribute the modified material.', url: 'https://creativecommons.org/licenses/by-nd/4.0/', readOn: '2026-11-26',
    he: '«אם תעשו רמיקס, תשנו או תבנו על החומר, אינכם רשאים להפיץ את החומר ששונה» (תרגום של לשון הרישיון).', en: 'The licence\'s own words, quoted.' },
  'cc.sa': { provider: 'creativecommons', quote: 'If you remix, transform, or build upon the material, you must distribute your contributions under the same license as the original.', url: 'https://creativecommons.org/licenses/by-sa/4.0/', readOn: '2026-11-26',
    he: '«אם תעשו רמיקס, תשנו או תבנו על החומר, עליכם להפיץ את תרומתכם תחת אותו רישיון כמו המקור» (תרגום של לשון הרישיון).', en: 'The licence\'s own words, quoted.' },
};

// ---------------------------------------------------------------- warnings (never refusals)
/**
 * What an import, the asset badge and the export say about a source file. A licence finding names the licence and quotes its deed
 * row (C15); `non_commercial_content` is the existing export code (export.ts LIBRARY_EXPORT_CODES) and keeps its wording.
 */
export const SOURCE_WARNING_CODES = ['licence_no_derivatives', 'licence_share_alike', 'licence_unknown', 'licence_unconfirmed', 'source_terms', 'link_private_network'] as const;
export type SourceWarningCode = (typeof SOURCE_WARNING_CODES)[number];
export interface SourceWarning { code: SourceWarningCode | 'non_commercial_content'; assetId?: string; title?: string; licenceId?: string; licenceName?: string; termIds: string[]; message: string }
/** The deed row each licence finding quotes. */
export const LICENCE_WARNING_TERMS: Readonly<Partial<Record<SourceWarningCode, string>>> = { licence_no_derivatives: 'cc.nd', licence_share_alike: 'cc.sa' };

// ---------------------------------------------------------------- the op (internal; sourceOps.ts)
/** use_source_item: the asset as the server built it from the fetched, stored and checked bytes (AssetSchema without id; carries provenance.source). */
export const UseSourceItemArgsSchema = z.object({
  asset: z.record(z.string(), z.unknown()).describe('the asset as the server built it after storing and checking the bytes (AssetSchema without id; carries provenance.source)'),
}).strict();
export type UseSourceItemArgs = z.infer<typeof UseSourceItemArgsSchema>;
/**
 * recordAttached: an earlier copy of the same bytes (uploaded by hand) now carries the record; deduplicated: the same record was
 * there already (no change, no revision); libraryKept: the bytes are a library copy, which keeps its library record (C5.1).
 * warnings: the licence and term findings (sourceDuties), never a refusal.
 */
export interface UseSourceItemOutput { assetId: string; deduplicated: boolean; recordAttached: boolean; libraryKept: boolean; warnings: SourceWarning[] }
export type SourceOpCode = 'unknown_op' | 'invalid_args' | 'incompatible';
export interface SourceRow<A extends unknown[]> { code: string; why: string; message: (...a: A) => string; hint: string }
const row = <A extends unknown[]>(code: string, why: string, message: (...a: A) => string, hint: string): SourceRow<A> => ({ code, why, message, hint });
/** Refusals of use_source_item: data facts only (C14). Hebrew: HE_SOURCES (packages/i18n/src/sources.ts). */
export const SOURCE_OP_REFUSALS = {
  notBuilt: row('unknown_op', 'sources_not_built', () => 'use_source_item: files from stock sources are not built in this build yet', 'Nothing was changed. Update the editor and try again.'),
  notSourceAsset: row('invalid_args', 'source_no_record', () => 'this file has no source record', 'Files from a source are added with POST /api/v1/projects/{id}/sources/import (MCP import_source) or …/sources/link (MCP import_from_link).'),
  hashMismatch: row('invalid_args', 'source_hash_mismatch', () => 'the source record names other bytes than this file', 'Import the item again; the server writes the record from the bytes it stored.'),
  recordWeaker: row('invalid_args', 'source_record_weaker', (what: string) => `the source record is weaker than its own licence: it must be marked ${what}`, 'Import the item again; the server writes the record from the licence.'),
  creditMissing: row('incompatible', 'source_credit_missing', () => 'the licence of this item names a credit, and the record has no credit text', 'Import the item again, or choose another item.'),
} as const;

// ---------------------------------------------------------------- REST errors and job failures
/** REST error codes of the sources routes (stubs answer 501 sourcesNotBuilt until W2). */
export const SOURCES_API = {
  notBuilt: { status: 501, code: 'sources_not_built', message: 'stock sources and link import are not built in this version yet', hint: 'Nothing was changed. Update the editor and try again.' },
  providerUnknown: { status: 404, code: 'source_unknown', message: 'no such source', hint: 'GET /api/v1/sources lists them (openverse, pixabay, wikimedia).' },
  ownerRequired: { status: 403, code: 'owner_required', message: 'a key or contact line of a service is stored from the owner\'s own editor window', hint: 'Open the editor as the owner and connect the service in Settings › «חיבורים».' },
  keyMissing: { status: 409, code: 'provider_key_missing', message: 'this source needs a key, and none is stored', hint: 'Connect it in Settings › «חיבורים» (the key is free on the service\'s site).' },
  contactMissing: { status: 409, code: 'provider_contact_missing', message: 'Wikimedia Commons asks every program for a contact line, and none is stored', hint: 'Type an email address, a website or a wiki user name in Settings › «חיבורים» › Wikimedia Commons.' },
  keyRejected: { status: 502, code: 'provider_key_rejected', message: 'the service refused the stored key', hint: 'Check the key on the service\'s site and store it again in Settings › «חיבורים».' },
  rateLimited: { status: 429, code: 'provider_rate_limited', message: 'the service\'s request limit is reached', hint: 'Wait (details.retryAfterSeconds), or connect your own client for a higher limit (Openverse: free registration).' },
  providerFailed: { status: 502, code: 'provider_unavailable', message: 'the service did not answer as expected', hint: 'Try again in a few minutes.' },
  badCredentials: { status: 400, code: 'invalid_credentials', message: 'what was typed is not the form this service\'s key takes', hint: 'Paste the key exactly as the service shows it.' },
  sourceNotFound: { status: 404, code: 'source_not_found', message: 'the service has no such item (any more)', hint: 'Search again and choose another item.' },
  previewNotFound: { status: 404, code: 'preview_not_found', message: 'this preview is no longer available', hint: 'Search again; previews last 30 minutes.' },
  linkNotHttp: { status: 400, code: 'link_not_http', message: 'only http and https links can be imported', hint: 'Paste the address that starts with https://.' },
  linkAddressRefused: { status: 422, code: 'link_address_refused', message: 'this link points to this computer, its own network doors or a link-local address', hint: 'Use a link on the internet or on another device; the editor never reads its own doors through a link.' },
  linkNotMedia: { status: 415, code: 'download_not_media', message: 'the link does not lead to a video, sound or picture file', hint: 'Open the page and copy the link of the file itself. Links of video sites come later (an engine).' },
  downloadTooLarge: { status: 413, code: 'download_too_large', message: 'the file is larger than the download limit', hint: 'Raise the limit in Settings › «חיבורים» (at most the upload limit), or choose a smaller rendition.' },
  diskFull: { status: 507, code: 'download_disk_full', message: 'there is not enough free space for this download', hint: 'Free space on the data drive, then import again.' },
} as const;
export type SourcesApiKey = keyof typeof SOURCES_API;
/** Why a source_fetch job fails (facts; each with its next step). The import job's own failures pass through as they are. */
export const SOURCE_JOB_FAILURES = {
  sourceNotFound: row('source_not_found', 'source_not_found', () => 'the service no longer has this item', 'Search again and choose another item.'),
  keyMissing: row('provider_key_missing', 'provider_key_missing', () => 'the key of this service was removed', 'Connect it again in Settings › «חיבורים».'),
  keyRejected: row('provider_key_rejected', 'provider_key_rejected', () => 'the service refused the stored key', 'Check the key and store it again.'),
  rateLimited: row('provider_rate_limited', 'provider_rate_limited', (seconds: number) => `the service's request limit is reached (try again in ${seconds} seconds)`, 'Retry the import later.'),
  addressRefused: row('link_address_refused', 'link_address_refused', (host: string) => `the link (or a redirect) led to ${host}, an address of this computer or a link-local address`, 'Use a link on the internet or on another device.'),
  notMedia: row('download_not_media', 'download_not_media', (type: string) => `the link answered ${type}, not a video, sound or picture`, 'Copy the link of the file itself.'),
  tooLarge: row('download_too_large', 'download_too_large', (limit: number) => `the file passed the download limit of ${limit} bytes`, 'Raise the limit in Settings › «חיבורים» (at most the upload limit).'),
  diskFull: row('download_disk_full', 'download_disk_full', () => 'the data drive ran out of room while downloading', 'Free space, then retry the import.'),
  stalled: row('download_stalled', 'download_stalled', (seconds: number) => `no bytes arrived for ${seconds} seconds`, 'Retry the import; it continues where it stopped when the server allows it.'),
  canceled: row('canceled', 'canceled', () => 'the download was stopped', 'Import it again when you want the file.'),
} as const;
export type SourceJobFailure = keyof typeof SOURCE_JOB_FAILURES;

// ---------------------------------------------------------------- wire types of the routes (W2 builds; stubs answer 501)
const RT = z.object({ value: z.string(), timescale: z.number().int().positive() }).strict();
export const SourceSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(SOURCES_LIMITS.queryChars),
  kind: z.enum(SOURCE_KINDS).optional(),
  page: z.coerce.number().int().min(1).max(SOURCES_LIMITS.maxPage).optional(),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  /** Pixabay's `lang` (Hebrew queries: 'he') */ lang: z.string().regex(/^[a-z]{2}$/).optional(),
}).strict();
export type SourceSearchQuery = z.infer<typeof SourceSearchQuerySchema>;
/** One result row. `preview` and `thumb` are handles of GET /api/v1/source-previews/:handle (never a provider URL, C10). */
export interface SourceResultRow {
  provider: SearchableSourceId; itemId: string; kind: SourceKind; title: string; author: string | null;
  durationSeconds: number | null; width: number | null; height: number | null;
  licence: { id: string; name: string; url: string | null; from: 'item' | 'provider' | 'none' };
  flags: SourceRecord['flags'];
  creditPreview: string | null;
  pageUrl: string | null;
  preview: string | null; thumb: string | null;
  /** renditions offered (Pixabay video: large/medium/small/tiny) with their size in bytes when the service says it */
  renditions: { id: string; width: number | null; height: number | null; bytes: number | null }[];
  warnings: SourceWarning[];
}
export interface SourcePage {
  provider: SearchableSourceId; rows: SourceResultRow[]; page: number; next: number | null; total: number | null;
  /** the provider's line under the results (Pixabay asks for it) */ attribution: { he: string; en: string };
  /** C9: searches left in this window before the service's own limit, counted here (null = not counted) */ remaining: { count: number; perSeconds: number } | null;
  cached: boolean; terms: string[];
}
export const SourceImportBodySchema = z.object({
  provider: z.enum(SEARCHABLE_SOURCES),
  itemId: z.string().min(1).max(200),
  rendition: z.string().max(32).optional(),
  place: z.object({ start: RT, trackId: z.string().optional(), sequenceId: z.string().optional() }).strict().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();
export type SourceImportBody = z.infer<typeof SourceImportBodySchema>;
export const SourceLinkBodySchema = z.object({
  url: z.string().min(1).max(SOURCES_LIMITS.linkChars),
  place: z.object({ start: RT, trackId: z.string().optional(), sequenceId: z.string().optional() }).strict().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();
export type SourceLinkBody = z.infer<typeof SourceLinkBodySchema>;
/** 202 of both import routes. */
export interface SourceImportAnswer { jobId: string; route: 'provider' | 'direct'; warnings: SourceWarning[]; terms: string[] }
export const SOURCE_JOB_STAGES = ['resolving', 'downloading', 'importing', 'placing', 'done'] as const;
export type SourceJobStage = (typeof SOURCE_JOB_STAGES)[number];
/**
 * The durable job's input (store.ts job row). NEVER a key, never a tokened URL (C11): a pasted link lives in the 0600 sidecar
 * `<dataDir>/tmp/src_<jobId>.link`, deleted with the `.part`; the provider route asks the service for the item again (licence and
 * author from that fresh answer, never from the client).
 */
export interface SourceJobInput {
  route: 'provider' | 'direct';
  provider: SourceProviderId; itemId: string; rendition?: string;
  place?: { start: { value: string; timescale: number }; trackId?: string; sequenceId?: string };
  /** for a link: the host only, for the job card (the full link is in the sidecar) */ host?: string;
  maxBytes: number;
}
/** The job's stage JSON (resume, C6/C11): bytes so far, the validator of the first answer for If-Range, the import job once started. */
export interface SourceJobProgress { stage: SourceJobStage; bytes: number; total: number | null; etag: string | null; lastModified: string | null; importJobId: string | null }

/** GET /api/v1/sources: every connector with its state (never a key). */
export interface SourceState {
  provider: SearchableSourceId;
  /** ready = usable now; needs_key = a key must be stored; needs_contact = Wikimedia's contact line; not_built = this build */
  state: 'ready' | 'needs_key' | 'needs_contact' | 'not_built';
  keySet: boolean; keyAddedAt: string | null;
  /** Openverse: anonymous or the owner's client */ mode?: 'anonymous' | 'client';
  remaining: { count: number; perSeconds: number } | null;
}
export interface SourcesSettings { maxDownloadBytes: number | null; maxUploadBytes: number; effectiveMaxBytes: number }
export const SourcesSettingsBodySchema = z.object({ maxDownloadBytes: z.number().int().positive().nullable() }).strict();
/** PUT /api/v1/sources/:provider/credentials (the owner's own session only). One form per service. */
export const SourceCredentialsBodySchema = z.union([
  z.object({ key: z.string().min(1).max(200) }).strict(),
  z.object({ clientId: z.string().min(1).max(200), clientSecret: z.string().min(1).max(400) }).strict(),
  z.object({ contact: z.string().min(3).max(200) }).strict(),
]);
export type SourceCredentialsBody = z.infer<typeof SourceCredentialsBodySchema>;

// ---------------------------------------------------------------- pure functions (signatures; bodies by the builders)
export class SourcesNotBuiltError extends Error {
  readonly code = 'sources_not_built' as const;
  constructor(readonly fn: string) { super(`${fn}: stock sources are not built in this build yet`); }
}
/** Whether each part is built (flipped by the builders and the integrator). */
export const SOURCES_BUILT = { op: true, duties: true, credits: true, routes: false, fetcher: false, ui: false } as const;
