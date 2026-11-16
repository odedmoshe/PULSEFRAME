/**
 * Controlled render worker: a pinned headless Chromium that loads the render page (the same
 * evaluator + compositor bundle the editor uses) and drives it. Trusted code only: the page is
 * served by our own server and receives a single-purpose render token, never user credentials.
 */
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
 *   PF_RENDER_GPU=auto    (default) headless with WebGPU enabled. Measured: a software adapter on the Linux development
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

export class RenderHost {
  private browser?: Promise<Browser>;
  version?: string;

  private async launch(): Promise<Browser> {
    this.browser ??= chromium.launch(workerLaunchOptions()).then((b) => {
      this.version = b.version();
      b.on('disconnected', () => (this.browser = undefined));
      return b;
    });
    return this.browser;
  }
  private async withPage<R>(url: string, fn: (page: Page) => Promise<R>, onAbort?: (abort: () => void) => void): Promise<R> {
    const browser = await this.launch();
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
      if (!closed) { this.browser = undefined; void browser.close().catch(() => {}); }
    }
  }
  async renderStill(url: string, frameIndex: number): Promise<Buffer> {
    const b64 = await this.withPage(url, (p) => p.evaluate((i) => window.__pf!.renderPng(i), frameIndex));
    return Buffer.from(b64, 'base64');
  }
  async renderAll(url: string, onAbort?: (abort: () => void) => void): Promise<ExportStats> {
    return this.withPage(url, (p) => p.evaluate(() => window.__pf!.exportAll()), onAbort);
  }
  async close() {
    const b = await this.browser?.catch(() => undefined);
    this.browser = undefined;
    await b?.close();
  }
}
