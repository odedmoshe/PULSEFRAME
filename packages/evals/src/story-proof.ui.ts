/**
 * proof:story — the interface part (W3): U1–U15 of story-proof.ts, in headless Chromium with the fake microphone fed from a fixture
 * (--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file>%noloop; one launch per
 * check). One in-process server on its own port, synthetic fixtures only (story-fixtures.ts tones over seeded noise, solid-colour
 * stills made by ffmpeg here); never a real voice or family media. A check returns true, or the sentence that says why not;
 * "BLOCKED: …" when it cannot run here and "waits for W1: …" when it needs the story planner (the server answers 501
 * story_not_built until builder W1 is merged): neither is a pass. Expected numbers come from the fixture's design or are computed
 * here independently, never read back from the code under test.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { flashGapFrames, STORY_FORBIDDEN_WORDS, STORY_FORBIDDEN_WORDS_HE } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { MIC_BURSTS, makeStoryFixtures, type StoryFixtureName } from './story-fixtures.ts';
import { STORY_TESTIDS as ID } from '../../../apps/web/src/editor/story/story.testids.ts';
import { storyStrings } from '../../../apps/web/src/editor/story/story.strings.ts';
import type { StoryProofPart } from './story-proof.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/story-proof-ui');
const PORT = Number(process.env.PF_STORY_PROOF_UI_PORT ?? 8991);
const W = 640, H = 360;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 28 });
type Lang = 'he' | 'en';

interface Env {
  s: RunningServer; fx: Record<StoryFixtureName, string>; stills: string[];
  call(p: string, body?: unknown, method?: string): Promise<{ status: number; body: any }>;
}
let envPromise: Promise<Env> | null = null;
let server: RunningServer | null = null;
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const env = () => (envPromise ??= makeEnv());
async function makeEnv(): Promise<Env> {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) throw new Error('the web bundle is missing (run `pnpm build`)');
  fs.rmSync(art, { recursive: true, force: true });
  const fxDir = path.join(art, 'fixtures');
  const fx = makeStoryFixtures(fxDir);
  const stills: string[] = [];
  const colours = ['dc1e1e', '1ec81e', '1e1edc', 'e6e61e', 'dc1edc', '1edcdc'];
  colours.forEach((c, i) => { const out = path.join(fxDir, `s${i}.png`); ff(['-y', '-f', 'lavfi', '-i', `color=c=0x${c}:s=${W}x${H}`, '-frames:v', '1', out]); stills.push(out); });
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), webDist: path.join(root, 'apps/web/dist'), homeZone: 'Asia/Jerusalem' });
  server = s;
  process.once('beforeExit', () => { void s.close(); });
  const call: Env['call'] = async (p, body, method) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { connection: 'close', authorization: `Bearer ${s.auth.tokens.agent}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { s, fx, stills, call };
}
async function upload(e: Env, pid: string, file: string): Promise<string> {
  const r = await fetch(`${e.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${e.s.auth.tokens.agent}`, connection: 'close', 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${path.basename(file)}: ${r.status} ${JSON.stringify(b).slice(0, 300)}`);
  return b.assetId as string;
}
interface Proj { pid: string; narration: string | null; alac: string | null; pictures: string[] }
/** A new project with pictures, and (optionally) the narration and the ALAC copy, uploaded in this order. */
async function project(e: Env, name: string, opts: { narration?: boolean; alac?: boolean; pictures?: number } = {}): Promise<Proj> {
  const pid = (await e.call('/projects', { name, width: W, height: H, frameRate: { num: 30, den: 1 } })).body.project.id as string;
  const pictures: string[] = [];
  for (const f of e.stills.slice(0, opts.pictures ?? 6)) pictures.push(await upload(e, pid, f));
  const narration = opts.narration ? await upload(e, pid, e.fx['narration.wav']) : null;
  const alac = opts.alac ? await upload(e, pid, e.fx['narration-alac.m4a']) : null;
  return { pid, narration, alac, pictures };
}
const getProject = async (e: Env, pid: string) => (await e.call(`/projects/${pid}`)).body as { project: any; revision: number };
const hashOf = async (e: Env, pid: string) => JSON.stringify((await getProject(e, pid)).project).length + ':' + JSON.stringify((await getProject(e, pid)).project).split('').reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);

// ---------------------------------------------------------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------------------------------------------------------
type Mic = { kind: 'none' } | { kind: 'denied' } | { kind: 'file'; file: string };
async function launch(mic: Mic): Promise<Browser> {
  const args = ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (mic.kind === 'file') args.push('--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${mic.file}%noloop`);
  return chromium.launch({ args });
}
/** Every stream the page opens is kept, so a check reads each track's readyState without trusting the component. */
const INIT = (lang: Lang, extra = '') => `
  globalThis.__name = (f) => f; globalThis.__pfStoryProof = true; try { localStorage.setItem('pf.lang', '${lang}'); } catch {}
  window.__pfStreams = [];
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { const o = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async (c) => { const s = await o(c); window.__pfStreams.push(s); return s; }; }
  window.__pfRec = {};
  new MutationObserver(() => { const el = document.querySelector('[data-testid="${ID.recorder}"]'); const st = el && el.getAttribute('data-state'); if (st && window.__pfRec.last !== st) { window.__pfRec.last = st; window.__pfRec[st] = performance.now(); } }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['data-state'] });
  ${extra}`;
async function openEditor(b: Browser, e: Env, pid: string, lang: Lang, extra = ''): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(INIT(lang, extra));
  const page = await ctx.newPage();
  await page.goto(`${e.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return { ctx, page };
}
/** The command palette's «ספרו מה היה» (selection empty → the library's pictures and videos). */
async function openDialog(page: Page, lang: Lang): Promise<void> {
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill(storyStrings(lang).name);
  await page.getByTestId('palette-option').first().waitFor({ timeout: 8000 });
  await page.keyboard.press('Enter');
  await page.getByTestId(ID.dialog).waitFor({ timeout: 8000 });
}
const streamStates = (page: Page) => page.evaluate(() => ((window as any).__pfStreams as MediaStream[]).flatMap((s) => s.getTracks().map((t) => t.readyState)));
const recState = (page: Page) => page.getByTestId(ID.recorder).getAttribute('data-state');
async function waitState(page: Page, want: string, ms = 15000): Promise<boolean> {
  return page.waitForFunction(([id, w]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') === w, [ID.recorder, want] as const, { timeout: ms }).then(() => true, () => false);
}
/** Records for `ms` of the fake microphone, stops. Returns the engine-visible seconds (state times seen in the page). */
async function recordFor(page: Page, ms: number): Promise<{ seconds: number } | string> {
  await page.getByTestId(ID.recStart).click();
  if (!(await waitState(page, 'recording'))) return `never recording (state ${await recState(page)})`;
  await sleep(ms);
  await page.getByTestId(ID.recStop).click();
  if (!(await waitState(page, 'stopped'))) return `never stopped (state ${await recState(page)})`;
  const t = await page.evaluate(() => (window as any).__pfRec as Record<string, number>);
  return { seconds: ((t.stopped ?? 0) - (t.recording ?? 0)) / 1000 };
}
interface Wav { channels: number; bits: number; rate: number; samples: Int16Array }
function parseWav(b: Buffer): Wav | null {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let o = 12, fmt: { channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data' && fmt) { const n = Math.min(len, b.length - o - 8) >> 1; const s = new Int16Array(n); for (let i = 0; i < n; i++) s[i] = b.readInt16LE(o + 8 + 2 * i); return { ...fmt, samples: s }; }
    o += 8 + len + (len & 1);
  }
  return null;
}
/** Saves the take through the dialog and returns the stored WAV (the new sound file of the project). */
async function saveAndFetch(e: Env, page: Page, pid: string, before: Set<string>): Promise<Wav | string> {
  await page.getByTestId(ID.recSave).click();
  const t0 = Date.now();
  for (;;) {
    const p = (await getProject(e, pid)).project;
    const fresh = Object.values(p.assets as Record<string, any>).filter((a) => a.kind === 'audio' && !before.has(a.id));
    if (fresh.length) {
      const r = await e.call(`/projects/${pid}/assets/${fresh[0].id}/content`);
      const w = parseWav(r.body as Buffer);
      return w ?? `the stored file is not a WAV (${fresh[0].name})`;
    }
    if (Date.now() - t0 > 60000) return 'the saved recording never reached the library';
    await sleep(300);
  }
}
const audioIds = async (e: Env, pid: string) => new Set(Object.values((await getProject(e, pid)).project.assets as Record<string, any>).filter((a) => a.kind === 'audio').map((a) => a.id as string));
/** Burst starts (seconds) of a mono signal: 10 ms RMS windows above −30 dBFS, rising edges. */
function burstStarts(s: Int16Array, rate: number): number[] {
  const win = Math.round(rate * 0.01), out: number[] = [];
  let on = false;
  for (let i = 0; i + win <= s.length; i += win) {
    let sum = 0; for (let k = 0; k < win; k++) sum += (s[i + k]! / 32768) ** 2;
    const db = 10 * Math.log10(sum / win + 1e-20);
    if (db > -30 && !on) { on = true; out.push(i / rate); } else if (db < -40) on = false;
  }
  return out;
}
const fails = (list: (string | false | null | undefined)[]): true | string => { const f = list.filter((x): x is string => typeof x === 'string'); return f.length ? f.join('; ') : true; };
/** Runs one browser check; a missing bundle or server is BLOCKED, a refusal because the planner is not built is "waits for W1". */
async function guarded(mic: Mic, fn: (b: Browser, e: Env) => Promise<true | string>): Promise<true | string> {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: ${(x as Error).message}`; }
  let b: Browser;
  try { b = await launch(mic); } catch (x) { return `BLOCKED: Chromium could not start: ${(x as Error).message}`; }
  try { return await fn(b, e); } catch (x) { return `error: ${(x as Error).message}`; } finally { await b.close().catch(() => undefined); }
}
/** Whether the server plans a story yet (W1). null = it does; else the sentence for the waiting checks. */
async function plannerWait(e: Env, p: Proj): Promise<string | null> {
  const r = await e.call(`/projects/${p.pid}/recipes/story/plan`, { params: { narrationAssetId: p.narration, assetIds: p.pictures } });
  return r.status === 501 || r.body?.error?.code === 'story_not_built' ? 'waits for W1: the server answers story_not_built (the planner is not merged yet), so nothing past the dialog can run' : r.status === 200 ? null : `the plan route answered ${r.status}: ${JSON.stringify(r.body?.error ?? r.body).slice(0, 200)}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// U1–U5: the recorder
// ---------------------------------------------------------------------------------------------------------------------------
const U1 = () => guarded({ kind: 'denied' }, async (b, e) => {
  const p = await project(e, 'U1', { pictures: 2 });
  // headless Chromium has no permission prompt (it answers NotSupportedError); a person pressing «Block» gets NotAllowedError, which the page is given here
  const { page, ctx } = await openEditor(b, e, p.pid, 'he', "navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };");
  await openDialog(page, 'he');
  const probe = await page.evaluate(async () => { try { await navigator.mediaDevices.getUserMedia({ audio: true }); return 'granted'; } catch (x: any) { return `${x?.name}: ${x?.message}`; } });
  await page.getByTestId(ID.recStart).click();
  const ok = await waitState(page, 'denied', 10000);
  const text = (await page.getByTestId(ID.recState).innerText()).trim();
  const jobs = (await e.call(`/projects/${p.pid}/imports`)).body?.imports ?? [];
  const audio = await audioIds(e, p.pid);
  const state = await recState(page);
  await ctx.close();
  return fails([!ok && `the state never became denied (it is ${state}; the browser's own error is ${probe})`, !text.includes('אין הרשאה למיקרופון') && `the words are «${text}»`, jobs.length > 0 && `${jobs.length} import job(s) exist`, audio.size > 0 && 'a sound file was made']);
});

const U2 = () => run2();
async function run2(): Promise<true | string> {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: ${(x as Error).message}`; }
  return guarded({ kind: 'file', file: e.fx['mic.wav'] }, async (b) => {
    const p = await project(e, 'U2', { pictures: 2 });
    const { page, ctx } = await openEditor(b, e, p.pid, 'he');
    await openDialog(page, 'he');
    const rate = await page.evaluate(() => { const c = new AudioContext(); const r = c.sampleRate; void c.close(); return r; });
    const rec = await recordFor(page, 3600);
    if (typeof rec === 'string') return rec;
    const before = await audioIds(e, p.pid);
    const w = await saveAndFetch(e, page, p.pid, before);
    await ctx.close();
    if (typeof w === 'string') return w;
    const seconds = w.samples.length / w.rate, starts = burstStarts(w.samples, w.rate);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]!);
    const want = MIC_BURSTS.slice(1).map((s, i) => s - MIC_BURSTS[i]!);
    return fails([
      w.channels !== 1 && `${w.channels} channels`, w.bits !== 16 && `${w.bits} bits`, w.rate !== rate && `header rate ${w.rate} ≠ context rate ${rate}`,
      Math.abs(seconds - rec.seconds) > 0.25 && `length ${seconds.toFixed(3)} s vs ${rec.seconds.toFixed(3)} s between record and stop`,
      starts.length !== 3 && `${starts.length} bursts found (${starts.map((s) => s.toFixed(2)).join(', ')}), wanted 3`,
      starts.length === 3 && gaps.some((g, i) => Math.abs(g - want[i]!) > 0.03) && `gaps ${gaps.map((g) => g.toFixed(3)).join(', ')} s, wanted ${want.join(', ')} within 30 ms`,
    ]);
  });
}

async function levelCheck(file: StoryFixtureName, ms: number, expect: 'quiet' | 'hot'): Promise<true | string> {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: ${(x as Error).message}`; }
  return guarded({ kind: 'file', file: e.fx[file] }, async (b) => {
    const p = await project(e, `U3 ${expect}`, { pictures: 2 });
    const { page, ctx } = await openEditor(b, e, p.pid, 'he');
    await openDialog(page, 'he');
    const rec = await recordFor(page, ms);
    if (typeof rec === 'string') return rec;
    const text = (await page.getByTestId(ID.recorder).innerText()).replace(/\s+/g, ' ');
    await ctx.close();
    if (expect === 'quiet') {
      const m = /שקט מדי \([\s\u2066]*(-?\d+(?:\.\d+)?)/.exec(text);
      return m && Number(m[1]) < -38 ? true : `no «שקט מדי» with a level under −38 in «${text.slice(0, 300)}»`;
    }
    const m = /חזק מדי: (\d+) דגימות נחתכו/.exec(text);
    return m && Number(m[1]) > 0 ? true : `no clipped count in «${text.slice(0, 300)}»`;
  });
}
const U3 = async () => {
  const q = await levelCheck('quiet.wav', 2000, 'quiet');
  const h = await levelCheck('hot.wav', 2000, 'hot');
  return q === true && h === true ? true : `quiet: ${q === true ? 'ok' : q}; hot: ${h === true ? 'ok' : h}`;
};

async function withMic<T>(file: StoryFixtureName, fn: (b: Browser, e: Env) => Promise<T>): Promise<T | string> {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: ${(x as Error).message}`; }
  return guarded({ kind: 'file', file: e.fx[file] }, fn as never) as Promise<T | string>;
}
const U4 = () => withMic('mic.wav', async (b, e) => {
  const p = await project(e, 'U4', { pictures: 2 });
  const { page, ctx } = await openEditor(b, e, p.pid, 'he');
  await openDialog(page, 'he');
  const before = await audioIds(e, p.pid);
  const rec = await recordFor(page, 1500);
  if (typeof rec === 'string') return rec;
  await page.getByTestId(ID.recAgain).click();
  const idle = await waitState(page, 'idle', 5000);
  await sleep(1500);
  const jobs = (await e.call(`/projects/${p.pid}/imports`)).body?.imports ?? [];
  const after = await audioIds(e, p.pid);
  const live = (await streamStates(page)).filter((s) => s !== 'ended');
  const stored = await page.evaluate(async () => ({ ls: Object.keys(localStorage).filter((k) => /record|story|wav|voice/i.test(k)), ss: Object.keys(sessionStorage), idb: ((await (indexedDB as any).databases?.()) ?? []).map((d: any) => d.name) }));
  await ctx.close();
  return fails([!idle && 'the recorder did not return to idle', jobs.length > 0 && `${jobs.length} import job(s)`, after.size !== before.size && 'a sound file was made', live.length > 0 && 'a microphone track is still live',
    (stored.ls.length > 0 || stored.ss.length > 0) && `browser storage holds ${JSON.stringify(stored)}`]);
});
const U5 = () => withMic('narration.wav', async (b, e) => {
  const p = await project(e, 'U5', { pictures: 2 });
  const { ctx } = await openEditor(b, e, p.pid, 'he', 'window.__pfStoryRecorderMaxMs = 3000;');
  const page = ctx.pages()[0]!;
  await openDialog(page, 'he');
  await page.getByTestId(ID.recStart).click();
  if (!(await waitState(page, 'limit', 15000))) return `the recorder never reached its limit (state ${await recState(page)})`;
  const text = (await page.getByTestId(ID.recState).innerText()).trim();
  const live = (await streamStates(page)).filter((s) => s !== 'ended');
  const rate = await page.evaluate(() => { const c = new AudioContext(); const r = c.sampleRate; void c.close(); return r; });
  const before = await audioIds(e, p.pid);
  const w = await saveAndFetch(e, page, p.pid, before);
  await ctx.close();
  if (typeof w === 'string') return w;
  return fails([!text.includes(storyStrings('he').limitLine(3).slice(0, 22)) && `the words are «${text}»`, w.samples.length !== 3 * rate && `${w.samples.length} samples, wanted exactly ${3 * rate} (3 s at ${rate} Hz)`, live.length > 0 && 'a track is still live at the limit']);
});

// ---------------------------------------------------------------------------------------------------------------------------
// U6: the whole flow by keyboard, he and en
// ---------------------------------------------------------------------------------------------------------------------------
async function tabTo(page: Page, testId: string, max = 80): Promise<boolean> {
  for (let i = 0; i < max; i++) { if ((await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')) === testId) return true; await page.keyboard.press('Tab'); }
  return false;
}
async function keyboardFlow(b: Browser, e: Env, lang: Lang): Promise<true | string> {
  const p = await project(e, `U6 ${lang}`, { narration: true, pictures: 3 });
  const { page, ctx } = await openEditor(b, e, p.pid, lang);
  await openDialog(page, lang);
  const out: (string | false)[] = [];
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const dlgDir = await page.getByTestId(ID.dialog).locator('[dir]').first().getAttribute('dir');
  const stripDir = await page.getByTestId(ID.strip).getAttribute('dir');
  out.push(dlgDir !== dir && `the dialog's dir is ${dlgDir}, wanted ${dir}`, stripDir !== dir && `the strip's dir is ${stripDir}, wanted ${dir}`);
  if (!(await tabTo(page, ID.fromLibrary))) return 'the narration list cannot be reached by Tab';
  await page.keyboard.press('ArrowDown');
  await sleep(300);
  if ((await page.getByTestId(ID.narration).count()) !== 1) out.push('the narration was not chosen by keyboard');
  // the first item of the strip moves with Alt+arrow
  await page.getByTestId(ID.item).first().focus();
  const first = await page.getByTestId(ID.item).first().getAttribute('data-asset-id');
  await page.keyboard.press(lang === 'he' ? 'Alt+ArrowLeft' : 'Alt+ArrowRight');
  const moved = (await page.getByTestId(ID.item).nth(1).getAttribute('data-asset-id')) === first;
  out.push(!moved && 'Alt+arrow did not move the first picture later');
  if (!(await tabTo(page, ID.buildNoTaps))) return 'the build button cannot be reached by Tab';
  await sleep(1200); // the file is test-opened first
  await page.keyboard.press('Enter');
  await Promise.race([page.getByTestId(ID.bar).waitFor({ timeout: 30000 }), page.getByTestId(ID.error).waitFor({ timeout: 30000 })]).catch(() => undefined);
  const built = (await page.getByTestId(ID.bar).count()) > 0;
  const err = (await page.getByTestId(ID.error).count()) ? (await page.getByTestId(ID.error).innerText()).trim() : '';
  await ctx.close();
  const mine = fails(out);
  if (mine !== true) return mine;
  if (built) return true;
  if (err === storyStrings(lang).notBuilt) return `waits for W1: the dialog, the strip order, dir=${dir} and the Tab/Enter path to the build button work; the server says story_not_built («${err}»)`;
  return `no story bar after Enter; error «${err}»`;
}
const U6 = async () => {
  const res: string[] = [];
  for (const lang of ['he', 'en'] as const) { const r = await guarded({ kind: 'none' }, (b, e) => keyboardFlow(b, e, lang)); res.push(`${lang}: ${r === true ? 'ok' : r}`); }
  return res.every((r) => r.endsWith(': ok')) ? true : res.join(' | ');
};

// ---------------------------------------------------------------------------------------------------------------------------
// U7–U14: tapping (need the planner: W1 merged)
// ---------------------------------------------------------------------------------------------------------------------------
/** Dialog → «הקישו את המעברים» → the «סיפור» tab. */
async function toTapView(page: Page, lang: Lang): Promise<void> {
  await openDialog(page, lang);
  await page.getByTestId(ID.fromLibrary).selectOption({ index: 1 });
  await sleep(1500);
  await page.getByTestId(ID.tapAlong).click();
  await page.getByTestId(ID.tapView).waitFor({ timeout: 30000 });
}
async function tapSession(name: string, fn: (page: Page, e: Env, p: Proj, ctx: BrowserContext) => Promise<true | string>, lang: Lang = 'he'): Promise<true | string> {
  return guarded({ kind: 'none' }, async (b, e) => {
    const p = await project(e, name, { narration: true, pictures: 6 });
    const wait = await plannerWait(e, p);
    if (wait) return wait;
    const { page, ctx } = await openEditor(b, e, p.pid, lang);
    try { await toTapView(page, lang); return await fn(page, e, p, ctx); } finally { await ctx.close().catch(() => undefined); }
  });
}
const hook = <T>(page: Page, f: string, ...args: unknown[]) => page.evaluate(([fn, a]) => (window as any).__pfStory[fn as string](...(a as unknown[])) as T, [f, args] as const);
async function startTapping(page: Page): Promise<void> {
  await page.getByTestId(ID.tapStart).click();
  await page.waitForFunction(() => (window as any).__pfStory?.now() !== null && (window as any).__pfStory?.state().phase === 'tapping', null, { timeout: 20000 });
}
const frameOfMs = (ms: number, fps = 30) => Math.round((ms * fps) / 1000);

const U7 = () => tapSession('U7', async (page) => {
  await page.evaluate(() => { (window as any).__keys = []; window.addEventListener('keydown', (ev) => { if (/^Digit/.test(ev.code)) (window as any).__keys.push({ frame: (window as any).__pfStory.playerFrame() }); }, true); });
  await startTapping(page);
  const expected: number[] = [];
  for (let i = 0; i < 5; i++) {
    await sleep(1300);
    if (i === 1 || i === 3) { await page.keyboard.press(`Digit${i}`); await sleep(50); const k = await page.evaluate(() => (window as any).__keys.at(-1)); expected.push(k.frame); }
    else { const t = await hook<{ ms: number; frame: number } | null>(page, 'tap'); if (!t) return `tap ${i + 1} through the hook was not taken`; expected.push(t.frame); }
  }
  await page.keyboard.press('Space');
  await page.getByTestId(ID.tapAccept).waitFor({ timeout: 20000 });
  const st = await hook<{ cutsMs: number[]; narrationStartSeconds: number }>(page, 'state');
  if (st.cutsMs.length !== 5) return `${st.cutsMs.length} taps kept, wanted 5`;
  const dev = st.cutsMs.map((ms, i) => Math.abs(frameOfMs(ms) + Math.round(st.narrationStartSeconds * 30) - expected[i]!));
  return dev.every((d) => d <= 1) ? true : `taps deviate from the player's frame by ${dev.join(', ')} frames (one allowed)`;
});
const U8 = () => tapSession('U8', async (page, e, p) => {
  const rev0 = (await getProject(e, p.pid)).revision;
  await startTapping(page);
  const seen: number[] = [], revs: number[] = [];
  for (let i = 0; i < 6; i++) { if (i % 2 === 1) await hook(page, 'tap'); await sleep(700); seen.push((await hook<number | null>(page, 'now')) ?? -1); revs.push((await hook<{ revision: number }>(page, 'state')).revision); }
  await page.keyboard.press('Space');
  const back = seen.some((s, i) => i > 0 && s < seen[i - 1]! - 0.05);
  const rev1 = (await getProject(e, p.pid)).revision;
  return fails([revs.some((r) => r !== revs[0]) && `the editor revision moved while tapping: ${revs.join(', ')}`, rev1 !== rev0 && `the server revision moved ${rev0} → ${rev1}`, back && `the sound session restarted (playback time went back: ${seen.map((s) => s.toFixed(2)).join(', ')})`]);
});
const U9 = () => tapSession('U9', async (page, e, p) => {
  const h0 = await hashOf(e, p.pid), rev0 = (await getProject(e, p.pid)).revision;
  await startTapping(page);
  for (let i = 0; i < 3; i++) { await sleep(1300); await hook(page, 'tap'); }
  await page.keyboard.press('Space');
  await page.getByTestId(ID.tapAccept).click();
  await page.getByTestId(ID.bar).waitFor({ timeout: 30000 }).catch(() => undefined);
  const rev1 = (await getProject(e, p.pid)).revision, h1 = await hashOf(e, p.pid);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('Control+z');
  await sleep(1500);
  const h2 = await hashOf(e, p.pid);
  const narrationKept = !!(await getProject(e, p.pid)).project.assets[p.narration!];
  return fails([rev1 !== rev0 + 1 && `revision ${rev0} → ${rev1} (one wanted)`, h2 !== h0 && 'Ctrl+Z did not return the earlier hash', h1 === h0 && 'apply changed nothing', !narrationKept && 'the narration left the library']);
});
const U10 = () => tapSession('U10', async (page) => {
  await startTapping(page);
  await sleep(1300); await hook(page, 'tap'); await sleep(100); await hook(page, 'tap'); // the second is under the flash gap
  await sleep(1300); await hook(page, 'tap');
  await page.keyboard.press('Space');
  await page.getByTestId(ID.tapAccept).waitFor({ timeout: 20000 });
  const S = storyStrings('he');
  const held = page.locator(`[data-testid="${ID.tapChip}"][data-state="held"]`);
  const reasonText = await held.first().innerText().catch(() => '');
  const notCal = await page.getByTestId(ID.tapNotCalibrated).isVisible().catch(() => false);
  const text = await page.getByTestId(ID.tapView).innerText();
  return fails([(await held.count()) < 1 && 'no held tap in the review', !reasonText.includes(S.held.too_close) && `the held tap says «${reasonText}»`, !notCal && '«לא כויל» is not visible', (STORY_FORBIDDEN_WORDS.test(text) || STORY_FORBIDDEN_WORDS_HE.test(text)) && 'a banned word is on the tap view']);
});
const U12 = async () => {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: ${(x as Error).message}`; }
  return guarded({ kind: 'file', file: e.fx['mic.wav'] }, async (b) => {
    const p = await project(e, 'U12', { pictures: 2 });
    const { page, ctx } = await openEditor(b, e, p.pid, 'he');
    const bad: string[] = [];
    const ended = async (what: string) => { await sleep(300); const live = (await streamStates(page)).filter((s) => s !== 'ended').length; if (live) bad.push(`${what}: ${live} track(s) live`); };
    await openDialog(page, 'he');
    // stop
    await page.getByTestId(ID.recStart).click(); await waitState(page, 'recording'); await sleep(600);
    await page.getByTestId(ID.recStop).click(); await waitState(page, 'stopped'); await ended('after stop');
    // record again, then discard it too
    await page.getByTestId(ID.recAgain).click(); await waitState(page, 'idle');
    await page.getByTestId(ID.recStart).click(); await waitState(page, 'recording'); await sleep(400); await ended('never (recording is live) — expected live'); bad.pop();
    // the page is hidden while recording
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await ended('page hidden'); await page.evaluate(() => { delete (document as any).visibilityState; });
    await page.getByTestId(ID.recAgain).click().catch(() => undefined); await waitState(page, 'idle', 3000);
    // the dialog closes while recording: Escape, then the button, then the backdrop
    for (const how of ['Escape', 'button', 'backdrop'] as const) {
      if (!(await page.getByTestId(ID.dialog).count())) await openDialog(page, 'he');
      await page.getByTestId(ID.recStart).click(); await waitState(page, 'recording'); await sleep(400);
      if (how === 'Escape') await page.keyboard.press('Escape'); else if (how === 'button') await page.getByTestId(ID.close).click(); else await page.mouse.click(5, 450);
      await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => bad.push(`${how}: the dialog did not close`));
      await ended(`closed by ${how}`);
    }
    await ctx.close();
    return bad.length ? bad.join('; ') : true;
  });
};
const U13 = () => tapSession('U13', async (page) => {
  await startTapping(page);
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) { await page.keyboard.press('Digit1'); await sleep(100); }
  await page.keyboard.press('Space');
  await page.getByTestId(ID.tapAccept).waitFor({ timeout: 20000 });
  const st = await hook<{ reviewCuts: number[] }>(page, 'state');
  const gap = flashGapFrames(30);
  const close = st.reviewCuts.map((c, i) => (i ? c - st.reviewCuts[i - 1]! : Infinity)).filter((d) => d < gap);
  return st.reviewCuts.length === 0 ? 'no cuts shown' : close.length ? `${close.length} pair(s) of cuts closer than ${gap} frames (${close.join(', ')})` : true;
});
const U14 = () => tapSession('U14', async (page) => {
  await startTapping(page);
  for (let i = 0; i < 4; i++) { await sleep(1300); await hook(page, 'tap'); }
  await page.keyboard.press('Space');
  await page.getByTestId(ID.tapAccept).waitFor({ timeout: 20000 });
  const shown = (await hook<{ reviewCuts: number[] }>(page, 'state')).reviewCuts;
  const resp = page.waitForResponse((r) => /recipes\/story\/apply/.test(r.url()), { timeout: 30000 });
  await page.getByTestId(ID.tapAccept).click();
  const body = await (await resp).json();
  const server = body?.predicted?.cuts as number[] | undefined;
  if (!server) return `no predicted cuts in the apply answer: ${JSON.stringify(body).slice(0, 200)}`;
  const same = shown.length === server.length && shown.every((f, i) => f === server[i]);
  const differs = (await page.getByTestId(ID.tapDiffers).count()) > 0;
  return fails([!same && !differs && `ghost ${shown.join(',')} vs server ${server.join(',')} and the screen does not say so`, same && differs && 'the screen says they differ though they are equal']);
});

// U15: the honest state (needs no planner)
const U15 = () => guarded({ kind: 'none' }, async (b, e) => {
  const p = await project(e, 'U15', { alac: true, pictures: 3 });
  if (!p.alac) return 'the ALAC copy was not uploaded';
  const { page, ctx } = await openEditor(b, e, p.pid, 'he');
  await openDialog(page, 'he');
  await page.getByTestId(ID.fromLibrary).selectOption(p.alac);
  const shown = await page.getByTestId(ID.unplayable).waitFor({ timeout: 15000 }).then(() => true, () => false);
  const text = shown ? (await page.getByTestId(ID.unplayable).innerText()).trim() : '';
  const disabled = await Promise.all([ID.tapAlong, ID.buildNoTaps].map((id) => page.getByTestId(id).getAttribute('aria-disabled')));
  const requests: string[] = [];
  page.on('request', (r) => { if (/recipes\/story/.test(r.url())) requests.push(r.url()); });
  await page.getByTestId(ID.buildNoTaps).click({ force: true });
  await sleep(500);
  await ctx.close();
  return fails([!shown && 'no «הקובץ לא מתנגן בעורך» state', shown && !/^הקובץ לא מתנגן בעורך \(קודק .*\)\. הקליטו כאן או המירו אותו$/u.test(text.replace(/[⁦⁩]/g, '')) && `the words are «${text}»`, disabled.some((d) => d !== 'true') && `build buttons aria-disabled: ${disabled.join(', ')}`, requests.length > 0 && 'a plan request was sent for the unplayable file']);
});

export const STORY_PROOF_UI: StoryProofPart = { built: true, checks: { U1, U2, U3, U4, U5, U6, U7, U8, U9, U10, U12, U13, U14, U15 } };
void server;
