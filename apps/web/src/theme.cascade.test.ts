/**
 * Cascade checks on the editor's stylesheets, read as text (no browser here). They pin the few rules whose ORDER or
 * SPECIFICITY decides what the user sees: an error message must stay red, a toggle that is on must look on, a dialog
 * opened from the header must not be trapped under other layers, and the zoom control must sit in the flow of its bar.
 */
import { readdirSync, readFileSync } from 'node:fs';
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
// every component sheet, so a rule added in any of them is weighed too
// the shell grid (ds/shell.css) is imported by App.tsx before the components' sheets, and is weighed with them
const componentFiles = ['./ds/shell.css', ...readdirSync(new URL('./editor/', import.meta.url)).filter((f) => f.endsWith('.css')).sort().map((f) => `./editor/${f}`), './clip-visuals.css'];
const components = componentFiles.flatMap((f) => parse(f));
const theme = parse('./theme.css');
// the sheets of the redesigned chrome (top bar, rail, drawer) and of the design-system primitives; they are loaded before the legacy ones
const chrome = ['./ds/chrome.css', './ds/primitives.css'].flatMap((f) => parse(f));
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

describe('design tokens (ds/tokens.css)', () => {
  it('only ds/tokens.css defines the theme tokens: no other sheet redefines them, so no rule on a primitive can beat a .pf-force-dark subtree', () => {
    const names = ['--pf-surface-2', '--pf-surface-3', '--pf-text', '--pf-focus'];
    const others = [...styles, ...components, ...theme, ...chrome];
    // the one refinement is the stage's own (editor/stage.css), which is scoped to the stage and .pf-force-dark roots themselves
    const redefined = others.filter((r) => names.some((n) => n in r.decls) && !r.selectors.every((sel) => /\.pf-force-dark|\.app > \.stage/.test(sel))).map((r) => r.selectors.join(', '));
    expect(redefined).toEqual([]);
    expect(tokens).toMatch(/\.pf-force-dark\s*\{/);
  });

  const tokens = read('./ds/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const brand = readFileSync(new URL('../../../packages/brand/src/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = (css: string) => new Set([...css.matchAll(/(--pf-[\w-]+)\s*:/g)].map((m) => m[1]!));
  const aliases: Record<string, string> = {
    '--pf-bg': '--pf-canvas', '--pf-surface': '--pf-surface-1', '--pf-surface-raised': '--pf-surface-3', '--pf-border': '--pf-line-strong-solid',
    '--pf-text-muted': '--pf-text-2', '--pf-accent': '--pf-frame', '--pf-accent-2': '--pf-info', '--pf-accent-3': '--pf-agent', '--pf-warn': '--pf-attention',
  };

  it('load first: the tokens, then the fonts, then the legacy aliases, then the base sheet', () => {
    const at = (s: string) => main.indexOf(`'${s}'`);
    expect(at('./ds/tokens.css')).toBeGreaterThan(-1);
    expect(at('./ds/tokens.css')).toBeLessThan(at('./ds/uiFonts.ts'));
    expect(at('./ds/uiFonts.ts')).toBeLessThan(at('@pulseframe/brand/tokens.css'));
    expect(at('@pulseframe/brand/tokens.css')).toBeLessThan(at('./styles.css'));
  });

  it('defines dark as the default (regardless of the OS) and light as an explicit setting', () => {
    expect(tokens).toMatch(/:root,\s*:root\[data-theme="dark"\]\s*\{/);
    expect(tokens).toMatch(/:root\[data-theme="light"\]\s*\{/);
    expect(tokens).not.toMatch(/prefers-color-scheme/);
    // density: the layout tokens step with the viewport, and motion shortens under reduced motion
    for (const q of ['(min-width:1800px)', '(min-width:2300px)', '(max-width:1366px)', '(max-height:780px)', '(prefers-reduced-motion:reduce)']) expect(tokens, q).toContain(q);
  });

  it('every legacy name still resolves: an alias onto a token that exists', () => {
    const real = declared(tokens);
    for (const [legacy, target] of Object.entries(aliases)) {
      expect(brand, legacy).toContain(`${legacy}: var(${target})`);
      expect(real.has(target), `${target} exists in ds/tokens.css`).toBe(true);
    }
  });

  it('every var(--pf-...) the legacy sheets use is defined somewhere that loads', () => {
    const defined = new Set([...declared(tokens), ...declared(brand), ...declared(read('./theme.css')), ...declared(read('./styles.css'))]);
    for (const f of componentFiles) for (const d of declared(read(f))) defined.add(d);
    const used = new Map<string, string>();
    for (const f of ['./styles.css', './theme.css', ...componentFiles]) for (const m of read(f).matchAll(/var\((--pf-[\w-]+)\s*(,|\))/g)) if (!used.has(m[1]!)) used.set(m[1]!, f);
    const missing = [...used].filter(([n]) => !defined.has(n)).map(([n, f]) => `${n} (${f})`);
    // names with an inline fallback or set from script are listed by hand when they appear; the list must stay empty otherwise
    expect(missing.filter((x) => !/--pf-(vol|tl|clip-|ch-|gal-|pal-|dlg-)/.test(x))).toEqual([]);
  });

  it('names both sheets define keep their legacy value in the brand sheet and the spec value in the tokens', () => {
    expect(tokens).toMatch(/--pf-fs-sm:14px/);
    expect(brand).toMatch(/--pf-fs-sm: 12px/);
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
    // the design-system controls draw their own pressed / on state (chips, switches, the drawer's chip rows): each rule is more
    // specific than the generic one, so a legacy rule can never flatten it back to the plain toggle look
    const ds = pick(chrome, (s) => /\[aria-(pressed|checked)=["']true["']\]/.test(s));
    expect(ds.map((o) => o.selector)).toEqual(expect.arrayContaining([".pf-chip[aria-pressed='true']", ".pf-switch[aria-checked='true']"]));
    for (const o of ds.filter((o) => /aria-pressed/.test(o.selector))) expect(cmp(specificity(o.selector), specificity(generic.selector)), o.selector).toBeGreaterThan(0);
  });

  it('the top bar, the toolbar and the panels that hold dialogs create no stacking context, so a dialog opened from them is on top of the page', () => {
    const traps = ['z-index', 'opacity', 'transform', 'filter', 'backdrop-filter', 'perspective', 'clip-path', 'mask', 'isolation', 'mix-blend-mode', 'contain', 'will-change', 'container-type'];
    // the redesigned top bar is .pf-top (ds/chrome.css); the shell sheet names the panes as children of the grid (`.app > .pf-top`): held to the same list
    const bare = (s: string) => s.replace(/^\.app > /, '');
    const holders = pick([...all, ...chrome], (s) => ['.app', '.pf-top', '.library', '.inspector', '.tl-snap'].includes(bare(s)));
    expect(holders.some((h) => h.selector === '.pf-top' && h.rule.file === './ds/chrome.css')).toBe(true);
    for (const h of holders) for (const prop of traps) expect(h.rule.decls[prop], `${h.selector} { ${prop} } in ${h.rule.file}`).toBeUndefined();
    // the bar's own box and its direct children (the project name, the menus) are held to it too
    const bars = pick([...all, ...chrome], (s) => /^(\.app > )?\.pf-top( > \*)?$/.test(s) || /^\.timeline\.pf-ds \.tl-(bar|tools|view)$/.test(s));
    expect(bars.some((h) => h.selector === '.timeline.pf-ds .tl-bar')).toBe(true);
    for (const h of bars) for (const prop of traps) expect(h.rule.decls[prop], `${h.selector} { ${prop} } in ${h.rule.file}`).toBeUndefined();
    // what the dialogs must stay above; a control in the normal flow (the snap toggle, the add-track box) has no z-index and is the page's level 0
    const z = (sel: string) => Number(pick(all, (s) => s === sel).map((r) => r.rule.decls['z-index']).filter(Boolean).at(-1) ?? 0);
    for (const dialog of ['.pf-dlg-backdrop', '.pf-pal-backdrop', '.pf-gal-backdrop']) {
      expect(pick(all, (s) => s === dialog)[0]!.rule.decls.position, dialog).toBe('fixed');
      for (const under of ['.welcome', '.marker-bar', '.tl-snap', '.tl-add-track', '.clip-menu']) expect(z(dialog), `${dialog} over ${under}`).toBeGreaterThan(z(under));
    }
    // the snap toggle really is in the flow: no rule positions it above the page
    for (const r of pick(all, (s) => s === '.tl-snap' || s === '.tl-add-track')) expect(r.rule.decls['z-index'] === undefined || Number(r.rule.decls['z-index']) < z('.pf-dlg-backdrop'), r.selector).toBe(true);
  });

  it('the shell is one fixed grid the size of the window: the page cannot scroll and the top bar is one row that cannot grow', () => {
    const shell = parse('./ds/shell.css');
    const app = pick(shell, (s) => s === '.app');
    const decl = (prop: string) => winner(app, prop)?.rule.decls[prop];
    expect(decl('position')).toBe('fixed');
    expect(decl('inset')).toBe('0');
    expect(decl('block-size')).toBe('100dvh');
    expect(decl('overflow')).toBe('clip'); // not hidden: a clipped box cannot be scrolled by focus or scrollIntoView either
    expect(decl('display')).toBe('grid');
    // every area of the design is in the grid, and each pane is placed by the shell sheet alone
    const areas = decl('grid-template-areas')!;
    for (const area of ['top', 'err', 'rail', 'browser', 'stage', 'inspector', 'split', 'tl', 'status']) expect(areas, area).toMatch(new RegExp(`\\b${area}\\b`));
    const placed = Object.fromEntries(shell.flatMap((r) => r.selectors.filter((sel) => sel.startsWith('.app > ') && r.decls['grid-area']).map((sel) => [sel.slice(7), r.decls['grid-area']])));
    expect(placed).toEqual({ '.pf-top': 'top', '.error': 'err', "[data-shell-slot='rail']": 'rail', '.library': 'browser', '.stage': 'stage', '.inspector': 'inspector', "[data-shell-slot='splitter']": 'split', '.timeline': 'tl', "[data-shell-slot='status']": 'status' });
    const elsewhere = [...styles, ...components.filter((r) => r.file !== './ds/shell.css'), ...theme];
    expect(elsewhere.filter((r) => 'grid-area' in r.decls && r.selectors.some((sel) => ['.header', '.error', '.library', '.inspector', '.stage', '.timeline'].includes(sel))).map((r) => `${r.file}: ${r.selectors.join(', ')}`)).toEqual([]);
    expect(pick(elsewhere, (s) => s === '.app')).toEqual([]); // the grid rules left styles.css and theme.css
    // panes cannot be larger than their cell
    const panes = pick(shell, (s) => s === '.app > *')[0]!;
    expect(panes.rule.decls['min-block-size']).toBe('0');
    expect(panes.rule.decls['min-inline-size']).toBe('0');
    // the row of the top bar has a fixed height, and the bar itself never wraps; it does not scroll or clip (its dialog, the
    // list of flashing stretches and the glow of Export are drawn outside it)
    expect(decl('grid-template-rows')!.startsWith('var(--pf-shell-top) ')).toBe(true);
    expect(decl('--pf-shell-top')).toMatch(/^[\d.]+px$/);
    const bar = pick(chrome, (s) => s === '.pf-top');
    expect(winner(bar, 'flex-wrap')?.rule.decls['flex-wrap']).toBe('nowrap');
    for (const r of bar) for (const prop of ['overflow', 'overflow-x', 'overflow-y']) expect(r.rule.decls[prop], prop).toBeUndefined();
    // the bar's children are rigid (ds/chrome.css), and the shell sheet carries no rule about the bar's content at all: no legacy `.header` ladder
    expect(pick(chrome, (s) => s === '.pf-top > *')[0]!.rule.decls.flex).toBe('0 0 auto');
    expect(shell.filter((r) => r.selectors.some((sel) => /\.header\b|\.hd-label/.test(sel)))).toEqual([]);
    expect(shell.filter((r) => r.decls.flex && r.selectors.some((sel) => /\.primary|\.logo/.test(sel) && !/:not\([^)]*\.primary/.test(sel)))).toEqual([]);
    // the mounts that are still empty take no room; the App renders them in the grid
    const src = read('./App.tsx');
    for (const mount of ['<Rail />', '<Splitter />', '<StatusBar />']) expect(src, mount).toContain(mount);
    for (const slot of ['rail', 'splitter', 'status']) expect(read(`./editor/${{ rail: 'Rail', splitter: 'Splitter', status: 'StatusBar' }[slot]}.tsx`)).toContain(`data-shell-slot="${slot}"`);
    expect(pick(shell, (s) => s === '.app > [data-shell-slot]:empty')[0]!.rule.decls.display).toBe('none');
    // the timeline is a column: the bar above the tracks, and the tracks in the height that is left (they used to reach below the window)
    const tl = pick(components, (s) => s === '.timeline');
    expect(winner(tl, 'display')?.rule.decls.display).toBe('flex');
    expect(winner(tl, 'flex-direction')?.rule.decls['flex-direction']).toBe('column');
    const scroll = pick(components, (s) => s === '.tl-scroll');
    expect(winner(scroll, 'min-height')?.rule.decls['min-height']).toBe('0');
    for (const r of scroll) expect(r.rule.decls.height, '.tl-scroll { height }').toBeUndefined();
  });

  it('no child of the top bar takes its width from the bar: the field that edits the project name has a width of its own', () => {
    // Every child of the bar is rigid at its own width (`.pf-top > *`), and the bar never wraps. A child whose width is a share of
    // its container would be a share of the whole bar: the rename field (100% wide everywhere else, styles.css) was 1416px in a
    // 1440px window and pushed the menus, undo, redo and Export out of it.
    const header = read('./editor/Header.tsx');
    expect(header).toMatch(/<InlineRename [^>]*testid="project-rename"/);
    expect(read('./editor/InlineRename.tsx')).toMatch(/<input [^>]*className=\{`inline-rename-input /);
    expect(winner(pick(styles, (s) => s === '.inline-rename-input'), 'inline-size')?.rule.decls['inline-size']).toBe('100%'); // the legacy width, the one that must not win here
    const bar = pick([...all, ...chrome], (s) => s === '.pf-top');
    expect(winner(bar, 'display')?.rule.decls.display).toBe('flex');
    expect(winner(bar, 'flex-wrap')?.rule.decls['flex-wrap']).toBe('nowrap');
    for (const r of bar) for (const prop of ['overflow', 'overflow-x', 'overflow-y']) expect(r.rule.decls[prop], prop).toBeUndefined();
    expect(pick(chrome, (s) => s === '.pf-top > *')[0]!.rule.decls.flex).toBe('0 0 auto');
    // nothing that reaches a child of the bar gives it a width that is a share of the bar
    const inBar = (sel: string) => /^\.pf-top[ >]/.test(sel) || /^\.app > \.pf-top[ >]/.test(sel);
    for (const r of pick([...all, ...chrome], inBar)) for (const prop of ['inline-size', 'width']) if (prop in r.rule.decls) expect(r.rule.decls[prop], `${r.selector} { ${prop} }`).not.toMatch(/%|v[wi]\b|stretch|fill-available/);
    // the field: its own basis in rem to type in, one that can narrow, never smaller than a field one can still type in
    const field = pick(chrome, (s) => s === '.pf-top .inline-rename-input');
    expect(field.length).toBe(1);
    const [grow, shrink, basis] = field[0]!.rule.decls.flex!.split(/\s+/);
    expect(basis).toMatch(/^[\d.]+(rem|px|ch)$/);
    expect(Number(grow)).toBeLessThanOrEqual(1);
    expect(Number(shrink)).toBeGreaterThan(0);
    expect(field[0]!.rule.decls['min-inline-size']).toMatch(/^[1-9][\d.]*(rem|px|ch)$/);
    // the cell that holds the name is bounded as well, so a long name cannot push the rest of the bar out
    expect(pick(chrome, (s) => s === '.pf-top-id')[0]!.rule.decls['max-inline-size']).toMatch(/^[\d.]+(rem|px|ch)$/);
    // nothing after it in the sheets widens it again (theme.css is loaded last)
    expect(pick(theme, (s) => /inline-rename-input/.test(s))).toEqual([]);
  });

  it('what the preview draws above the stage is cut off at the stage edge, so the handles of an enlarged clip cannot lie over the header', () => {
    expect(componentFiles).toContain('./editor/interactions.css');
    // The handle box is not kept inside the preview (its size is the layer's: natural size × fit × scale) and its move
    // handle fills it. The header is positioned without a z-index (pinned above) and comes first in the page, so the box
    // would paint over it and take its clicks. The stage therefore clips what its children draw above and below it.
    const app = read('./App.tsx');
    expect(app.indexOf('<Header />')).toBeGreaterThan(-1);
    expect(app.indexOf('<Header />')).toBeLessThan(app.indexOf('className="stage"'));
    expect(app.indexOf('className="stage"')).toBeLessThan(app.indexOf('<CanvasHandles'));
    const stage = pick(all, (s) => s === '.stage');
    expect(winner(stage, 'overflow-y')?.rule.decls['overflow-y']).toBe('clip');
    // one axis only: sideways the handles stay in reach, and the stage does not turn into a scroll container
    for (const r of stage) for (const prop of ['overflow', 'overflow-x', 'overflow-block', 'overflow-inline']) expect(r.rule.decls[prop], `.stage { ${prop} } in ${r.rule.file}`).toBeUndefined();
    // the clip reaches the handles only while their containing blocks are inside the stage: absolute in the relative wrap, never fixed
    for (const sel of ['.ch-root', '.ch-box', '.ch-move', '.ch-handle']) {
      const rules = pick(all, (s) => s === sel);
      expect(winner(rules, 'position')?.rule.decls.position, sel).toBe('absolute');
    }
    expect(winner(pick(all, (s) => s === '.canvas-wrap'), 'position')?.rule.decls.position).toBe('relative');
    // nothing lets the handles out again: no rule puts them or the wrap in the top layer or gives them a z-index above the page
    for (const sel of ['.ch-root', '.ch-box', '.canvas-wrap', '.ch-clip']) for (const r of pick(all, (s) => s === sel)) expect(r.rule.decls['z-index'], sel).toBeUndefined();
  });

  it('the handles are cut off at the edge of the viewer, so an enlarged clip takes no clicks from the transport bar or the side panels', () => {
    // The transport bar is inside the stage (below the canvas wrap) and the side panels are beside it: the stage clip above
    // does not keep the handle box off them. The handles therefore live in a layer that covers the canvas wrap exactly and
    // clips what lies outside it; what is clipped is neither painted nor hit.
    const handles = read('./editor/CanvasHandles.tsx');
    const layer = handles.indexOf('className="ch-clip"');
    expect(layer).toBeGreaterThan(-1);
    // the handle root is inside that layer, in both the empty shell and the full overlay
    expect(handles.split('className="ch-clip"').length - 1).toBe(2);
    for (const part of handles.split('className="ch-clip"').slice(1)) expect(part.indexOf('className="ch-root"')).toBeGreaterThan(-1);
    const clip = pick(all, (s) => s === '.ch-clip');
    expect(winner(clip, 'position')?.rule.decls.position).toBe('absolute');
    expect(winner(clip, 'inset')?.rule.decls.inset).toBe('0');
    expect(winner(clip, 'overflow')?.rule.decls.overflow).toBe('clip'); // not hidden: no scroll container, so a focused handle outside cannot scroll it
    expect(winner(clip, 'pointer-events')?.rule.decls['pointer-events']).toBe('none'); // the layer itself takes no clicks; only the handles do
    for (const r of clip) for (const prop of ['overflow-x', 'overflow-y', 'overflow-inline', 'overflow-block']) expect(r.rule.decls[prop], `.ch-clip { ${prop} }`).toBeUndefined();
    // its containing block is the canvas wrap (relative, above), so `inset: 0` is the viewer
    expect(winner(pick(all, (s) => s === '.canvas-wrap'), 'position')?.rule.decls.position).toBe('relative');
    // the stand-ins at the edge are positioned inside the handle root, like the handles
    expect(winner(pick(all, (s) => s === '.ch-proxy'), 'position')?.rule.decls.position).toBe('absolute');
    expect(winner(pick(all, (s) => s === '.ch-proxy'), 'pointer-events')?.rule.decls['pointer-events']).toBe('auto');
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

  it('the zoom control costs the lanes no height: it sits at the end of the one-row toolbar, which never wraps and has a fixed height', () => {
    // UX_REDESIGN §4.7: the toolbar is one row of fixed height (tools, ride bar, then the ruler mode and the zoom at the end),
    // so the lanes get exactly the height that is left whatever the window width. The old layout had three tiers of zoom (whole /
    // short / own line) to keep a second line off the lanes; there is one form now.
    const tsx = read('./editor/Timeline.tsx');
    const bar = tsx.indexOf('className="tl-bar"');
    const view = tsx.indexOf('className="tl-view"');
    expect(bar).toBeGreaterThan(-1);
    expect(view).toBeGreaterThan(bar);
    expect(tsx.indexOf('<TimelineZoom', view)).toBeGreaterThan(view);
    expect(tsx.indexOf('<TimelineZoom', view)).toBeLessThan(tsx.indexOf('className="tl-scroll"')); // in the bar, above the lanes
    expect(tsx.indexOf('className="tl-ride-zone"')).toBeLessThan(view); // the zoom is the end of the row, after the ride bar
    const sheet = parse('./editor/timeline.css');
    const rows = pick(sheet, (s) => s === '.timeline.pf-ds .tl-bar');
    expect(rows.length).toBeGreaterThan(0);
    const all2 = (prop: string) => rows.filter((r) => prop in r.rule.decls);
    expect(winner(rows, 'display')?.rule.decls.display).toBe('flex');
    expect(winner(rows, 'flex')?.rule.decls.flex).toBe('none'); // the bar never takes lane height by growing
    expect(winner(rows, 'block-size')?.rule.decls['block-size']).toMatch(/^\d+px$/); // a fixed height
    // at no width does the bar wrap or change its height
    for (const r of rows) for (const prop of ['flex-wrap', 'height', 'min-height', 'min-block-size', 'max-block-size', 'max-height', 'flex-flow']) expect(r.rule.decls[prop] === undefined || r.rule.decls[prop] === 'nowrap', `${r.selector} { ${prop} } ${r.rule.media ?? ''}`).toBe(true);
    for (const r of all2('block-size')) expect(r.rule.decls['block-size'], r.rule.media ?? 'base').toBe(winner(rows, 'block-size')!.rule.decls['block-size']);
    // the groups inside it do not wrap either, and the zoom is one rigid group, not a second line
    for (const sel of ['.timeline.pf-ds .tl-tools', '.timeline.pf-ds .tl-view']) {
      const group = pick(sheet, (s) => s === sel);
      expect(winner(group, 'flex')?.rule.decls.flex, sel).toBe('none');
      for (const r of group) expect(r.rule.decls['flex-wrap'] ?? 'nowrap', sel).toBe('nowrap');
    }
    for (const r of pick([...sheet, ...parse('./editor/timelineZoom.css')], (s) => /\.tl-zoom$/.test(s))) expect(r.rule.decls['flex-wrap'] ?? 'nowrap').toBe('nowrap');
    // the lanes are the rest of the column
    expect(winner(pick(components, (s) => s === '.tl-scroll'), 'min-height')?.rule.decls['min-height']).toBe('0');
    // the three-tier form is gone: no hidden label or icon swapping between breakpoints
    expect(read('./editor/timelineZoom.css')).not.toMatch(/tl-zoom-fit-(label|ico)/);
    expect(read('./editor/TimelineZoom.tsx')).not.toMatch(/tl-zoom-fit-(label|ico)/);
  });
});
