import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SFX, sfxFfmpegArgs } from './sfx.ts';

const exec = promisify(execFile);
const CATEGORIES = ['ui', 'whoosh', 'impact', 'riser', 'glitch', 'notify', 'cartoon', 'ambience', 'drum', 'tone'];
const ORIGINAL_GRAPHS: Record<string, string> = {
  'sfx.click': "aevalsrc=0.8*sin(2*PI*2000*t)*exp(-200*t):s=48000:d=0.05",
  'sfx.pop': "aevalsrc=0.8*sin(2*PI*(700-1800*t)*t)*exp(-25*t):s=48000:d=0.15",
  'sfx.beep': "aevalsrc=0.5*sin(2*PI*1000*t):s=48000:d=0.2,afade=t=in:d=0.005,afade=t=out:st=0.195:d=0.005",
  'sfx.ding': "aevalsrc=0.5*sin(2*PI*1320*t)*exp(-6*t)+0.25*sin(2*PI*2640*t)*exp(-9*t):s=48000:d=1.2",
  'sfx.impact': "aevalsrc=0.9*sin(2*PI*(95-55*t)*t)*exp(-5*t):s=48000:d=0.9",
  'sfx.whoosh': 'anoisesrc=c=pink:r=48000:a=0.8:seed=11:d=0.6,highpass=f=300,afade=t=in:d=0.25:curve=qsin,afade=t=out:st=0.25:d=0.35:curve=qsin',
  'sfx.riser': 'anoisesrc=c=white:r=48000:a=0.5:seed=7:d=1.5,highpass=f=900,afade=t=in:d=1.45:curve=cub,afade=t=out:st=1.47:d=0.03',
};
// aevalsrc entries escape commas as "\,"
for (const k of Object.keys(ORIGINAL_GRAPHS)) if (ORIGINAL_GRAPHS[k]!.startsWith('aevalsrc=')) ORIGINAL_GRAPHS[k] = ORIGINAL_GRAPHS[k]!.replace(/^(aevalsrc=[^:]*):/, (_m, e: string) => `${e.replaceAll(',', '\\,')}:`);

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-test-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function render(graph: string, name: string): Promise<Buffer> {
  const out = path.join(dir, name);
  await exec('ffmpeg', sfxFfmpegArgs(graph, out), { timeout: 30_000 });
  return fs.readFileSync(out);
}
function analyse(wav: Buffer) {
  let off = 12; let channels = 0; let rate = 0; let data: Uint8Array = new Uint8Array(0);
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4); const size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = wav.readUInt16LE(off + 10); rate = wav.readUInt32LE(off + 12); }
    if (id === 'data') { data = wav.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size & 1);
  }
  let peak = 0;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i + 1 < data.length; i += 2) peak = Math.max(peak, Math.abs(dv.getInt16(i, true)));
  return { rate, seconds: data.length / 2 / channels / rate, peakDb: 20 * Math.log10(peak / 32768 || 1e-9) };
}

describe('sfx catalogue', () => {
  it('has 80 unique, well-formed entries', () => {
    expect(SFX).toHaveLength(80);
    expect(new Set(SFX.map((s) => s.id)).size).toBe(80);
    expect(new Set(SFX.map((s) => s.graph)).size).toBe(80);
    for (const s of SFX) {
      expect(s.id).toMatch(/^sfx\.[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.version).toBe(1);
      expect(s.name.he).toMatch(/[א-ת]/);
      expect(s.name.en.length).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(s.category);
      expect(s.seconds).toBeGreaterThanOrEqual(0.05);
      expect(s.seconds).toBeLessThanOrEqual(4);
    }
  });
  it('keeps the original seven graphs unchanged', () => {
    for (const [id, graph] of Object.entries(ORIGINAL_GRAPHS)) expect(SFX.find((s) => s.id === id)?.graph, id).toBe(graph);
  });
  it('renders every entry: duration, peak, 48 kHz, deterministic', async () => {
    const queue = [...SFX]; const bad: string[] = [];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const a = await render(s.graph, `${s.id}.a.wav`); const b = await render(s.graph, `${s.id}.b.wav`);
        const m = analyse(a);
        if (!a.equals(b)) bad.push(`${s.id}: not deterministic`);
        if (m.rate !== 48000) bad.push(`${s.id}: rate ${m.rate}`);
        if (Math.abs(m.seconds - s.seconds) > 0.02) bad.push(`${s.id}: duration ${m.seconds} vs ${s.seconds}`);
        if (m.peakDb < -30 || m.peakDb > -0.5) bad.push(`${s.id}: peak ${m.peakDb.toFixed(2)} dBFS`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    expect(bad).toEqual([]);
  }, 110_000);
});
