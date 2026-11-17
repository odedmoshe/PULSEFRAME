/** Regression tests for the ux-a review: global type rule, focus ring selector, on-plate contrast, RTL isolation of mixed tokens. */
import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contrast, readThemes } from './contrast.ts';
import { isolate } from './util.tsx';

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const prims = readFileSync(new URL('./primitives.css', import.meta.url), 'utf8');
const html = (n: unknown) => renderToStaticMarkup(createElement(Fragment, null, n as never));

describe('tokens.css global rules', () => {
  it('has no per-element font-size rule (it compounded per nesting level and shrank the legacy editor in English)', () => {
    const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/:lang\(en\)\s*\{[^}]*font-size/);
  });
});

describe('focus ring', () => {
  it('matches a focusable element that is itself a .pf-ds (Button, Chip, IconButton), not only descendants', () => {
    expect(prims).toMatch(/\.pf-ds:focus-visible\s*\{\s*outline: 2px solid var\(--pf-focus\)/);
  });
});

describe('foregrounds on --pf-plate', () => {
  const themes = readThemes(tokens);
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: on-plate colours are at least 4.5:1 on the plate over a dark and a bright image`, () => {
      const t = themes[theme];
      const plateA = 0.62; // --pf-plate is rgba(0,0,0,.62)
      for (const fg of ['--pf-on-plate', '--pf-on-plate-pulse']) {
        for (const img of [0, 176]) { // dark image and a bright one (pure white is outside the design range; plate alpha is the spec value)
          const v = Math.round(img * (1 - plateA)).toString(16).padStart(2, '0');
          expect(contrast(t[fg]!, `#${v}${v}${v}`), `${theme} ${fg} over ${img}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
  it('primitives use the on-plate tokens for the beat label, favourite star and held shield', () => {
    for (const sel of ['.pf-tile-beat', '.pf-tile-star', '.pf-tile-held']) {
      const rule = prims.split('\n').find((l) => l.startsWith(sel + ' {'))!;
      expect(rule, sel).toMatch(/color: var\(--pf-on-plate/);
    }
  });
});

describe('isolate (mixed tokens inside user text)', () => {
  it('wraps number-like runs in .num and the whole text in <bdi>', () => {
    expect(html(isolate('ייצוא 1080×1920'))).toBe('<bdi>ייצוא <bdi class="num">1080×1920</bdi></bdi>');
    expect(html(isolate('· 100% · רגיל'))).toBe('<bdi>· <bdi class="num">100%</bdi> · רגיל</bdi>');
    expect(html(isolate('Clip 12:30.5 a'))).toContain('<bdi class="num">12:30.5</bdi>');
  });
  it('leaves plain text alone', () => { expect(html(isolate('כתוביות'))).toBe('<bdi>כתוביות</bdi>'); });
});
