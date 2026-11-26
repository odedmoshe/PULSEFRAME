/**
 * Integration of recorded instruments (wave 7 instruments track): builder W1's REAL plan (sampler.ts planZones) meets builder W2's
 * REAL decode of only the planned frames (bank.ts loadBank), then the real renderer (render.ts renderMusic → renderSampled) and the
 * production queue and makeMusic path. Every file is the LABELLED synthetic test kit written by code under a temporary library folder
 * (packages/fixtures/src/instruments.ts; never a real sample set). Nothing here says how anything sounds: the checks are bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { MUSIC_GENERATOR, MUSIC_RECORDED_GENERATOR, MUSIC_SAMPLER_VERSION, RECORDED_NAME_SUFFIX, type MusicKit } from '@pulseframe/core';
import { refreshKitTable, SYNTHETIC_KIT_LABEL, writeSyntheticKit, type SyntheticKit, type SyntheticKitOptions } from '../../../../packages/fixtures/src/instruments.ts';
import { loadConfig, type Config } from '../config.ts';
import { Governance, type Principal } from '../governance.ts';
import { closeLibraryService, libraryServiceFor } from '../library/index.ts';
import { addMusic, createMusicQueue, makeMusic } from '../music.ts';
import { renderMusic, type RenderedMusic } from '../music/render.ts';
import { planZones, type ResolvedBank } from '../music/sampler.ts';
import { ApiError, Store } from '../store.ts';
import { checkKit, kitBank, kitNotes, loadBank, type ReadyKit } from './bank.ts';
import { decodePcm, readWavInfo, wavDataEnd } from './wav.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const configs: string[] = [];
afterEach(() => { for (const d of configs.splice(0)) closeLibraryService(d); });
function world(o: SyntheticKitOptions = {}): { cfg: Config; lib: SyntheticKit; store: Store } {
  const data = tmp('pf-insI-data-');
  const lib = writeSyntheticKit(tmp('pf-insI-lib-'), o);
  const cfg: Config = { ...loadConfig({}), dataDir: data, libraryDir: lib.root };
  libraryServiceFor(cfg, { noStartupBuild: true });
  configs.push(data);
  return { cfg, lib, store: new Store(data) };
}
const ready = async (cfg: Config, kit: MusicKit): Promise<ReadyKit> => { const c = await checkKit(cfg, kit); if (c.state !== 'ready') throw c.error; return c; };
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${String(e)}`; } };
const owner: Principal = { actor: 'owner', kind: 'user', scopes: ['observe', 'edit'] };
/** The same bank with every used zone decoded WHOLE straight from the file on disk (no plan): what the partial decode must equal. */
function wholeBank(bank: ResolvedBank, lib: SyntheticKit): ResolvedBank {
  const memo = new Map<string, ResolvedBank['parts'][keyof ResolvedBank['parts']]>();
  const parts: ResolvedBank['parts'] = {};
  for (const [role, p] of Object.entries(bank.parts) as [keyof ResolvedBank['parts'], NonNullable<ResolvedBank['parts'][keyof ResolvedBank['parts']]>][]) {
    let whole = memo.get(p.instrument.id);
    if (!whole) {
      const dir = lib.items[p.instrument.id as 'strings' | 'piano'].dir;
      const zones = p.instrument.zones.map((z) => {
        const b = fs.readFileSync(path.join(dir, ...z.path.split('/')));
        const info = readWavInfo(b);
        return { ...z, frames: info.frames, samples: decodePcm(b.subarray(info.dataOffset, wavDataEnd(info)), info, 0, info.frames) };
      });
      whole = { ...p, instrument: { ...p.instrument, zones } };
      memo.set(p.instrument.id, whole);
    }
    parts[role] = { ...whole, gainDb: p.gainDb, vel: p.vel, ...(p.attackMax !== undefined ? { attackMax: p.attackMax } : {}), ...(p.releaseMax !== undefined ? { releaseMax: p.releaseMax } : {}), ...(p.edge !== undefined ? { edge: p.edge } : {}) };
  }
  return { ...bank, parts };
}

describe('W1 plan meets W2 decode: a recorded track from files on disk', () => {
  it('checkKit → loadBank (planZones, only the planned frames) → renderSampled equals the render from the same samples decoded whole, twice equal', async () => {
    // zones long enough that the plan really cuts them (piano 3 s, strings 2 s)
    const w = world({ pianoSeconds: 3, stringsSeconds: 2 });
    const kit = w.lib.kit;
    expect(w.lib.label).toBe(SYNTHETIC_KIT_LABEL);
    const check = await ready(w.cfg, kit);
    const notes = kitNotes(kit, 'music.calm', 4, 1);
    const partial = await loadBank(check, kit, notes); // W1's planZones by default
    const zones = Object.values(partial.parts).flatMap((p) => p!.instrument.zones);
    const whole = wholeBank(partial, w.lib);
    const wholeZones = Object.values(whole.parts).flatMap((p) => p!.instrument.zones);
    // the plan really decoded less than the files hold (otherwise this test would prove nothing), and a zone nobody needs stays empty
    expect(zones.some((z, i) => z.frames > 0 && z.frames < wholeZones[i]!.frames)).toBe(true);
    expect(zones.some((z) => z.frames === 0 && z.samples.length === 0)).toBe(true);
    // every decoded prefix equals the whole decode's first frames, sample for sample
    for (let i = 0; i < zones.length; i++) expect(Buffer.from(zones[i]!.samples.buffer).equals(Buffer.from(wholeZones[i]!.samples.buffer, 0, zones[i]!.samples.byteLength))).toBe(true);
    // the plan of the whole bank needs no more than what was decoded
    const plan = planZones(notes, whole);
    const byId = new Map(Object.values(partial.parts).map((p) => [p!.instrument.id, p!.instrument] as const));
    expect(plan.needs.length).toBeGreaterThan(0);
    const wholeById = new Map(Object.values(whole.parts).map((p) => [p!.instrument.id, p!.instrument] as const));
    // each planned zone holds exactly what the plan asked for, never more than the file (decoded frames = min(need, file))
    for (const n of plan.needs) expect(byId.get(n.instrument)!.zones[n.zone]!.frames).toBe(Math.min(n.frames, wholeById.get(n.instrument)!.zones[n.zone]!.frames));
    const a = await renderMusic('music.calm', 4, 1, { bank: partial, kit });
    const b = await renderMusic('music.calm', 4, 1, { bank: whole, kit });
    expect(a.wav.equals(b.wav)).toBe(true);
    const again = await renderMusic('music.calm', 4, 1, { bank: await loadBank(check, kit, notes), kit });
    expect(again.wav.equals(a.wav)).toBe(true);
    // the renderer checks the bank against the kit it was loaded from: without that kit (not in MUSIC_KITS) or with a kit of another
    // style it refuses before any sample is made (the defect found at integration: it compared with MUSIC_KITS only)
    await expect(renderMusic('music.calm', 4, 1, { bank: partial })).rejects.toThrow(/not the kit of music\.calm/);
    await expect(renderMusic('music.calm', 4, 1, { bank: partial, kit: { ...kit, styleId: 'music.pop' } })).rejects.toThrow(/not the kit of music\.calm/);
    // and it is not the synthesiser's track
    expect((await renderMusic('music.calm', 4, 1)).wav.equals(a.wav)).toBe(false);
  }, 60_000);

  it('edge notes (kit part edge): with strings regions C ± 5 up to C5 only, pad 66 (a gap) and double 78 (above the range) play with edge 2; the partial decode equals the whole one', async () => {
    const w = world({ pianoSeconds: 3, stringsSeconds: 2 });
    // the strings keep the regions of C2..C5 (keys c − 5 .. c + 5): 42, 54, 66 are gaps, 78 and above are past the top (77)
    const sfz = path.join(w.lib.items.strings.dir, 'strings.sfz');
    fs.writeFileSync(sfz, fs.readFileSync(sfz, 'utf8').split('\n').filter((l) => !/pitch_keycenter=c[67]/.test(l))
      .map((l) => l.replace(/lokey=(\d+) hikey=(\d+)/, (_m, lo: string, hi: string) => `lokey=${Number(lo) + 1} hikey=${hi}`)).join('\n'));
    const table = refreshKitTable(w.lib);
    const without: MusicKit = table as MusicKit;
    const kit: MusicKit = { ...table, parts: { ...table.parts, pad: { ...table.parts.pad!, edge: 2 }, double: { ...table.parts.double!, edge: 2 } } } as MusicKit;
    const notes = kitNotes(kit, 'music.calm', 4, 1);
    expect(notes.some((n) => n.part === 'pad' && n.midi === 66) && notes.some((n) => n.part === 'double' && n.midi === 78)).toBe(true);
    // without edge the same kit is refused before anything is decoded (instruments_range); with edge it loads
    expect(await codeOf(loadBank(await ready(w.cfg, without), without, notes))).toBe('409:instruments_range');
    const check = await ready(w.cfg, kit);
    expect(check.bank).not.toBe((await ready(w.cfg, without)).bank); // the bank names the edge
    const partial = await loadBank(check, kit, notes);
    expect(partial.parts.pad!.edge).toBe(2);
    const whole = wholeBank(partial, w.lib);
    const zones = Object.values(partial.parts).flatMap((p) => p!.instrument.zones), wholeZones = Object.values(whole.parts).flatMap((p) => p!.instrument.zones);
    expect(zones.some((z, i) => z.frames > 0 && z.frames < wholeZones[i]!.frames)).toBe(true);
    const plan = planZones(notes, whole);
    expect(plan.outOfRange).toBeNull();
    const byId = new Map(Object.values(partial.parts).map((p) => [p!.instrument.id, p!.instrument] as const));
    const wholeById = new Map(Object.values(whole.parts).map((p) => [p!.instrument.id, p!.instrument] as const));
    for (const n of plan.needs) expect(byId.get(n.instrument)!.zones[n.zone]!.frames).toBe(Math.min(n.frames, wholeById.get(n.instrument)!.zones[n.zone]!.frames));
    const a = await renderMusic('music.calm', 4, 1, { bank: partial, kit });
    const b = await renderMusic('music.calm', 4, 1, { bank: whole, kit });
    expect(a.wav.equals(b.wav)).toBe(true);
  }, 60_000);

  it('the production queue and makeMusic: the made asset is the recorded render, MUSIC_RECORDED_GENERATOR, the kit\'s records, the name, one commit, one undo', async () => {
    const w = world();
    const kit = w.lib.kit;
    const check = await ready(w.cfg, kit);
    const gov = new Governance(w.store);
    const pid = w.store.createProject({ name: 'מוקלט' }).doc.id;
    const rev0 = w.store.getProject(pid).revision;
    const r = await addMusic(w.store, gov, owner, pid, { styleId: 'music.calm', bars: 4, seed: 1, start: T.ZERO, instruments: 'recorded' }, createMusicQueue(), { cfg: w.cfg, kits: [kit] });
    const p = w.store.getProject(pid);
    expect(p.revision).toBe(rev0 + 1);
    const a = p.doc.assets[r.assetId]!;
    const bytes = fs.readFileSync(w.store.blobPath(a.contentHash));
    const direct = await renderMusic('music.calm', 4, 1, { bank: await loadBank(check, kit, kitNotes(kit, 'music.calm', 4, 1)), kit });
    expect(bytes.equals(direct.wav)).toBe(true);
    expect(a.provenance.procedural?.generator).toBe(MUSIC_RECORDED_GENERATOR);
    expect(a.provenance.instruments).toEqual({ kitId: kit.id, kitVersion: 1, sampler: MUSIC_SAMPLER_VERSION, bank: kitBank(kit), records: check.records });
    expect(a.name.endsWith(` · 4 bars${RECORDED_NAME_SUFFIX}.wav`)).toBe(true);
    expect(RECORDED_NAME_SUFFIX).toBe(' · recorded instruments');
    // a second, separate make gives the same bytes
    const again = await makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' }, 'test', createMusicQueue(), { cfg: w.cfg, kits: [kit] });
    expect(again.asset.contentHash).toBe(a.contentHash);
    w.store.undo(pid, 'owner', 'undo');
    expect(Object.keys(w.store.getProject(pid).doc.assets)).toEqual([]);
    const synth = await makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1 }, 'test', createMusicQueue(), { cfg: w.cfg, kits: [kit] });
    expect([synth.asset.provenance.procedural?.generator, synth.asset.provenance.instruments, synth.asset.name.endsWith(' · 4 bars.wav')]).toEqual([MUSIC_GENERATOR, undefined, true]);
  }, 60_000);

  it('refused BEFORE anything is made or stored, never synthesised under a recorded name: a checksum that differs, a missing file, a note out of range, a kit over the memory bound', async () => {
    const rows: string[] = [];
    const ask = async (w: ReturnType<typeof world>, kit: MusicKit, extra: { maxDecodedBytes?: number } = {}) => {
      const calls: (ResolvedBank | undefined)[] = [];
      const q = createMusicQueue({}, async (id, bars, seed, opts): Promise<RenderedMusic> => { calls.push(opts.bank); return renderMusic(id, bars, seed, opts); });
      const c = await codeOf(makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' }, 'test', q, { cfg: w.cfg, kits: [kit], ...(extra.maxDecodedBytes ? { load: { planZones, maxDecodedBytes: extra.maxDecodedBytes } } : {}) }));
      return { c, calls, stored: fs.readdirSync(w.store.blobDir).length };
    };
    {
      const w = world();
      const f = path.join(w.lib.items.piano.dir, 'samples', 'piano-c4.wav');
      const b = fs.readFileSync(f); b[b.length - 9]! ^= 1; fs.writeFileSync(f, b); // same size, one byte off the kit table
      rows.push(`changed ${JSON.stringify(await ask(w, w.lib.kit))}`);
    }
    {
      const w = world();
      fs.rmSync(path.join(w.lib.items.strings.dir, 'samples', 'strings-c3.wav'));
      rows.push(`missing ${JSON.stringify(await ask(w, w.lib.kit))}`);
    }
    {
      // the piano keeps one region only (C4 ± 1): the calm arp and lead reach notes no region plays
      const w = world();
      const sfz = path.join(w.lib.items.piano.dir, 'piano.sfz');
      fs.writeFileSync(sfz, fs.readFileSync(sfz, 'utf8').split('\n').filter((l) => !l.startsWith('<region>') || l.includes('pitch_keycenter=c4')).join('\n').replace(/lokey=54 hikey=65/, 'lokey=59 hikey=61'));
      rows.push(`range ${JSON.stringify(await ask(w, refreshKitTable(w.lib)))}`);
    }
    {
      // the real planner with a lower bound than the production 96 MB (LoadDeps never raises it): tiny files prove the refusal
      const w = world();
      rows.push(`large ${JSON.stringify(await ask(w, w.lib.kit, { maxDecodedBytes: 1000 }))}`);
    }
    expect(rows).toEqual([
      'changed {"c":"409:instruments_file_changed","calls":[],"stored":0}',
      'missing {"c":"409:instruments_file_missing","calls":[],"stored":0}',
      'range {"c":"409:instruments_range","calls":[],"stored":0}',
      'large {"c":"409:instruments_too_large","calls":[],"stored":0}',
    ]);
  }, 60_000);
});

describe('the finished track\'s tail does not hold the event loop (found by proof check I13 at integration)', () => {
  it('makeMusic yields between checking the bytes, hashing them and writing them (each a few tens of ms for 128 s); bytes unchanged', async () => {
    const data = tmp('pf-insI-tail-');
    const store = new Store(data);
    const r = await renderMusic('music.calm', 4, 1);
    let ticks = 0, ticking = true;
    const tick = () => { ticks++; if (ticking) setImmediate(tick); };
    const atWrite: number[] = [];
    const origSync = fs.writeFileSync.bind(fs) as (...x: unknown[]) => void, origProm = fs.promises.writeFile.bind(fs.promises) as (...x: unknown[]) => Promise<void>;
    const sync = vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, ...a: unknown[]) => { if (String(f).includes('music_')) atWrite.push(ticks); return origSync(f, ...a); }) as typeof fs.writeFileSync);
    const prom = vi.spyOn(fs.promises, 'writeFile').mockImplementation(((f: fs.PathLike, ...a: unknown[]) => { if (String(f).includes('music_')) atWrite.push(ticks); return origProm(f, ...a); }) as typeof fs.promises.writeFile);
    try {
      // the renderer resolves and starts the tick chain: from here on every turn the event loop gets is counted
      const made = await makeMusic(store, { styleId: 'music.calm', bars: 4, seed: 1 }, 'test', createMusicQueue({}, async () => { setImmediate(tick); return r; }));
      expect(fs.readFileSync(store.blobPath(made.asset.contentHash)).equals(r.wav)).toBe(true);
    } finally { ticking = false; sync.mockRestore(); prom.mockRestore(); store.close(); }
    // before the fix the check, the hash and the write ran in one synchronous stretch: no turn before the write (atWrite [0])
    expect(atWrite.length).toBe(1);
    expect(atWrite[0]).toBeGreaterThanOrEqual(2);
  });
});
