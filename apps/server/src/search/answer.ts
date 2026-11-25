/**
 * The answer of POST …/search and MCP find_in_footage (wave 7 search track; decisions §2 "Agents, fail-closed", §4). The lead reviews
 * this file at integration.
 *
 * - Every credential but the owner's own session (isOwnerSession): the exact section is core searchFootage on the READER document the
 *   route read (Store.getProject inside readingAs) with reader 'agent' (never reads a pearl's name, a tag or a person, whatever the
 *   grant, people 'full' included), and the answer is core agentAnswerOf of it — rebuilt from {assetId, start, end, sources} only,
 *   pictureState owner_only, nothing about the setup, the index or a model. The picture part is not even looked at.
 * - The owner's own session: the exact section with reader 'owner', and the picture section when picture search is ready and the
 *   project's videos are (partly) in the index: the query embedded by the text tower (inline, never stored), validated (length dim,
 *   finite, unit within FOOTAGE_LIMITS.unitTolerance; else 502 search_engine_failed and nothing is shown), quantised, ranked by int8 dot
 *   product, kept above core PICTURE_MIN_RELEVANCE, merged by core mergePictureHits. Rows carry no score: order only.
 * - The answer is parsed by its strict core schema before it leaves, so no key outside the contract (a score, a vector) can ride along.
 * - The query is never logged, stored, put in an error or echoed back.
 */
import {
  agentAnswerOf, AgentFootageAnswerSchema, FOOTAGE_LIMITS, FootageSearchNotBuilt, FOOTAGE_NOTE, FootageAnswerSchema, int8Dot, mergePictureHits, PICTURE_MIN_RELEVANCE,
  quantiseInt8, sampleFrameTargets, searchFootage, type AgentFootageAnswer, type FootageAnswer, type Moment, type PictureState, type ProjectDocument, type SearchSetup,
} from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import type { Principal } from '../governance.ts';
import { searchError, type Embedder } from './contract.ts';
import type { SearchIndexDb } from './indexDb.ts';

/** Builder A's pure functions, as the runtime calls them. Tests before A is merged pass small labelled doubles; production the core ones. */
export interface FootageCore {
  searchFootage: typeof searchFootage;
  sampleFrameTargets: typeof sampleFrameTargets;
  quantiseInt8: typeof quantiseInt8;
  int8Dot: typeof int8Dot;
  mergePictureHits: typeof mergePictureHits;
}
export const CORE: FootageCore = { searchFootage, sampleFrameTargets, quantiseInt8, int8Dot, mergePictureHits };

/** Vectors a worker returned: exactly count × dim, every value finite, every vector of unit length; else 502 search_engine_failed. */
export function validateVectors(v: Float32Array, count: number, dim: number = FOOTAGE_LIMITS.embedDim): Float32Array {
  if (v.length !== count * dim) throw searchError('engineFailed', { check: 'length' });
  for (let k = 0; k < count; k++) {
    let n = 0;
    for (let i = k * dim; i < (k + 1) * dim; i++) { const x = v[i]!; if (!Number.isFinite(x)) throw searchError('engineFailed', { check: 'finite' }); n += x * x; }
    if (Math.abs(Math.sqrt(n) - 1) >= FOOTAGE_LIMITS.unitTolerance) throw searchError('engineFailed', { check: 'unit' });
  }
  return v;
}

/** The project's videos (the only files in the picture index): asset ids by content hash. */
export function videosOf(doc: ProjectDocument): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of Object.values(doc.assets)) {
    if (a.kind !== 'video' || !a.video) continue;
    const l = out.get(a.contentHash) ?? [];
    l.push(a.id);
    out.set(a.contentHash, l);
  }
  return out;
}

/** Where the project's videos stand in the index for the current embedder. */
export interface ScanCounts { scanned: number; stale: number; of: number; bytes: number; scannedHashes: string[] }
export function scanCounts(index: SearchIndexDb | null, doc: ProjectDocument, embedder: string | null): ScanCounts {
  const videos = videosOf(doc);
  const hashes = [...videos.keys()];
  const res: ScanCounts = { scanned: 0, stale: 0, of: hashes.length, bytes: 0, scannedHashes: [] };
  if (!index) return res;
  const byHash = new Map<string, { current: boolean; other: boolean }>();
  for (const f of index.files(hashes)) {
    const e = byHash.get(f.contentHash) ?? { current: false, other: false };
    if (embedder && f.embedder === embedder) e.current = true; else e.other = true;
    byHash.set(f.contentHash, e);
    res.bytes += f.bytes;
  }
  for (const [h, e] of byHash) {
    if (e.current) { res.scanned++; res.scannedHashes.push(h); } else if (e.other) res.stale++;
  }
  return res;
}

/** What answer.ts needs of the runtime for the owner's picture section. */
export interface PictureContext {
  core: FootageCore;
  setup(): Promise<SearchSetup>;
  /** the embedder for this setup (null when not ready) */
  embedder(setup: SearchSetup): Embedder | null;
  index(): SearchIndexDb | null;
  scanOpen(projectId: string): boolean;
}

export interface PictureSection { pictureState: PictureState; setup: SearchSetup; scanned: { files: number; of: number }; embedder?: string; picture: Moment[] }
/** The owner's picture section. Never throws for a setup state: that is pictureState not_installed with the setup. */
export async function pictureSection(ctx: PictureContext, projectId: string, doc: ProjectDocument, query: string, limit: number, want: boolean, signal: AbortSignal): Promise<PictureSection> {
  const setup = await ctx.setup();
  const emb = setup.code === 'ready' ? ctx.embedder(setup) : null;
  const counts = scanCounts(emb ? ctx.index() : null, doc, emb?.id ?? null);
  const scanned = { files: counts.scanned, of: counts.of };
  if (!emb) return { pictureState: 'not_installed', setup, scanned, picture: [] };
  const busy = ctx.scanOpen(projectId);
  const state: PictureState = busy ? 'busy' : counts.of === 0 || counts.scanned === counts.of ? 'ready' : counts.scanned > 0 ? 'partly_scanned' : counts.stale > 0 ? 'stale' : 'not_scanned';
  const base = { pictureState: state, setup, scanned, embedder: emb.id };
  if (!want || counts.scanned === 0) return { ...base, picture: [] };
  const text = validateVectors(await emb.embedText([query], signal), 1, emb.dim);
  const { core } = ctx;
  const q = core.quantiseInt8(text);
  const videos = videosOf(doc);
  const hits: { assetId: string; frame: number; relevance: number }[] = [];
  for (const row of ctx.index()!.vectors(counts.scannedHashes, emb.id)) {
    const rel = emb.relevance(core.int8Dot(q.q, row.q) * q.scale * row.scale);
    if (!(rel >= PICTURE_MIN_RELEVANCE)) continue;
    for (const assetId of videos.get(row.contentHash) ?? []) hits.push({ assetId, frame: row.frame, relevance: rel });
  }
  const picture = hits.length ? core.mergePictureHits(doc, hits, doc.settings.frameRate, limit) : [];
  return { ...base, picture };
}

/** A core function this build does not have yet answers 501 footage_search_not_built (never a 500, never a made-up value). */
export async function notBuiltAs501<R>(fn: () => Promise<R> | R): Promise<R> {
  try { return await fn(); } catch (e) { if (e instanceof FootageSearchNotBuilt) throw searchError('notBuilt'); throw e; }
}

/** The whole answer for this credential. `doc` is the reader document the route read. */
export function footageAnswer(ctx: PictureContext, p: Principal, projectId: string, doc: ProjectDocument, q: { query: string; picture?: boolean; limit?: number }, signal: AbortSignal): Promise<FootageAnswer | AgentFootageAnswer> {
  return notBuiltAs501(() => answerFor(ctx, p, projectId, doc, q, signal));
}
async function answerFor(ctx: PictureContext, p: Principal, projectId: string, doc: ProjectDocument, q: { query: string; picture?: boolean; limit?: number }, signal: AbortSignal): Promise<FootageAnswer | AgentFootageAnswer> {
  const limit = q.limit ?? FOOTAGE_LIMITS.defaultResults;
  if (!isOwnerSession(p)) {
    // fail-closed: reader 'agent' on the reader document, then the privacy filter; nothing of the picture part is read
    return AgentFootageAnswerSchema.parse(agentAnswerOf({ exact: ctx.core.searchFootage(doc, q.query, { reader: 'agent', limit }) }));
  }
  const exact = ctx.core.searchFootage(doc, q.query, { reader: 'owner', limit });
  const pic = await pictureSection(ctx, projectId, doc, q.query, limit, q.picture !== false, signal);
  return FootageAnswerSchema.parse({
    exact, picture: pic.picture, pictureState: pic.pictureState, setup: pic.setup, scanned: pic.scanned,
    ...(pic.embedder ? { embedder: pic.embedder } : {}), heuristic: true, note: FOOTAGE_NOTE.en,
  });
}
