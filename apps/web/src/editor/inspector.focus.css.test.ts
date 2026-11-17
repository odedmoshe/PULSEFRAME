/**
 * The visible focus of the inspector's sliders (spec §7). Reads inspector.css as text (no browser here): a focused range
 * carries the focus ring on the element itself (an outline, which every engine draws and the a11y audit reads), no later
 * rule takes it away, and the standing mixer faders, whose thumb shadow is set by a later rule of equal specificity, get a
 * focus thumb after it, in both the WebKit and the Gecko pseudo-elements.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./inspector.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, i) => ({ i, sel: m[1]!.trim(), body: m[2]! }));

describe('inspector sliders show their focus', () => {
  it('a focused range has an outline of the focus colour, and no later rule removes it', () => {
    const ring = rules.filter((r) => /input\[type='range'\]:focus-visible\s*$/.test(r.sel.split(',').pop()!) && /outline:\s*2px solid var\(--pf-focus\)/.test(r.body));
    expect(ring.length).toBeGreaterThan(0);
    const last = ring[ring.length - 1]!.i;
    const removed = rules.filter((r) => r.i > last && /range'\][^,{]*:focus(-visible)?\s*$/.test(r.sel) && /outline:\s*(none|0)\b/.test(r.body));
    expect(removed).toEqual([]);
  });
  it('the standing fader gets a focus thumb after the rule that sets its resting thumb', () => {
    const resting = rules.findLast((r) => /\.pf-vrange::-webkit-slider-thumb\s*$/.test(r.sel) && /box-shadow/.test(r.body))!;
    const focus = rules.find((r) => r.i > resting.i && /\.pf-vrange:focus-visible::-webkit-slider-thumb/.test(r.sel) && /var\(--pf-focus\)/.test(r.body));
    expect(focus).toBeDefined();
  });
  it('Firefox draws the focus thumb too', () => {
    expect(rules.some((r) => /:focus-visible::-moz-range-thumb/.test(r.sel) && /var\(--pf-focus\)/.test(r.body))).toBe(true);
  });
});
