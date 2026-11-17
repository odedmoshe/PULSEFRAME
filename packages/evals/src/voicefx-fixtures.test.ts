import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { goertzel, makeFxFixtures, onsets, readStereo, schroederRt60 } from './voicefx-fixtures.ts';

describe('sound-effect test signals and measurements', () => {
  it('fixtures: beeps every 2 s at 1 kHz, an impulse at 1 s, a mono 44.1 kHz file read as stereo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxfix-'));
    const f = await makeFxFixtures(dir);
    const beeps = readStereo(f.beeps);
    expect(beeps.length / 2).toBe(12 * 48000);
    expect(onsets(beeps, 48000).map((t) => Math.round(t * 100) / 100)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(goertzel(beeps, 0, 1000, 0, 48000, 0.05)).toBeGreaterThan(0.4);
    expect(goertzel(beeps, 0, 1000, 1, 48000, 0.05)).toBeLessThan(1e-3);
    const imp = readStereo(f.impulse);
    let at = -1; for (let i = 0; i < imp.length / 2; i++) if (Math.abs(imp[i * 2]!) > 0.5) { at = i; break; }
    expect(at).toBe(48000);
    const mono = readStereo(f.mono44k);
    expect(mono[2 * 100]).toBe(mono[2 * 100 + 1]);
    for (const k of ['sweep', 'speechLike'] as const) expect(fs.statSync(f[k]).size).toBeGreaterThan(48000);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('Schroeder T30 of an exponential decay recovers its RT60', () => {
    const sr = 48000;
    for (const rt of [0.5, 1.8, 3]) {
      const ir = new Float32Array(Math.round(rt * 1.5 * sr));
      let seed = 1;
      for (let i = 0; i < ir.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; ir[i] = ((seed / 2 ** 32) * 2 - 1) * 10 ** ((-3 * i) / (sr * rt)); }
      expect(Math.abs(schroederRt60(ir, sr) - rt) / rt).toBeLessThan(0.05);
    }
  });
});
