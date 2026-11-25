/**
 * SYNTHETIC TEST KIT for recorded instruments «כלים מוקלטים» (wave 7 instruments track; builder W2). LABELLED: every file here is a
 * tone written by code for tests and proofs — not a recording and not a sample set. Nothing is downloaded and nothing is committed:
 * the files are written on demand under a temporary library folder that the caller deletes.
 *
 * - synthWav: RIFF/WAVE bytes of a sine (with an optional marker harmonic), 16/24/32-bit integer or 32-bit float, mono or stereo,
 *   plain or WAVE_FORMAT_EXTENSIBLE, with an optional `smpl` loop.
 * - writeSyntheticKit: a library folder with `_manifests/ledger.json` (one git item per instrument, each from its own synthetic
 *   source and licence) and two instruments, "strings" (looped zones, 44.1 kHz mono 16-bit) and "piano" (decaying zones, 48 kHz
 *   stereo 24-bit), each an .sfz with one zone every octave from C2 to C7 (covering MIDI 30–101: every note the calm style plays);
 *   returns the kit table (KitTable) with each file's size and sha256 as the laptop's check L1 would write them.
 * - refreshKitTable: after a test changed a file on purpose, the table that describes the folder as it now is.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Local shapes (this package depends on nothing): structurally the core types KitTable and LedgerRow (packages/core musicKits.ts,
// libraryContract.ts), so a test passes them where those are expected.
type Role = 'pad' | 'stab' | 'arp' | 'bass' | 'lead' | 'double';
export interface KitFileRow { path: string; bytes: number; sha256: string }
export interface KitTable {
  id: string; version: number; styleId: string; review: 'unheard';
  instruments: { id: string; title: { he: string; en: string }; ledgerItem: string; ledgerPin: string; entry: string | null; files: KitFileRow[]; cc?: Record<string, number> }[];
  parts: Partial<Record<Role, { instrument: string; gainDb: number; vel: [number, number]; attackMax?: number; releaseMax?: number }>>;
}
export interface LedgerRow {
  item: string; source: string; sourceTitle: string; manifest: string; manifestSha256: string; kind: 'file' | 'archive' | 'npm' | 'git'; identity: string; url: string;
  path: string; bytes: number; pinned: boolean; commit?: string; sha256?: string;
  licence: { spdx?: string; custom?: string; url: string; readOn: string; quote: string }; credit: string | null; flags: Record<string, boolean>; time: string;
}

export const SYNTHETIC_KIT_LABEL = 'SYNTHETIC TEST KIT: tones written by code for tests; not a recording, not a sample set' as const;

export interface ToneSpec {
  rate: number; channels: 1 | 2; bits: 16 | 24 | 32; float?: boolean; extensible?: boolean;
  frames: number; freq: number;
  /** peak of the fundamental (default 0.5) */ amp?: number;
  /** amplitude of a 5th-harmonic marker (default 0) */ marker?: number;
  /** exponential decay to −60 dB over this many seconds (default: none) */ decay?: number;
  /** `smpl` loop, frames, end inclusive */ loop?: { start: number; end: number };
}
/** A RIFF/WAVE file of a synthetic tone (see ToneSpec). Pure and deterministic. */
export function synthWav(t: ToneSpec): Buffer {
  const bps = t.bits / 8, align = t.channels * bps, dataBytes = t.frames * align;
  const fmtSize = t.extensible ? 40 : 16;
  const smplSize = t.loop ? 36 + 24 : 0;
  const total = 12 + 8 + fmtSize + 8 + dataBytes + (dataBytes & 1) + (t.loop ? 8 + smplSize : 0);
  const b = Buffer.alloc(total);
  let o = 0;
  b.write('RIFF', o); b.writeUInt32LE(total - 8, o + 4); b.write('WAVE', o + 8); o += 12;
  b.write('fmt ', o); b.writeUInt32LE(fmtSize, o + 4); o += 8;
  const tag = t.float ? 3 : 1;
  b.writeUInt16LE(t.extensible ? 0xfffe : tag, o); b.writeUInt16LE(t.channels, o + 2); b.writeUInt32LE(t.rate, o + 4);
  b.writeUInt32LE(t.rate * align, o + 8); b.writeUInt16LE(align, o + 12); b.writeUInt16LE(t.bits, o + 14);
  if (t.extensible) {
    b.writeUInt16LE(22, o + 16); b.writeUInt16LE(t.bits, o + 18); b.writeUInt32LE(t.channels === 2 ? 3 : 4, o + 20);
    b.writeUInt16LE(tag, o + 24);
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]).copy(b, o + 26);
  }
  o += fmtSize;
  b.write('data', o); b.writeUInt32LE(dataBytes, o + 4); o += 8;
  const amp = t.amp ?? 0.5, marker = t.marker ?? 0;
  const k = t.decay ? Math.log(1000) / (t.decay * t.rate) : 0;
  for (let i = 0; i < t.frames; i++) {
    const ph = (2 * Math.PI * t.freq * i) / t.rate;
    const env = k ? Math.exp(-k * i) : 1;
    for (let c = 0; c < t.channels; c++) {
      const v = (amp * Math.sin(ph + c * 0.1) + marker * Math.sin(5 * ph)) * env;
      if (t.float) b.writeFloatLE(v, o);
      else if (t.bits === 16) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), o);
      else if (t.bits === 24) b.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607))), o, 3);
      else b.writeInt32LE(Math.max(-2147483648, Math.min(2147483647, Math.round(v * 2147483647))), o);
      o += bps;
    }
  }
  o += dataBytes & 1;
  if (t.loop) {
    b.write('smpl', o); b.writeUInt32LE(smplSize, o + 4); o += 8;
    b.writeUInt32LE(1, o + 28); // one loop
    b.writeUInt32LE(t.loop.start, o + 36 + 8); b.writeUInt32LE(t.loop.end, o + 36 + 12);
  }
  return b;
}

/** A synthetic library source: its id, licence and credit as the ledger would hold them. */
export interface SyntheticSource { id: string; title: string; spdx?: string; custom?: string; credit: string | null; flags?: Record<string, boolean> }
const OK_FLAGS = { diskOnly: false, creditInExport: false, shareAlike: false, people: false, aiGenerated: false, repoAllowed: true } as const;
/** Synthetic sources for every licence case the checks need (L-D1–L-D3). None is a real source. */
export const SYNTHETIC_SOURCES = {
  cc0: { id: 'synthetic-zero', title: 'Synthetic tones (CC0 test source)', spdx: 'CC0-1.0', credit: null },
  ccBy: { id: 'synthetic-by', title: 'Synthetic tones (CC BY test source)', spdx: 'CC-BY-4.0', credit: 'Synthetic test tones by Test Maker (CC BY 4.0)' },
  ccByNc: { id: 'synthetic-nc', title: 'Synthetic tones (CC BY-NC test source)', spdx: 'CC-BY-NC-4.0', credit: 'Synthetic test tones by NC Maker (CC BY-NC 4.0)' },
  ccBySa: { id: 'synthetic-sa', title: 'Synthetic tones (CC BY-SA test source)', spdx: 'CC-BY-SA-4.0', credit: 'Synthetic test tones by SA Maker' },
  ccByNd: { id: 'synthetic-nd', title: 'Synthetic tones (CC BY-ND test source)', spdx: 'CC-BY-ND-4.0', credit: 'Synthetic test tones by ND Maker' },
  unknown: { id: 'synthetic-unknown', title: 'Synthetic tones (unknown licence)', custom: 'whatever the uploader said', credit: null },
} satisfies Record<string, SyntheticSource>;

export interface SyntheticKitOptions {
  strings?: SyntheticSource; piano?: SyntheticSource;
  /** seconds of each strings zone (default 0.5) and each piano zone (default 0.4); larger for the speed check */ stringsSeconds?: number; pianoSeconds?: number;
  /** the commit the ledger records and the kit is pinned to (default 'synthetic-commit-1') */ commit?: string;
  /** the commit the kit table names (default: the ledger's) */ kitPin?: string;
}
export interface SyntheticKit {
  label: typeof SYNTHETIC_KIT_LABEL;
  root: string; kit: KitTable;
  /** each instrument's folder on disk and its ledger item */
  items: Record<'strings' | 'piano', { dir: string; item: string; entryPath: string }>;
  ledger: LedgerRow[];
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const CENTRES = [36, 48, 60, 72, 84, 96];
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const names = (midi: number) => `${['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'][midi % 12]}${Math.floor(midi / 12) - 1}`;

function ledgerEntry(src: SyntheticSource, item: string, entryPath: string, commit: string, bytes: number): LedgerRow {
  return {
    item, source: src.id, sourceTitle: src.title, manifest: 'synthetic-test.json', manifestSha256: '0'.repeat(64), kind: 'git', identity: `synthetic:${item}`,
    url: 'https://example.invalid/synthetic', path: entryPath, bytes, pinned: true, commit,
    licence: { ...(src.spdx ? { spdx: src.spdx } : {}), ...(src.custom ? { custom: src.custom } : {}), url: 'https://example.invalid/licence', readOn: '2026-11-25', quote: SYNTHETIC_KIT_LABEL },
    credit: src.credit, flags: { ...OK_FLAGS, ...(src.flags ?? {}) }, time: '2026-11-25T00:00:00.000Z',
  };
}

/** Writes the labelled synthetic test kit under `root` (created if missing) and returns its kit table and ledger. */
export function writeSyntheticKit(root: string, o: SyntheticKitOptions = {}): SyntheticKit {
  const commit = o.commit ?? 'synthetic-commit-1';
  const sources = { strings: o.strings ?? SYNTHETIC_SOURCES.cc0, piano: o.piano ?? SYNTHETIC_SOURCES.cc0 };
  const items = {} as SyntheticKit['items'];
  const ledger: LedgerRow[] = [];
  const instruments: KitTable['instruments'] = [];
  for (const id of ['strings', 'piano'] as const) {
    const entryPath = `instruments/synthetic-${id}`;
    const dir = path.join(root, ...entryPath.split('/'));
    fs.mkdirSync(path.join(dir, 'samples'), { recursive: true });
    const lines = [`// ${SYNTHETIC_KIT_LABEL}`, '<control> default_path=samples/', `<group> ampeg_release=${id === 'strings' ? '0.3' : '0.2'}${id === 'strings' ? ' ampeg_attack=0.05' : ''}`];
    for (const c of CENTRES) {
      const file = `${id}-${names(c).replace('#', 's')}.wav`;
      const bytes = id === 'strings'
        ? (() => { const frames = Math.round((o.stringsSeconds ?? 0.5) * 44100); return synthWav({ rate: 44100, channels: 1, bits: 16, frames, freq: hz(c), amp: 0.4, loop: { start: Math.floor(frames / 5), end: frames - 1 } }); })()
        : synthWav({ rate: 48000, channels: 2, bits: 24, frames: Math.round((o.pianoSeconds ?? 0.4) * 48000), freq: hz(c), amp: 0.5, marker: 0.05, decay: o.pianoSeconds ?? 0.4 });
      fs.writeFileSync(path.join(dir, 'samples', file), bytes);
      lines.push(`<region> sample=${file} lokey=${c - 6} hikey=${c + 5} pitch_keycenter=${names(c)}`);
    }
    fs.writeFileSync(path.join(dir, `${id}.sfz`), lines.join('\n') + '\n');
    const item = `${sources[id].id}/${id}`;
    items[id] = { dir, item, entryPath };
    instruments.push({ id, title: { he: id === 'strings' ? 'מיתרים (ערכת בדיקה סינתטית)' : 'פסנתר (ערכת בדיקה סינתטית)', en: `${id === 'strings' ? 'Strings' : 'Piano'} (synthetic test kit)` }, ledgerItem: item, ledgerPin: o.kitPin ?? commit, entry: `${id}.sfz`, files: tableOf(dir) });
    ledger.push(ledgerEntry(sources[id], item, entryPath, commit, instruments.at(-1)!.files.reduce((s: number, f: KitFileRow) => s + f.bytes, 0)));
  }
  writeLedger(root, ledger);
  const kit: KitTable = {
    id: 'kit.calm.synthetic', version: 1, styleId: 'music.calm', review: 'unheard', instruments,
    parts: { pad: { instrument: 'strings', gainDb: -18, vel: [40, 100] }, double: { instrument: 'strings', gainDb: -18, vel: [40, 100] }, arp: { instrument: 'piano', gainDb: -18, vel: [40, 110] }, lead: { instrument: 'piano', gainDb: -18, vel: [50, 120] } },
  };
  return { label: SYNTHETIC_KIT_LABEL, root, kit, items, ledger };
}
/** Writes `_manifests/ledger.json` (version 1) under `root`. */
export function writeLedger(root: string, entries: readonly unknown[]): void {
  fs.mkdirSync(path.join(root, '_manifests'), { recursive: true });
  fs.writeFileSync(path.join(root, '_manifests', 'ledger.json'), JSON.stringify({ ledgerVersion: 1, entries, licenceTexts: [] }, null, 1));
}
/** Every regular file under an instrument folder, sorted, with size and sha256 (forward-slash paths relative to the folder). */
export function tableOf(dir: string): { path: string; bytes: number; sha256: string }[] {
  const out: { path: string; bytes: number; sha256: string }[] = [];
  const walk = (rel: string) => {
    for (const d of fs.readdirSync(path.join(dir, ...rel.split('/').filter(Boolean)), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) { const b = fs.readFileSync(path.join(dir, ...r.split('/'))); out.push({ path: r, bytes: b.length, sha256: sha(b) }); }
    }
  };
  walk('');
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}
/** The kit table of the folder as it is now (after a test changed a file on purpose). */
export function refreshKitTable(k: SyntheticKit): KitTable {
  return { ...k.kit, instruments: k.kit.instruments.map((i: KitTable['instruments'][number]) => ({ ...i, files: tableOf(k.items[i.id as 'strings' | 'piano'].dir) })) };
}

/**
 * LABELLED STAND-IN of the sampler's zone planner (tests and the loader proof only, until builder W1's planZones is merged): every
 * note needs, from each region whose key range holds it, `framesPerNote` frames of that region's zone (default: the whole zone); a
 * note no region holds is out of range. It says nothing about how a note sounds and decodes nothing itself.
 */
export function standInPlanZones<P extends string>(
  notes: readonly { part: P; midi: number }[],
  bank: { parts: Partial<Record<P, { instrument: { id: string; regions: readonly { zone: number; lokey: number; hikey: number }[]; zones: readonly { frames: number }[] } }>> },
  framesPerNote?: number,
): { needs: { instrument: string; zone: number; frames: number }[]; outOfRange: { part: P; instrument: string; midi: number } | null } {
  const needs = new Map<string, { instrument: string; zone: number; frames: number }>();
  for (const n of notes) {
    const p = bank.parts[n.part];
    if (!p) continue;
    const hit = p.instrument.regions.filter((r) => r.lokey <= n.midi && n.midi <= r.hikey);
    if (!hit.length) return { needs: [], outOfRange: { part: n.part, instrument: p.instrument.id, midi: n.midi } };
    for (const r of hit) {
      const frames = Math.min(p.instrument.zones[r.zone]!.frames, framesPerNote ?? Number.MAX_SAFE_INTEGER);
      const k = `${p.instrument.id}/${r.zone}`;
      needs.set(k, { instrument: p.instrument.id, zone: r.zone, frames: Math.max(frames, needs.get(k)?.frames ?? 0) });
    }
  }
  return { needs: [...needs.values()], outOfRange: null };
}

// ---------- mutations of the synthetic files (fuzz check I19; seeded, deterministic) ----------
/** A seeded generator (mulberry32). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const SAFE_REL = (p: string) => !p.startsWith('/') && !p.includes('\\') && !p.includes(':') && !/[\u0000-\u001f]/.test(p) && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

export const WAV_SEEDS: readonly Buffer[] = [
  synthWav({ rate: 44100, channels: 1, bits: 16, frames: 300, freq: 440, loop: { start: 10, end: 250 } }),
  synthWav({ rate: 48000, channels: 2, bits: 24, frames: 200, freq: 1000 }),
  synthWav({ rate: 96000, channels: 2, bits: 32, float: true, extensible: true, frames: 150, freq: 3000, loop: { start: 0, end: 149 } }),
  synthWav({ rate: 22050, channels: 1, bits: 32, frames: 100, freq: 100 }),
];
const EXTREMES = [0, 1, 2, 3, 8, 0x7fffffff, 0x80000000, 0xffffffff, 0xfffffffe, 44, 36, 16, 40];
export function mutateWav(b0: Buffer, rnd: () => number): Buffer {
  let b = Buffer.from(b0);
  const n = 1 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const op = Math.floor(rnd() * 7);
    const at = Math.floor(rnd() * Math.min(b.length, rnd() < 0.8 ? 80 : b.length));
    if (op === 0 && b.length) b[at] = Math.floor(rnd() * 256);
    else if (op === 1 && at + 4 <= b.length) b.writeUInt32LE(EXTREMES[Math.floor(rnd() * EXTREMES.length)]!, at - (at % 2));
    else if (op === 2 && at + 2 <= b.length) b.writeUInt16LE([0, 1, 2, 3, 6, 8, 0xfffe, 0xffff, 255][Math.floor(rnd() * 9)]!, at);
    else if (op === 3) b = b.subarray(0, Math.floor(rnd() * b.length));
    else if (op === 4) b = Buffer.concat([b, Buffer.from(['smpl', 'data', 'fmt ', 'LIST', 'junk'][Math.floor(rnd() * 5)]!), Buffer.alloc(Math.floor(rnd() * 40), Math.floor(rnd() * 256))]);
    else if (op === 5 && b.length > 12) { const cut = 12 + Math.floor(rnd() * (b.length - 12)); b = Buffer.concat([b.subarray(0, cut), b.subarray(cut, cut + Math.floor(rnd() * 64)), b.subarray(cut)]); }
    else if (op === 6) b.write(['fLaC', 'OggS', 'FORM', 'RF64', 'RIFX', 'RIFF'][Math.floor(rnd() * 6)]!, 0);
  }
  return b;
}
export const SFZ_SEED = [
  '// synthetic', '#define $V -3', '<control> default_path=samples\\ octave_offset=0 note_offset=0',
  '<global> volume=$V ampeg_release=0.3', '#include "inc/common.sfzh"', '<group> lovel=1 hivel=127 locc64=0 hicc64=127 xfin_locc1=0 xfin_hicc1=127',
  '<region> sample=a.wav lokey=c3 hikey=b3 pitch_keycenter=f#3 loop_mode=loop_continuous loop_start=10 loop_end=200',
  '<region> sample=b c.wav key=60 tune=12 trigger=first sw_lokey=24 sw_hikey=26 sw_default=24 seq_position=1 lorand=0 hirand=1',
  '<region> sample=rel.wav trigger=release', '<curve> v000=0', '<region> sample=d.wav amp_velcurve_127=1 offset=10 end=100',
].join('\n');
const SFZ_TOKENS = ['..', '../', '..\\', '\\', '/', 'C:', 'C:\\', '\u0000', '\u0007', '#include "', '#include "../x"', '#include "inc/common.sfzh"', '#define $V ', '$V', '$', '<region>', '<group>', '<control>', '<global>', '<master>', '<', '>', '=', 'sample=', 'sample=/etc/passwd', 'sample=..\\..\\x.wav', 'lokey=', 'key=-1', 'loop_mode=', '1e309', '-99999999999', 'c#11', 'zz9', ' ', '\n', '\r\n', '/*', '*/', '//', '"', 'default_path=', 'amp_velcurve_999=2', 'locc999=1'];
export function mutateSfz(rnd: () => number): string {
  let s = SFZ_SEED;
  const n = 1 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(rnd() * (s.length + 1));
    const op = Math.floor(rnd() * 4);
    if (op === 0) s = s.slice(0, at) + SFZ_TOKENS[Math.floor(rnd() * SFZ_TOKENS.length)]! + s.slice(at);
    else if (op === 1) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rnd() * 12));
    else if (op === 2) s = s.slice(0, at);
    else s = s.slice(0, at) + String.fromCharCode(Math.floor(rnd() * 0x3000)) + s.slice(at);
  }
  return s;
}

