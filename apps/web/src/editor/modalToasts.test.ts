/**
 * Toasts inside the editor's own modals. The design system Dialog hosts the toast region while it is open (ds/Toast.tsx ToastSlot);
 * four modals have focus traps of their own (the template dialog, the effect gallery, the curve picker, the command palette) and
 * must host it the same way, or a toast raised while one is open sits outside its trap: unreachable by keyboard, and (the modal is
 * aria-modal) not announced. There is no DOM in the unit tests, so this reads the sources and renders the pieces that render to markup;
 * the browser checks (a11y audit states toast-in-*, editor-interactions) do the real thing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastSlot, ToastView } from '../ds/index.ts';
import { createToastClock } from '../ds/toastHost.ts';

const here = import.meta.dirname;
const src = (rel: string) => fs.readFileSync(path.join(here, rel), 'utf8');

/** The modal, its dialog element, the Escape rule it keeps (close), and the key handler's name. */
const MODALS = [
  { name: 'the template dialog', file: 'TemplateDialog.tsx', closes: /e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\(\); return; \}/ },
  { name: 'the effect gallery', file: 'EffectGallery.tsx', closes: /e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\(\); return; \}/ },
  { name: 'the curve picker', file: 'CurvePicker.tsx', closes: /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); close\(\); return; \}/ },
  { name: 'the command palette', file: 'CommandPalette.tsx', closes: /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); close\(\); return; \}/ },
] as const;

describe('the editor\'s own modals host the toast region while they are open', () => {
  for (const m of MODALS) {
    it(`${m.name}: a ToastSlot sits inside its dialog element, so the toast is inside its focus trap`, () => {
      const code = src(m.file);
      expect(code).toMatch(/import \{[^}]*\bToastSlot\b[^}]*\} from '\.\.\/ds\/index\.ts'/);
      expect(code.match(/<ToastSlot \/>/g)).toHaveLength(1);
      const dialog = code.indexOf('role="dialog"');
      const slot = code.indexOf('<ToastSlot />');
      expect(dialog).toBeGreaterThan(0);
      expect(slot).toBeGreaterThan(dialog); // after the dialog element opens, so inside it (the trap's query runs on that element)
      // nothing of the modal's own closing markup in between that would end the dialog element first: the slot is the last child
      const after = code.slice(slot).replace(/^<ToastSlot \/>\s*/, '');
      expect(after).toMatch(/^<\/div>\s*<\/div>/);
    });
    it(`${m.name}: Escape still closes it with the same handler, and no toast condition is in its way (the Dialog rule)`, () => {
      const code = src(m.file);
      expect(code).toMatch(m.closes);
      const line = code.split('\n').find((l) => m.closes.test(l))!;
      expect(line).not.toMatch(/toast/i);
    });
  }
  it('the Dialog rule being mirrored: Escape closes the modal, whatever holds the focus inside it', () => {
    const dialog = fs.readFileSync(path.join(here, '../ds/Dialog.tsx'), 'utf8');
    expect(dialog).toMatch(/e\.key === 'Escape'\) \{ e\.stopPropagation\(\); e\.preventDefault\(\); onClose\(\); return; \}/);
    expect(dialog.split('\n').find((l) => l.includes("e.key === 'Escape'"))).not.toMatch(/toast/i);
  });
});

describe('the toast region is drawn inside the slot, in the modal\'s own React tree', () => {
  it('a key pressed on a toast button reaches the modal\'s handlers: the slot draws the region itself, the provider only draws it on the page', () => {
    const code = fs.readFileSync(path.join(here, '../ds/Toast.tsx'), 'utf8');
    // a portal from the provider into the modal's element would send the key to the provider's ancestors, not to the modal (React
    // events follow the React tree), so Escape and the Tab wrap of the modal would not hear a key typed on a toast
    expect(code).not.toMatch(/createPortal\([^)]*host \?\?/);
    expect(code).toMatch(/host === null && createPortal\(<ToastRegion where="page" \/>, document\.body\)/);
    expect(code).toMatch(/host !== null && host === ref\.current && <ToastRegion where="modal" \/>/);
  });
  it('the slot is a plain container with its test id (the region appears in it only once it has claimed the host)', () => {
    const html = renderToStaticMarkup(createElement(ToastSlot));
    expect(html).toBe('<div class="pf-toast-slot" data-testid="toast-slot"></div>');
  });
  it('one toast is exactly one live status with a named close button, and nothing around it is live: it is announced once', () => {
    const html = renderToStaticMarkup(createElement(ToastView, { t: { id: 't1', kind: 'fix', title: 'Saved', ttl: 0, action: 'Open' } as never, onDismiss: () => {}, closeLabel: 'Close' }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toMatch(/aria-live|role="alert"/);
    expect(html).toMatch(/<button type="button" class="pf-toast-x" aria-label="Close"/);
    expect(html).toContain('>Open<');
  });
});

describe('the command palette: what can raise a toast while it is open', () => {
  const palette = src('CommandPalette.tsx');
  const bar = src('commandBar/useBarResult.ts');
  const assistant = src('commandBar/AssistantRow.tsx');
  it('nothing in the palette itself raises a toast: a chosen command, catalogue entry or media row closes the palette first, then runs', () => {
    expect(palette).not.toMatch(/notify\(|toasts?\.push|useToasts/);
    expect(assistant).not.toMatch(/notify\(|toasts?\.push|useToasts/);
    // run(): close() before the command's own run, which is deferred (setTimeout) until the dialog has unmounted
    expect(palette).toMatch(/const run = \(c: Command \| undefined\) => \{\s*if \(!c \|\| !enabled\(c\)\) return;\s*close\(\);[^}]*setTimeout\(\(\) => void c\.run\(editor\), 0\);/);
    expect(palette).toMatch(/startsWith\('media:'\)\) \{ close\(\); /);
    expect(palette).toMatch(/const call = pickCall\(clip, \{ kind: cat\.kind, id: cat\.id \}\);\s*close\(\);/);
  });
  it('the command bar notifies in the same synchronous step that closes the palette (no await between), and every other action closes it', () => {
    const commit = bar.slice(bar.indexOf("if (r.kind === 'committed')"), bar.indexOf("if (r.kind === 'stale')"));
    expect(commit.indexOf('this.port.notify(')).toBeGreaterThan(0);
    expect(commit.indexOf('this.host.close()')).toBeGreaterThan(commit.indexOf('this.port.notify('));
    expect(commit.slice(commit.indexOf('this.port.notify('), commit.indexOf('this.host.close()'))).not.toMatch(/await/);
    const actions = bar.slice(bar.indexOf('private runAction'), bar.indexOf('private async commitPlan'));
    for (const c of ['undo', 'redo', 'command', 'recipe']) expect(actions).toMatch(new RegExp(`case '${c}': this\\.host\\.close\\(\\);`));
    expect(actions.trimEnd()).toMatch(/this\.host\.close\(\);\s*\}$/); // the other actions fall through to a close at the end
  });
  it('so the palette\'s ToastSlot has a job only for a toast that is already on screen when it opens (an import note with no timer, an undo toast still counting) or one raised by work that began before it opened; it holds that toast inside the trap', () => {
    expect(palette).toMatch(/<ToastSlot \/>/);
  });
});

describe('a toast\'s time survives the region moving between the page and a modal', () => {
  it('the time left is kept by toast id outside the view, so a rebuilt view carries on instead of restarting', () => {
    const c = createToastClock();
    expect(c.left('a', 6000)).toBe(6000); // never shown: its full time
    c.save('a', 2500); // the view is torn down when a modal claims the region
    expect(c.left('a', 6000)).toBe(2500); // the slot's view picks up there
    c.save('a', 0);
    expect(c.left('a', 6000)).toBe(0);
  });
  it('forgets toasts that left the queue, so a reused id starts fresh', () => {
    const c = createToastClock();
    c.save('a', 100); c.save('b', 200);
    c.keepOnly(['b']);
    expect(c.left('a', 6000)).toBe(6000);
    expect(c.left('b', 6000)).toBe(200);
  });
  it('the region hands every view the clock, and a view reads and saves it', () => {
    const code = fs.readFileSync(path.join(here, '../ds/Toast.tsx'), 'utf8');
    expect(code).toMatch(/clock=\{d\.clock\}/);
    expect(code).toMatch(/useRef\(clock \? clock\.left\(t\.id, t\.ttl\) : t\.ttl\)/);
    expect(code).toMatch(/clock\?\.save\(t\.id, left\.current\)/);
  });
});
