/**
 * proof:picmodels, interface part (integration; W3 left it unwritten): the marking view of «גדלים מול העיניים» in headless Chromium
 * against real servers whose picture-model runtime uses the LABELLED fake worker «TEST-ADAPTER-picture/1» through the test seam
 * (apps/server/src/picmodels/testWorld.ts: a synthetic registry, a synthetic library with its ledger, the fake's own digest). No
 * model runs and none is downloaded: the fake finds the drawn magenta squares of picmodels-fixtures.ts, so this proves the interface
 * and its plumbing, never what a model would propose on a real picture, and nobody has looked at a real proposal.
 * Two servers: `ready` (the fake through PF_TOOLS_PYTHON = this machine's python3) and `noPython` (the same seams, PF_TOOLS_PYTHON
 * unset, so the yunet row is engine_not_configured). The dialog is reached as the owner reaches it: the start hub's card of an empty
 * project. Checks: E1, E2, E4, E9, E10 (the interface side), U1 of PICMODELS_CHECKS. A check returns true or the sentence that says
 * why not; "BLOCKED: …" when it cannot run here (no bundle, no python3, no Chromium): never a pass.
 * Fixtures and data folders live in one temporary folder deleted at exit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startServer, type RunningServer } from '../../../apps/server/src/index.ts';
import { makePicWorld, pidsRunning, type PicWorld } from '../../../apps/server/src/picmodels/testWorld.ts';
import { EYES_TESTIDS as EID } from '../../../apps/web/src/editor/growing/eyes.testids.ts';
import { eyesStrings } from '../../../apps/web/src/editor/growing/eyes.strings.ts';
import { GROWING_TESTIDS as ID } from '../../../apps/web/src/editor/growing/growing.testids.ts';
import { growingStrings } from '../../../apps/web/src/editor/growing/growing.strings.ts';
import { makePicmodelsFixtures, type DrawnFace, type PicmodelsFixtures } from './picmodels-fixtures.ts';
import type { PicmodelsProofPart } from './picmodels-proof.ts';

const root = path.resolve(import.meta.dirname, '../../..');
type Lang = 'he' | 'en';
type Still = keyof PicmodelsFixtures['stills'];
interface Env { ready: RunningServer; noPython: RunningServer; w: PicWorld; fx: PicmodelsFixtures }

let envPromise: Promise<Env> | null = null;
const env = () => (envPromise ??= makeEnv());
async function makeEnv(): Promise<Env> {
  const webDist = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('BLOCKED: the web bundle is missing (run `pnpm build`)');
  const w = makePicWorld('pf-picproof-ui-');
  process.once('exit', () => {
    for (const p of pidsRunning(w.worker)) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(w.root, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  if (!w.python) throw new Error('BLOCKED: no python3 on PATH, so the labelled fake cannot run');
  const fx = makePicmodelsFixtures(path.join(w.root, 'fixtures'));
  const common = { port: 0, webDist, libraryDir: null, backupDir: null, speechPython: null, voicePython: null } as const;
  const ready = await startServer({ ...common, dataDir: path.join(w.root, 'data-ready'), toolsPython: w.python }, { picmodelsTest: w.seams });
  const noPython = await startServer({ ...common, dataDir: path.join(w.root, 'data-nopython'), toolsPython: null }, { picmodelsTest: w.seams });
  process.once('beforeExit', () => { void ready.close(); void noPython.close(); });
  return { ready, noPython, w, fx };
}
async function agent(s: RunningServer, p: string, body?: unknown): Promise<any> {
  const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { connection: 'close', authorization: `Bearer ${s.auth.tokens.agent}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return r.json();
}
const newProject = async (s: RunningServer, name: string) => (await agent(s, '/projects', { name, width: 640, height: 480, frameRate: { num: 30, den: 1 } })).project.id as string;

const INIT = (lang: Lang) => `globalThis.__name = (f) => f; try { localStorage.setItem('pf.lang', '${lang}'); } catch {}`;
async function openEditor(b: Browser, s: RunningServer, pid: string, lang: Lang, width = 1440): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await b.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(INIT(lang));
  const page = await ctx.newPage();
  await page.goto(`${s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return { ctx, page };
}
/**
 * The owner's way in, by keyboard: Enter on the start hub's card opens the file chooser (the project is empty), the files go in, the
 * dialog opens on them; Space ticks each picture; Enter on «המשך» opens the marking step. Returns asset id → file name.
 */
async function openMarking(page: Page, e: Env, names: Still[]): Promise<Record<string, Still>> {
  await page.getByTestId(ID.open).waitFor({ timeout: 15000 });
  let chooser: import('playwright').FileChooser | null = null;
  for (let attempt = 1; attempt <= 4 && !chooser; attempt++) {
    await page.getByTestId(ID.open).focus();
    const wait = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await page.keyboard.press('Enter');
    chooser = await wait;
  }
  if (!chooser) throw new Error('Enter on the start hub card opened no file chooser in 4 tries');
  await chooser.setFiles(names.map((n) => e.fx.stills[n].file));
  await page.getByTestId(ID.dialog).waitFor({ timeout: 60000 });
  await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel as string).length >= (k as number), [`[data-testid="${ID.pickItem}"]`, names.length] as const, { timeout: 30000 });
  const items = await page.getByTestId(ID.pickItem).evaluateAll((els) => els.map((el) => [el.getAttribute('data-asset-id') ?? '', el.textContent ?? ''] as const));
  const byId: Record<string, Still> = {};
  // the longest file name first: 'none.png' also contains 'one.png'
  const longestFirst = [...names].sort((a, b) => e.fx.stills[b].name.length - e.fx.stills[a].name.length);
  for (const [id, text] of items) { const n = longestFirst.find((x) => text.includes(e.fx.stills[x].name)); if (n) byId[id] = n; }
  for (const [id] of items) { await page.locator(`[data-testid="${ID.pickItem}"][data-asset-id="${id}"] input`).focus(); await page.keyboard.press('Space'); }
  await page.getByTestId(ID.pickNext).focus(); await page.keyboard.press('Enter');
  await page.getByTestId(ID.markView).waitFor({ timeout: 15000 });
  return byId;
}
/** Page until the marking view shows `name` (PageDown, then PageUp, on the stage: keyboard only). */
async function goTo(page: Page, byId: Record<string, Still>, name: Still): Promise<boolean> {
  for (const key of ['PageDown', 'PageUp']) for (let k = 0; k < 4; k++) {
    const id = await page.getByTestId(ID.markView).getAttribute('data-asset-id');
    if (id && byId[id] === name) return true;
    await stage(page).focus(); await page.keyboard.press(key); await page.waitForTimeout(200);
  }
  return false;
}
/** Growing needs at least two pictures (GROWING.minPictures): the one-face checks open one.png with none.png beside it. */
async function openOne(page: Page, e: Env): Promise<boolean> {
  const byId = await openMarking(page, e, ['one', 'none']);
  return goTo(page, byId, 'one');
}
const stage = (page: Page) => page.getByTestId(ID.markView).locator('.pf-growing-stage');
const pct = (style: string | null, key: 'left' | 'top') => Number(new RegExp(`${key}:\\s*([-\\d.]+)%`).exec(style ?? '')?.[1] ?? NaN) / 100;
/** The rings shown: face letter index, first/second, chosen, and (u, v). */
const rings = (page: Page) => page.getByTestId(EID.ring).evaluateAll((els) => els.map((el) => ({ face: el.getAttribute('data-face'), state: el.getAttribute('data-state'), chosen: el.getAttribute('data-chosen'), style: el.getAttribute('style') })))
  .then((xs) => xs.map((x) => ({ ...x, u: pct(x.style, 'left'), v: pct(x.style, 'top') })));
const points = (page: Page) => page.getByTestId(ID.markPoint).evaluateAll((els) => els.map((el) => el.getAttribute('style')))
  .then((xs) => xs.map((s) => ({ u: pct(s, 'left'), v: pct(s, 'top') })));
const text = async (page: Page, id: string) => ((await page.getByTestId(id).textContent()) ?? '').trim();
/** Each drawn eye of the face has a shown point within `tol` shown px (as a set: the order rule may swap them). */
function matches(pts: { u: number; v: number }[], f: DrawnFace, W: number, H: number, tol = 1.5): string | null {
  if (pts.length !== 2) return `${pts.length} points`;
  const d = (p: { u: number; v: number }, q: { x: number; y: number }) => Math.hypot(p.u * W - q.x, p.v * H - q.y);
  const best = Math.min(Math.max(d(pts[0]!, f.a), d(pts[1]!, f.b)), Math.max(d(pts[0]!, f.b), d(pts[1]!, f.a)));
  return best < tol ? null : `points ${best.toFixed(2)} shown px from the drawn eyes`;
}
/** Click at shown pixel (x, y) of a W × H picture: against the canvas's box, the box the view maps a click with (uvFromClient). */
async function clickAt(page: Page, x: number, y: number, W: number, H: number) {
  const box = (await stage(page).locator('canvas').boundingBox())!;
  await page.mouse.click(box.x + (x / W) * box.width, box.y + (y / H) * box.height);
}
async function suggestByClick(page: Page) {
  await page.getByTestId(EID.suggest).click();
}
const proposalOutcome = (page: Page, timeout = 30000) => page.getByTestId(EID.proposal).waitFor({ timeout }).then(() => page.getByTestId(EID.proposal).getAttribute('data-outcome'), () => null);
const waitFor = async (cond: () => boolean, ms: number) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); return cond(); };
const withFake = async <T>(mode: string | null, fn: () => Promise<T>): Promise<T> => {
  if (mode) process.env.PF_FAKE_PICTURE_MODE = mode; else delete process.env.PF_FAKE_PICTURE_MODE;
  try { return await fn(); } finally { delete process.env.PF_FAKE_PICTURE_MODE; }
};

const withBrowser = async (body: (b: Browser, e: Env) => Promise<true | string>): Promise<true | string> => {
  let e: Env;
  try { e = await env(); } catch (x) { const m = (x as Error).message; return m.startsWith('BLOCKED') ? m : `BLOCKED: ${m}`; }
  let b: Browser;
  try { b = await chromium.launch(); } catch (x) { return `BLOCKED: Chromium could not start: ${(x as Error).message.split('\n')[0]}`; }
  try { return await body(b, e); } catch (x) { return `error: ${(x as Error).message.split('\n')[0]}`; } finally { delete process.env.PF_FAKE_PICTURE_MODE; await b.close(); }
};

/** E1: PF_TOOLS_PYTHON unset → the button is disabled with the setup words beside it; no request; hand marking places two points. */
const E1 = () => withBrowser(async (b, e) => {
  const lang: Lang = 'he', eS = eyesStrings(lang), S = growingStrings(lang);
  const pid = await newProject(e.noPython, 'e1');
  const { ctx, page } = await openEditor(b, e.noPython, pid, lang);
  const asked: string[] = [];
  page.on('request', (r) => { if (/\/eyes\/propose/.test(r.url())) asked.push(r.url()); });
  try {
    if (!(await openOne(page, e))) return 'one.png is not reachable in the marking view';
    const btn = page.getByTestId(EID.suggest);
    await btn.waitFor({ timeout: 15000 });
    const [code, disabled, described] = [await btn.getAttribute('data-code'), await btn.isDisabled(), await btn.getAttribute('aria-describedby')];
    if (code !== 'engine_not_configured' || !disabled) return `the button is data-code=${code}, disabled=${disabled}`;
    const words = await text(page, EID.state);
    if (words !== eS.setup('engine_not_configured')) return `the setup line says «${words}»`;
    if (!described || (await page.locator(`#${described}`).getAttribute('data-testid')) !== EID.state) return 'the disabled button is not described by the setup line';
    if ((await text(page, EID.privacy)) !== eS.privacy) return 'the privacy sentence is not shown';
    await btn.click({ force: true, timeout: 2000 }).catch(() => {});
    const f = e.fx.stills.one.faces[0]!;
    await stage(page).focus(); await clickAt(page, f.a.x, f.a.y, 640, 480); await clickAt(page, f.b.x, f.b.y, 640, 480);
    const pts = await points(page);
    const off = matches(pts, f, 640, 480, 3);
    if (off) return `hand marking: ${off}`;
    if ((await text(page, ID.markCount)) !== S.marked(1, 2)) return `the count says «${await text(page, ID.markCount)}»`;
    await page.waitForTimeout(300);
    return asked.length === 0 ? true : `${asked.length} eye requests were sent with the button disabled`;
  } finally { await ctx.close(); }
});

/** E2: one face; each ring within 1.5 shown px of a drawn eye; Enter accepts through placePoint; the count moves. */
const E2 = () => withBrowser(async (b, e) => {
  const lang: Lang = 'he', eS = eyesStrings(lang), S = growingStrings(lang);
  const pid = await newProject(e.ready, 'e2');
  const { ctx, page } = await openEditor(b, e.ready, pid, lang);
  try {
    if (!(await openOne(page, e))) return 'one.png is not reachable in the marking view';
    const btn = page.getByTestId(EID.suggest);
    await btn.waitFor({ timeout: 15000 });
    if ((await btn.getAttribute('data-code')) !== 'ready' || (await btn.isDisabled())) return `the button is not ready (${await btn.getAttribute('data-code')})`;
    if (await page.getByTestId(EID.state).count()) return 'a setup line is shown although the model is ready';
    if ((await text(page, ID.markCount)) !== S.marked(0, 2)) return `the count before is «${await text(page, ID.markCount)}»`;
    await suggestByClick(page);
    if ((await proposalOutcome(page)) !== 'faces') return 'no proposal with faces';
    const r = await rings(page);
    const f = e.fx.stills.one.faces[0]!;
    const off = matches(r, f, 640, 480);
    if (off) return `rings: ${off}`;
    if (r.some((x) => x.chosen !== 'true')) return 'the single face is not chosen at once';
    if (await page.getByTestId(EID.face).count()) return 'a face letter is shown for a single face';
    if ((await text(page, EID.note)) !== eS.one) return `the note says «${await text(page, EID.note)}»`;
    if (await page.getByTestId(EID.accept).isDisabled()) return '«אשרו את ההצעה» is disabled with a face chosen';
    await page.keyboard.press('Enter'); // the focus moved to the stage when the request started
    await page.getByTestId(EID.proposal).waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    const pts = await points(page);
    if (pts.length !== 2) return `${pts.length} points after Enter`;
    const same = pts.every((p) => r.some((q) => Math.abs(q.u - p.u) < 1e-9 && Math.abs(q.v - p.v) < 1e-9));
    if (!same) return `the accepted points are not the rings: ${JSON.stringify(pts)} vs ${JSON.stringify(r.map(({ u, v }) => ({ u, v })))}`;
    if ((await page.getByTestId(EID.proposal).count()) !== 0) return 'the proposal is still shown after accepting';
    const count = await text(page, ID.markCount);
    return count === S.marked(1, 2) ? true : `the count after accepting says «${count}»`;
  } finally { await ctx.close(); }
});

/**
 * E4: two faces, nothing chosen; Enter with nothing chosen does not place a point; a click near face ב chooses ב; Escape drops the
 * proposal; `]` then Enter accepts א by keyboard only; on close.png a click equally far from both faces chooses none and says «closer».
 */
const E4 = () => withBrowser(async (b, e) => {
  const lang: Lang = 'he', eS = eyesStrings(lang);
  const pid = await newProject(e.ready, 'e4');
  const { ctx, page } = await openEditor(b, e.ready, pid, lang);
  try {
    const byId = await openMarking(page, e, ['two', 'close']);
    if (!(await goTo(page, byId, 'two'))) return 'two.png is not reachable in the marking view';
    const [left, right] = e.fx.stills.two.faces as [DrawnFace, DrawnFace];
    await page.getByTestId(EID.suggest).waitFor({ timeout: 15000 });
    await suggestByClick(page);
    if ((await proposalOutcome(page)) !== 'faces') return 'two.png: no proposal';
    let r = await rings(page);
    if (r.length !== 4 || r.some((x) => x.chosen !== 'false')) return `two.png: ${r.length} rings, chosen ${r.map((x) => x.chosen).join(',')}`;
    const letters = await page.getByTestId(EID.face).evaluateAll((els) => els.map((el) => [el.getAttribute('data-face'), el.textContent, el.getAttribute('style')] as const));
    // Hebrew reads right to left: the right face is א (letter index 0), the left face ב (1)
    const leftLetter = letters.find((l) => pct(l[2], 'left') * 640 < 320), rightLetter = letters.find((l) => pct(l[2], 'left') * 640 > 320);
    if (leftLetter?.[1] !== 'ב' || rightLetter?.[1] !== 'א') return `letters: ${JSON.stringify(letters.map((l) => l[1]))} (left ${leftLetter?.[1]}, right ${rightLetter?.[1]})`;
    if (!(await page.getByTestId(EID.accept).isDisabled())) return '«אשרו את ההצעה» is enabled with nothing chosen';
    if (!(await page.getByTestId(EID.accept).getAttribute('aria-describedby'))) return 'the disabled accept button has no reason beside it';
    if ((await text(page, EID.note)) !== eS.many(2)) return `the note says «${await text(page, EID.note)}»`;
    await stage(page).focus(); await page.keyboard.press('Enter');
    if ((await points(page)).length !== 0) return 'Enter placed a point while a proposal was shown (C12)';
    // a click near face ב (the left face's middle) chooses it
    await clickAt(page, (left.a.x + left.b.x) / 2, left.a.y + 4, 640, 480);
    r = await rings(page);
    if (!r.filter((x) => x.face === '1').every((x) => x.chosen === 'true') || r.some((x) => x.face !== '1' && x.chosen === 'true')) return `a click near ב chose ${JSON.stringify(r.map((x) => [x.face, x.chosen]))}`;
    if ((await points(page)).length !== 0) return 'the choosing click placed a hand point';
    if ((await text(page, EID.note)) !== eS.chosenFace(1)) return `after choosing ב the note says «${await text(page, EID.note)}»`;
    await page.keyboard.press('Escape');
    if (await page.getByTestId(EID.proposal).count()) return 'Escape did not drop the proposal';
    if (!(await page.getByTestId(ID.dialog).count())) return 'Escape on the proposal closed the dialog';
    // keyboard only: the button by focus + Enter, `]` chooses א (the first letter), Enter accepts it
    await page.getByTestId(EID.suggest).focus(); await page.keyboard.press('Enter');
    if ((await proposalOutcome(page)) !== 'faces') return 'two.png: no second proposal';
    await page.keyboard.press(']');
    r = await rings(page);
    const chosen = r.filter((x) => x.chosen === 'true');
    if (chosen.length !== 2 || chosen.some((x) => x.face !== '0')) return `] chose ${JSON.stringify(r.map((x) => [x.face, x.chosen]))}`;
    await page.keyboard.press('Enter');
    const off = matches(await points(page), right, 640, 480);
    if (off) return `] then Enter: ${off}`;
    // close.png: a click as far from one face as from the other chooses none
    if (!(await goTo(page, byId, 'close'))) return 'close.png is not reachable';
    await page.getByTestId(EID.suggest).waitFor({ timeout: 15000 });
    await suggestByClick(page);
    if ((await proposalOutcome(page)) !== 'faces' || (await rings(page)).length !== 4) return 'close.png: not two faces';
    // on the bisector x = 321, 30 px below the eyes (50 px across, so 58 px from each middle, inside both reaches of 60), at a WHOLE
    // screen pixel: a mouse event's position is a whole pixel, and off the axis its rounding error counts only by dx / d
    const cb = (await stage(page).locator('canvas').boundingBox())!;
    await page.mouse.click(Math.round(cb.x + (321 / 640) * cb.width), Math.round(cb.y + (271 / 480) * cb.height));
    r = await rings(page);
    if (r.some((x) => x.chosen === 'true')) return 'an equidistant click chose a face';
    if ((await points(page)).length !== 0) return 'an equidistant click placed a hand point';
    const note = await text(page, EID.note);
    return note === eS.closer ? true : `the equidistant click says «${note}»`;
  } finally { await ctx.close(); }
});

/**
 * E9: proposals accepted on two pictures go through «צרו» (growing plan/apply) as hand marks do: one growing run with both pictures
 * on the timeline, and no eye-shaped key or accepted coordinate anywhere in the owner's document outside the clips' `transform`.
 */
const E9 = () => withBrowser(async (b, e) => {
  const lang: Lang = 'he', S = growingStrings(lang);
  const pid = await newProject(e.ready, 'e9');
  const { ctx, page } = await openEditor(b, e.ready, pid, lang);
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  try {
    const byId = await openMarking(page, e, ['one', 'two']);
    const accepted: number[] = [];
    for (const [name, keys] of [['one', []], ['two', [']']]] as const) {
      if (!(await goTo(page, byId, name))) return `${name}.png is not reachable`;
      await page.getByTestId(EID.suggest).waitFor({ timeout: 15000 });
      await suggestByClick(page);
      if ((await proposalOutcome(page)) !== 'faces') return `${name}.png: no proposal`;
      for (const k of keys) await page.keyboard.press(k);
      await page.keyboard.press('Enter');
      const pts = await points(page);
      if (pts.length !== 2) return `${name}.png: ${pts.length} points after accepting`;
      for (const p of pts) accepted.push(p.u, p.v);
    }
    if ((await text(page, ID.markCount)) !== S.marked(2, 2)) return `the count says «${await text(page, ID.markCount)}»`;
    await page.getByRole('button', { name: S.next, exact: true }).click();
    await page.getByTestId(ID.create).waitFor({ timeout: 10000 });
    await page.getByTestId(ID.create).click();
    await page.getByTestId(ID.bar).waitFor({ timeout: 60000 });
    const doc = (await agent(e.ready, `/projects/${pid}`)).project;
    const runs = Object.values(doc.recipeRuns ?? {}).filter((x: any) => x.recipeId === 'template:tpl.growing') as any[];
    if (runs.length !== 1) return `${runs.length} growing runs`;
    const clips = Object.values(doc.sequences).flatMap((q: any) => q.tracks).flatMap((t: any) => t.clips) as any[];
    const placed = runs[0].slots.filter((x: any) => x.kind === 'picture').filter((x: any) => clips.some((c) => c.id === x.clipId)).length;
    if (placed !== 2) return `${placed} of 2 pictures on the timeline`;
    // the owner's own view of the document (the fullest one): no eye-shaped key, no accepted coordinate outside a transform
    const cookie = (await fetch(`${e.ready.url}/api/v1/session`, { headers: { origin: e.ready.url, connection: 'close', 'x-pf-owner-key': e.ready.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
    const ownerDoc = await (await fetch(`${e.ready.url}/api/v1/projects/${pid}`, { headers: { cookie, origin: e.ready.url, connection: 'close' } })).json();
    const outside: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === 'number') { if (!/\.transform\./.test(at) && accepted.some((m) => Math.abs(m - v) < 1e-9)) outside.push(`${at} = ${v}`); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/^(eye(s|Marks?)?|proposals?|faces)$/i.test(k)) outside.push(`${at}.${k}`); walk(x, `${at}.${k}`); }
    };
    walk(ownerDoc, 'project');
    const forms = [...new Set(accepted.flatMap((x) => [String(x), x.toFixed(6)]))];
    const local = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    for (const [where, t] of [['storage', local], ['the URL', page.url()], ['the console', consoleLines.join('\n')]] as const) for (const f of forms) if (t.includes(f)) outside.push(`${where} holds ${f}`);
    return outside.length ? `an accepted coordinate is kept: ${outside.slice(0, 5).join('; ')}` : true;
  } finally { await ctx.close(); }
});

/**
 * E10 (interface side): «עצרו» during a slow fake answer kills the worker within 1 s and nothing is shown afterwards; the next
 * request starts a fresh process and answers; closing the dialog during a slow answer kills the worker within 1 s.
 */
const E10 = () => withBrowser(async (b, e) => {
  const lang: Lang = 'he', eS = eyesStrings(lang);
  const pid = await newProject(e.ready, 'e10');
  const { ctx, page } = await openEditor(b, e.ready, pid, lang);
  const live = () => pidsRunning(e.w.worker).length;
  try {
    if (!(await openOne(page, e))) return 'one.png is not reachable in the marking view';
    await page.getByTestId(EID.suggest).waitFor({ timeout: 15000 });
    if (live() !== 0) return 'a worker process runs before any request';
    const started = await withFake('slow', async () => { await suggestByClick(page); return waitFor(() => live() === 1, 15000); });
    if (!started) return 'the slow request started no worker process';
    if ((await text(page, EID.note)) !== eS.running) return `while running the note says «${await text(page, EID.note)}»`;
    const [pid1] = pidsRunning(e.w.worker);
    await page.getByTestId(EID.stop).click();
    if (!(await waitFor(() => live() === 0, 1000))) return '«עצרו»: the worker process was alive 1 s later';
    await page.waitForTimeout(1500);
    if (await page.getByTestId(EID.proposal).count()) return 'a proposal was shown after «עצרו»';
    await suggestByClick(page);
    if ((await proposalOutcome(page)) !== 'faces') return 'the next request did not answer';
    if (!(await waitFor(() => live() === 0, 1000))) return 'the worker stayed after its answer';
    await page.keyboard.press('Escape');
    const again = await withFake('slow', async () => { await suggestByClick(page); return waitFor(() => live() === 1, 15000); });
    if (!again) return 'the second slow request started no worker process';
    const [pid2] = pidsRunning(e.w.worker);
    if (pid2 === pid1) return 'the same process was used twice';
    await page.getByTestId(ID.close).click();
    await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    if (await page.getByTestId(ID.dialog).count()) return 'the dialog did not close';
    return (await waitFor(() => live() === 0, 1000)) ? true : 'closing the dialog: the worker process was alive 1 s later';
  } finally { await ctx.close(); }
});

/**
 * U1: the eyes flow by keyboard only, in Hebrew and English, at 1280 and 1440 px: Tab reaches «הציעו עיניים», Enter asks, Enter
 * accepts; the words and directions follow the language while the stage stays ltr; the button row fits the width.
 */
const U1 = () => withBrowser(async (b, e) => {
  const fails: string[] = [];
  for (const lang of ['he', 'en'] as const) for (const width of [1280, 1440]) {
    const eS = eyesStrings(lang), S = growingStrings(lang);
    const pid = await newProject(e.ready, `u1-${lang}-${width}`);
    const { ctx, page } = await openEditor(b, e.ready, pid, lang, width);
    const at = `${lang}@${width}`;
    try {
      if (!(await openOne(page, e))) { fails.push(`${at}: one.png is not reachable`); continue; }
      await page.getByTestId(EID.suggest).waitFor({ timeout: 15000 });
      let on = false;
      for (let k = 0; k < 40 && !on; k++) { await page.keyboard.press('Tab'); on = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, EID.suggest); }
      if (!on) { fails.push(`${at}: Tab never reached «${eS.suggest}»`); continue; }
      if (((await page.getByTestId(EID.suggest).textContent()) ?? '').trim() !== eS.suggest) { fails.push(`${at}: the button's name`); continue; }
      await page.keyboard.press('Enter');
      if ((await proposalOutcome(page)) !== 'faces') { fails.push(`${at}: no proposal`); continue; }
      if ((await text(page, EID.note)) !== eS.one) { fails.push(`${at}: the note says «${await text(page, EID.note)}»`); continue; }
      if ((await page.getByTestId(EID.note).getAttribute('role')) !== 'status') fails.push(`${at}: the note is not a status line`);
      await page.keyboard.press('Enter');
      if ((await points(page)).length !== 2 || (await text(page, ID.markCount)) !== S.marked(1, 2)) { fails.push(`${at}: Enter did not accept (${await text(page, ID.markCount)})`); continue; }
      if ((await page.getByTestId(ID.markView).getAttribute('dir')) !== 'ltr') fails.push(`${at}: the stage is not ltr`);
      const rowDir = await page.getByTestId(EID.suggest).evaluate((el) => el.closest('.pf-growing-row')?.getAttribute('dir'));
      if (rowDir !== (lang === 'he' ? 'rtl' : 'ltr')) fails.push(`${at}: the button row is dir=${rowDir}`);
      if ((await text(page, EID.privacy)) !== eS.privacy) fails.push(`${at}: the privacy sentence`);
      const box = await page.getByTestId(EID.suggest).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > width) fails.push(`${at}: the button is outside the window (${JSON.stringify(box)})`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) fails.push(`${at}: the page scrolls sideways`);
    } catch (x) { fails.push(`${at}: ${(x as Error).message.split('\n')[0]}`); } finally { await ctx.close(); }
  }
  return fails.length ? fails.join('; ') : true;
});

export const PICMODELS_PROOF_UI: PicmodelsProofPart = { built: true, checks: { E1, E2, E4, E9, E10, U1 } };
