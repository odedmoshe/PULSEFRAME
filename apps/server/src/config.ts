import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  /** Ceiling for everything in the data directory (media, derivatives, exports, database), in bytes; 0 = no ceiling (the default). New uploads and exports are refused once it is reached. */
  maxStorageBytes: number;
  /**
   * Requests per minute allowed per agent credential (REST and MCP together); 0 = no limit (the default).
   * Off by default because this is a single-user local tool: local scripts legitimately send hundreds of requests per second
   * (the convergence test and the soak do), and a default limit throttled them. The owner's browser session is never limited.
   */
  agentRequestsPerMinute: number;
  /** Directory for automatic backups (outside the data directory); null = automatic backups off (the default). */
  backupDir: string | null;
  /** Hours between automatic backups when `backupDir` is set (default 24; 0 = off). */
  backupEveryHours: number;
  /** Dated database snapshots to retain (default 14, at least 1). */
  backupKeep: number;
  /** Licence profile used to decide which capabilities may run. */
  distributionProfile: 'commercial' | 'research';
}
export function loadConfig(env = process.env): Config {
  const host = env.PF_HOST ?? '127.0.0.1';
  // Phase 0 is the "lightweight local" profile: loopback only. Remote binding needs the hosted auth profile (ADR-0002).
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`PF_HOST=${host} refused: the local profile binds to loopback only`);
  return {
    host,
    port: Number(env.PF_PORT ?? 8787),
    dataDir: path.resolve(env.PF_DATA_DIR ?? path.join(root, '.data')),
    webDist: path.resolve(env.PF_WEB_DIST ?? path.join(root, 'apps/web/dist')),
    extraOrigins: (env.PF_EXTRA_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').filter(Boolean),
    maxUploadBytes: Number(env.PF_MAX_UPLOAD_BYTES ?? 2 * 1024 ** 3),
    comfyuiUrl: env.PF_COMFYUI_URL || null,
    comfyuiAllowRemote: env.PF_COMFYUI_ALLOW_REMOTE === '1',
    comfyuiModelsDir: env.PF_COMFYUI_MODELS_DIR ? path.resolve(env.PF_COMFYUI_MODELS_DIR) : null,
    modelHosts: (env.PF_MODEL_HOSTS ?? 'huggingface.co,.hf.co').split(',').filter(Boolean),
    maxStorageBytes: Math.max(0, Number(env.PF_MAX_STORAGE_BYTES ?? 0)) || 0,
    agentRequestsPerMinute: Math.max(0, Number(env.PF_AGENT_RPM ?? 0)) || 0,
    backupDir: env.PF_BACKUP_DIR ? path.resolve(env.PF_BACKUP_DIR) : null,
    backupEveryHours: Math.max(0, Number(env.PF_BACKUP_EVERY_HOURS ?? 24)) || 0,
    backupKeep: Math.max(1, Math.floor(Number(env.PF_BACKUP_KEEP ?? 14)) || 14),
    distributionProfile: env.PF_PROFILE === 'research' ? 'research' : 'commercial',
  };
}
