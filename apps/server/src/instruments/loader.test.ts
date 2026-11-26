/**
 * The loader of recorded instruments (wave 7 instruments track; builder W2): WAV and SFZ parsers, the kit check, the bank loader and
 * the recorded request path of music.ts. Every file here is written by code under a temporary library folder: the LABELLED synthetic
 * test kit of packages/fixtures/src/instruments.ts (never a real sample set; nothing committed). Many rows here use the fixtures'
 * labelled stand-in planner (standInPlanZones) and the LABELLED stand-in renderer below (the synthesiser's bytes at half level, so the
 * level match has two different levels) to test the loader alone; W1's real planner and renderer meeting this loader are proven in
 * integration.test.ts and proof checks I13/I15.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { collectCredits, INSTRUMENTS_LIMITS, MUSIC_GENERATOR, MUSIC_KITS, MUSIC_RECORDED_GENERATOR, MUSIC_SAMPLER_VERSION, validateProject, type MusicKit } from '@pulseframe/core';
import { refreshKitTable, standInPlanZones, synthWav, SYNTHETIC_KIT_LABEL, SYNTHETIC_SOURCES, writeLedger, writeSyntheticKit, type SyntheticKit, type SyntheticKitOptions } from '../../../../packages/fixtures/src/instruments.ts';
import { planArchive } from '../archive.ts';
import { loadConfig, type Config } from '../config.ts';
import { libraryExportWarnings } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { closeLibraryService, libraryServiceFor } from '../library/index.ts';
import { addMusic, createMusicQueue, makeMusic, musicPreviewAnswer, type MusicQueue } from '../music.ts';
import { renderMusic, type RenderedMusic } from '../music/render.ts';
import type { ResolvedBank } from '../music/sampler.ts';
import { prepareMusicFit } from '../musicfit/plan.ts';
import { ApiError, Store } from '../store.ts';
import { checkKit, kitBank, kitHashStats, kitNotes, loadBank, type LoadDeps, type ReadyKit } from './bank.ts';
import { InstrumentError } from './contract.ts';
import { listMusicKits } from './routes.ts';
import { parseSfz, sfzPath } from './sfz.ts';
import { decodePcm, readWavInfo, readWavLoop, wavDataEnd } from './wav.ts';

// ---------- worlds ----------
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const configs: string[] = [];
afterEach(() => { for (const d of configs.splice(0)) closeLibraryService(d); });
/** A data directory and, optionally, a library root with the synthetic test kit. The library service never indexes (no start-up build). */
function world(o: SyntheticKitOptions & { library?: boolean } = {}): { cfg: Config; lib: SyntheticKit | null; store: Store } {
  const data = tmp('pf-ins-data-');
  const lib = o.library === false ? null : writeSyntheticKit(tmp('pf-ins-lib-'), o);
  const cfg: Config = { ...loadConfig({}), dataDir: data, libraryDir: lib ? lib.root : null };
  libraryServiceFor(cfg, { noStartupBuild: true });
  configs.push(data);
  return { cfg, lib, store: new Store(data) };
}
const refusalOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error('expected a refusal'); };
const codeOf = async (p: Promise<unknown>) => { const e = await refusalOf(p); return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${String(e)}`; };
const throwsTyped = (fn: () => unknown): InstrumentError => { try { fn(); } catch (e) { if (e instanceof InstrumentError) return e; throw e; } throw new Error('no refusal'); };
const noAbs = (v: unknown, roots: string[]) => { const s = JSON.stringify(v); for (const r of roots) expect(s.includes(r), `holds ${r}`).toBe(false); expect(s).not.toMatch(/"\/(tmp|home|root|Users|var)\//); };
const ready = async (cfg: Config, kit: MusicKit): Promise<ReadyKit> => { const c = await checkKit(cfg, kit); if (c.state !== 'ready') throw c.error; return c; };
const STAND_IN: LoadDeps = { planZones: (notes, bank) => standInPlanZones(notes, bank) };
/** LABELLED STAND-IN renderer (until W1): refuses without a bank; makes the synthesiser's bytes at half level for a bank. */
const standInRenderer = (seen: (ResolvedBank | undefined)[]) => async (id: string, bars: number, seed: number, opts: { cancel: { cancelled: boolean }; endFrames?: number; bank?: ResolvedBank }): Promise<RenderedMusic> => {
  seen.push(opts.bank);
  const r = await renderMusic(id, bars, seed, { cancel: opts.cancel, ...(opts.endFrames !== undefined ? { endFrames: opts.endFrames } : {}) });
  if (!opts.bank) return r;
  const wav = Buffer.from(r.wav);
  let sum = 0;
  for (let o = 44; o < wav.length; o += 2) { const v = Math.trunc(wav.readInt16LE(o) / 2); wav.writeInt16LE(v, o); sum += v * v; }
  return { ...r, wav, peak: r.peak / 2, rms: Math.sqrt(sum / ((wav.length - 44) / 2)) / 32768 };
};
const owner: Principal = { actor: 'owner', kind: 'user', scopes: ['observe', 'edit'] };

// =====================================================================================================================================
describe('WAV reader (untrusted bytes: every size checked; only InstrumentError)', () => {
  it('reads PCM 16/24/32, float 32 and EXTENSIBLE, mono and stereo, at a 24-bit scale; finds a smpl loop in the head and after the data', () => {
    for (const t of [
      { bits: 16 as const, channels: 1 as const }, { bits: 24 as const, channels: 2 as const }, { bits: 32 as const, channels: 1 as const },
      { bits: 32 as const, channels: 2 as const, float: true }, { bits: 24 as const, channels: 2 as const, extensible: true }, { bits: 32 as const, channels: 1 as const, float: true, extensible: true },
    ]) {
      const b = synthWav({ rate: 44100, frames: 1000, freq: 441, amp: 0.5, loop: { start: 100, end: 899 }, ...t });
      const info = readWavInfo(b);
      expect({ ...info, loop: info.loop }).toMatchObject({ rate: 44100, channels: t.channels, bits: t.bits, float: !!t.float, frames: 1000, loop: { start: 100, end: 899 } });
      const s = decodePcm(b.subarray(info.dataOffset, wavDataEnd(info)), info, 0, 1000);
      expect(s.length).toBe(1000 * t.channels);
      // frame 25 of a 441 Hz sine at 44.1 kHz is a quarter period: 0.5 of full scale (2^23), within the format's own rounding
      expect(Math.abs(s[25 * t.channels]! - 0.5 * 8388608)).toBeLessThan(t.bits === 16 ? 300 : 2);
      // the head alone (data longer than the bytes held) still gives the format; the loop after the data is read from the tail
      const head = b.subarray(0, info.dataOffset + 10);
      const h = readWavInfo(head, b.length);
      expect([h.frames, h.loop]).toEqual([1000, null]);
      const end = wavDataEnd(h) + ((wavDataEnd(h) - h.dataOffset) & 1);
      expect(readWavLoop(b.subarray(end), h)).toEqual({ start: 100, end: 899 });
    }
  });
  it('refuses wrong RIFF sizes, a data chunk longer than the file, zero or absurd channels and rates, FLAC/Ogg/AIFF, truncation — with words', () => {
    const good = synthWav({ rate: 48000, channels: 2, bits: 16, frames: 64, freq: 1000 });
    const info = readWavInfo(good);
    const m = (f: (b: Buffer) => void, cut?: number) => { const b = Buffer.from(good); f(b); return cut === undefined ? b : b.subarray(0, cut); };
    const cases: [string, Buffer, InstrumentError['code'], RegExp][] = [
      ['RIFF size larger than the file', m((b) => b.writeUInt32LE(0xfffffff0, 4)), 'unreadable', /RIFF size|truncated/],
      ['RIFF size below a header', m((b) => b.writeUInt32LE(2, 4)), 'unreadable', /too small/],
      ['data chunk longer than the file', m((b) => b.writeUInt32LE(0x7fffffff, info.dataOffset - 4)), 'unreadable', /longer than the file/],
      ['fmt chunk size absurd', m((b) => b.writeUInt32LE(0xffffffff, 16)), 'unreadable', /longer than the file/],
      ['zero channels', m((b) => b.writeUInt16LE(0, 22)), 'format', /0 channels/],
      ['6 channels', m((b) => b.writeUInt16LE(6, 22)), 'format', /6 channels/],
      ['rate 0', m((b) => b.writeUInt32LE(0, 24)), 'format', /sample rate 0/],
      ['rate 4 GHz', m((b) => b.writeUInt32LE(0xffffffff, 24)), 'format', /sample rate/],
      ['8-bit', m((b) => { b.writeUInt16LE(8, 34); b.writeUInt16LE(2, 32); b.writeUInt32LE(96000, 28); }), 'format', /8-bit/],
      ['compressed (ADPCM)', m((b) => b.writeUInt16LE(2, 20)), 'format', /format tag 2/],
      ['block size lies', m((b) => b.writeUInt16LE(3, 32)), 'unreadable', /block size/],
      ['truncated in the data', good.subarray(0, good.length - 10), 'unreadable', /truncated|longer than/],
      ['truncated in the header', good.subarray(0, 10), 'unreadable', /shorter than a WAV header/],
      ['FLAC', Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(60)]), 'format', /FLAC/],
      ['Ogg', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60)]), 'format', /Ogg/],
      ['AIFF', Buffer.concat([Buffer.from('FORM'), Buffer.alloc(60)]), 'format', /AIFF/],
      ['RF64', m((b) => b.write('RF64', 0)), 'format', /RF64/],
      ['no data chunk', m((b) => b.write('junk', info.dataOffset - 8)), 'unreadable', /no data chunk/],
      ['empty', Buffer.alloc(0), 'unreadable', /shorter/],
    ];
    for (const [name, bytes, code, why] of cases) {
      const e = throwsTyped(() => readWavInfo(bytes));
      expect([name, e.code, why.test(e.why)], `${name}: ${e.why}`).toEqual([name, code, true]);
    }
    // decodePcm: a byte count that is not exactly the frames asked for, frames outside the chunk, or above the memory bound
    expect(throwsTyped(() => decodePcm(good.subarray(info.dataOffset, info.dataOffset + 10), info, 0, 64)).why).toMatch(/truncated/);
    expect(throwsTyped(() => decodePcm(Buffer.alloc(0), info, 60, 10)).why).toMatch(/outside/);
    expect(throwsTyped(() => decodePcm(Buffer.alloc(0), { ...info, frames: 2 ** 40 }, 0, INSTRUMENTS_LIMITS.maxDecodedBytes)).code).toBe('too_large');
    // a float NaN sample is refused, an infinite one clamped
    const fl = synthWav({ rate: 48000, channels: 1, bits: 32, float: true, frames: 4, freq: 1000 });
    const fi = readWavInfo(fl);
    fl.writeFloatLE(Number.POSITIVE_INFINITY, fi.dataOffset);
    expect(decodePcm(fl.subarray(fi.dataOffset, wavDataEnd(fi)), fi, 0, 4)[0]).toBe(8388607);
    fl.writeFloatLE(Number.NaN, fi.dataOffset);
    expect(throwsTyped(() => decodePcm(fl.subarray(fi.dataOffset, wavDataEnd(fi)), fi, 0, 4)).why).toMatch(/not a number/);
  });
});

// =====================================================================================================================================
describe('SFZ parser (untrusted text: paths, includes and sizes bounded; only InstrumentError)', () => {
  it('applies headers with inheritance, #define, default_path, octave_offset, note_offset and note names; counts the rest; skips release regions', () => {
    const inc: Record<string, string> = { 'common/env.sfzh': 'ampeg_release=0.7 ampeg_attack=$ATT' };
    const text = [
      '// comment', '/* block', 'comment */', '#define $ATT 0.02', '<control> default_path=Samples\\Strings\\ octave_offset=1 note_offset=-2',
      '<global> volume=-3', '#include "common/env.sfzh"', '<group> lovel=1 hivel=64 pitch_keytrack=50 amp_velcurve_127=1 locc64=0 hicc64=63 xfin_locc1=10 xfin_hicc1=20 seq_position=2',
      '<region> sample=a b.wav lokey=c3 hikey=e3 pitch_keycenter=d3 loop_mode=loop_sustain loop_start=10 loop_end=99 fil_type=lpf_2p cutoff=500',
      '<region> sample=sub\\c.wav key=60 tune=-12 trigger=first sw_lokey=24 sw_hikey=26 sw_default=24',
      '<region> sample=rel.wav trigger=release', '<curve> curve_index=1 v000=0', '<group> <region> sample=d.wav lovel=65 ampeg_sustain=50',
    ].join('\n');
    const p = parseSfz(text, (f) => { if (!(f in inc)) throw new InstrumentError('unreadable', 'no such include'); return inc[f]!; });
    expect(p.regions.map((r) => r.sample)).toEqual(['Samples/Strings/a b.wav', 'Samples/Strings/sub/c.wav', 'Samples/Strings/d.wav']);
    const [a, c, d] = p.regions as [typeof p.regions[0], typeof p.regions[0], typeof p.regions[0]];
    // c3 = 48 + octave_offset·12 − 2 = 58; e3 = 52 → 62; d3 = 50 → 60
    expect([a.lokey, a.hikey, a.keycenter, a.lovel, a.hivel, a.keytrack, a.volume, a.release, a.attack]).toEqual([58, 62, 60, 1, 64, 50, -3, 0.7, 0.02]);
    expect([a.loopMode, a.loopModeGiven, a.loopStart, a.loopEnd, a.locc, a.hicc, a.xfin, a.seqPosition, a.velcurve]).toEqual(['loop_sustain', true, 10, 99, { 64: 0 }, { 64: 63 }, { cc: 1, lo: 10, hi: 20 }, 2, [[127, 1]]]);
    expect([c.lokey, c.hikey, c.keycenter, c.tune, c.trigger, c.sw, c.loopModeGiven]).toEqual([70, 70, 70, -12, 'first', { lokey: 34, hikey: 36, last: null, default: 34 }, false]);
    expect([d.lovel, d.hivel, d.sustain, d.volume]).toEqual([65, 127, 50, -3]);
    expect(p.ignored).toMatchObject({ fil_type: 1, cutoff: 1, 'trigger=release': 1, '<curve>': 1 });
  });
  it('refuses an absolute, drive, "..", backslash-trick or NUL path in sample=, default_path or #include, and bounds includes, defines and size', () => {
    const none = () => { throw new Error('the include callback must not be reached'); };
    for (const [name, text] of [
      ['../../x', '<region> sample=../../x.wav'], ['..\\..\\x', '<region> sample=..\\..\\x.wav'], ['absolute', '<region> sample=/etc/passwd'],
      ['backslash absolute', '<region> sample=\\\\server\\share\\x.wav'], ['drive', '<region> sample=C:\\x.wav'], ['drive relative', '<region> sample=C:x.wav'],
      ['NUL', '<region> sample=a\u0000.wav'], ['dot segment', '<region> sample=a/./b.wav'], ['default_path ..', '<control> default_path=..\\ <region> sample=x.wav'],
      ['include ..', '#include "../x.sfz"'], ['include absolute', '#include "/x.sfz"'], ['include drive', '#include "D:\\x.sfz"'],
    ] as const) {
      expect([name, throwsTyped(() => parseSfz(text, none)).code]).toEqual([name, 'path_escape']);
    }
    expect(sfzPath('Samples\\a.wav')).toBe('Samples/a.wav'); // a backslash path inside is fine
    // an include that includes itself: depth bound
    expect(throwsTyped(() => parseSfz('#include "a.sfz"', () => '#include "a.sfz"')).code).toBe('too_large');
    // an include bomb (each file includes the next twice): count bound
    expect(throwsTyped(() => parseSfz('#include "a.sfz"\n'.repeat(300), () => '<region> sample=x.wav')).why).toMatch(/#include/);
    // #define is one textual pass (a $A inside a value is not expanded again), and a line that grows too long through it is refused
    expect(parseSfz('#define $A $A$A\n<region> sample=$A.wav', none).regions[0]!.sample).toBe('$A$A.wav');
    expect(throwsTyped(() => parseSfz(`#define $A ${'x'.repeat(1000)}\n<region> sample=${'$A'.repeat(20)}.wav`, none)).code).toBe('too_large');
    expect(throwsTyped(() => parseSfz('x'.repeat(4 * 1024 * 1024 + 1), none)).code).toBe('too_large');
    // a number that is not one, a loop mode that is not one
    expect(throwsTyped(() => parseSfz('<region> sample=x.wav lokey=banana', none)).code).toBe('format');
    expect(throwsTyped(() => parseSfz('<region> sample=x.wav volume=1e999', none)).code).toBe('format');
    expect(throwsTyped(() => parseSfz('<region> sample=x.wav loop_mode=forever', none)).code).toBe('format');
  });
});

// =====================================================================================================================================
describe('honest states: nothing is offered and nothing is made unless every file and source passes', () => {
  it('no library folder; a kit with no file names and no checksums; the real kit with its item not downloaded; item missing; another commit', async () => {
    const none = world({ library: false });
    const c0 = await checkKit(none.cfg, MUSIC_KITS[0]!);
    expect([c0.state, c0.state !== 'ready' && c0.error.code]).toEqual(['library_not_set', 'instruments_library_not_set']);
    // a kit whose instrument has no entry and no files is not calibrated and offered nowhere (the real kit was in this state until
    // both instruments were read on the owner's computer on 2026-11-26)
    const w = world();
    const unread = structuredClone(MUSIC_KITS[0]!) as MusicKit;
    unread.instruments[0]!.entry = null; unread.instruments[0]!.files = [];
    const c1 = await checkKit(w.cfg, unread);
    expect([c1.state, c1.state !== 'ready' && c1.error.code, c1.state !== 'ready' && c1.error.hint]).toEqual(['not_calibrated', 'instruments_kit_not_ready', expect.stringMatching(/synthesised/)]);
    // the real kit of this build is calibrated; this library has no download of its item, and that is what it says
    expect(MUSIC_KITS[0]!.instruments.map((i) => [i.id, i.entry, i.files.length])).toEqual([['strings', 'ViolaEnsSusVib.sfz', 27], ['piano', 'UprightPiano.sfz', 70]]);
    const listed = await listMusicKits(w.cfg);
    expect(listed.kits.map((k) => [k.kitId, k.state, k.reason])).toEqual([['kit.calm.vsco', 'item_missing', 'instruments_item_missing']]);
    // a recorded request for it is refused before anything is made (the store holds no blob afterwards)
    expect(await codeOf(makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 'test', createMusicQueue(), { cfg: w.cfg }))).toBe('409:instruments_item_missing');
    expect(fs.readdirSync(w.store.blobDir)).toEqual([]);
    // a style with no kit
    expect(await codeOf(makeMusic(w.store, { styleId: 'music.pop', bars: 4, seed: 1, instruments: 'recorded' as const }, 'test', createMusicQueue(), { cfg: w.cfg, kits: [w.lib!.kit] }))).toBe('404:instruments_no_kit');
    // the item missing from the ledger, then at another commit
    writeLedger(w.lib!.root, w.lib!.ledger.filter((e) => !e.item.endsWith('/piano')));
    const c2 = await checkKit(w.cfg, w.lib!.kit);
    expect([c2.state, c2.state !== 'ready' && c2.error.message]).toEqual(['item_missing', 'the library has no download of synthetic-zero/piano, which this kit needs']);
    writeLedger(w.lib!.root, w.lib!.ledger.map((e) => ({ ...e, commit: 'another-commit' })));
    expect((await checkKit(w.cfg, w.lib!.kit)).state).toBe('item_version');
    // the folder as written: ready
    writeLedger(w.lib!.root, w.lib!.ledger);
    expect((await checkKit(w.cfg, w.lib!.kit)).state).toBe('ready');
  });
  it('a kit file missing, a file changed by one byte (same size), a size that differs: file_missing / file_changed, with the path inside the item only', async () => {
    const w = world();
    const kit = w.lib!.kit;
    const wav = path.join(w.lib!.items.piano.dir, 'samples', 'piano-c4.wav');
    const keep = fs.readFileSync(wav);
    fs.rmSync(wav);
    const c1 = await checkKit(w.cfg, kit);
    expect([c1.state, c1.state !== 'ready' && c1.error.message]).toEqual(['file_missing', 'a sample file of this kit is missing: samples/piano-c4.wav']);
    const one = Buffer.from(keep); one[one.length - 1]! ^= 1;
    fs.writeFileSync(wav, one);
    const c2 = await checkKit(w.cfg, kit);
    expect([c2.state, c2.state !== 'ready' && c2.error.code, c2.state !== 'ready' && c2.error.details]).toEqual(['file_changed', 'instruments_file_changed', { path: 'samples/piano-c4.wav', reason: 'sha256' }]);
    fs.writeFileSync(wav, Buffer.concat([keep, Buffer.alloc(1)]));
    expect(((await checkKit(w.cfg, kit)) as { error: ApiError }).error.details).toEqual({ path: 'samples/piano-c4.wav', reason: 'size' });
    noAbs([c1, c2].map((c) => c.state !== 'ready' && { m: c.error.message, d: c.error.details, h: c.error.hint }), [w.lib!.root, w.cfg.dataDir]);
    // and a recorded request is refused before the queue is even asked
    const seen: (ResolvedBank | undefined)[] = [];
    expect(await codeOf(makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 'test', createMusicQueue({}, standInRenderer(seen)), { cfg: w.cfg, kits: [kit], load: STAND_IN }))).toBe('409:instruments_file_changed');
    expect([seen.length, fs.readdirSync(w.store.blobDir)]).toEqual([0, []]);
  });
});

// =====================================================================================================================================
describe('path safety: nothing outside the item is opened', () => {
  const opened: string[] = [];
  const spyOpen = () => {
    opened.length = 0;
    const real = fsp.open.bind(fsp);
    return vi.spyOn(fsp, 'open').mockImplementation(((p: fs.PathLike, ...a: unknown[]) => { opened.push(String(p)); return (real as (...x: unknown[]) => Promise<fs.promises.FileHandle>)(p, ...a); }) as typeof fsp.open);
  };
  afterEach(() => vi.restoreAllMocks());
  const withSfz = (w: { lib: SyntheticKit | null }, id: 'strings' | 'piano', extra: string) => {
    fs.appendFileSync(path.join(w.lib!.items[id].dir, `${id}.sfz`), extra);
    return [w.lib!.kit.instruments.find((i) => i.id === id)!, refreshKitTable(w.lib!)] as const;
  };
  it('sample=../../x, ..\\..\\x, an absolute path and a link out of the folder are refused by name; the fs spy shows no open outside the item', async () => {
    const outside = tmp('pf-ins-outside-');
    fs.writeFileSync(path.join(outside, 'secret.wav'), synthWav({ rate: 48000, channels: 1, bits: 16, frames: 10, freq: 1000 }));
    for (const [name, extra, code] of [
      ['../../x', '<region> sample=../../../secret.wav key=40\n', '409:instruments_path_escape'],
      ['..\\..\\x', '<region> sample=..\\..\\..\\secret.wav key=40\n', '409:instruments_path_escape'],
      ['absolute', `<region> sample=${path.join(outside, 'secret.wav')} key=40\n`, '409:instruments_path_escape'],
    ] as const) {
      const w = world();
      const [, kit] = withSfz(w, 'strings', extra);
      const spy = spyOpen();
      const c = await checkKit(w.cfg, kit);
      spy.mockRestore();
      expect([name, c.state !== 'ready' && `${c.error.status}:${c.error.code}`]).toEqual([name, code]);
      expect(opened.length, `${name}: the spy saw the opens`).toBeGreaterThan(0);
      expect(opened.filter((p) => !p.startsWith(fs.realpathSync(w.lib!.root))), name).toEqual([]);
    }
    // a link inside the item that leads out of the folder, listed in the table as the kit file it pretends to be
    const w = world();
    const link = path.join(w.lib!.items.piano.dir, 'samples', 'piano-c4.wav');
    fs.rmSync(link);
    fs.symlinkSync(path.join(outside, 'secret.wav'), link);
    const spy = spyOpen();
    const c = await checkKit(w.cfg, w.lib!.kit);
    spy.mockRestore();
    expect(c.state !== 'ready' && c.error.code).toBe('instruments_path_escape');
    expect(opened.some((p) => p.startsWith(outside) || p.includes('secret'))).toBe(false);
    expect(c.state !== 'ready' && JSON.stringify(c.error)).not.toContain(outside);
  });
  it('a backslash path that stays inside the item works; a name that differs only in case is used once and counted; two such names refuse', async () => {
    const w = world();
    const sfz = path.join(w.lib!.items.strings.dir, 'strings.sfz');
    fs.writeFileSync(sfz, fs.readFileSync(sfz, 'utf8').replace('<control> default_path=samples/', '<control> default_path=samples\\').replace('sample=strings-c4.wav', 'sample=STRINGS-C4.wav'));
    const kit = refreshKitTable(w.lib!);
    const c = await checkKit(w.cfg, kit);
    expect(c.state).toBe('ready');
    const bank = await loadBank(c as ReadyKit, kit, kitNotes(kit, 'music.calm', 4, 1), undefined, STAND_IN);
    expect(bank.parts.pad!.instrument.zones.map((z) => z.path)).toContain('samples/strings-c4.wav');
    fs.copyFileSync(path.join(w.lib!.items.strings.dir, 'samples', 'strings-c4.wav'), path.join(w.lib!.items.strings.dir, 'samples', 'Strings-C4.wav'));
    const two = await checkKit(w.cfg, refreshKitTable(w.lib!));
    expect([two.state, two.state !== 'ready' && two.error.message]).toEqual(['unreadable', 'a sample file could not be read: samples/STRINGS-C4.wav (two files of the kit match this name in different case)']);
  });
  it('a truncated WAV, a FLAC and a sample the table does not list: unreadable / format, before anything is made', async () => {
    const w = world();
    const wav = path.join(w.lib!.items.piano.dir, 'samples', 'piano-c5.wav');
    fs.writeFileSync(wav, fs.readFileSync(wav).subarray(0, 300));
    const t = await checkKit(w.cfg, refreshKitTable(w.lib!));
    expect([t.state, t.state !== 'ready' && t.error.code, t.state !== 'ready' && t.error.message]).toEqual(['unreadable', 'instruments_unreadable', expect.stringMatching(/^a sample file could not be read: samples\/piano-c5\.wav \(the RIFF size says the file is longer than it is \(truncated\)\)$/)]);
    fs.writeFileSync(wav, Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(200)]));
    const f = await checkKit(w.cfg, refreshKitTable(w.lib!));
    expect([f.state !== 'ready' && f.error.code, f.state !== 'ready' && f.error.message]).toEqual(['instruments_format', 'a sample file is in a format this build does not read: samples/piano-c5.wav (FLAC)']);
    const v = world();
    fs.writeFileSync(path.join(v.lib!.items.piano.dir, 'samples', 'extra.wav'), synthWav({ rate: 48000, channels: 1, bits: 16, frames: 10, freq: 100 }));
    fs.appendFileSync(path.join(v.lib!.items.piano.dir, 'piano.sfz'), '<region> sample=extra.wav key=20\n');
    const table = refreshKitTable(v.lib!);
    const unlisted: MusicKit = { ...table, instruments: table.instruments.map((i) => (i.id === 'piano' ? { ...i, files: i.files.filter((x) => !x.path.endsWith('extra.wav')) } : i)) };
    const u = await checkKit(v.cfg, unlisted);
    expect(u.state !== 'ready' && u.error.message).toBe('a sample file could not be read: samples/extra.wav (it is not in the checked list of this kit)');
  });
});

// =====================================================================================================================================
describe('the file-hash map, the bank loader and the memory bound', () => {
  it('hashes once per (absolute path, size, mtimeMs); a changed mtime rehashes; a file changed between the check and the load refuses', async () => {
    const w = world();
    const kit = w.lib!.kit;
    const n = kit.instruments.reduce((s, i) => s + i.files.length, 0);
    const h0 = kitHashStats.hashed;
    await ready(w.cfg, kit);
    expect(kitHashStats.hashed - h0).toBe(n);
    await ready(w.cfg, kit);
    expect(kitHashStats.hashed - h0).toBe(n); // all from the map
    const wav = path.join(w.lib!.items.strings.dir, 'samples', 'strings-c3.wav');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(wav, t, t);
    const check = await ready(w.cfg, kit);
    expect(kitHashStats.hashed - h0).toBe(n + 1);
    // the same bytes, a later mtime after the check: the turn refuses (re-stat), nothing decoded
    const t2 = new Date(Date.now() + 10_000);
    fs.utimesSync(wav, t2, t2);
    expect(await codeOf(loadBank(check, kit, kitNotes(kit, 'music.calm', 4, 1), undefined, STAND_IN))).toBe('409:instruments_file_changed');
  });
  it('decodes only the frames the plan asks for; refuses above the memory bound and a note out of range; the real planner of the sampler loads the kit', async () => {
    const w = world();
    const kit = w.lib!.kit;
    const check = await ready(w.cfg, kit);
    const notes = kitNotes(kit, 'music.calm', 4, 1);
    expect(notes.length).toBeGreaterThan(10);
    expect(new Set(notes.map((n) => n.part))).toEqual(new Set(['pad', 'arp', 'lead', 'double']));
    const bank = await loadBank(check, kit, notes, undefined, { planZones: (ns, b) => standInPlanZones(ns, b, 100) });
    expect([bank.kitId, bank.version, bank.bank]).toEqual([kit.id, 1, kitBank(kit)]);
    expect(Object.keys(bank.parts).sort()).toEqual(['arp', 'double', 'lead', 'pad']);
    const zones = bank.parts.arp!.instrument.zones;
    const used = zones.filter((z) => z.frames > 0);
    expect(used.length).toBeGreaterThan(0);
    for (const z of used) { expect(z.frames).toBe(100); expect(z.samples.length).toBe(100 * z.channels); }
    for (const z of zones.filter((x) => x.frames === 0)) expect(z.samples.length).toBe(0);
    // the decoded piano zone holds the synthetic tone (24-bit stereo, 0.5 at frame 0 of channel 1's phase shift is sin(0.1)·0.5)
    expect(Math.abs(used[0]!.samples[1]! - Math.round(Math.sin(0.1) * 0.5 * 8388607))).toBeLessThan(2);
    // the strings zones: the smpl loop, and loop_mode following it (no loop_mode in the .sfz)
    const s = bank.parts.pad!.instrument;
    expect(s.zones[0]!.loop).toEqual({ start: Math.floor(22050 / 5), end: 22049 });
    expect(s.regions.every((r) => r.loopMode === 'loop_continuous' && r.loopStart === 4410 && r.loopEnd === 22049)).toBe(true);
    // the bound: 96 MB in production; here a lower bound proves the refusal with tiny files
    expect(await codeOf(loadBank(check, kit, notes, undefined, { ...STAND_IN, maxDecodedBytes: 1000 }))).toBe('409:instruments_too_large');
    expect(await codeOf(loadBank(check, kit, [{ part: 'lead', midi: 120, vel: 1, gate: 100 }], undefined, STAND_IN))).toBe('409:instruments_range');
    // W1's real planZones (merged): the same kit loads with the sampler's own plan, every used zone holds at least the frames the
    // plan asked for, and a zone nobody needs stays empty
    const real = await loadBank(check, kit, notes);
    expect([real.kitId, real.version, real.bank]).toEqual([kit.id, 1, kitBank(kit)]);
    expect(Object.keys(real.parts).sort()).toEqual(['arp', 'double', 'lead', 'pad']);
    const realZones = Object.values(real.parts).flatMap((part) => part!.instrument.zones);
    expect(realZones.some((z) => z.samples.length > 0)).toBe(true);
    for (const z of realZones) expect(z.samples.length % z.channels).toBe(0);
  });
});

// =====================================================================================================================================
describe('fail-closed licences: the whole kit refused, or every source\'s duties carried (the union)', () => {
  it('a share-alike, no-derivatives or unknown licence refuses the whole kit before any file is opened', async () => {
    for (const [src, problem] of [[SYNTHETIC_SOURCES.ccBySa, 'licence_share_alike'], [SYNTHETIC_SOURCES.ccByNd, 'licence_no_derivatives'], [SYNTHETIC_SOURCES.unknown, 'licence_unknown']] as const) {
      const w = world({ piano: src });
      // even with every sample gone, the answer is the licence (it is decided before a file is opened)
      fs.rmSync(path.join(w.lib!.items.piano.dir, 'samples'), { recursive: true });
      fs.rmSync(path.join(w.lib!.items.strings.dir, 'samples'), { recursive: true });
      const c = await checkKit(w.cfg, w.lib!.kit);
      expect([c.state, c.state !== 'ready' && c.error.code, c.state !== 'ready' && c.error.details.problem]).toEqual(['licence', 'instruments_licence', problem]);
      expect(await codeOf(makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 'test', createMusicQueue({}, standInRenderer([])), { cfg: w.cfg, kits: [w.lib!.kit], load: STAND_IN }))).toBe('409:instruments_licence');
    }
    // a CC BY source whose ledger credit is empty: refused too (credit_missing)
    const w = world({ strings: { ...SYNTHETIC_SOURCES.ccBy, credit: '' } });
    expect(((await checkKit(w.cfg, w.lib!.kit)) as { error: ApiError }).error.details.problem).toBe('credit_missing');
  });
  it('a kit mixing a CC BY and a CC BY-NC source carries both records: credit lines, the non-commercial line and warning, the archive rule', async () => {
    const w = world({ strings: SYNTHETIC_SOURCES.ccBy, piano: SYNTHETIC_SOURCES.ccByNc });
    const check = await ready(w.cfg, w.lib!.kit);
    expect(check.sources.map((s) => [s.sourceId, s.licenceId, s.credit, s.nonCommercial, s.shareable])).toEqual([['synthetic-by', 'CC-BY-4.0', true, false, true], ['synthetic-nc', 'CC-BY-NC-4.0', true, true, false]]);
    expect(check.records.map((r) => [r.sourceId, r.licence.id, r.credit?.text, r.flags])).toEqual([
      ['synthetic-by', 'CC-BY-4.0', SYNTHETIC_SOURCES.ccBy.credit, {}],
      ['synthetic-nc', 'CC-BY-NC-4.0', SYNTHETIC_SOURCES.ccByNc.credit, { nonCommercial: true, diskOnly: true }],
    ]);
    const gov = new Governance(w.store);
    const pid = w.store.createProject({ name: 'רישיונות' }).doc.id;
    const r = await addMusic(w.store, gov, owner, pid, { styleId: 'music.calm', bars: 4, seed: 1, start: T.ZERO, instruments: 'recorded' }, createMusicQueue({}, standInRenderer([])), { cfg: w.cfg, kits: [w.lib!.kit], load: STAND_IN });
    const doc = w.store.getProject(pid).doc;
    const asset = doc.assets[r.assetId]!;
    // the made file's records equal the kit's sources exactly
    expect(asset.provenance.instruments!.records).toEqual(check.records);
    expect(validateProject(doc).filter((i) => i.code === 'instruments_provenance')).toEqual([]);
    const credits = collectCredits(doc);
    expect(credits.lines.map((l) => l.text)).toEqual([SYNTHETIC_SOURCES.ccBy.credit, SYNTHETIC_SOURCES.ccByNc.credit]);
    expect(credits.descriptionText('he')).toContain('לשימוש לא מסחרי בלבד');
    expect(credits.nonCommercial.map((n) => n.assetId)).toEqual([r.assetId]);
    expect(libraryExportWarnings(doc).map((x) => x.code)).toContain('non_commercial_content');
    const strip = planArchive(w.store, pid, { library: 'strip' });
    expect(strip.blobs.map((b) => b.hash)).not.toContain(asset.contentHash);
    expect(() => planArchive(w.store, pid)).toThrow(/library/i);
  });
});

// =====================================================================================================================================
describe('the recorded request path (music.ts) and the unchanged ordinary request', () => {
  it('an added recorded track: MUSIC_RECORDED_GENERATOR, provenance.instruments with the bank, the name, one commit and one undo (I15; stand-in renderer until W1)', async () => {
    const w = world();
    const kit = w.lib!.kit;
    const gov = new Governance(w.store);
    const pid = w.store.createProject({ name: 'מוקלט' }).doc.id;
    const rev0 = w.store.getProject(pid).revision;
    const seen: (ResolvedBank | undefined)[] = [];
    const q = createMusicQueue({}, standInRenderer(seen));
    const r = await addMusic(w.store, gov, owner, pid, { styleId: 'music.calm', bars: 4, seed: 3, start: T.ZERO, instruments: 'recorded' }, q, { cfg: w.cfg, kits: [kit], load: STAND_IN });
    expect(seen.map((b) => b?.bank)).toEqual([kitBank(kit)]);
    expect(r.recorded).toEqual({ kitId: kit.id, version: 1, bank: kitBank(kit), parts: ['pad', 'arp', 'lead', 'double'], label: { he: 'כלים מוקלטים — עוד לא הושמעו לאף אחד', en: 'Recorded instruments — nobody has listened yet' } });
    const p = w.store.getProject(pid);
    expect(p.revision).toBe(rev0 + 1);
    const a = p.doc.assets[r.assetId]!;
    expect(a.name).toBe('Calm and warm · 4 bars · recorded instruments.wav'.replace('Calm and warm', a.name.split(' · ')[0]!));
    expect(a.name.endsWith(' · 4 bars · recorded instruments.wav')).toBe(true);
    expect(a.provenance).toMatchObject({ origin: 'generated', procedural: { id: 'music.calm', generator: MUSIC_RECORDED_GENERATOR }, instruments: { kitId: kit.id, kitVersion: 1, sampler: MUSIC_SAMPLER_VERSION, bank: kitBank(kit), records: [{ sourceId: 'synthetic-zero', licence: { id: 'CC0-1.0' } }, { sourceId: 'synthetic-zero' }] } });
    expect(a.provenance.library).toBeUndefined();
    noAbs(r, [w.lib!.root, w.cfg.dataDir]);
    noAbs(a, [w.lib!.root, w.cfg.dataDir]);
    w.store.undo(pid, 'owner', 'undo');
    expect(Object.keys(w.store.getProject(pid).doc.assets)).toEqual([]);
    // the same recorded add of a synth request: a separate render (its own key), MUSIC_GENERATOR, no instruments, the old name
    const s = await addMusic(w.store, gov, owner, pid, { styleId: 'music.calm', bars: 4, seed: 3 }, q, { cfg: w.cfg, kits: [kit], load: STAND_IN });
    expect(seen.length).toBe(2);
    expect(seen[1]).toBeUndefined();
    const sa = w.store.getProject(pid).doc.assets[s.assetId]!;
    expect([sa.provenance.procedural!.generator, sa.provenance.instruments, s.recorded, sa.name.endsWith(' · 4 bars.wav')]).toEqual([MUSIC_GENERATOR, undefined, undefined, true]);
    // no synth asset carries the recorded generator, and the recorded one carries no synth generator
    expect(Object.values(w.store.getProject(pid).doc.assets).filter((x) => x.provenance.procedural?.generator === MUSIC_RECORDED_GENERATOR && !x.provenance.instruments)).toEqual([]);
  });
  it('an ordinary request reaches the renderer exactly as before: no bank, the old key (cache shared with the old form), the old name and provenance', async () => {
    const calls: Record<string, unknown>[] = [];
    const q: MusicQueue = createMusicQueue({}, async (id, bars, seed, opts) => { calls.push({ ...opts, cancel: undefined }); return renderMusic(id, bars, seed, opts); });
    const a = await q.render('music.calm', 4, 1, 'preview');
    const b = await q.render('music.calm', 4, 1, 'preview', undefined, undefined, undefined);
    expect(a).toBe(b); // one key: the cache answered the second
    expect(calls).toEqual([{ cancel: undefined }]);
    const w = world({ library: false });
    const made = await makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1 }, 'test', q, { cfg: w.cfg });
    expect(calls.length).toBe(1); // the add found the preview under the same key: the key of an ordinary request did not change
    expect([made.asset.name.endsWith(' · 4 bars.wav'), made.asset.provenance.procedural!.generator, 'instruments' in made.asset.provenance, 'recorded' in made]).toEqual([true, MUSIC_GENERATOR, false, false]);
  });
  it('a host that never registered the routes\' Config (no library to read) answers 501 instruments_not_built, never synthesised', async () => {
    const w = world();
    const seen: (ResolvedBank | undefined)[] = [];
    expect(await codeOf(makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 'test', createMusicQueue({}, standInRenderer(seen))))).toBe('501:instruments_not_built');
    expect(seen).toEqual([]); // nothing was rendered, with or without a bank
    expect(fs.readdirSync(w.store.blobDir)).toEqual([]);
  });
  it('preview at matched level: x-pf-level-scale ≤ 1, scale × rms equal within 0.1 dB, bytes equal the un-matched preview, headers ASCII (I16 server)', async () => {
    const w = world();
    const q = createMusicQueue({}, standInRenderer([]));
    const o = { cfg: w.cfg, kits: [w.lib!.kit], load: STAND_IN, queue: q };
    const s0 = await musicPreviewAnswer('music.calm', 4, 1, { ...o });
    const r0 = await musicPreviewAnswer('music.calm', 4, 1, { ...o, instruments: 'recorded' });
    const s1 = await musicPreviewAnswer('music.calm', 4, 1, { ...o, match: true });
    const r1 = await musicPreviewAnswer('music.calm', 4, 1, { ...o, instruments: 'recorded', match: true });
    expect([s0.headers, r0.headers['x-pf-instruments']]).toEqual([{ 'x-pf-instruments': 'synth' }, 'recorded']);
    expect(s1.bytes.equals(s0.bytes) && r1.bytes.equals(r0.bytes)).toBe(true);
    const rms = (b: Buffer) => { let s = 0; for (let i = 44; i < b.length; i += 2) s += b.readInt16LE(i) ** 2; return Math.sqrt(s / ((b.length - 44) / 2)); };
    const ss = Number(s1.headers['x-pf-level-scale']), rs = Number(r1.headers['x-pf-level-scale']);
    expect(ss).toBeLessThanOrEqual(1); expect(rs).toBeLessThanOrEqual(1);
    expect(Math.abs(20 * Math.log10((ss * rms(s1.bytes)) / (rs * rms(r1.bytes))))).toBeLessThan(0.1);
    for (const h of [s1.headers, r1.headers]) for (const v of Object.values(h)) expect(/^[\x20-\x7e]+$/.test(v!)).toBe(true);
    // the synth preview of a request without a library and without match: today's preview, no check at all
    const none = world({ library: false });
    expect((await musicPreviewAnswer('music.calm', 4, 1, { cfg: none.cfg, queue: q })).bytes.equals(s0.bytes)).toBe(true);
    expect(await codeOf(musicPreviewAnswer('music.calm', 4, 1, { cfg: none.cfg, queue: q, match: true }))).toBe('409:instruments_library_not_set');
  });
  it('GET /music/kits for a checked synthetic kit: ready (built), not_built only in a build with the flag off, with the sources\' duties and no absolute path', async () => {
    const w = world({ strings: SYNTHETIC_SOURCES.ccBy });
    const built = await listMusicKits(w.cfg, [w.lib!.kit]);
    expect(built.kits.map((k) => [k.kitId, k.state, k.reason, k.sources.map((s) => s.licenceId)])).toEqual([['kit.calm.synthetic', 'ready', null, ['CC-BY-4.0', 'CC0-1.0']]]);
    const now = await listMusicKits(w.cfg, [w.lib!.kit], false);
    expect(now.kits.map((k) => [k.state, k.reason])).toEqual([['not_built', 'instruments_not_built']]);
    noAbs([built, now], [w.lib!.root, w.cfg.dataDir, fs.realpathSync(w.lib!.root)]);
    expect(SYNTHETIC_KIT_LABEL).toMatch(/SYNTHETIC TEST KIT/);
  });
  it('music fit of a recorded track answers 409 instruments_not_fittable and changes nothing', async () => {
    const w = world();
    const gov = new Governance(w.store);
    const pid = w.store.createProject({ name: 'התאמה' }).doc.id;
    const r = await addMusic(w.store, gov, owner, pid, { styleId: 'music.calm', bars: 4, seed: 1, start: T.ZERO, instruments: 'recorded' }, createMusicQueue({}, standInRenderer([])), { cfg: w.cfg, kits: [w.lib!.kit], load: STAND_IN });
    const p = w.store.getProject(pid);
    for (const music of [{ keep: true as const }, { assetId: r.assetId }]) {
      const e = await refusalOf(prepareMusicFit(w.store, pid, p.doc, p.revision, { target: { clipId: r.clipId! }, music, tailor: true }));
      expect(e instanceof ApiError && [e.status, e.code, e.hint]).toEqual([409, 'instruments_not_fittable', expect.stringMatching(/again/)]);
    }
    expect(w.store.getProject(pid).revision).toBe(p.revision);
  });
});
