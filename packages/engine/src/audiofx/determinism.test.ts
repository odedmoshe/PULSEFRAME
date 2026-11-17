/**
 * Static scan of the sound-effect code (ADR-0010 D6): every route must compute the same samples, so the runtime code in
 * audiofx/ uses no clocks or random sources, and transcendental Math.* only in design.ts and tables.ts (once per instance or
 * at load, never per sample). Comments and string literals are ignored; test files are not runtime code and are not scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = import.meta.dirname;
const DESIGN_TIME = new Set(['design.ts', 'tables.ts']);
const TRANSCENDENTAL = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/;
/** A power whose exponent is not an integer literal is Math.pow by another name. */
const NON_LITERAL_POWER = /\*\*(?!\s*-?\d+(?![.\d]))/;
const NONDETERMINISTIC: [RegExp, string][] = [[/\bMath\.random\b/, 'Math.random'], [/\bDate\b/, 'Date'], [/\bperformance\b/, 'performance'], [/\bcrypto\b/, 'crypto']];

function files(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path.join(d, e.name)] : []));
}
/** Source with comments and string/template literals blanked out (line structure kept, for line numbers). */
export function codeOnly(src: string): string {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') { i += 2; out += '  '; continue; } out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
function findings(file: string): string[] {
  const rel = path.relative(dir, file), lines = codeOnly(fs.readFileSync(file, 'utf8')).split('\n'), out: string[] = [];
  lines.forEach((line, k) => {
    for (const [re, name] of NONDETERMINISTIC) if (re.test(line)) out.push(`${rel}:${k + 1} uses ${name}`);
    if (!DESIGN_TIME.has(path.basename(file))) {
      const m = TRANSCENDENTAL.exec(line);
      if (m) out.push(`${rel}:${k + 1} calls ${m[0]} outside design.ts/tables.ts`);
      if (NON_LITERAL_POWER.test(line)) out.push(`${rel}:${k + 1} raises to a non-literal power outside design.ts/tables.ts`);
    }
  });
  return out;
}

describe('sound-effect determinism scan (ADR-0010 D6)', () => {
  it('scans the kernels and the shared code', () => {
    const names = files(dir).map((f) => path.relative(dir, f));
    for (const f of ['design.ts', 'tables.ts', 'noise.ts', 'kernels/index.ts', 'kernels/reverb.ts']) expect(names).toContain(f);
  });
  it('no clocks, no random sources, and transcendental Math only in design.ts and tables.ts', () => {
    expect(files(dir).flatMap(findings)).toEqual([]);
  });
  it('the scan itself catches what it should and ignores comments and strings', () => {
    const probe = (src: string) => { const lines = codeOnly(src).split('\n'); return lines.some((l) => TRANSCENDENTAL.test(l) || NON_LITERAL_POWER.test(l) || NONDETERMINISTIC.some(([re]) => re.test(l))); };
    expect(probe('const y = Math.sin(x);')).toBe(true);
    expect(probe('const g = 10 ** (db / 20);')).toBe(true);
    expect(probe('const r = Math.random();')).toBe(true);
    expect(probe('const t = performance.now();')).toBe(true);
    expect(probe('// Math.sin and performance are fine in a comment\nconst e = 2 ** -24, s = x ** 2;')).toBe(false);
    expect(probe("const s = 'Math.exp(Date)';")).toBe(false);
  });
});
