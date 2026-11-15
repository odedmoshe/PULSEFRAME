/**
 * Accessibility audit of the editor (SPEC §3, Appendix C3): an automated HEURISTIC pass in Hebrew (RTL) and English (LTR).
 * It checks things a script can decide: every control has an accessible name, text contrast, visible keyboard focus,
 * document language/direction, tab semantics. It is not a WCAG conformance statement and does not replace testing with a
 * screen reader or with users. Findings are written to docs/evidence/a11y-audit.json.
 *   pnpm build && pnpm audit:a11y
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
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
async function focusAudit(page: Page, steps: number) {
  const missing: string[] = [];
  const reached = new Set<string>();
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
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
    const tx = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }, { op: 'add_caption_track', args: { mode: 'manual' } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }] });
    const clipId = tx.results[0].output.clipId;
    for (const lang of ['he', 'en'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript((l) => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
      await page.goto(`${s.url}/?project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.waitForTimeout(300);
      const found = await page.evaluate(auditInPage);
      const focus = await focusAudit(page, 60);
      await page.screenshot({ path: path.join(art, `editor-${lang}.png`), fullPage: false });
      report.runs.push({ ...found, uiLanguage: lang, focus });
      console.log(`[${lang}] lang=${found.lang} dir=${found.dir} controls=${found.controls} unnamed=${found.unnamed.length} lowContrast=${found.lowContrast.length} tabIssues=${found.tabIssues.length} focusReached=${focus.reached} noFocusRing=${focus.missing.length}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await s.close();
  }
  const total = report.runs.reduce((n: number, r: any) => n + r.unnamed.length + r.lowContrast.length + r.tabIssues.length + r.focus.missing.length, 0);
  report.findings = total;
  report.result = total === 0 ? 'NO FINDINGS (heuristic)' : 'FINDINGS';
  fs.writeFileSync(path.join(root, 'docs/evidence/a11y-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`a11y audit: ${report.result}, ${total} finding(s). Evidence: docs/evidence/a11y-audit.json`);
  for (const r of report.runs) { console.log(`  [${r.uiLanguage}] unnamed:`, r.unnamed.slice(0, 12)); console.log(`  [${r.uiLanguage}] low contrast:`, r.lowContrast.slice(0, 12)); console.log(`  [${r.uiLanguage}] no focus ring:`, r.focus.missing.slice(0, 12)); }
  if (process.env.PF_A11Y_STRICT === '1' && total > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
