/**
 * The heuristic accessibility checks of pnpm audit:a11y (a11y-audit.ts), shared with the proofs that audit one state of their
 * own (command-bar-proof.ts): accessible names, text contrast, tab semantics (auditInPage, run in the page) and a visible focus
 * ring while tabbing (focusAudit). Heuristic only: not a WCAG conformance statement.
 */
import type { Page } from 'playwright';

/**
 * Runs in the page. Returns findings; selectors are short descriptions for a person to locate the element. `rootSelector`
 * limits the audit to one part of the page (a dialog); left out, the whole page.
 */
export function auditInPage(rootSelector?: string | void) {
  const scope: ParentNode & Node = (typeof rootSelector === 'string' ? document.querySelector(rootSelector) : null) ?? document.body;
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
  const controls = [...scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=checkbox], [role=meter]')].filter(visible);
  for (const c of controls) if (!nameOf(c)) unnamed.push(describe(c));

  // contrast of visible text against the nearest opaque background
  // rgb()/rgba(), and color(srgb r g b / a) with channels 0..1: what the browser gives for a color-mix() of tokens (the stage's
  // surfaces and accents in the light theme). Before, such a colour was not read at all: a text in it was skipped, and a background
  // in it was looked through to the next one (or to the dark default), so the light theme's stage buttons read as 1:1.
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1]!.split(/[,/ ]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 }; }
    const s = c.match(/color\(srgb ([^)]+)\)/);
    if (s) { const p = s[1]!.split(/[ /]+/).filter(Boolean).map(Number); return { r: p[0]! * 255, g: p[1]! * 255, b: p[2]! * 255, a: p[3] ?? 1 }; }
    return null;
  };
  const lum = (c: { r: number; g: number; b: number }) => { const k = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0]! + 0.7152 * k[1]! + 0.0722 * k[2]!; };
  const bgOf = (el: Element) => { let e: Element | null = el; let acc = { r: 13, g: 16, b: 21 }; const stack: { r: number; g: number; b: number; a: number }[] = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } e = e.parentElement; } for (const c of stack.reverse()) acc = { r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }; return acc; };
  const lowContrast: { el: string; ratio: number; text: string; size: number }[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
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
  const tabs = [...scope.querySelectorAll('[role=tab]')];
  const tabIssues = tabs.filter((t) => !t.getAttribute('aria-controls') || !['true', 'false'].includes(t.getAttribute('aria-selected') ?? '')).map(describe);
  return { lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, controls: controls.length, unnamed, lowContrast, tabIssues };
}

/** Tab through the page and report focused elements that show no visible focus indicator. */
export async function focusAudit(page: Page, steps: number, clickFirst = true) {
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

/**
 * A toast raised while a modal is open (the template dialog, the effect gallery, the curve picker, the command palette). Needs
 * the page's `__pfToastProof` flag (an init script): the app then exposes `window.__pfToast`, which pushes into the same queue
 * the editor's notices use. Checks, with the modal open and its focus inside: the toast is inside the modal, in the toast region
 * the modal hosts (data-host=modal), named in the interface language, not inert, one status only (announced once), in the
 * accessibility tree as a status, drawn where it can be seen (not under the modal's own content or scrim), and the keyboard
 * reaches its action and its × (Tab, never leaving the modal; one more Tab comes back into the modal's own controls). Leaves
 * the focus on the toast's × so the caller's Escape proves Escape still closes the modal from there. `shown` is false on any miss.
 */
export async function toastInOpenModal(page: Page, lang: 'he' | 'en', dialogTestId: string): Promise<Record<string, unknown>> {
  const title = lang === 'he' ? 'בדיקת התראה בתוך חלון' : 'Toast check inside a window';
  const action = lang === 'he' ? 'לפתיחה' : 'Open';
  await page.evaluate(([t, a]) => (window as unknown as { __pfToast: (x: unknown) => string }).__pfToast({ kind: 'fix', title: t, action: a, ttl: 0 }), [title, action]);
  const sel = `[data-testid=${dialogTestId}] [data-testid=toasts] [role=status]`;
  await page.locator(sel).first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);
  const where = await page.evaluate(([id, text]) => {
    const dlg = document.querySelector<HTMLElement>(`[data-testid=${id}]`);
    const region = document.querySelector<HTMLElement>('[data-testid=toasts]');
    const t = region?.querySelector<HTMLElement>('[role=status]');
    const r = t?.getBoundingClientRect();
    const liveUp = (el: HTMLElement | null | undefined) => { let n = 0; for (let e = el?.parentElement ?? null; e; e = e.parentElement) if (e.hasAttribute('aria-live') || ['status', 'alert', 'log'].includes(e.getAttribute('role') ?? '')) n++; return el ? n : -1; };
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      inModal: !!t && !!dlg?.contains(t), host: region?.dataset.host ?? null, inert: !t || !!t.closest('[inert]'), regionName: region?.getAttribute('aria-label') ?? null,
      regions: document.querySelectorAll('[data-testid=toasts]').length, statusesWithText: [...document.querySelectorAll('[role=status]')].filter((e) => e.textContent?.includes(text as string)).length,
      liveAncestors: liveUp(t),
      onScreen: !!r && r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, notCovered: !!t && !!hit && t.contains(hit),
    };
  }, [dialogTestId, title]);
  const cdp = await page.context().newCDPSession(page);
  let ax: { ignored: boolean; role: string | null } | null = null;
  try {
    const { root: d } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: d.nodeId, selector: sel });
    if (nodeId) { const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }); const n = nodes[0] as { ignored?: boolean; role?: { value?: string } } | undefined; ax = n ? { ignored: !!n.ignored, role: n.role?.value ?? null } : null; }
  } finally { await cdp.detach().catch(() => {}); }
  // the keyboard: Tab forward until the toast's action, then its ×; focus must stay in the modal on every step
  // «the toast» is the one raised here: another toast may still be on screen (an undo toast with its timer), with its own buttons
  const at = () => page.evaluate(([id, text]) => {
    const own = document.activeElement?.closest('[data-testid=toasts] [role=status]');
    const mine = !!own && !!own.textContent?.includes(text as string);
    return { inModal: !!document.querySelector(`[data-testid=${id}]`)?.contains(document.activeElement), onAction: mine && document.activeElement?.tagName === 'BUTTON' && !document.activeElement.classList.contains('pf-toast-x'), onClose: mine && !!document.activeElement?.classList.contains('pf-toast-x') };
  }, [dialogTestId, title]);
  let left = 0, reachedAction = false, reachedClose = false;
  for (let i = 0; i < 80 && !reachedClose; i++) {
    await page.keyboard.press('Tab');
    const s = await at();
    if (!s.inModal) left++;
    if (s.onAction) reachedAction = true;
    if (s.onClose) reachedClose = true;
  }
  // one more Tab leaves the toast for the modal's own first control (the trap wraps; it does not let focus out)
  let wraps = false;
  if (reachedClose) { await page.keyboard.press('Tab'); const s = await at(); wraps = s.inModal && !s.onClose && !s.onAction; await page.keyboard.press('Shift+Tab'); }
  const back = await at();
  const announced = ax?.ignored === false && ax.role === 'status';
  const shown = where.inModal && where.host === 'modal' && !where.inert && where.regions === 1 && where.statusesWithText === 1 && where.liveAncestors === 0 && announced && where.onScreen && where.notCovered && reachedAction && reachedClose && left === 0 && wraps && back.onClose;
  return { shown, ...where, announced, toastActionReachedByKeyboard: reachedAction, toastCloseReachedByKeyboard: reachedClose, tabWrapsInsideModal: wraps, tabStepsThatLeftTheDialog: left, focusOnToastClose: back.onClose };
}

/** After the modal closed: the region is the page's again (a child of the body), the toast is still there (ttl 0) and is closed with its ×. */
export async function toastAfterModal(page: Page): Promise<{ toastBackOnPage: boolean }> {
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => { const reg = document.querySelector<HTMLElement>('[data-testid=toasts]'); return reg?.dataset.host === 'page' && reg.parentElement === document.body && !!reg.querySelector('[role=status]') && !document.querySelector('[inert]'); });
  const x = page.locator('[data-testid=toasts] .pf-toast-x');
  while (await x.count()) { await x.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(80); if ((await x.count()) > 5) break; }
  return { toastBackOnPage: r };
}
