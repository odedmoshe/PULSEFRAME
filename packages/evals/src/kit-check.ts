/**
 * pnpm kit:check — the laptop checks of a recorded kit (ADR-0029; .artifacts/wave7/instruments-plan.md L1, L4, L6, L2, L3, L5) in one
 * read-only command. Usage:
 *
 *   pnpm kit:check --library <folder> [--kit kit.calm.vsco] [--bars 16] [--seed 1] [--long] [--audition <empty dir>] [--save]
 *
 * - Runs the PRODUCT's own path in this process: checkKit (library, calibration, ledger, licences, every file's size and sha256 against
 *   the kit table), loadBank (the sampler's planZones, only the planned frames decoded), renderMusic with the bank, and the server's
 *   validation (musicValidationFailures, which validateMusic throws the first of). No server is started, no port opened, no network.
 * - Read-only: nothing is written into the library or the repository. The library service is opened over a data directory that is never
 *   created (no index is built). Written only on request: `--save` writes the report under the OS temp folder (its name is printed
 *   relative to that folder); `--audition <dir>` writes the level-matched blind pair (A.wav, B.wav) and key.txt into <dir>, which must be
 *   absent or empty, outside any git working copy and outside the library (L5).
 * - The report is ONE block of ASCII lines, each starting with its section tag (KIT, L1, L4, GAIN, L6, L2, L3, L5, SUMMARY); paths are
 *   relative to the library root or to the kit's item; the library root, the repository, the home and temp folders and the user name
 *   are replaced by <library>, <repo>, <home>, <tmp>, <user> in any message. Exit 0 only when L1 is ready, L4 has no out-of-range note
 *   and the track passes validation, and every L2 hash is equal; 1 otherwise; 2 for bad arguments.
 * - L6 measures each sampled part ALONE (RenderOptions.solo, a seam used only by this tool and tests) with the synthesiser's voice and
 *   with the sampled instrument over the same notes. The proposed gain is worked out on the master's input before the clamp and the
 *   soft clip (RenderOptions.bus), where a part's level is linear in its gain; the GAIN line's RMS and peak are of the finished samples.
 * - `--kit-table <json>` (tests, and trying gains without editing the table): a JSON kit or list of kits used instead of the build's
 *   MUSIC_KITS (validated by the core schema). Nobody can listen here: nothing printed says how anything sounds.
 */
import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KIT_PART_ROLES, KitPartSchema, kitKey, MUSIC_KITS, MUSIC_SAMPLER_VERSION, MUSIC_STYLES, MusicKitSchema, musicLayout, type KitPartRole, type MusicKit } from '@pulseframe/core';
import { loadConfig, type Config } from '@pulseframe/server/config.ts';
import { checkKit, kitBank, kitNotes, loadBank, readInstrument, usedInstruments, type ReadyKit } from '@pulseframe/server/instruments/bank.ts';
import { closeLibraryService, libraryServiceFor } from '@pulseframe/server/library/index.ts';
import { musicValidationFailures } from '@pulseframe/server/music.ts';
import { renderMusic, type RenderedMusic, type RenderOptions } from '@pulseframe/server/music/render.ts';
import { decodedBytesOf, noteReport, planZones, type ResolvedBank } from '@pulseframe/server/music/sampler.ts';
import { readWavSamples } from '@pulseframe/server/music/wav.ts';
import { ApiError } from '@pulseframe/server/store.ts';
import { GOLDEN_RENDERS, goldenKey, readInstrumentsGolden, samplerTestBank, trackChecks } from './instruments-proof.sampler.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const SCRIPT = fileURLToPath(import.meta.url);
const SR = 48000;
const GAIN_MIN = KitPartSchema.shape.gainDb.minValue ?? -60;
const GAIN_MAX = KitPartSchema.shape.gainDb.maxValue ?? 12;
/** The parts L6 calibrates (the pitched parts a kit may sample, in this order). */
const SAMPLED_ORDER: readonly KitPartRole[] = ['pad', 'double', 'arp', 'lead', 'stab', 'bass'];

export const KIT_CHECK_USAGE = 'usage: pnpm kit:check --library <folder> [--kit kit.calm.vsco] [--bars 16] [--seed 1] [--long] [--audition <empty dir>] [--save] [--kit-table <json>]';

export interface KitCheckArgs {
  library: string; kit: string; bars: number; seed: number; long: boolean; audition: string | null; save: boolean; kitTable: string | null;
  child: 'hash' | 'long' | null;
}
export function parseKitCheckArgs(argv: readonly string[]): KitCheckArgs | string {
  const a: KitCheckArgs = { library: '', kit: 'kit.calm.vsco', bars: 16, seed: 1, long: false, audition: null, save: false, kitTable: null, child: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${k} needs a value`); return v; };
    try {
      if (k === '--library') a.library = val();
      else if (k === '--kit') a.kit = val();
      else if (k === '--bars') a.bars = Number(val());
      else if (k === '--seed') a.seed = Number(val());
      else if (k === '--long') a.long = true;
      else if (k === '--audition') a.audition = val();
      else if (k === '--save') a.save = true;
      else if (k === '--kit-table') a.kitTable = val();
      else if (k === '--child') { const v = val(); if (v !== 'hash' && v !== 'long') return `--child is hash or long`; a.child = v; }
      else if (k === '--help' || k === '-h') return KIT_CHECK_USAGE;
      else return `unknown argument ${k.slice(0, 40)}`;
    } catch (e) { return (e as Error).message; }
  }
  if (!a.library) return '--library <folder> is required';
  if (!Number.isInteger(a.bars) || a.bars < 1) return '--bars is a whole number';
  if (!Number.isInteger(a.seed) || a.seed < 0) return '--seed is a whole number';
  return a;
}

// ---------- the report: ASCII, no absolute path, no user name ----------
export class Report {
  readonly lines: string[] = [];
  private readonly subs: [string, string][] = [];
  constructor(private readonly sink: (line: string) => void, library: string) {
    const add = (from: string | null | undefined, to: string) => { if (from && from.length > 2) this.subs.push([from, to]); };
    for (const p of [library, safeReal(library)]) { add(p, '<library>'); add(p.replace(/\\/g, '/'), '<library>'); }
    for (const p of [REPO, safeReal(REPO)]) { add(p, '<repo>'); add(p.replace(/\\/g, '/'), '<repo>'); }
    for (const p of [os.tmpdir(), safeReal(os.tmpdir())]) { add(p, '<tmp>'); add(p.replace(/\\/g, '/'), '<tmp>'); }
    add(os.homedir(), '<home>'); add(os.homedir().replace(/\\/g, '/'), '<home>');
    try { add(os.userInfo().username, '<user>'); } catch { /* no user */ }
    this.subs.sort((x, y) => y[0].length - x[0].length);
  }
  clean(s: string): string {
    let t = s;
    for (const [from, to] of this.subs) t = t.split(from).join(to);
    return t.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '?');
  }
  line(s: string): void { const c = this.clean(s); this.lines.push(c); this.sink(c); }
}
const safeReal = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };

// ---------- small helpers ----------
const f4 = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : String(x));
const f6 = (x: number) => (Number.isFinite(x) ? x.toFixed(6) : String(x));
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pcmSha = (r: RenderedMusic) => sha(r.wav.subarray(44));
/** The build's commit from .git (a folder, or a worktree's `gitdir:` file), without running git; null when unreadable. */
export function gitCommit(repo: string = REPO): string | null {
  try {
    let gitDir = path.join(repo, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) { const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(gitDir, 'utf8')); if (!m) return null; gitDir = path.resolve(repo, m[1]!.trim()); }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return null;
    let common = gitDir;
    try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { /* not a worktree */ }
    for (const d of [gitDir, common]) {
      try { const v = fs.readFileSync(path.join(d, ...ref.split('/')), 'utf8').trim(); if (/^[0-9a-f]{40}$/.test(v)) return v; } catch { /* next */ }
    }
    for (const d of [gitDir, common]) {
      try { for (const l of fs.readFileSync(path.join(d, 'packed-refs'), 'utf8').split('\n')) { const [h, r] = l.trim().split(' '); if (r === ref && h && /^[0-9a-f]{40}$/.test(h)) return h; } } catch { /* next */ }
    }
    return null;
  } catch { return null; }
}
/** A folder inside a git working copy (some ancestor holds `.git`). */
export function insideGitWorkingCopy(dir: string): boolean {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}
const isInside = (parent: string, child: string) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function loadKits(args: KitCheckArgs, given?: readonly MusicKit[]): readonly MusicKit[] {
  if (given) return given;
  if (!args.kitTable) return MUSIC_KITS;
  const j = JSON.parse(fs.readFileSync(args.kitTable, 'utf8')) as unknown;
  return (Array.isArray(j) ? j : [j]).map((k) => MusicKitSchema.parse(k));
}
function pickKit(kits: readonly MusicKit[], name: string): MusicKit | null {
  const [id, v] = name.split('@');
  const all = kits.filter((k) => k.id === id && (v === undefined || String(k.version) === v));
  return all.sort((a, b) => b.version - a.version)[0] ?? null;
}
/** A Config that reads the library and writes nothing: its data directory is a path that is never created. */
function readOnlyConfig(library: string): Config {
  const dataDir = path.join(os.tmpdir(), `pf-kit-check-nodata-${process.pid}-${randomInt(1e9)}`);
  return { ...loadConfig({}), dataDir, libraryDir: path.resolve(library) };
}

/** The bank a load builds before it decodes (zones at their files' whole length, no samples): what planZones and noteReport read. */
async function load(check: ReadyKit, kit: MusicKit, notes: ReturnType<typeof kitNotes>): Promise<{ bank: ResolvedBank | null; plan: Pick<ResolvedBank, 'parts'> | null; error: ApiError | null }> {
  let plan: Pick<ResolvedBank, 'parts'> | null = null;
  try {
    const bank = await loadBank(check, kit, notes, undefined, { planZones: (n, b) => { plan = b; return planZones(n, b); } });
    return { bank, plan, error: null };
  } catch (e) {
    if (e instanceof ApiError) return { bank: null, plan, error: e };
    throw e;
  }
}
const withGains = (kit: MusicKit, gains: Partial<Record<KitPartRole, number>>): MusicKit => ({
  ...kit, parts: Object.fromEntries(Object.entries(kit.parts).map(([r, p]) => [r, { ...p!, ...(gains[r as KitPartRole] !== undefined ? { gainDb: gains[r as KitPartRole]! } : {}) }])) as MusicKit['parts'],
});
/** One render and the RMS of the master's input before the clamp (both channels). */
async function measured(styleId: string, bars: number, seed: number, opts: RenderOptions): Promise<{ r: RenderedMusic; busRms: number; busPeak: number }> {
  let sum = 0, peak = 0, n = 0;
  const r = await renderMusic(styleId, bars, seed, { ...opts, bus: (_f, l, rr) => { sum += l * l + rr * rr; n += 2; const a = Math.max(Math.abs(l), Math.abs(rr)); if (a > peak) peak = a; } });
  return { r, busRms: Math.sqrt(sum / Math.max(1, n)), busPeak: peak };
}
const errLine = (e: ApiError) => {
  const d = e.details ?? {};
  const where = typeof d.path === 'string' ? d.path : typeof d.item === 'string' ? d.item : typeof d.instrument === 'string' ? d.instrument : '-';
  return `code=${e.code} path=${where} message=${JSON.stringify(e.message)}`;
};

/** A fresh tsx process running this file with the given arguments (no shell; process.execPath and an argument array). */
function runChild(args: readonly string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [tsxCli, SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    p.stderr.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    p.on('error', () => { clearTimeout(t); resolve({ code: null, out }); });
  });
}
const forward = (a: KitCheckArgs) => ['--library', a.library, '--kit', a.kit, '--bars', String(a.bars), '--seed', String(a.seed), ...(a.kitTable ? ['--kit-table', a.kitTable] : [])];
const bars128 = (styleId: string) => { const L = musicLayout(styleId, 4); const perBar = L.totalFrames / 4 / SR; return Math.ceil(128 / perBar); };

/** One full recorded request (check, load, render, validate) under the event-loop monitor of proof I13. */
async function timedRequest(cfg: Config, kit: MusicKit, bars: number, seed: number): Promise<{ ms: number; seconds: number; loopMaxMs: number; ok: boolean }> {
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  const t0 = performance.now();
  const check = await checkKit(cfg, kit);
  let ok = false, seconds = 0;
  if (check.state === 'ready') {
    const bank = await loadBank(check, kit, kitNotes(kit, kit.styleId, bars, seed));
    const r = await renderMusic(kit.styleId, bars, seed, { bank, kit });
    seconds = r.layout.totalFrames / SR;
    ok = musicValidationFailures(r).length === 0;
  }
  const ms = performance.now() - t0;
  h.disable();
  return { ms, seconds, loopMaxMs: h.max / 1e6, ok };
}

/** The child modes: `hash` prints the PCM hash of the request; `long` times the 128 s request cold, then warm, and the peak RSS. */
async function childMain(a: KitCheckArgs, kits: readonly MusicKit[], out: (s: string) => void): Promise<number> {
  const kit = pickKit(kits, a.kit);
  if (!kit) { out('CHILD error=no_kit'); return 1; }
  const cfg = readOnlyConfig(a.library);
  libraryServiceFor(cfg, { noStartupBuild: true });
  try {
    if (a.child === 'hash') {
      const check = await checkKit(cfg, kit);
      if (check.state !== 'ready') { out(`CHILD error=${check.state}`); return 1; }
      const bank = await loadBank(check, kit, kitNotes(kit, kit.styleId, a.bars, a.seed));
      out(`CHILD pcm-sha256=${pcmSha(await renderMusic(kit.styleId, a.bars, a.seed, { bank, kit }))}`);
      return 0;
    }
    const bars = bars128(kit.styleId);
    for (const run of ['cold', 'warm'] as const) {
      const t = await timedRequest(cfg, kit, bars, a.seed);
      out(`CHILD run=${run} bars=${bars} seconds=${t.seconds.toFixed(1)} wallMs=${t.ms.toFixed(0)} realTimeFactor=${(t.seconds * 1000 / t.ms).toFixed(1)} loopMaxMs=${t.loopMaxMs.toFixed(1)} valid=${t.ok ? 'yes' : 'no'}`);
    }
    out(`CHILD peakRssMB=${(process.resourceUsage().maxRSS / 1024).toFixed(1)}`);
    return 0;
  } finally { closeLibraryService(cfg.dataDir); }
}

export interface KitCheckDeps {
  /** Where each report line goes (default: stdout). */ out?: (line: string) => void;
  /** The kit list (default: --kit-table, else MUSIC_KITS). Children get --kit-table, so a test that gives kits here also passes it. */ kits?: readonly MusicKit[];
}
/** The command. Returns the exit code (0 ok, 1 a check failed, 2 bad arguments). */
export async function kitCheckMain(argv: readonly string[], deps: KitCheckDeps = {}): Promise<number> {
  const sink = deps.out ?? ((s: string) => process.stdout.write(s + '\n'));
  const parsed = parseKitCheckArgs(argv);
  if (typeof parsed === 'string') { sink(parsed === KIT_CHECK_USAGE ? parsed : `ERROR ${parsed}`); if (parsed !== KIT_CHECK_USAGE) sink(KIT_CHECK_USAGE); return parsed === KIT_CHECK_USAGE ? 0 : 2; }
  const a = parsed;
  let kits: readonly MusicKit[];
  try { kits = loadKits(a, deps.kits); } catch (e) { sink(`ERROR the kit table could not be read: ${String((e as Error).message).slice(0, 200)}`); return 2; }
  if (a.child) return childMain(a, kits, sink);
  const rep = new Report(sink, path.resolve(a.library));
  const failed: string[] = [];
  const kit = pickKit(kits, a.kit);
  if (!kit) { rep.line(`KIT id=${a.kit} state=unknown_kit known=${kits.map(kitKey).join(',') || 'none'}`); rep.line('SUMMARY failed=L1'); return 1; }
  const styleId = kit.styleId;
  const commit = gitCommit();
  rep.line(`KIT id=${kit.id} version=${kit.version} bank=${kitBank(kit)} sampler=${MUSIC_SAMPLER_VERSION} commit=${commit ?? 'unknown'} node=${process.version} platform=${process.platform}-${process.arch} style=${styleId} bars=${a.bars} seed=${a.seed}`);
  // the audition folder is refused before anything runs (L5)
  if (a.audition) {
    const dir = path.resolve(a.audition);
    let why: string | null = null;
    if (fs.existsSync(dir)) { if (!fs.statSync(dir).isDirectory()) why = 'it is not a folder'; else if (fs.readdirSync(dir).length) why = 'it is not empty'; }
    if (!why && insideGitWorkingCopy(dir)) why = 'it is inside a git working copy';
    if (!why && isInside(safeReal(path.resolve(a.library)), safeReal(dir))) why = 'it is inside the library';
    if (why) { rep.line(`L5 refused reason=${JSON.stringify(why)}`); rep.line('SUMMARY failed=L5'); return 2; }
  }
  const cfg = readOnlyConfig(a.library);
  libraryServiceFor(cfg, { noStartupBuild: true }); // no index build: the check reads the ledger and the kit's files only
  try {
    // ---------- L1 ----------
    const check = await checkKit(cfg, kit);
    if (check.state !== 'ready') {
      rep.line(`L1 state=${check.state} ${errLine(check.error)}`);
      rep.line('SUMMARY failed=L1');
      return 1;
    }
    rep.line(`L1 state=ready files=${check.files.length} bytes=${check.files.reduce((s, f) => s + f.bytes, 0)} bank=${check.bank}`);
    for (const s of check.sources) rep.line(`L1 source ${s.sourceId} licence=${s.licenceId} credit=${s.credit ? 'yes' : 'no'} nonCommercial=${s.nonCommercial ? 'yes' : 'no'} shareable=${s.shareable ? 'yes' : 'no'}`);
    const notes = kitNotes(kit, styleId, a.bars, a.seed);
    const first = await load(check, kit, notes);
    const planned = first.plan ? planZones(notes, first.plan) : null;
    for (const ins of usedInstruments(kit)) {
      const r = await readInstrument(check, ins);
      const uniq = <T,>(xs: T[]) => [...new Set(xs)].sort();
      const needs = planned ? planned.needs.filter((n) => n.instrument === ins.id) : [];
      const decoded = first.plan ? decodedBytesOf(needs, first.plan) : 0;
      rep.line(`L1 instrument ${ins.id} entry=${ins.entry} files=${ins.files.length} regions=${r.regions.length} zones=${r.zones.length} rates=${uniq(r.zones.map((z) => z.info.rate)).join(',')} bits=${uniq(r.zones.map((z) => `${z.info.bits}${z.info.float ? 'f' : ''}`)).join(',')} channels=${uniq(r.zones.map((z) => z.info.channels)).join(',')} loopedZones=${r.zones.filter((z) => z.info.loop).length} zonesPlanned=${needs.length} decodedBytesPlanned=${decoded}`);
      const ign = Object.entries(r.ignored).sort((x, y) => (x[0] < y[0] ? -1 : 1));
      rep.line(`L1 ignored ${ins.id} ${ign.length ? ign.map(([k, v]) => `${k}=${v}`).join(' ') : 'none'}`);
      rep.line(`L1 warnings ${ins.id} count=${r.warnings.length}`);
      for (const w of r.warnings.slice(0, 20)) rep.line(`L1 warning ${ins.id} ${w}`);
    }
    if (first.plan && planned) rep.line(`L1 decodedBytesPlanned total=${decodedBytesOf(planned.needs, first.plan)}`);

    // ---------- L4 ----------
    let l4ok = true;
    if (first.plan) {
      for (const role of SAMPLED_ORDER) {
        const part = first.plan.parts[role];
        if (!part) continue;
        const mine = notes.filter((n) => n.part === role);
        let out = 0, edge = 0, short = 0, worst = 0;
        const dist = new Map<number, number>();
        const outs: number[] = [];
        for (const n of mine) {
          const rp = noteReport(part, n.midi, n.vel, n.gate);
          if (rp.outOfRange) { out++; if (outs.length < 20) outs.push(n.midi); continue; }
          if (rp.key !== n.midi) { edge++; dist.set(rp.key - n.midi, (dist.get(rp.key - n.midi) ?? 0) + 1); }
          let s = 0;
          for (const g of rp.regions) if (g.srcEnd >= 0) s = Math.max(s, n.gate + g.release - g.srcEnd);
          if (s > 0) { short++; worst = Math.max(worst, s); }
        }
        const d = [...dist].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k > 0 ? '+' : ''}${k}:${v}`).join(',') || 'none';
        rep.line(`L4 part ${role} instrument=${part.instrument.id} notes=${mine.length} outOfRange=${out} edge=${edge} edgeDistances=${d} samplesShort=${short} worstShortMs=${(worst * 1000 / SR).toFixed(1)}`);
        if (outs.length) rep.line(`L4 outOfRange ${role} midi=${outs.join(',')}`);
        if (out) l4ok = false;
      }
    }
    let mix: RenderedMusic | null = null;
    if (!first.bank) {
      rep.line(`L4 load refused ${errLine(first.error!)}`);
      l4ok = false;
    } else {
      mix = await renderMusic(styleId, a.bars, a.seed, { bank: first.bank, kit });
      const s = readWavSamples(mix.wav);
      let atCeiling = 0;
      for (let i = 0; i < s.length; i++) if (Math.abs(s[i]!) >= 21844) atCeiling++; // at the soft clip's ceiling (2/3 of full scale)
      rep.line(`L4 mix peak=${f4(mix.peak)} rms=${f6(mix.rms)} rmsDb=${db(mix.rms).toFixed(2)} clamped=${mix.clamped} samplesAtCeiling=${atCeiling} frames=${mix.layout.totalFrames}`);
      const v = musicValidationFailures(mix);
      rep.line(v.length ? `L4 validation failed=${v.map((x) => x.check).join(',')}` : 'L4 validation ok');
      for (const x of v) rep.line(`L4 validation ${x.check} ${JSON.stringify(x.error.message)}`);
      if (v.length) l4ok = false;
      const m = trackChecks(mix, styleId, a.bars);
      rep.line(m.failures.length ? `L4 mchecks failed=${m.failures.length} (music.test.ts M1 M6 M7 M8 as proof I14 reads them; informative)` : 'L4 mchecks ok (music.test.ts M1 M6 M7 M8 as proof I14 reads them; informative)');
      for (const f of m.failures.slice(0, 20)) rep.line(`L4 mcheck ${f}`);
    }
    if (!l4ok) failed.push('L4');

    // ---------- L6 ----------
    if (first.bank) {
      const proposed: Partial<Record<KitPartRole, number>> = {};
      const rows: { role: KitPartRole; current: number; synth: Awaited<ReturnType<typeof measured>>; sampled: Awaited<ReturnType<typeof measured>> }[] = [];
      for (const role of SAMPLED_ORDER) {
        const p = kit.parts[role];
        if (!p) continue;
        const synth = await measured(styleId, a.bars, a.seed, { solo: [role] });
        const sampled = await measured(styleId, a.bars, a.seed, { solo: [role], bank: first.bank, kit });
        let g = sampled.busRms > 0 && synth.busRms > 0 ? p.gainDb + db(synth.busRms / sampled.busRms) : p.gainDb;
        g = Math.round(Math.min(GAIN_MAX, Math.max(GAIN_MIN, g)) * 100) / 100;
        proposed[role] = g;
        rows.push({ role, current: p.gainDb, synth, sampled });
      }
      const kit2 = withGains(kit, proposed);
      const bank2 = await loadBank(check, kit2, notes);
      for (const row of rows) {
        const at = await renderMusic(styleId, a.bars, a.seed, { solo: [row.role], bank: bank2, kit: kit2 });
        rep.line(`GAIN ${row.role} current=${row.current.toFixed(2)} proposed=${proposed[row.role]!.toFixed(2)} synthRms=${f6(row.synth.r.rms)} sampledRms=${f6(row.sampled.r.rms)} sampledPeakAtProposed=${f4(at.peak)}`);
        rep.line(`L6 part ${row.role} synthPeak=${f4(row.synth.r.peak)} sampledPeak=${f4(row.sampled.r.peak)} sampledRmsAtProposed=${f6(at.rms)} synthBusRms=${f6(row.synth.busRms)} sampledBusRms=${f6(row.sampled.busRms)}${proposed[row.role] === GAIN_MIN || proposed[row.role] === GAIN_MAX ? ' clampedToSchemaBound=yes' : ''}`);
      }
      const all = await renderMusic(styleId, a.bars, a.seed, { bank: bank2, kit: kit2 });
      const v2 = musicValidationFailures(all);
      rep.line(`L6 mix atProposed peak=${f4(all.peak)} rms=${f6(all.rms)} rmsDb=${db(all.rms).toFixed(2)} clamped=${all.clamped} validation=${v2.length ? v2.map((x) => x.check).join(',') : 'ok'}`);
      rep.line('L6 method solo renders over the same notes; proposed gain from the RMS of the master input before the clamp and soft clip (linear in the gain), clamped to the schema bounds; the kit table is not edited');
    } else rep.line('L6 skipped reason=the bank was not loaded (see L4)');

    // ---------- L2 ----------
    let l2ok = true;
    if (mix && first.bank) {
      const again = await load(check, kit, notes);
      const h1 = pcmSha(mix);
      const h2 = again.bank ? pcmSha(await renderMusic(styleId, a.bars, a.seed, { bank: again.bank, kit })) : 'none';
      const child = await runChild([...forward(a), '--child', 'hash'], 15 * 60_000);
      const h3 = /CHILD pcm-sha256=([0-9a-f]{64})/.exec(child.out)?.[1] ?? `none(exit=${child.code})`;
      const eq = h1 === h2 && h1 === h3;
      rep.line(`L2 pcm sha256=${h1} again=${h2 === h1 ? 'equal' : h2} child=${h3 === h1 ? 'equal' : h3} equal=${eq ? 'yes' : 'no'}`);
      if (!eq) l2ok = false;
    } else { rep.line('L2 pcm skipped reason=the bank was not loaded'); l2ok = false; }
    const golden = readInstrumentsGolden();
    for (const g of GOLDEN_RENDERS) {
      const h = sha((await renderMusic(g.styleId, g.bars, g.seed, { bank: samplerTestBank() })).wav);
      const want = golden.renders[goldenKey(g)];
      rep.line(`L2 golden instruments "${goldenKey(g)}" sha256=${h} equal=${h === want ? 'yes' : 'no'}`);
      if (h !== want) l2ok = false;
    }
    const mg = JSON.parse(fs.readFileSync(path.join(REPO, 'apps/server/src/music.golden.json'), 'utf8')) as { bars: number; seed: number; sha256: Record<string, string> };
    for (const s of MUSIC_STYLES) {
      const h = sha((await renderMusic(s.id, mg.bars, mg.seed)).wav);
      rep.line(`L2 golden music ${s.id} sha256=${h} equal=${h === mg.sha256[s.id] ? 'yes' : 'no'}`);
      if (h !== mg.sha256[s.id]) l2ok = false;
    }
    if (!l2ok) failed.push('L2');

    // ---------- L3 ----------
    if (a.long) {
      const child = await runChild([...forward(a), '--child', 'long'], 30 * 60_000);
      const runs = [...child.out.matchAll(/^CHILD (run=.*)$/gm)].map((m) => m[1]!);
      const rss = /CHILD peakRssMB=([0-9.]+)/.exec(child.out)?.[1];
      for (const r of runs) rep.line(`L3 ${r.trim()}`);
      rep.line(`L3 peakRssMB=${rss ?? 'unknown'} samples=1 process=fresh child (cold = its first request: empty hash map, cold code; the OS page cache may hold the files L1 just read)`);
      if (runs.length !== 2 || runs.some((r) => !/valid=yes/.test(r))) { rep.line(`L3 failed exit=${child.code}`); failed.push('L3'); }
    }

    // ---------- L5 ----------
    if (a.audition) {
      if (!mix) { rep.line('L5 skipped reason=the bank was not loaded'); failed.push('L5'); }
      else {
        const synth = await renderMusic(styleId, a.bars, a.seed);
        const dir = path.resolve(a.audition);
        const loud = synth.rms > mix.rms ? 'synth' : 'recorded';
        const scale = loud === 'synth' ? mix.rms / synth.rms : synth.rms / mix.rms;
        const scaled = (r: RenderedMusic, k: number): Buffer => {
          if (k === 1) return Buffer.from(r.wav);
          const b = Buffer.from(r.wav);
          for (let o = 44; o < b.length; o += 2) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b.readInt16LE(o) * k))), o);
          return b;
        };
        const files = { synth: scaled(synth, loud === 'synth' ? scale : 1), recorded: scaled(mix, loud === 'recorded' ? scale : 1) };
        const aIsRecorded = randomInt(2) === 1;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'A.wav'), aIsRecorded ? files.recorded : files.synth, { flag: 'wx' });
        fs.writeFileSync(path.join(dir, 'B.wav'), aIsRecorded ? files.synth : files.recorded, { flag: 'wx' });
        fs.writeFileSync(path.join(dir, 'key.txt'), `kit ${kitKey(kit)} style ${styleId} bars ${a.bars} seed ${a.seed}\nA = ${aIsRecorded ? 'recorded instruments' : 'synthesiser'}\nB = ${aIsRecorded ? 'synthesiser' : 'recorded instruments'}\nThe louder of the two was scaled by ${scale.toFixed(4)} to the RMS of the other. Nobody has listened.\n`, { flag: 'wx' });
        rep.line(`L5 audition files=A.wav,B.wav,key.txt levelScale=${scale.toFixed(4)} matchedRms=${f6(Math.min(synth.rms, mix.rms))} (which file is which is only in key.txt)`);
      }
    }
  } finally { closeLibraryService(cfg.dataDir); }
  rep.line(failed.length ? `SUMMARY failed=${failed.join(',')}` : 'SUMMARY ok');
  if (a.save) {
    const name = `pf-kit-check-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    fs.writeFileSync(path.join(os.tmpdir(), name), rep.lines.join('\n') + '\n', { flag: 'wx' });
    sink(`REPORT saved=<tmp>/${name}`);
  }
  return failed.length ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  kitCheckMain(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => {
    process.stdout.write(`ERROR ${String(e instanceof Error ? e.message : e).replace(/[^\x20-\x7e]/g, '?').slice(0, 300)}\nSUMMARY failed=error\n`);
    process.exitCode = 1;
  });
}
