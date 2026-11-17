/**
 * Sound effects «אפקטי קול» in the editor and for agents (ADR-0010; audio plan section 9: check I and the agent part of check J).
 *
 * I. The editor in Hebrew (right to left), keyboard only for the block itself:
 *   - Tab reaches the character-voice strip at its chosen chip; the arrow keys move along it in the order the chips are seen (right to
 *     left: ArrowLeft is the next chip), with Home and End, and change nothing; Space commits the focused chip as ONE revision, and a
 *     voice that replaces another is one revision too; Ctrl+Z restores the previous effect list exactly;
 *   - ▶ plays a choice from a scratch copy: the revision and the stored project stay as they were while the measurement tap shows signal;
 *   - the A/B switch «השוואה בלי אפקטים» changes what the tap hears (the echo between the beeps goes) and is not stored;
 *   - every control of the block has a Hebrew name; the heuristics of packages/evals/src/a11y-audit.ts find nothing with the block and
 *     every settings panel open (Hebrew and English); nothing in the block is animated, and under reduced motion nothing transitions;
 *   - the timeline marks the clip «∿», names its effects and tail, and draws the tail as static hatching; the clip tab of the picture
 *     opens the same block for its linked sound; a reason the player gives for playing a clip without its effects is shown.
 * J. Agents over MCP: list_catalog lists audioEffects with JSON schemas; add_audio_effect on a picture clip lands on the sound linked to
 *   it; get_timeline shows audioFx, fades, reverse and tailSeconds; describe_moment lists a clip heard only through its tail.
 *
 * Nobody has listened to these effects yet: this proof measures levels, revisions and states; it does not judge how anything sounds.
 * The accessibility checks are a copy of a11y-audit.ts's in-page heuristics (that script runs its own fixed flow on import), not a
 * WCAG conformance statement and no substitute for a screen reader or for users.
 *   pnpm build && tsx packages/evals/src/voicefx-ui-proof.ts      (the last step of pnpm proof:voicefx)
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { AUDIO_EFFECTS, AUDIO_PRESETS } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/voicefx-ui');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 900)}` : ''}`); };
const HEBREW = /[֐-׿]/;
/** Key-order-independent JSON, to compare stored effect lists. */
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
const BLOCK = '[data-testid=afx-block]';
type Level = { t: number; peak: number };

/**
 * The in-page checks of a11y-audit.ts (auditInPage), the same heuristics: every visible control has an accessible name, visible text
 * has enough contrast against its background, tabs have their semantics. Each finding also says whether it lies inside `scope`.
 */
function auditInPage(scope: string) {
  const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${(el as HTMLElement).dataset?.testid ? `[data-testid=${(el as HTMLElement).dataset.testid}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : ''}`;
  const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !(el as HTMLElement).closest('[hidden]'); };
  const nameOf = (el: Element): string => {
    const h = el as HTMLElement;
    const lb = h.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    const al = h.getAttribute('aria-label'); if (al?.trim()) return al.trim();
    if (h instanceof HTMLInputElement || h instanceof HTMLSelectElement || h instanceof HTMLTextAreaElement) {
      if (h.id) { const l = document.querySelector(`label[for="${CSS.escape(h.id)}"]`); if (l?.textContent?.trim()) return l.textContent.trim(); }
      const wrap = h.closest('label'); if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      if (h instanceof HTMLInputElement && ['button', 'submit'].includes(h.type) && h.value) return h.value;
    }
    const txt = h.textContent?.trim(); if (txt) return txt;
    const title = h.getAttribute('title'); if (title?.trim()) return title.trim();
    return '';
  };
  const inScope = (el: Element) => !!el.closest(scope);
  const unnamed: { el: string; inBlock: boolean }[] = [];
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=checkbox], [role=meter]')].filter(visible);
  for (const c of controls) if (!nameOf(c)) unnamed.push({ el: describe(c), inBlock: inScope(c) });
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1]!.split(/[,/ ]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 }; };
  const lum = (c: { r: number; g: number; b: number }) => { const k = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0]! + 0.7152 * k[1]! + 0.0722 * k[2]!; };
  const bgOf = (el: Element) => { let e: Element | null = el; let acc = { r: 13, g: 16, b: 21 }; const stack: { r: number; g: number; b: number; a: number }[] = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } e = e.parentElement; } for (const c of stack.reverse()) acc = { r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }; return acc; };
  const lowContrast: { el: string; ratio: number; text: string; size: number; inBlock: boolean }[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent?.trim() || !visible(el) || el.closest('canvas, [aria-hidden=true]')) continue;
    seen.add(el);
    const st = getComputedStyle(el);
    const fg = parse(st.color); if (!fg) continue;
    const bg = bgOf(el);
    const f2 = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const a = lum(f2), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(st.fontSize), bold = Number(st.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const disabled = !!el.closest(':disabled, [aria-disabled=true]');
    if (!disabled && ratio < need) lowContrast.push({ el: describe(el), ratio: Number(ratio.toFixed(2)), text: n.textContent.trim().slice(0, 30), size, inBlock: inScope(el) });
  }
  const tabIssues = [...document.querySelectorAll('[role=tab]')].filter((t) => !t.getAttribute('aria-controls') || !['true', 'false'].includes(t.getAttribute('aria-selected') ?? '')).map((t) => ({ el: describe(t), inBlock: inScope(t) }));
  return { lang: document.documentElement.lang, dir: document.documentElement.dir, controls: controls.length, controlsInBlock: controls.filter(inScope).length, unnamed, lowContrast, tabIssues };
}

/** Every visible control of the block with its accessible name (the same naming rule as the audit). */
function controlNames(scope: string) {
  const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !(el as HTMLElement).closest('[hidden]'); };
  const nameOf = (el: Element): string => {
    const h = el as HTMLElement;
    const lb = h.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    const al = h.getAttribute('aria-label'); if (al?.trim()) return al.trim();
    if (h instanceof HTMLInputElement || h instanceof HTMLSelectElement || h instanceof HTMLTextAreaElement) {
      if (h.id) { const l = document.querySelector(`label[for="${CSS.escape(h.id)}"]`); if (l?.textContent?.trim()) return l.textContent.trim(); }
      const wrap = h.closest('label'); if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    }
    const txt = h.textContent?.trim(); if (txt) return txt;
    return h.getAttribute('title')?.trim() ?? '';
  };
  const block = document.querySelector(scope);
  if (!block) return [];
  return [...block.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=radio], [role=switch], [role=slider], [role=checkbox]')].filter(visible)
    .map((el) => ({ el: `${el.tagName.toLowerCase()}${(el as HTMLElement).dataset.testid ? `[data-testid=${(el as HTMLElement).dataset.testid}]` : ''}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`, name: nameOf(el).replace(/\s+/g, ' ').slice(0, 80) }));
}

/** From `entry` (outside the block), Tab until focus has passed through the block: every stop inside it must show a focus ring. */
async function focusWalk(page: Page, scope: string, entry: string, max = 250) {
  await page.locator(entry).first().focus();
  const stops: string[] = [], missing: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate((s) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest(s)) return null;
      const st = getComputedStyle(el);
      return { id: `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`, ok: (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== 'none' };
    }, scope);
    if (!r) { if (stops.length) break; continue; }
    stops.push(r.id);
    if (!r.ok && !missing.includes(r.id)) missing.push(r.id);
  }
  return { stops: stops.length, missing };
}

/** The tap's 50 ms windows around the fixture's beeps (1 kHz, the first 100 ms of every second): the loudest beep window, and the loudest window well between the beeps, where only an echo (or noise) can sound. */
function beepsAndGaps(levels: Level[], seconds: number) {
  const beeps: number[] = [], gaps: number[] = [];
  for (const l of levels) {
    const k = Math.floor(l.t), x = l.t - k;
    if (l.t < 0 || l.t >= seconds) continue;
    if (x < 0.1) beeps.push(l.peak);
    else if (x >= 0.2 && x < 0.9) gaps.push(l.peak);
  }
  return { windows: levels.length, beepMax: +Math.max(0, ...beeps).toFixed(4), gapMax: +Math.max(0, ...gaps).toFixed(4), gapWindows: gaps.length };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4'), frames: 120 }); // 4 s, a 1 kHz beep at every second
  const s = await startServer({ port: 8858, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** A picture with its linked sound (0–4 s) and a title after it (4–8 s), so the programme runs on past the clip and a tail is not cut. */
  const makeProject = async (name: string) => {
    const pid = (await call('/projects', { name, width: 640, height: 360 })).body.project.id as string;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const r = (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'סוף', start: f(120), duration: f(120) } }] })).body;
    return { pid, picture: r.results[0].output.clipId as string, sound: r.results[0].output.audioClipId as string };
  };
  const stored = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: any; revision: number };
  const clipIn = (project: any, id: string) => Object.values(project.sequences as Record<string, any>).flatMap((q: any) => q.tracks).flatMap((t: any) => t.clips).find((c: any) => c.id === id);
  const fxList = (project: any, id: string) => (clipIn(project, id)?.audioFx ?? []) as { id: string; type: string; enabled: boolean; params: Record<string, unknown> }[];
  const types = (l: { type: string }[]) => l.map((x) => x.type);
  const measurements: Record<string, unknown> = {};
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // =================================================================== I: the editor
    console.log('# I. the «אפקטי קול» block, keyboard only');
    const A = await makeProject('אפקטי קול');
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } (window as any).__pfAudioTap = true; });
    await page.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
    await page.goto(`${s.ownerUrl}&project=${A.pid}`);
    await page.getByTestId('timecode').waitFor();
    if ((await page.evaluate(() => document.documentElement.lang)) !== 'he') await page.getByTestId('lang-toggle').click();
    const uiRev = async () => Number((await page.getByTestId('revision').textContent())!.replace(/\D+/g, ''));
    /** Waits for the editor to show revision `rev` (gives up after 15 s; the check that follows then says what it saw). */
    const waitRev = (rev: number) => page.waitForFunction((r) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) >= r, rev, { timeout: 15000 }).then(() => true, () => false);
    const active = () => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el && el !== document.body ? { testid: el.dataset.testid ?? null, role: el.getAttribute('role'), value: el.dataset.value ?? null, group: el.closest('[role=radiogroup]')?.getAttribute('data-testid') ?? null, inBlock: !!el.closest('[data-testid=afx-block]') } : null; });
    const sync = () => page.evaluate(() => (window as any).__pfSync?.() ?? null);
    const playing = async () => (await page.getByTestId('play').getAttribute('data-playing')) === 'true';
    const block = `${BLOCK}[data-clip-id="${A.sound}"]`;
    const chip = (group: string, value: string) => page.locator(`${block} [data-testid="${group}-${value}"]`);
    /** Tab (or Shift+Tab) until the focused element has `testid`. */
    const tabTo = async (testid: string, back = false, max = 40) => {
      for (let i = 0; i < max; i++) { if ((await active())?.testid === testid) return i; await page.keyboard.press(back ? 'Shift+Tab' : 'Tab'); }
      return (await active())?.testid === testid ? max : -1;
    };
    /** Selecting a clip from the keyboard: its timeline button, Enter. */
    const selectClip = async (id: string) => { await page.locator(`.clip[data-clip-id="${id}"]`).focus(); await page.keyboard.press('Enter'); };

    await selectClip(A.sound);
    await page.locator(block).waitFor({ timeout: 15000 });
    const timecode0 = await page.getByTestId('timecode').textContent();

    // --- Tab to the strip, then the arrows in the order the chips are seen
    await page.getByTestId('sound-fade-out').focus();
    let tabs = 0;
    let at = await active();
    while (!(at?.group === 'afx-voice' && at.role === 'radio') && tabs < 40) { await page.keyboard.press('Tab'); tabs++; at = await active(); }
    const rev0 = await uiRev();
    const geometry = await page.evaluate((b) => { const g = document.querySelector(`${b} [data-testid=afx-voice]`)!; return { dir: getComputedStyle(g).direction, chips: [...g.querySelectorAll<HTMLElement>('[role=radio]')].map((x) => ({ value: x.dataset.value, left: Math.round(x.getBoundingClientRect().left) })) }; }, block);
    check('Tab reaches the character-voice strip («דמות קול») at its chosen chip («ללא»)', at?.group === 'afx-voice' && at.value === 'none', { tabsFromFadeOut: tabs, at });
    check('the strip runs right to left: each next chip lies to the left of the one before', geometry.dir === 'rtl' && geometry.chips.length === 5 && geometry.chips.every((c, i) => i === 0 || c.left < geometry.chips[i - 1]!.left), geometry);
    const keys = ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'End', 'Home', 'ArrowRight', 'ArrowLeft', 'ArrowLeft'];
    const want = ['voice.telephone', 'voice.megaphone', 'voice.telephone', 'voice.robot', 'none', 'voice.robot', 'none', 'voice.telephone'];
    const got: (string | null)[] = [];
    for (const k of keys) { await page.keyboard.press(k); got.push((await active())?.value ?? null); }
    await sleep(400);
    check('the arrows follow the visual order (ArrowLeft = next chip, ArrowRight = previous, wrapping; Home and End to the ends), and moving commits nothing, moves no playhead and starts no playback',
      JSON.stringify(got) === JSON.stringify(want) && (await uiRev()) === rev0 && (await page.getByTestId('timecode').textContent()) === timecode0 && !(await playing()), { keys, want, got });

    // --- Space commits one revision
    await page.keyboard.press('Space');
    await waitRev(rev0 + 1);
    await sleep(800);
    const s1 = await stored(A.pid);
    const list1 = fxList(s1.project, A.sound);
    check('Space commits the focused chip as one revision: the telephone voice on the sound clip; focus stays on the chip, now chosen; no playback started',
      (await uiRev()) === rev0 + 1 && s1.revision === rev0 + 1 && JSON.stringify(types(list1)) === '["voice.telephone"]' && (await active())?.value === 'voice.telephone' && (await chip('afx-voice', 'voice.telephone').getAttribute('aria-checked')) === 'true' && !(await playing()),
      { revision: s1.revision, effects: types(list1) });
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft'); // telephone → megaphone → radio → robot
    const onRobot = (await active())?.value;
    await page.keyboard.press('Space');
    await waitRev(rev0 + 2);
    await sleep(800);
    const s2 = await stored(A.pid);
    check('choosing another voice replaces the first in one revision (one transaction)', onRobot === 'voice.robot' && (await uiRev()) === rev0 + 2 && s2.revision === rev0 + 2 && JSON.stringify(types(fxList(s2.project, A.sound))) === '["voice.robot"]', { onRobot, revision: s2.revision, effects: types(fxList(s2.project, A.sound)) });

    // --- Ctrl+Z restores the previous effect list
    await page.keyboard.press('Control+z');
    await waitRev(rev0 + 3);
    await sleep(800);
    const s3 = await stored(A.pid);
    check('Ctrl+Z (focus still on the chip) undoes it as one compensating revision and restores the previous effect list exactly (same effect id and parameters)',
      s3.revision === rev0 + 3 && canon(fxList(s3.project, A.sound)) === canon(list1) && (await chip('afx-voice', 'voice.telephone').getAttribute('aria-checked')) === 'true',
      { revision: s3.revision, restored: fxList(s3.project, A.sound), before: list1 });

    // --- ▶: listen without committing
    if (!(await active())?.inBlock) await chip('afx-voice', 'voice.robot').focus(); // the undo re-rendered the block; focus is normally still on the robot chip
    const toListen = await tabTo('afx-voice-listen-voice.robot');
    const revL = await uiRev();
    await page.keyboard.press('Space');
    const started = await page.waitForFunction(() => (window as any).__pfSync?.()?.auditioning === true, undefined, { timeout: 10000 }).then(() => true, () => false);
    await sleep(1600);
    const aud = await sync();
    const pressedWhilePlaying = await page.getByTestId('afx-voice-listen-voice.robot').getAttribute('aria-pressed');
    const animatedWhilePlaying = await page.evaluate((b) => document.getAnimations().filter((a) => { const t = (a.effect as KeyframeEffect | null)?.target; return !!t && !!(t as Element).closest?.(b); }).length, BLOCK);
    const sL = await stored(A.pid);
    const listenLevels: Level[] = aud?.audioLevels ?? [];
    const listenPeak = +Math.max(0, ...listenLevels.map((l) => l.peak)).toFixed(4);
    measurements.listen = { tabsToButton: toListen, windows: listenLevels.length, peak: listenPeak, auditioning: aud?.auditioning };
    check('▶ «השמעה לדוגמה: רובוט (לא נשמר)» plays the robot voice from a scratch copy: the tap shows signal while the revision and the stored project are unchanged; the button is pressed (a steady state, nothing animated)',
      toListen >= 0 && started && listenPeak > 0.05 && (await uiRev()) === revL && sL.revision === revL && canon(fxList(sL.project, A.sound)) === canon(list1) && pressedWhilePlaying === 'true' && animatedWhilePlaying === 0,
      measurements.listen);
    await page.keyboard.press('Space'); // the same ▶ again stops it
    const stopped = await page.waitForFunction(() => (window as any).__pfSync?.()?.auditioning === false, undefined, { timeout: 8000 }).then(() => true, () => false);
    await sleep(300);
    check('pressing ▶ again stops it; it is no longer pressed and still nothing was stored', stopped && (await page.getByTestId('afx-voice-listen-voice.robot').getAttribute('aria-pressed')) === 'false' && (await stored(A.pid)).revision === revL);

    // --- echo from the keyboard, then the A/B switch
    const toEcho = await tabTo('afx-echo');
    await page.keyboard.press('Space');
    await waitRev(revL + 1);
    await sleep(800);
    const s4 = await stored(A.pid);
    check('the «הד» toggle adds an echo in one revision; the list stays in the fixed order (voice, then echo)', toEcho >= 0 && s4.revision === revL + 1 && JSON.stringify(types(fxList(s4.project, A.sound))) === '["voice.telephone","space.echo"]', { tabs: toEcho, effects: types(fxList(s4.project, A.sound)) });
    /** Play 3.3 s from the start (Home, Space with nothing focused) and keep what the tap measured. */
    const record = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Home');
      await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 10000 }).catch(() => {});
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'true', undefined, { timeout: 15000 });
      await sleep(3300);
      const st = await sync();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 10000 }).catch(() => {});
      return { clock: st?.clock as string, levels: (st?.audioLevels ?? []) as Level[], fxVoices: st?.fxVoices as number | undefined, unavailable: st?.unavailableAudioFx };
    };
    const wet = await record();
    await page.locator(`${block} [data-testid=afx-echo]`).focus();
    const toBypass = await tabTo('afx-bypass');
    const revB = await uiRev();
    await page.keyboard.press('Space');
    await sleep(500);
    const bypassOn = { pressed: await page.getByTestId('afx-bypass').getAttribute('aria-pressed'), player: (await sync())?.bypassAudioFx, revision: await uiRev() };
    const dry = await record();
    await page.getByTestId('afx-bypass').focus();
    await page.keyboard.press('Space');
    await sleep(400);
    const bypassOff = { pressed: await page.getByTestId('afx-bypass').getAttribute('aria-pressed'), player: (await sync())?.bypassAudioFx };
    const wetP = beepsAndGaps(wet.levels, 3.3), dryP = beepsAndGaps(dry.levels, 3.3);
    measurements.bypass = { withEffects: { clock: wet.clock, fxVoices: wet.fxVoices, ...wetP }, bypassed: { clock: dry.clock, fxVoices: dry.fxVoices, ...dryP }, bypassOn, bypassOff, tabsToBypass: toBypass, note: 'peaks of 50 ms windows at the output tap; gaps are 0.2–0.9 s after each beep, where only the echo (and the telephone hiss) can sound' };
    check('playback with the effects: the beeps and, between them, the echo reach the tap',
      wet.clock === 'audio' && wetP.beepMax > 0.1 && wetP.gapMax > 0.02 && (wet.fxVoices ?? 1) >= 1, measurements.bypass);
    check('«השוואה בלי אפקטים» (pressed, from the keyboard) changes what the tap hears: the beeps stay, the echo between them goes; the switch is not stored (no revision)',
      toBypass >= 0 && bypassOn.pressed === 'true' && bypassOn.player === true && bypassOn.revision === revB && dry.clock === 'audio' && dryP.beepMax > 0.1 && dryP.gapMax < wetP.gapMax / 4 && (await stored(A.pid)).revision === revB,
      { wetGap: wetP.gapMax, dryGap: dryP.gapMax, wetBeep: wetP.beepMax, dryBeep: dryP.beepMax });
    check('switched back, the A/B switch is released', bypassOff.pressed === 'false' && bypassOff.player === false, bypassOff);

    // --- what the timeline and the block say about the effects and the tail
    const tl = await page.evaluate((id) => {
      const c = document.querySelector<HTMLElement>(`.clip[data-clip-id="${id}"]`)!;
      const tail = document.querySelector<HTMLElement>(`[data-testid=clip-tail][data-tail-of="${id}"]`);
      const cs = tail ? getComputedStyle(tail) : null;
      return { label: c.getAttribute('aria-label'), badge: !!c.querySelector('[data-testid=clip-fx-badge][aria-hidden=true]'), clipWidth: c.getBoundingClientRect().width, tail: tail ? { ariaHidden: tail.getAttribute('aria-hidden'), pointerEvents: cs!.pointerEvents, width: tail.getBoundingClientRect().width, clipId: tail.getAttribute('data-clip-id'), animation: cs!.animationName } : null };
    }, A.sound);
    const tailNote = await page.locator(`${block} [data-testid=afx-tail]`).textContent().catch(() => null);
    measurements.timeline = { ...tl, tailNote };
    check('timeline: «∿» on the clip, its accessible name lists the effects and the tail («אפקטים: טלפון, הד; זנב 1.0 שניות»), and the tail is static hatching of 1 s that is hidden from assistive technology, not a pointer target and not a clip',
      tl.badge && /אפקטים: טלפון, הד; זנב 1\.0 שניות/.test(tl.label ?? '') && !!tl.tail && tl.tail.ariaHidden === 'true' && tl.tail.pointerEvents === 'none' && tl.tail.clipId === null && tl.tail.animation === 'none' && Math.abs(tl.tail.width / (tl.clipWidth + 1) - 0.25) < 0.03 && /1\.0/.test(tailNote ?? ''),
      measurements.timeline);

    // --- nothing moves
    const motion = await page.evaluate((b) => {
      const els = [...document.querySelectorAll(`${b}, ${b} *`)];
      return { elements: els.length, animated: els.filter((e) => getComputedStyle(e).animationName !== 'none').map((e) => e.tagName), transitioning: els.filter((e) => !/^0s(, 0s)*$/.test(getComputedStyle(e).transitionDuration)).map((e) => `${e.tagName}.${(e as HTMLElement).className}`).slice(0, 8), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
    }, block);
    check('nothing in the block is animated, and under reduced motion nothing in it transitions either', motion.reducedMotion && motion.elements > 20 && motion.animated.length === 0 && motion.transitioning.length === 0, motion);

    // --- every control has a Hebrew name; the accessibility heuristics, with every settings panel open
    const openSettings = async () => { for (const b of await page.locator(`${block} [data-testid=afx-settings][aria-expanded=false]`).all()) await b.click(); };
    await openSettings();
    const names = await page.evaluate(controlNames, block);
    const notHebrew = names.filter((n) => !HEBREW.test(n.name));
    measurements.controlNames = names;
    check('every control of the block (chips, ▶, toggles, switches, sliders, settings, presets, A/B, apply to the track) has a Hebrew accessible name', names.length >= 30 && notHebrew.length === 0, { controls: names.length, notHebrew, sample: names.slice(0, 6) });
    const audits: Record<string, unknown> = {};
    for (const lang of ['he', 'en'] as const) {
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) { await page.getByTestId('lang-toggle').click(); await page.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 5000 }).catch(() => {}); }
      await openSettings();
      await sleep(300);
      const found = await page.evaluate(auditInPage, BLOCK);
      const focus = await focusWalk(page, block, '[data-testid=sound-fade-out]');
      await page.screenshot({ path: path.join(art, `block-${lang}.png`) });
      audits[lang] = { ...found, focus };
      const inBlock = found.unnamed.filter((x) => x.inBlock).length + found.lowContrast.filter((x) => x.inBlock).length + found.tabIssues.filter((x) => x.inBlock).length;
      const elsewhere = found.unnamed.length + found.lowContrast.length + found.tabIssues.length - inBlock;
      check(`[${lang}] the a11y-audit heuristics with the block and its settings open: no unnamed control, no low-contrast text, no tab defect in the block or anywhere on the page; every Tab stop in the block shows a focus ring`,
        found.lang === lang && found.dir === (lang === 'he' ? 'rtl' : 'ltr') && found.controlsInBlock >= 30 && inBlock === 0 && elsewhere === 0 && focus.stops >= 20 && focus.missing.length === 0,
        { lang: found.lang, dir: found.dir, controlsInBlock: found.controlsInBlock, inBlock, elsewhere, unnamed: found.unnamed.slice(0, 6), lowContrast: found.lowContrast.slice(0, 6), tabIssues: found.tabIssues.slice(0, 4), focusStops: focus.stops, noFocusRing: focus.missing });
    }
    measurements.a11y = audits;
    if ((await page.evaluate(() => document.documentElement.lang)) !== 'he') await page.getByTestId('lang-toggle').click();

    // --- the clip tab of the picture opens the same block for its linked sound
    await selectClip(A.picture);
    const opener = page.getByTestId('afx-linked-open');
    await opener.waitFor({ timeout: 10000 });
    await opener.focus();
    await page.keyboard.press('Space');
    await page.locator(block).waitFor({ timeout: 10000 });
    const linked = { expanded: await opener.getAttribute('aria-expanded'), rows: await page.locator(`${block} [data-testid=afx-row]`).count(), blocks: await page.locator(BLOCK).count() };
    check('the clip tab of the picture: «אפקטי קול…» (Space) opens the same block for the linked sound, with its two effects', linked.expanded === 'true' && linked.rows === 2 && linked.blocks === 1, linked);

    // --- a clip the player cannot run effects for is named next to the picture notices (display only: the reason is set on the player by this script)
    const injected = 'proof: a reason set by the script (display check only)';
    const hasPlayer = await page.evaluate(([id, why]) => { const p = (window as any).__pfPlayer; if (!p) return false; p.unavailableAudioFx = { [id!]: why }; p.seek(0); return true; }, [A.sound, injected] as const);
    const notice = await page.getByTestId('audio-fx-unavailable').textContent({ timeout: 5000 }).catch(() => null);
    const inBlockNote = await page.locator(`${block} [data-testid=afx-unavailable]`).textContent({ timeout: 2000 }).catch(() => null);
    await page.evaluate(() => { const p = (window as any).__pfPlayer; if (p) { p.unavailableAudioFx = {}; p.seek(0); } });
    const gone = await page.getByTestId('audio-fx-unavailable').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
    check('a reason the player gives for playing a clip without its effects is shown next to the picture notices and in the block, with the clip named (reason injected by this script: display only)',
      hasPlayer && !!notice && notice.includes(injected) && notice.includes('fixture.mp4') && HEBREW.test(notice) && !!inBlockNote?.includes(injected) && gone, { notice, inBlockNote, gone });
    check('no page errors in the editor', errors.length === 0, errors.slice(0, 3));
    await page.close();

    // =================================================================== J: agents over MCP
    console.log('# J. agents (MCP)');
    const B = await makeProject('agent');
    const mcp = new Client({ name: 'voicefx-ui-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } } }));
    const tool = async (name: string, args: Record<string, unknown>) => {
      const r = await mcp.callTool({ name, arguments: args });
      const text = (r.content as any[]).find((c) => c.type === 'text')?.text;
      let data: any;
      try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
      return { isError: !!r.isError, data };
    };
    try {
      const toolNames = (await mcp.listTools()).tools.map((t) => t.name);
      const fxTools = ['add_audio_effect', 'update_audio_effect', 'remove_audio_effect', 'apply_audio_preset', 'copy_audio_effects'];
      check('MCP: the five sound-effect operations are tools (generated from the operation registry)', fxTools.every((t) => toolNames.includes(t)), { missing: fxTools.filter((t) => !toolNames.includes(t)) });
      const cat = (await tool('list_catalog', {})).data;
      const ae: any[] = cat?.audioEffects ?? [];
      const schemaOk = ae.length === AUDIO_EFFECTS.length && ae.every((e) => e.paramsSchema?.type === 'object' && Object.keys(e.paramsSchema.properties ?? {}).length > 0 && e.defaults && typeof e.version === 'number' && typeof e.latency === 'string' && /preview, browser export and server export/.test(e.implementation ?? ''));
      measurements.catalog = { audioEffects: ae.map((e) => ({ id: e.id, version: e.version, stage: e.stage, params: Object.keys(e.paramsSchema?.properties ?? {}) })), audioPresets: (cat?.audioPresets ?? []).map((p: any) => p.id), note: cat?.note };
      check('list_catalog lists audioEffects (all nine, with JSON schemas, defaults, version, latency and the shared implementation) and audioPresets; sound files of the library stay apart (soundEffects)',
        schemaOk && JSON.stringify(ae.map((e) => e.id)) === JSON.stringify(AUDIO_EFFECTS.map((e) => e.id)) && (cat?.audioPresets ?? []).length === AUDIO_PRESETS.length && Array.isArray(cat?.soundEffects) && /sound entries/.test(cat?.note ?? ''),
        measurements.catalog);
      const added = await tool('add_audio_effect', { projectId: B.pid, clipId: B.picture, type: 'space.echo', params: { delayMs: 250, repeats: 4 } });
      const res = added.data?.results?.[0];
      check('MCP add_audio_effect on the PICTURE clip lands on the sound linked to it (one revision; the output names the sound clip and the planned tail of 1 s)',
        !added.isError && added.data?.committed === true && JSON.stringify(res?.affectedIds) === JSON.stringify([B.sound]) && res?.output?.effects?.[0]?.clipId === B.sound && res?.output?.tailSeconds === 1,
        added.isError ? added.data : { affectedIds: res?.affectedIds, output: res?.output });
      const more = await tool('apply_transaction', { projectId: B.pid, ops: [{ op: 'set_clip_fades', args: { clipId: B.sound, fadeOut: T.rt(1, 2) } }, { op: 'set_clip_reverse', args: { clipId: B.picture, reverse: true } }] });
      const tlm = (await tool('get_timeline', { projectId: B.pid })).data;
      const clips = (tlm?.tracks ?? []).flatMap((t: any) => t.clips);
      const sc = clips.find((c: any) => c.id === B.sound), pc = clips.find((c: any) => c.id === B.picture);
      measurements.getTimeline = { sound: sc && { audioFx: sc.audioFx, fadeIn: sc.fadeIn, fadeOut: sc.fadeOut, fadeOutSeconds: sc.fadeOutSeconds, reverse: sc.reverse, keepPitch: sc.keepPitch, volumeKeys: sc.volumeKeys, tailSeconds: sc.tailSeconds }, pictureHasAudioFx: pc ? 'audioFx' in pc : null, tracks: (tlm?.tracks ?? []).map((t: any) => ({ kind: t.kind, muted: t.muted })) };
      check('get_timeline shows the sound clip\'s audioFx (type, enabled, params), its fades, reverse and tailSeconds (1 s); the picture clip carries no sound fields; tracks say whether they are muted',
        !more.isError && sc?.audioFx?.length === 1 && sc.audioFx[0].type === 'space.echo' && sc.audioFx[0].enabled === true && sc.audioFx[0].params?.delayMs === 250 && sc.fadeOutSeconds === 0.5 && sc.fadeIn === null && sc.reverse === true && sc.keepPitch === false && sc.volumeKeys === 0 && sc.tailSeconds === 1 && pc && !('audioFx' in pc) && (tlm?.tracks ?? []).every((t: any) => typeof t.muted === 'boolean'),
        measurements.getTimeline);
      const during = (await tool('describe_moment', { projectId: B.pid, frameIndex: 60 })).data;
      const inTail = (await tool('describe_moment', { projectId: B.pid, frameIndex: 135 })).data; // 4.5 s: half a second after the clip end
      const after = (await tool('describe_moment', { projectId: B.pid, frameIndex: 160 })).data; // 5.33 s: past the 1 s tail
      const body = (during?.audio ?? []).find((a: any) => a.clipId === B.sound);
      const tailEntry = (inTail?.audio ?? []).find((a: any) => a.clipId === B.sound);
      measurements.describeMoment = { frame60: during?.audio, frame135: inTail?.audio, frame160: after?.audio };
      check('describe_moment: inside the clip the sound entry names its effects (fx); half a second after its end it is listed as heard only through its tail ({tail: true, secondsAfterEnd 0.5, fx}); after the tail it is gone',
        !!body && JSON.stringify(body.fx) === '["space.echo"]' && !body.tail && !!tailEntry && tailEntry.tail === true && Math.abs(tailEntry.secondsAfterEnd - 0.5) < 0.001 && JSON.stringify(tailEntry.fx) === '["space.echo"]' && !(after?.audio ?? []).some((a: any) => a.clipId === B.sound),
        measurements.describeMoment);
    } finally {
      await mcp.close();
    }
  } catch (e) {
    console.error(e);
    check('run completed', false, String((e as Error)?.stack ?? e).slice(0, 800));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none', browser: 'headless Chromium (Playwright)' },
      scope: 'Plan section 9, check I (the «אפקטי קול» block in the editor: keyboard flow in Hebrew, listen, A/B, names, accessibility heuristics, timeline tail, clip-tab disclosure) and the agent part of check J (list_catalog, add_audio_effect on a picture over MCP, get_timeline, describe_moment). One synthetic 4-second fixture (frame barcode with a 1 kHz beep at every second). Levels come from the measurement tap at the preview output; nobody has listened, and nothing here says how the effects sound. The accessibility checks are the a11y-audit.ts heuristics (copied: that script runs its own flow), not a WCAG conformance claim and no screen-reader or user testing. The notice of a clip played without its effects is checked with a reason set by the script, not with a real failure.',
      passed: checks.length - failed.length, total: checks.length, checks, measurements,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/voicefx-ui-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSound effects UI and agent proof ${report.result}: ${report.passed}/${report.total}. Evidence: docs/evidence/voicefx-ui-proof.json`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
