/**
 * The sources runtime (wave 8 `sources`, W2; implements sources/contract.ts SourcesRuntime): states, search with the memory cache
 * and the local request count (C9), previews behind handles (C10), the owner's credentials (routes.ts checks the owner floor
 * first), the download limit (C6), and the durable source_fetch job (job.ts) for an item or a pasted link (C8, C11).
 *
 * - A service gets ONLY the caller's words and filters, plus the owner's key (Pixabay), client token (Openverse) or contact line
 *   (Wikimedia, in the User-Agent). Queries are never logged or stored; answers are kept in memory only (cache.ts).
 * - Anything a service answers passes the key redactor before it reaches an error (service.ts callJson).
 * - The address policy and the services' base URLs come ONLY from SourcesDeps.test (tests and the proof, labelled doubles);
 *   otherwise the default policy (connectors/fetch.ts) and the descriptors' own hosts.
 * - Imports are open to any credential that may edit (governance 'job'); a credential in propose mode is refused because the
 *   internal op cannot be proposed (a fact of the op, as for library items). The job commits as that credential.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { SEARCHABLE_SOURCES, SOURCE_JOB_TYPE, SOURCES_LIMITS, sourcesMaxBytes, type SearchableSourceId, type SourceCredentialsBody, type SourceImportAnswer, type SourceImportBody, type SourceLinkBody, type SourcePage, type SourceSearchQuery, type SourceState, type SourcesSettings, type SourceWarning } from '@pulseframe/core';
import { canonicalLink, OPENVERSE, PIXABAY, SOURCE_DESCRIPTORS, userAgentFor, WIKIMEDIA, type SourceDescriptor } from '@pulseframe/providers';
import { writePrivateFile } from '../assistant/credential.ts';
import type { Principal } from '../auth.ts';
import { ownerKeeps, actsAsOwner } from '../autonomy.ts';
import { classifyAddress, defaultAddressPolicy } from '../connectors/fetch.ts';
import { ConnectorKeyStore, readConnectorSettings, writeConnectorSettings, type ConnectorKeyId } from '../connectors/keys.ts';
import { freeDiskBytes } from '../storage.ts';
import { ApiError, type JobRow } from '../store.ts';
import { AnswerCache, RequestCounter } from './cache.ts';
import { sourcesError, type SourcesDeps, type SourcesRuntime } from './contract.ts';
import { linkPath, progressOf, SourceJobRunner, type StoredSourceInput } from './job.ts';
import { openverse, openverseToken } from './openverse.ts';
import { pixabay } from './pixabay.ts';
import { previewResponse, PreviewHandles } from './previews.ts';
import { rowOf, type ServiceAdapter, type ServiceCtx, type ServiceItem, type ServicePage } from './service.ts';
import { wikimedia } from './wikimedia.ts';

/** Extra deps of the runtime beyond the frozen SourcesDeps (index.ts passes the real ones; tests pass labelled ones). */
export interface SourcesRuntimeOptions {
  /** TESTS only (labelled): free disk space in place of the data drive's own */ freeBytes?: (dir: string) => number | null;
  /** TESTS only: shorter header / idle timeouts */ timeouts?: { headerMs?: number; idleMs?: number };
  now?: () => number;
}
export type SourcesRuntimeImpl = SourcesRuntime & { stop(): Promise<void>; /** for tests and the proof: the memory cache size */ cacheSize(): number };

const REAL_BASE: Record<SearchableSourceId, string> = { openverse: `https://${OPENVERSE.apiHosts[0]}`, pixabay: `https://${PIXABAY.apiHosts[0]}`, wikimedia: `https://${WIKIMEDIA.apiHosts[0]}` };
const ADAPTERS: Record<SearchableSourceId, ServiceAdapter> = { openverse, pixabay, wikimedia };
const KEY_ID: Record<SearchableSourceId, ConnectorKeyId> = { openverse: 'source.openverse.client', pixabay: 'source.pixabay', wikimedia: 'source.wikimedia.contact' };
const descriptorOf = (id: string): SourceDescriptor => SOURCE_DESCRIPTORS.find((d) => d.id === id)!;
const isSearchable = (id: string): id is SearchableSourceId => (SEARCHABLE_SOURCES as readonly string[]).includes(id);
/** Rows of a search answer remembered (by provider + itemId) for the 202 warnings of an import; bounded. */
const ITEM_INDEX_MAX = 2000;

export function createSourcesRuntime(deps: SourcesDeps, o: SourcesRuntimeOptions = {}): SourcesRuntimeImpl {
  const { cfg, store, gov } = deps;
  const now = o.now ?? Date.now;
  const keys = new ConnectorKeyStore(cfg.dataDir);
  const policy = deps.test?.addressPolicy ?? defaultAddressPolicy;
  const cache = new AnswerCache<ServicePage>(now);
  const counter = new RequestCounter(now);
  const handles = new PreviewHandles(now);
  const items = new Map<string, ServiceItem>();
  const tokens = new Map<string, { token: string; expires: number }>();
  const principals = new Map<string, Principal>();

  const baseOf = (p: SearchableSourceId) => (deps.test?.baseUrls?.[p] ?? REAL_BASE[p]).replace(/\/+$/, '');
  const hostsOf = (p: SearchableSourceId) => (deps.test?.baseUrls?.[p] ? [new URL(deps.test.baseUrls[p]!).hostname] : descriptorOf(p).apiHosts);
  const contact = () => keys.read('source.wikimedia.contact');
  const uaFor = (provider: string) => userAgentFor(provider as SourceDescriptor['id'], provider === 'wikimedia' ? contact() : null);
  const client = (): { clientId: string; clientSecret: string } | null => { try { const v = JSON.parse(keys.read('source.openverse.client') ?? 'null'); return v && typeof v.clientId === 'string' && typeof v.clientSecret === 'string' ? v : null; } catch { return null; } };
  const whoOf = (p: SearchableSourceId): string => (p === 'openverse' ? (client() ? 'client' : 'anonymous') : p === 'pixabay' ? 'key' : 'identified');
  const room = (p: SearchableSourceId) => counter.room(p, whoOf(p), descriptorOf(p).limits);
  const remaining = (p: SearchableSourceId) => { const r = room(p); return r ? { count: r.count, perSeconds: r.perSeconds } : null; };

  /** Counts one request against the service's own limit; refuses before the service would (C9). */
  const spend = (p: SearchableSourceId) => {
    const r = room(p);
    if (r && r.count <= 0) throw sourcesError('rateLimited', { retryAfterSeconds: r.retryAfterSeconds, limit: { requests: descriptorOf(p).limits.find((l) => l.who === whoOf(p) && l.perSeconds === r.perSeconds)?.requests ?? null, perSeconds: r.perSeconds }, countedHere: true });
    counter.record(p, whoOf(p));
  };
  /** The context of a call; refuses before sending anything when the service needs what is not stored. */
  const ctxFor = async (p: SearchableSourceId, signal?: AbortSignal): Promise<ServiceCtx> => {
    const base: Omit<ServiceCtx, 'secret'> = { baseUrl: baseOf(p), apiHosts: hostsOf(p), policy, userAgent: uaFor(p), redact: keys.redactor(), ...(signal ? { signal } : {}) };
    if (p === 'pixabay') { const k = keys.read('source.pixabay'); if (!k) throw sourcesError('keyMissing', { provider: p }); return { ...base, secret: k }; }
    if (p === 'wikimedia') { if (!contact()) throw sourcesError('contactMissing', { provider: p }); return { ...base, secret: null }; }
    const c = client();
    if (!c) return { ...base, secret: null };
    const held = tokens.get('openverse');
    if (held && held.expires > now()) return { ...base, secret: held.token };
    spend(p);
    const t = await openverseToken({ ...base, secret: null }, c);
    tokens.set('openverse', { token: t.token, expires: now() + Math.max(60, t.expiresInSeconds - 60) * 1000 });
    return { ...base, secret: t.token };
  };
  const remember = (it: ServiceItem) => { const k = `${it.provider}:${it.itemId}`; items.delete(k); items.set(k, it); while (items.size > ITEM_INDEX_MAX) items.delete(items.keys().next().value!); };
  const stateOf = (p: SearchableSourceId): SourceState => {
    const ks = keys.state(KEY_ID[p]);
    const state: SourceState['state'] = p === 'pixabay' && !ks.keySet ? 'needs_key' : p === 'wikimedia' && !ks.keySet ? 'needs_contact' : 'ready';
    return { provider: p, state, keySet: ks.keySet, keyAddedAt: ks.keyAddedAt, ...(p === 'openverse' ? { mode: client() ? 'client' as const : 'anonymous' as const } : {}), remaining: remaining(p) };
  };
  const settingsNow = (): SourcesSettings => {
    const stored = readConnectorSettings(cfg.dataDir).sources.maxDownloadBytes;
    return { maxDownloadBytes: stored, maxUploadBytes: cfg.maxUploadBytes, effectiveMaxBytes: sourcesMaxBytes(cfg.sourcesMaxBytes ?? stored, cfg.maxUploadBytes) };
  };

  const runner = new SourceJobRunner({
    cfg, store, gov, imports: deps.imports!, policy, principals, now,
    reserveBytes: cfg.importReserveBytes,
    freeBytes: o.freeBytes ?? freeDiskBytes,
    timeouts: { headerMs: o.timeouts?.headerMs ?? SOURCES_LIMITS.headerTimeoutMs, idleMs: o.timeouts?.idleMs ?? SOURCES_LIMITS.idleTimeoutMs },
    userAgentFor: uaFor,
    async resolveItem(provider, itemId, signal) {
      const ctx = await ctxFor(provider, signal);
      spend(provider);
      const it = await ADAPTERS[provider].item(ctx, itemId);
      if (it) remember(it);
      return it;
    },
  });

  /** The answer of an import that names a key used before (the first job), or of a new one. */
  const answerOf = (job: JobRow, warnings: SourceWarning[]): SourceImportAnswer => {
    const input = job.input as StoredSourceInput;
    return { jobId: job.id, route: input.route, warnings, terms: input.route === 'provider' ? [...descriptorOf(input.provider).terms] : [] };
  };
  const admit = (p: Principal) => {
    if (!deps.imports) throw sourcesError('notBuilt');
    if (p.mode === 'propose') throw new ApiError(403, 'insufficient_scope', 'this credential may only propose edits, and a file from a source cannot be proposed: it is added through an internal step that a proposal does not carry', { mode: 'propose' }, 'Ask for a grant in edit mode, or ask the owner to import it.');
    gov.assertUnrestricted(p, 'add media to the project');
  };
  const prior = (p: Principal, key: string | undefined) => (key ? store.findJobByKey(SOURCE_JOB_TYPE, p.actor, key) : null);
  const create = (p: Principal, projectId: string, input: StoredSourceInput): JobRow => {
    const job = store.createJob(projectId, SOURCE_JOB_TYPE, p.actor, input);
    store.events.emit('job', job);
    return job;
  };

  const rt: SourcesRuntimeImpl = {
    list(_p) {
      return { sources: SEARCHABLE_SOURCES.map(stateOf), settings: settingsNow() };
    },

    async search(_p, provider, q: SourceSearchQuery): Promise<SourcePage> {
      if (!isSearchable(provider)) throw sourcesError('providerUnknown', { provider: provider.slice(0, 40) });
      const d = descriptorOf(provider);
      const ctx = await ctxFor(provider);
      const args = { q: q.q, page: q.page ?? 1, ...(q.kind ? { kind: q.kind } : {}), ...(q.orientation ? { orientation: q.orientation } : {}), ...(q.lang ? { lang: q.lang } : {}) };
      const key = AnswerCache.key(provider, { ...args, who: whoOf(provider) });
      let page = cache.get(key);
      const cached = !!page;
      if (!page) {
        spend(provider);
        page = await ADAPTERS[provider].search(ctx, args);
        cache.set(key, provider, page, provider === 'pixabay' ? SOURCES_LIMITS.cacheMsPixabay : SOURCES_LIMITS.cacheMsDefault);
      }
      const rows = page.items.map((it) => {
        remember(it);
        return rowOf(it, {
          preview: it.previewUrl ? `/api/v1/source-previews/${handles.mint(it.previewUrl, provider)}` : null,
          thumb: it.thumbUrl ? `/api/v1/source-previews/${handles.mint(it.thumbUrl, provider)}` : null,
        });
      });
      return {
        provider, rows, page: args.page, next: page.next, total: page.total,
        attribution: { he: `תוצאות מ־${d.name.he}`, en: `Results from ${d.name.en}` },
        remaining: remaining(provider), cached, terms: [...d.terms],
      };
    },

    async preview(_p, handle, range) {
      return previewResponse(handles, handle, range, { policy, userAgentFor: uaFor });
    },

    setCredentials(_p, provider, body: SourceCredentialsBody) {
      if (!isSearchable(provider)) throw sourcesError('providerUnknown', { provider: provider.slice(0, 40) });
      if (provider === 'pixabay' && 'key' in body) keys.write('source.pixabay', body.key);
      else if (provider === 'openverse' && 'clientId' in body) keys.write('source.openverse.client', JSON.stringify({ clientId: body.clientId.trim(), clientSecret: body.clientSecret.trim() }));
      else if (provider === 'wikimedia' && 'contact' in body) keys.write('source.wikimedia.contact', body.contact);
      else throw sourcesError('badCredentials', { provider });
      cache.dropProvider(provider); tokens.delete(provider);
      return stateOf(provider);
    },
    deleteCredentials(_p, provider) {
      if (!isSearchable(provider)) throw sourcesError('providerUnknown', { provider: provider.slice(0, 40) });
      keys.delete(KEY_ID[provider]);
      cache.dropProvider(provider); tokens.delete(provider);
      return stateOf(provider);
    },
    settings: () => settingsNow(),
    setSettings(_p, maxDownloadBytes) {
      const cur = readConnectorSettings(cfg.dataDir);
      writeConnectorSettings(cfg.dataDir, { ...cur, sources: { ...cur.sources, maxDownloadBytes } });
      return settingsNow();
    },

    async importItem(p, projectId, body: SourceImportBody) {
      admit(p);
      const was = prior(p, body.idempotencyKey);
      if (was) return answerOf(was, []);
      await ctxFor(body.provider); // a missing key or contact line is said now, before a job exists
      const remembered = items.get(`${body.provider}:${body.itemId}`);
      if (remembered && body.rendition && !remembered.renditions.some((r) => r.id === body.rendition)) throw new ApiError(400, 'invalid_request', `this item has no rendition ${body.rendition}`, { renditions: remembered.renditions.map((r) => r.id) }, 'Omit rendition, or name one the search row lists.');
      const input: StoredSourceInput = {
        route: 'provider', provider: body.provider, itemId: body.itemId, ...(body.rendition ? { rendition: body.rendition } : {}),
        ...(body.place ? { place: body.place } : {}), maxBytes: settingsNow().effectiveMaxBytes,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}), ...(p.grant ? { grantId: p.grant.id } : {}),
      };
      const job = create(p, projectId, input);
      principals.set(job.id, p);
      runner.start(job.id);
      return answerOf(job, remembered ? rowOf(remembered, { preview: null, thumb: null }).warnings : []);
    },

    async importLink(p, projectId, body: SourceLinkBody) {
      admit(p);
      let link;
      try { link = canonicalLink(body.url); } catch { throw sourcesError('linkNotHttp'); }
      const warnings: SourceWarning[] = [];
      const literal = link.host.replace(/^\[|\]$/g, '');
      if (/^[\d.]+$|:/.test(literal)) {
        const c = classifyAddress(policy, literal);
        if (c.verdict === 'refuse') throw sourcesError('linkAddressRefused', { host: link.host });
        if (c.verdict === 'private') warnings.push({ code: 'link_private_network', termIds: [], message: `the link leads to a home-network address (${link.host})` });
      }
      const was = prior(p, body.idempotencyKey);
      if (was) return answerOf(was, warnings);
      const input: StoredSourceInput = {
        route: 'direct', provider: 'link', itemId: createHash('sha256').update(link.canonical).digest('hex').slice(0, 32), host: link.host,
        ...(body.place ? { place: body.place } : {}), maxBytes: settingsNow().effectiveMaxBytes,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}), ...(p.grant ? { grantId: p.grant.id } : {}),
      };
      const job = create(p, projectId, input);
      try {
        fs.mkdirSync(store.tmpDir, { recursive: true });
        writePrivateFile(linkPath(store, job.id), JSON.stringify({ url: link.requestUrl })); // C11: the full link, 0600, never in the row
      } catch {
        store.updateJob(job.id, { status: 'failed', error: { code: 'internal_error', message: 'the link could not be kept for the download', hint: 'Check the free space of the data drive, then paste the link again.', retryable: true } });
        throw new ApiError(500, 'internal_error', 'the link could not be kept for the download', { jobId: job.id }, 'Check the free space of the data drive, then paste the link again.');
      }
      principals.set(job.id, p);
      runner.start(job.id);
      return answerOf(job, warnings);
    },

    cancel(p, jobId) {
      const job = store.getJob(jobId);
      if (job.type !== SOURCE_JOB_TYPE) throw new ApiError(409, 'not_a_source_job', `job ${jobId} is not a source download`, { jobId, type: job.type });
      // the starting credential or the owner (and, in open mode, an open agent); paused agents and project limits hold
      if (!ownerKeeps(p)) {
        gov.assertMayAct(p, job.projectId, 'job');
        if (!actsAsOwner(p) && job.actor !== p.actor) throw new ApiError(403, 'not_your_job', 'agents can only cancel downloads they started', { jobId, startedBy: job.actor }, 'Ask the owner to cancel it, or cancel only downloads this credential started.');
      }
      return runner.cancel(job, p.actor);
    },

    recover() {
      if (!deps.imports) return 0;
      // a cancel asked for before the restart is honoured; every other open job continues from its stage JSON (.part, import)
      const rows = store.openJobs(SOURCE_JOB_TYPE);
      for (const j of rows) {
        if (j.status === 'cancel-requested') { runner.cancel({ ...j, status: 'queued' }, 'restart'); continue; }
        if (j.status === 'running') store.updateJob(j.id, { status: 'queued', stage: JSON.stringify(progressOf(j)) });
        runner.start(j.id);
      }
      return rows.length;
    },

    stop: () => runner.stop(),
    cacheSize: () => cache.size,
  };
  return rt;
}
