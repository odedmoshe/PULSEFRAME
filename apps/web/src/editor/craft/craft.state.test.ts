/**
 * Closing a craft surface gives the focus back in the same task, before the surface is gone (closeSurface). A focus() deferred to a
 * timer left the focus on the page body between the unmount and the timer, so a key typed then went to the page, not to the
 * timecode (craft proof U1, 2026-11-26). There is no DOM in the unit tests: the element is a stand-in with focus() and isConnected,
 * and the components are read as source; the craft proof's U1 checks the real focus in a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeSurface, craftSurface } from './craft.state.ts';

const el = (log: string[], isConnected = true) => ({ isConnected, focus: () => log.push(`focus while ${craftSurface.get() ? 'open' : 'closed'}`) }) as unknown as HTMLElement;

describe('closeSurface', () => {
  it('focuses the element synchronously, while the surface is still open, then closes it', () => {
    const log: string[] = [];
    craftSurface.set({ kind: 'time', target: 'goto' });
    const off = craftSurface.subscribe(() => log.push(`set ${craftSurface.get() === null ? 'null' : 'open'}`));
    closeSurface(el(log));
    off();
    expect(log).toEqual(['focus while open', 'set null']); // nothing left for a timer: the focus is back when close returns
    expect(craftSurface.get()).toBeNull();
  });
  it('closes without moving the focus when there is nothing (still) in the page to go back to', () => {
    const log: string[] = [];
    craftSurface.set({ kind: 'find' });
    closeSurface(el(log, false));
    closeSurface(null);
    expect(log).toEqual([]);
    expect(craftSurface.get()).toBeNull();
  });
  for (const file of ['TimeEntry.tsx', 'FindReplacePanel.tsx', 'SaveVersionField.tsx']) {
    it(`${file} closes through closeSurface, with no deferred focus`, () => {
      const code = fs.readFileSync(path.join(import.meta.dirname, file), 'utf8');
      const at = code.indexOf('const close = () =>');
      expect(at).toBeGreaterThan(0);
      const line = code.slice(at, code.indexOf('\n', at));
      expect(line).toMatch(/closeSurface\(/);
      expect(line).not.toMatch(/setTimeout|requestAnimationFrame/);
    });
  }
});
