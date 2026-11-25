/**
 * A design-system Dialog opened over one of the editor's own modals (the template dialog, the effect gallery, the curve picker,
 * the command palette), with a toast on screen: the toast region belongs to the newest open modal, there is exactly one region
 * and one status at every moment, and the toast's time carries on through each move.
 *
 * The unit tests have no DOM, so React's effects do not run here. This drives the real pieces that decide and draw (the host stack
 * and the toast clock of toastHost.ts; the region's and the toast's own markup from Toast.tsx) through the two drawing rules of
 * Toast.tsx, which are read from its source so the model below cannot drift from them:
 *   the provider draws the region on the page   when no modal holds it        (host === null)
 *   a modal's ToastSlot draws it                when it is the newest host    (host === its own element)
 * and a slot claims the host when it mounts and gives it back when it unmounts. The browser checks (a11y audit, toast-in-modal)
 * run the effects for one modal; no path in the editor opens a Dialog over one of the four today (see the last test).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastRegionView, type RegionData } from './Toast.tsx';
import { createHostStack, createToastClock } from './toastHost.ts';

const here = import.meta.dirname;
const toastSource = fs.readFileSync(path.join(here, 'Toast.tsx'), 'utf8');
const editor = (file: string) => fs.readFileSync(path.join(here, '../editor', file), 'utf8');

/** One open modal's ToastSlot: its element (what it claims) and the release its unmount calls. */
interface Slot { name: string; el: object; release: () => void }
/** The document as the two drawing rules make it, at one moment. */
function scene() {
  const hosts = createHostStack<object>();
  const clock = createToastClock();
  const mounted: Slot[] = [];
  let now = 0;
  /** The view that draws the toast now: when it was built and how much time it had then (ToastView reads the clock when it is built). */
  let view: { since: number; left: number } | null = null;
  const TTL = 6000;
  const toast = { id: 't1', kind: 'undo', title: 'נמחק', action: 'ביטול', ttl: TTL } as RegionData['queue'][number];
  const data: RegionData = { queue: [toast], dismiss: () => {}, closeLabel: 'סגירה', label: 'הודעות', clock };
  /** Who draws: the page when no modal holds the region, else the slot that is the newest host (Toast.tsx, pinned below). */
  const owner = (): 'page' | Slot => { const host = hosts.current(); return host === null ? 'page' : mounted.find((s) => host !== null && host === s.el)!; };
  /** The region moved: the old view is torn down (it saves what is left of the toast's time), the new one is built from the clock. */
  const rebuild = () => {
    if (view) clock.save(toast.id, Math.max(0, view.left - (now - view.since)));
    view = { since: now, left: clock.left(toast.id, TTL) };
  };
  rebuild();
  return {
    open(name: string): Slot { const el = { name }; const slot: Slot = { name, el, release: hosts.claim(el) }; mounted.push(slot); rebuild(); return slot; },
    close(slot: Slot) { slot.release(); mounted.splice(mounted.indexOf(slot), 1); rebuild(); },
    wait(ms: number) { now += ms; },
    owner, hosts,
    timeLeft: () => view!.left - (now - view!.since),
    /** Everything the document holds: the page's region or nothing, and each open modal's slot with the region or nothing. */
    markup(): string {
      const o = owner();
      const region = (where: 'page' | 'modal') => renderToStaticMarkup(createElement(ToastRegionView, { where, d: data }));
      return [o === 'page' ? region('page') : '', ...mounted.map((s) => `<div data-modal="${s.name}"><div class="pf-toast-slot" data-testid="toast-slot">${o === s ? region('modal') : ''}</div></div>`)].join('');
    },
  };
}
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const regionIn = (html: string): string => /<div data-modal="([^"]+)"><div class="pf-toast-slot" data-testid="toast-slot"><div class="[^"]*pf-toasts/.exec(html)?.[1] ?? (/^<div class="[^"]*pf-toasts[^>]*data-host="page"/.test(html) ? 'page' : 'nowhere');
/** How far the toast's timer bar has already run in the markup (the bar's negative animation delay), in ms. */
const barAt = (html: string): number => { const m = /animation-delay:-(\d+)ms/.exec(html); return m ? Number(m[1]) : 0; };

describe('the two drawing rules this test models are the ones in Toast.tsx', () => {
  it('the provider draws the page region only when no modal holds it; a slot draws it only when it is the newest host; a slot claims on mount and releases on unmount', () => {
    expect(toastSource).toMatch(/host === null && createPortal\(<ToastRegion where="page" \/>, document\.body\)/);
    expect(toastSource).toMatch(/host !== null && host === ref\.current && <ToastRegion where="modal" \/>/);
    expect(toastSource).toMatch(/useLayoutEffect\(\(\) => toastHosts\.claim\(ref\.current!\), \[\]\)/); // claim returns the release: React calls it on unmount
    expect(toastSource).toMatch(/const toastHosts = createHostStack<HTMLElement>\(\)/); // one stack for every slot and the provider
    // the view saves what is left when it is torn down and reads it when it is built
    expect(toastSource).toMatch(/clock\?\.save\(t\.id, left\.current\)/);
    expect(toastSource).toMatch(/useRef\(clock \? clock\.left\(t\.id, t\.ttl\) : t\.ttl\)/);
  });
});

describe('a Dialog opened over one of the editor\'s own modals, with a toast on screen', () => {
  for (const first of ['the template dialog', 'the effect gallery', 'the curve picker', 'the command palette']) it(`${first} → a Dialog over it → the Dialog closes → ${first} closes: one region and one status throughout, and the toast's time carries on`, () => {
    const s = scene();
    const one = (html: string) => [count(html, /data-testid="toasts"/g), count(html, /role="region"/g), count(html, /role="status"/g)];
    // the page, a toast with 6 s: one region on the page
    expect([regionIn(s.markup()), ...one(s.markup())]).toEqual(['page', 1, 1, 1]);
    s.wait(1000);
    // modal A opens: the region moves into it; its bar is 1 s in, not back at the start
    const a = s.open(first);
    let html = s.markup();
    expect([regionIn(html), ...one(html)]).toEqual([first, 1, 1, 1]);
    expect(html).toContain('data-host="modal"');
    expect([s.timeLeft(), barAt(html)]).toEqual([5000, 1000]);
    s.wait(1000);
    // Dialog B opens over A: the region moves to B; A's slot is empty; still one region, one status; the timer did not restart
    const b = s.open('a design-system Dialog');
    html = s.markup();
    expect([regionIn(html), ...one(html)]).toEqual(['a design-system Dialog', 1, 1, 1]);
    expect(html).toContain(`<div data-modal="${first}"><div class="pf-toast-slot" data-testid="toast-slot"></div></div>`);
    expect(count(html, /data-testid="toast-slot"/g)).toBe(2);
    expect([s.timeLeft(), barAt(html)]).toEqual([4000, 2000]);
    s.wait(1500);
    // B closes: the region is back in A, carrying on
    s.close(b);
    html = s.markup();
    expect([regionIn(html), ...one(html)]).toEqual([first, 1, 1, 1]);
    expect([s.timeLeft(), barAt(html)]).toEqual([2500, 3500]);
    s.wait(500);
    // A closes: the region is back on the page
    s.close(a);
    html = s.markup();
    expect([regionIn(html), ...one(html)]).toEqual(['page', 1, 1, 1]);
    expect(html).toContain('data-host="page"');
    expect(count(html, /data-testid="toast-slot"/g)).toBe(0);
    expect([s.timeLeft(), barAt(html)]).toEqual([2000, 4000]);
    expect(s.hosts.current()).toBeNull();
    // the toast itself is the same throughout: one named close button, one action, never an alert
    expect(html).toMatch(/<button type="button" class="pf-toast-x" aria-label="סגירה"/);
    expect(html).not.toMatch(/role="alert"|aria-live/);
  });
  it('closed in the other order (the lower modal first): the Dialog keeps the region until it closes, then the page has it', () => {
    const s = scene();
    const a = s.open('the template dialog'), b = s.open('a design-system Dialog');
    s.wait(2000);
    s.close(a);
    expect(regionIn(s.markup())).toBe('a design-system Dialog');
    expect(count(s.markup(), /role="status"/g)).toBe(1);
    expect(s.timeLeft()).toBe(4000);
    s.close(b);
    expect(regionIn(s.markup())).toBe('page');
    expect(s.timeLeft()).toBe(4000);
  });
  it('the Dialog and each of the four modals hold exactly one ToastSlot inside their dialog element, mounted only while open', () => {
    const dialog = fs.readFileSync(path.join(here, 'Dialog.tsx'), 'utf8');
    expect(dialog.match(/<ToastSlot \/>/g)).toHaveLength(1);
    expect(dialog).toMatch(/if \(!open\) return null;/); // a closed Dialog renders nothing: its slot is unmounted, the host released
    for (const file of ['TemplateDialog.tsx', 'EffectGallery.tsx', 'CurvePicker.tsx', 'CommandPalette.tsx']) expect(editor(file).match(/<ToastSlot \/>/g), file).toHaveLength(1);
  });
});

describe('where nesting can happen in the editor today', () => {
  it('none of the four modals opens a design-system Dialog, and the palette\'s shortcut does not act behind an open modal', () => {
    for (const file of ['TemplateDialog.tsx', 'EffectGallery.tsx', 'CurvePicker.tsx', 'CommandPalette.tsx']) {
      const code = editor(file);
      expect(code, file).not.toMatch(/<(Dialog|Sheet)\b/);
      expect(code, file).not.toMatch(/import \{[^}]*\b(Dialog|Sheet)\b[^}]*\} from '\.\.\/ds\/index\.ts'/);
    }
    // the nearest thing to it is a hand-over, not a nesting: the assistant row's «איך מחברים» closes the palette, then opens Settings
    expect(editor('commandBar/AssistantRow.tsx')).toMatch(/editor\.set\(\{ paletteOpen: false \}\); setSettingsOpen\(true\);/);
  });
});
