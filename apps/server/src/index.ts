import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { RenderHost } from '@pulseframe/renderer';
import type { ProviderAdapter } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Exporter } from './export.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Store } from './store.ts';

export { loadConfig, type Config } from './config.ts';
export interface RunningServer { url: string; cfg: Config; store: Store; auth: Auth; close(): Promise<void> }

export async function startServer(overrides: Partial<Config> = {}, deps: { providerAdapter?: ProviderAdapter } = {}): Promise<RunningServer> {
  const cfg = { ...loadConfig(), ...overrides };
  const store = new Store(cfg.dataDir);
  const auth = new Auth(cfg);
  const host = new RenderHost();
  const url = `http://${cfg.host}:${cfg.port}`;
  const exporter = new Exporter(store, host, () => `${url}/render.html`, cfg.webDist);
  const capabilities = new Capabilities(store, cfg, deps.providerAdapter);
  const app = createApp(cfg, store, auth, exporter, capabilities, createMcp(store, auth, exporter, capabilities));
  const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  if ((server.address() as AddressInfo).port !== cfg.port) throw new Error('unexpected port');
  // Crash recovery: publish any committed-but-unpublished events, restart interrupted jobs.
  store.drainOutbox();
  for (const job of store.recoverJobs('export')) exporter.enqueue(job);
  await capabilities.recover();
  return {
    url, cfg, store, auth,
    async close() {
      await capabilities.stop();
      await new Promise((r) => server.close(r));
      await host.close();
      store.close();
    },
  };
}
