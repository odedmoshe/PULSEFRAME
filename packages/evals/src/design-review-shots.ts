/**
 * Screenshots and layout measurements of the editor for a design review (not a proof: nothing is asserted).
 * Synthetic media only (ffmpeg lavfi sources). Writes PNGs and one metrics.json to the directory given as the first argument
 * (default .artifacts/design-review), one browser at a time.
 *   pnpm build && pnpm shots:review [outDir] [--quick]
 * --quick: only the owner's viewport (1908×876), light theme.
 * --extra: only the second pass (effects gallery, phone code, status centre, tab labels, toolbar labels, focus ring) at 1908 and 1528.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { openModes } from './editor-ui.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const out = path.resolve(argv.find((a) => !a.startsWith('--')) ?? path.join(root, '.artifacts/design-review'));
const quick = argv.includes('--quick');
const extra = argv.includes('--extra');
const media = path.join(out, 'media');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });

/** Runs in the page: sizes of the panes and of the picture, clipped text, small targets, contrast, Latin text, overflow. */
function measure(): unknown {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const box = (sel: string) => { const el = [...document.querySelectorAll(sel)].find(vis); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const name = (el: Element) => { const t = el.getAttribute('data-testid'); const c = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'); return `${el.tagName.toLowerCase()}${t ? `[${t}]` : ''}${c ? `.${c}` : ''}`; };
  const txt = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  // clipped by a clipping ancestor (an element that is outside its scroller's visible box)
  const onScreen = (el: Element) => { const r = el.getBoundingClientRect(); let p = el.parentElement; while (p) { const cs = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1 || r.right <= q.left + 1 || r.left >= q.right - 1) return false; } p = p.parentElement; } return r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh; };
  const all = [...document.querySelectorAll('body *')].filter(vis);
  // text that does not fit its box
  const clipped: { el: string; text: string; sw: number; cw: number; sh?: number; ch?: number }[] = [];
  for (const el of all) {
    if (!(el instanceof HTMLElement) || !onScreen(el)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    const hx = el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX);
    const hy = el.scrollHeight > el.clientHeight + 2 && /(hidden|clip)/.test(cs.overflowY);
    if (hx || hy) clipped.push({ el: name(el), text: txt(el), sw: el.scrollWidth, cw: el.clientWidth, ...(hy ? { sh: el.scrollHeight, ch: el.clientHeight } : {}) });
  }
  // text cut by its pane (the element's box crosses the bottom or side of a clipping ancestor)
  const cutByPane: { el: string; text: string; pane: string; over: number }[] = [];
  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
    if (!hasText) continue;
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p) { const cs = getComputedStyle(p); if (/(hidden|clip)/.test(cs.overflowY) && !/(auto|scroll)/.test(cs.overflowY)) { const q = p.getBoundingClientRect(); if (r.top < q.bottom - 2 && r.bottom > q.bottom + 1) { cutByPane.push({ el: name(el), text: txt(el), pane: name(p), over: Math.round(r.bottom - q.bottom) }); } break; } p = p.parentElement; }
  }
  // targets under 24 px
  const small: { el: string; label: string; w: number; h: number }[] = [];
  for (const el of all) {
    if (!el.matches('button, a[href], input:not([type=hidden]), select, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [role=slider], summary')) continue;
    if (!onScreen(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) small.push({ el: name(el), label: (el.getAttribute('aria-label') ?? txt(el)).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // contrast of text against its painted background (solid colours only; text over pictures is skipped)
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 }; };
  const lum = (c: { r: number; g: number; b: number }) => { const t = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * t(c.r) + 0.7152 * t(c.g) + 0.0722 * t(c.b); };
  const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el: Element): { r: number; g: number; b: number } | null => {
    let layers: { r: number; g: number; b: number; a: number }[] = [];
    for (let p: Element | null = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null;
      if (p.tagName === 'CANVAS' || p.tagName === 'VIDEO' || p.tagName === 'IMG') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    if (!layers.length) return { r: 255, g: 255, b: 255 };
    let acc = { r: layers[layers.length - 1]!.r, g: layers[layers.length - 1]!.g, b: layers[layers.length - 1]!.b };
    for (let i = layers.length - 2; i >= 0; i--) { const l = layers[i]!; acc = { r: l.r * l.a + acc.r * (1 - l.a), g: l.g * l.a + acc.g * (1 - l.a), b: l.b * l.a + acc.b * (1 - l.a) }; }
    layers = [];
    return acc;
  };
  const low: { el: string; text: string; ratio: number; fg: string; bg: string; px: number }[] = [];
  let textRuns = 0;
  for (const el of all) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
    if (!own.length || !onScreen(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg || !bg) continue;
    textRuns++;
    const fgc = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const k = ratio(fgc, bg); const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
    const disabled = !!el.closest('[disabled],[aria-disabled=true]');
    if (k < need && !disabled) low.push({ el: name(el), text: txt(el), ratio: Math.round(k * 100) / 100, fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, px });
  }
  // Latin words shown in the Hebrew interface (outside numbers, timecodes, key caps and user content)
  const latin = new Set<string>();
  if (document.documentElement.lang === 'he' || document.documentElement.dir === 'rtl') {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement; if (!p || !vis(p) || !onScreen(p)) continue;
      if (p.closest('.num, .tc, kbd, code, [dir=ltr] input, input, textarea, script, style, .pf-top-rev, [data-testid=project-name], .media-name, [data-user-text]')) continue;
      const m = (n.textContent ?? '').match(/[A-Za-z][A-Za-z_.:/-]{2,}/g);
      if (m) for (const x of m) latin.add(`${x} «${(n.textContent ?? '').trim().slice(0, 40)}» in ${name(p)}`);
    }
  }
  // the picture: the preview canvas as drawn
  const canvas = [...document.querySelectorAll('canvas[data-testid=preview]')].find(vis) as HTMLCanvasElement | undefined;
  const pic = canvas ? (() => { const r = canvas.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), area: Math.round((r.width * r.height) / (vw * vh) * 1000) / 10 }; })() : null;
  const lanes = [...document.querySelectorAll('.timeline .track')].filter(vis).map((t) => ({ cls: (t.getAttribute('class') ?? '').split(' ').slice(1, 3).join(' '), h: Math.round(t.getBoundingClientRect().height), clips: t.querySelectorAll('.clip').length }));
  const panes: Record<string, unknown> = {
    top: box('.pf-top'), rail: box('[data-shell-slot=rail]'), browser: box('.app > .library'), stage: box('.app > .stage'), inspector: box('.app > .inspector'),
    splitter: box('[data-shell-slot=splitter]'), timeline: box('.app > .timeline'), status: box('[data-shell-slot=status]'),
  };
  // rows of wrapped chips/tabs: any flex-wrap container whose children sit on more than one line
  const wrapped: { el: string; rows: number; items: number }[] = [];
  for (const el of all) {
    const cs = getComputedStyle(el); if (cs.display.indexOf('flex') < 0 || cs.flexWrap !== 'wrap' || !onScreen(el)) continue;
    const kids = [...el.children].filter(vis); if (kids.length < 2) continue;
    const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top / 4)));
    if (tops.size > 1) wrapped.push({ el: name(el), rows: tops.size, items: kids.length });
  }
  const dialogs = [...document.querySelectorAll('[role=dialog]')].filter(vis).map((d) => { const r = d.getBoundingClientRect(); const sc = d.querySelector('[class*=body]') ?? d; return { el: name(d), w: Math.round(r.width), h: Math.round(r.height), out: r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1, scroll: (sc as HTMLElement).scrollHeight > (sc as HTMLElement).clientHeight + 2 }; });
  const focus = document.activeElement && document.activeElement !== document.body ? (() => { const cs = getComputedStyle(document.activeElement!); return { el: name(document.activeElement!), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow.slice(0, 60) }; })() : null;
  return {
    viewport: { w: vw, h: vh }, hScroll: document.documentElement.scrollWidth > vw + 1, vScroll: document.documentElement.scrollHeight > vh + 1,
    panes, picture: pic, lanes, clipped: clipped.slice(0, 40), clippedCount: clipped.length, cutByPane: cutByPane.slice(0, 30), cutByPaneCount: cutByPane.length,
    small: small.slice(0, 60), smallCount: small.length, lowContrast: low.slice(0, 40), lowContrastCount: low.length, textRuns, latin: [...latin].slice(0, 40), wrapped: wrapped.slice(0, 20), dialogs, focus,
  };
}

async function main() {
  fs.mkdirSync(media, { recursive: true });
  fs.rmSync(path.join(out, 'data'), { recursive: true, force: true });
  const M = (n: string) => path.join(media, n);
  const make = (file: string, args: string[]) => { if (!fs.existsSync(M(file))) ff([...args, M(file)]); return M(file); };
  // synthetic sources only; Hebrew file names as a family's files would have
  const long916 = make('טיול-משפחתי-בצפון-יום-שני.mp4', ['-f', 'lavfi', '-t', '36', '-i', 'mandelbrot=s=540x960:r=30', '-f', 'lavfi', '-t', '36', '-i', 'sine=f=220', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest']);
  const p2 = make('יום-הולדת-בגן-עם-סבתא-וסבא.mp4', ['-f', 'lavfi', '-t', '6', '-i', 'gradients=s=540x960:r=30:speed=0.03', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30']);
  const l1 = make('חוף-הים-בערב.mp4', ['-f', 'lavfi', '-t', '8', '-i', 'testsrc2=s=960x540:r=30', '-f', 'lavfi', '-t', '8', '-i', 'sine=f=330', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest']);
  const l2 = make('גן-החיות.mp4', ['-f', 'lavfi', '-t', '8', '-i', 'cellauto=s=960x540:r=30:rule=110', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30']);
  const img1 = make('תמונה-מהחתונה-של-דודה-רותי.png', ['-f', 'lavfi', '-i', 'smptehdbars=s=1280x720', '-frames:v', '1']);
  const img2 = make('img_2041.png', ['-f', 'lavfi', '-i', 'gradients=s=1080x1350:c0=0x2a1a5e:c1=0xf5b84b', '-frames:v', '1']);
  const music = make('שיר-רקע-שמח.wav', ['-f', 'lavfi', '-t', '30', '-i', 'sine=f=110', '-af', 'tremolo=f=2:d=0.9', '-ac', '2']);

  const s = await startServer({ port: Number(process.env.PF_SHOTS_PORT ?? 8833), dataDir: path.join(out, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = (await r.json()) as any; if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`); return j; };
  const txs = async (pid: string, ops: unknown[]) => call(`/projects/${pid}/transactions`, { ops });
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': encodeURIComponent(path.basename(file)) }, body: fs.readFileSync(file) })).json()) as any;

  // projects
  const empty = (await call('/projects', { name: 'פרויקט חדש', width: 1080, height: 1920 })).project.id as string;
  const v916 = (await call('/projects', { name: 'טיול בצפון', width: 1080, height: 1920 })).project.id as string;
  const a916: any[] = [];
  for (const file of [long916, p2, l1, l2, img1, img2]) a916.push(await upload(v916, file));
  const clip916 = (await txs(v916, [{ op: 'add_clip', args: { assetId: a916[0].assetId, start: f(0) } }])).results[0].output.clipId as string;
  // the owner's screen: the same clip with the empty lanes the owner had (T1, C1, FX1, V2 over V1)
  const own = (await call('/projects', { name: 'טיול בצפון (כמו אצל הבעלים)', width: 1080, height: 1920 })).project.id as string;
  const ownA: any[] = [];
  for (const file of [long916, p2, l1, l2, img1, img2]) ownA.push(await upload(own, file));
  await txs(own, [{ op: 'add_clip', args: { assetId: ownA[0].assetId, start: f(0) } }]);
  // a made-up Hebrew transcript (the owner's clip had speech): eight phrases over the 36 s
  const said = ['בוקר טוב לכולם אנחנו יוצאים לטיול', 'הנה הנחל ואפשר לשמוע את המים', 'סבתא הביאה כריכים וגם עוגה', 'עכשיו עולים לתצפית הגבוהה', 'תראו איזה נוף יפה מכאן', 'הילדים רצים קדימה על השביל', 'עוד מעט מגיעים לחניון', 'תודה שצפיתם נתראה בטיול הבא'];
  const segments = said.map((text, i) => { const words = text.split(' '); const at = 1 + i * 4.4, per = 3.6 / words.length; return { start: T.fromSeconds(at.toFixed(3)), duration: T.fromSeconds('3.6'), text, words: words.map((w, j) => ({ start: T.fromSeconds((at + j * per).toFixed(3)), duration: T.fromSeconds(per.toFixed(3)), text: w })) }; });
  await txs(own, [{ op: 'set_transcript', args: { assetId: ownA[0].assetId, language: 'he', segments } }]);
  await txs(own, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'adjustment' } }]);
  const v169 = (await call('/projects', { name: 'חופשה בים', width: 1920, height: 1080 })).project.id as string;
  const b: any[] = [];
  for (const file of [l1, l2, img1, music]) b.push(await upload(v169, file));
  const clip169 = (await txs(v169, [{ op: 'add_clip', args: { assetId: b[0].assetId, start: f(0) } }])).results[0].output.clipId as string;
  await txs(v169, [{ op: 'add_clip', args: { assetId: b[1].assetId, start: f(240) } }, { op: 'add_clip', args: { assetId: b[3].assetId, start: f(0) } }, { op: 'add_text', args: { text: 'קיץ 2026', start: f(30), duration: f(90) } }]);
  // about 30 clips on several tracks
  const busy = (await call('/projects', { name: 'סיכום שנה', width: 1920, height: 1080 })).project.id as string;
  const c: any[] = [];
  for (const file of [l1, l2, img1, img2, music]) c.push(await upload(busy, file));
  const ops: unknown[] = [];
  for (let i = 0; i < 18; i++) ops.push({ op: 'add_clip', args: { assetId: c[i % 2].assetId, start: f(i * 45), duration: f(45) } });
  await txs(busy, ops);
  const tr = (await txs(busy, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId as string;
  await txs(busy, [0, 1, 2, 3].map((i) => ({ op: 'add_clip', args: { assetId: c[2 + (i % 2)].assetId, trackId: tr, start: f(60 + i * 180), duration: f(60) } })));
  await txs(busy, [0, 1, 2, 3, 4].map((i) => ({ op: 'add_text', args: { text: ['פתיחה', 'הטיול', 'החגים', 'הים', 'סוף'][i], start: f(i * 160), duration: f(60) } })));
  await txs(busy, [{ op: 'add_clip', args: { assetId: c[4].assetId, start: f(0) } }, { op: 'add_clip', args: { assetId: c[4].assetId, start: f(600), duration: f(210) } }]);
  await new Promise((r) => setTimeout(r, 4000)); // thumbnails and waveforms are made in the background

  const metrics: Record<string, unknown> = {};
  const browser = await chromium.launch();
  let n = 0;
  const shot = async (page: Page, file: string) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${file}.png`) });
    try { metrics[file] = await page.evaluate(`(() => { const __name = (f) => f; return (${measure.toString()})(); })()`); } catch (e) { metrics[file] = { error: String(e) }; }
    n++;
    fs.writeFileSync(path.join(out, extra ? 'metrics-extra.json' : 'metrics.json'), JSON.stringify(metrics, null, 1));
  };
  const attempt = async (label: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { metrics[`FAILED ${label}`] = String(e).slice(0, 400); console.error(`could not shoot ${label}: ${String(e).slice(0, 200)}`); } };
  const esc = async (page: Page) => { for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };
  const palette = async (page: Page, q: string) => { await page.getByTestId('open-palette').click(); await page.getByTestId('palette-input').fill(q); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(900); };

  /** Runs in the page: inspector tab labels, the timeline toolbar's buttons, lanes and the status pip. */
  const details = `(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const tabs = [...document.querySelectorAll('.app > .inspector [role=tab]')].filter(vis).map((t) => { const l = t.querySelector('.inspector-tab-label') || t; return { label: t.getAttribute('title') || t.textContent.trim(), shown: l.textContent.trim(), w: Math.round(t.getBoundingClientRect().width), cut: l.scrollWidth > l.clientWidth + 1 }; });
    const bar = document.querySelector('.timeline .tl-bar');
    const tools = bar ? [...bar.querySelectorAll('button, [role=switch], input')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); const txt = [...b.querySelectorAll('*'), b].filter((e) => !e.closest('.pf-sr') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')).join(' ').trim(); return { name: b.getAttribute('aria-label') || txt, visibleText: txt, x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' }; }) : [];
    const tl = document.querySelector('.app > .timeline');
    const lanes = [...document.querySelectorAll('.timeline .track')].filter(vis).map((t) => ({ cls: t.className.split(' ').slice(1, 3).join(' '), h: Math.round(t.getBoundingClientRect().height), clips: t.querySelectorAll('.clip').length, top: Math.round(t.getBoundingClientRect().top), bottom: Math.round(t.getBoundingClientRect().bottom) }));
    const tlBox = tl ? tl.getBoundingClientRect() : null;
    const pip = document.querySelector('[data-testid=status-pips]');
    const ruler = [...document.querySelectorAll('.timeline .ruler span, .timeline [data-testid=ruler] *')].filter(vis).map((e) => e.textContent.trim()).filter((x) => /^\\d+:\\d\\d/.test(x));
    const regions = {};
    for (const [nm, sel] of [['top', '.pf-top'], ['rail', '[data-shell-slot=rail]'], ['browser', '.app > .library'], ['stage', '.app > .stage'], ['inspector', '.app > .inspector'], ['timelineBar', '.timeline .tl-bar'], ['trackHeads', '.timeline'], ['status', '[data-shell-slot=status]']]) {
      const root = document.querySelector(sel); if (!root) continue;
      const ctl = [...root.querySelectorAll('button, [role=tab], [role=switch], select, input:not([type=hidden]), [role=slider]')].filter(vis).filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && !(nm === 'trackHeads' && b.closest('.tl-bar, .clip')); });
      const worded = ctl.filter((b) => { const t = [...b.querySelectorAll('*'), b].filter((e) => !e.closest('.pf-sr') && vis(e)).some((e) => [...e.childNodes].some((n) => n.nodeType === 3 && /[\u0590-\u05FFA-Za-z]{2,}/.test(n.textContent))); return t || (b.tagName === 'INPUT' && b.type !== 'checkbox' && b.type !== 'range'); });
      regions[nm] = { controls: ctl.length, withWord: worded.length, iconOnly: ctl.length - worded.length };
    }
    return { regions, tabs, tools, lanes, tl: tlBox && { top: Math.round(tlBox.top), h: Math.round(tlBox.height) }, pip: pip && { text: pip.textContent.trim(), label: pip.getAttribute('aria-label'), color: getComputedStyle(pip).color, title: pip.getAttribute('title') }, rulerFirst: ruler[0], rulerLast: ruler[ruler.length - 1] };
  })()`;
  if (extra) {
    try {
      for (const [vp, w, hh, theme] of [['1908', 1908, 876, 'light'], ['1528', 1528, 704, 'light'], ['1908', 1908, 876, 'dark']] as const) {
        const ctx = await browser.newContext({ viewport: { width: w, height: hh }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        await ctx.addInitScript((th) => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.theme', th); } catch { /* none */ } }, theme);
        const page = await ctx.newPage();
        const tag = (x: string) => `${vp}-${theme}-x-${x}`;
        const open = async (pid: string) => { await page.goto(`${s.ownerUrl}&project=${pid}`); await page.waitForTimeout(2500); };
        await attempt(tag('owner'), async () => { await open(own); metrics[tag('owner-details')] = await page.evaluate(details); await openModes(page); await page.getByTestId('workspace-captions').click(); await page.waitForTimeout(900); metrics[tag('owner-captions-details')] = await page.evaluate(details); await openModes(page); await page.getByTestId('workspace-sound').click(); await page.waitForTimeout(900); metrics[tag('owner-sound-details')] = await page.evaluate(details); await openModes(page); await page.getByTestId('workspace-pro').click(); });
        await attempt(tag('clip'), async () => { await open(v169); await page.locator(`.clip[data-clip-id="${clip169}"]`).first().click(); await page.waitForTimeout(800); metrics[tag('169-clip-details')] = await page.evaluate(details); });
        await attempt(tag('gallery'), async () => { await page.getByTestId('rail-effects').click(); await page.waitForTimeout(500); await page.getByTestId('gallery-open').first().click(); await page.waitForTimeout(3000); await shot(page, tag('21-effects-gallery')); await esc(page); });
        await attempt(tag('elements'), async () => { await page.getByTestId('rail-elements').click(); await page.waitForTimeout(3000); await shot(page, tag('22-elements-3s')); });
        await attempt(tag('status'), async () => { await page.getByTestId('rail-media').click(); await page.getByTestId('status-pips').click(); await page.waitForTimeout(900); await shot(page, tag('31-status-centre')); await esc(page); });
        await attempt(tag('phone'), async () => {
          await page.getByTestId('import-more').click(); await page.waitForTimeout(400); await page.getByTestId('phone-drop-open').click(); await page.waitForTimeout(1200); await shot(page, tag('35-phone-dialog'));
          const st = page.getByTestId('phone-drop-start');
          if (await st.count() && await st.isEnabled()) { await st.click(); await page.waitForTimeout(2000); await shot(page, tag('36-phone-qr')); } else metrics[tag('phone-start')] = 'phone-drop-start absent or disabled';
          await esc(page);
        });
        await attempt(tag('focus'), async () => {
          await open(v916); await page.getByTestId('timecode').click().catch(() => {});
          const seen: unknown[] = [];
          for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); const r = a.getBoundingClientRect(); return { el: a.tagName + '[' + (a.getAttribute('data-testid') || a.getAttribute('aria-label') || '').slice(0, 30) + ']', outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 50), x: Math.round(r.left), y: Math.round(r.top) }; })()`)); }
          metrics[tag('focus-walk')] = seen;
          await shot(page, tag('38-focus-after-14-tabs'));
        });
        await ctx.close();
      }
    } finally { await browser.close(); await s.close(); }
    fs.writeFileSync(path.join(out, 'metrics-extra.json'), JSON.stringify(Object.fromEntries(Object.entries(metrics)), null, 1));
    console.log(`wrote ${n} extra shots`);
    return;
  }
  const combos: [string, number, number, 'light' | 'dark', boolean][] = quick ? [['1908', 1908, 876, 'light', true]] : [
    ['1908', 1908, 876, 'light', true], ['1908', 1908, 876, 'dark', false], ['1528', 1528, 704, 'light', true], ['1528', 1528, 704, 'dark', false], ['1366', 1366, 650, 'light', false], ['1366', 1366, 650, 'dark', false],
  ];
  try {
    for (const [vp, w, hh, theme, full] of combos) {
      const ctx = await browser.newContext({ viewport: { width: w, height: hh }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await ctx.addInitScript((th) => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.theme', th); } catch { /* none */ } }, theme);
      const page = await ctx.newPage();
      const tag = (x: string) => `${vp}-${theme}-${x}`;
      const open = async (pid: string | null) => { await page.goto(pid ? `${s.ownerUrl}&project=${pid}` : s.ownerUrl); await page.waitForTimeout(2500); };
      await attempt(tag('welcome'), async () => { await open(empty); await shot(page, tag('01-empty-project')); });
      await attempt(tag('916-edit'), async () => { await open(v916); await shot(page, tag('02-916-edit-nosel')); await page.locator(`.clip[data-clip-id="${clip916}"]`).first().click(); await page.waitForTimeout(700); await shot(page, tag('03-916-edit-clip')); await esc(page); });
      await attempt(tag('916-captions'), async () => { await openModes(page); await page.getByTestId('workspace-captions').click(); await page.waitForTimeout(900); await shot(page, tag('04-916-captions')); });
      await attempt(tag('owner'), async () => { await open(own); await openModes(page); await page.getByTestId('workspace-captions').click(); await page.waitForTimeout(800); const sp = page.getByTestId('inspector-tab-speech'); if (await sp.count()) await sp.first().click(); await page.waitForTimeout(900); await shot(page, tag('04b-owner-captions-transcript')); await openModes(page); await page.getByTestId('workspace-pro').click(); await page.waitForTimeout(800); await shot(page, tag('04c-owner-edit')); });
      await attempt(tag('169-edit'), async () => { await open(v169); await shot(page, tag('05-169-edit-nosel')); await page.locator(`.clip[data-clip-id="${clip169}"]`).first().click(); await page.waitForTimeout(700); await shot(page, tag('06-169-edit-clip')); await esc(page); });
      await attempt(tag('busy'), async () => { await open(busy); await shot(page, tag('07-busy-timeline')); });
      await attempt(tag('export'), async () => { await open(v916); await page.getByTestId('export').click(); await page.getByTestId('export-sheet').waitFor({ timeout: 10000 }); await shot(page, tag('08-export-sheet')); await esc(page); });
      if (full) {
        // every mode and every tab of its side panels, on the 9:16 project with nothing selected and with the clip selected
        await open(v916);
        const modes = await page.locator('[data-testid^=workspace-]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!).filter((t) => t !== 'workspace-switch' && t !== 'workspace-menu'));
        for (const m of modes) {
          await attempt(tag(m), async () => {
            await openModes(page); await page.getByTestId(m).click(); await page.waitForTimeout(900);
            await shot(page, tag(`10-${m}`));
            const tabs = page.locator('.app > .inspector [role=tab], .app > .library [role=tablist]:not(.pf-rail-list) [role=tab]');
            const count = await tabs.count();
            for (let i = 0; i < count; i++) {
              const t = tabs.nth(i);
              if (!(await t.isVisible()) || (await t.getAttribute('aria-selected')) === 'true') continue;
              const id = ((await t.getAttribute('data-testid')) ?? (await t.getAttribute('id')) ?? `tab${i}`).replace(/[^a-z0-9-]/gi, '');
              await t.click(); await page.waitForTimeout(700);
              await shot(page, tag(`10-${m}-${id}`));
            }
          });
        }
        await openModes(page); await page.getByTestId('workspace-pro').click();
        // the rail's categories (media, audio, …, effects gallery, templates drawer, AI)
        for (const cat of ['media', 'audio', 'text', 'captions', 'effects', 'transitions', 'looks', 'elements', 'templates', 'ai']) {
          await attempt(tag(`rail-${cat}`), async () => { await page.getByTestId(`rail-${cat}`).click(); await page.waitForTimeout(1200); await shot(page, tag(`20-rail-${cat}`)); });
        }
        await attempt(tag('gallery'), async () => { await page.getByTestId('rail-effects').click(); await page.waitForTimeout(400); const g = page.getByTestId('gallery-open'); if (await g.count()) { await g.first().click(); await page.waitForTimeout(2500); await shot(page, tag('21-effects-gallery')); await esc(page); } });
        await page.getByTestId('rail-media').click();
        await attempt(tag('settings'), async () => { await page.getByTestId('rail-settings').click(); await page.waitForTimeout(800); await shot(page, tag('30-settings')); await esc(page); });
        await attempt(tag('status-pips'), async () => { const p = page.getByTestId('status-pips'); if (await p.count()) { await p.first().hover(); await page.waitForTimeout(700); await shot(page, tag('31-status-pips-hover')); } });
        await attempt(tag('palette'), async () => { await page.getByTestId('open-palette').click(); await page.waitForTimeout(800); await shot(page, tag('32-command-bar')); await page.getByTestId('palette-input').fill('מעבר'); await page.waitForTimeout(800); await shot(page, tag('33-command-bar-query')); await esc(page); });
        await attempt(tag('people'), async () => { await palette(page, 'אנשים'); await shot(page, tag('34-people-sheet')); await esc(page); });
        await attempt(tag('phone'), async () => {
          await palette(page, 'טלפון'); await shot(page, tag('35-phone-dialog'));
          const st = page.getByTestId('phone-drop-start');
          if (await st.count() && await st.isEnabled()) { await st.click(); await page.waitForTimeout(1500); await shot(page, tag('36-phone-qr')); }
          await esc(page);
        });
        await attempt(tag('projects'), async () => { await page.getByTestId('projects-open').click(); await page.waitForTimeout(800); await shot(page, tag('37-projects-dialog')); await esc(page); });
        // keyboard focus: Tab from the start of the page a few times
        await attempt(tag('focus'), async () => { await page.mouse.click(5, hh - 5); for (let i = 0; i < 6; i++) await page.keyboard.press('Tab'); await shot(page, tag('38-focus-tab6')); });
        // the start hub (no project chosen)
        await attempt(tag('hub'), async () => { await open(null); await shot(page, tag('00-start')); });
      }
      await ctx.close();
    }
  } finally { await browser.close(); await s.close(); }
  console.log(`wrote ${n} shots and metrics.json to ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
