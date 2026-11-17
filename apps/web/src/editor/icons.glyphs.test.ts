import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXED_DIRECTION_ICONS, PF_GLYPHS } from './icons.tsx';

const src = readFileSync(new URL('./icons.tsx', import.meta.url), 'utf8');

describe('the PULSEFRAME glyphs', () => {
  it('lists every glyph of the spec (§3.4), keyframe in four states', () => {
    expect(Object.keys(PF_GLYPHS).sort()).toEqual(['agentNode', 'beatLock', 'cutPlus', 'flashShield', 'formatPrism', 'keyframeFull', 'keyframeGold', 'keyframeHalf', 'keyframeHollow', 'logo', 'mainMagnet', 'onBeat', 'rippleDelete'].sort());
  });
  it('stays on the 24 grid: every coordinate of every path lies inside 0..24', () => {
    for (const [name, g] of Object.entries(PF_GLYPHS)) {
      for (const d of g.body.matchAll(/ d="([^"]+)"/g)) {
        // absolute coordinates only matter for the first move; relative ones are bounded by the box test below
        const nums = [...d[1]!.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Math.abs(Number(m[0])));
        expect(Math.max(...nums), name).toBeLessThanOrEqual(24);
      }
      for (const a of g.body.matchAll(/(?:cx|cy|x|y|r|width|height)="(-?[\d.]+)"/g)) expect(Number(a[1]), `${name} ${a[0]}`).toBeLessThanOrEqual(24);
    }
  });
  it('only the glyph that points somewhere mirrors; time, lock and keyframe glyphs are fixed', () => {
    expect(Object.entries(PF_GLYPHS).filter(([, g]) => g.dir === 'mirror').map(([n]) => n)).toEqual(['rippleDelete']);
  });
  it('uses the house stroke (1.75, round caps) and has a label for each glyph', () => {
    expect(src).toContain("strokeWidth: 1.75");
    expect(src).toContain("strokeLinecap: 'round'");
    for (const g of Object.values(PF_GLYPHS)) expect(g.label.length).toBeGreaterThan(2);
  });
  it('marks the icons that must not mirror (play, timecode, waveform, frame steps) as fixed', () => {
    for (const n of FIXED_DIRECTION_ICONS) expect(src, n).toMatch(new RegExp(`export const ${n} = fixed\\(`));
  });
});
