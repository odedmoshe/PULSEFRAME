/**
 * proof:instruments — the loader and server part (builder W2, wave 7 instruments track): I10–I13, I15, I16 (server), I18, I19 and
 * L-D1–L-D3 of instruments-proof.ts. Imported by the lead's entry point at integration (decisions §5); run alone it does nothing.
 *
 * Everything runs in this process: no port is opened (the REST app and the MCP endpoint are called through their fetch handlers, as
 * the contract tests do). Every library folder is a temporary one holding the LABELLED synthetic test kit written by code
 * (packages/fixtures/src/instruments.ts; never a real sample set; nothing downloaded), deleted when the process exits.
 * NO STAND-IN is used here: every check goes through the production path (checkKit, loadBank with builder W1's planZones, the
 * production renderer, the routes and MCP with the app's kit list set to the synthetic kit). Integrated (wave 7): I15 also renders the
 * same samples decoded WHOLE from the files and held in memory and requires equal bytes, and twice-equal bytes; I13 also measures what
 * is kept after the render once garbage is collected (nothing decoded may stay between renders).
 * A check returns true or the sentence that says why it failed. Timing figures (I13) are one sample each, printed.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as T from '@pulseframe/time';
import { collectCredits, MUSIC_GENERATOR, MUSIC_RECORDED_GENERATOR, type MusicKit } from '@pulseframe/core';
import { Auth } from '@pulseframe/server/auth.ts';
import { Capabilities } from '@pulseframe/server/capabilities.ts';
import { loadConfig, type Config } from '@pulseframe/server/config.ts';
import { Derivatives } from '@pulseframe/server/derive.ts';
import { Exporter, libraryExportWarnings } from '@pulseframe/server/export.ts';
import { planArchive } from '@pulseframe/server/archive.ts';
import { Governance, type Principal } from '@pulseframe/server/governance.ts';
import { createApp } from '@pulseframe/server/http.ts';
import { checkKit, kitBank, kitNotes, loadBank } from '@pulseframe/server/instruments/bank.ts';
import { renderMusic } from '@pulseframe/server/music/render.ts';
import type { ResolvedBank, ResolvedInstrument } from '@pulseframe/server/music/sampler.ts';
import { InstrumentError } from '@pulseframe/server/instruments/contract.ts';
import { markKitHeard } from '@pulseframe/server/instruments/heard.ts';
import { closeLibraryService, libraryServiceFor } from '@pulseframe/server/library/index.ts';
import { createMcp } from '@pulseframe/server/mcp.ts';
import { addMusic, createMusicQueue, makeMusic, musicPreviewAnswer } from '@pulseframe/server/music.ts';
import { parseSfz } from '@pulseframe/server/instruments/sfz.ts';
import { decodePcm, readWavInfo, wavDataEnd } from '@pulseframe/server/instruments/wav.ts';
import { Presence } from '@pulseframe/server/presence.ts';
import { Speech } from '@pulseframe/server/speech.ts';
import { ApiError, Store } from '@pulseframe/server/store.ts';
import { mulberry32, mutateSfz, mutateWav, refreshKitTable, SAFE_REL, synthWav, SYNTHETIC_SOURCES, WAV_SEEDS, writeLedger, writeSyntheticKit, type SyntheticKit, type SyntheticKitOptions } from '../../fixtures/src/instruments.ts';

/** One part of the proof: built or not, and its checks (id → run). Each run returns true (pass) or a failure sentence. */
export interface InstrumentsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }

const root = path.resolve(import.meta.dirname, '../../..');
const art = fs.mkdtempSync(path.join(os.tmpdir(), `pf-instruments-proof-${process.pid}-`));
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const golden = JSON.parse(fs.readFileSync(path.join(root, 'apps/server/src/music.golden.json'), 'utf8')) as { bars: number; seed: number; sha256: Record<string, string> };
const OWNER: Principal = { actor: 'owner', kind: 'user', scopes: ['observe', 'edit'] };

let n = 0;
function world(o: SyntheticKitOptions & { library?: boolean } = {}): { cfg: Config; lib: SyntheticKit | null; store: Store; close: () => void } {
  const base = path.join(art, `w${++n}`);
  const data = path.join(base, 'data');
  fs.mkdirSync(data, { recursive: true });
  const lib = o.library === false ? null : writeSyntheticKit(path.join(base, 'lib'), o);
  const cfg: Config = { ...loadConfig({}), dataDir: data, libraryDir: lib ? lib.root : null, speechPython: null, voicePython: null, speechModelsDir: path.join(data, 'speech-models'), backupDir: null };
  libraryServiceFor(cfg, { noStartupBuild: true });
  const store = new Store(data);
  return { cfg, lib, store, close: () => { closeLibraryService(data); store.close(); } };
}
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${String(e).slice(0, 200)}`; } };
const blobs = (s: Store) => fs.readdirSync(s.blobDir).length;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A recorded render needs W1's sampler and the build flag: this names it when the answer says not built. */
const needsW1 = (c: string) => (c === '501:instruments_not_built' ? 'needs the sampler (W1) and INSTRUMENTS_BUILT: the recorded path answered 501 instruments_not_built' : null);
const recorded = { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const };
const fail = (why: string) => why;

async function I10(): Promise<true | string> {
  const w = world({ library: false });
  try {
    const c = await code(makeMusic(w.store, recorded, 'proof', createMusicQueue(), { cfg: w.cfg }));
    if (c !== '409:instruments_library_not_set') return fail(`no library: ${c}`);
    if (blobs(w.store)) return fail('something was stored for the refused request');
    const made = await makeMusic(w.store, { styleId: 'music.calm', bars: golden.bars, seed: golden.seed }, 'proof', createMusicQueue(), { cfg: w.cfg });
    const bytes = fs.readFileSync(w.store.blobPath(made.asset.contentHash));
    if (sha(bytes) !== golden.sha256['music.calm']) return fail('the same request without instruments did not give the golden bytes');
    if (made.asset.provenance.procedural?.generator !== MUSIC_GENERATOR || made.asset.provenance.instruments) return fail('the synth track does not carry MUSIC_GENERATOR alone');
    return true;
  } finally { w.close(); }
}
async function I11(): Promise<true | string> {
  const w = world();
  try {
    const kit = w.lib!.kit;
    const wav = path.join(w.lib!.items.piano.dir, 'samples', 'piano-c4.wav');
    const keep = fs.readFileSync(wav);
    const ask = () => code(makeMusic(w.store, recorded, 'proof', createMusicQueue(), { cfg: w.cfg, kits: [kit] }));
    fs.rmSync(wav);
    const a = await ask();
    const one = Buffer.from(keep); one[one.length >> 1]! ^= 1; fs.writeFileSync(wav, one);
    const b = await ask();
    fs.writeFileSync(wav, keep);
    writeLedger(w.lib!.root, w.lib!.ledger.map((e) => ({ ...e, commit: 'another-commit' })));
    const c = await ask();
    const got = [a, b, c].join(', ');
    if (got !== '409:instruments_file_missing, 409:instruments_file_changed, 409:instruments_item_version') return fail(got);
    if (blobs(w.store)) return fail('something was stored');
    return true;
  } finally { w.close(); }
}
async function I12(): Promise<true | string> {
  const outside = path.join(art, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'x.wav'), synthWav({ rate: 48000, channels: 1, bits: 16, frames: 10, freq: 1000 }));
  const opened: string[] = [];
  const real = fsp.open.bind(fsp);
  const orig = fsp.open;
  (fsp as { open: typeof fsp.open }).open = ((p: fs.PathLike, ...a: unknown[]) => { opened.push(String(p)); return (real as (...x: unknown[]) => Promise<fs.promises.FileHandle>)(p, ...a); }) as typeof fsp.open;
  const rows: string[] = [];
  try {
    const cases: [string, (w: SyntheticKit) => MusicKit, string][] = [
      ['truncated WAV', (k) => { const f = path.join(k.items.piano.dir, 'samples', 'piano-c5.wav'); fs.writeFileSync(f, fs.readFileSync(f).subarray(0, 200)); return refreshKitTable(k); }, 'instruments_unreadable'],
      ['FLAC', (k) => { fs.writeFileSync(path.join(k.items.piano.dir, 'samples', 'piano-c5.wav'), Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(100)])); return refreshKitTable(k); }, 'instruments_format'],
      ['sample=../../x', (k) => { fs.appendFileSync(path.join(k.items.strings.dir, 'strings.sfz'), '<region> sample=../../../outside/x.wav key=40\n'); return refreshKitTable(k); }, 'instruments_path_escape'],
      ['..\\..\\x', (k) => { fs.appendFileSync(path.join(k.items.strings.dir, 'strings.sfz'), '<region> sample=..\\..\\..\\outside\\x.wav key=40\n'); return refreshKitTable(k); }, 'instruments_path_escape'],
      ['a link out of the folder', (k) => { const f = path.join(k.items.piano.dir, 'samples', 'piano-c4.wav'); fs.rmSync(f); fs.symlinkSync(path.join(outside, 'x.wav'), f); return k.kit; }, 'instruments_path_escape'],
      ['a backslash path inside', (k) => { const f = path.join(k.items.strings.dir, 'strings.sfz'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('default_path=samples/', 'default_path=samples\\')); return refreshKitTable(k); }, 'ready'],
    ];
    for (const [name, mut, want] of cases) {
      const w = world();
      try {
        opened.length = 0;
        const c = await checkKit(w.cfg, mut(w.lib!));
        const got = c.state === 'ready' ? 'ready' : c.error.code;
        const libReal = fs.realpathSync(w.lib!.root);
        const out = opened.filter((p) => !p.startsWith(libReal));
        if (got !== want || out.length || !opened.length) rows.push(`${name}: ${got}${out.length ? `, opened outside: ${out.length}` : ''}`);
      } finally { w.close(); }
    }
  } finally { (fsp as { open: typeof fsp.open }).open = orig; }
  return rows.length ? fail(rows.join('; ')) : true;
}
/** A full garbage collection (the flag set at run time; the proof is not started with --expose-gc). */
function collector(): () => void {
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}
async function I13(): Promise<true | string> {
  // a 55 MB synthetic kit: 6 strings zones of 44.1 kHz mono 16-bit and 6 piano zones of 48 kHz stereo 24-bit
  const w = world({ stringsSeconds: 60, pianoSeconds: 26 });
  try {
    const bytes = w.lib!.kit.instruments.flatMap((i) => i.files).reduce((s, f) => s + f.bytes, 0);
    const h = monitorEventLoopDelay({ resolution: 5 });
    const m0 = process.memoryUsage();
    const t0 = performance.now();
    h.enable();
    // the peak, sampled while the render yields (the bound is on the extra memory of one render at a time, decisions §4.6)
    let peak = 0;
    const sampler = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed + m.arrayBuffers - m0.heapUsed - m0.arrayBuffers); }, 5);
    const bars = 64; // 128 s at the calm tempo
    const c = await code(makeMusic(w.store, { ...recorded, bars }, 'proof', createMusicQueue(), { cfg: w.cfg, kits: [w.lib!.kit] }));
    h.disable();
    clearInterval(sampler);
    const ms = performance.now() - t0, m1 = process.memoryUsage();
    const peakMb = peak / 1048576;
    if (needsW1(c)) return fail(needsW1(c)!);
    if (c !== 'ok') return fail(`the 128 s recorded render answered ${c}`);
    const factor = 128_000 / ms, lag = h.max / 1e6, growth = (m1.heapUsed + m1.arrayBuffers - m0.heapUsed - m0.arrayBuffers) / 1048576;
    // nothing decoded is kept between renders: after a full garbage collection the growth over the start is far below the kit
    const gc = collector();
    gc(); gc();
    const m2 = process.memoryUsage();
    const kept = (m2.heapUsed + m2.arrayBuffers - m0.heapUsed - m0.arrayBuffers) / 1048576;
    console.log(`I13 one sample: kit ${(bytes / 1048576).toFixed(1)} MB, ${factor.toFixed(1)}× real time, event-loop max ${lag.toFixed(1)} ms, heap+arrayBuffers growth ${growth.toFixed(1)} MB at the end, peak ${peakMb.toFixed(1)} MB, kept after GC ${kept.toFixed(1)} MB`);
    if (factor < 5 || lag >= 100 || growth >= 160 || peakMb >= 160) return fail(`${factor.toFixed(1)}× real time, event-loop max ${lag.toFixed(1)} ms, growth ${growth.toFixed(1)} MB, peak ${peakMb.toFixed(1)} MB`);
    if (kept >= 32) return fail(`${kept.toFixed(1)} MB were still held after the render and a full garbage collection (the decoded samples must not be kept)`);
    return true;
  } finally { w.close(); }
}
async function I15(): Promise<true | string> {
  // zones long enough that the plan really cuts them, so the partial decode is tested against the whole one
  const w = world({ pianoSeconds: 3, stringsSeconds: 2 });
  try {
    const kit = w.lib!.kit;
    const gov = new Governance(w.store);
    const pid = w.store.createProject({ name: 'proof' }).doc.id;
    const rev0 = w.store.getProject(pid).revision;
    let r;
    try { r = await addMusic(w.store, gov, OWNER, pid, { ...recorded, start: T.ZERO }, createMusicQueue(), { cfg: w.cfg, kits: [kit] }); } catch (e) { const c = e instanceof ApiError ? `${e.status}:${e.code}` : String(e); return fail(needsW1(c) ?? c); }
    const p = w.store.getProject(pid);
    const a = p.doc.assets[r.assetId]!;
    if (p.revision !== rev0 + 1) return fail('not one commit');
    if (a.provenance.procedural?.generator !== MUSIC_RECORDED_GENERATOR || a.provenance.instruments?.bank !== kitBank(kit)) return fail('the generator or the bank is not the recorded one');
    if (!a.name.endsWith(' · recorded instruments.wav')) return fail(`the name is ${a.name}`);
    const check = await checkKit(w.cfg, kit);
    if (check.state !== 'ready') return fail(`the kit check answered ${check.state}`);
    if (JSON.stringify(a.provenance.instruments?.records) !== JSON.stringify(check.records)) return fail('provenance.instruments.records are not exactly the kit\'s library records');
    // the stored bytes = the render of the planned, partly decoded bank = the render of the same samples decoded whole from the files
    const stored = fs.readFileSync(w.store.blobPath(a.contentHash));
    const notes = kitNotes(kit, 'music.calm', recorded.bars, recorded.seed);
    const partial = await loadBank(check, kit, notes);
    const whole = wholeBank(partial, w.lib!);
    const cut = Object.values(partial.parts).flatMap((x) => x!.instrument.zones).some((z, i) => z.frames > 0 && z.frames < Object.values(whole.parts).flatMap((x) => x!.instrument.zones)[i]!.frames);
    if (!cut) return fail('the plan decoded every file whole: the partial decode was not tested');
    const viaWhole = (await renderMusic('music.calm', recorded.bars, recorded.seed, { bank: whole, kit })).wav;
    if (!stored.equals(viaWhole)) return fail('the made bytes differ from the render of the same samples decoded whole');
    const second = await makeMusic(w.store, recorded, 'proof', createMusicQueue(), { cfg: w.cfg, kits: [kit] });
    if (second.asset.contentHash !== a.contentHash) return fail('a second run gave other bytes');
    console.log(`I15 one sample: ${sha(stored).slice(0, 16)}… equal to the whole-decode render and to a second run; records ${check.records.length}`);
    w.store.undo(pid, 'owner', 'undo');
    if (Object.keys(w.store.getProject(pid).doc.assets).length) return fail('one undo did not remove it');
    const s = await makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1 }, 'proof', createMusicQueue(), { cfg: w.cfg, kits: [kit] });
    if (s.asset.provenance.instruments || s.asset.provenance.procedural?.generator !== MUSIC_GENERATOR) return fail('a synth asset carries the recorded marks');
    return true;
  } finally { w.close(); }
}
/** The same bank with every zone decoded WHOLE straight from its file (no plan). */
function wholeBank(bank: ResolvedBank, lib: SyntheticKit): ResolvedBank {
  const memo = new Map<string, ResolvedInstrument>();
  const parts: ResolvedBank['parts'] = {};
  for (const [role, part] of Object.entries(bank.parts) as [keyof ResolvedBank['parts'], NonNullable<ResolvedBank['parts']['pad']>][]) {
    let ins = memo.get(part.instrument.id);
    if (!ins) {
      const dir = lib.items[part.instrument.id as 'strings' | 'piano'].dir;
      ins = { ...part.instrument, zones: part.instrument.zones.map((z) => { const b = fs.readFileSync(path.join(dir, ...z.path.split('/'))); const info = readWavInfo(b); return { ...z, frames: info.frames, samples: decodePcm(b.subarray(info.dataOffset, wavDataEnd(info)), info, 0, info.frames) }; }) };
      memo.set(part.instrument.id, ins);
    }
    parts[role] = { ...part, instrument: ins };
  }
  return { ...bank, parts };
}
async function I16(): Promise<true | string> {
  // the heard route: agents, an observer and the phone drop are refused; the owner's mark is kept
  const w = world();
  try {
    const kit = w.lib!.kit;
    for (const p of [{ actor: 'agent:a', kind: 'agent', scopes: ['observe', 'edit'], mode: 'edit' }, { actor: 'agent:o', kind: 'agent', scopes: ['observe'], mode: 'observe' }, { actor: 'phone:drp_1', kind: 'user', scopes: ['observe'] }] as Principal[]) {
      try { markKitHeard(w.cfg.dataDir, p, kit.id, true, '2026-11-25T00:00:00Z', [kit]); return fail(`${p.actor} could mark`); } catch (e) { if (!(e instanceof ApiError) || e.status !== 403 || e.code !== 'owner_required') return fail(`${p.actor}: ${String(e)}`); }
    }
    if (markKitHeard(w.cfg.dataDir, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }, kit.id, true, '2026-11-25T00:00:00Z', [kit]).heard?.at !== '2026-11-25T00:00:00Z') return fail('the owner\'s mark was not kept');
    // the level match needs two real renders
    const o = { cfg: w.cfg, kits: [kit], queue: createMusicQueue() };
    let s0, r0, s1, r1;
    try {
      s0 = await musicPreviewAnswer('music.calm', 4, 1, o); r0 = await musicPreviewAnswer('music.calm', 4, 1, { ...o, instruments: 'recorded' });
      s1 = await musicPreviewAnswer('music.calm', 4, 1, { ...o, match: true }); r1 = await musicPreviewAnswer('music.calm', 4, 1, { ...o, instruments: 'recorded', match: true });
    } catch (e) { const c = e instanceof ApiError ? `${e.status}:${e.code}` : String(e); return fail(needsW1(c) ?? c); }
    const rms = (b: Buffer) => { let s = 0; for (let i = 44; i < b.length; i += 2) s += b.readInt16LE(i) ** 2; return Math.sqrt(s / ((b.length - 44) / 2)); };
    const db = 20 * Math.log10((Number(s1.headers['x-pf-level-scale']) * rms(s1.bytes)) / (Number(r1.headers['x-pf-level-scale']) * rms(r1.bytes)));
    console.log(`I16 one sample: scales ${s1.headers['x-pf-level-scale']} / ${r1.headers['x-pf-level-scale']}, difference ${db.toFixed(3)} dB`);
    if (!s1.bytes.equals(s0.bytes) || !r1.bytes.equals(r0.bytes)) return fail('the matched bytes differ from the un-matched preview');
    if (!(Math.abs(db) < 0.1)) return fail(`scale × rms differ by ${db.toFixed(3)} dB`);
    return true;
  } finally { w.close(); }
}
async function I18(): Promise<true | string> {
  const w = world();
  const cfg = { ...w.cfg, port: 9 };
  const auth = new Auth(cfg);
  const gov = new Governance(w.store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const exporter = new Exporter(w.store, null as never, () => '', path.join(cfg.dataDir, 'no-web-dist'));
  const capabilities = new Capabilities(w.store, cfg), derivatives = new Derivatives(w.store), speech = new Speech(w.store, cfg);
  const mcp = createMcp(w.store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
  const app = createApp(cfg, w.store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech, { musicKits: [w.lib!.kit] });
  try {
    const token = gov.createGrant({ name: 'proof', mode: 'edit' }, { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] }).token;
    const h = { host: '127.0.0.1:9', authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const pid = w.store.createProject({ name: 'proof' }).doc.id;
    const answers: string[] = [];
    const heads: string[] = [];
    const kits = await app.fetch(new Request('http://127.0.0.1:9/api/v1/music/kits', { headers: h }));
    answers.push(await kits.text());
    const pre = await app.fetch(new Request('http://127.0.0.1:9/api/v1/music/music.calm/audio?bars=4&instruments=recorded&match=1', { headers: h }));
    pre.headers.forEach((v) => heads.push(v));
    if (pre.status !== 200) answers.push(await pre.text());
    const rpc = await mcp(new Request('http://127.0.0.1:9/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_builtin_music', arguments: { projectId: pid, ...recorded } } }) }));
    const text = await rpc.text();
    answers.push(text);
    const all = answers.join('\n');
    if (all.includes(w.lib!.root) || all.includes(fs.realpathSync(w.lib!.root)) || all.includes(cfg.dataDir)) return fail('an answer holds an absolute path');
    if (heads.some((v) => !/^[\x20-\x7e]*$/.test(v))) return fail('a header value is not ASCII');
    if (pre.status !== 200 || !/kit\.calm/.test(text) || !/nobody has listened yet/.test(text)) return fail(`the REST preview answered ${pre.status} and MCP add_builtin_music did not report the kit and the label: needs the sampler (W1), INSTRUMENTS_BUILT and the lead's wiring of the server Config into http.ts/mcp.ts (MusicMakeOptions.cfg) and of the preview headers (musicPreviewAnswer)`);
    return true;
  } finally {
    await mcp.close(); await capabilities.stop(); await derivatives.stop(); (app as { browserExport?: { stop(): void } }).browserExport?.stop(); w.close();
  }
}
async function I19(): Promise<true | string> {
  const rnd = mulberry32(0x5eed);
  const t0 = performance.now();
  const others: string[] = [], asked: string[] = [];
  for (let i = 0; i < 5000; i++) {
    const b = mutateWav(WAV_SEEDS[i % WAV_SEEDS.length]!, rnd);
    try { const info = readWavInfo(b); decodePcm(b.subarray(info.dataOffset, wavDataEnd(info)), info, 0, info.frames); } catch (e) { if (!(e instanceof InstrumentError)) others.push(String(e)); }
  }
  for (let i = 0; i < 5000; i++) {
    try { parseSfz(mutateSfz(rnd), (p) => { asked.push(p); if (p === 'inc/common.sfzh') return 'ampeg_attack=0.01'; throw new InstrumentError('unreadable', 'no such include'); }); } catch (e) { if (!(e instanceof InstrumentError)) others.push(String(e)); }
  }
  const ms = performance.now() - t0;
  console.log(`I19 one sample: 10,000 mutations in ${Math.round(ms)} ms`);
  if (others.length) return fail(`${others.length} errors other than InstrumentError: ${others[0]}`);
  if (asked.some((p) => !SAFE_REL(p))) return fail('the include callback was asked for an unsafe path');
  return ms < 60_000 ? true : fail(`${Math.round(ms)} ms`);
}
async function madeWith(o: SyntheticKitOptions): Promise<{ w: ReturnType<typeof world>; pid: string; assetId: string } | string> {
  const w = world(o);
  const gov = new Governance(w.store);
  const pid = w.store.createProject({ name: 'proof' }).doc.id;
  try {
    const r = await addMusic(w.store, gov, OWNER, pid, { ...recorded, start: T.ZERO }, createMusicQueue(), { cfg: w.cfg, kits: [w.lib!.kit] });
    return { w, pid, assetId: r.assetId };
  } catch (e) { w.close(); const c = e instanceof ApiError ? `${e.status}:${e.code}` : String(e); return needsW1(c) ?? c; }
}
async function LD1(): Promise<true | string> {
  const m = await madeWith({ strings: SYNTHETIC_SOURCES.ccBy });
  if (typeof m === 'string') return fail(m);
  try {
    const text = collectCredits(m.w.store.getProject(m.pid).doc).descriptionText('he');
    return text.includes(SYNTHETIC_SOURCES.ccBy.credit) ? true : fail('the credit is not in the description text');
  } finally { m.w.close(); }
}
async function LD2(): Promise<true | string> {
  const m = await madeWith({ piano: SYNTHETIC_SOURCES.ccByNc });
  if (typeof m === 'string') return fail(m);
  try {
    const doc = m.w.store.getProject(m.pid).doc;
    const a = doc.assets[m.assetId]!;
    if (!collectCredits(doc).nonCommercial.some((x) => x.assetId === m.assetId)) return fail('not marked non-commercial');
    if (!libraryExportWarnings(doc).some((x) => x.code === 'non_commercial_content')) return fail('the export does not warn');
    if (planArchive(m.w.store, m.pid, { library: 'strip' }).blobs.some((b) => b.hash === a.contentHash)) return fail('the shared archive holds its bytes');
    return true;
  } finally { m.w.close(); }
}
async function LD3(): Promise<true | string> {
  const rows: string[] = [];
  for (const src of [SYNTHETIC_SOURCES.ccBySa, SYNTHETIC_SOURCES.ccByNd, SYNTHETIC_SOURCES.unknown]) {
    const w = world({ piano: src });
    try {
      const c = await code(makeMusic(w.store, recorded, 'proof', createMusicQueue(), { cfg: w.cfg, kits: [w.lib!.kit] }));
      if (c !== '409:instruments_licence' || blobs(w.store)) rows.push(`${src.id}: ${c}`);
    } finally { w.close(); }
  }
  return rows.length ? fail(rows.join('; ')) : true;
}

export const INSTRUMENTS_LOADER_PART: InstrumentsProofPart = {
  built: true,
  checks: { I10, I11, I12, I13, I15, I16, I18, I19, 'L-D1': LD1, 'L-D2': LD2, 'L-D3': LD3 },
};
