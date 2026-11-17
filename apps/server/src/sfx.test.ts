import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSynth, renderSfx, runFfmpeg, SFX, sfxFfmpegArgs, sfxPreview, SynthFailure, type SfxDef, type SynthRunner } from './sfx.ts';

const exec = promisify(execFile);
/** The four sounds whose recipe was corrected (band-pass width in hertz): version 2, other bytes than version 1. */
const REVISED = ['sfx.swipe-tick', 'sfx.whoosh-swirl', 'sfx.vinyl-crackle', 'sfx.clap'];
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
  return { rate, seconds: data.length / 2 / channels / rate, peakDb: 20 * Math.log10(peak / 32768 || 1e-9), left: Float64Array.from({ length: Math.floor(data.length / 2 / channels) }, (_, i) => dv.getInt16(i * 2 * channels, true) / 32768) };
}
/** Power per frequency bin of a signal (radix-2 FFT, zero padded to a power of two). */
function powerSpectrum(x: Float64Array): Float64Array {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n); re.set(x);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i]!; re[i] = re[j]!; re[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const wr = Math.cos(-2 * Math.PI / len), wi = Math.sin(-2 * Math.PI / len);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci, xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi; re[a]! += xr; im[a]! += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  return Float64Array.from({ length: n / 2 }, (_, i) => re[i]! * re[i]! + im[i]! * im[i]!);
}
/** How the energy of a sound lies over frequency: the share within 30 Hz of the strongest frequency, and the width of the band that holds the middle 80 %. */
function spread(x: Float64Array) {
  const p = powerSpectrum(x); const hz = 48000 / (p.length * 2);
  let total = 0, top = 0;
  for (let i = 0; i < p.length; i++) { total += p[i]!; if (p[i]! > p[top]!) top = i; }
  let near = 0;
  for (let i = Math.max(0, Math.floor(top - 30 / hz)); i <= Math.min(p.length - 1, Math.ceil(top + 30 / hz)); i++) near += p[i]!;
  let acc = 0, lo = -1, hi = -1;
  for (let i = 0; i < p.length && hi < 0; i++) { acc += p[i]!; if (lo < 0 && acc >= 0.1 * total) lo = i * hz; if (acc >= 0.9 * total) hi = i * hz; }
  return { topHz: top * hz, shareNearTop: near / total, bandHz: hi - lo };
}

describe('sfx catalogue', () => {
  it('has 80 unique, well-formed entries', () => {
    expect(SFX).toHaveLength(80);
    expect(new Set(SFX.map((s) => s.id)).size).toBe(80);
    expect(new Set(SFX.map((s) => s.graph)).size).toBe(80);
    for (const s of SFX) {
      expect(s.id).toMatch(/^sfx\.[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.version, s.id).toBe(REVISED.includes(s.id) ? 2 : 1);
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
  it('a band-pass always states the unit of its width (hertz): a bare w= is a Q factor', () => {
    const withBand = SFX.filter((s) => s.graph.includes('bandpass'));
    expect(withBand.map((s) => s.id).sort()).toEqual([...REVISED].sort());
    for (const s of withBand) for (const f of s.graph.match(/bandpass=[^,\[;]*/g)!) expect(f, s.id).toMatch(/^bandpass=f=\d+:t=h:w=\d+$/);
  });
  // Every one of the 80, through the path production uses (renderSfx): a recipe this machine's ffmpeg rejects fails here, by name.
  it('renders every entry: duration, peak, 48 kHz, deterministic; band-passed noise is a band, not one tone', async () => {
    const queue = [...SFX]; const bad: string[] = [];
    const first = createSynth(runFfmpeg, { max: 4 }), second = createSynth(runFfmpeg, { max: 4 }); // two queues: the second render must not come from the first one's memory
    const make = (s: SfxDef, q: typeof first) => renderSfx(dir, s, q).catch((e: { code?: string; message?: string }) => { bad.push(`${s.id}: ${e.code}: ${e.message}`); return null; });
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const a = await make(s, first); const b = await make(s, second);
        if (!a || !b) continue;
        const m = analyse(a);
        if (!a.equals(b)) bad.push(`${s.id}: not deterministic`);
        if (m.rate !== 48000) bad.push(`${s.id}: rate ${m.rate}`);
        if (Math.abs(m.seconds - s.seconds) > 0.02) bad.push(`${s.id}: duration ${m.seconds} vs ${s.seconds}`);
        if (m.peakDb < -30 || m.peakDb > -0.5) bad.push(`${s.id}: peak ${m.peakDb.toFixed(2)} dBFS`);
        if (s.graph.includes('bandpass')) {
          // Version 1 of these four had 86-99 % of its energy within 30 Hz of one frequency and a band a few hertz wide.
          const f = spread(m.left);
          if (f.shareNearTop > 0.25) bad.push(`${s.id}: ${(f.shareNearTop * 100).toFixed(1)} % of the energy lies within 30 Hz of ${f.topHz.toFixed(0)} Hz (a tone, not a band)`);
          if (f.bandHz < 1000) bad.push(`${s.id}: the middle 80 % of the energy spans only ${f.bandHz.toFixed(0)} Hz`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    expect(bad).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('sfxp_'))).toEqual([]);
  }, 110_000);
  it('the production arguments render the same bytes as the production path', async () => {
    const s = SFX.find((x) => x.id === 'sfx.clap')!;
    expect((await render(s.graph, 'clap.direct.wav')).equals(await renderSfx(dir, s, createSynth()))).toBe(true);
  }, 30_000);
});

const fake = (over: Partial<SfxDef> = {}): SfxDef => ({ id: 'sfx.test-sound', version: 1, name: { he: 'בדיקה', en: 'Test sound' }, seconds: 0.1, graph: 'anoisesrc=d=0.1', category: 'ui', ...over });

describe('sound synthesis failures are typed and name the sound', () => {
  it('a recipe the installed ffmpeg rejects is 501 sfx_unsupported, not a generic 500', async () => {
    const e = await renderSfx(dir, fake({ id: 'sfx.test-broken', name: { he: 'שבור', en: 'Broken' }, graph: 'anoisesrc=d=0.1,nosuchfilter=1' }), createSynth()).catch((x) => x);
    expect(e).toMatchObject({ status: 501, code: 'sfx_unsupported', details: { id: 'sfx.test-broken', name: 'Broken' } });
    expect(e.message).toBe('the installed ffmpeg cannot synthesise the sound "Broken" (sfx.test-broken)');
    expect(e.details.ffmpeg).toMatch(/nosuchfilter/);
    expect(e.hint).toMatch(/ffmpeg build/);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('sfxp_'))).toEqual([]);
  }, 30_000);
  it('a run that takes too long is killed and reported as 503 sfx_timeout', async () => {
    const t0 = Date.now();
    const e = await renderSfx(dir, fake({ id: 'sfx.test-slow', name: { he: 'איטי', en: 'Slow' }, graph: 'anullsrc=r=48000:d=60,arealtime' }), createSynth(runFfmpeg, { timeoutMs: 400 })).catch((x) => x);
    expect(e).toMatchObject({ status: 503, code: 'sfx_timeout', details: { id: 'sfx.test-slow' } });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('sfxp_'))).toEqual([]);
  }, 30_000);
  it('the runner kills the process itself: nothing is left running after the timeout', async () => {
    const mark = `pf-kill-test-${process.pid}-${Date.now()}`;
    const e = await runFfmpeg(['-hide_banner', '-v', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i', 'anullsrc=r=48000', '-t', '60', '-metadata', `comment=${mark}`, '-f', 'null', '-'], 300).catch((x) => x);
    expect(e).toBeInstanceOf(SynthFailure);
    expect(e.reason).toBe('timeout');
    if (fs.existsSync('/proc/self/cmdline')) {
      await new Promise((r) => setTimeout(r, 100));
      const alive = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => { try { return fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(mark) && !fs.readFileSync(`/proc/${d}/stat`, 'utf8').includes(') Z '); } catch { return false; } });
      expect(alive).toEqual([]);
    }
  }, 30_000);
  it('a missing ffmpeg and a failing one are told apart', async () => {
    const missing: SynthRunner = () => Promise.reject(new SynthFailure('unavailable'));
    expect(await renderSfx(dir, fake(), createSynth(missing)).catch((x) => x)).toMatchObject({ status: 503, code: 'sfx_unavailable' });
    await expect(sfxPreview(dir, 'sfx.does-not-exist')).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});

/** The limits of on-demand synthesis, with a stand-in for ffmpeg (labelled: it only writes a marker file) so that process starts can be counted exactly. */
describe('synthesis queue: bounded, de-duplicated, cached', () => {
  function counting() {
    let starts = 0, active = 0, most = 0; const release: (() => void)[] = [];
    const runner: SynthRunner = async (args) => {
      const n = ++starts; active++; most = Math.max(most, active);
      await new Promise<void>((r) => release.push(r));
      fs.writeFileSync(args.at(-1)!, `stand-in output ${n}`);
      active--;
    };
    return { runner, get starts() { return starts; }, get active() { return active; }, get most() { return most; }, finishOne: () => release.shift()?.(), finishAll: async () => { for (let i = 0; i < 400; i++) { release.shift()?.(); await new Promise((r) => setImmediate(r)); } } };
  }
  const ids = SFX.map((s) => s.id);

  it('40 requests at once for the same sound start one process and all get its bytes', async () => {
    const c = counting(); const q = createSynth(c.runner);
    const all = Array.from({ length: 40 }, () => sfxPreview(dir, 'sfx.wind', q));
    await new Promise((r) => setImmediate(r));
    expect(c.starts).toBe(1);
    await c.finishAll();
    const out = await Promise.all(all);
    expect(c.starts).toBe(1);
    expect(out.every((b) => b === out[0])).toBe(true);
    expect((await sfxPreview(dir, 'sfx.wind', q)).equals(out[0]!)).toBe(true); // now from memory
    expect(c.starts).toBe(1);
  });
  it('300 requests over all 80 sounds: two processes at a time, sixteen waiting, the rest refused with 429 and a wait time', async () => {
    const c = counting(); const q = createSynth(c.runner);
    const all = Array.from({ length: 300 }, (_, i) => sfxPreview(dir, ids[i % 80]!, q).then((b) => ({ ok: true as const, b }), (e) => ({ ok: false as const, e })));
    await new Promise((r) => setImmediate(r));
    expect(c.starts).toBe(2);
    expect(c.active).toBe(2);
    await c.finishAll();
    const out = await Promise.all(all);
    const refused = out.filter((o) => !o.ok);
    expect(c.most).toBe(2);
    expect(c.starts).toBe(18); // 2 running + 16 waiting were accepted
    // the first 18 distinct sounds were made; the later requests for those same 18 shared their runs; everything else was refused
    expect(out.filter((o) => o.ok).length).toBe(72); // requests 0-299 go round the 80 ids: each of the first 18 ids is asked for four times
    expect(refused.length).toBe(228);
    for (const r of refused) expect((r as { e: unknown }).e).toMatchObject({ status: 429, code: 'synthesis_busy', details: { retryAfterSeconds: 2, running: 2, waiting: 16 } });
    // afterwards there is room again
    const later = sfxPreview(dir, 'sfx.rain', q);
    await c.finishAll();
    expect((await later).length).toBeGreaterThan(0);
  });
  it('a failed run frees its place and is not remembered', async () => {
    let n = 0;
    const flaky: SynthRunner = async (args) => { if (n++ === 0) throw new SynthFailure('failed', 'boom'); fs.writeFileSync(args.at(-1)!, 'ok'); };
    const q = createSynth(flaky, { max: 1, maxQueue: 0 });
    await expect(sfxPreview(dir, 'sfx.click', q)).rejects.toMatchObject({ status: 501, code: 'sfx_unsupported' });
    expect((await sfxPreview(dir, 'sfx.click', q)).toString()).toBe('ok');
    expect(n).toBe(2);
  });
  it('holds the most recent results only', async () => {
    let n = 0;
    const quick: SynthRunner = async (args) => { n++; fs.writeFileSync(args.at(-1)!, 'x'); };
    const q = createSynth(quick, { keep: 3 });
    for (const id of ids.slice(0, 4)) await sfxPreview(dir, id, q);
    expect(n).toBe(4);
    await sfxPreview(dir, ids[3]!, q); await sfxPreview(dir, ids[1]!, q);
    expect(n).toBe(4); // still held
    await sfxPreview(dir, ids[0]!, q);
    expect(n).toBe(5); // the oldest was dropped
  });
});
