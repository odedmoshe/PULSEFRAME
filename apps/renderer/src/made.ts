/**
 * The made-clip harness «קליפ מקוד» (wave 8 `motioncode`, plan §3.5 and §4.1 with verify C1, C5, C6 as amended). `MadeHost` draws a
 * page of code frame by frame in a SEPARATE browser (never the export browser, whose pages hold render tokens) and hands every frame
 * to the caller as a PNG with transparency. It knows nothing of projects or the store: the server (apps/server/src/made/) gives it the
 * page, the typed values and a resolver for the few files a page may load, and does the encoding and the checks.
 *
 * What a page sees (core MadePageGlobals): a frozen `window.PF` (v, width, height, fps, frames, fields) on which the page may set
 * `PF.render(frame, t)`. For each frame the harness: sets the frame's time (the clock the page reads is the frame's time, below),
 * runs the animation-frame callbacks queued since the last frame with that time, awaits `PF.render`, seeks every document
 * animation (CSS @keyframes and transitions, Web Animations) to frame·den/num s and writes its values into inline style (the
 * animation is set aside until the next frame, so no layer keeps the raster history of earlier frames), pauses and seeks every
 * SVG's SMIL timeline, awaits fonts, then takes the screenshot. Fonts named by the server are loaded BEFORE frame 0 (verify C6 order bug).
 *
 * The clock and random numbers are NOT enforcement (verify C6): the page sees the frame's time in Date, performance.now and animation
 * frames, and a random sequence seeded by the frame number, so a page that uses them still draws each frame from its number only.
 * Every use is RECORDED with its API and first frame (warning made_clock); nothing throws. Channels this does not cover (Intl
 * formatting of "now", Event.timeStamp, document.lastModified, setTimeout) are recorded where they can be, and the determinism pass
 * is the judge.
 *
 * Network: launch arguments + the route (only https://made.invalid is answered; everything else aborted) + the page CSP + the
 * init-script lock of madeLaunch.ts (constructors deleted in every frame). The judge is Chromium's net-log (gate G0, proof G3).
 *
 * WebGL (measured here 2026-11-26, see MADE_WEBGL_ARGS in madeLaunch.ts): pages may draw with WebGL; it runs on the software renderer.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { MADE_CHROMIUM_ARGS, MADE_INIT_NETWORK_LOCK, MADE_ORIGIN, MADE_PAGE_CSP, MADE_WEBGL_ARGS, findSetpriv, madeLaunchPlan, writeDropPrivilegeWrapper, type MadeLaunchPlan, type MadeSandbox } from './madeLaunch.ts';

/** A file the route serves at https://made.invalid<path> (fonts, pinned libraries, the owner's media, fetched copies). */
export interface MadeServedFile { body: Buffer; contentType: string }
/** Why a draw stopped: the keys of core MADE_JOB_FAILURES the harness can raise (the server turns them into words). */
export type MadeDrawFailure = 'frameTimeout' | 'crashed' | 'jobTimeout' | 'navigated' | 'canceled';
export class MadeDrawError extends Error {
  constructor(readonly why: MadeDrawFailure, readonly frame: number | null, message: string, readonly detail?: string) { super(message); }
}

export interface MadeDrawSpec {
  /** The page text, as served (the server has already replaced fetched internet addresses with their local copies). */
  page: string;
  width: number; height: number; fps: { num: number; den: number }; frames: number;
  /** Typed values only: text as string, colour as '#rrggbb', number as number. */
  fields: Record<string, string | number>;
  /** Files below https://made.invalid (path starts with '/'), or null = aborted like any other request. Called by the route. */
  file: (urlPath: string) => Promise<MadeServedFile | null> | MadeServedFile | null;
  /** Catalogue faces to register and load before frame 0: one per family, weight and subset file. */
  fonts: readonly { family: string; weight: number; url: string; unicodeRange?: string; /** loaded and checked before frame 0 (the page names this family); the others load when used */ preload?: boolean }[];
  /** Families of the catalogue (used-font check: any other family named by the page is reported). */
  catalogueFamilies: readonly string[];
  /** Frames compared in the second pass (fixed and seeded; the caller picks them). */
  compareFrames: readonly number[];
  /** Budgets (MADE_LIMITS.frameMs and jobMs in the product). */
  frameMs: number; jobMs: number;
  /** Each frame of the first pass, in order. Back-pressure: the next frame is drawn when this resolves. */
  onFrame: (index: number, png: Buffer) => Promise<void> | void;
  signal?: AbortSignal;
}
export interface MadeDrawResult {
  browser: string;
  sandbox: MadeSandbox;
  /** Set when the browser ran without Chromium's sandbox (warning made_no_sandbox). */
  sandboxWarning?: { he: string; en: string };
  /** First use of each clock or random API, with its frame (warning made_clock). */
  clock: { api: string; frame: number }[];
  /** Families the page named that are not in the catalogue (warning made_font_missing). */
  missingFonts: string[];
  /** `document.fonts.check` for each loaded face before frame 0 (e.g. "700 40px \"Heebo\"": true). */
  fontsChecked: Record<string, boolean>;
  /** The page created a WebGL context. */
  webgl: boolean;
  /** Paths below https://made.invalid that were served (libraries and assets used). */
  served: string[];
  /** The PNGs of the compared frames in both passes (equal bytes need no decoding; the caller compares pixels when they differ). */
  compared: { frame: number; a: Buffer; b: Buffer; equalBytes: boolean }[];
  /** Most document animations seen in one frame (MADE_LIMITS.animations is informative: the frame budget bounds the seek). */
  maxAnimations: number;
  /** Uncaught page errors, first few (the page may still draw). */
  pageErrors: string[];
}

/** The script that runs before the page's own, in every frame (main frame and iframes). */
export function madeInitScript(g: { width: number; height: number; fps: { num: number; den: number }; frames: number; fields: Record<string, string | number> }, fonts: MadeDrawSpec['fonts']): string {
  return `${MADE_INIT_NETWORK_LOCK}
(() => {
  const G = ${JSON.stringify({ v: 1, width: g.width, height: g.height, fps: g.fps, frames: g.frames, fields: g.fields })};
  const W = globalThis;
  const state = { frame: 0, t: 0, used: [], seen: new Set(), webgl: false, families: new Set(), errors: [] };
  const note = (api) => { if (!state.seen.has(api)) { state.seen.add(api); state.used.push({ api, frame: state.frame }); } };
  // ---- PF: frozen; render is the one slot the page sets ----
  let render;
  const PF = { v: G.v, width: G.width, height: G.height, fps: Object.freeze({ ...G.fps }), frames: G.frames, fields: Object.freeze({ ...G.fields }) };
  Object.defineProperty(PF, 'render', { get: () => render, set: (f) => { render = typeof f === 'function' ? f : undefined; }, enumerable: true });
  Object.freeze(PF);
  try { Object.defineProperty(W, 'PF', { value: PF, writable: false, configurable: false, enumerable: true }); } catch {}
  // ---- the clock is the frame's time; every use is recorded ----
  const EPOCH = Date.UTC(2026, 0, 1);
  const RealDate = Date;
  const ms = () => state.t * 1000;
  function FrameDate(...a) {
    if (!new.target) { note('Date'); return new RealDate(EPOCH + ms()).toString(); }
    if (a.length === 0) { note('new Date()'); return new RealDate(EPOCH + ms()); }
    return new RealDate(...a);
  }
  FrameDate.prototype = RealDate.prototype;
  FrameDate.now = () => { note('Date.now'); return EPOCH + ms(); };
  FrameDate.parse = RealDate.parse; FrameDate.UTC = RealDate.UTC;
  try { W.Date = FrameDate; } catch {}
  try { const perf = W.performance; const pnow = () => { note('performance.now'); return ms(); }; Object.defineProperty(perf, 'now', { value: pnow, configurable: false }); Object.defineProperty(perf, 'timeOrigin', { get: () => { note('performance.timeOrigin'); return EPOCH; }, configurable: false }); } catch {}
  let seed = 1;
  const reseed = (f) => { seed = (f * 2654435761 + 1013904223) >>> 0 || 1; };
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  try { Math.random = () => { note('Math.random'); return rnd(); }; } catch {}
  try { const c = W.crypto; const grv = c.getRandomValues.bind(c); c.getRandomValues = (a) => { note('crypto.getRandomValues'); const r = grv(a); const v = new Uint8Array(r.buffer, r.byteOffset, r.byteLength); for (let i = 0; i < v.length; i++) v[i] = Math.floor(rnd() * 256); return r; }; c.randomUUID = () => { note('crypto.randomUUID'); const h = Array.from({ length: 32 }, () => Math.floor(rnd() * 16).toString(16)).join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); }; } catch {}
  const queue = new Map(); let rafId = 0;
  const seen = new Set(); const committed = [];
  W.requestAnimationFrame = (cb) => { note('requestAnimationFrame'); queue.set(++rafId, cb); return rafId; };
  W.cancelAnimationFrame = (id) => { queue.delete(id); };
  for (const k of ['setTimeout', 'setInterval', 'requestIdleCallback']) { const real = W[k]; if (typeof real === 'function') W[k] = function (...a) { note(k); return real.apply(this, a); }; }
  try { const tl = Object.getOwnPropertyDescriptor(AnimationTimeline.prototype, 'currentTime'); Object.defineProperty(DocumentTimeline.prototype, 'currentTime', { get() { note('document.timeline'); return tl.get.call(this); }, configurable: true }); } catch {}
  try { const RF = Intl.DateTimeFormat; const fd = Object.getOwnPropertyDescriptor(RF.prototype, 'format'); Object.defineProperty(RF.prototype, 'format', { get() { const f = fd.get.call(this); return (d) => { if (d === undefined) { note('Intl.DateTimeFormat'); d = EPOCH + ms(); } return f(d); }; }, configurable: true }); } catch {}
  try { Object.defineProperty(Document.prototype, 'lastModified', { get() { note('document.lastModified'); return '01/01/2026 00:00:00'; }, configurable: true }); } catch {}
  try { if (W.Temporal && W.Temporal.Now) for (const k of Object.keys(W.Temporal.Now)) { const f = W.Temporal.Now[k]; W.Temporal.Now[k] = (...a) => { note('Temporal.Now.' + k); return f(...a); }; } } catch {}
  // ---- what the page uses: WebGL, font families ----
  try { const gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...a) { if (/webgl|experimental-webgl/.test(String(type))) state.webgl = true; return gc.call(this, type, ...a); }; } catch {}
  try { const oc = W.OffscreenCanvas && OffscreenCanvas.prototype.getContext; if (oc) OffscreenCanvas.prototype.getContext = function (type, ...a) { if (/webgl/.test(String(type))) state.webgl = true; return oc.call(this, type, ...a); }; } catch {}
  const familiesOf = (font) => { const m = /(?:^|\\s)(\\d+(?:\\.\\d+)?(?:px|pt|em|rem|%)(?:\\s*\\/\\s*\\S+)?)\\s+(.+)$/.exec(String(font)); return m ? m[2] : ''; };
  try { const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font'); Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { get() { return d.get.call(this); }, set(v) { const f = familiesOf(v); if (f) state.families.add(f); d.set.call(this, v); }, configurable: true }); } catch {}
  W.addEventListener('error', (e) => { if (state.errors.length < 5) state.errors.push(String(e.message || e.error)); });
  W.addEventListener('unhandledrejection', (e) => { if (state.errors.length < 5) state.errors.push(String(e.reason && e.reason.message || e.reason)); });
  // ---- the catalogue faces (registered here; the CSP's font-src names https://made.invalid/fonts/ only) ----
  const faces = ${JSON.stringify(fonts)};
  const loaded = [];
  try { for (const f of faces) { const ff = new FontFace(f.family, 'url(' + f.url + ')', { weight: String(f.weight), style: 'normal', display: 'block', ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) }); document.fonts.add(ff); if (f.preload) loaded.push([f, ff]); } } catch (e) { state.errors.push('fonts: ' + e); }
  if (W !== W.top) return; // the harness drives the main frame only
  // ---- the harness's handle (non-writable; the page can call it, which only draws a frame) ----
  const harness = {
    async fonts() {
      await Promise.allSettled(loaded.map(([, ff]) => ff.load()));
      await document.fonts.ready;
      const out = {};
      for (const [f] of loaded) { const k = f.weight + ' 40px "' + f.family + '"'; out[k] = document.fonts.check(k); }
      return out;
    },
    async step(frame) {
      state.frame = frame; state.t = frame * G.fps.den / G.fps.num; reseed(frame);
      const due = [...queue.values()]; queue.clear();
      for (const cb of due) { try { cb(ms()); } catch (e) { if (state.errors.length < 5) state.errors.push(String(e && e.message || e)); } }
      if (render) await render(frame, state.t);
      // Animations are seeked, then their values are written into the elements' inline style and the animations are set aside
      // until the next frame. A layer that a running animation promoted kept the raster scale of its history, so a frame seeked
      // after a later one drew an edge differently than in order (measured on «שורת שם»: frame 2 after frame 15, 2 pixels);
      // static styles are drawn the same whatever came before. The page's own inline values of those properties are put back
      // before each frame.
      for (const [el, prop, value, prio] of committed.splice(0).reverse()) { if (value) el.style.setProperty(prop, value, prio); else el.style.removeProperty(prop); }
      for (const a of document.getAnimations()) seen.add(a);
      const anims = [...seen];
      for (const a of anims) {
        try { a.play(); a.pause(); a.currentTime = ms(); } catch { continue; }
        const el = a.effect && a.effect.target;
        if (!el || !el.style || !el.isConnected || typeof a.commitStyles !== 'function') continue;
        const props = new Set();
        try { for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) props.add(p.startsWith('--') ? p : p === 'cssFloat' ? 'float' : p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); } catch {}
        for (const p of props) committed.push([el, p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
        try { a.commitStyles(); a.cancel(); } catch {}
      }
      for (const s of document.querySelectorAll('svg')) { try { if (s.pauseAnimations) { s.pauseAnimations(); s.setCurrentTime(state.t); } } catch {} }
      await document.fonts.ready;
      return anims.length;
    },
    report() {
      const fam = new Set(state.families);
      // the browser's own default face is not something the page named
      let def = '';
      try { const probe = document.createElement('span'); probe.style.fontFamily = 'initial'; (document.body || document.documentElement).append(probe); def = getComputedStyle(probe).fontFamily; probe.remove(); } catch {}
      for (const el of document.querySelectorAll('*')) { const f = getComputedStyle(el).fontFamily; if (f && f !== def) fam.add(f); }
      return { used: state.used.slice(), webgl: state.webgl, families: [...fam], errors: state.errors.slice() };
    },
  };
  Object.defineProperty(W, '__pfMade', { value: Object.freeze(harness), writable: false, configurable: false, enumerable: false });
})();`;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset']);
/** Family names in a CSS font-family list that are neither in the catalogue nor generic (pure; unit-tested). */
export function unlistedFamilies(lists: readonly string[], catalogue: readonly string[]): string[] {
  const known = new Set(catalogue.map((f) => f.toLowerCase()));
  const out = new Set<string>();
  for (const list of lists) for (const raw of list.split(',')) {
    const f = raw.trim().replace(/^["']|["']$/g, '').trim();
    if (f && !GENERIC.has(f.toLowerCase()) && !known.has(f.toLowerCase())) out.add(f);
  }
  return [...out].sort();
}
/** The frames compared between the two passes: 0, ⌊n/2⌋, n−1, then up to three more drawn from `seed` (verify C6); pure. */
export function madeCompareFrames(n: number, seed: string, max = 6): number[] {
  const out: number[] = [];
  for (const f of [0, Math.floor(n / 2), n - 1]) if (f >= 0 && !out.includes(f)) out.push(f);
  let h = createHash('sha256').update(seed).digest();
  for (let i = 0; out.length < Math.min(max, n) && i < 64; i++) {
    if (i % 8 === 0 && i) h = createHash('sha256').update(h).digest();
    const f = h.readUInt32BE((i % 8) * 4) % n;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

const withTimeout = <T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> => {
  let t: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => { t = setTimeout(() => reject(onTimeout()), ms); t.unref?.(); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};

export interface MadeHostOptions {
  /** TESTS ONLY: run without Chromium's sandbox (labelled 'none' with its warning). Never set by the product. */
  noSandboxForTests?: boolean;
  /** Where the privilege-drop wrapper is written (Linux as root); default os.tmpdir()/pf-made-<pid>. */
  workDir?: string;
}

/**
 * The made browser. One per server; launched lazily; one fresh context per draw; a context that will not close within 5 s, or a
 * crash, drops the browser so the next draw starts a new one. The export browser (RenderHost) is never touched.
 */
export class MadeHost {
  private browser?: Promise<{ browser: Browser; plan: MadeLaunchPlan }>;
  /** the wrapper's folder this host made (removed on close) */
  private madeDir?: string;
  constructor(private readonly opts: MadeHostOptions = {}) {}

  /** How the browser is (or would be) started, from facts (no launch). */
  plan(): MadeLaunchPlan {
    if (this.opts.noSandboxForTests) return { sandbox: 'none', chromiumSandbox: false, warning: { he: 'הדפדפן רץ בלי ארגז החול של כרום (הרצת בדיקה)', en: 'the browser runs without Chromium\'s sandbox (a test run)' } };
    return madeLaunchPlan({ platform: process.platform, uid: process.getuid?.() ?? null, setprivPath: findSetpriv() });
  }

  private async launch(): Promise<{ browser: Browser; plan: MadeLaunchPlan }> {
    this.browser ??= (async () => {
      const plan = this.plan();
      const args = [...MADE_CHROMIUM_ARGS, ...MADE_WEBGL_ARGS];
      let executablePath: string | undefined;
      if (plan.dropToUid !== undefined) {
        const full = chromium.executablePath();
        const shell = full.replace(/chromium-(\d+)\/chrome-linux64\/chrome$/, 'chromium_headless_shell-$1/chrome-headless-shell-linux64/chrome-headless-shell');
        const exe = existsSync(shell) ? shell : full;
        const dir = this.opts.workDir ?? path.join(os.tmpdir(), `pf-made-${process.pid}`);
        await mkdir(dir, { recursive: true });
        await chmod(dir, 0o711);
        if (!this.opts.workDir) this.madeDir = dir;
        executablePath = await writeDropPrivilegeWrapper(path.join(dir, 'bin'), exe, plan.dropToUid, findSetpriv()!);
      }
      const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), chromiumSandbox: plan.chromiumSandbox, args, timeout: 60_000 });
      browser.on('disconnected', () => { this.browser = undefined; });
      return { browser, plan };
    })();
    this.browser.catch(() => { this.browser = undefined; });
    return this.browser;
  }
  /** Drop the browser (after a context that would not close, or a crash). */
  private async drop(browser: Browser): Promise<void> {
    const cur = await this.browser?.catch(() => undefined);
    if (cur?.browser === browser) this.browser = undefined;
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000).unref())]);
  }

  /** A fresh context with the route, the init script and the page loaded; resolves once fonts are loaded. */
  private async open(browser: Browser, spec: MadeDrawSpec, served: Set<string>, fail: (e: MadeDrawError) => void): Promise<{ context: BrowserContext; page: Page; fontsChecked: Record<string, boolean> }> {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false,
      permissions: [], bypassCSP: false, javaScriptEnabled: true, locale: 'he-IL', timezoneId: 'UTC',
    });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (!url.startsWith(MADE_ORIGIN + '/')) return route.abort();
      const p = decodeURIComponent(new URL(url).pathname);
      if (p === '/page.html') return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': MADE_PAGE_CSP, 'cache-control': 'no-store' }, body: spec.page });
      let f: MadeServedFile | null = null;
      try { f = await spec.file(p); } catch { f = null; }
      if (!f) return route.abort();
      served.add(p);
      return route.fulfill({ status: 200, headers: { 'content-type': f.contentType, 'access-control-allow-origin': MADE_ORIGIN }, body: f.body });
    });
    await context.routeWebSocket('**', (ws) => ws.close());
    await context.addInitScript(madeInitScript(spec, spec.fonts));
    const page = await context.newPage();
    context.on('page', (pg) => { if (pg !== page) void pg.close().catch(() => {}); });
    page.on('crash', () => fail(new MadeDrawError('crashed', null, 'the page crashed while drawing (probably memory)')));
    let loaded = false;
    page.on('framenavigated', (fr) => { if (loaded && fr === page.mainFrame()) fail(new MadeDrawError('navigated', null, 'the page navigated away while drawing')); });
    await page.goto(`${MADE_ORIGIN}/page.html`, { waitUntil: 'load', timeout: Math.max(spec.frameMs * 5, 30_000) });
    loaded = true;
    const fontsChecked = await page.evaluate(() => (window as any).__pfMade.fonts()) as Record<string, boolean>;
    return { context, page, fontsChecked };
  }

  /**
   * Draw every frame (pass A, in order, each handed to onFrame), then the compared frames again in a fresh context (pass B, out
   * of order: last, first, middle, then the seeded ones). Throws MadeDrawError for a fact about the page (timeout, crash,
   * navigation), for the job budget, and for a cancel.
   */
  async draw(spec: MadeDrawSpec): Promise<MadeDrawResult> {
    if (spec.signal?.aborted) throw new MadeDrawError('canceled', null, 'drawing was stopped');
    const { browser, plan } = await this.launch();
    const deadline = Date.now() + spec.jobMs;
    const served = new Set<string>();
    let failure: MadeDrawError | null = null;
    let wake: ((e: MadeDrawError) => void) | null = null;
    const failed = new Promise<never>((_, reject) => { wake = reject; });
    failed.catch(() => {});
    const fail = (e: MadeDrawError) => { if (!failure) { failure = e; wake?.(e); } };
    const onAbort = () => fail(new MadeDrawError('canceled', null, 'drawing was stopped'));
    spec.signal?.addEventListener('abort', onAbort, { once: true });
    const jobTimer = setTimeout(() => fail(new MadeDrawError('jobTimeout', null, `drawing took longer than ${Math.round(spec.jobMs / 60000)} minutes and was stopped`)), spec.jobMs);
    jobTimer.unref?.();
    const contexts: BrowserContext[] = [];
    let browserBad = false;
    // Every await on the page races the failure: a crash, a navigation, a cancel or the job budget ends the wait at once.
    const guard = <T>(p: Promise<T>): Promise<T> => { p.catch(() => {}); return Promise.race([p, failed]); };
    const frameStep = async (page: Page, frame: number): Promise<{ png: Buffer; animations: number }> => {
      const left = Math.max(1, Math.min(spec.frameMs, deadline - Date.now()));
      const work = (async () => {
        const animations = await page.evaluate((f) => (window as any).__pfMade.step(f), frame) as number;
        const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: spec.width, height: spec.height }, timeout: left });
        return { png, animations };
      })();
      try {
        return await guard(withTimeout(work, left, () => new MadeDrawError('frameTimeout', frame, `the page did not finish drawing frame ${frame} within ${spec.frameMs / 1000} seconds`)));
      } catch (e) {
        if (e instanceof MadeDrawError) throw e;
        // a navigation destroys the page's context before Playwright reports the frame as navigated (proof:made G3.4 saw "crashed"):
        // give the event a moment, then name it from the error
        if (!failure) await new Promise((r) => setTimeout(r, 300));
        if (failure) throw failure;
        if (/context was destroyed|navigat/i.test(String((e as Error)?.message ?? e))) throw new MadeDrawError('navigated', frame, 'the page navigated away while drawing');
        if ((e as Error)?.name === 'TimeoutError' || /Timeout \d+ms exceeded/i.test(String((e as Error)?.message ?? e))) throw new MadeDrawError('frameTimeout', frame, `the page did not finish drawing frame ${frame} within ${spec.frameMs / 1000} seconds`);
        throw new MadeDrawError('crashed', frame, 'the page crashed while drawing (probably memory)', String((e as Error)?.message ?? e).slice(0, 300));
      }
    };
    const result: MadeDrawResult = { browser: browser.version(), sandbox: plan.sandbox, ...(plan.warning ? { sandboxWarning: plan.warning } : {}), clock: [], missingFonts: [], fontsChecked: {}, webgl: false, served: [], compared: [], maxAnimations: 0, pageErrors: [] };
    try {
      const a = await guard(this.open(browser, spec, served, fail));
      contexts.push(a.context);
      result.fontsChecked = a.fontsChecked;
      const keep = new Map<number, Buffer>();
      for (let i = 0; i < spec.frames; i++) {
        if (failure) throw failure;
        const { png, animations } = await frameStep(a.page, i);
        result.maxAnimations = Math.max(result.maxAnimations, animations);
        if (spec.compareFrames.includes(i)) keep.set(i, png);
        await guard(Promise.resolve(spec.onFrame(i, png)));
      }
      const rep = await guard(a.page.evaluate(() => (window as any).__pfMade.report())) as { used: { api: string; frame: number }[]; webgl: boolean; families: string[]; errors: string[] };
      result.clock = rep.used; result.webgl = rep.webgl; result.pageErrors = rep.errors;
      result.missingFonts = unlistedFamilies(rep.families, spec.catalogueFamilies);
      await this.closeContext(a.context, () => { browserBad = true; });
      // pass B: a fresh context, the compared frames out of order
      const order = [...spec.compareFrames].sort((x, y) => y - x).slice(0, 1).concat(spec.compareFrames.filter((f) => f !== Math.max(...spec.compareFrames)));
      const b = await guard(this.open(browser, spec, served, fail));
      contexts.push(b.context);
      for (const f of order) {
        if (failure) throw failure;
        const { png } = await frameStep(b.page, f);
        const first = keep.get(f)!;
        result.compared.push({ frame: f, a: first, b: png, equalBytes: first.equals(png) });
      }
      result.compared.sort((x, y) => spec.compareFrames.indexOf(x.frame) - spec.compareFrames.indexOf(y.frame));
      result.served = [...served].sort();
      return result;
    } catch (e) {
      if (failure) throw failure;
      throw e;
    } finally {
      clearTimeout(jobTimer);
      spec.signal?.removeEventListener('abort', onAbort);
      for (const c of contexts) await this.closeContext(c, () => { browserBad = true; });
      // a page stuck in a loop may hold its renderer after the context is gone: start the next draw in a fresh browser
      const f = failure as MadeDrawError | null;
      if (f && (f.why === 'frameTimeout' || f.why === 'jobTimeout')) browserBad = true;
      if (browserBad) await this.drop(browser);
    }
  }
  /** Close a context within 5 s (plan §3.5 cleanup); a context that will not close marks the browser to be dropped. */
  private async closeContext(c: BrowserContext, bad: () => void): Promise<void> {
    const closed = await Promise.race([c.close().then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000).unref())]);
    if (!closed) bad();
  }
  /** Open contexts of the made browser (proof check 12: none left after a cancel). */
  async openContexts(): Promise<number> {
    const b = await this.browser?.catch(() => undefined);
    return b ? b.browser.contexts().length : 0;
  }
  async close(): Promise<void> {
    const b = await this.browser?.catch(() => undefined);
    this.browser = undefined;
    await b?.browser.close().catch(() => {});
    if (this.madeDir) { await rm(this.madeDir, { recursive: true, force: true }).catch(() => {}); this.madeDir = undefined; }
  }
}
