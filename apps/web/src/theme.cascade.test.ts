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
    // the header keeps its flat buttons (the pause toggle there has its own .paused look): same weight, declared later
    const header = pick(theme, (s) => s === '.header button')[0]!;
    expect(cmp(specificity(header.selector), specificity(generic.selector))).toBe(0);
    expect(header.rule.order).toBeGreaterThan(generic.rule.order);
  });

  it('the header and the panels that hold dialogs create no stacking context, so a dialog opened from them is on top of the page', () => {
    const traps = ['z-index', 'opacity', 'transform', 'filter', 'backdrop-filter', 'perspective', 'clip-path', 'mask', 'isolation', 'mix-blend-mode', 'contain', 'will-change', 'container-type'];
    // the shell sheet names the panes as children of the grid (`.app > .header`): those rules are held to the same list
    const holders = pick(all, (s) => ['.app', '.header', '.library', '.inspector'].includes(s.replace(/^\.app > /, '')));
    expect(holders.some((h) => h.selector === '.header' && h.rule.file === './theme.css')).toBe(true);
    for (const h of holders) for (const prop of traps) expect(h.rule.decls[prop], `${h.selector} { ${prop} } in ${h.rule.file}`).toBeUndefined();
    // what the dialogs must stay above
    const z = (sel: string) => Number(pick(all, (s) => s === sel).map((r) => r.rule.decls['z-index']).filter(Boolean).at(-1));
    for (const dialog of ['.pf-dlg-backdrop', '.pf-pal-backdrop', '.pf-gal-backdrop']) {
      expect(pick(all, (s) => s === dialog)[0]!.rule.decls.position, dialog).toBe('fixed');
      for (const under of ['.welcome', '.marker-bar', '.tl-snap', '.tl-add-track', '.clip-menu']) expect(z(dialog), `${dialog} over ${under}`).toBeGreaterThan(z(under));
    }
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
    expect(placed).toEqual({ '.header': 'top', '.error': 'err', "[data-shell-slot='rail']": 'rail', '.library': 'browser', '.stage': 'stage', '.inspector': 'inspector', "[data-shell-slot='splitter']": 'split', '.timeline': 'tl', "[data-shell-slot='status']": 'status' });
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
    const bar = pick(shell, (s) => s === '.app > .header');
    expect(winner(bar, 'flex-wrap')?.rule.decls['flex-wrap']).toBe('nowrap');
    for (const r of bar) for (const prop of ['overflow', 'overflow-x', 'overflow-y']) expect(r.rule.decls[prop], prop).toBeUndefined();
    // Export and the logo never narrow: everything in the bar is rigid unless a later rule lets it give way, and none names .primary or .logo
    expect(pick(shell, (s) => s === '.app > .header > *')[0]!.rule.decls.flex).toBe('0 0 auto');
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
    // Every child of the bar is rigid at its own width unless a shell rule lets it give way (pinned above). A child whose
    // width is a share of its container is then a share of the whole bar: the rename field (100% wide everywhere else) was
    // 1416px in a 1440px window and pushed the selects, undo, redo and Export out of it.
    expect(read('./editor/Header.tsx')).toMatch(/<InlineRename [^>]*testid="project-rename"/);
    expect(read('./editor/InlineRename.tsx')).toMatch(/<input [^>]*className=\{`inline-rename-input /);
    expect(winner(pick(styles, (s) => s === '.inline-rename-input'), 'inline-size')?.rule.decls['inline-size']).toBe('100%');
    // the classes the direct children of <header> carry (Header.tsx, InlineRename.tsx), and the rules that can reach such a child
    const childClasses = ['logo', 'brand', 'title', 'inline-rename-btn', 'inline-rename-input', 'track-btn', 'format-switch', 'format-badge', 'check', 'format-safe', 'spacer', 'save', 'warn', 'rev', 'ghost', 'paused', 'danger', 'export-finished', 'flash-result', 'primary'];
    const header = read('./editor/Header.tsx');
    for (const c of ['logo', 'brand', 'title', 'format-switch', 'format-badge', 'check format-safe', 'spacer', 'rev', 'primary', 'flash-result']) expect(header, c).toContain(`className="${c}"`);
    const compounds = (sel: string) => sel.split(/\s*>\s*|\s+/).filter(Boolean);
    const reaches = (sel: string, cls: string) => {
      const parts = compounds(sel), last = parts.at(-1)!;
      if (!parts.slice(0, -1).every((p) => ['.app', '.header', 'header'].includes(p))) return false; // scoped to another container
      const base = last.replace(/:(?:not|is|where)\([^)]*\)|::?[\w-]+|\[[^\]]*\]/g, '');
      const named = [...base.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
      return named.length ? named.includes(cls) && named.every((n) => childClasses.includes(n)) : /^(\*|button|a|input|span|strong|label|details)$/.test(base);
    };
    const widthOf = (cls: string) => {
      const rules = pick(all, (s) => reaches(s, cls)).flatMap((r) => (['inline-size', 'width'] as const).filter((p) => p in r.rule.decls).map((p) => ({ ...r, value: r.rule.decls[p]! })));
      return rules.sort((a, b) => cmp(specificity(a.selector), specificity(b.selector)) || a.rule.order - b.rule.order).at(-1)?.value ?? 'auto';
    };
    for (const cls of childClasses) expect(widthOf(cls), `.header > .${cls} { inline-size }`).not.toMatch(/%|v[wi]\b|stretch|fill-available/);
    // the field: 12rem to type in, not growing, and narrowing in the same step as the project name it edits
    expect(widthOf('inline-rename-input')).toBe('auto');
    const shell = parse('./ds/shell.css');
    const field = pick(shell, (s) => s === '.app > .header > .inline-rename-input');
    expect(field.length).toBe(1);
    const [grow, shrink, basis] = field[0]!.rule.decls.flex!.split(/\s+/);
    expect(grow).toBe('0');
    expect(basis).toMatch(/^[\d.]+(rem|px|ch)$/);
    const step = pick(shell, (s) => s === '.app > .header > :is(.title, .format-safe, .format-switch)')[0]!.rule.decls.flex!.split(/\s+/)[1];
    expect(Number(shrink)).toBeGreaterThan(0);
    expect(shrink).toBe(step);
    expect(field[0]!.rule.decls['min-inline-size']).toMatch(/^[1-9][\d.]*(rem|px|ch)$/); // still a field one can type in when the bar is at its narrowest
    // nothing after it in the sheets widens it again (theme.css is loaded last)
    expect(pick(theme, (s) => /inline-rename-input/.test(s) && compounds(s).slice(0, -1).every((p) => ['.app', '.header'].includes(p)))).toEqual([]);
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

  it('the zoom control costs the tracks no height where it can share the clip actions line, and pushes nothing under the pinned controls from 1024 to 1920px', () => {
    const sheet = parse('./editor/timelineZoom.css');
    const px = (media: string | null, edge: 'min' | 'max') => Number(new RegExp(`${edge}-width:\\s*([\\d.]+)px`).exec(media ?? '')?.[1] ?? NaN);
    // the three forms, read from the sheet
    const inline = sheet.filter((r) => r.selectors.includes('.tl-zoom') && r.decls.display === 'inline-flex');
    expect(inline.length).toBe(1);
    const inlineFrom = px(inline[0]!.media, 'min');
    const short = sheet.filter((r) => r.selectors.includes('.tl-zoom-slider') && r.decls.display === 'none');
    expect(short.length).toBe(1);
    expect(short[0]!.selectors).toContain('.tl-zoom-fit-label');
    expect(px(short[0]!.media, 'min')).toBe(inlineFrom); // the short form starts where the control joins the clip actions line
    const wholeFrom = Math.ceil(px(short[0]!.media, 'max'));
    expect(wholeFrom).toBeGreaterThan(inlineFrom);
    // Fit always shows something: the icon exactly where the label is hidden, and nowhere else
    const icon = sheet.filter((r) => r.selectors.includes('.tl-zoom-fit-ico'));
    expect(icon.map((r) => [r.media, r.decls.display])).toEqual([[null, 'none'], [short[0]!.media, 'block']]);
    const tsx = read('./editor/TimelineZoom.tsx');
    expect(tsx).toMatch(/data-testid="tl-zoom-fit" aria-label=\{s\.fit\}/); // named by its label at every width
    expect(tsx).toContain('className="tl-zoom-fit-ico"');
    expect(tsx).toContain('className="tl-zoom-fit-label"');

    // Widths in px. MEASURED, not live: read off a 1280px screenshot of the Hebrew editor (the 3ad2e49 build:
    // clip actions 12-425, zoom 507-751, add-track box 827-1030) and reproduced from the Heebo advance widths, which also
    // give the English labels and the marker bar. Hebrew has the widest Fit label, English the widest marker bar.
    const BTN = 28, GAP = 4, SLIDER = 100, MARGIN = 12, ROOM = 8;
    const FIT = { he: 77, en: 27 }, ACTIONS = { he: 414, en: 416 }, MARKER_BAR = { he: 388, en: 427 };
    const addTrackFrom = (w: number) => w - 250 - 203, markerBarFrom = (w: number, lang: 'he' | 'en') => w - 200 - MARKER_BAR[lang];
    const tiers = new Set<string>();
    for (const lang of ['he', 'en'] as const) for (let w = 1024; w <= 1920; w++) {
      const tier = w < inlineFrom ? 'own line' : w < wholeFrom ? 'short' : 'whole';
      tiers.add(tier);
      const zoomEnd = MARGIN + (tier === 'short' ? 3 * BTN + 2 * GAP : 2 * BTN + SLIDER + FIT[lang] + 3 * GAP);
      const pinned = Math.min(addTrackFrom(w), markerBarFrom(w, lang)); // both sit on the bar's first line, where the zoom always is
      expect(zoomEnd + ROOM, `zoom, ${lang} ${w}px (${tier})`).toBeLessThanOrEqual(pinned);
      if (tier === 'own line') continue; // the clip actions are where they were before the zoom control existed
      expect(zoomEnd + MARGIN + ACTIONS[lang] + ROOM, `clip actions, ${lang} ${w}px (${tier})`).toBeLessThanOrEqual(pinned);
    }
    expect([...tiers].sort()).toEqual(['own line', 'short', 'whole']);
    // the common laptop width keeps the bar on one line (at 1280x720 a second line cut the bottom track of four)
    expect(inlineFrom).toBeLessThanOrEqual(1280);
  });
});
