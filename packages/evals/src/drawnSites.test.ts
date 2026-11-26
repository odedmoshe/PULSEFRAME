/**
 * Every site that branches on a title (`type === 'text'`, `type !== 'text'`, `kind === 'text'`, `kind !== 'text'`, `case 'text'`)
 * is decided for drawn clips (wave 8 carrier, core drawn.ts; tripmap-verify C1): drawnSites.allow.ts lists each by file and a
 * snippet around the match. A new site fails here until someone decides whether a drawing behaves like a title there, is skipped,
 * or needs its own branch; an entry that matches no site any more fails too (it was moved or removed: re-key or drop it).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAWN_SITES } from './drawnSites.allow.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SITE = /\b(type|kind)\s*[!=]==?\s*'text'|case 'text'/g;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite']);

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) files(join(dir, e.name), out); continue; }
    if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !e.name.includes('testKind') && e.name !== 'drawnSites.allow.ts') out.push(join(dir, e.name));
  }
  return out;
}
/** The same snippet the allow-list was made with: 28 characters before the match to 12 after, whitespace collapsed. */
const snippetOf = (line: string, at: number, len: number) => line.slice(Math.max(0, at - 28), Math.min(line.length, at + len + 12)).split(/\s+/).filter(Boolean).join(' ');

function sites() {
  const out: { file: string; line: number; snippet: string }[] = [];
  for (const top of ['packages', 'apps']) for (const pkg of readdirSync(join(ROOT, top))) {
    let src: string[];
    try { src = files(join(ROOT, top, pkg, 'src')); } catch { continue; }
    for (const p of src) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { for (const m of l.matchAll(SITE)) out.push({ file: relative(ROOT, p).split('\\').join('/'), line: i + 1, snippet: snippetOf(l, m.index!, m[0].length) }); });
  }
  return out;
}

describe('drawn clips: every title branch is decided', () => {
  it('each site is in the allow-list, and each entry still names a site', () => {
    const found = sites();
    const left = new Map<string, number>();
    for (const e of DRAWN_SITES) { const k = `${e.file}\n${e.snippet}`; left.set(k, (left.get(k) ?? 0) + 1); }
    const unclassified = found.filter((s) => { const k = `${s.file}\n${s.snippet}`; const n = left.get(k) ?? 0; if (n > 0) { left.set(k, n - 1); return false; } return true; });
    const stale = [...left].filter(([, n]) => n > 0).map(([k]) => k.replace('\n', ' :: '));
    expect(unclassified.map((s) => `${s.file}:${s.line} :: ${s.snippet}`), 'unclassified text-branch sites: decide each for drawn clips and add it to drawnSites.allow.ts').toEqual([]);
    expect(stale, 'allow-list entries that match no site any more').toEqual([]);
    expect(found.length).toBeGreaterThan(100);
  });
  it('every entry has a class and a reason', () => {
    for (const e of DRAWN_SITES) expect(e.note.length, `${e.file} ${e.snippet}`).toBeGreaterThan(3);
  });
});
