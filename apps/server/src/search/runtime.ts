/**
 * The picture search runtime (wave 7 search track; search/contract.ts SearchRuntime; decisions §2–§4). Built by builder B.
 *
 * SETUP STATE (decisions §3 item 5), in the order a person fixes things, each with the next step in words, never a stack:
 *   licence_blocked → engine_unverified (pf_search.py is not the reviewed file: SEARCH_WORKER_SHA256) → engine_not_configured
 *   (PF_TOOLS_PYTHON unset) / engine_not_working (the probe names the module it cannot import) → disk_insufficient / model_missing (the
 *   seven pins at exact bytes and SHA-256 under PF_SEARCH_MODEL_DIR or <library root>/models/search/siglip2-base-patch16-256; the
 *   missing bytes named) → ready (device cuda, or cpu with the sentence that no graphics card was found). The app never downloads a model.
 * WORKERS: workers.ts (scan and query processes of pf_search.py). INDEX: indexDb.ts. JOB: indexJob.ts. ANSWER: answer.ts.
 * DELETION: Store.addAssetsGoneListener (commits, undo, redo) and setSearchIndexHooks (project delete, storage clean-up) delete the rows
 *   of every content hash no current project holds; «שכח» deletes a project's rows, or the whole index file.
 * Creating the runtime has no side effect: no file, no process, until the owner asks for the picture part.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import type { ProjectDocument, SearchSetup } from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import { Derivatives } from '../derive.ts';
import { setSearchIndexHooks } from '../storage.ts';
import type { TrackingDeps } from '../tracking.ts';
import { CORE, footageAnswer, scanCounts, type FootageCore, type PictureContext } from './answer.ts';
import { SEARCH_PICTURE, SEARCH_WORKER_SHA256, searchError, type Embedder, type SearchRuntime, type SearchRuntimeDeps } from './contract.ts';
import { ScanJobs } from './indexJob.ts';
import { removeIndexFiles, SearchIndexDb } from './indexDb.ts';
import { TEST_DOUBLE_LABEL } from './testEmbedder.ts';
import { probeSearchPython, SearchWorkers } from './workers.ts';
import { actsAsOwner } from '../autonomy.ts';

/** The reviewed worker script. */
export const SEARCH_WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/pf_search.py');
const LICENCES_ALLOWED = new Set(['Apache-2.0', 'MIT', 'BSD-3-Clause']);

/** What tests add to SearchRuntimeDeps (TEST SEAMS ONLY; never set from configuration). */
export interface SearchRuntimeOptions extends SearchRuntimeDeps {
  /** builder A's functions; tests before A is merged pass labelled doubles */
  core?: FootageCore;
  /** a different worker script (the labelled fake) and the digest that counts as reviewed for it */
  worker?: string;
  workerSha256?: string | null;
  derivatives?: TrackingDeps['derivatives'];
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}
function freeBytes(dir: string): number | null {
  let d = path.resolve(dir);
  for (;;) {
    try { const s = fs.statfsSync(d); return Number(s.bavail) * Number(s.bsize); } catch { /* try the parent */ }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function createSearchRuntime(deps: SearchRuntimeOptions): SearchRuntime & { scans: ScanJobs; index(): SearchIndexDb | null; held(h: string): boolean; modelDir(): string | null } {
  const { cfg, store, lane } = deps;
  const core = deps.core ?? CORE;
  const worker = deps.worker ?? SEARCH_WORKER;
  const reviewed = deps.worker ? (deps.workerSha256 ?? null) : SEARCH_WORKER_SHA256;
  const derivatives = deps.derivatives ?? new Derivatives(store);
  let idx: SearchIndexDb | null = null;
  let workers: SearchWorkers | null = null;
  let workersKey = '';
  let probe: { state: SearchSetup; at: number } | null = null;
  const pinCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

  const modelDir = (): string | null => {
    if (cfg.searchModelDir) return cfg.searchModelDir;
    let root = cfg.libraryDir ?? null;
    if (!root) { try { const j = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'library.json'), 'utf8')) as { root?: unknown }; root = typeof j.root === 'string' && j.root ? j.root : null; } catch { root = null; } }
    return root ? path.join(root, ...SEARCH_PICTURE.libraryPath.split('/')) : null;
  };
  /** Missing bytes of the seven pins (0 = every one present at exact size and SHA-256). */
  const missingPinBytes = async (dir: string): Promise<number> => {
    let missing = 0;
    for (const pin of SEARCH_PICTURE.pins) {
      const f = path.join(dir, pin.path);
      let st: fs.Stats;
      try { st = fs.statSync(f); } catch { missing += pin.bytes; continue; }
      if (!st.isFile() || st.size !== pin.bytes) { missing += pin.bytes; continue; }
      let c = pinCache.get(f);
      if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs) { c = { size: st.size, mtimeMs: st.mtimeMs, sha256: await sha256File(f) }; pinCache.set(f, c); }
      if (c.sha256 !== pin.sha256) missing += pin.bytes;
    }
    return missing;
  };

  async function setup(): Promise<SearchSetup> {
    if (deps.embedder) return { code: 'ready', detail: TEST_DOUBLE_LABEL, device: null };
    if (!LICENCES_ALLOWED.has(SEARCH_PICTURE.licence.spdx)) return { code: 'licence_blocked', detail: `the picture model's licence (${SEARCH_PICTURE.licence.spdx}) is not allowed in this build` };
    if (!reviewed) return { code: 'engine_unverified', detail: 'this build has no reviewed digest of the picture search worker yet (pf_search.py); update the editor' };
    let digest: string;
    try { digest = await sha256File(worker); } catch { return { code: 'engine_unverified', detail: 'the picture search worker (pf_search.py) is missing from this installation; reinstall the editor' }; }
    if (digest !== reviewed) return { code: 'engine_unverified', detail: 'the installed picture search worker (pf_search.py) differs from the reviewed one; reinstall the editor' };
    if (!cfg.toolsPython) return { code: 'engine_not_configured', detail: 'PF_TOOLS_PYTHON is not set: create the tools Python environment with the picture search requirements and set PF_TOOLS_PYTHON to its python (docs/INTEGRATIONS.md)' };
    if (!probe || Date.now() - probe.at > (probe.state.code === 'ready' ? 60_000 : 5_000)) probe = { state: await probeSearchPython({ python: cfg.toolsPython, script: worker, tmpDir: store.tmpDir }), at: Date.now() };
    if (probe.state.code !== 'ready') return probe.state;
    const dir = modelDir();
    if (!dir) return { code: 'model_missing', detail: `no model folder: set PF_SEARCH_MODEL_DIR, or the library folder, and fetch ${SEARCH_PICTURE.model} with the library fetcher (${SEARCH_PICTURE.totalBytes} bytes)`, missingBytes: SEARCH_PICTURE.totalBytes };
    const missingBytes = await missingPinBytes(dir);
    if (missingBytes) {
      const free = freeBytes(dir);
      if (free !== null && free < missingBytes) return { code: 'disk_insufficient', detail: `the model needs ${missingBytes} more bytes and ${free} are free where it goes; make room, then fetch it`, missingBytes };
      return { code: 'model_missing', detail: `the picture model files are not all present and verified: ${missingBytes} bytes to fetch with the library fetcher (${SEARCH_PICTURE.model}); the editor never downloads them`, missingBytes };
    }
    const device = probe.state.device === 'cuda' ? 'cuda' : 'cpu';
    return {
      code: 'ready', device, missingBytes: 0, ...(probe.state.versions ? { versions: probe.state.versions } : {}),
      detail: device === 'cuda' ? 'ready: pictures are read on the graphics card (CUDA, fp16)' : 'ready on the CPU: no graphics card was found by torch, so a scan is slower (install the CUDA build of torch to use the graphics card)',
    };
  }
  function embedderFor(s: SearchSetup): Embedder | null {
    if (s.code !== 'ready') return null;
    if (deps.embedder) return deps.embedder;
    const dir = modelDir()!, device = s.device === 'cuda' ? 'cuda' : 'cpu';
    const key = `${cfg.toolsPython}|${dir}|${device}`;
    if (!workers || workersKey !== key) {
      void workers?.release();
      workers = new SearchWorkers({ python: cfg.toolsPython!, script: worker, tmpDir: store.tmpDir, modelDir: dir, keepSeconds: cfg.toolsKeepSeconds }, device);
      workersKey = key;
    }
    return workers;
  }
  const index = (): SearchIndexDb => (idx ??= SearchIndexDb.open(cfg.dataDir));
  const indexIfExists = (): SearchIndexDb | null => (idx ??= SearchIndexDb.openIfExists(cfg.dataDir));
  /** Some current project holds this content hash (synchronous; a text prefilter, then the parsed assets). */
  const held = (hash: string): boolean => {
    for (const r of store.db.prepare('SELECT doc FROM projects WHERE instr(doc, ?) > 0').iterate(hash) as Iterable<{ doc: string }>) {
      try { const d = JSON.parse(r.doc) as ProjectDocument; if (Object.values(d.assets ?? {}).some((a) => a.contentHash === hash)) return true; } catch { return true; /* unreadable: keep, never guess it gone */ }
    }
    return false;
  };
  /** The deletion guarantee: rows of every hash that no current project holds go. */
  const purgeIfGone = (hashes: string[]) => {
    const gone = hashes.filter((h) => !held(h));
    if (!gone.length) return;
    const ix = indexIfExists();
    if (ix) ix.deleteHashes(gone);
  };
  const offListener = store.addAssetsGoneListener((_p, hashes) => purgeIfGone(hashes));
  setSearchIndexHooks(store, { hashesMaybeGone: purgeIfGone });

  const scans = new ScanJobs({
    store, lane, core, derivatives, index, held,
    embedder: async () => {
      const s = await setup();
      const e = embedderFor(s);
      if (!e) throw searchError('notReady', { setup: s.code }, s.code);
      return e;
    },
  });
  const ctx: PictureContext = { core, setup, embedder: embedderFor, index: indexIfExists, scanOpen: (pid) => !!scans.openFor(pid) };

  return {
    scans, index: indexIfExists, held, modelDir,
    setup,
    answer: (p, projectId, doc, q, signal) => footageAnswer(ctx, p, projectId, doc, q, signal),
    async status(projectId, doc) {
      const s = await setup();
      const e = embedderFor(s);
      const c = scanCounts(e ? indexIfExists() : null, doc, e?.id ?? null);
      const open = scans.openFor(projectId);
      return { setup: s, embedder: e?.id ?? null, files: { scanned: c.scanned, stale: c.stale, of: c.of }, bytes: c.bytes, job: open ? { jobId: open.id, status: open.status } : null };
    },
    startScan: (p, projectId, body) => {
      if (!actsAsOwner(p)) throw searchError('ownerOnly'); // the route checked it; a second net
      return scans.start(p, projectId, body);
    },
    cancel: (jobId, actor) => scans.cancel(jobId, actor),
    async forget(projectId) {
      await scans.abortScans(projectId, 'user:local');
      if (projectId === null) {
        const ix = indexIfExists();
        const forgotten = ix ? ix.totals() : { files: 0, bytes: 0 };
        ix?.close();
        idx = null;
        removeIndexFiles(cfg.dataDir);
        return { forgotten };
      }
      const { doc } = store.wholeProject(projectId);
      const ix = indexIfExists();
      return { forgotten: ix ? ix.deleteHashes(Object.values(doc.assets).map((a) => a.contentHash)) : { files: 0, bytes: 0 } };
    },
    async releaseKept() { if (workers) await workers.release(); },
    recover: () => scans.recover(),
    async stop() {
      await scans.stop();
      if (workers) await workers.release();
      if (deps.embedder) await deps.embedder.release();
      offListener();
      setSearchIndexHooks(store, null);
      idx?.close();
      idx = null;
    },
  };
}
