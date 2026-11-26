/**
 * The kit checker and loader of recorded instruments (wave 7 instruments track; decisions §4.3). BUILDER W2.
 * Reads the ledger only through LibraryService.ledgerEntries, files only through library/paths.ts openInside, licences only through
 * core licenceDuties and kitLibraryRecord. Memory: at most INSTRUMENTS_LIMITS.maxDecodedBytes of decoded samples per render; nothing
 * decoded is kept after the render (no cross-render cache in v1); the only thing kept between calls is the file-hash map.
 *
 * ORDER (fail-closed, nothing made before every step passed)
 *   1. library folder set (else library_not_set); kit calibrated (else not_calibrated: v1's only kit until the laptop's check L1);
 *   2. the ledger through ledgerEntries: every instrument's item present (item_missing) at the pinned commit / sha256 (item_version);
 *   3. every source's duties through core licenceDuties + kitLibraryRecord: share-alike, no-derivatives, unknown or a missing credit
 *      refuses the WHOLE kit (licence) before any file is opened;
 *   4. every kit file through openInside (a link out, '..', a NUL… → path_escape; nothing outside the item is opened), its size, then
 *      its sha256 against the kit table (file_missing / file_changed); the .sfz parsed and every sample's WAV header read
 *      (unreadable / format) — a sample the .sfz names that the table does not list refuses too.
 *   Inside the queue turn (loadBank): parse again, plan the zones for the notes (range), re-stat every file opened against the check
 *   (file_changed), and decode only the frames planned (too_large above the bound).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  INSTRUMENTS_LIMITS, kitBankInput, kitCalibrated, kitKey, kitLibraryRecord, licenceDuties, musicLayout,
  type KitPartRole, type KitState, type LedgerEntry, type LibraryRecord, type MusicKit, type MusicKitStatus,
} from '@pulseframe/core';
import type { Config } from '../config.ts';
import { libraryServiceFor } from '../library/index.ts';
import { openInside, type OpenedFile } from '../library/paths.ts';
import { arrange } from '../music/arrange.ts';
import { compose } from '../music/compose.ts';
import { planZones as samplerPlanZones, SamplerNotBuilt, type Region, type ResolvedBank, type ResolvedInstrument, type SampledNote, type ZoneData } from '../music/sampler.ts';
import { styleSpec } from '../music/styles.ts';
import { ApiError } from '../store.ts';
import { InstrumentError, instrumentsError } from './contract.ts';
import { parseSfz, type ParsedRegion } from './sfz.ts';
import { decodePcm, readWavInfo, readWavLoop, WAV_HEAD_BYTES, wavDataEnd, type WavInfo } from './wav.ts';

/** Where an instrument's item lies (realpath of the library root and the ledger path of its item): loadBank opens through it again. */
export interface KitItemPlace { rootReal: string; entryPath: string }
/** One file the check proved equal to the kit table. `real` stays on the server (never in an answer). */
export interface CheckedFile { instrument: string; path: string; real: string; bytes: number; mtimeMs: number }
/** The result of checking a kit against the library, outside the queue turn. `ready` carries what loading needs. */
export type KitCheck =
  | { state: Exclude<KitState, 'ready'>; error: ApiError; sources: MusicKitStatus['sources'] }
  | { state: 'ready'; bank: string; records: LibraryRecord[]; sources: MusicKitStatus['sources']; files: CheckedFile[]; items: Record<string, KitItemPlace> };
export type ReadyKit = Extract<KitCheck, { state: 'ready' }>;

/** The instruments a kit's parts use (an instrument no part names is never read). */
export const usedInstruments = (kit: MusicKit) => {
  const used = new Set(Object.values(kit.parts).map((p) => p!.instrument));
  return kit.instruments.filter((i) => used.has(i.id));
};
/** The bank of a kit: the first 16 hex characters of sha256(kitBankInput): a pure function of the kit table. */
export const kitBank = (kit: MusicKit): string => createHash('sha256').update(kitBankInput(kit)).digest('hex').slice(0, 16);

// ---------- the file-hash map (absolute path + size + mtimeMs → sha256), at most INSTRUMENTS_LIMITS.hashCacheEntries rows ----------
const hashes = new Map<string, string>();
/** For tests: how many files were hashed (not taken from the map) since the process started. */
export const kitHashStats = { hashed: 0 };
async function sha256Of(f: OpenedFile, signal?: AbortSignal): Promise<string> {
  const k = `${f.real}\0${f.stat.size}\0${f.stat.mtimeMs}`;
  const hit = hashes.get(k);
  if (hit) { hashes.delete(k); hashes.set(k, hit); return hit; }
  const h = createHash('sha256');
  const buf = Buffer.alloc(Math.min(1 << 20, Math.max(1, f.stat.size)));
  let off = 0;
  for (;;) {
    if (signal?.aborted) throw cancelled();
    const { bytesRead } = await f.fd.read(buf, 0, buf.length, off);
    if (!bytesRead) break;
    h.update(buf.subarray(0, bytesRead));
    off += bytesRead;
    if (off > f.stat.size) break; // grew while read: the digest will not match the table
  }
  const hex = h.digest('hex');
  kitHashStats.hashed++;
  hashes.set(k, hex);
  while (hashes.size > INSTRUMENTS_LIMITS.hashCacheEntries) hashes.delete(hashes.keys().next().value!);
  return hex;
}
const cancelled = () => new ApiError(503, 'music_cancelled', 'the built-in music was not made: the request was cancelled', {}, 'Ask again if you still want it.');

/** A parser's typed failure (or a library refusal) as the recorded path's refusal; `rel` is the path inside the item (never absolute). */
function refusal(e: unknown, rel: string): ApiError {
  if (e instanceof InstrumentError) {
    if (e.code === 'path_escape') return instrumentsError('pathEscape', { path: rel, reason: e.why });
    if (e.code === 'format') return instrumentsError('format', { path: rel }, rel, e.why);
    if (e.code === 'too_large') return instrumentsError('unreadable', { path: rel }, rel, e.why);
    return instrumentsError('unreadable', { path: rel }, rel, e.why);
  }
  if (e instanceof ApiError) {
    if (e.code === 'library_path_escape') return instrumentsError('pathEscape', { path: rel });
    if (e.code === 'library_item_missing') return instrumentsError('fileMissing', { path: rel }, rel);
    if (/^instruments_|^music_cancelled$/.test(e.code)) return e;
  }
  const code = (e as { code?: unknown }).code;
  return instrumentsError('unreadable', { path: rel }, rel, typeof code === 'string' && /^E[A-Z]+$/.test(code) ? code : 'the file could not be read');
}
const stateOf = (e: ApiError): Exclude<KitState, 'ready'> => {
  switch (e.code) {
    case 'instruments_library_not_set': return 'library_not_set';
    case 'instruments_kit_not_ready': return 'not_calibrated';
    case 'instruments_item_missing': return 'item_missing';
    case 'instruments_item_version': return 'item_version';
    case 'instruments_licence': return 'licence';
    case 'instruments_file_missing': return 'file_missing';
    case 'instruments_file_changed': return 'file_changed';
    case 'instruments_not_built': return 'not_built';
    default: return 'unreadable'; // path_escape, unreadable, format: the files cannot be used as they are
  }
};

/** A ledger entry holds an instrument's item at the pin the kit was checked against (a git commit, or a file's sha256). */
const atPin = (e: LedgerEntry, pin: string) => e.commit === pin || e.sha256 === pin;

/** Check every file and source of `kit` (hash map by absolute path + size + mtimeMs). Never throws for a library problem: the state says it. */
export async function checkKit(cfg: Config, kit: MusicKit, signal?: AbortSignal): Promise<KitCheck> {
  let sources: MusicKitStatus['sources'] = [];
  try {
    const lib = libraryServiceFor(cfg);
    if (!lib.configuredRoot()) throw instrumentsError('libraryNotSet', {});
    if (!kitCalibrated(kit)) throw instrumentsError('kitNotReady', { kitId: kit.id, version: kit.version }, kitKey(kit));
    const ledger = await lib.ledgerEntries();
    if (ledger.state === 'not_configured' || ledger.state === 'root_missing' || !ledger.rootReal) throw instrumentsError('libraryNotSet', { libraryState: ledger.state });
    const rootReal = ledger.rootReal;
    const used = usedInstruments(kit);
    // 2. every item present at its pin
    const entries = new Map<string, LedgerEntry>();
    for (const ins of used) {
      if (ledger.state !== 'ok') throw instrumentsError('itemMissing', { item: ins.ledgerItem, libraryState: ledger.state }, ins.ledgerItem);
      const e = ledger.entries.find((x) => x.item === ins.ledgerItem);
      if (!e) throw instrumentsError('itemMissing', { item: ins.ledgerItem }, ins.ledgerItem);
      if (!atPin(e, ins.ledgerPin)) throw instrumentsError('itemVersion', { item: ins.ledgerItem }, ins.ledgerItem);
      if (e.kind === 'file') throw instrumentsError('itemVersion', { item: ins.ledgerItem, reason: 'the item is one file, not a folder' }, ins.ledgerItem);
      entries.set(ins.id, e);
    }
    // 3. every source's duties, before any file is opened (the union: one record per instrument, all carried)
    const seen = new Set<string>();
    const records: LibraryRecord[] = [];
    for (const ins of used) {
      const e = entries.get(ins.id)!;
      const d = licenceDuties(e.source, e.licence, e.flags);
      if (!seen.has(e.item)) { seen.add(e.item); sources.push({ sourceId: e.source.slice(0, 64), title: e.sourceTitle.slice(0, 200), licenceId: d.licenceId.slice(0, 80), credit: d.credit, nonCommercial: d.nonCommercial, shareable: d.shareable }); }
      const entryFile = ins.files.find((f) => f.path === ins.entry)!;
      const r = kitLibraryRecord(e, d, ins, entryFile.sha256);
      if ('problem' in r) throw instrumentsError('licence', { item: e.item, problem: r.problem, licenceId: d.licenceId }, e.item, r.problem);
      records.push(r.record);
    }
    // 4. every file: inside its item, its size, its sha256
    const files: CheckedFile[] = [];
    const items: Record<string, KitItemPlace> = {};
    for (const ins of used) {
      const place = { rootReal, entryPath: entries.get(ins.id)!.path };
      items[ins.id] = place;
      for (const kf of ins.files) {
        if (signal?.aborted) throw cancelled();
        let f: OpenedFile;
        try { f = await openInside(rootReal, place.entryPath, kf.path); } catch (e) { throw refusal(e, kf.path); }
        try {
          if (f.stat.size > INSTRUMENTS_LIMITS.maxFileBytes) throw instrumentsError('unreadable', { path: kf.path }, kf.path, 'larger than this build reads');
          if (f.stat.size !== kf.bytes) throw instrumentsError('fileChanged', { path: kf.path, reason: 'size' }, kf.path);
          if ((await sha256Of(f, signal)) !== kf.sha256) throw instrumentsError('fileChanged', { path: kf.path, reason: 'sha256' }, kf.path);
          files.push({ instrument: ins.id, path: kf.path, real: f.real, bytes: f.stat.size, mtimeMs: f.stat.mtimeMs });
        } finally { await f.fd.close(); }
      }
    }
    const ready: ReadyKit = { state: 'ready', bank: kitBank(kit), records, sources, files, items };
    // the .sfz and every sample's header (format, truncation) before anything is made
    for (const ins of used) await readInstrument(ready, ins, signal);
    return ready;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.code === 'music_cancelled') throw e;
    if (stateOf(e) !== 'licence' && stateOf(e) !== 'unreadable' && stateOf(e) !== 'file_missing' && stateOf(e) !== 'file_changed') sources = [];
    return { state: stateOf(e), error: e, sources };
  }
}

// ---------- reading an instrument (both in the check and in the turn) ----------
type KitInstrumentRow = MusicKit['instruments'][number];
interface ReadInstrument { regions: (Omit<Region, 'zone'> & { zonePath: string })[]; zones: { path: string; info: WavInfo }[]; warnings: string[] }
const TEXT_MAX = 1024 * 1024;
const isText = (p: string) => /\.(sfz|sfzh|txt|inc)$/i.test(p);

/** Opens a checked file again through openInside and proves it is still the one the check saw (size and mtime). */
async function openChecked(check: ReadyKit, instrument: string, rel: string): Promise<OpenedFile> {
  const known = check.files.find((f) => f.instrument === instrument && f.path === rel);
  if (!known) throw instrumentsError('unreadable', { path: rel }, rel, 'it is not in the checked list of this kit');
  const place = check.items[instrument]!;
  let f: OpenedFile;
  try { f = await openInside(place.rootReal, place.entryPath, rel); } catch (e) { throw refusal(e, rel); }
  if (f.stat.size !== known.bytes || f.stat.mtimeMs !== known.mtimeMs || f.real !== known.real) { await f.fd.close(); throw instrumentsError('fileChanged', { path: rel, reason: 'changed since the check' }, rel); }
  return f;
}
async function readAt(f: OpenedFile, pos: number, n: number): Promise<Buffer> {
  const buf = Buffer.alloc(n);
  let off = 0;
  while (off < n) { const { bytesRead } = await f.fd.read(buf, off, n - off, pos + off); if (!bytesRead) break; off += bytesRead; }
  return off === n ? buf : buf.subarray(0, off);
}
/** A path of the kit table for `want` (exact, else ONE case-insensitive match, counted in warnings; two refuse). */
function tablePath(table: readonly string[], want: string, warnings: string[]): string {
  if (table.includes(want)) return want;
  const low = want.toLowerCase();
  const m = table.filter((p) => p.toLowerCase() === low);
  if (m.length === 1) { warnings.push(`case differs: ${want.slice(0, 120)}`); return m[0]!; }
  if (m.length > 1) throw new InstrumentError('unreadable', 'two files of the kit match this name in different case');
  throw new InstrumentError('unreadable', 'it is not in the checked list of this kit');
}
const join = (dir: string, rel: string) => (dir === '.' || dir === '' ? rel : `${dir}/${rel}`);

/** Parses an instrument's .sfz (with its includes, from the kit table only) and reads every sample's WAV header. */
async function readInstrument(check: ReadyKit, ins: KitInstrumentRow, signal?: AbortSignal): Promise<ReadInstrument> {
  const table = ins.files.map((f) => f.path);
  const texts = new Map<string, string>();
  for (const p of table.filter(isText)) {
    const f = await openChecked(check, ins.id, p);
    try {
      if (f.stat.size > TEXT_MAX) throw instrumentsError('unreadable', { path: p }, p, 'an instrument text larger than 1 MB');
      texts.set(p, (await readAt(f, 0, f.stat.size)).toString('utf8').replace(/^﻿/, ''));
    } finally { await f.fd.close(); }
  }
  const entry = ins.entry!;
  const dir = path.posix.dirname(entry);
  const warnings: string[] = [];
  let parsed;
  let at = entry;
  try {
    const text = texts.get(entry);
    if (text === undefined) throw new InstrumentError('format', 'the entry is not an .sfz text');
    parsed = parseSfz(text, (inc) => { at = join(dir, inc); const p = tablePath(table, at, warnings); const t = texts.get(p); if (t === undefined) throw new InstrumentError('format', 'the include is not an .sfz text'); return t; });
  } catch (e) { throw refusal(e, at); }
  warnings.push(...parsed.warnings);
  const zoneIndex = new Map<string, number>();
  const zones: ReadInstrument['zones'] = [];
  const regions: ReadInstrument['regions'] = [];
  for (const r of parsed.regions as ParsedRegion[]) {
    const want = join(dir, r.sample);
    let p: string;
    try { p = tablePath(table, want, warnings); } catch (e) { throw refusal(e, want); }
    if (!zoneIndex.has(p)) {
      if (signal?.aborted) throw cancelled();
      const f = await openChecked(check, ins.id, p);
      try {
        const head = await readAt(f, 0, Math.min(f.stat.size, WAV_HEAD_BYTES));
        const info = readWavInfo(head, f.stat.size);
        if (!info.loop) {
          const end = wavDataEnd(info) + ((wavDataEnd(info) - info.dataOffset) & 1);
          if (end < f.stat.size) info.loop = readWavLoop(await readAt(f, end, Math.min(f.stat.size - end, WAV_HEAD_BYTES)), info);
        }
        zoneIndex.set(p, zones.length);
        zones.push({ path: p, info });
      } catch (e) { throw refusal(e, p); } finally { await f.fd.close(); }
    }
    const info = zones[zoneIndex.get(p)!]!.info;
    const { sample: _s, loopModeGiven, ...rest } = r;
    const loopMode = loopModeGiven ? rest.loopMode : info.loop ? 'loop_continuous' : 'no_loop';
    regions.push({ ...rest, loopMode, loopStart: rest.loopStart ?? info.loop?.start ?? null, loopEnd: rest.loopEnd ?? info.loop?.end ?? null, zonePath: p });
  }
  if (!regions.length) throw instrumentsError('format', { path: entry }, entry, 'no region with a sample');
  return { regions, zones, warnings };
}

/** The notes of the kit's parts in a piece (the arranger's own notes, nothing else): what loadBank plans the zones for. */
export function kitNotes(kit: MusicKit, styleId: string, bars: number, seed: number, endFrames?: number): SampledNote[] {
  const layout = musicLayout(styleId, bars, endFrames);
  const spec = styleSpec(layout.styleId);
  return arrange(spec, layout, compose(spec, layout, seed), seed)
    .filter((n) => Object.hasOwn(kit.parts, n.part) && kit.parts[n.part as KitPartRole])
    .map((n) => ({ part: n.part as KitPartRole, midi: n.midi, vel: n.vel, gate: n.gate }));
}

/** What loadBank needs from the sampler (W1's planZones by default; a test may give a labelled stand-in). */
export interface LoadDeps {
  planZones: typeof samplerPlanZones;
  /** A lower bound than INSTRUMENTS_LIMITS.maxDecodedBytes (tests prove the refusal with tiny files); never raises it. */
  maxDecodedBytes?: number;
}
/**
 * Inside the queue turn: parse the instruments, plan the zones for `notes` (refuse instruments_range), re-stat every file (changed →
 * instruments_file_changed) and decode only the frames needed (over the limit → instruments_too_large).
 */
export async function loadBank(check: ReadyKit, kit: MusicKit, notes: readonly SampledNote[], signal?: AbortSignal, deps: LoadDeps = { planZones: samplerPlanZones }): Promise<ResolvedBank> {
  const read = new Map<string, ReadInstrument>();
  const resolved = new Map<string, { id: string; regions: Region[]; zones: ZoneData[]; cc: Record<number, number> }>();
  for (const ins of usedInstruments(kit)) {
    const r = await readInstrument(check, ins, signal);
    read.set(ins.id, r);
    const zones: ZoneData[] = r.zones.map((z) => ({ path: z.path, rate: z.info.rate, channels: z.info.channels, frames: z.info.frames, samples: new Int32Array(0), loop: z.info.loop }));
    const index = new Map(r.zones.map((z, i) => [z.path, i] as const));
    const regions: Region[] = r.regions.map(({ zonePath, ...g }) => ({ ...g, zone: index.get(zonePath)! }));
    const cc: Record<number, number> = {};
    for (const [k, v] of Object.entries(ins.cc ?? {})) cc[Number(k)] = v;
    resolved.set(ins.id, { id: ins.id, regions, zones, cc });
  }
  const parts: ResolvedBank['parts'] = {};
  for (const role of Object.keys(kit.parts) as KitPartRole[]) {
    const p = kit.parts[role]!;
    parts[role] = { instrument: resolved.get(p.instrument)! as ResolvedInstrument, gainDb: p.gainDb, vel: p.vel, ...(p.attackMax !== undefined ? { attackMax: p.attackMax } : {}), ...(p.releaseMax !== undefined ? { releaseMax: p.releaseMax } : {}), ...(p.edge !== undefined ? { edge: p.edge } : {}) };
  }
  let plan: ReturnType<typeof samplerPlanZones>;
  try { plan = deps.planZones(notes, { parts }); } catch (e) {
    if (e instanceof SamplerNotBuilt) throw instrumentsError('notBuilt', { kitId: kit.id });
    throw e;
  }
  if (plan.outOfRange) throw instrumentsError('range', { part: plan.outOfRange.part, instrument: plan.outOfRange.instrument, midi: plan.outOfRange.midi }, plan.outOfRange.instrument);
  // the frames each zone needs (the largest need of any note), never more than the zone holds
  const need = new Map<string, number>();
  for (const n of plan.needs) {
    const z = resolved.get(n.instrument)?.zones[n.zone];
    if (!z || !Number.isSafeInteger(n.frames) || n.frames < 0) continue;
    const k = `${n.instrument}\0${n.zone}`;
    need.set(k, Math.min(z.frames, Math.max(need.get(k) ?? 0, n.frames)));
  }
  let bytes = 0;
  for (const [k, frames] of need) { const [i, z] = k.split('\0') as [string, string]; bytes += frames * resolved.get(i)!.zones[Number(z)]!.channels * 4; }
  const limit = Math.min(INSTRUMENTS_LIMITS.maxDecodedBytes, deps.maxDecodedBytes ?? Number.POSITIVE_INFINITY);
  if (bytes > limit) throw instrumentsError('tooLarge', { bytes, limit }, Math.round((limit / (1024 * 1024)) * 1000) / 1000);
  for (const ins of resolved.values()) {
    const r = read.get(ins.id)!;
    for (let zi = 0; zi < ins.zones.length; zi++) {
      const z = ins.zones[zi]!;
      const frames = need.get(`${ins.id}\0${zi}`) ?? 0;
      if (frames === 0) { ins.zones[zi] = { ...z, frames: 0 }; continue; }
      if (signal?.aborted) throw cancelled();
      const info = r.zones[zi]!.info;
      const f = await openChecked(check, ins.id, z.path);
      try {
        const head = readWavInfo(await readAt(f, 0, Math.min(f.stat.size, WAV_HEAD_BYTES)), f.stat.size);
        if (head.dataOffset !== info.dataOffset || head.frames !== info.frames) throw instrumentsError('fileChanged', { path: z.path }, z.path);
        const samples = decodePcm(await readAt(f, info.dataOffset, frames * info.channels * (info.bits / 8)), info, 0, frames);
        const now = await f.fd.stat();
        if (now.size !== f.stat.size || now.mtimeMs !== f.stat.mtimeMs) throw instrumentsError('fileChanged', { path: z.path }, z.path);
        ins.zones[zi] = { ...z, frames, samples };
      } catch (e) { throw refusal(e, z.path); } finally { await f.fd.close(); }
    }
  }
  return { kitId: kit.id, version: kit.version, bank: check.bank, parts };
}
