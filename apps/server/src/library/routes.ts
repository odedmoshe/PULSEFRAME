/**
 * The library routes (wave 7 library track; library/contract.ts). WORKER A. GET …/credits delegates to credits.ts (worker B) and is
 * registered here so http.ts stays one line.
 *
 * - The root, reindex and cancel are the owner's own session's (403 owner_required otherwise); `root` is in the status only for it.
 * - The catalogue routes need `observe`; nothing in them reads a project. Search words are never logged or stored.
 * - Every file is reached through paths.ts (realpath containment) and checked before its bytes are used: a file item against its
 *   ledger size and sha256, a file in a tree against its indexed size and mtime. Audition streams the file itself (mp3, flac,
 *   wav, ogg; 415 otherwise); thumbnails are PNG made here; no answer is ever image/svg+xml (DATA_CSP covers every /api/ answer).
 * - Use: the file is copied into a private temp file and checked there (hash, size/mtime; an SVG is sanitised and rasterised),
 *   then use_library_item + add_clip are tried on a copy of the project BEFORE the import queue receives anything; the queue
 *   commits use_library_item (importQueue.ts library branch); the placement is tried again and committed as the caller's own
 *   governed edit. Propose-mode credentials are refused (as built-in music is).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';
import {
  applyTransaction, CreditsQuerySchema, LIBRARY_OPS_BUILT, LibraryItemsQuerySchema, LibraryRecordSchema, LibraryRootBodySchema, LibraryUseBodySchema,
  OpError, type Asset, type LibraryRecord, type LibraryUseBody, type LibraryUseResult, type OpCall,
} from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Governance } from '../governance.ts';
import type { LibraryJobInput } from '../importContracts.ts';
import { describeMedia } from '../ingest.ts';
import { ApiError, type Store } from '../store.ts';
import { AUDITION_TYPES, libraryError, libraryOwner, MAX_READ_BYTES, type LibraryApp, type LibraryEnv, type LibraryRouteDeps } from './contract.ts';
import { creditsFor } from './credits.ts';
import { libraryServiceFor, type IndexedRow, type LibraryService } from './index.ts';
import { checkedDigest, copyChecked, isInside, openChecked, safeSegments } from './paths.ts';
import { rasteriseRow } from './raster.ts';
import { libraryThumb } from './thumbs.ts';

const AUDIO_KINDS = new Set(['music', 'sound', 'loop']);
const assetKindOf = (k: string): 'audio' | 'image' | 'video' => (AUDIO_KINDS.has(k) ? 'audio' : k === 'video' ? 'video' : 'image');

async function jsonBody(c: Context<LibraryEnv>): Promise<unknown> {
  try { return await c.req.json(); } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
}
function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ApiError(400, 'invalid_request', `invalid request: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`.slice(0, 400));
  return r.data;
}
/** A catalogue key from the route (Hono gives it percent-decoded); 404 when the index has no such row. */
function rowOf(lib: LibraryService, key: string): IndexedRow {
  if (!lib.configured()) throw libraryError('notConfigured');
  const ix = key && key.length <= 400 ? lib.get(key) : null;
  if (!ix) throw libraryError('itemMissing');
  return ix;
}
/** As Store.commit reports an op refusal; an op this build has not built answers 501 library_not_built. */
function opToApi(e: unknown): never {
  if (e instanceof OpError) {
    if (e.code === 'unknown_op' && !LIBRARY_OPS_BUILT) throw libraryError('notBuilt');
    throw new ApiError(e.code === 'forbidden_op' ? 403 : e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint);
  }
  throw e;
}

/** The deps each store's routes were registered with (MCP use_library_item answers through the same function as REST). */
const registered = new WeakMap<Store, LibraryRouteDeps>();

export function registerLibraryRoutes(app: LibraryApp, deps: LibraryRouteDeps): void {
  const { store, need } = deps;
  const lib = libraryServiceFor(deps.cfg);
  registered.set(store, deps);

  app.get('/api/v1/library/status', async (c) => { const p = need(c, 'observe'); return c.json(await lib.status(p.kind === 'user')); });
  app.put('/api/v1/library/root', async (c) => {
    libraryOwner(need(c, 'observe'));
    const b = parse(LibraryRootBodySchema, await jsonBody(c));
    lib.setRoot(b.root);
    return c.json(await lib.status(true));
  });
  app.post('/api/v1/library/reindex', async (c) => {
    libraryOwner(need(c, 'observe'));
    if (!lib.configured()) throw libraryError('notConfigured');
    lib.startBuild();
    return c.json(await lib.status(true), 202);
  });
  app.delete('/api/v1/library/reindex', async (c) => {
    libraryOwner(need(c, 'observe'));
    lib.cancelBuild();
    await lib.idle();
    return c.json(await lib.status(true));
  });
  app.get('/api/v1/library/items', async (c) => {
    need(c, 'observe');
    const q = parse(LibraryItemsQuerySchema, c.req.query());
    if (!lib.configured()) throw libraryError('notConfigured');
    return c.json(await lib.search(q));
  });
  app.get('/api/v1/library/items/:key', async (c) => {
    need(c, 'observe');
    const ix = rowOf(lib, c.req.param('key'));
    if (ix.format === 'svg' && !ix.row.unusable && !(await lib.svgOk())) return c.json({ ...ix.row, unusable: 'needs_svg_rasteriser' });
    return c.json(ix.row);
  });
  app.get('/api/v1/library/items/:key/licence', async (c) => {
    need(c, 'observe');
    const ix = rowOf(lib, c.req.param('key'));
    const rootReal = await lib.rootReal();
    const rel = await lib.licencePath(ix.row.sourceId);
    const segs = rel ? safeSegments(rel) : null;
    const notStored = () => new ApiError(404, 'not_found', 'the download tool did not store this licence text', { url: ix.entry.licenceUrl ?? null }, 'Read it at the address given, or fetch the library again.');
    if (!segs || segs[0] !== '_manifests' || segs[1] !== 'LICENCES') throw notStored();
    const dir = path.join(rootReal, '_manifests', 'LICENCES');
    let real: string;
    try { real = await fsp.realpath(path.join(rootReal, ...segs)); } catch { throw notStored(); }
    const dirReal = await fsp.realpath(dir).catch(() => null);
    if (!dirReal || !isInside(dirReal, real) || !isInside(rootReal, dirReal)) throw libraryError('pathEscape', { reason: 'licence text outside LICENCES' });
    const st = await fsp.stat(real);
    if (!st.isFile() || st.size > MAX_READ_BYTES) throw notStored();
    return c.body(await fsp.readFile(real), 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=3600' });
  });
  app.get('/api/v1/library/items/:key/audio', async (c) => {
    need(c, 'observe');
    const ix = rowOf(lib, c.req.param('key'));
    const mime = AUDIO_KINDS.has(ix.row.kind) && Object.hasOwn(AUDITION_TYPES, ix.format) ? AUDITION_TYPES[ix.format]! : null;
    if (!mime) throw libraryError('audioUnsupported', { format: ix.format });
    const rootReal = await lib.rootReal();
    const f = await openChecked(rootReal, ix);
    try {
      await checkedDigest(f, ix);
    } catch (e) { await f.fd.close(); throw e; }
    const size = f.stat.size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    let start = 0, end = size - 1, status = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; } else { start = Math.max(0, size - Number(m[2])); }
      if (start > end || start >= size) {
        await f.fd.close();
        return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      }
      status = 206;
    }
    const stream = f.fd.createReadStream({ start, end, autoClose: true });
    const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'private, max-age=600' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
  });
  app.get('/api/v1/library/items/:key/thumb', async (c) => {
    need(c, 'observe');
    const raw = c.req.query('size') ?? '128';
    if (raw !== '128' && raw !== '256') throw new ApiError(400, 'invalid_request', 'size must be 128 or 256', { size: raw.slice(0, 8) });
    const ix = rowOf(lib, c.req.param('key'));
    const png = await libraryThumb(deps.cfg.dataDir, store.tmpDir, await lib.rootReal(), ix, Number(raw) as 128 | 256);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
  });
  app.post('/api/v1/projects/:id/library/use', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    const b = parse(LibraryUseBodySchema, await jsonBody(c));
    return c.json(await useLibraryItem(deps, lib, p, projectId, b), 201);
  });
  app.get('/api/v1/projects/:id/credits', (c) => {
    const p = need(c, 'observe');
    const q = CreditsQuerySchema.safeParse({ sequenceId: c.req.query('sequenceId'), lang: c.req.query('lang') });
    return c.json(creditsFor(store, p, c.req.param('id'), q.success ? q.data : {}));
  });
}

/**
 * MCP use_library_item answers through this (library/contract.ts: "MCP use_library_item = REST"): the routes of the same store
 * must have been registered (http.ts createApp does it); otherwise 501 library_not_built.
 */
export async function useLibraryItemFor(store: Store, principal: Principal, projectId: string, body: unknown): Promise<LibraryUseResult> {
  const deps = registered.get(store);
  if (!deps) throw libraryError('notBuilt');
  return useLibraryItem(deps, libraryServiceFor(deps.cfg), principal, projectId, parse(LibraryUseBodySchema, body));
}

/** The licence record of a row (what use_library_item stores on the asset). */
export function recordOf(ix: IndexedRow, sourceSha256: string, raster?: LibraryRecord['raster']): LibraryRecord {
  const r = ix.row;
  return LibraryRecordSchema.parse({
    itemId: r.key, sourceId: r.sourceId, kind: r.kind, title: r.title.slice(0, 200), ...(r.author ? { author: r.author.slice(0, 200) } : {}),
    sourceSha256,
    ledger: { item: ix.entry.item.slice(0, 200), ...(ix.entry.treeSha256 ? { treeSha256: ix.entry.treeSha256 } : {}), ...(ix.entry.version && ix.entry.version.length <= 80 ? { version: ix.entry.version } : {}), ...(ix.entry.commit && ix.entry.commit.length <= 64 ? { commit: ix.entry.commit } : {}) },
    licence: { id: r.licenceId.slice(0, 80), ...((ix.licence.url ?? ix.entry.licenceUrl) ? { url: (ix.licence.url ?? ix.entry.licenceUrl)!.slice(0, 500) } : {}) },
    ...(r.credit ? { credit: r.credit } : {}),
    flags: { ...(r.duties.nonCommercial ? { nonCommercial: true } : {}), ...(!r.duties.shareable ? { diskOnly: true } : {}), ...(r.badges.people ? { people: true } : {}), ...(r.badges.aiGenerated ? { aiGenerated: true } : {}), ...(r.badges.trademark ? { trademark: true } : {}) },
    ...(raster ? { raster } : {}),
  });
}

async function useLibraryItem(deps: LibraryRouteDeps, lib: LibraryService, p: Principal, projectId: string, b: LibraryUseBody): Promise<LibraryUseResult> {
  const { store, gov, cfg } = deps;
  store.getProject(projectId);
  gov.assertMayAct(p, projectId, 'edit');
  if (p.kind === 'agent' && p.mode === 'propose') throw new ApiError(403, 'insufficient_scope', 'this credential may only propose edits, and a library item cannot be proposed: it is added through an internal step that a proposal does not carry', { mode: 'propose' }, 'Ask the project owner to add it, or for a grant in edit mode.');
  gov.assertUnrestricted(p, 'add media to the library');
  const ix = rowOf(lib, b.key);
  if (ix.row.unusable) throw libraryError('itemUnusable', { reason: ix.row.unusable }, ix.row.unusable);
  const isSvg = ix.format === 'svg';
  if ((b.color || b.longSide) && !isSvg) throw new ApiError(400, 'invalid_option', 'color and longSide apply to SVG items only', { key: b.key });
  if (!deps.imports) throw libraryError('notBuilt');
  const rootReal = await lib.rootReal();
  fs.mkdirSync(store.tmpDir, { recursive: true });
  const tmp = path.join(store.tmpDir, `lib_${randomBytes(8).toString('hex')}`);
  try {
    // 1. a private, checked copy of the bytes that will be used
    let sourceSha256: string, expect: LibraryJobInput['expect'], raster: LibraryRecord['raster'] | undefined, name: string;
    const fileName = (ix.rel || ix.entry.path).slice((ix.rel || ix.entry.path).lastIndexOf('/') + 1);
    if (isSvg) {
      const longSide = b.longSide ?? 512;
      const r = await rasteriseRow(store.tmpDir, rootReal, ix, longSide, b.color, 'add');
      fs.writeFileSync(tmp, r.png, { mode: 0o600 });
      sourceSha256 = r.sourceSha256;
      expect = { sha256: createHash('sha256').update(r.png).digest('hex') };
      raster = { longSide, ...(b.color ? { color: b.color } : {}), by: 'ffmpeg-librsvg' };
      name = `${(ix.member ?? fileName.replace(/\.svg$/i, '')).slice(0, 200)}.png`;
    } else {
      const copied = await copyChecked(rootReal, ix, tmp, cfg.maxUploadBytes);
      sourceSha256 = copied.sha256;
      expect = ix.rel === '' ? { sha256: ix.entry.sha256! } : { bytes: ix.bytes, mtimeMs: ix.mtimeMs! };
      name = fileName.slice(0, 256);
    }
    const record = recordOf(ix, sourceSha256, raster);
    // 2. the import and the placement tried on a copy of the project: nothing is received when either would be refused
    let meta;
    try { meta = await describeMedia(tmp); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(415, 'unsupported_media', 'this library file could not be read as media', { key: b.key }, 'Choose another item.'); }
    if (meta.kind !== assetKindOf(ix.row.kind)) throw new ApiError(415, 'unsupported_media', `this library file is not ${assetKindOf(ix.row.kind)}`, { key: b.key }, 'Choose another item.');
    const size = fs.statSync(tmp).size;
    const provisional = { ...meta, name, contentHash: `sha256:${'sha256' in expect ? expect.sha256 : sourceSha256}`, byteSize: size, provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: p.actor, library: record } } as Omit<Asset, 'id'>;
    const place = (assetId: string): OpCall | null => (b.start ? { op: 'add_clip', args: { assetId, start: b.start, ...(b.duration ? { duration: b.duration } : {}), ...(b.trackId ? { trackId: b.trackId } : {}) } } : null);
    try {
      const used = applyTransaction(store.getProject(projectId).doc, [{ op: 'use_library_item', args: { asset: provisional } }], { idSeed: 'dryrun-lib-a', actor: p.actor, allowInternal: true });
      const op = place(used.results[0]!.output!.assetId as string);
      if (op) applyTransaction(used.doc, [op], { idSeed: 'dryrun-lib-b', actor: p.actor });
    } catch (e) { opToApi(e); }
    // 3. the import queue copies, checks expect again and commits use_library_item
    gov.assertMayAct(p, projectId, 'edit');
    const job = await deps.imports.receive({ projectId, actor: p.actor, body: fs.createReadStream(tmp), name, via: 'browser', declaredBytes: size, maxBytes: cfg.maxUploadBytes, commitKind: 'edit', library: { record, expect } });
    const done = await deps.imports.wait(job.id);
    if (done.status !== 'succeeded') {
      const e = (done.error ?? {}) as { code?: string; message?: string; status?: number; details?: Record<string, unknown>; hint?: string };
      if (e.code === 'internal_error' && e.details?.refusal === 'unknown_op' && !LIBRARY_OPS_BUILT) throw libraryError('notBuilt');
      throw new ApiError(typeof e.status === 'number' && e.status >= 400 ? e.status : 500, e.code ?? 'internal_error', e.message ?? `the import ended ${done.status}`, { ...(e.details ?? {}), jobId: job.id }, e.hint);
    }
    const out = done.output as { assetId: string; revision: number; deduplicated: boolean; recordAttached?: boolean };
    const base = { assetId: out.assetId, revision: out.revision, deduplicated: !!out.deduplicated, recordAttached: !!out.recordAttached, jobId: job.id };
    // 4. the placement: tried again on the current project, then the caller's own governed edit
    const op = place(out.assetId);
    if (!op) return { ...base, placed: null };
    gov.assertMayAct(p, projectId, 'edit');
    try { applyTransaction(store.getProject(projectId).doc, [op], { idSeed: 'dryrun-lib-c', actor: p.actor }); } catch (e) { opToApi(e); }
    const placed = gov.commitAs(p, { projectId, ops: [op], label: `Place ${name}` }) as { revision?: number; results?: { output?: Record<string, unknown> }[]; proposal?: unknown };
    return { ...base, revision: placed.revision ?? out.revision, placed: placed.results?.[0]?.output ?? null, ...(placed.proposal ? { proposal: placed.proposal } : {}) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
