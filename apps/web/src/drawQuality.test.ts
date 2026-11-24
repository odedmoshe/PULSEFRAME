/**
 * Which picture each view asks drawGraph for (ADR-0005 amendment of 2026-11-24). Draft (faded pictures and dissolves without
 * their exact fills) is for playback only; stills, export and the paused preview are the full picture, identical to each other.
 *
 * The render page and the in-tab export are browser entry pages (they start drawing on load), so they are not imported here:
 * this is a STATIC CHECK of their source, every drawGraph call in them. The player's choice is tested on the real Player in
 * player.multicam.test.ts ('drawGraph gets the same quality').
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => fs.readFileSync(path.join(import.meta.dirname, f), 'utf8');
/** The text of every drawGraph(...) call in a source file, up to its closing parenthesis. */
function calls(text: string): string[] {
  const out: string[] = [];
  for (let i = text.indexOf('drawGraph('); i >= 0; i = text.indexOf('drawGraph(', i + 1)) {
    if (/import|function /.test(text.slice(Math.max(0, i - 40), i))) continue;
    let depth = 0, j = i + 'drawGraph'.length;
    for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')' && --depth === 0) break; }
    out.push(text.slice(i, j + 1));
  }
  return out;
}

describe('the quality each view draws with', () => {
  it('stills and export frames (the render page) and the in-tab export ask for the full picture', () => {
    for (const f of ['render.ts', 'browserExport.ts']) {
      const c = calls(src(f));
      expect(c.length, f).toBeGreaterThan(0);
      for (const call of c) expect(call, f).toContain("{ quality: 'full' }");
    }
  });
  it('only the player asks for draft (besides the lab\'s diagnostics), and only by its pictureQuality() rule', () => {
    const files = fs.readdirSync(import.meta.dirname, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    const askDraft = files.filter((f) => calls(src(f)).some((c) => c.includes('quality') && !c.includes("{ quality: 'full' }")));
    // and the lab page, a diagnostics page that conformance:opacity drives to draw both qualities (lab.html?bench=opacity)
    expect(askDraft.sort()).toEqual(['lab.ts', 'player.ts']);
    const [call] = calls(src('player.ts'));
    expect(call).toContain("{ quality: draft ? 'draft' : 'full' }");
    expect(src('player.ts')).toContain("const draft = this.pictureQuality() === 'draft';");
  });
});
