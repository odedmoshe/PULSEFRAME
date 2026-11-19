/**
 * The event card's actions in the media drawer (lifeline.css, read as text: no layout engine here). «add the event», the
 * family film entry and the menu are wider together than the drawer, so the row must wrap and may shrink, or the card runs
 * out of the drawer and gives it a horizontal scroll (lifeline-ui proof, the drawer by event at 1440x900). No later rule on
 * the row may take the wrap away.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./lifeline.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const onActions = rules.filter((r) => r.sel.split(',').some((s) => /\.pf-ev-actions\s*$/.test(s.trim())));

describe('the event card actions fit the media drawer', () => {
  it('the actions row is a wrapping flex row that may shrink', () => {
    const base = onActions.find((r) => /display:\s*flex/.test(r.body));
    expect(base).toBeDefined();
    expect(base!.body).toMatch(/flex-wrap:\s*wrap/);
    expect(base!.body).toMatch(/min-inline-size:\s*0/);
  });
  it('no rule on the actions row turns the wrap off or forbids shrinking', () => {
    for (const r of onActions) {
      expect(r.body).not.toMatch(/flex-wrap:\s*nowrap|white-space:\s*nowrap|flex-shrink:\s*0|flex:\s*none/);
    }
  });
});
