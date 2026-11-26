import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SERVER_MODE, parseMode, type ServerMode } from './autonomy-mode.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export interface Config {
  host: string;
  port: number;
  dataDir: string;
  webDist: string;
  /** Extra browser origins allowed to call the API with credentials (e.g. the Vite dev server). */
  extraOrigins: string[];
  maxUploadBytes: number;
  /** Optional ComfyUI provider (Amendment A1). Unset = provider not configured; the editor works without it. */
  comfyuiUrl: string | null;
  comfyuiAllowRemote: boolean;
  /** Local ComfyUI `models` directory, when the provider runs on this machine. Enables digest verification and downloads. */
  comfyuiModelsDir: string | null;
  /** Hosts model files may be downloaded from (redirect targets must match too; a leading dot means any subdomain). */
  modelHosts: string[];
  /**
   * Hosts the in-editor language assistant may send its allowlisted summary to (PF_ASSISTANT_HOSTS, comma-separated exact
   * host names; default none). The owner's configured host must be listed here and reached over https (ADR-0027).
   */
  assistantHosts: string[];
  /**
   * The owner's content library folder (wave 7 library track; PF_LIBRARY_DIR). Optional: the owner may instead set it in Settings,
   * which writes <dataDir>/library.json (apps/server/src/library/contract.ts LIBRARY_CONFIG_FILE); the environment wins when both exist.
   */
  libraryDir?: string | null;
  /** Ceiling for everything in the data directory (media, derivatives, exports, database), in bytes; 0 = no ceiling (the default). New uploads and exports are refused once it is reached. */
  maxStorageBytes: number;
  /**
   * Requests per minute allowed per agent credential (REST and MCP together); 0 = no limit (the default).
   * Off by default because this is a single-user local tool: local scripts legitimately send hundreds of requests per second
   * (the convergence test and the soak do), and a default limit throttled them. The owner's browser session is never limited.
   */
  agentRequestsPerMinute: number;
  /** Autonomy (autonomy.ts): 'open' (default) or 'guarded' (today's behaviour). From PF_MODE; the owner's stored switch otherwise. */
  mode: ServerMode;
  /** True when PF_MODE set the mode (it then wins over the owner's stored switch at start-up). */
  modeFromEnv: boolean;
  /** Add `Secure` to the owner session cookie (set when the server is reached through HTTPS, i.e. behind a TLS-terminating proxy). Off by default: the local profile is plain HTTP on loopback. */
  secureCookie: boolean;
  /** Directory for automatic backups (outside the data directory); null = automatic backups off (the default). */
  backupDir: string | null;
  /** Hours between automatic backups when `backupDir` is set (default 24; 0 = off). */
  backupEveryHours: number;
  /** Dated database snapshots to retain (default 14, at least 1). */
  backupKeep: number;
  /** Python interpreter of an environment with the local speech engine installed (see docs/INTEGRATIONS.md). Unset = automatic transcription is not configured; typed and imported transcripts work without it. */
  speechPython: string | null;
  /** Python interpreter of an environment with the local voice engine (text to speech). Unset = the speech interpreter is tried; narration is not configured when neither has the engine. */
  voicePython: string | null;
  /** Where verified speech model files live. */
  speechModelsDir: string;
  /** Device for speech recognition: auto uses a CUDA device when the engine sees one. */
  speechDevice: 'auto' | 'cpu' | 'cuda';
  /** How long an idle speech worker keeps its model loaded, in seconds (default 120; 0 = a new process for every job). A loaded model holds roughly 2–4 GB of memory. */
  speechKeepSeconds: number;
  /** Licence profile used to decide which capabilities may run. */
  distributionProfile: 'commercial' | 'research';
  // ---- AI-model wave (ADR-0017): local tools, frame jobs and the compute lane ----
  /** Python interpreter of an environment with torch, transformers and sentencepiece for the local tools (PF_TOOLS_PYTHON). Unset = those tools report engine_not_configured. */
  toolsPython: string | null;
  /** Where verified local-tool model files live (PF_TOOLS_MODELS_DIR, default <dataDir>/tool-models). */
  toolsModelsDir: string;
  /** How long an idle local-tool worker keeps its model loaded, in seconds (PF_TOOLS_KEEP_SECONDS, default 60; 0 = a new process for every job). */
  toolsKeepSeconds: number;
  /** Picture search (wave 7 search track): the folder of the pinned SigLIP 2 files (PF_SEARCH_MODEL_DIR). Unset = <library root>/models/search/siglip2-base-patch16-256 when a library root is known, else model_missing. The interpreter is PF_TOOLS_PYTHON. */
  searchModelDir: string | null;
  /** Operator-installed deep-filter 0.5.6 binary (PF_DENOISE_BIN); verified by digest, never installed by the product. Unset = engine_not_configured. */
  denoiseBin: string | null;
  /** Scratch space one AI job may use for staged frames and chunks (PF_AI_SCRATCH_BYTES, default 2 GiB). */
  aiScratchBytes: number;
  /** Host memory a frame chunk may take in the provider, which holds frames as 32-bit floats (PF_AI_HOST_RAM_BUDGET, default 3 GiB). */
  aiHostRamBudgetBytes: number;
  /** A run estimated to take longer than this many minutes needs confirmLongRun, from agents too (PF_AI_CONFIRM_MINUTES, default 10). */
  aiConfirmMinutes: number;
  /** Frames allowed per run until a measured profile exists for this device (PF_AI_FIRST_RUN_FRAMES, default 60). */
  aiFirstRunMaxFrames: number;
  /** Frames one agent-started frame job may process (PF_AI_AGENT_MAX_FRAMES, default 300). */
  agentMaxFramesPerJob: number;
  /** AI jobs an agent may have queued or running at once (PF_AI_AGENT_MAX_QUEUED, default 2). */
  agentMaxQueuedJobs: number;
  // ---- life line (ADR-0021) ----
  /**
   * IANA time zone of the home (PF_HOME_TZ, default Asia/Jerusalem). A file that gives its capture time only as a UTC instant gets
   * the wall clock of this zone, once, at import, and the capture records the zone as assumed. One zone for the whole server:
   * material filmed elsewhere is corrected with the clock shift (shift_asset_captures).
   */
  homeZone: string;
  // ---- phone drop and the import queue (ADR-0023, amends ADR-0002) ----
  /**
   * Port of the phone drop listener (PF_DROP_PORT, default 8788; 0 = any free port). It listens only while an owner-issued code
   * is live, on the one private address the owner confirmed, and serves only the upload page and the upload routes.
   */
  dropPort: number;
  /** Minutes a code waits for a phone, and a connected phone may stay idle before the code closes (PF_DROP_TTL_MINUTES, default 10, 1–60). */
  dropTtlMinutes: number;
  /** Bytes one code may receive in all (PF_DROP_CODE_BYTES, default 16 GiB). */
  dropCodeBytes: number;
  /** Free disk space the door and the import queue leave for everything else (PF_IMPORT_RESERVE_BYTES, default 2 GiB; see importContracts.ts diskReserveRefuses). */
  importReserveBytes: number;
  /**
   * NEVER read from the environment: addresses outside the private ranges that a proof may bind the door to (a launcher script in
   * packages/evals passes them to startServer from its own argv). [] in the product: the door binds only RFC 1918 addresses.
   */
  dropAdmitAddresses: string[];
  // ---- segmented export and render cache (ADR-0024) ----
  /** Size limit of the render cache in <dataDir>/render-cache, in bytes (PF_RENDER_CACHE_BYTES, default 2 GiB; 0 = the cache and the fast export are off). Counted against the storage ceiling like everything in the data directory. */
  renderCacheBytes: number;
  /** Evict least-recently-used segments when free disk space falls below renderCacheMinFreeBytes (PF_RENDER_CACHE_AUTOCLEAR, default on; '0' = off). */
  renderCacheAutoClear: boolean;
  /** Disk space the cache always leaves free while auto-clear is on (PF_RENDER_CACHE_MIN_FREE_BYTES, default 1 GiB). */
  renderCacheMinFreeBytes: number;
  /** libx264 threads of one segment encode (PF_SEGMENT_THREADS, default min(cores, 8)). Part of the encoder id: changing it makes every stored segment a miss. */
  segmentThreads: number;
}
/** The drop port when PF_DROP_PORT is not set. */
export const DEFAULT_DROP_PORT = 8788;
/** The home zone when PF_HOME_TZ is not set. */
export const DEFAULT_HOME_ZONE = 'Asia/Jerusalem';
/** The zone as given when this machine's Intl knows it; refuses to start otherwise (a wrong zone would silently date every import wrongly). */
function homeZoneOf(value: string | undefined): string {
  const zone = value || DEFAULT_HOME_ZONE;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw new Error(`PF_HOME_TZ=${zone} refused: not a time zone this machine knows (use an IANA name such as Asia/Jerusalem or Europe/London)`); }
  return zone;
}
/** Render cache defaults (ADR-0024): 2 GiB of segments, at least 1 GiB of disk left free. */
export const DEFAULT_RENDER_CACHE_BYTES = 2 * 1024 ** 3;
export const DEFAULT_RENDER_CACHE_MIN_FREE_BYTES = 1024 ** 3;
/** min(cores, 8): the thread count is part of the encoder id, so it is fixed per machine, not per job. */
export const defaultSegmentThreads = () => Math.max(1, Math.min(8, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length));
/** Exact publisher hosts model files may come from by default (no wildcards beyond Hugging Face's CDN). Redirect targets must match too. */
export const DEFAULT_MODEL_HOSTS = ['huggingface.co', '.hf.co', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com'];
const num = (v: string | undefined, fallback: number, min = 0) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.max(min, Number(v)) : fallback);
export function loadConfig(env = process.env): Config {
  const host = env.PF_HOST ?? '127.0.0.1';
  const dataDir = path.resolve(env.PF_DATA_DIR ?? path.join(root, '.data'));
  // Phase 0 is the "lightweight local" profile: loopback only. Remote binding needs the hosted auth profile (ADR-0002).
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`PF_HOST=${host} refused: the local profile binds to loopback only`);
  return {
    host,
    port: Number(env.PF_PORT ?? 8787),
    dataDir,
    webDist: path.resolve(env.PF_WEB_DIST ?? path.join(root, 'apps/web/dist')),
    extraOrigins: (env.PF_EXTRA_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').filter(Boolean),
    maxUploadBytes: Number(env.PF_MAX_UPLOAD_BYTES ?? 2 * 1024 ** 3),
    comfyuiUrl: env.PF_COMFYUI_URL || null,
    comfyuiAllowRemote: env.PF_COMFYUI_ALLOW_REMOTE === '1',
    comfyuiModelsDir: env.PF_COMFYUI_MODELS_DIR ? path.resolve(env.PF_COMFYUI_MODELS_DIR) : null,
    modelHosts: env.PF_MODEL_HOSTS !== undefined ? env.PF_MODEL_HOSTS.split(',').filter(Boolean) : [...DEFAULT_MODEL_HOSTS],
    assistantHosts: (env.PF_ASSISTANT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    libraryDir: env.PF_LIBRARY_DIR ? path.resolve(env.PF_LIBRARY_DIR) : null,
    maxStorageBytes: Math.max(0, Number(env.PF_MAX_STORAGE_BYTES ?? 0)) || 0,
    agentRequestsPerMinute: Math.max(0, Number(env.PF_AGENT_RPM ?? 0)) || 0,
    // `loadConfig({})` (test and proof harnesses) also reads PF_MODE from the process, and ONLY that variable: vitest.config.ts
    // and the proof scripts set PF_MODE=guarded, so existing suites keep today's behaviour unless a test asks for open (C14).
    mode: parseMode(env.PF_MODE) ?? parseMode(process.env.PF_MODE) ?? DEFAULT_SERVER_MODE,
    modeFromEnv: parseMode(env.PF_MODE) !== undefined || parseMode(process.env.PF_MODE) !== undefined,
    secureCookie: env.PF_SECURE_COOKIE === '1',
    backupDir: env.PF_BACKUP_DIR ? path.resolve(env.PF_BACKUP_DIR) : null,
    backupEveryHours: Math.max(0, Number(env.PF_BACKUP_EVERY_HOURS ?? 24)) || 0,
    backupKeep: Math.max(1, Math.floor(Number(env.PF_BACKUP_KEEP ?? 14)) || 14),
    // relative paths are taken from the repository root (pnpm runs the server from apps/server)
    speechPython: env.PF_SPEECH_PYTHON ? path.resolve(root, env.PF_SPEECH_PYTHON) : null,
    voicePython: env.PF_VOICE_PYTHON ? path.resolve(root, env.PF_VOICE_PYTHON) : null,
    speechModelsDir: env.PF_SPEECH_MODELS_DIR ? path.resolve(root, env.PF_SPEECH_MODELS_DIR) : path.join(dataDir, 'speech-models'),
    speechDevice: env.PF_SPEECH_DEVICE === 'cpu' || env.PF_SPEECH_DEVICE === 'cuda' ? env.PF_SPEECH_DEVICE : 'auto',
    speechKeepSeconds: env.PF_SPEECH_KEEP_SECONDS !== undefined && Number.isFinite(Number(env.PF_SPEECH_KEEP_SECONDS)) ? Math.max(0, Number(env.PF_SPEECH_KEEP_SECONDS)) : 120,
    distributionProfile: env.PF_PROFILE === 'research' ? 'research' : 'commercial',
    toolsPython: env.PF_TOOLS_PYTHON ? path.resolve(root, env.PF_TOOLS_PYTHON) : null,
    toolsModelsDir: env.PF_TOOLS_MODELS_DIR ? path.resolve(root, env.PF_TOOLS_MODELS_DIR) : path.join(dataDir, 'tool-models'),
    toolsKeepSeconds: num(env.PF_TOOLS_KEEP_SECONDS, 60),
    searchModelDir: env.PF_SEARCH_MODEL_DIR ? path.resolve(root, env.PF_SEARCH_MODEL_DIR) : null,
    denoiseBin: env.PF_DENOISE_BIN ? path.resolve(root, env.PF_DENOISE_BIN) : null,
    aiScratchBytes: num(env.PF_AI_SCRATCH_BYTES, 2 * 1024 ** 3, 1),
    aiHostRamBudgetBytes: num(env.PF_AI_HOST_RAM_BUDGET, 3 * 1024 ** 3, 1),
    aiConfirmMinutes: num(env.PF_AI_CONFIRM_MINUTES, 10),
    aiFirstRunMaxFrames: Math.floor(num(env.PF_AI_FIRST_RUN_FRAMES, 60, 1)),
    agentMaxFramesPerJob: Math.floor(num(env.PF_AI_AGENT_MAX_FRAMES, 300)),
    agentMaxQueuedJobs: Math.floor(num(env.PF_AI_AGENT_MAX_QUEUED, 2)),
    homeZone: homeZoneOf(env.PF_HOME_TZ),
    dropPort: Math.floor(num(env.PF_DROP_PORT, DEFAULT_DROP_PORT)) <= 65535 ? Math.floor(num(env.PF_DROP_PORT, DEFAULT_DROP_PORT)) : DEFAULT_DROP_PORT,
    dropTtlMinutes: Math.min(60, Math.max(1, Math.floor(num(env.PF_DROP_TTL_MINUTES, 10, 1)))),
    dropCodeBytes: Math.floor(num(env.PF_DROP_CODE_BYTES, 16 * 1024 ** 3, 1)),
    importReserveBytes: Math.floor(num(env.PF_IMPORT_RESERVE_BYTES, 2 * 1024 ** 3)),
    dropAdmitAddresses: [],
    renderCacheBytes: Math.floor(num(env.PF_RENDER_CACHE_BYTES, DEFAULT_RENDER_CACHE_BYTES)),
    renderCacheAutoClear: env.PF_RENDER_CACHE_AUTOCLEAR !== '0' && env.PF_RENDER_CACHE_AUTOCLEAR !== 'false',
    renderCacheMinFreeBytes: Math.floor(num(env.PF_RENDER_CACHE_MIN_FREE_BYTES, DEFAULT_RENDER_CACHE_MIN_FREE_BYTES)),
    segmentThreads: Math.floor(num(env.PF_SEGMENT_THREADS, defaultSegmentThreads(), 1)),
  };
}
