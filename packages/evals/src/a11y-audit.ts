/**
 * Accessibility audit of the editor (SPEC §3, Appendix C3): an automated HEURISTIC pass in Hebrew (RTL) and English (LTR).
 * It checks things a script can decide: every control has an accessible name, text contrast, visible keyboard focus,
 * document language/direction, tab semantics. It is not a WCAG conformance statement and does not replace testing with a
 * screen reader or with users. Findings are written to docs/evidence/a11y-audit.json. The transient states include the
 * effect gallery dialog and the look panel with the visual wave's controls (beat fieldset, date stamp, time separator), and the
 * AI-model wave's surfaces (ADR-0017): the AI tools panel with a run sheet open, the before/after compare slider after a run of the
 * ffmpeg-only classic vocal remover, and the translation review (a typed translation fixture; no model runs).
 * motion tracking UI (ADR-0015): the tracking panel, follow and privacy-region controls with their warning, and the track picker.
 * Templates and adjustment layers (ADR-0016): an adjustment clip's inspector, the Templates drawer (its first card at the inline
 * start), the template dialog (first step and plan step) and the post-apply bar.
 * The trend pack's panels (ADR-0012): the title effects panel with all six look fields on, and the transition options of a light
 * transition (beat lock, velocity, colour, seed, light status).
 * The life line (ADR-0021) and the content-pack mounts: the media drawer by date and by event (with the sunset choice), the
 * field menu of a title (a menu), the live line with its anchored error and fix, the people sheet (a modal dialog opened from
 * the field menu), the Hanukkah pack page, the built-in music tab of the audio drawer and the text drawer with its fonts.
 * Keyframe curves and motion paths (ADR-0019): the keyframe strip of a selected title with the motion path on the stage
 * (vertices and bend grips), and the curve picker (a modal dialog opened from a strip key with Enter).
 *   pnpm build && pnpm audit:a11y
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { sha256Hex } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { withExif } from '../../../apps/server/src/captureMeta.fixtures.ts';
import { chooseFormat, formatOptions, openCardMenu } from './editor-ui.ts';
import { makeRenderCacheCtx, renderCacheA11yScenarios } from './a11y-render-cache.ts';
import { makeApi, ownerApi } from './incremental-fixtures.ts';
import { KF_TESTIDS } from '../../../apps/web/src/editor/keyframes.testids.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/a11y');
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });

/** Runs in the page. Returns findings; selectors are short descriptions for a person to locate the element. */
function auditInPage() {
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
  const unnamed: string[] = [];
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=checkbox], [role=meter]')].filter(visible);
  for (const c of controls) if (!nameOf(c)) unnamed.push(describe(c));

  // contrast of visible text against the nearest opaque background
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1]!.split(/[,/ ]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 }; };
  const lum = (c: { r: number; g: number; b: number }) => { const k = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0]! + 0.7152 * k[1]! + 0.0722 * k[2]!; };
  const bgOf = (el: Element) => { let e: Element | null = el; let acc = { r: 13, g: 16, b: 21 }; const stack: { r: number; g: number; b: number; a: number }[] = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } e = e.parentElement; } for (const c of stack.reverse()) acc = { r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }; return acc; };
  const lowContrast: { el: string; ratio: number; text: string; size: number }[] = [];
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
    if (!disabled && ratio < need) lowContrast.push({ el: describe(el), ratio: Number(ratio.toFixed(2)), text: n.textContent.trim().slice(0, 30), size });
  }
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const tabIssues = tabs.filter((t) => !t.getAttribute('aria-controls') || !['true', 'false'].includes(t.getAttribute('aria-selected') ?? '')).map(describe);
  return { lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, controls: controls.length, unnamed, lowContrast, tabIssues };
}

/** Tab through the page and report focused elements that show no visible focus indicator. */
/**
 * Clicks a timeline clip of the top lane. The marker card now floats under the ruler at the marker while the playhead rests on
 * it and covers the start of the top lane (reported as a product fault in the proof-migration report): the playhead is first
 * moved off the marker with a click on the ruler above the clip's end, as a user would, so the card goes away.
 */
async function clickClipEnd(page: Page, clipId: string) {
  const el = page.locator(`.clip[data-clip-id="${clipId}"]`);
  const b = (await el.boundingBox())!;
  if (await page.getByTestId('marker-bar').count()) {
    const r = (await page.getByTestId('ruler').boundingBox())!;
    await page.mouse.click(b.x + b.width - 8, r.y + r.height / 2);
    await page.getByTestId('marker-bar').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await el.click({ position: { x: Math.max(2, b.width - 8), y: b.height / 2 } });
}
async function focusAudit(page: Page, steps: number, clickFirst = true) {
  const missing: string[] = [];
  const reached = new Set<string>();
  // Start from the page corner — except inside a modal dialog, where a click outside it could close it.
  if (clickFirst) await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== 'none';
      return { id: `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`, ok: outline || ring };
    });
    if (!r) continue;
    reached.add(r.id);
    if (!r.ok && !missing.includes(r.id)) missing.push(r.id);
  }
  return { reached: reached.size, missing };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4'), frames: 120 });
  // the phone drop's dialog is audited with a live code: the door may bind loopback for this audit only (startServer's override)
  const s = await startServer({ port: 8803, dataDir: path.join(art, 'data'), dropPort: 8804, dropAdmitAddresses: ['127.0.0.1'] });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const post = async (p: string, body: unknown) => (await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
  const browser = await chromium.launch();
  const report: any = { ranAt: new Date().toISOString(), machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, browser: browser.version() }, scope: 'Automated heuristic audit of the editor with all Inspector panels shown and one clip selected. Not a WCAG conformance claim; no screen-reader or user testing.', runs: [] };
  try {
    const pid = (await post('/projects', { name: 'a11y', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const tx = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }, { op: 'add_caption_track', args: { mode: 'manual' } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }, { op: 'add_marker', args: { time: f(0), label: 'סמן פתיחה' } }] });
    const clipId = tx.results[0].output.clipId;
    const titleClipId = tx.results[1].output.clipId as string;
    // ADR-0017: a stereo sound (two different channels, so the classic vocal remover accepts it) on its own clip, with a typed Hebrew
    // transcript and an English translation fixture (stored by the op the translation tool commits; no model runs here).
    const mix = path.join(art, 'mix.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc=exprs='0.3*sin(2*PI*440*t)+0.3*sin(2*PI*660*t)|0.3*sin(2*PI*440*t)':s=48000:d=2", '-c:a', 'pcm_s16le', mix]);
    const upMix: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'mix.wav' }, body: fs.readFileSync(mix) })).json();
    const mixClip = (await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: upMix.assetId, start: f(0) } }] })).results[0].output.clipId as string;
    s.store.commit({ projectId: pid, actor: 'fixture', ops: [{ op: 'set_transcript', args: { assetId: upMix.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }] } }] });
    const seg = s.store.getProject(pid).doc.transcripts[upMix.assetId]!.segments[0]!.id;
    s.store.commit({ projectId: pid, actor: 'fixture', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'typed fixture (no model ran)', model: 'none', createdAt: new Date().toISOString(), createdBy: 'fixture', sources: { [seg]: sha256Hex('שלום לכולם') } }, phraseText: { [seg]: 'Hello everyone' }, cueText: {} } }] });
    // templates and adjustment layers (ADR-0016): a project of four still pictures with an adjustment layer over the edit
    const tplPid = (await post('/projects', { name: 'a11y-templates', width: 640, height: 360 })).project.id as string;
    // an empty project: the start hub covers the stage, the inspector and the timeline (UX_REDESIGN §4.14)
    const emptyPid = (await post('/projects', { name: 'a11y-empty', width: 1920, height: 1080 })).project.id as string;
    // keyframe curves (ADR-0019): a title with x keyed at 0, 15, 30 and y at 0, 30 (a strip, a path with vertices and bend grips)
    const kfPid = (await post('/projects', { name: 'a11y-keyframes', width: 640, height: 360 })).project.id as string;
    const kfClip = (await post(`/projects/${kfPid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'מסלול', start: f(0), duration: f(60) } }] })).results[0].output.clipId as string;
    await post(`/projects/${kfPid}/transactions`, { ops: [[0, -0.3], [15, 0.1], [30, 0.3]].map(([k, v]) => ({ op: 'set_keyframe', args: { clipId: kfClip, property: 'x', time: f(k!), value: v, easing: 'linear' } })).concat([[0, -0.2], [30, 0.2]].map(([k, v]) => ({ op: 'set_keyframe', args: { clipId: kfClip, property: 'y', time: f(k!), value: v, easing: 'linear' } }))) });
    for (const [i, c] of ['0x4a6f8c', '0x8c5a4a', '0x5a8c6a', '0x7a5a8c'].entries()) {
      const file = path.join(art, `still-${i}.png`);
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=640x360,drawbox=x=${60 + i * 100}:y=90:w=120:h=180:color=0xc0b07a:t=fill`, '-frames:v', '1', file]);
      await fetch(`${s.url}/api/v1/projects/${tplPid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) });
    }
    const tplAssets = Object.keys(((await (await fetch(`${s.url}/api/v1/projects/${tplPid}`, { headers: h })).json()) as any).project.assets);
    await post(`/projects/${tplPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: tplAssets[0], start: f(0), duration: f(60) } }] });
    const adjClip = (await post(`/projects/${tplPid}/transactions`, { ops: [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } }] })).results?.[0]?.output?.clipId as string | undefined;
    // the life line (ADR-0021): pictures with capture dates (two of one Hanukkah evening, one of 2023, one without a date),
    // arranged by events; a person (added through a grant with people:'full': the agent token writes names only); and a title
    // with a live {year} field over the evening picture
    const lifePid = (await post('/projects', { name: 'a11y-life', width: 640, height: 360 })).project.id as string;
    const lifeBase = path.join(art, 'life-base.jpg');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-q:v', '3', lifeBase]);
    const lifePhoto = async (name: string, date: string | null, n: number) => {
      const bytes = Buffer.concat([withExif(fs.readFileSync(lifeBase), date === null ? { date: null } : { date, offset: '+02:00' }), Buffer.from(`\n${n}`)]);
      const r: any = await (await fetch(`${s.url}/api/v1/projects/${lifePid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': name }, body: new Uint8Array(bytes) })).json();
      if (!r.assetId) throw new Error(`life fixture ${name}: ${JSON.stringify(r).slice(0, 200)}`);
      return r.assetId as string;
    };
    const lifeEvening = await lifePhoto('evening.jpg', '2024:12:25 18:00:00', 1);
    await lifePhoto('evening-early.jpg', '2024:12:25 17:30:00', 2);
    await lifePhoto('spring.jpg', '2023:03:10 12:00:00', 3);
    const lifeUndated = await lifePhoto('nodate.jpg', null, 4);
    const lifeTx = async (ops: unknown[]) => { const r = await post(`/projects/${lifePid}/transactions`, { ops }); if (!r.results) throw new Error(`life fixture transaction: ${JSON.stringify(r).slice(0, 300)}`); return r; };
    let lifePicture = (await lifeTx([{ op: 'add_clip', args: { assetId: lifeEvening, start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    const lifeTitle = (await lifeTx([{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    await lifeTx([{ op: 'update_text', args: { clipId: lifeTitle, text: 'שלום {year}' } }, { op: 'set_text_fields', args: { clipId: lifeTitle, enabled: true } }]);
    await lifeTx([{ op: 'cluster_events', args: {} }]);
    {
      const full = s.governance.createGrant({ name: 'a11y-people', mode: 'edit', people: 'full' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
      const r = await fetch(`${s.url}/api/v1/projects/${lifePid}/transactions`, { method: 'POST', headers: { authorization: `Bearer ${full}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ ops: [{ op: 'add_person', args: { name: 'נועה', birthDate: '2023-03-10', form: 'f' } }] }) });
      if (r.status !== 200) throw new Error(`the people fixture was refused: ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
    const tplList = (((await (await fetch(`${s.url}/api/v1/templates`, { headers: h })).json()) as any).templates ?? []) as any[];
    const tplPick = tplList.find((t) => t.available && t.needs.music !== 'beats' && t.slots.every((x: any) => x.accept !== 'video')) ?? tplList.find((t) => t.available);
    for (const lang of ['he', 'en'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript((l) => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
      await page.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.waitForTimeout(300);
      // Sensitivity check: plant three known defects and require the audit to report each, then remove them.
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'pf-a11y-planted';
        host.innerHTML = '<button id="planted-unnamed"></button><p id="planted-contrast">low contrast text</p><button id="planted-nofocus">no focus ring</button>';
        document.body.prepend(host);
        // The shell is a fixed grid that covers the window (ds/shell.css): the planted controls are lifted above it, so the
        // click at the corner that starts the focus walk lands on them, as it did while the shell was in the page flow.
        host.style.position = 'relative'; host.style.zIndex = '1000';
        // Styles are set through the DOM API: the page's content security policy blocks inline style attributes in markup.
        const low = host.querySelector<HTMLElement>('#planted-contrast')!, nf = host.querySelector<HTMLElement>('#planted-nofocus')!;
        low.style.color = '#3a3f47'; low.style.background = '#30343b';
        nf.style.outline = 'none'; nf.style.boxShadow = 'none';
      });
      const planted = await page.evaluate(auditInPage);
      const plantedFocus = await focusAudit(page, 4);
      const sensitivity = { unnamed: planted.unnamed.some((x: string) => x.includes('planted-unnamed')), contrast: planted.lowContrast.some((x: { el: string }) => x.el.includes('planted-contrast')), focus: plantedFocus.missing.some((x: string) => x.startsWith('button')) };
      await page.evaluate(() => document.getElementById('pf-a11y-planted')?.remove());
      if (!sensitivity.unnamed || !sensitivity.contrast || !sensitivity.focus) throw new Error(`the audit failed to detect planted defects: ${JSON.stringify(sensitivity)}`);
      const found = await page.evaluate(auditInPage);
      const focus = await focusAudit(page, 60);
      await page.screenshot({ path: path.join(art, `editor-${lang}.png`), fullPage: false });
      // --- transient states: each is audited like the resting page, and dialogs are also checked for keyboard behaviour
      const states: any[] = [];
      const auditState = async (name: string, extra: Record<string, unknown> = {}, modal = false) => {
        const r = await page.evaluate(auditInPage);
        const fr = await focusAudit(page, 14, !modal);
        states.push({ state: name, controls: r.controls, unnamed: r.unnamed, lowContrast: r.lowContrast, tabIssues: r.tabIssues, noFocusRing: fr.missing, ...extra });
        await page.screenshot({ path: path.join(art, `state-${name}-${lang}.png`) });
      };
      /** A modal dialog: focus starts inside, Tab never leaves it, Escape closes it, and focus goes back to what opened it. */
      const dialogBehaviour = async (dialogTestId: string, opener: () => Promise<void>, openerSelector: string) => {
        await opener();
        await page.getByTestId(dialogTestId).waitFor({ timeout: 8000 });
        await page.waitForTimeout(150);
        const inside = () => page.evaluate((id) => !!document.activeElement && !!document.querySelector(`[data-testid=${id}]`)?.contains(document.activeElement), dialogTestId);
        const startsInside = await inside();
        let escaped = 0;
        for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await inside())) escaped++; }
        for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) escaped++; }
        return { startsInside, tabStepsThatLeftTheDialog: escaped, close: async () => { const stillOpen = (await page.getByTestId(dialogTestId).count()) === 1; await page.keyboard.press('Escape'); await page.getByTestId(dialogTestId).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); const where = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName.toLowerCase()}${el.dataset?.testid ? `[data-testid=${el.dataset.testid}]` : ''}` : 'none'; }); return { openUntilEscape: stillOpen, closed: (await page.getByTestId(dialogTestId).count()) === 0, focusAfterClose: where, focusReturned: await page.evaluate((sel) => !!document.activeElement && document.activeElement.matches(sel), openerSelector) }; } };
      };
      // marker bar (a marker sits on frame 0, where the playhead is)
      await page.locator('[data-testid=marker-bar]').waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('marker-bar', { shown: (await page.getByTestId('marker-bar').count()) === 1 });
      // a linked format selected: format badge, safe-area guide, "edited for this format only" notes
      // the format chooser is the stage header's FormatPrism radiogroup (UX_REDESIGN §8): one chip per linked format, '' the master
      const variantId = (await formatOptions(page))[0] ?? '';
      if (variantId) { await chooseFormat(page, variantId); await page.getByTestId('format-badge').waitFor({ timeout: 5000 }).catch(() => {}); }
      await auditState('format-view', { formatSelected: !!variantId, scopeNotes: await page.locator('[data-testid=transform-scope][data-scope=format], [data-testid=caption-scope]').count() });
      if (variantId) await chooseFormat(page, '');
      // project manager dialog
      const pd = await dialogBehaviour('projects-dialog', async () => { await page.getByTestId('projects-open').click(); }, '[data-testid=projects-open]');
      await auditState('projects-dialog', { startsInside: pd.startsInside, tabStepsThatLeftTheDialog: pd.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await pd.close());
      // project manager with the delete confirmation form open (a transient form inside the dialog)
      await page.getByTestId('projects-open').click();
      await page.getByTestId('projects-dialog').waitFor();
      await page.getByTestId('project-delete').first().click();
      await page.getByTestId('project-delete-confirm').waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('project-delete-confirmation', { formShown: (await page.getByTestId('project-delete-confirm').count()) === 1, applyDisabledUntilTyped: await page.getByTestId('project-delete-apply').isDisabled().catch(() => null) }, true);
      await page.keyboard.press('Escape');
      await page.getByTestId('projects-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      // an error shown to the user: an edit the server refuses (a clip on a locked track, changed behind the editor's back)
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any).project.sequences.seq_main.tracks.find((t: any) => t.clips.some((c: any) => c.id === clipId)).id, locked: true } }] });
      await page.locator('[data-locked=true]').first().waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('locked-track', { lockedTracksShown: await page.locator('.track[data-locked=true]').count(), pressedLockButtons: await page.locator('[data-testid=track-lock][aria-pressed=true]').count() });
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any).project.sequences.seq_main.tracks.find((t: any) => t.locked).id, locked: false } }] });
      await page.waitForFunction(() => !document.querySelector('.track[data-locked=true]'), undefined, { timeout: 8000 }).catch(() => {});
      // an upload in progress (ADR-0023: media goes through the import queue; the picker is never disabled, the upload is a card
      // «בהעלאה» with its cancel button), then the failed import card: a file that is not media is sent, the request is held
      // while the busy state is audited, then the server stores it and the import fails as unsupported
      let release: () => void = () => {};
      const held = new Promise<void>((r) => { release = r; });
      const hold = async (route: any) => { if (route.request().method() === 'POST') await held; await route.continue(); };
      await page.route('**/api/v1/projects/*/imports', hold);
      await page.getByTestId('file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a media file') });
      await page.locator('[data-testid^=import-local-]').first().waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('upload-busy', { shown: (await page.locator('[data-testid^=import-local-] [data-testid=import-cancel]').count()) === 1 && !(await page.getByTestId('file-input').isDisabled()) });
      release();
      const failedCard = page.locator('[data-testid^=import-card-][data-state=attention]').first();
      await failedCard.waitFor({ timeout: 30000 }).catch(() => {});
      await page.unroute('**/api/v1/projects/*/imports', hold);
      await auditState('import-card-failed', { shown: (await failedCard.count()) === 1 && (await failedCard.getByTestId('import-dismiss').count()) === 1 && (await page.getByTestId('imports-summary').count()) === 1 });
      if (await failedCard.count()) await failedCard.getByTestId('import-dismiss').click();
      await page.locator('[data-testid^=import-card-]').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      // the error bar: a colour table (.cube) keeps the synchronous upload, and one that is not a colour table is refused there
      await page.getByTestId('file-input').setInputFiles({ name: 'broken.cube', mimeType: 'text/plain', buffer: Buffer.from('this is not a colour table') });
      await page.locator('.error[role=alert]').waitFor({ timeout: 10000 }).catch(() => {});
      const errShown = (await page.locator('.error[role=alert]').count()) === 1;
      await auditState('error-bar', { shown: errShown, text: errShown ? ((await page.locator('.error[role=alert]').textContent()) ?? '').slice(0, 120) : '' });
      if (errShown) await page.locator('.error[role=alert] button').click();
      Object.assign(states.at(-1), { closed: (await page.locator('.error[role=alert]').count()) === 0 });
      // the export sheet (owner decision 2026-11-17: Export always opens it): a modal dialog, audited on its settings step with
      // the dialog checks, then an export in progress: the sheet shows a progressbar and a cancel button, the top bar's ring
      // chip says it runs (Export itself starts nothing, so it is not disabled any more); the export is then cancelled
      const xs = await dialogBehaviour('export-sheet', async () => { await page.getByTestId('export').click(); }, '[data-testid=export]');
      await auditState('export-sheet', { startsInside: xs.startsInside, tabStepsThatLeftTheDialog: xs.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('export-start').count()) === 1 }, true);
      await page.getByTestId('export-start').click();
      await page.getByTestId('export-cancel').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('export-busy', { shown: (await page.getByTestId('export-cancel').count()) === 1 && (await page.locator('[data-testid=export-progress] [role=progressbar]').count()) >= 1 && (await page.locator('[data-testid=export-ring][data-status=running]').count()) === 1 }, true);
      if (await page.getByTestId('export-cancel').count()) await page.getByTestId('export-cancel').click();
      await page.getByTestId('export-cancel').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      Object.assign(states.at(-1), { closed: (await page.getByTestId('export-cancel').count()) === 0, canceledShown: (await page.getByTestId('export-canceled').count()) === 1 });
      Object.assign(states.at(-2), await xs.close());
      if (await page.locator('.error[role=alert] button').count()) await page.locator('.error[role=alert] button').click(); // a cancelled export is not reported as an error; close one if it is
      // source viewer dialog
      // the media card's "view" is an item of its ⋯ menu (UX_REDESIGN §8); the menu closes as the viewer opens, so the focus goes back to the ⋯ button
      const sv = await dialogBehaviour('source-viewer', async () => { await openCardMenu(page, up.assetId); await page.getByTestId(`view-${up.assetId}`).click(); }, `[data-testid="view-${up.assetId}"], [data-testid="more-${up.assetId}"]`);
      await auditState('source-viewer', { startsInside: sv.startsInside, tabStepsThatLeftTheDialog: sv.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await sv.close());
      // full history dialog
      const ad = await dialogBehaviour('activity-dialog', async () => { await page.getByTestId('activity-open').click(); }, '[data-testid=activity-open]');
      await auditState('activity-dialog', { startsInside: ad.startsInside, tabStepsThatLeftTheDialog: ad.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await ad.close());
      // the phone drop dialog (ADR-0023) with a live code: QR, typed address and PIN, status; Esc hides it and leaves the chip
      if (!/\bis-on\b/.test((await page.getByTestId('rail-media').getAttribute('class')) ?? '')) { await page.getByTestId('rail-media').click(); await page.waitForTimeout(300); }
      const pdd = await dialogBehaviour('phone-drop-dialog', async () => { await page.getByTestId('import-more').click(); await page.getByTestId('phone-drop-open').click(); await page.getByTestId('phone-drop-dialog').waitFor({ timeout: 8000 }); await page.getByTestId('phone-drop-address').waitFor({ timeout: 8000 }).catch(() => {}); if (await page.getByTestId('phone-drop-start').count()) await page.getByTestId('phone-drop-start').click(); await page.getByTestId('phone-drop-qr').waitFor({ timeout: 8000 }).catch(() => {}); }, '[data-testid=import-more]');
      await auditState('phone-drop-dialog', { startsInside: pdd.startsInside, tabStepsThatLeftTheDialog: pdd.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('phone-drop-qr').count()) === 1 && (await page.getByTestId('phone-drop-pin').count()) === 1 }, true);
      Object.assign(states.at(-1), await pdd.close());
      await page.getByTestId('phone-drop-chip').waitFor({ timeout: 5000 }).catch(() => {});
      await auditState('phone-drop-chip', { shown: (await page.getByTestId('phone-drop-chip').count()) === 1 && (await page.getByTestId('phone-drop-chip-close').count()) === 1 });
      if (await page.getByTestId('phone-drop-chip-close').count()) await page.getByTestId('phone-drop-chip-close').click();
      await page.getByTestId('phone-drop-chip').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      // command palette
      const cp = await dialogBehaviour('palette-dialog', async () => { await page.getByTestId('projects-open').focus(); await page.keyboard.press('Control+k'); }, '[data-testid=projects-open]');
      await auditState('command-palette', { startsInside: cp.startsInside, tabStepsThatLeftTheDialog: cp.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await cp.close());
      // the redesign's menus (UX_REDESIGN §4.2, §4.4): the agent avatar's menu and a media card's ⋯ menu. Focus starts on the
      // first item, Escape closes the menu and gives the focus back to its button. Audited before the focus walk (Tab closes a menu).
      const menuBehaviour = async (name: string, button: string) => {
        await page.locator(button).click();
        await page.locator('[role=menu]').first().waitFor({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(150);
        const startsInside = await page.evaluate(() => !!document.activeElement?.closest('[role=menu]'));
        const items = await page.locator('[role=menu] [role^=menuitem]').count();
        await auditState(name, { startsInside, shown: items > 0 }, true);
        if (await page.locator('[role=menu]').count()) { await page.locator(button).focus().catch(() => {}); await page.locator(button).click(); }
        await page.locator(button).click(); await page.locator('[role=menu]').first().waitFor({ timeout: 5000 }).catch(() => {});
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        Object.assign(states.at(-1), { closed: (await page.locator('[role=menu]').count()) === 0, focusReturned: await page.evaluate((sel) => !!document.activeElement?.matches(sel), button) });
      };
      await menuBehaviour('agent-menu', '[data-testid=agent-menu]');
      await menuBehaviour('media-card-menu', `[data-testid="more-${up.assetId}"]`);
      // the settings dialog (the rail's settings button)
      const sd = await dialogBehaviour('settings-dialog', async () => { await page.getByTestId('rail-settings').click(); }, '[data-testid=rail-settings]');
      await auditState('settings-dialog', { startsInside: sd.startsInside, tabStepsThatLeftTheDialog: sd.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await sd.close());
      // the effect gallery (ADR-0011: its time and overlay tiles animate on hover, through a FlashGuard); opened from the look panel of the selected clip
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('gallery-open').waitFor({ timeout: 8000 });
      const gd = await dialogBehaviour('effect-gallery', async () => { await page.getByTestId('gallery-open').click(); }, '[data-testid=gallery-open]');
      await auditState('effect-gallery', { startsInside: gd.startsInside, tabStepsThatLeftTheDialog: gd.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await gd.close());
      // the look panel with the visual wave's controls (ADR-0011): a blur whose radius follows the beat (its fieldset open), a
      // date stamp (its text field and hint) and an echo (first, with the separator that names the rule); no music here, so the
      // ♪ toggles are off with their note. The focus walk starts in the fieldset. The effects are removed again afterwards.
      const added = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 0.01 } } }, { op: 'add_effect', args: { clipId, type: 'stylize.date-stamp' } }, { op: 'add_effect', args: { clipId, type: 'time.echo' } }] });
      const waveFx: string[] = (added.results ?? []).map((r: any) => r.output.effectId as string);
      if (waveFx.length !== 3) throw new Error(`adding the visual-wave effects failed: ${JSON.stringify(added).slice(0, 300)}`);
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_effect_modulator', args: { clipId, effectId: waveFx[0], param: 'radius', modulator: { depth: 0.02 } } }] });
      await page.getByTestId('beat-fieldset').waitFor({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('beat-fieldset').scrollIntoViewIfNeeded().catch(() => {});
      await page.getByTestId('beat-every').focus().catch(() => {});
      const lookShown = { fieldset: await page.getByTestId('beat-fieldset').count(), separator: await page.getByTestId('time-separator').count(), stampField: await page.getByTestId('effect-stamp').count(), beatToggles: await page.getByTestId('beat-toggle').count() };
      await auditState('look-visual-wave', { shown: lookShown.fieldset === 1 && lookShown.separator === 1 && lookShown.stampField === 1 && lookShown.beatToggles >= 1, ...lookShown }, true);
      await post(`/projects/${pid}/transactions`, { ops: waveFx.map((effectId) => ({ op: 'remove_effect', args: { clipId, effectId } })) });
      await page.getByTestId('beat-fieldset').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      // ---- AI-model wave (ADR-0017) ----
      // the AI tools panel, sound tab, with the classic vocal remover's run sheet open on the selected stereo clip
      await page.locator(`.clip[data-clip-id="${mixClip}"]`).click();
      await page.getByTestId('rail-ai').click(); // the AI tools are the rail's AI category (UX_REDESIGN §4.11)
      const soundTab = page.locator('[data-testid=ai-tab][data-tab=sound]');
      if (await soundTab.count()) await soundTab.click();
      const vocals = page.locator('[data-testid=ai-tool][data-id="local.audio.vocals-classic"]');
      const vocalsShown = (await vocals.count()) === 1;
      if (vocalsShown) { await vocals.getByTestId('ai-open-run').click(); await vocals.getByTestId('ai-run-sheet').waitFor({ timeout: 8000 }).catch(() => {}); await vocals.getByTestId('ai-open-run').focus(); }
      await auditState('ai-tools-run-sheet', { shown: vocalsShown && (await vocals.getByTestId('ai-run-sheet').count()) === 1, tabs: await page.locator('[data-testid=ai-tab]').count() }, true);
      // a run in place of the clip's file, then the before/after compare slider (focused; the focus walk starts there)
      let compareShown = false;
      if (vocalsShown) {
        await vocals.getByTestId('ai-apply-replace-clip').check().catch(() => {});
        await vocals.getByTestId('ai-run').click().catch(() => {});
        await vocals.getByTestId('ai-compare-slider').waitFor({ timeout: 60000 }).catch(() => {});
        compareShown = (await vocals.getByTestId('ai-compare-slider').count()) === 1;
        if (compareShown) await vocals.getByTestId('ai-compare-slider').focus();
      }
      await auditState('ai-result-compare', { shown: compareShown, progressbar: await vocals.locator('[role=progressbar]').count() }, true);
      if (compareShown) { await vocals.getByTestId('ai-undo').click().catch(() => {}); await page.waitForTimeout(500); }
      // the translation review in the transcript panel (all Inspector panels are shown; the rail back on media gives the inspector back its panels)
      await page.getByTestId('rail-media').click();
      const review = page.getByTestId('translation-review');
      await review.waitFor({ timeout: 8000 }).catch(() => {});
      const reviewShown = (await review.count()) === 1;
      if (reviewShown) { await review.scrollIntoViewIfNeeded().catch(() => {}); await review.getByTestId('translation-limit').focus().catch(() => {}); }
      await auditState('translation-review', { shown: reviewShown && (await review.getByTestId('translation-row').count()) === 1 }, true);

      // motion tracking (ADR-0015): a track of the clip's file, a privacy region that follows it and the title following it.
      // States: the video clip (tracking panel, follow controls, privacy regions with the standing warning), the title (its
      // follow controls), and the track picker on the monitor (focus on the picture; Escape closes it and gives the focus back).
      const mt = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'create_motion_track', args: { assetId: up.assetId, name: 'נקודה', kind: 'point', frame: 0, x: 5000, y: 6000 } }] });
      const mtk = mt.results?.[0]?.output?.motionTrackId as string | undefined;
      if (!mtk) throw new Error(`creating a motion track failed: ${JSON.stringify(mt).slice(0, 300)}`);
      const projectNow: any = (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json()).project;
      const videoTrackId = projectNow.sequences.seq_main.tracks.find((t: any) => t.clips.some((c: any) => c.id === clipId)).id as string;
      const titleId = tx.results[1].output.clipId as string;
      const bound = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_redact_region', args: { clipId, region: { motionTrackId: mtk } } }, { op: 'set_clip_follow', args: { clipId: titleId, follow: { motionTrackId: mtk, targetTrackId: videoTrackId, scale: false, smooth: 0 }, offset: { x: 0, y: 0 } } }] });
      if (!bound.results) throw new Error(`binding the motion track failed: ${JSON.stringify(bound).slice(0, 300)}`);
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('redact-warning').waitFor({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('tracking-panel').scrollIntoViewIfNeeded().catch(() => {});
      const trackingShown = { panel: await page.getByTestId('tracking-panel').count(), items: await page.getByTestId('mtrack-item').count(), follow: await page.getByTestId('follow-controls').count(), redact: await page.getByTestId('redact-controls').count(), warning: await page.getByTestId('redact-warning').count(), warningRole: await page.getByTestId('redact-warning').getAttribute('role').catch(() => null) };
      await auditState('tracking-video-clip', { shown: trackingShown.panel === 1 && trackingShown.items === 1 && trackingShown.follow === 1 && trackingShown.redact === 1 && trackingShown.warning === 1 && trackingShown.warningRole === 'status', ...trackingShown });
      await clickClipEnd(page, titleId);
      await page.getByTestId('follow-detach').waitFor({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('follow-controls').scrollIntoViewIfNeeded().catch(() => {});
      const followShown = { detach: await page.getByTestId('follow-detach').count(), scale: await page.getByTestId('follow-scale').count(), smooth: await page.getByTestId('follow-smooth').count(), state: await page.getByTestId('follow-state').count() };
      await auditState('tracking-follower', { shown: followShown.detach === 1 && followShown.scale === 1 && followShown.smooth === 1 && followShown.state === 1, ...followShown });
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.getByTestId('mtrack-new-point').click();
      await page.getByTestId('track-picker').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(150);
      const pickerFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'track-picker');
      await auditState('track-picker', { shown: (await page.getByTestId('track-picker').count()) === 1 && (await page.getByTestId('track-picker-confirm').count()) === 1, pickerFocused }, true);
      await page.getByTestId('track-picker').focus().catch(() => {});
      await page.keyboard.press('Escape');
      await page.getByTestId('track-picker').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);
      Object.assign(states.at(-1), { closed: (await page.getByTestId('track-picker').count()) === 0, focusReturned: await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'mtrack-new-point'), startsInside: pickerFocused });
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'remove_motion_track', args: { motionTrackId: mtk, unbind: true } }] });
      await page.getByTestId('mtrack-item').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});

      // the title effects panel (ADR-0012): the title selected and all six look fields on, so every control shows; the focus walk starts in the panel
      const textClipId = tx.results[1].output.clipId as string;
      const looks = { gradient: { colors: ['#FFD166', '#3A5BFF', '#8A2BE2'], angle: 90 }, tracking: 0.1, stroke2: { color: '#111111', widthFrac: 0.06 }, glow: { color: '#FF2BD6', radiusFrac: 0.5, intensity: 0.8 }, extrude: { color: '#1D3557', depthFrac: 0.15, angle: 45, shade: 0.5 }, longShadow: { color: '#0000004D', lengthFrac: 1.5, angle: 45 } };
      const fxOn = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: textClipId, style: looks } }] });
      if (!fxOn.results) throw new Error(`turning the title looks on failed: ${JSON.stringify(fxOn).slice(0, 300)}`);
      await clickClipEnd(page, textClipId);
      await page.getByTestId('text-effects').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=text-effects] input[type=checkbox]:checked').length >= 7, undefined, { timeout: 8000 }).catch(() => {});
      await page.getByTestId('text-effects').scrollIntoViewIfNeeded().catch(() => {});
      await page.getByTestId('text-fx-gradient').focus().catch(() => {});
      const fxShown = { panel: await page.getByTestId('text-effects').count(), checked: await page.locator('[data-testid=text-effects] input[type=checkbox]:checked').count(), status: await page.getByTestId('text-fx-status').count(), removeAll: await page.getByTestId('text-fx-remove-all').count(), colourFields: await page.locator('[data-testid=text-effects] input[type=color]').count() };
      await auditState('text-effects', { shown: fxShown.panel === 1 && fxShown.checked >= 6 && fxShown.status === 1 && fxShown.removeAll === 1 && fxShown.colourFields >= 7, ...fxShown }, true);
      await post(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: textClipId, style: Object.fromEntries(Object.keys(looks).map((k) => [k, null])) } }] });
      // the transition options (ADR-0012) of a light transition between two short clips of the fixture (film-burn declares colour,
      // seed and light, so every control of the panel shows); the clips are removed again afterwards
      const pair = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(200), duration: f(40), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: up.assetId, start: f(240), duration: f(40), withLinkedAudio: false } }] });
      const [pairA, pairB] = (pair.results ?? []).map((r: any) => r.output.clipId as string);
      const trSet = pairB ? await post(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transition', args: { clipId: pairB, type: 'film-burn', frames: 10 } }] }) : null;
      if (pairB && trSet?.results) {
        await page.locator(`.clip[data-clip-id="${pairB}"]`).click();
        await page.getByTestId('transition-options').waitFor({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('transition-options').scrollIntoViewIfNeeded().catch(() => {});
        await page.getByTestId('transition-sync').focus().catch(() => {});
      }
      const trShown = { options: await page.getByTestId('transition-options').count(), sync: await page.getByTestId('transition-sync').count(), velocity: await page.getByTestId('transition-velocity').count(), colour: await page.getByTestId('transition-color').count(), seed: await page.getByTestId('transition-seed').count(), lightStatus: await page.getByTestId('transition-light-status').count(), transitionSet: !!trSet?.results };
      await auditState('transition-options', { shown: trShown.transitionSet && trShown.options === 1 && trShown.sync === 1 && trShown.velocity === 1 && trShown.colour >= 1 && trShown.seed >= 1 && trShown.lightStatus === 1, ...trShown }, true);
      if (pairA || pairB) await post(`/projects/${pid}/transactions`, { ops: [pairA, pairB].filter(Boolean).map((id) => ({ op: 'delete_clip', args: { clipId: id } })) });

      // ---- templates and adjustment layers (ADR-0016), in their own project ----
      await page.goto(`${s.ownerUrl}&project=${tplPid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      // an adjustment clip's inspector: opacity only, its note, mask and blend, "apply to" absent (it is the adjustment)
      if (adjClip) await page.locator(`.clip[data-clip-id="${adjClip}"]`).click();
      await page.getByTestId('adjust-opacity').waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('adjustment-inspector', { shown: (await page.getByTestId('adjust-opacity').count()) === 1 && (await page.getByTestId('adjust-note').count()) === 1 });
      // the Look panel of a picture clip with "apply to: the whole edit" chosen
      await page.locator('.track.video .clip').first().click();
      await page.getByTestId('apply-to-edit').check().catch(() => {});
      await auditState('apply-to-whole-edit', { shown: (await page.getByTestId('apply-to-edit').isChecked().catch(() => false)) === true });
      // the Templates drawer (the rail's Templates category): its first card sits at the inline start (the right edge in Hebrew)
      await page.getByTestId('rail-templates').click();
      if ((await page.getByTestId('templates-toggle').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('templates-toggle').click();
      await page.locator('[data-testid=template-card]').first().waitFor({ timeout: 10000 }).catch(() => {});
      const cards = await page.locator('[data-testid=template-card]').count();
      const edge = await page.evaluate((rtl) => {
        const list = document.querySelector('[data-testid=templates-drawer] .pf-tpl-cards'), first = document.querySelector('[data-testid=template-card]');
        if (!list || !first) return null;
        const a = list.getBoundingClientRect(), b = first.getBoundingClientRect();
        return { gapAtInlineStart: Number((rtl ? a.right - b.right : b.left - a.left).toFixed(2)), cardWidth: Math.round(b.width), listWidth: Math.round(a.width) };
      }, lang === 'he');
      await auditState('templates-drawer', { shown: cards > 0, cards, firstCardAtInlineStart: !!edge && Math.abs(edge.gapAtInlineStart) <= 1, edge });
      // the template dialog: its first step, then the plan step (a polite live region); Escape gives the focus back to the card
      const tplCard = `[data-testid=template-card][data-template-id="${tplPick?.id ?? ''}"]`;
      const td = await dialogBehaviour('template-dialog', async () => { await page.locator(tplCard).click(); }, tplCard);
      await auditState('template-dialog', { startsInside: td.startsInside, tabStepsThatLeftTheDialog: td.tabStepsThatLeftTheDialog }, true);
      const dialogState = states.at(-1);
      await page.locator('[data-testid=template-step][data-step=plan]').click();
      await page.waitForFunction(() => !!document.querySelector('[data-testid=template-plan-summary]') || !!document.querySelector('[data-testid=template-error]'), undefined, { timeout: 30000 }).catch(() => {});
      await auditState('template-dialog-plan', { shown: (await page.getByTestId('template-plan-summary').count()) === 1, live: await page.getByTestId('template-plan').getAttribute('aria-live').catch(() => null) }, true);
      Object.assign(dialogState, await td.close());
      // the post-apply bar: the template is applied from the dialog, audited, and undone
      await page.locator(tplCard).click();
      await page.getByTestId('template-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      await page.locator('[data-testid=template-step][data-step=plan]').click().catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid=template-plan-summary]') || !!document.querySelector('[data-testid=template-error]'), undefined, { timeout: 30000 }).catch(() => {});
      await page.getByTestId('template-use').click({ timeout: 5000 }).catch(() => {});
      await page.getByTestId('template-applied').waitFor({ timeout: 30000 }).catch(() => {});
      if (await page.getByTestId('template-dialog').count()) await page.keyboard.press('Escape');
      await auditState('template-applied', { shown: (await page.getByTestId('template-applied').count()) === 1, template: tplPick?.id ?? null });
      if (await page.getByTestId('template-undo').count()) { await page.getByTestId('template-undo').click(); await page.getByTestId('template-applied').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500); }
      // the life line and the pack mounts, in the life project (the picture under the title is restored for the second language)
      await page.goto(`${s.ownerUrl}&project=${lifePid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      /** Opens a rail category (a click on the category already open would close its drawer). */
      const railOn = async (c: string) => { if (!/\bis-on\b/.test((await page.getByTestId(`rail-${c}`).getAttribute('class')) ?? '')) await page.getByTestId(`rail-${c}`).click(); await page.waitForTimeout(300); };
      await railOn('media');
      await page.getByTestId('life-view-date').click();
      await page.getByTestId('life-year-2024').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('life-library-dates', { shown: (await page.getByTestId('life-year-2024').count()) === 1 && (await page.getByTestId('life-year-2023').count()) === 1 && (await page.getByTestId('life-undated').count()) === 1 && (await page.getByTestId(`life-date-${lifeEvening}`).count()) === 1 });
      await page.getByTestId('life-view-events').click();
      await page.locator('[data-testid^="life-event-"][data-event-id]').first().waitFor({ timeout: 10000 }).catch(() => {});
      const lifeEvents = { events: await page.locator('[data-testid^="life-event-"][data-event-id]').count(), sunsetRadios: await page.locator('[data-testid^="life-sunset-"] input[type=radio]').count() };
      await auditState('life-library-events', { shown: lifeEvents.events >= 2 && lifeEvents.sunsetRadios === 2, ...lifeEvents });
      // the family film (ADR-0026) from the event card: the dialog's three steps (a modal: focus inside, Escape, focus back to the
      // card's «סרט מהאירוע»), then the film made, its bar with the «why» list, and the inspector's reasons of a film clip; undone after
      {
        const opener = '[data-testid=film-open][data-variant=event-card]';
        await page.locator(opener).first().waitFor({ timeout: 8000 }).catch(() => {});
        const hasOpener = (await page.locator(opener).count()) >= 1;
        await auditState('film-entry-event-card', { shown: hasOpener });
        if (hasOpener) {
          const fd = await dialogBehaviour('film-dialog', async () => { await page.locator(opener).first().click(); }, opener);
          await auditState('film-dialog-what', { startsInside: fd.startsInside, tabStepsThatLeftTheDialog: fd.tabStepsThatLeftTheDialog, shown: (await page.getByTestId('film-step-what').count()) === 1 }, true);
          await page.getByTestId('film-next').click();
          await page.getByTestId('film-step-length').waitFor({ timeout: 8000 }).catch(() => {});
          await auditState('film-dialog-length', { shown: (await page.getByTestId('film-step-length').count()) === 1 }, true);
          await page.getByTestId('film-next').click();
          await page.locator('[data-testid=film-plan-row]').first().waitFor({ timeout: 60000 }).catch(() => {});
          await auditState('film-dialog-plan', { shown: (await page.locator('[data-testid=film-plan-row]').count()) >= 1 && (await page.locator('[data-testid=film-reason]').count()) >= 1 }, true);
          Object.assign(states.at(-1), await fd.close());
          // make the film (the same three steps, then «יצירת הסרט»)
          await page.locator(opener).first().click();
          await page.getByTestId('film-dialog').waitFor({ timeout: 8000 }).catch(() => {});
          await page.getByTestId('film-next').click(); await page.getByTestId('film-next').click();
          await page.locator('[data-testid=film-plan-row]').first().waitFor({ timeout: 60000 }).catch(() => {});
          await page.getByTestId('film-apply').click();
          await page.getByTestId('film-bar').waitFor({ timeout: 30000 }).catch(() => {});
          await auditState('film-bar', { shown: (await page.getByTestId('film-bar').count()) === 1 });
          await page.getByTestId('film-bar-why').click().catch(() => {});
          await page.getByTestId('film-bar-why-list').waitFor({ timeout: 5000 }).catch(() => {});
          await auditState('film-bar-why', { shown: (await page.getByTestId('film-bar-why-list').count()) === 1 });
          const lifeDoc: any = (await (await fetch(`${s.url}/api/v1/projects/${lifePid}`, { headers: h })).json()).project;
          const filmRun: any = Object.values(lifeDoc.recipeRuns ?? {}).find((r: any) => r.recipeId === 'template:tpl.family-film');
          const filmClip = filmRun?.slots?.find((x: any) => x.kind === 'picture')?.clipId as string | undefined;
          if (filmClip) {
            await page.locator(`.clip[data-clip-id="${filmClip}"]`).click().catch(() => {});
            await page.getByTestId('film-why').waitFor({ timeout: 8000 }).catch(() => {});
          }
          await auditState('film-why', { shown: (await page.getByTestId('film-why').count()) === 1 && (await page.getByTestId('film-why-reason').count()) === 1 });
          if (await page.getByTestId('film-bar-undo').count()) { await page.getByTestId('film-bar-undo').click(); await page.getByTestId('film-bar').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {}); }
          await railOn('media');
        }
      }
      await page.getByTestId('life-view-all').click();
      // the title with a live field: its field menu (a menu), then the people sheet opened from it (a modal dialog)
      await page.locator(`.clip[data-clip-id="${lifeTitle}"]`).click();
      await page.getByTestId('field-add').waitFor({ timeout: 8000 }).catch(() => {});
      await menuBehaviour('field-menu', '[data-testid=field-add]');
      const ps = await dialogBehaviour('life-people', async () => { await page.getByTestId('field-add').click(); await page.getByTestId('field-item-add-person').click(); }, '[data-testid=field-add]');
      await auditState('people-sheet', { startsInside: ps.startsInside, tabStepsThatLeftTheDialog: ps.tabStepsThatLeftTheDialog, shown: (await page.locator('[data-testid^="life-person-"][data-person-id]').count()) >= 1 && (await page.getByTestId('life-people-privacy').count()) === 1 }, true);
      Object.assign(states.at(-1), await ps.close());
      // the live line with an anchored error and its fix: the picture under the title is replaced by the one without a date
      const lifeUnder = (await lifeTx([{ op: 'delete_clip', args: { clipId: lifePicture } }, { op: 'add_clip', args: { assetId: lifeUndated, start: f(0), duration: f(60) } }])).results[1].output.clipId as string;
      await page.locator('[data-testid=field-live] .pf-anchored').first().waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('field-live-error', { shown: (await page.locator('[data-testid=field-live] .pf-anchored').count()) >= 1 && (await page.locator('[data-testid=field-live] .pf-anchored button').count()) >= 1 });
      lifePicture = (await lifeTx([{ op: 'delete_clip', args: { clipId: lifeUnder } }, { op: 'add_clip', args: { assetId: lifeEvening, start: f(0), duration: f(60) } }])).results[1].output.clipId as string;
      // the content packs: the Hanukkah pack page (from the shelf of the Templates drawer), the built-in music tab, the text drawer's fonts
      await railOn('templates');
      await page.locator('[data-pack-id="pack.hanukkah"] [data-testid=pack-card]').first().click({ timeout: 10000 }).catch(() => {});
      await page.getByTestId('pack-page').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('pack-page', { shown: (await page.getByTestId('pack-page').getAttribute('data-pack-id').catch(() => null)) === 'pack.hanukkah' && (await page.locator('[data-testid^="pack-tab-"]').count()) >= 2 });
      if (await page.getByTestId('pack-back').count()) await page.getByTestId('pack-back').click();
      await railOn('audio');
      await page.getByTestId('music-tab').click({ timeout: 8000 }).catch(() => {});
      await page.locator('[data-testid=music-row]').first().waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('music-browser', { shown: (await page.locator('[data-testid=music-row]').count()) >= 1 });
      await railOn('text');
      await page.locator('[data-testid=font-option]').first().waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('text-drawer-fonts', { shown: (await page.locator('[data-testid=font-option]').count()) >= 1 });
      // the fast export and the render cache (ADR-0024): the sheet line in its states and the timeline lane with its popover, on
      // the project the scenarios export and edit (the life-line states above left the page on another project)
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await page.waitForFunction(() => (document.querySelector('[data-testid=file-input]') as HTMLInputElement | null)?.disabled === false, undefined, { timeout: 30000 }).catch(() => {});
      await railOn('media');
      const rcCtx = makeRenderCacheCtx({ page, lang, api: makeApi(s.url, s.auth.tokens.agent), owner: await ownerApi(s.url, s.auth.tokens.owner), pid, titleClipId });
      for (const sc of renderCacheA11yScenarios) {
        const r = await sc.prepare(rcCtx);
        await auditState(sc.id, { shown: r.shown, ...(r.detail ?? {}) }, sc.id.startsWith('cache-sheet'));
        await sc.leave?.(rcCtx);
      }
      if (await page.getByTestId('cache-fast-switch').count() === 0) { await page.getByTestId('export').click(); await page.getByTestId('cache-fast-switch').waitFor({ timeout: 8000 }).catch(() => {}); }
      if ((await page.getByTestId('cache-fast-switch').getAttribute('aria-checked').catch(() => null)) === 'true') await page.getByTestId('cache-fast-switch').click();
      if (await page.getByTestId('export-sheet').count()) { await page.keyboard.press('Escape'); await page.getByTestId('export-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); }
      // the render cache's row in the status centre: its size and «ניקוי מטמון הרינדור» (the owner's own session)
      await page.getByTestId('status-pips').click();
      await page.getByTestId('cache-storage-row').waitFor({ timeout: 8000 }).catch(() => {});
      await auditState('cache-storage-row', { shown: (await page.getByTestId('cache-storage-row').count()) === 1 && (await page.getByTestId('cache-clear').count()) === 1 }, true);
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      // shorts (ADR-0018): the Shorts panel (its four steps) and the sequence switcher with a short present, with the delete
      // confirmation. The short is added through the public add_sequence operation and removed again, so every language starts alike.
      {
        const shApi = makeApi(s.url, s.auth.tokens.agent);
        await page.goto(`${s.ownerUrl}&project=${pid}`);
        await page.getByTestId('timecode').waitFor();
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.getByTestId('workspace-shorts').click({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('shorts-panel').waitFor({ timeout: 8000 }).catch(() => {});
        await auditState('shorts-panel', { shown: (await page.getByTestId('shorts-panel').count()) === 1 && (await page.locator('[data-testid=shorts-step]').count()) === 4 });
        const made = await shApi.tx(pid, [{ op: 'add_sequence', args: { name: lang === 'he' ? 'קטע בדיקה' : 'Test short', format: { width: 720, height: 1280, fit: 'cover', profileId: 'vertical-9x16', safeArea: null } } }]).catch(() => null);
        const shortId = made?.results?.[0]?.output?.sequenceId as string | undefined;
        if (shortId) {
          await page.getByTestId('sequence-switcher').waitFor({ timeout: 8000 }).catch(() => {});
          await auditState('shorts-switcher', { shown: (await page.getByTestId('sequence-switcher').count()) === 1 && (await page.locator('[data-testid=sequence-switcher] [role=tab]').count()) === 2 });
          await page.locator(`[data-testid=sequence-tab][data-sequence-id="${shortId}"]`).click();
          await page.getByTestId('sequence-tab-delete').waitFor({ timeout: 5000 }).catch(() => {});
          const sd = await dialogBehaviour('sequence-delete-dialog', async () => { await page.getByTestId('sequence-tab-delete').click(); }, '[data-testid=sequence-tab-delete]');
          await auditState('shorts-delete-dialog', { startsInside: sd.startsInside, tabStepsThatLeftTheDialog: sd.tabStepsThatLeftTheDialog }, true);
          Object.assign(states.at(-1), await sd.close());
          await shApi.tx(pid, [{ op: 'remove_sequence', args: { sequenceId: shortId, withContents: true } }]).catch(() => null);
        }
        await page.getByTestId('workspace-pro').click().catch(() => {});
      }
      // keyframe curves and motion paths (ADR-0019): the strip and the path of a selected title, then the curve picker opened with
      // Enter on a strip key (focus inside, Tab kept inside, Escape closes and gives focus back to the key)
      {
        await page.goto(`${s.ownerUrl}&project=${kfPid}`);
        await page.getByTestId('timecode').waitFor();
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
        await page.locator(`.clip[data-clip-id="${kfClip}"]`).click({ position: { x: 4, y: 4 } });
        await page.getByTestId(KF_TESTIDS.strip).waitFor({ timeout: 8000 }).catch(() => {});
        await page.getByTestId(KF_TESTIDS.path).waitFor({ timeout: 8000 }).catch(() => {});
        await auditState('keyframe-strip-and-path', { shown: (await page.getByTestId(KF_TESTIDS.strip).count()) === 1 && (await page.getByTestId(KF_TESTIDS.key).count()) === 3 && (await page.getByTestId(KF_TESTIDS.path).count()) === 1 && (await page.getByTestId(KF_TESTIDS.pathPoint).count()) === 3 && (await page.getByTestId(KF_TESTIDS.bend).count()) >= 1 });
        const keyAt15 = `[data-testid=${KF_TESTIDS.key}][data-frame="15"]`;
        const cp = await dialogBehaviour(KF_TESTIDS.picker, async () => { await page.locator(keyAt15).focus(); await page.keyboard.press('Enter'); }, keyAt15);
        await auditState('curve-picker', { startsInside: cp.startsInside, tabStepsThatLeftTheDialog: cp.tabStepsThatLeftTheDialog, shown: (await page.locator(`[data-testid^="curve-tile-"]`).count()) >= 12 }, true);
        Object.assign(states.at(-1), await cp.close());
      }
      // the start hub of an empty project
      await page.goto(`${s.ownerUrl}&project=${emptyPid}`);
      await page.getByTestId('welcome').waitFor({ timeout: 10000 }).catch(() => {});
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await auditState('start-hub', { shown: (await page.getByTestId('welcome').count()) === 1 && (await page.getByTestId('welcome-import').count()) === 1 });
      for (const st of states) console.log(`[${lang}] state ${st.state}: controls=${st.controls} unnamed=${st.unnamed.length} lowContrast=${st.lowContrast.length} tabIssues=${st.tabIssues.length} noFocusRing=${st.noFocusRing.length}${st.startsInside !== undefined ? ` startsInside=${st.startsInside} leftDialog=${st.tabStepsThatLeftTheDialog} openUntilEscape=${st.openUntilEscape} closed=${st.closed} focusReturned=${st.focusReturned} (focus after close: ${st.focusAfterClose})` : ''}${st.shown !== undefined ? ` shown=${st.shown}` : ''}${st.formatSelected !== undefined ? ` formatSelected=${st.formatSelected} scopeNotes=${st.scopeNotes}` : ''}`);
      report.runs.push({ ...found, uiLanguage: lang, focus, plantedDefectsDetected: sensitivity, states });
      console.log(`[${lang}] lang=${found.lang} dir=${found.dir} controls=${found.controls} unnamed=${found.unnamed.length} lowContrast=${found.lowContrast.length} tabIssues=${found.tabIssues.length} focusReached=${focus.reached} noFocusRing=${focus.missing.length}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await s.close();
  }
  const stateFindings = (st: any) => st.unnamed.length + st.lowContrast.length + st.tabIssues.length + st.noFocusRing.length
    + (st.startsInside === false ? 1 : 0) + (st.tabStepsThatLeftTheDialog ? 1 : 0) + (st.openUntilEscape === false ? 1 : 0) + (st.closed === false ? 1 : 0) + (st.focusReturned === false ? 1 : 0) + (st.shown === false ? 1 : 0) + (st.formatSelected === false ? 1 : 0) + (st.firstCardAtInlineStart === false ? 1 : 0);
  const total = report.runs.reduce((n: number, r: any) => n + r.unnamed.length + r.lowContrast.length + r.tabIssues.length + r.focus.missing.length + (r.states ?? []).reduce((m: number, st: any) => m + stateFindings(st), 0), 0);
  report.findings = total;
  report.result = total === 0 ? 'NO FINDINGS (heuristic)' : 'FINDINGS';
  fs.writeFileSync(path.join(root, 'docs/evidence/a11y-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`a11y audit: ${report.result}, ${total} finding(s). Evidence: docs/evidence/a11y-audit.json`);
  for (const r of report.runs) for (const st of r.states ?? []) if (stateFindings(st)) console.log(`  [${r.uiLanguage}] state ${st.state}:`, JSON.stringify({ unnamed: st.unnamed.slice(0, 6), lowContrast: st.lowContrast.slice(0, 6), tabIssues: st.tabIssues.slice(0, 6), noFocusRing: st.noFocusRing.slice(0, 6), startsInside: st.startsInside, leftDialog: st.tabStepsThatLeftTheDialog, closed: st.closed, focusReturned: st.focusReturned, shown: st.shown, formatSelected: st.formatSelected }));
  for (const r of report.runs) { console.log(`  [${r.uiLanguage}] unnamed:`, r.unnamed.slice(0, 12)); console.log(`  [${r.uiLanguage}] low contrast:`, r.lowContrast.slice(0, 12)); console.log(`  [${r.uiLanguage}] no focus ring:`, r.focus.missing.slice(0, 12)); }
  if (process.env.PF_A11Y_STRICT === '1' && total > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
