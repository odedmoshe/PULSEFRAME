import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { RenderHost } from '@pulseframe/renderer';
import type { ProviderAdapter } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { BackupScheduler } from './backup.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { FifoComputeLane } from './lane.ts';
import { LocalTools } from './localtools.ts';
import { recoverAnalysisJobs, createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { recoverTrackingJobs, stopTrackingJobs } from './tracking.ts';
import { recoverStabiliseJobs, stopStabiliseJobs } from './stabilise.ts';
import { recoverMomentsJobs, stopMomentsJobs } from './moments.ts';
import { recoverStillsJobs, stopStillsJobs } from './stills.ts';
import { createDropDoor } from './drop.ts';
import { loadDropPage } from './drop-page/index.ts';
import { dropLimitsFrom, type DropDoor, type ImportQueue } from './importContracts.ts';
import { createImportQueue } from './importQueue.ts';
import { incrementalAvailable, runSegmentedExport } from './exportSegments.ts';
import { frameKeyFor } from './renderCacheEnv.ts';
import { createRenderCacheService, type RenderCacheService } from './renderCacheRoutes.ts';
import { RENDER_CACHE_DIR, SegmentStore } from './segmentStore.ts';
import { closeLibraryService } from './library/index.ts';
import { dataDirBytes, setStorageHooks } from './storage.ts';
import { recoverAssistantJobs } from './assistant/job.ts'; // command bar assistant recovery (ADR-0027)
import type { AssistantDeps } from './assistant/contract.ts';
import { createLlamaAdapter } from './assistant/local/llamaAdapter.ts'; // the local assistant's loopback adapter (wave 7)
import type { MusicKit, SizeFitFault } from '@pulseframe/core';
import { SEARCH_LANE_PREFIX, type Embedder } from './search/contract.ts';
import { createSearchRuntime } from './search/runtime.ts';
import type { PictureModelsTestSeams } from './picmodels/contract.ts';
import { createPictureModelsRuntime } from './picmodels/runtime.ts';

export { loadConfig, type Config } from './config.ts';
export interface RunningServer {
  url: string; /** Link that opens the editor as the owner (carries the launch secret). */ ownerUrl: string; cfg: Config; store: Store; auth: Auth; derivatives: Derivatives; governance: Governance; backup: BackupScheduler;
  /** The import queue and the phone drop door (ADR-0023), the render cache (ADR-0024): for proofs and tests that look inside. */
  imports: ImportQueue; door: DropDoor; renderCache: RenderCacheService;
  close(): Promise<void>;
}

/**
 * `deps.assistant`: the command bar assistant's installed adapters (ADR-0027). Wave 1 ships none, so the CLI passes nothing and
 * the setup state is honest (provider_not_configured); tests and pnpm proof:command-bar install the labelled MOCK adapter here.
 */
export async function startServer(overrides: Partial<Config> = {}, deps: { providerAdapter?: ProviderAdapter; assistant?: AssistantDeps; /** TEST only (wave 7 send proof S3/S4): a labelled size-fit fault, never from the environment */ fitFault?: SizeFitFault; /** TEST only (wave 7 search proof): the labelled test double of the picture model (search/testEmbedder.ts), never from the environment */ searchEmbedder?: Embedder; /** TEST only (wave 8 picmodels proof): the labelled fake worker, its digest, a synthetic registry and library root; never from the environment */ picmodelsTest?: PictureModelsTestSeams; /** TEST only (wave 7 instruments proof): a labelled synthetic kit list in place of MUSIC_KITS (packages/fixtures/src/instruments.ts), never from the environment */ musicKits?: readonly MusicKit[] } = {}): Promise<RunningServer> {
  const cfg = { ...loadConfig(), ...overrides };
  if (overrides.dataDir && !overrides.speechModelsDir && !process.env.PF_SPEECH_MODELS_DIR) cfg.speechModelsDir = path.join(cfg.dataDir, 'speech-models');
  const backup = new BackupScheduler(cfg.dataDir, cfg.backupDir, cfg.backupEveryHours, cfg.backupKeep); // throws on a destination inside the data directory, before anything is opened
  const store = new Store(cfg.dataDir, cfg.maxStorageBytes);
  const auth = new Auth(cfg);
  const host = new RenderHost();
  let url = `http://${cfg.host}:${cfg.port}`; // re-derived below once the listener is bound (port 0 = any free port)
  // One heavy holder at a time on this machine (ADR-0017): speech, narration, local AI tools and each ComfyUI chunk take the lane;
  // a running server export pauses new chunks. Before heavy work starts, the kept speech and tool workers (2–4 GB each) are let go,
  // except the one whose own job is starting.
  const lane = new FifoComputeLane();
  const exporter = new Exporter(store, host, () => `${url}/render.html`, cfg.webDist);
  exporter.lane = lane;
  if (deps.fitFault) exporter.fitFault = deps.fitFault;
  const localTools = new LocalTools(store, cfg, lane);
  const capabilities = new Capabilities(store, cfg, deps.providerAdapter, { lane, localTools });
  const derivatives = new Derivatives(store);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  capabilities.governance = governance;
  const speech = new Speech(store, cfg, lane);
  // picture search «חיפוש בצילומים» (wave 7 search track; search/runtime.ts, builder B): the not-built runtime until built
  const search = createSearchRuntime({ cfg, store, lane, ...(deps.searchEmbedder ? { embedder: deps.searchEmbedder } : {}) });
  // the local picture-model runtime and eyes (wave 8 picmodels; picmodels/runtime.ts, W1): outside the lane (eyes is one process per request)
  const pictureModels = createPictureModelsRuntime({ cfg, store, ...(deps.picmodelsTest ?? {}) });
  lane.onBeforeHeavy(async (label) => {
    if (!/^(speech recognition|narration) /.test(label)) await speech.releaseKept();
    if (!/^local\./.test(label)) await localTools.releaseKept();
    if (!label.startsWith(SEARCH_LANE_PREFIX)) await search.releaseKept(); // picture search workers (wave 7): kept only for their own scan
  });
  // ---- import queue and phone drop (ADR-0023, amends ADR-0002) ----
  const imports = createImportQueue({ store, lane, derivatives, maxUploadBytes: cfg.maxUploadBytes, reserveBytes: cfg.importReserveBytes, homeZone: cfg.homeZone });
  const projectExists = (id: string) => !!store.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id);
  // preferredAddress is left unset: the door runs the route probe itself (drop.ts). The door listens only while a code is live.
  const door = createDropDoor({ queue: imports, projectExists, page: loadDropPage, port: cfg.dropPort, limits: dropLimitsFrom(cfg), admitAddresses: cfg.dropAdmitAddresses });
  // ---- segmented export and render cache (ADR-0024) ----
  const cacheDir = path.join(cfg.dataDir, RENDER_CACHE_DIR);
  let segmentsOpen = false;
  const segments: SegmentStore = new SegmentStore({
    dir: cacheDir, capBytes: cfg.renderCacheBytes, autoClear: cfg.renderCacheAutoClear, minFreeBytes: cfg.renderCacheMinFreeBytes,
    // index.sqlite and its WAL count as other bytes (usedBytes counts the segment files only); no walk without a ceiling
    // (while the store is being opened it trims, before `segments` exists: its directory is measured whole then)
    quota: () => { const quotaBytes = store.maxStorageBytes; if (!quotaBytes) return { quotaBytes, otherBytes: 0 }; const cache = segmentsOpen ? segments.status().usedBytes : dataDirBytes(cacheDir); return { quotaBytes, otherBytes: Math.max(0, dataDirBytes(cfg.dataDir) - cache) }; },
  });
  segmentsOpen = true;
  setStorageHooks(store, { reclaim: (n) => void segments.trim(n), purgeProject: (id) => void segments.purgeProject(id), status: () => segments.status() });
  // Privacy over speed (owner decision): a commit that changes a privacy region purges the project's segments in the same commit path.
  store.onPrivacyChange = (projectId, revision) => void segments.purgeProject(projectId, { revision });
  const envSource = { host, webDist: cfg.webDist, threads: cfg.segmentThreads, fontHash: (family: string) => exporter.fontHash(family) };
  let joinResult: { ok: true } | { ok: false; reason: string } | null = null;
  void incrementalAvailable().then((r) => { joinResult = r; }); // one tiny two-segment encode and join, about a second, at start
  // enabled: a cap above 0 and a join this ffmpeg can make exactly (unknown for the second the check takes: blockers say so)
  const cacheStatus = () => { const st = segments.status(); return { ...st, enabled: st.capBytes > 0 && joinResult?.ok !== false }; };
  const renderCache = createRenderCacheService({ store, exporter, segments, envSource, status: cacheStatus });
  exporter.incremental = { status: cacheStatus, join: () => joinResult };
  exporter.segmented = { store: segments, env: renderCache.env, keyOf: frameKeyFor, run: runSegmentedExport };
  // the command bar assistant (ADR-0027) and, wave 7, the LOCAL assistant: the loopback-only adapter (it contacts 127.0.0.1:<port> only
  // when the owner chose it and asks) and the compute lane; tests may pass their own (a labelled MOCK) in deps.assistant.local
  const assistantDeps: AssistantDeps = { ...(deps.assistant ?? { adapters: new Map(), endpoint: () => null }), lane, local: deps.assistant?.local !== undefined ? deps.assistant.local : createLlamaAdapter() };
  const mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech, derivatives, { imports, renderCache, search });
  const app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, governance, backup, speech, { imports, door, renderCache, search, pictureModels, assistant: assistantDeps, renderHost: host, ...(deps.musicKits ? { musicKits: deps.musicKits } : {}) });
  const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const bound = (server.address() as AddressInfo).port;
  if (cfg.port !== 0 && bound !== cfg.port) throw new Error('unexpected port');
  if (cfg.port === 0) { cfg.port = bound; url = `http://${cfg.host}:${bound}`; auth.bindPort(bound); } // everything derived from the port (Host/Origin allowlist, the render page URL, the links) uses the bound one
  // Crash recovery: publish any committed-but-unpublished events, restart interrupted jobs.
  store.drainOutbox();
  // Browser-route jobs belong to a tab: after a restart their lease is gone, so they are never re-run by the server exporter.
  for (const job of store.recoverJobs('export')) {
    if (job.input.route === 'browser') store.updateJob(job.id, { status: 'failed', stage: null, error: { code: 'lease_lost', message: 'the server restarted while a browser tab owned this export; start a new export', retryable: true } });
    else exporter.enqueue(job);
  }
  await capabilities.recover();
  imports.recover(); // after the capability jobs: an interrupted conversion takes the lane only once they are back in line
  recoverAnalysisJobs(store);
  recoverTrackingJobs(store, { derivatives });
  recoverStabiliseJobs(store, { derivatives }); // stabilisation (wave 7): run again from the start
  recoverMomentsJobs(store, { derivatives, lane });
  recoverStillsJobs(store, { derivatives, lane }); // «הפריים הכי חד» (wave 8 cover): measured again from the start
  speech.recover();
  derivatives.recover();
  search.recover(); // picture search scans cut off by the restart resume at the first file without a complete row (wave 7)
  // ---- command bar assistant (ADR-0027, W2): a request cut off by the restart is never sent again; failed submission_unknown,
  // its reservation released when nothing was sent, kept as unknown when the send had started ----
  recoverAssistantJobs(store, governance);
  // ---- end command bar assistant recovery ----
  backup.start();
  return {
    url, ownerUrl: `${url}/?key=${auth.tokens.owner}`, cfg, store, auth, derivatives, governance, backup, imports, door, renderCache,
    async close() {
      (app as any).browserExport?.stop();
      await mcp.close();
      await backup.stop();
      await capabilities.stop();
      await localTools.stop();
      await speech.stop();
      await stopTrackingJobs(store); // the rows stay running: they are tracked again after a restart
      await stopStabiliseJobs(store); // likewise: measured again after a restart
      await pictureModels.stop(); // a running eyes process is killed (wave 8 picmodels)
      await search.stop(); // picture search (wave 7): workers let go; a running scan's row stays running for recover()
      await stopStillsJobs(store); // likewise (wave 8 cover)
      await stopMomentsJobs(store); // likewise: measured again after a restart (cached files make it cheap)
      await door.stop(); // the code closes ('shutdown') and the second listener with it; uploads in flight are aborted
      await imports.stop(); // the running ffmpeg is killed; the rows stay running for recover()
      await derivatives.stop();
      // Stop accepting, then drop connections that are still open (event streams of pages that were not closed, idle keep-alives):
      // without this, shutdown waited for them indefinitely.
      await new Promise((r) => { server.close(r); (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); });
      await host.close();
      store.onPrivacyChange = null;
      setStorageHooks(store, null);
      segments.close();
      closeLibraryService(cfg.dataDir); // the catalogue's index file and any build in progress (a restart rebuilds a cut one)
      store.close();
    },
  };
}
