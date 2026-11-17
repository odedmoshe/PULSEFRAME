/**
 * Cascade checks on the editor's stylesheets, read as text (no browser here). They pin the few rules whose ORDER or
 * SPECIFICITY decides what the user sees: an error message must stay red, a toggle that is on must look on, a dialog
 * opened from the header must not be trapped under other layers, and the zoom control must sit in the flow of its bar.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Rule { file: string; order: number; selectors: string[]; decls: Record<string, string>; media: string | null }
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Splits on `sep` outside (), [] and quotes. */
function split(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

let order = 0;
function parse(file: string, css = read(file).replace(/\/\*[\s\S]*?\*\//g, ''), media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    for (; j < css.length && depth > 0; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) rules.push(...parse(file, body, head));
    else if (!head.startsWith('@')) {
      const decls: Record<string, string> = {};
      for (const d of split(body, ';')) { const c = d.indexOf(':'); if (c > 0) decls[d.slice(0, c).trim()] = d.slice(c + 1).trim(); }
      rules.push({ file, order: order++, selectors: split(head, ','), decls, media });
    }
    i = j;
  }
  return rules;
}

type Spec = [number, number, number];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cmp = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const max = (list: Spec[]) => list.reduce<Spec>((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0]);
/** Specificity of one selector (Selectors 4): :where() counts nothing, :not()/:is() count their most specific argument. */
function specificity(sel: string): Spec {
  let s: Spec = [0, 0, 0];
  let rest = sel;
  // functional pseudo-classes first, innermost handled by recursion
  for (;;) {
    const m = /:(where|not|is|has)\(/.exec(rest);
    if (!m) break;
    let depth = 1, j = m.index + m[0].length;
    for (; j < rest.length && depth > 0; j++) { if (rest[j] === '(') depth++; else if (rest[j] === ')') depth--; }
    const inner = rest.slice(m.index + m[0].length, j - 1);
    if (m[1] !== 'where') s = add(s, max(split(inner, ',').map(specificity)));
    rest = rest.slice(0, m.index) + rest.slice(j);
  }
  rest = rest.replace(/\[[^\]]*\]/g, () => { s = add(s, [0, 1, 0]); return ''; });
  rest = rest.replace(/::[\w-]+/g, () => { s = add(s, [0, 0, 1]); return ''; });
  rest = rest.replace(/:[\w-]+(\([^)]*\))?/g, () => { s = add(s, [0, 1, 0]); return ''; });
  rest = rest.replace(/#[\w-]+/g, () => { s = add(s, [1, 0, 0]); return ''; });
  rest = rest.replace(/\.[\w-]+/g, () => { s = add(s, [0, 1, 0]); return ''; });
  rest.replace(/[a-zA-Z][\w-]*/g, () => { s = add(s, [0, 0, 1]); return ''; });
  return s;
}
/** The rule that wins for `prop` among `rules` (all assumed to match the element): highest specificity, then latest. */
const winner = (rules: { rule: Rule; selector: string }[], prop: string) =>
  rules.filter((r) => prop in r.rule.decls).sort((a, b) => cmp(specificity(a.selector), specificity(b.selector)) || a.rule.order - b.rule.order).at(-1);

// The order main.tsx loads them in: the base sheet, the components' own sheets (through App.tsx), then the visual layer.
const main = read('./main.tsx');
const styles = parse('./styles.css');
const components = ['sfxBrowser.css', 'effectGallery.css', 'elementsBrowser.css', 'speedCurves.css', 'timelineZoom.css', 'welcome.css', 'command-palette.css'].flatMap((f) => parse(`./editor/${f}`));
const theme = parse('./theme.css');
const all = [...styles, ...components, ...theme];
const pick = (rules: Rule[], test: (selector: string) => boolean) => rules.flatMap((rule) => rule.selectors.filter(test).map((selector) => ({ rule, selector })));

describe('the specificity helper', () => {
  it('counts the way the cascade does', () => {
    expect(specificity('button')).toEqual([0, 0, 1]);
    expect(specificity(".sfx-chips button[aria-pressed='true']")).toEqual([0, 2, 1]);
    expect(specificity(":where(button[aria-pressed='true'])")).toEqual([0, 0, 0]);
    expect(specificity("button[aria-pressed='true']:where(:not(.word, .clip))")).toEqual([0, 1, 1]);
    expect(specificity('button:hover:not(:disabled)')).toEqual([0, 2, 1]);
    expect(specificity('.clip-menu button.danger')).toEqual([0, 2, 1]);
    expect(specificity('.playhead::before')).toEqual([0, 1, 1]);
  });
});

describe('editor stylesheets', () => {
  it('the visual layer is loaded after the base sheet', () => {
    expect(main.indexOf("'./styles.css'")).toBeGreaterThan(-1);
    expect(main.indexOf("'./theme.css'")).toBeGreaterThan(main.indexOf("'./styles.css'"));
  });

  it('an error message styled "muted danger" is red: .danger wins over .muted', () => {
    const rules = pick([...styles, ...theme], (s) => s === '.muted' || s === '.danger');
    const win = winner(rules, 'color');
    expect(win?.selector).toBe('.danger');
    expect(win?.rule.decls.color).toMatch(/--pf-danger/);
  });

  it('a toggle button that is on has a visible state: the pressed rule outranks the base button rule', () => {
    const pressed = pick(theme, (s) => /^button\[aria-pressed='true'\]/.test(s));
    expect(pressed.length).toBe(1);
    const generic = pressed[0]!;
    expect(generic.rule.media).toBeNull();
    // no zero-specificity pressed rule is left pretending to do the job
    expect(pick(all, (s) => s.includes('aria-pressed') && cmp(specificity(s), [0, 0, 0]) === 0)).toEqual([]);
    for (const prop of ['background-color', 'border-color']) expect(generic.rule.decls[prop], prop).toBeTruthy();
    // it beats what styles.css gives every button (the `background` shorthand there sets the colour this rule replaces)
    const base = pick(styles, (s) => s === 'button');
    expect(base.some((b) => 'background' in b.rule.decls && 'border' in b.rule.decls)).toBe(true);
    for (const b of base) expect(cmp(specificity(generic.selector), specificity(b.selector))).toBeGreaterThan(0);
  });

  it('controls that draw their own pressed state keep it', () => {
    const generic = pick(theme, (s) => /^button\[aria-pressed='true'\]/.test(s))[0]!;
    const excluded = /:where\(:not\(([^)]*)\)\)/.exec(generic.selector)![1]!.split(',').map((c) => c.trim());
    expect(excluded).toEqual(['.word', '.clip', '.track-btn', '.effect-key', '.pf-gal-tile']);
    // every other rule that styles a pressed control itself: either its control is excluded by name, or it is more specific
    const own = pick([...styles, ...components], (s) => /\[aria-pressed=["']true["']\]$/.test(s));
    expect(own.map((o) => o.selector)).toEqual(expect.arrayContaining([".effect-key[aria-pressed=\"true\"]", ".pf-gal-tile[aria-pressed='true']", ".sfx-chips button[aria-pressed='true']", ".sfx-row button[aria-pressed='true']", ".track-btn[aria-pressed='true']"]));
    for (const o of own) {
      const named = excluded.some((c) => o.selector.startsWith(`${c}[`));
      expect(named || cmp(specificity(o.selector), specificity(generic.selector)) > 0, o.selector).toBe(true);
    }
    // the header keeps its flat buttons (the pause toggle there has its own .paused look): same weight, declared later
    const header = pick(theme, (s) => s === '.header button')[0]!;
    expect(cmp(specificity(header.selector), specificity(generic.selector))).toBe(0);
    expect(header.rule.order).toBeGreaterThan(generic.rule.order);
  });

  it('the header and the panels that hold dialogs create no stacking context, so a dialog opened from them is on top of the page', () => {
    const traps = ['z-index', 'opacity', 'transform', 'filter', 'backdrop-filter', 'perspective', 'clip-path', 'mask', 'isolation', 'mix-blend-mode', 'contain', 'will-change', 'container-type'];
    const holders = pick(all, (s) => ['.app', '.header', '.library', '.inspector'].includes(s));
    expect(holders.some((h) => h.selector === '.header' && h.rule.file === './theme.css')).toBe(true);
    for (const h of holders) for (const prop of traps) expect(h.rule.decls[prop], `${h.selector} { ${prop} } in ${h.rule.file}`).toBeUndefined();
    // what the dialogs must stay above
    const z = (sel: string) => Number(pick(all, (s) => s === sel).map((r) => r.rule.decls['z-index']).filter(Boolean).at(-1));
    for (const dialog of ['.pf-dlg-backdrop', '.pf-pal-backdrop', '.pf-gal-backdrop']) {
      expect(pick(all, (s) => s === dialog)[0]!.rule.decls.position, dialog).toBe('fixed');
      for (const under of ['.welcome', '.marker-bar', '.tl-snap', '.tl-add-track', '.clip-menu']) expect(z(dialog), `${dialog} over ${under}`).toBeGreaterThan(z(under));
    }
  });

  it('the zoom control is in the normal flow of the timeline bar, not laid over it', () => {
    const zoom = pick(all, (s) => s === '.tl-zoom');
    expect(zoom.length).toBeGreaterThan(0);
    for (const r of zoom) {
      expect(r.rule.decls.position ?? 'static', r.rule.media ?? 'base').toBe('static');
      for (const prop of ['top', 'right', 'bottom', 'left', 'inset', 'inset-inline-end', 'inset-inline-start', 'float', 'z-index', 'background']) expect(r.rule.decls[prop], prop).toBeUndefined();
      expect(['flex', 'inline-flex']).toContain(r.rule.decls.display);
    }
    // its own line while there is no room beside the clip actions: a block-level box no wider than its content
    const base = zoom.find((r) => !r.rule.media)!;
    expect(base.rule.decls.display).toBe('flex');
    expect(base.rule.decls['inline-size']).toBe('fit-content');
  });
});
