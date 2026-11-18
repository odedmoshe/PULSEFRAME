/**
 * The stage in the light theme (UX_REDESIGN §3.2, §7): the viewer surround stays dark (--pf-stage), so the text, accents and
 * controls on it must come from the dark side, or they are dark on dark. Reads tokens.css and stage.css as text (no browser
 * here), resolves the light theme plus stage.css's override for the stage (var() and color-mix in srgb), and holds every
 * pair to the token test's limits: text and accents 4.5:1 on the stage and on its control surfaces, focus 3:1, inks 4.5:1.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { luminance, parseDecls, readThemes, type Rgb } from '../ds/contrast.ts';

const light = readThemes(readFileSync(new URL('../ds/tokens.css', import.meta.url), 'utf8')).light;
const stageCss = readFileSync(new URL('./stage.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const head = /:root\[data-theme='light'\]\s*:is\(\.app > \.stage, \.pf-force-dark\)\s*\{/.exec(stageCss);
const over = head ? parseDecls(stageCss.slice(head.index + head[0].length, stageCss.indexOf('}', head.index))) : {};

type Rgba = [number, number, number, number];
function resolve(value: string, depth = 0): Rgba {
  if (depth > 8) throw new Error(`too deep: ${value}`);
  const v = value.trim();
  if (v === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return resolve(over[ref[1]!] ?? light[ref[1]!] ?? '', depth + 1);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = resolve(mix[1]!, depth + 1), b = resolve(mix[3]!, depth + 1), p = Number(mix[2]) / 100;
    const alpha = a[3] * p + b[3] * (1 - p);
    if (alpha === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (a[i]! * a[3] * p + b[i]! * b[3] * (1 - p)) / alpha).concat(alpha) as Rgba;
  }
  throw new Error(`cannot resolve ${v}`);
}
const on = (fg: Rgba, bg: Rgb): Rgb => [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])) as Rgb;
const stage = on(resolve('var(--pf-stage)'), [0, 0, 0]);
const ratio = (fg: string, bg: string) => {
  const b = on(resolve(`var(--pf-${bg})`), stage), f = on(resolve(`var(--pf-${fg})`), b);
  const la = luminance(f), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

describe('the stage in the light theme', () => {
  it('stage.css re-applies the dark side under :root[data-theme=light] for the stage and every .pf-force-dark root', () => {
    expect(head).not.toBeNull();
  });
  const SURFACES = ['stage', 'surface-1', 'surface-2', 'surface-3', 'surface-4'];
  for (const fg of ['text', 'text-2', 'text-3', 'frame', 'pulse', 'ok', 'attention', 'danger']) {
    it(`${fg} is at least 4.5:1 on the stage and on the control surfaces over it`, () => {
      for (const bg of SURFACES) expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the focus ring is at least 3:1, the inks at least 4.5:1 on their fills', () => {
    for (const bg of SURFACES) expect(ratio('focus', bg), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
    expect(ratio('frame-ink', 'frame')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('pulse-ink', 'pulse')).toBeGreaterThanOrEqual(4.5);
  });
});
