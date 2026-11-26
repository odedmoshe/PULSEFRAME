/**
 * Built-in music is deterministic (ADR-0022, plan §9 M2 and M9):
 * - M2: the same request gives the same bytes, run after run, equal to the SHA-256 pinned in music.golden.json (8 bars,
 *   seed 1, per style). A change that gives other bytes is deliberate: it raises MUSIC_SYNTH_VERSION (core musicStyles.ts),
 *   which the golden file records, and the hashes are written again.
 * - M9: the render path (apps/server/src/music/) uses only + − × ÷, Math.floor/round/abs/min/max/imul, typed arrays and
 *   integer bit operations: no transcendental Math, no exponent operator, no clock, no randomness of the platform, no crypto,
 *   no ffmpeg or other process; music.ts defines no synthesis of its own.
 * The bytes are argued equal on every IEEE-754 machine from that arithmetic; they are proven equal on the machines this test
 * has run on (the owner's Windows laptop is the open check, docs/BLOCKERS.md).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MUSIC_STYLES, MUSIC_SYNTH_VERSION } from '@pulseframe/core';
import { renderMusic } from './music/render.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const golden = JSON.parse(fs.readFileSync(path.join(here, 'music.golden.json'), 'utf8')) as { synth: number; bars: number; seed: number; sha256: Record<string, string> };

describe('M2: the same request gives the same bytes', () => {
  it('the golden file is for this synthesiser and names every style', () => {
    expect(golden.synth).toBe(MUSIC_SYNTH_VERSION);
    expect(Object.keys(golden.sha256).sort()).toEqual(MUSIC_STYLES.map((s) => s.id).sort());
    expect([golden.bars, golden.seed]).toEqual([8, 1]);
  });
  it.each(MUSIC_STYLES.map((s) => s.id))('%s: 8 bars, seed 1, twice: equal bytes, equal to the golden hash', async (id) => {
    const a = await renderMusic(id, 8, 1);
    const b = await renderMusic(id, 8, 1);
    expect(a.wav.equals(b.wav)).toBe(true);
    expect(sha(a.wav)).toBe(golden.sha256[id]);
  }, 120_000);
});

/** The source without comments and string contents (so a comment that names Math.sin is not a use of it). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");
}
describe('M9: the render path is arithmetic only', () => {
  const dir = path.join(here, 'music');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  it('the folder holds the whole render path', () => {
    expect(files.sort()).toEqual(['arrange.ts', 'compose.ts', 'dsp.ts', 'render.ts', 'sampler.ts', 'styles.ts', 'voices.ts', 'wav.ts']);
  });
  it.each(files)('%s uses only the allowed Math functions and nothing that depends on the machine or the moment', (f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const src = code(raw);
    const maths = [...src.matchAll(/\bMath\.([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    for (const m of maths) expect(['floor', 'round', 'abs', 'min', 'max', 'imul'], `${f}: Math.${m}`).toContain(m);
    for (const banned of [/\*\*/, /\bDate\b/, /\brandom\b/i, /\bcrypto\b/, /\bperformance\b/, /\bhrtime\b/, /\bprocess\./, /\bchild_process\b/, /\bffmpeg\b/i, /\bFloat32Array\b/, /\bMath\s*\[/, /\bglobalThis\b/, /\beval\b/, /\bnew Function\b/])
      expect(banned.test(src), `${f}: ${banned}`).toBe(false);
    // imports: only the pure core package and the files beside it
    const imports = [...raw.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    for (const i of imports) expect(i === '@pulseframe/core' || /^\.\/[a-z]+\.ts$/.test(i), `${f} imports ${i}`).toBe(true);
  });
  it('music.ts only queues, validates, stores and commits: it makes no sample itself', () => {
    const src = code(fs.readFileSync(path.join(here, 'music.ts'), 'utf8'));
    expect(src).toMatch(/import \{[^}]*\brenderMusic\b[^}]*\} from ''/); // the import from './music/render.ts' (string blanked)
    for (const banned of [/\bFloat64Array\b/, /\bFloat32Array\b/, /\bInt16Array\b/, /\bsin01\b/, /\brenderNote\b/, /\bReverb\b/, /\bNoise\b/, /\bsetInt16\b/, /\bMath\.(sin|cos|exp|pow|log|sqrt)\b/])
      expect(banned.test(src), `music.ts: ${banned}`).toBe(false);
  });
});
