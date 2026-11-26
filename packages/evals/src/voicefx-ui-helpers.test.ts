/**
 * The browser-free parts of voicefx-ui-proof.ts. The fake locator below behaves as the installed Playwright (1.63.0) does:
 * `all()` is `new Array(await this.count()).fill(0).map((e, i) => this.nth(i))` (playwright-core lib/coreBundle.js), and an nth
 * locator is resolved again against the page each time it is used, so once a click makes an element stop matching, the later
 * indexes point past the end and the click waits until it times out.
 */
import { describe, expect, it } from 'vitest';
import { expandAll, inReadingOrder, type ChipBox, type Clickables } from './voicefx-ui-helpers.ts';

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

/** Chip boxes from left edges and lines (line 0 or 1, 24 px high, 6 px apart); each chip is 30–48 px wide. */
const box = (value: string, left: number, width: number, line: number): ChipBox => ({ value, left, right: left + width, top: 100 + line * 30, bottom: 124 + line * 30 });

describe('inReadingOrder: the chip strip in the order it is read', () => {
  // What the proof measured in a 300 px wide inspector at 1500×950: every chip carries its ▶, so radio and robot wrap onto a
  // second line, which starts again at the right.
  const wrapped = [box('none', 270, 30, 0), box('voice.telephone', 182, 48, 0), box('voice.megaphone', 95, 48, 0), box('voice.radio', 272, 28, 1), box('voice.robot', 185, 48, 1)];
  it('right to left, wrapped onto two lines: each next chip lies to the left of the one before on its line, or starts the next line', () => {
    expect(inReadingOrder(wrapped, true)).toBe(true);
    expect(inReadingOrder(wrapped.slice(0, 3), true)).toBe(true);
  });
  it('left to right (English), wrapped: mirrored', () => {
    const ltr = [box('none', 0, 30, 0), box('a', 70, 48, 0), box('b', 160, 48, 0), box('c', 0, 28, 1), box('d', 70, 48, 1)];
    expect(inReadingOrder(ltr, false)).toBe(true);
    expect(inReadingOrder(ltr, true)).toBe(false);
  });
  it('out of reading order: two chips swapped on a line, a line laid out the other way, a chip back on an earlier line, overlapping chips', () => {
    expect(inReadingOrder([wrapped[1]!, wrapped[0]!, ...wrapped.slice(2)], true)).toBe(false);
    expect(inReadingOrder([box('none', 95, 30, 0), box('t', 182, 48, 0), box('m', 270, 30, 0)], true)).toBe(false);
    expect(inReadingOrder([wrapped[0]!, wrapped[3]!, wrapped[1]!], true)).toBe(false);
    expect(inReadingOrder([box('none', 270, 30, 0), box('t', 250, 48, 0)], true)).toBe(false);
  });
});
