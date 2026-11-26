/**
 * Source descriptors as DATA (wave 8 `sources`, plan §3.3 with verify C9, C10; decisions «sources» A). No Node API: the web reads
 * them too. Every limit and term names where it was read and whether it is confirmed (deployed values were not readable for
 * Openverse; the research read the source defaults). LEAD-OWNED: a change of a row is a lead decision.
 *
 * - `apiHosts` binds the service's API calls ONLY (C10). A file or preview URL that came from the service's own answer is held
 *   server-side behind a handle and passes the safe downloader's address floor (C8) only: Openverse aggregates other hosts
 *   (Flickr, Wikimedia, Jamendo, Freesound…), Commons serves files from upload.wikimedia.org, Pixabay's CDN hosts were not read.
 * - `limits` is a LIST (C9): Openverse's anonymous 5 an hour binds before 100 a day; the server counts searches locally and the
 *   card says «נשארו N חיפושים בשעה הזאת» before the service answers 429.
 * - Wikimedia Commons: no key; the owner types the contact line its User-Agent policy asks for («חיבור» = consent); the editor never
 *   invents one (userAgentFor).
 * IDs equal core SOURCE_PROVIDERS (apps/server/src/sourcesContracts.test.ts checks it; this package does not import core).
 */
export type SourceKindId = 'video' | 'photo' | 'illustration' | 'music' | 'sound';
export interface SourceLimitRow { requests: number; perSeconds: number; who: 'anonymous' | 'client' | 'key' | 'unidentified' | 'identified'; source: string; confirmed: boolean }
export interface SourceDescriptor {
  id: 'openverse' | 'pixabay' | 'wikimedia' | 'link'; version: number;
  name: { he: string; en: string }; home: string;
  kinds: SourceKindId[];
  /** Pixabay's `lang` values used here (Hebrew queries; plan §2). Other services index English words. */
  languages?: string[];
  auth:
    | { kind: 'none' }
    | { kind: 'key'; label: { he: string; en: string }; signupUrl: string }
    | { kind: 'optional-client'; signupUrl: string; note: { he: string; en: string } }
    | { kind: 'contact'; label: { he: string; en: string }; policyUrl: string };
  limits: SourceLimitRow[];
  /** memory only, never on disk */ cacheSeconds: number;
  /** the line under the results naming the service (Pixabay asks for it) */ showSourceWithResults: boolean;
  licence: { mode: 'per-item' } | { mode: 'fixed'; id: string; name: string; url: string; confirmed: boolean } | { mode: 'none' };
  /** SOURCE_TERMS ids (core sourcesContract.ts) shown on results, on the asset and at export */
  terms: string[];
  /** exact hosts of the service's API calls (C10: not its files) */
  apiHosts: string[];
}

export const OPENVERSE: SourceDescriptor = {
  id: 'openverse', version: 1, name: { he: 'Openverse', en: 'Openverse' }, home: 'https://openverse.org',
  kinds: ['photo', 'illustration', 'music', 'sound'],
  auth: { kind: 'optional-client', signupUrl: 'https://docs.openverse.org/api/reference/authentication_and_throttling.html',
    note: { he: 'בלי חיבור: 5 חיפושים בשעה. רישום חינמי של לקוח נותן 100 בדקה ו־10,000 ביום.', en: 'Without connecting: 5 searches an hour. A free client registration gives 100 a minute and 10,000 a day.' } },
  limits: [
    { requests: 5, perSeconds: 3600, who: 'anonymous', source: 'openverse api/conf/settings/rest_framework.py THROTTLE_ANON_BURST "5/hour" (source default, read 2026-11-26)', confirmed: false },
    { requests: 100, perSeconds: 86400, who: 'anonymous', source: 'THROTTLE_ANON_SUSTAINED "100/day" (source default, read 2026-11-26)', confirmed: false },
    { requests: 100, perSeconds: 60, who: 'client', source: 'oauth2_client_credentials burst "100/min" (source default, read 2026-11-26)', confirmed: false },
    { requests: 10000, perSeconds: 86400, who: 'client', source: 'oauth2_client_credentials sustained "10000/day" (source default, read 2026-11-26)', confirmed: false },
  ],
  cacheSeconds: 3600, showSourceWithResults: true, licence: { mode: 'per-item' }, terms: [], apiHosts: ['api.openverse.org'],
};
export const PIXABAY: SourceDescriptor = {
  id: 'pixabay', version: 1, name: { he: 'Pixabay', en: 'Pixabay' }, home: 'https://pixabay.com',
  kinds: ['video', 'photo', 'illustration'], languages: ['he', 'en'],
  auth: { kind: 'key', label: { he: 'מפתח API של Pixabay', en: 'Pixabay API key' }, signupUrl: 'https://pixabay.com/api/docs/' },
  limits: [{ requests: 100, perSeconds: 60, who: 'key', source: 'https://pixabay.com/api/docs/ "By default, you can make up to 100 requests per 60 seconds." (read 2026-11-26)', confirmed: true }],
  cacheSeconds: 86400, showSourceWithResults: true,
  licence: { mode: 'fixed', id: 'provider:pixabay', name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/', confirmed: false },
  terms: ['pixabay.show_source', 'pixabay.cache_24h', 'pixabay.hotlink', 'pixabay.licence_unread'], apiHosts: ['pixabay.com'],
};
export const WIKIMEDIA: SourceDescriptor = {
  id: 'wikimedia', version: 1, name: { he: 'ויקישיתוף', en: 'Wikimedia Commons' }, home: 'https://commons.wikimedia.org',
  kinds: ['photo', 'illustration', 'video', 'sound', 'music'],
  auth: { kind: 'contact', label: { he: 'כתובת מייל, אתר או שם משתמש בוויקי (נשלח לוויקימדיה עם כל בקשה)', en: 'An email address, a website or a wiki user name (sent to Wikimedia with every request)' }, policyUrl: 'https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy' },
  limits: [
    { requests: 10, perSeconds: 60, who: 'unidentified', source: 'https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits ("being deployed in 2026", read 2026-11-26)', confirmed: false },
    { requests: 200, perSeconds: 60, who: 'identified', source: 'same page: unauthenticated requests with a compliant User-Agent (read 2026-11-26)', confirmed: false },
  ],
  cacheSeconds: 3600, showSourceWithResults: true, licence: { mode: 'per-item' }, terms: ['wikimedia.user_agent', 'wikimedia.attribution', 'wikimedia.people'], apiHosts: ['commons.wikimedia.org'],
};
/** A pasted direct link (Dropbox share links rewritten to dl=1 for the request only). Not searched. */
export const LINK: SourceDescriptor = {
  id: 'link', version: 1, name: { he: 'קישור', en: 'Link' }, home: '', kinds: ['video', 'photo', 'illustration', 'music', 'sound'],
  auth: { kind: 'none' }, limits: [], cacheSeconds: 0, showSourceWithResults: false, licence: { mode: 'none' }, terms: [], apiHosts: [],
};
export const SOURCE_DESCRIPTORS: readonly SourceDescriptor[] = [OPENVERSE, PIXABAY, WIKIMEDIA, LINK];

/**
 * The User-Agent of every request (plan §3.4): the program's name, no version, no machine detail; for Wikimedia Commons the contact
 * line the OWNER typed, verbatim, in parentheses (its policy's format). Never a made-up contact. Complete.
 */
export function userAgentFor(id: SourceDescriptor['id'], contact: string | null): string {
  if (id === 'wikimedia' && contact) return `PULSEFRAME-Studio (${contact.replace(/[\r\n()]/g, ' ').trim()})`;
  return 'PULSEFRAME-Studio';
}

/** Thrown by a pure mapping of this track that W2 has not written yet. */
export class ConnectorNotBuiltError extends Error {
  readonly code = 'sources_not_built' as const;
  constructor(readonly fn: string) { super(`${fn}: stock sources are not built in this build yet`); }
}
