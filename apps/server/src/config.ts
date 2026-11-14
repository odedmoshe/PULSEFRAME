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
    distributionProfile: env.PF_PROFILE === 'research' ? 'research' : 'commercial',
  };
}
