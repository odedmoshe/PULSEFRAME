/**
 * Token contrast (UX_REDESIGN §3.2 and §7). Reads ds/tokens.css as text and fails when any text/background pair the
 * spec names is below 4.5:1 (3:1 for large text and control edges), in EITHER theme.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, readBase, readThemes } from './contrast.ts';

const themes = readThemes(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'));
const SURFACES = ['canvas', 'surface-1', 'surface-2', 'surface-3', 'surface-4'] as const;
/** Text roles that sit on every surface step. */
const TEXT = ['text', 'text-2', 'text-3', 'frame', 'pulse', 'agent', 'danger', 'k-caption', 'ok', 'attention', 'info', 'neutral'] as const;
const MODE_TINTS = ['m-edit', 'm-look', 'm-sound', 'm-captions', 'm-deliver'] as const;
/** [foreground, background, minimum]: filled controls whose label sits on a fixed fill. */
const INKS: [string, string, number][] = [['frame-ink', 'frame', 4.5], ['pulse-ink', 'pulse', 4.5], ['on-danger', 'danger-fill', 4.5]];

for (const theme of ['dark', 'light'] as const) {
  const t = themes[theme];
  const c = (fg: string, bg: string) => contrast(t[`--pf-${fg}`]!, t[`--pf-${bg}`]!);
  describe(`token contrast, ${theme} theme`, () => {
    it('every colour the checks use is a solid hex token that exists', () => {
      for (const k of [...SURFACES, ...TEXT, ...MODE_TINTS, 'focus', 'line-control', ...INKS.flatMap(([a, b]) => [a, b])]) expect(t[`--pf-${k}`], k).toMatch(/^#[0-9a-f]{6}$/i);
    });
    for (const fg of TEXT) it(`${fg} is at least 4.5:1 on every surface`, () => {
      for (const bg of SURFACES) expect(c(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it('mode tints are at least 4.5:1 on surface-2 (active pill) and on the canvas', () => {
      for (const fg of MODE_TINTS) for (const bg of ['surface-2', 'canvas']) expect(c(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it('the label on a filled control is at least 4.5:1 on its fill', () => {
      for (const [fg, bg, min] of INKS) expect(c(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    });
    it('the focus ring is at least 3:1 on every surface', () => {
      for (const bg of SURFACES) expect(c('focus', bg), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
    });
    it('control edges (inputs, checkboxes) are at least 3:1 on the surfaces they sit on', () => {
      for (const bg of ['surface-1', 'surface-2']) expect(c('line-control', bg), `line-control on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  });
}

describe('token contrast, the spec numbers', () => {
  it('matches the table of the spec (rounded to one decimal)', () => {
    const d = themes.dark;
    const r = (fg: string, bg: string) => Math.round(contrast(d[`--pf-${fg}`]!, d[`--pf-${bg}`]!) * 10) / 10;
    expect(r('text-3', 'surface-4')).toBe(5.1);
    expect(r('text', 'canvas')).toBe(17.3);
    expect(r('frame-ink', 'frame')).toBe(10.9);
    expect(Math.round(contrast(d['--pf-line-control']!, d['--pf-surface-2']!) * 100) / 100).toBe(3.34);
  });
  it('the helper really fails a low pair', () => {
    expect(contrast('#777777', '#808080')).toBeLessThan(4.5);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

describe('primitives.css', () => {
  const css = readFileSync(new URL('./primitives.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('uses no literal colour: every colour is a token or a mix of tokens', () => {
    const body = css.replace(/var\([^)]*\)/g, '');
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(body.match(/\brgba?\(/g) ?? []).toEqual([]);
  });
  it('re-asserts, for the primitives, exactly the spec values of the names the legacy sheet also defines', () => {
    const t = readBase(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'));
    const scope = /\.pf-ds, \.pf-ds \* \{([^}]*)\}/.exec(css)![1]!;
    for (const name of ['--pf-r-sm', '--pf-r-md', '--pf-r-lg', '--pf-fs-sm', '--pf-fs-md', '--pf-fs-lg']) {
      expect(new RegExp(`${name}:\\s*${t[name]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`).test(scope), name).toBe(true);
    }
    expect(scope).toContain("'IBM Plex Sans Hebrew'");
  });
});
