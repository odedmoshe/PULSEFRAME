/**
 * No deferred focus anywhere in the web app (the defect class of 2026-11-26): a focus() given from setTimeout, requestAnimationFrame or
 * queueMicrotask leaves the focus on the page body for a moment (a key typed then goes to the page) or pulls it, late, from a field the
 * person had already moved to (one typed letter is lost). The patterns are craft.state.ts closeSurface (focus first, then close, in
 * one task), TemplateDialog's focusStep (the element drawn by the next render: an intent in a ref, given in a layout effect), and
 * ds/focus.ts. This reads every non-test source under apps/web/src, one-line and multi-line: a timer callback whose body calls
 * `.focus(` or a function named focus…( (focusNow, focusSequenceTab) is a finding unless the file is in ALLOWED with its reason.
 * No DOM here: the browser proofs check the real focus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const TIMER = /\b(?:setTimeout|requestAnimationFrame|queueMicrotask)\s*\(/g;
const FOCUS_CALL = /\.focus\s*\(|\bfocus\w*\s*\(/;

/** file (relative to apps/web/src) -> [how many timer calls are allowed, the reason a delay is needed and cannot lose a key]. */
export const ALLOWED: Record<string, [number, string]> = {
  'editor/SequenceSwitcher.tsx': [3, 'focusSequenceTab retries (one frame at a time, at most 20) until the sequence tab, drawn by the store after an async load or an active-sequence change, really holds the focus (a page made inert by a dialog refuses it); the three calls only start that retry loop'],
  'editor/ShortsPanel.tsx': [1, 'starts the same focusSequenceTab retry after the plan dialog closed: the new short\'s tab is drawn by editor.load, and the ds Dialog lifts the inert page in its own cleanup'],
};

/**
 * The code with comments, string literals, template literals and their interpolations blanked to spaces, line structure kept: what is
 * left is only code, so a `/*` inside 'video/*' or a bracket inside a string cannot mislead the scan below. Regular-expression
 * literals are not recognised (the cross-check test below would show a scan that went astray).
 */
export function codeOnly(src: string): string {
  const out: string[] = [];
  const blank = (c: string) => (c === '\n' ? '\n' : ' ');
  // the stack holds what we are inside: a template literal ('`') or an interpolation of one ('{' with its brace depth)
  const stack: Array<{ kind: '`' } | { kind: '{'; depth: number }> = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!, top = stack[stack.length - 1];
    if (top?.kind === '`') {
      if (c === '\\') { out.push(' ', blank(src[i + 1] ?? ' ')); i += 2; continue; }
      if (c === '`') { stack.pop(); out.push(' '); i++; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push({ kind: '{', depth: 0 }); out.push('  '); i += 2; continue; }
      out.push(blank(c)); i++; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') { out.push(' '); i++; } continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); const stop = end < 0 ? src.length : end + 2; for (; i < stop; i++) out.push(blank(src[i]!)); continue; }
    if (c === '"' || c === "'") { out.push(' '); i++; while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { out.push(' '); i++; } out.push(blank(src[i] ?? ' ')); i++; } out.push(' '); i++; continue; }
    if (c === '`') { stack.push({ kind: '`' }); out.push(' '); i++; continue; }
    if (top?.kind === '{') {
      if (c === '{') top.depth++;
      else if (c === '}') { if (top.depth === 0) { stack.pop(); out.push(' '); i++; continue; } top.depth--; }
    }
    out.push(c); i++;
  }
  return out.join('');
}

/** The text between the parenthesis at `open` and its match, in code already stripped by codeOnly. */
function argument(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
}

/** The 1-based lines of the outermost timer calls whose callback focuses something. */
export function deferredFocusLines(source: string): number[] {
  const code = codeOnly(source);
  const lines: number[] = [];
  let skipUntil = 0;
  for (const m of code.matchAll(TIMER)) {
    if (m.index < skipUntil) continue;
    const open = m.index + m[0].length - 1;
    const body = argument(code, open);
    if (!FOCUS_CALL.test(body)) continue;
    skipUntil = open + body.length;
    lines.push(code.slice(0, m.index).split('\n').length);
  }
  return lines;
}

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* sources(p); }
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.(test|spec)\.[tj]sx?$/.test(e.name)) yield p;
  }
}

describe('the scanner', () => {
  it('finds a one-line focus in a timer', () => { expect(deferredFocusLines('a();\nsetTimeout(() => el?.focus(), 0);')).toEqual([2]); });
  it('finds a focus on a later line of a multi-line callback, and a helper named focus…', () => {
    expect(deferredFocusLines('requestAnimationFrame(() => {\n  const x = 1;\n  y.focus({ preventScroll: true });\n});')).toEqual([1]);
    expect(deferredFocusLines('window.setTimeout(() => focusNow(el), 0)')).toEqual([1]);
    expect(deferredFocusLines('queueMicrotask(() => { el.focus(); })')).toEqual([1]);
  });
  it('counts a nested timer once, and ignores timers that do not focus, comments and strings', () => {
    expect(deferredFocusLines('requestAnimationFrame(() => { requestAnimationFrame(() => el.focus()); })')).toEqual([1]);
    expect(deferredFocusLines("setTimeout(() => { load('a)b'); }, 250);\n// setTimeout(() => el.focus(), 0)\n/* requestAnimationFrame(() => el.focus()) */")).toEqual([]);
    expect(deferredFocusLines("const accept = 'video/*,audio/*';\nsetTimeout(() => el.focus(), 0);\nconst x = `a ${b ? `c` : '}'} d`;")).toEqual([2]); // /* inside a string is not a comment
    expect(deferredFocusLines('const t = setTimeout(() => { root.unmount(); }, 0); el.focus();')).toEqual([]);
  });
});

describe('no deferred focus in apps/web/src', () => {
  const found = new Map<string, number[]>();
  for (const file of sources(SRC)) {
    const lines = deferredFocusLines(fs.readFileSync(file, 'utf8'));
    if (lines.length) found.set(path.relative(SRC, file).split(path.sep).join('/'), lines);
  }
  it('has none outside the allowlist, and the allowlist is exactly as long as what it excuses', () => {
    const unexpected = [...found].filter(([f, l]) => l.length !== (ALLOWED[f]?.[0] ?? 0)).map(([f, l]) => `${f}: lines ${l.join(', ')}${ALLOWED[f] ? ` (allowed ${ALLOWED[f]![0]})` : ''}`);
    const stale = Object.keys(ALLOWED).filter((f) => !found.has(f));
    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
  });
  it('finds, in every file, at least the files that the plain one-line search finds', () => {
    const plain = /(setTimeout|requestAnimationFrame|queueMicrotask)\(.*\.focus\(/;
    const missed: string[] = [];
    for (const file of sources(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const hits = fs.readFileSync(file, 'utf8').split('\n').filter((l) => plain.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
      if (hits.length && !found.has(rel)) missed.push(`${rel}: ${hits.length} line(s)`);
    }
    expect(missed).toEqual([]);
  });
  it('gives every allowed entry a reason', () => {
    for (const [f, [n, why]] of Object.entries(ALLOWED)) { expect(n, f).toBeGreaterThan(0); expect(why.length, f).toBeGreaterThan(30); }
  });
});
