/**
 * Contrast of the colour pairs the pack and font components use (packs.css, fontPicker.css): 4.5:1 for text in both themes, with the
 * translucent fills (…-soft) laid over the surface they sit on. Reads ds/tokens.css as text, as ds/tokens.contrast.test.ts does.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, readThemes } from '../ds/contrast.ts';

const themes = readThemes(readFileSync(new URL('../ds/tokens.css', import.meta.url), 'utf8'));
const toHex = (n: number[]) => `#${n.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `rgba(r,g,b,a)` laid over a solid hex, as the hex it looks like. */
function over(fill: string, ground: string): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(fill);
  if (!m) return fill;
  const a = Number(m[4]), g = rgb(ground);
  return toHex([0, 1, 2].map((i) => Number(m[i + 1]) * a + g[i]! * (1 - a)));
}
/** [text, fill token or null (plain surface), surfaces it sits on] */
const PAIRS: [string, string | null, string[]][] = [
  ['text', null, ['surface-1', 'surface-2', 'surface-3']],
  ['text-2', null, ['surface-1', 'surface-2', 'surface-3']],
  ['text-3', null, ['surface-1', 'surface-2']],
  ['pulse', 'pulse-soft', ['surface-1', 'surface-2']],
  ['frame', 'frame-soft', ['surface-1', 'surface-2']],
  ['danger', 'danger-soft', ['surface-1', 'surface-2']],
];
for (const theme of ['dark', 'light'] as const) {
  const t = themes[theme];
  describe(`pack and font components, ${theme} theme`, () => {
    for (const [fg, fill, surfaces] of PAIRS) for (const s of surfaces) {
      it(`${fg}${fill ? ` on ${fill}` : ''} over ${s} is at least 4.5:1`, () => {
        const ground = t[`--pf-${s}`]!;
        const bg = fill ? over(t[`--pf-${fill}`]!, ground) : ground;
        expect(contrast(t[`--pf-${fg}`]!, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it('the badge «ניקוד נבדק» (ok on its tint) reads at 4.5:1', () => {
      expect(contrast(t['--pf-ok']!, t['--pf-surface-3']!)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
