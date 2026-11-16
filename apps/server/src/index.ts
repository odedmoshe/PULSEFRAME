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
import { recoverAnalysisJobs, createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

export { loadConfig, type Config } from './config.ts';
export interface RunningServer { url: string; /** Link that opens the editor as the owner (carries the launch secret). */ ownerUrl: string; cfg: Config; store: Store; auth: Auth; derivatives: Derivatives; governance: Governance; backup: BackupScheduler; close(): Promise<void> }

export async function startServer(overrides: Partial<Config> = {}, deps: { providerAdapter?: ProviderAdapter } = {}): Promise<RunningServer> {
  const cfg = { ...loadConfig(), ...overrides };
  if (overrides.dataDir && !overrides.speechModelsDir && !process.env.PF_SPEECH_MODELS_DIR) cfg.speechModelsDir = path.join(cfg.dataDir, 'speech-models');
  const backup = new BackupScheduler(cfg.dataDir, cfg.backupDir, cfg.backupEveryHours, cfg.backupKeep); // throws on a destination inside the data directory, before anything is opened
  const store = new Store(cfg.dataDir);
  const auth = new Auth(cfg);
  const host = new RenderHost();
  const url = `http://${cfg.host}:${cfg.port}`;
  const exporter = new Exporter(store, host, () => `${url}/render.html`, cfg.webDist);
  const capabilities = new Capabilities(store, cfg, deps.providerAdapter);
  const derivatives = new Derivatives(store);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  capabilities.governance = governance;
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech);
  const app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, governance, backup, speech);
  const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  if ((server.address() as AddressInfo).port !== cfg.port) throw new Error('unexpected port');
  // Crash recovery: publish any committed-but-unpublished events, restart interrupted jobs.
  store.drainOutbox();
  // Browser-route jobs belong to a tab: after a restart their lease is gone, so they are never re-run by the server exporter.
  for (const job of store.recoverJobs('export')) {
    if (job.input.route === 'browser') store.updateJob(job.id, { status: 'failed', stage: null, error: { code: 'lease_lost', message: 'the server restarted while a browser tab owned this export; start a new export', retryable: true } });
    else exporter.enqueue(job);
  }
  await capabilities.recover();
  recoverAnalysisJobs(store);
  speech.recover();
  derivatives.recover();
  backup.start();
  return {
    url, ownerUrl: `${url}/?key=${auth.tokens.owner}`, cfg, store, auth, derivatives, governance, backup,
    async close() {
      (app as any).browserExport?.stop();
      await mcp.close();
      await backup.stop();
      await capabilities.stop();
      await speech.stop();
      await derivatives.stop();
      // Stop accepting, then drop connections that are still open (event streams of pages that were not closed, idle keep-alives):
      // without this, shutdown waited for them indefinitely.
      await new Promise((r) => { server.close(r); (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); });
      await host.close();
      store.close();
    },
  };
}
