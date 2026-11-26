/**
 * SFZ subset parser of recorded instruments (wave 7 instruments track; plan §4.2 with C10). Pure over text; `include` is a callback
 * (the loader resolves #include inside the instrument's folder from the kit table's files, depth ≤ INSTRUMENTS_LIMITS.maxIncludeDepth).
 * Throws only InstrumentError. BUILDER W2.
 * Headers <control> <global> <master> <group> <region> with inheritance; #define; default_path; octave_offset and note_offset; note
 * names (C4 = 60). Sample paths: '\' becomes '/'; an absolute path, a drive letter, a '..' or '.' segment, an empty segment, a NUL or
 * any control character refuses the whole file (path_escape) — the loader then finds the path inside the item (a single
 * case-insensitive match is counted in warnings; two matches refuse). Opcodes outside the list below are counted, never applied;
 * regions with trigger=release, release_key or legato are skipped and counted. Round-robin is cut (decisions §1 b): seq_position and
 * lorand/hirand are carried for the sampler, which plays position 1 / the region covering 0 only.
 * UNTRUSTED text: its size, the number of includes, the expanded size of #define, the number of regions and every number are bounded.
 */
import { INSTRUMENTS_LIMITS } from '@pulseframe/core';
import type { Region } from '../music/sampler.ts';
import { InstrumentError } from './contract.ts';

export type ParsedRegion = Omit<Region, 'zone'> & {
  /** The sample path as written, after '\' → '/' and default_path, checked as a relative path (no '..'). */
  sample: string;
  /** False when the file gave no loop_mode: the loader then follows the sample (a smpl loop → loop_continuous, as SFZ says). */
  loopModeGiven: boolean;
};
export interface ParsedSfz {
  /** Regions with their sample path as written (after '\' → '/' and default_path), in file order. */
  regions: ParsedRegion[];
  /** Opcodes met and not applied, with counts (shown in L1's report). */
  ignored: Record<string, number>;
  warnings: string[];
}

/** Limits of one parse (the whole text with its includes). */
export const SFZ_LIMITS = { maxChars: 4 * 1024 * 1024, maxIncludes: 256, maxDefines: 512, maxRegions: 8192, maxValueChars: 1024 } as const;

const NOTE = /^([a-gA-G])([#b]?)(-?\d{1,2})$/;
const NOTE_BASE: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NUM = /^[+-]?(\d{1,9}(\.\d{0,9})?|\.\d{1,9})$/;
const clean = (s: string, n = 60) => s.slice(0, n).replace(/[^\x20-\x7e]/g, '?');

/**
 * A relative path as written in an SFZ file (sample=, default_path, #include), with '\' made '/'. Refuses (path_escape) anything that
 * could leave the folder or name another drive: absolute, drive letter or colon, '..' or '.' or empty segment, NUL or control
 * characters. `allowTrailingSlash` for default_path.
 */
export function sfzPath(raw: string, allowEmpty = false): string {
  const p = raw.replace(/\\/g, '/');
  if (p === '') { if (allowEmpty) return ''; throw new InstrumentError('path_escape', 'an empty path'); }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) throw new InstrumentError('path_escape', 'a path with a control character');
  if (p.startsWith('/') || p.includes(':')) throw new InstrumentError('path_escape', 'an absolute path or a drive');
  const segs = (allowEmpty && p.endsWith('/') ? p.slice(0, -1) : p).split('/');
  for (const s of segs) if (s === '' || s === '.' || s === '..') throw new InstrumentError('path_escape', 'a path with a .. or empty segment');
  return p;
}

/** A key: a MIDI number or a note name (c4 = 60, c#4, db4), plus `shift` (octave_offset·12 + note_offset), clamped to 0..127. */
function key(v: string, op: string, shift: number): number {
  let n: number;
  const m = NOTE.exec(v);
  if (m) n = NOTE_BASE[m[1]!.toLowerCase()]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  else if (/^-?\d{1,3}$/.test(v)) n = Number(v);
  else throw new InstrumentError('format', `${clean(op)}=${clean(v, 20)} is not a key`);
  if (n === -1) return -1; // "-1": no key (sw_* and key opcodes use it for none)
  n += shift;
  return n < 0 ? 0 : n > 127 ? 127 : n;
}
function num(v: string, op: string, lo: number, hi: number): number {
  if (!NUM.test(v)) throw new InstrumentError('format', `${clean(op)}=${clean(v, 20)} is not a number`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InstrumentError('format', `${clean(op)}=${clean(v, 20)} is not a number`);
  return n < lo ? lo : n > hi ? hi : n;
}
const int = (v: string, op: string, lo: number, hi: number) => Math.round(num(v, op, lo, hi));

type Opcodes = Map<string, string>;
interface Scope { control: Opcodes; global: Opcodes; master: Opcodes; group: Opcodes }
const HEADERS = new Set(['control', 'global', 'master', 'group', 'region']);
/** Opcodes this build applies (everything else is counted in `ignored`). Aliases are mapped first. */
const ALIAS: Readonly<Record<string, string>> = { loopmode: 'loop_mode', loopstart: 'loop_start', loopend: 'loop_end' };
const APPLIED = new Set([
  'sample', 'lokey', 'hikey', 'key', 'lovel', 'hivel', 'pitch_keycenter', 'pitch_keytrack', 'transpose', 'tune', 'volume', 'pan', 'offset', 'end',
  'amp_veltrack', 'loop_mode', 'loop_start', 'loop_end', 'ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_sustain', 'ampeg_release', 'trigger',
  'sw_lokey', 'sw_hikey', 'sw_last', 'sw_default', 'seq_position', 'lorand', 'hirand', 'default_path', 'octave_offset', 'note_offset',
]);
const CC_OP = /^(locc|hicc|xfin_locc|xfin_hicc|xfout_locc|xfout_hicc|set_cc)(\d{1,3})$/;
const VELCURVE = /^amp_velcurve_(\d{1,3})$/;

export function parseSfz(text: string, include: (path: string) => string): ParsedSfz {
  if (typeof text !== 'string') throw new InstrumentError('unreadable', 'no text');
  const ignored: Record<string, number> = Object.create(null) as Record<string, number>;
  const warnings: string[] = [];
  const count = (k: string) => { const c = clean(k, 40); ignored[c] = (ignored[c] ?? 0) + 1; };
  const defines = new Map<string, string>();
  let chars = 0, includes = 0;
  const regions: ParsedRegion[] = [];
  const scope: Scope = { control: new Map(), global: new Map(), master: new Map(), group: new Map() };
  let header: string | null = null;
  let region: Opcodes | null = null;

  const closeRegion = () => {
    if (region) { emit(region); region = null; }
  };
  const emit = (own: Opcodes) => {
    const ops = new Map<string, string>([...scope.global, ...scope.master, ...scope.group, ...own]);
    const trig = ops.get('trigger') ?? 'attack';
    if (trig !== 'attack' && trig !== 'first') { count(`trigger=${trig}`); return; }
    if (!ops.has('sample')) { count('region without sample'); return; }
    if (regions.length >= SFZ_LIMITS.maxRegions) throw new InstrumentError('too_large', `more than ${SFZ_LIMITS.maxRegions} regions`);
    regions.push(toRegion(ops, trig, scope.control));
  };

  const feed = (src: string, depth: number) => {
    chars += src.length;
    if (chars > SFZ_LIMITS.maxChars) throw new InstrumentError('too_large', `the instrument text is longer than ${SFZ_LIMITS.maxChars} characters`);
    // comments: block comments, then line comments (a '//' inside a value ends it, as in every SFZ player)
    const noBlock = src.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');
    for (const rawLine of noBlock.split(/\r\n|\r|\n/)) {
      let line = rawLine.replace(/\/\/.*$/, '');
      const pre = /^\s*#(define|include)\b\s*(.*)$/.exec(line);
      if (pre) {
        if (pre[1] === 'define') {
          const d = /^(\$[A-Za-z0-9_]{1,64})\s+(.*?)\s*$/.exec(pre[2]!);
          if (!d) throw new InstrumentError('format', 'a #define without a $name and a value');
          if (defines.size >= SFZ_LIMITS.maxDefines && !defines.has(d[1]!)) throw new InstrumentError('too_large', `more than ${SFZ_LIMITS.maxDefines} #define`);
          if (d[2]!.length > SFZ_LIMITS.maxValueChars) throw new InstrumentError('too_large', 'a #define value is too long');
          defines.set(d[1]!, d[2]!);
        } else {
          const q = /^"([^"]*)"\s*$/.exec(pre[2]!);
          if (!q) throw new InstrumentError('format', 'an #include without a quoted path');
          const p = sfzPath(expand(q[1]!));
          if (depth + 1 > INSTRUMENTS_LIMITS.maxIncludeDepth) throw new InstrumentError('too_large', `#include deeper than ${INSTRUMENTS_LIMITS.maxIncludeDepth}`);
          if (++includes > SFZ_LIMITS.maxIncludes) throw new InstrumentError('too_large', `more than ${SFZ_LIMITS.maxIncludes} #include`);
          const t = include(p);
          if (typeof t !== 'string') throw new InstrumentError('unreadable', `the include ${clean(p)} could not be read`);
          feed(t, depth + 1);
        }
        continue;
      }
      if (line.includes('$')) line = expand(line);
      parseLine(line);
    }
  };
  const expand = (s: string): string => {
    if (!s.includes('$') || defines.size === 0) return s;
    // longest names first, so $AB is not read as $A followed by B
    const names = [...defines.keys()].sort((a, b) => b.length - a.length);
    let out = '';
    for (let i = 0; i < s.length;) {
      if (s[i] === '$') {
        const n = names.find((k) => s.startsWith(k, i));
        if (n) { out += defines.get(n)!; i += n.length; if (out.length > SFZ_LIMITS.maxValueChars * 8) throw new InstrumentError('too_large', 'a line grows too long through #define'); continue; }
      }
      out += s[i]; i++;
    }
    return out;
  };
  const parseLine = (line: string) => {
    // split into header tokens and opcode runs
    const re = /<([^<>\s]{1,32})>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      opcodes(line.slice(last, m.index));
      startHeader(m[1]!.toLowerCase());
      last = m.index + m[0].length;
    }
    opcodes(line.slice(last));
  };
  const startHeader = (h: string) => {
    closeRegion();
    if (!HEADERS.has(h)) { count(`<${h}>`); header = null; return; }
    header = h;
    if (h === 'control') { /* control opcodes accumulate */ }
    else if (h === 'global') { scope.global = new Map(); scope.master = new Map(); scope.group = new Map(); }
    else if (h === 'master') { scope.master = new Map(); scope.group = new Map(); }
    else if (h === 'group') { scope.group = new Map(); }
    else region = new Map();
  };
  const opcodes = (s: string) => {
    if (!s.trim()) return;
    // name=value pairs; a value runs to the next " name=" (sample paths may hold spaces)
    const re = /([A-Za-z0-9_]{1,48})=/g;
    const starts: { name: string; at: number; v: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > 0 && !/\s/.test(s[m.index - 1]!)) continue; // part of a value
      starts.push({ name: m[1]!, at: m.index, v: m.index + m[0].length });
    }
    if (!starts.length) { if (s.trim()) count('text that is not an opcode'); return; }
    if (s.slice(0, starts[0]!.at).trim()) count('text that is not an opcode');
    for (let i = 0; i < starts.length; i++) {
      const st = starts[i]!;
      const value = s.slice(st.v, i + 1 < starts.length ? starts[i + 1]!.at : s.length).trim();
      if (value.length > SFZ_LIMITS.maxValueChars) throw new InstrumentError('too_large', `the value of ${clean(st.name)} is too long`);
      set(st.name.toLowerCase(), value);
    }
  };
  const set = (rawName: string, value: string) => {
    const name = ALIAS[rawName] ?? rawName;
    if (!APPLIED.has(name) && !CC_OP.test(name) && !VELCURVE.test(name)) { count(name); return; }
    if (header === null) { count(name); return; }
    if (header === 'control') {
      if (name === 'default_path' || name === 'octave_offset' || name === 'note_offset' || /^set_cc\d+$/.test(name)) scope.control.set(name, value);
      else count(`<control> ${name}`);
      return;
    }
    if (name === 'default_path' || name === 'octave_offset' || name === 'note_offset' || /^set_cc\d+$/.test(name)) { count(`${name} outside <control>`); return; }
    const target = header === 'region' ? region! : scope[header as 'global' | 'master' | 'group'];
    target.set(name, value);
  };

  const toRegion = (ops: Opcodes, trig: string, control: Opcodes): ParsedRegion => {
    const shift = (control.has('octave_offset') ? int(control.get('octave_offset')!, 'octave_offset', -10, 10) * 12 : 0) + (control.has('note_offset') ? int(control.get('note_offset')!, 'note_offset', -127, 127) : 0);
    const dp = control.has('default_path') ? sfzPath(control.get('default_path')!, true) : '';
    const sample = sfzPath((dp && !dp.endsWith('/') ? dp + '/' : dp) + sfzPath(ops.get('sample')!));
    const g = (k: string) => ops.get(k);
    let lokey = 0, hikey = 127;
    let keycenter = 60;
    if (g('key') !== undefined) { const k = key(g('key')!, 'key', shift); if (k >= 0) { lokey = hikey = keycenter = k; } }
    if (g('lokey') !== undefined) { const k = key(g('lokey')!, 'lokey', shift); lokey = k < 0 ? 0 : k; }
    if (g('hikey') !== undefined) { const k = key(g('hikey')!, 'hikey', shift); hikey = k < 0 ? 0 : k; }
    if (g('pitch_keycenter') !== undefined) { const k = key(g('pitch_keycenter')!, 'pitch_keycenter', shift); if (k >= 0) keycenter = k; }
    const lovel = g('lovel') !== undefined ? int(g('lovel')!, 'lovel', 0, 127) : 1;
    const hivel = g('hivel') !== undefined ? int(g('hivel')!, 'hivel', 0, 127) : 127;
    const loopModeRaw = g('loop_mode');
    if (loopModeRaw !== undefined && !['no_loop', 'one_shot', 'loop_continuous', 'loop_sustain'].includes(loopModeRaw)) throw new InstrumentError('format', `loop_mode=${clean(loopModeRaw, 20)}`);
    const cc = (prefix: string) => {
      const out: Record<number, number> = {};
      for (const [k, v] of ops) { const m = CC_OP.exec(k); if (m && m[1] === prefix) out[int(m[2]!, k, 0, 127)] = int(v, k, 0, 127); }
      return out;
    };
    const xf = (lo: string, hi: string) => {
      const l = cc(lo), h = cc(hi);
      const nums = [...new Set([...Object.keys(l), ...Object.keys(h)])].map(Number);
      if (!nums.length) return null;
      if (nums.length > 1) count(`${lo}/${hi} on more than one controller`);
      const c = nums[0]!;
      return { cc: c, lo: l[c] ?? 0, hi: h[c] ?? 127 };
    };
    const curve: [number, number][] = [];
    for (const [k, v] of ops) { const m = VELCURVE.exec(k); if (m) curve.push([int(m[1]!, k, 0, 127), num(v, k, 0, 1)]); }
    curve.sort((a, b) => a[0] - b[0]);
    const hasSw = ['sw_lokey', 'sw_hikey', 'sw_last', 'sw_default'].some((k) => g(k) !== undefined);
    const swKey = (k: string) => { const v = g(k); if (v === undefined) return null; const n = key(v, k, shift); return n < 0 ? null : n; };
    const time = (k: string, d: number) => (g(k) !== undefined ? num(g(k)!, k, 0, 100) : d);
    const optInt = (k: string, hi: number) => (g(k) !== undefined ? int(g(k)!, k, 0, hi) : null);
    return {
      sample, loopModeGiven: loopModeRaw !== undefined,
      lokey, hikey, lovel, hivel, keycenter,
      keytrack: g('pitch_keytrack') !== undefined ? num(g('pitch_keytrack')!, 'pitch_keytrack', -1200, 1200) : 100,
      transpose: g('transpose') !== undefined ? int(g('transpose')!, 'transpose', -127, 127) : 0,
      tune: g('tune') !== undefined ? num(g('tune')!, 'tune', -9600, 9600) : 0,
      volume: g('volume') !== undefined ? num(g('volume')!, 'volume', -144, 6) : 0,
      pan: g('pan') !== undefined ? num(g('pan')!, 'pan', -100, 100) : 0,
      offset: optInt('offset', 0xffffffff) ?? 0,
      end: optInt('end', 0xffffffff),
      ampVeltrack: g('amp_veltrack') !== undefined ? num(g('amp_veltrack')!, 'amp_veltrack', -100, 100) : 100,
      velcurve: curve.length ? curve : null,
      loopMode: (loopModeRaw ?? 'no_loop') as Region['loopMode'],
      loopStart: optInt('loop_start', 0xffffffff), loopEnd: optInt('loop_end', 0xffffffff),
      attack: time('ampeg_attack', 0), hold: time('ampeg_hold', 0), decay: time('ampeg_decay', 0),
      sustain: g('ampeg_sustain') !== undefined ? num(g('ampeg_sustain')!, 'ampeg_sustain', 0, 100) : 100,
      release: time('ampeg_release', 0.001),
      trigger: trig as Region['trigger'],
      locc: cc('locc'), hicc: cc('hicc'),
      xfin: xf('xfin_locc', 'xfin_hicc'), xfout: xf('xfout_locc', 'xfout_hicc'),
      sw: hasSw ? { lokey: swKey('sw_lokey') ?? 0, hikey: swKey('sw_hikey') ?? 127, last: swKey('sw_last'), default: swKey('sw_default') } : null,
      seqPosition: g('seq_position') !== undefined ? int(g('seq_position')!, 'seq_position', 1, 100) : 1,
      lorand: g('lorand') !== undefined ? num(g('lorand')!, 'lorand', 0, 1) : 0,
      hirand: g('hirand') !== undefined ? num(g('hirand')!, 'hirand', 0, 1) : 1,
    };
  };

  feed(text, 0);
  closeRegion();
  if (!regions.length) warnings.push('no region with a sample');
  return { regions, ignored: { ...ignored }, warnings };
}
