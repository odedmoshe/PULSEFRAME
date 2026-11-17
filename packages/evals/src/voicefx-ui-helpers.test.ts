/**
 * The browser-free parts of voicefx-ui-proof.ts. The fake locator below behaves as the installed Playwright (1.63.0) does:
 * `all()` is `new Array(await this.count()).fill(0).map((e, i) => this.nth(i))` (playwright-core lib/coreBundle.js), and an nth
 * locator is resolved again against the page each time it is used, so once a click makes an element stop matching, the later
 * indexes point past the end and the click waits until it times out.
 */
import { describe, expect, it } from 'vitest';
import { expandAll, type Clickables } from './voicefx-ui-helpers.ts';

/** Disclosure buttons, matched by `[aria-expanded=false]`; clicking one opens it (it then no longer matches). */
function collapsedButtons(n: number, opens = true) {
  const expanded = new Array<boolean>(n).fill(false);
  const matches = () => expanded.flatMap((e, i) => (e ? [] : [i]));
  const nth = (i: number) => ({
    async click() {
      const at = matches()[i];
      if (at === undefined) throw new Error(`locator.click: Timeout 30000ms exceeded, waiting for locator(...).nth(${i})`);
      if (opens) expanded[at] = true;
    },
  });
  const all = async () => Array.from({ length: matches().length }, (_, i) => nth(i));
  const loc: Clickables & { all: typeof all } = { count: async () => matches().length, first: () => nth(0), all };
  return { loc, expanded };
}

describe('expandAll: opening every collapsed settings panel', () => {
  it('(why) clicking each locator of all() in turn fails at nth(1) once the first has opened, as it did in the proof', async () => {
    const b = collapsedButtons(2);
    await expect((async () => { for (const x of await b.loc.all()) await x.click(); })()).rejects.toThrow(/nth\(1\)/);
  });
  it('opens all of them when there are two or more (the echo and telephone rows of the proof)', async () => {
    for (const n of [0, 1, 2, 5]) {
      const b = collapsedButtons(n);
      await expect(expandAll(b.loc)).resolves.toBe(0);
      expect(b.expanded.every(Boolean)).toBe(true);
    }
  });
  it('a button that does not open is reported (still matching), and the loop ends', async () => {
    const b = collapsedButtons(3, false);
    await expect(expandAll(b.loc)).resolves.toBe(3);
  });
});

