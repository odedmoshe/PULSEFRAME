/**
 * The footage results fit the media drawer (search.css, read as text: no layout engine here). The design system's buttons never wrap
 * (primitives.css `.pf-btn { white-space: nowrap; block-size: … }`), and the results hold buttons whose words are wider than the drawer:
 * «Enter — לחפש גם לפי מה שרואים בתמונה» (274 px in a 228 px drawer at 1280 px; 307 px in English), «מחק את מפתח החיפוש בתמונה». Found
 * by pnpm proof:search U1 on the merged tree (the results scrolled sideways at 1280 and 1440 px). A button inside the results must wrap
 * its words, grow in height and never be wider than the results.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./search.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const onButtons = rules.filter((r) => r.sel.split(',').some((s) => /^\.pf-fs\s+\.pf-btn$/.test(s.trim())));

describe('the footage results fit the media drawer', () => {
  it('a button in the results wraps its words, grows in height and is never wider than the results', () => {
    const rule = onButtons.find((r) => /white-space:\s*normal/.test(r.body));
    expect(rule, '.pf-fs .pf-btn { white-space: normal; … }').toBeDefined();
    expect(rule!.body).toMatch(/block-size:\s*auto/);
    expect(rule!.body).toMatch(/max-inline-size:\s*100%/);
  });
  it('no rule in the results turns the wrap of a button off again', () => {
    for (const r of rules.filter((x) => /\.pf-btn/.test(x.sel))) expect(r.body).not.toMatch(/white-space:\s*nowrap/);
  });
});
