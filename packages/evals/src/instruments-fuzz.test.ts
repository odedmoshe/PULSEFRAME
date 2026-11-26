/**
 * I19 — fuzz of the recorded-instruments parsers (wave 7 instruments track; builder W2). The WAV reader and the SFZ parser read
 * UNTRUSTED files of the owner's library folder. 5,000 mutated WAV byte strings and 5,000 mutated .sfz texts, made from valid
 * SYNTHETIC files (packages/fixtures/src/instruments.ts, labelled; never a real sample) by a seeded generator: each either parses or
 * throws InstrumentError — nothing else; the whole run takes under 60 s and grows the heap by less than 200 MB; the SFZ include
 * callback (the parser's only way to read anything) is only ever asked for a safe relative path. Then 150 hostile .sfz files go
 * through the real kit check over a temporary library folder with every open recorded: none opens a file outside the item.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeLibraryService, libraryServiceFor } from '../../../apps/server/src/library/index.ts';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { checkKit } from '../../../apps/server/src/instruments/bank.ts';
import { InstrumentError } from '../../../apps/server/src/instruments/contract.ts';
import { parseSfz } from '../../../apps/server/src/instruments/sfz.ts';
import { decodePcm, readWavInfo, readWavLoop, wavDataEnd } from '../../../apps/server/src/instruments/wav.ts';
import { mulberry32, mutateSfz, mutateWav, refreshKitTable, SAFE_REL, WAV_SEEDS, writeSyntheticKit } from '../../fixtures/src/instruments.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('I19: parser fuzz (5,000 WAV and 5,000 SFZ mutations of synthetic files)', () => {
  it('only InstrumentError, bounded time and memory, and the include callback only asked for safe relative paths', () => {
    const rnd = mulberry32(0x5eed);
    const t0 = performance.now();
    const m0 = process.memoryUsage();
    const others: string[] = [];
    let wavOk = 0, wavRefused = 0, sfzOk = 0, sfzRefused = 0;
    for (let i = 0; i < 5000; i++) {
      const b = mutateWav(WAV_SEEDS[i % WAV_SEEDS.length]!, rnd);
      try {
        const info = readWavInfo(b);
        const end = wavDataEnd(info);
        expect(end).toBeLessThanOrEqual(b.length);
        decodePcm(b.subarray(info.dataOffset, end), info, 0, info.frames);
        readWavLoop(b.subarray(Math.min(b.length, end + ((end - info.dataOffset) & 1))), info);
        // a head shorter than the file, as the loader reads it
        try { readWavInfo(b.subarray(0, Math.min(b.length, 40 + (i % 60))), b.length); } catch (e) { if (!(e instanceof InstrumentError)) throw e; }
        wavOk++;
      } catch (e) { if (e instanceof InstrumentError) wavRefused++; else others.push(`wav ${i}: ${String(e)}`); }
    }
    const asked: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const text = mutateSfz(rnd);
      try {
        parseSfz(text, (p) => { asked.push(p); if (p === 'inc/common.sfzh') return 'ampeg_attack=0.01 #define $W 1'; throw new InstrumentError('unreadable', 'no such include'); });
        sfzOk++;
      } catch (e) { if (e instanceof InstrumentError) sfzRefused++; else others.push(`sfz ${i}: ${String(e)}`); }
    }
    const ms = performance.now() - t0;
    const m1 = process.memoryUsage();
    console.log(`I19 fuzz: WAV ${wavOk} read / ${wavRefused} refused; SFZ ${sfzOk} read / ${sfzRefused} refused; ${Math.round(ms)} ms; growth ${(((m1.heapUsed + m1.arrayBuffers) - (m0.heapUsed + m0.arrayBuffers)) / 1048576).toFixed(1)} MB (one sample)`);
    expect(others).toEqual([]);
    expect(wavOk).toBeGreaterThan(50); expect(wavRefused).toBeGreaterThan(1000);
    expect(sfzOk).toBeGreaterThan(500); expect(sfzRefused).toBeGreaterThan(200);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((p) => !SAFE_REL(p))).toEqual([]);
    expect(ms).toBeLessThan(60_000);
    expect((m1.heapUsed + m1.arrayBuffers) - (m0.heapUsed + m0.arrayBuffers)).toBeLessThan(200 * 1024 * 1024);
  }, 120_000);

  it('150 hostile .sfz files through the real kit check: every open lies inside the library item; refusals are named', async () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ins-fuzz-lib-'));
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ins-fuzz-data-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ins-fuzz-out-'));
    dirs.push(lib, data, outside);
    fs.writeFileSync(path.join(outside, 'x.wav'), WAV_SEEDS[0]!);
    const k = writeSyntheticKit(lib);
    const cfg = { ...loadConfig({}), dataDir: data, libraryDir: lib };
    libraryServiceFor(cfg, { noStartupBuild: true });
    const sfz = path.join(k.items.strings.dir, 'strings.sfz');
    const base = fs.readFileSync(sfz, 'utf8');
    const rel = path.relative(k.items.strings.dir, outside).split(path.sep).join('/');
    const evil = [`../../${rel}/x.wav`, `..\\..\\${rel.replace(/\//g, '\\')}\\x.wav`, `${outside}/x.wav`, 'C:\\x.wav', 'samples/../../x.wav', 'samples/./x.wav', 'samples\\..\\..\\x.wav', `samples/x\u0000.wav`];
    const rnd = mulberry32(7);
    const opened: string[] = [];
    const real = fsp.open.bind(fsp);
    const spy = vi.spyOn(fsp, 'open').mockImplementation(((p: fs.PathLike, ...a: unknown[]) => { opened.push(String(p)); return (real as (...x: unknown[]) => Promise<fs.promises.FileHandle>)(p, ...a); }) as typeof fsp.open);
    const codes = new Map<string, number>();
    const libReal = fs.realpathSync(lib);
    try {
      for (let i = 0; i < 150; i++) {
        const line = i % 3 === 0 ? `#include "${evil[i % evil.length]}"` : `<region> sample=${evil[i % evil.length]} key=${30 + Math.floor(rnd() * 60)}`;
        fs.writeFileSync(sfz, i % 5 === 4 ? mutateSfz(rnd) : `${base}${line}\n`);
        const c = await checkKit(cfg, refreshKitTable(k));
        const code = c.state === 'ready' ? 'ready' : c.error.code;
        codes.set(code, (codes.get(code) ?? 0) + 1);
        if (c.state !== 'ready') expect(JSON.stringify({ m: c.error.message, d: c.error.details })).not.toContain(outside);
      }
    } finally { spy.mockRestore(); closeLibraryService(data); }
    expect(opened.length).toBeGreaterThan(150);
    expect(opened.filter((p) => !p.startsWith(libReal))).toEqual([]);
    expect(codes.get('instruments_path_escape') ?? 0).toBeGreaterThan(80);
    for (const c of codes.keys()) expect(['ready', 'instruments_path_escape', 'instruments_unreadable', 'instruments_format']).toContain(c);
  }, 120_000);
});
