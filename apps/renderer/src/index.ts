/**
 * Controlled render worker: a pinned headless Chromium that loads the render page (the same
 * evaluator + compositor bundle the editor uses) and drives it. Trusted code only: the page is
 * served by our own server and receives a single-purpose render token, never user credentials.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';

export interface ExportStats { frames: number; stageMs: { draw: number; readback: number; upload: number } }
declare global {
  interface Window {
    __pf?: { ready: Promise<{ frameCount: number }>; renderPng(index: number): Promise<string>; exportAll(): Promise<ExportStats> };
  }
}

/**
 * How the worker browser is started (ADR-0008). Whether it can use WebGPU is a property of the machine, measured by
 * `pnpm probe:gpu`; nothing here is assumed to work, and the render page proves its adapter before using it.
 *   (unset)               headless with WebGPU enabled for ordinary renders; for a project that uses a GPU effect the host
 *                         finds, once, the first of auto / window / chrome that yields a working device, and uses that.
 *   PF_RENDER_GPU=auto    always headless with WebGPU enabled. Measured: a software adapter on the Linux development
 *                         container; no adapter on the owner's Windows laptop (GPU effects are then refused at export).
 *   PF_RENDER_GPU=window  a real window placed off-screen, asking for the high-performance GPU. Measured on that laptop:
 *                         a hardware adapter (the discrete card). Needs a desktop session.
 *   PF_RENDER_GPU=chrome  the installed Chrome instead of the bundled Chromium, headless with the GPU enabled. Measured on
 *                         that laptop: a hardware adapter. Text is then shaped by that Chrome's version, not the pinned one.
 *   PF_RENDER_GPU=off     plain headless, no WebGPU flags (the behaviour before ADR-0008).
 */
export function workerLaunchOptions(mode = process.env.PF_RENDER_GPU ?? 'auto'): { args?: string[]; headless?: boolean; channel?: string } {
  if (mode === 'off') return {};
  if (mode === 'window') return { headless: false, args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu', '--window-position=-32000,-32000', '--window-size=320,240', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] };
  if (mode === 'chrome') return { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] };
  return { args: ['--enable-unsafe-webgpu'] };
}

/** Launch modes tried, in order, when a render needs a graphics adapter and PF_RENDER_GPU is not set. A window needs a desktop session. */
const gpuCandidates = (): string[] => ['auto', ...(process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? ['window'] : []), 'chrome'];
/** Can this browser create a WebGPU device? (On the owner's laptop the headless browser finds an adapter with some flags and then fails here.) */
async function hasGpuDevice(browser: Browser): Promise<boolean> {
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>gpu check</title>'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); // WebGPU exists only on a secure origin; loopback counts
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`);
    return await Promise.race([
      page.evaluate('(async () => { try { const a = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" }); if (!a) return false; const d = await a.requestDevice(); d.destroy(); return true; } catch { return false; } })()') as Promise<boolean>,
      new Promise<boolean>((r) => setTimeout(() => r(false), 20_000).unref()),
    ]);
  } catch { return false; } finally { await context.close().catch(() => {}); srv.close(); }
}

/**
 * Who renders a job (ADR-0024): the browser's version, the launch mode it was started with, and — for a render that uses GPU
 * effects — the WebGPU adapter it found. Part of the render cache's engine fingerprint (`browser` = `${version}|launch=${launch}`),
 * because the worker is chosen per document (a project with one GPU effect is drawn by the GPU browser throughout).
 */
export interface WorkerIdentity {
  version: string;
  /** auto | window | chrome | off (PF_RENDER_GPU, or the mode the GPU search found). */
  launch: string;
  /** `${vendor}|${architecture}|${device}|${description}` of the adapter a GPU pass runs on; null for a render without GPU effects or when no device was found. */
  adapter: string | null;
  /** The adapter is a software rasteriser (fallback adapter, SwiftShader, llvmpipe, WARP): only then are GPU frames cacheable in wave 1. */
  softwareAdapter: boolean;
}
/** Words in an adapter's description that name a software rasteriser. */
const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|softpipe|microsoft basic render|\bwarp\b/i;
/** The WebGPU adapter of a browser as the render page would request it, or null when there is none. */
async function adapterOf(browser: Browser): Promise<{ adapter: string; software: boolean } | null> {
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>gpu identity</title>'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`);
    const info = await Promise.race([
      page.evaluate('(async () => { try { const a = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" }); if (!a) return null; const i = a.info ?? {}; return { vendor: i.vendor ?? "", architecture: i.architecture ?? "", device: i.device ?? "", description: i.description ?? "", fallback: i.isFallbackAdapter === true || a.isFallbackAdapter === true }; } catch { return null; } })()') as Promise<{ vendor: string; architecture: string; device: string; description: string; fallback: boolean } | null>,
      new Promise<null>((r) => setTimeout(() => r(null), 20_000).unref()),
    ]);
    if (!info) return null;
    const adapter = `${info.vendor}|${info.architecture}|${info.device}|${info.description}`;
    return { adapter, software: info.fallback || SOFTWARE_ADAPTER.test(adapter) };
  } catch { return null; } finally { await context.close().catch(() => {}); srv.close(); }
}

export class RenderHost {
  private browser?: Promise<Browser>;
  /** The browser for renders that need a graphics adapter, once one was found; `null` when none of the launch modes gave a device. */
  private gpuBrowser?: Promise<Browser | null>;
  /** Which launch mode gave the GPU browser, for diagnostics ('none' when the search failed). */
  gpuMode?: string;
  version?: string;
  private identities = new Map<boolean, Promise<WorkerIdentity>>();

  private async launch(): Promise<Browser> {
    this.browser ??= chromium.launch(workerLaunchOptions()).then((b) => {
      this.version = b.version();
      b.on('disconnected', () => { this.browser = undefined; this.identities.clear(); });
      return b;
    });
    return this.browser;
  }
  /**
   * The browser for a render that uses a GPU effect. With PF_RENDER_GPU set, that is simply the configured browser. Otherwise
   * the launch modes are tried once, in order, and the first whose browser can create a WebGPU device is kept. When none can,
   * the ordinary browser is returned: the render page then refuses the frame with the reason, as it must.
   */
  private async launchGpu(): Promise<Browser> {
    if (process.env.PF_RENDER_GPU) return this.launch();
    this.gpuBrowser ??= (async () => {
      const plain = await this.launch();
      if (await hasGpuDevice(plain)) { this.gpuMode = 'auto'; return plain; }
      for (const mode of gpuCandidates().slice(1)) {
        let b: Browser | undefined;
        try {
          b = await chromium.launch({ ...workerLaunchOptions(mode), timeout: 30_000 });
          if (await hasGpuDevice(b)) {
            this.gpuMode = mode;
            console.log(`render worker: GPU effects use launch mode "${mode}" (${b.version()})`);
            b.on('disconnected', () => { this.gpuBrowser = undefined; this.identities.delete(true); });
            return b;
          }
        } catch { /* this mode cannot start here (no display, no installed Chrome): try the next */ }
        await b?.close().catch(() => {});
      }
      this.gpuMode = 'none';
      console.log('render worker: no launch mode gave a WebGPU device on this machine; renders that use GPU effects will be refused (see `pnpm probe:gpu`)');
      return null;
    })();
    return (await this.gpuBrowser) ?? this.launch();
  }
  private async withPage<R>(url: string, fn: (page: Page) => Promise<R>, onAbort?: (abort: () => void) => void, gpu = false): Promise<R> {
    const browser = gpu ? await this.launchGpu() : await this.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Cancellation closes the page context and ends the wait here at once. The wait must not depend on the page calls
    // settling: a context closed while its page is still being opened can leave that call pending for good (seen with
    // Playwright 1.63), which used to hold the export queue until the server was restarted.
    // The caller may abort from inside the callback (a cancel that arrived before there was anything to close).
    let abort!: () => void;
    const aborted = new Promise<never>((_, reject) => { abort = () => reject(new Error('aborted')); });
    aborted.catch(() => {});
    onAbort?.(() => { abort(); void context.close().catch(() => {}); });
    const errors: string[] = [];
    const work = (async () => {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.addInitScript('globalThis.__name = (f) => f'); // tsx keepNames helper, absent in the page
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__pf, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__pf!.ready);
      return await fn(page);
    })();
    work.catch(() => {}); // when the abort wins the race, the page work fails (or never settles) on its own
    try {
      return await Promise.race([work, aborted]);
    } catch (e: any) {
      throw new Error(`render page failed: ${e?.message ?? e}${errors.length ? ` | page errors: ${errors.join(' ; ').slice(0, 600)}` : ''}`);
    } finally {
      // Closing is bounded too. A context that will not close means the browser is in a bad state: drop it, the next render starts a fresh one.
      const closed = await Promise.race([context.close().then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000).unref())]);
      if (!closed) { if (await this.browser?.catch(() => undefined) === browser) this.browser = undefined; else this.gpuBrowser = undefined; void browser.close().catch(() => {}); }
    }
  }
  /**
   * The identity of the browser that renders a job with (`gpu` = usesGpuEffects(doc), as the export decides) or without GPU effects.
   * Launches lazily, like a render would, and is cached until that browser goes away.
   */
  identity(gpu: boolean): Promise<WorkerIdentity> {
    let p = this.identities.get(gpu);
    if (!p) {
      p = (async () => {
        const browser = gpu ? await this.launchGpu() : await this.launch();
        const configured = process.env.PF_RENDER_GPU;
        const launch = configured || (gpu && this.gpuMode && this.gpuMode !== 'none' ? this.gpuMode : 'auto');
        const found = gpu ? await adapterOf(browser) : null;
        return { version: browser.version(), launch, adapter: found?.adapter ?? null, softwareAdapter: found?.software ?? false };
      })();
      p.catch(() => this.identities.delete(gpu));
      this.identities.set(gpu, p);
    }
    return p;
  }
  async renderStill(url: string, frameIndex: number, opts: { gpu?: boolean } = {}): Promise<Buffer> {
    const b64 = await this.withPage(url, (p) => p.evaluate((i) => window.__pf!.renderPng(i), frameIndex), undefined, !!opts.gpu);
    return Buffer.from(b64, 'base64');
  }
  async renderAll(url: string, onAbort?: (abort: () => void) => void, opts: { gpu?: boolean } = {}): Promise<ExportStats> {
    return this.withPage(url, (p) => p.evaluate(() => window.__pf!.exportAll()), onAbort, !!opts.gpu);
  }
  async close() {
    const b = await this.browser?.catch(() => undefined);
    const g = await this.gpuBrowser?.catch(() => undefined);
    this.browser = undefined;
    this.gpuBrowser = undefined;
    await b?.close();
    if (g && g !== b) await g.close().catch(() => {});
  }
}
