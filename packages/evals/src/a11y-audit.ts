/**
 * Accessibility audit of the editor (SPEC §3, Appendix C3): an automated HEURISTIC pass in Hebrew (RTL) and English (LTR).
 * It checks things a script can decide: every control has an accessible name, text contrast, visible keyboard focus,
 * document language/direction, tab semantics. It is not a WCAG conformance statement and does not replace testing with a
 * screen reader or with users. Findings are written to docs/evidence/a11y-audit.json. The transient states include the
 * effect gallery dialog and the look panel with the visual wave's controls (beat fieldset, date stamp, time separator), and the
 * AI-model wave's surfaces (ADR-0017): the AI tools panel with a run sheet open, the before/after compare slider after a run of the
 * ffmpeg-only classic vocal remover, and the translation review (a typed translation fixture; no model runs).
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
  const s = await startServer({ port: 8803, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const post = async (p: string, body: unknown) => (await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
  const browser = await chromium.launch();
  const report: any = { ranAt: new Date().toISOString(), machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, browser: browser.version() }, scope: 'Automated heuristic audit of the editor with all Inspector panels shown and one clip selected. Not a WCAG conformance claim; no screen-reader or user testing.', runs: [] };
  try {
    const pid = (await post('/projects', { name: 'a11y', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const tx = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }, { op: 'add_caption_track', args: { mode: 'manual' } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }, { op: 'add_marker', args: { time: f(0), label: 'סמן פתיחה' } }] });
    const clipId = tx.results[0].output.clipId;
    // ADR-0017: a stereo sound (two different channels, so the classic vocal remover accepts it) on its own clip, with a typed Hebrew
    // transcript and an English translation fixture (stored by the op the translation tool commits; no model runs here).
    const mix = path.join(art, 'mix.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc=exprs='0.3*sin(2*PI*440*t)+0.3*sin(2*PI*660*t)|0.3*sin(2*PI*440*t)':s=48000:d=2", '-c:a', 'pcm_s16le', mix]);
    const upMix: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'mix.wav' }, body: fs.readFileSync(mix) })).json();
    const mixClip = (await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: upMix.assetId, start: f(0) } }] })).results[0].output.clipId as string;
    s.store.commit({ projectId: pid, actor: 'fixture', ops: [{ op: 'set_transcript', args: { assetId: upMix.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }] } }] });
    const seg = s.store.getProject(pid).doc.transcripts[upMix.assetId]!.segments[0]!.id;
    s.store.commit({ projectId: pid, actor: 'fixture', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'typed fixture (no model ran)', model: 'none', createdAt: new Date().toISOString(), createdBy: 'fixture', sources: { [seg]: sha256Hex('שלום לכולם') } }, phraseText: { [seg]: 'Hello everyone' }, cueText: {} } }] });
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
      const variantId = await page.getByTestId('format-switch').evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value).find((v) => v && v !== 'master') ?? '');
      if (variantId) { await page.getByTestId('format-switch').selectOption(variantId); await page.getByTestId('format-badge').waitFor({ timeout: 5000 }).catch(() => {}); }
      await auditState('format-view', { formatSelected: !!variantId, scopeNotes: await page.locator('[data-testid=transform-scope][data-scope=format], [data-testid=caption-scope]').count() });
      if (variantId) await page.getByTestId('format-switch').selectOption({ index: 0 });
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
      // an upload in progress, then the error bar: a file that is not media is sent, the request is held while the busy state is audited, then the server refuses it
      let release: () => void = () => {};
      const held = new Promise<void>((r) => { release = r; });
      const hold = async (route: any) => { if (route.request().method() === 'POST') await held; await route.continue(); };
      await page.route('**/api/v1/projects/*/assets', hold);
      await page.getByTestId('file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a media file') });
      await page.waitForFunction(() => (document.querySelector('[data-testid=file-input]') as HTMLInputElement | null)?.disabled === true, undefined, { timeout: 5000 }).catch(() => {});
      await auditState('upload-busy', { shown: await page.getByTestId('file-input').isDisabled() });
      release();
      await page.locator('.error[role=alert]').waitFor({ timeout: 10000 }).catch(() => {});
      await page.unroute('**/api/v1/projects/*/assets', hold);
      const errShown = (await page.locator('.error[role=alert]').count()) === 1;
      await auditState('error-bar', { shown: errShown, text: errShown ? ((await page.locator('.error[role=alert]').textContent()) ?? '').slice(0, 120) : '' });
      if (errShown) await page.locator('.error[role=alert] button').click();
      Object.assign(states.at(-1), { closed: (await page.locator('.error[role=alert]').count()) === 0 });
      // an export in progress: the export button reads "exporting", a cancel button is offered; the export is then cancelled
      await page.getByTestId('export').click();
      await page.getByTestId('export-cancel').waitFor({ timeout: 10000 }).catch(() => {});
      await auditState('export-busy', { shown: (await page.getByTestId('export-cancel').count()) === 1 && await page.getByTestId('export').isDisabled() });
      if (await page.getByTestId('export-cancel').count()) await page.getByTestId('export-cancel').click();
      await page.getByTestId('export-cancel').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      Object.assign(states.at(-1), { closed: (await page.getByTestId('export-cancel').count()) === 0 });
      if (await page.locator('.error[role=alert] button').count()) await page.locator('.error[role=alert] button').click(); // a cancelled export is not reported as an error; close one if it is
      // source viewer dialog
      const sv = await dialogBehaviour('source-viewer', async () => { await page.getByTestId(`view-${up.assetId}`).click(); }, `[data-testid="view-${up.assetId}"]`);
      await auditState('source-viewer', { startsInside: sv.startsInside, tabStepsThatLeftTheDialog: sv.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await sv.close());
      // full history dialog
      const ad = await dialogBehaviour('activity-dialog', async () => { await page.getByTestId('activity-open').click(); }, '[data-testid=activity-open]');
      await auditState('activity-dialog', { startsInside: ad.startsInside, tabStepsThatLeftTheDialog: ad.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await ad.close());
      // command palette
      const cp = await dialogBehaviour('palette-dialog', async () => { await page.getByTestId('projects-open').focus(); await page.keyboard.press('Control+k'); }, '[data-testid=projects-open]');
      await auditState('command-palette', { startsInside: cp.startsInside, tabStepsThatLeftTheDialog: cp.tabStepsThatLeftTheDialog }, true);
      Object.assign(states.at(-1), await cp.close());
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
      // the translation review in the transcript panel (all Inspector panels are shown)
      const review = page.getByTestId('translation-review');
      await review.waitFor({ timeout: 8000 }).catch(() => {});
      const reviewShown = (await review.count()) === 1;
      if (reviewShown) { await review.scrollIntoViewIfNeeded().catch(() => {}); await review.getByTestId('translation-limit').focus().catch(() => {}); }
      await auditState('translation-review', { shown: reviewShown && (await review.getByTestId('translation-row').count()) === 1 }, true);
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
    + (st.startsInside === false ? 1 : 0) + (st.tabStepsThatLeftTheDialog ? 1 : 0) + (st.openUntilEscape === false ? 1 : 0) + (st.closed === false ? 1 : 0) + (st.focusReturned === false ? 1 : 0) + (st.shown === false ? 1 : 0) + (st.formatSelected === false ? 1 : 0);
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
