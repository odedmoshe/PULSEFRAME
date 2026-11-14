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

export class RenderHost {
  private browser?: Promise<Browser>;
  version?: string;

  private async launch(): Promise<Browser> {
    this.browser ??= chromium.launch().then((b) => {
      this.version = b.version();
      b.on('disconnected', () => (this.browser = undefined));
      return b;
    });
    return this.browser;
  }
  private async withPage<R>(url: string, fn: (page: Page) => Promise<R>, onAbort?: (abort: () => void) => void): Promise<R> {
    const browser = await this.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Cancellation closes the page context; the pending evaluate rejects and the caller cleans up.
    onAbort?.(() => void context.close().catch(() => {}));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    try {
      await page.addInitScript('globalThis.__name = (f) => f'); // tsx keepNames helper, absent in the page
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__pf, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__pf!.ready);
      return await fn(page);
    } catch (e: any) {
      throw new Error(`render page failed: ${e?.message ?? e}${errors.length ? ` | page errors: ${errors.join(' ; ').slice(0, 600)}` : ''}`);
    } finally {
      await context.close();
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
