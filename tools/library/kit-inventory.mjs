// Reads a sample-instrument set that fetch.mjs has already put in the library and says what is in it.
// It only READS: nothing is written inside the item, nothing it reads is executed, and no network is used.
// Node 22 built-ins only. Run on the owner's computer:
//   node kit-inventory.mjs --root E:\PULSEFRAME-Library                         every .sfz in the item, one line each
//   node kit-inventory.mjs --root E:\PULSEFRAME-Library --match piano,violin    only .sfz files whose path has one of the words
//   node kit-inventory.mjs --root E:\PULSEFRAME-Library --sfz "<path in the item>" [--sfz ...]
//        the full file table of those instruments: one line per file (sha256, bytes, path) between BEGIN and END, then
//        "TABLE files=N bytes=N sha256=<of the lines joined by \n>" so a copy of the lines can be checked. Also saved under
//        <root>/_manifests/kit-inventory/.
// Exit code: 0 done, 1 a named instrument has a problem (a missing or outside file), 2 bad use.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LIMITS = { sfzBytes: 4 * 1024 * 1024, includes: 256, includeDepth: 8, regions: 20000, files: 200000, wavChunks: 64 };

export function parseArgs(argv) {
  const a = { root: null, item: 'instruments/vsco-2-ce', match: [], sfz: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === '--root') a.root = value();
    else if (k === '--item') a.item = value();
    else if (k === '--match') a.match.push(...value().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    else if (k === '--sfz') a.sfz.push(value().replace(/\\/g, '/'));
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** A path inside the item, posix, or null when it is absolute, names a drive, or climbs out. `..` is resolved, not refused, and reported by the caller. */
export function insideItem(dirPosix, raw) {
  const p = raw.replace(/\\/g, '/');
  // eslint-disable-next-line no-control-regex
  if (p === '' || p.startsWith('/') || p.includes(':') || /[\u0000-\u001f\u007f]/.test(p)) return null;
  const out = dirPosix ? dirPosix.split('/') : [];
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (!out.length) return null; out.pop(); } else out.push(s);
  }
  return out.join('/');
}

/** Every regular file under `dir` (posix paths relative to it); `.git` and symbolic links are not entered or listed. */
export function walk(dir) {
  const files = new Map();
  const todo = [''];
  while (todo.length) {
    const rel = todo.pop();
    for (const e of fs.readdirSync(path.join(dir, ...rel.split('/').filter(Boolean)), { withFileTypes: true })) {
      if (e.isSymbolicLink() || (rel === '' && e.name === '.git')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) todo.push(r);
      else if (e.isFile()) { files.set(r, null); if (files.size > LIMITS.files) throw new Error('too many files in the item'); }
    }
  }
  return files;
}

const NOTE = /^([a-g])([#b]?)(-?\d{1,2})$/i;
const NOTE_BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function keyNumber(v) {
  const m = NOTE.exec(v);
  if (m) return NOTE_BASE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return /^-?\d{1,3}$/.test(v) ? Number(v) : null;
}

/**
 * A small reader of SFZ text: headers, opcode=value pairs (a value runs to the next " name=" or "<header>" or the line end, so
 * sample paths may hold spaces), #define and #include. `read(relPath)` returns the text of an included file or null.
 */
export function scanSfz(text, read, sfzRel) {
  const dir = sfzRel.includes('/') ? sfzRel.slice(0, sfzRel.lastIndexOf('/')) : '';
  const info = { regions: 0, groups: 0, samples: [], includes: [], includeMissing: [], defaultPath: '', opcodes: {}, keyLo: null, keyHi: null, velLayers: new Set(), release: 0, seq: 0, loopModes: {}, problems: [] };
  const defines = new Map();
  let includes = 0;
  const run = (src, depth) => {
    let header = '';
    let cur = null; // the current region's notes
    const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
    for (let line of lines) {
      const c = line.indexOf('//');
      if (c >= 0) line = line.slice(0, c);
      line = line.trim();
      if (!line) continue;
      const inc = /^#include\s+"([^"]+)"/.exec(line);
      if (inc) {
        if (++includes > LIMITS.includes || depth >= LIMITS.includeDepth) { info.problems.push('too many #include'); continue; }
        const rel = insideItem(dir, inc[1]);
        const body = rel === null ? null : read(rel);
        if (body === null) info.includeMissing.push(inc[1]); else { info.includes.push(rel); run(body, depth + 1); }
        continue;
      }
      const def = /^#define\s+(\$\w+)\s+(\S+)/.exec(line);
      if (def) { defines.set(def[1], def[2]); continue; }
      for (const [k, v] of defines) line = line.split(k).join(v);
      // tokens: <header> or name=value
      const re = /<(\w+)>|(\w+)=/g;
      const marks = [];
      for (let m; (m = re.exec(line)); ) marks.push({ at: m.index, end: re.lastIndex, header: m[1], name: m[2] });
      for (let i = 0; i < marks.length; i++) {
        const t = marks[i];
        if (t.header) {
          header = t.header;
          if (header === 'region') { if (++info.regions > LIMITS.regions) throw new Error('too many regions'); cur = {}; }
          else if (header === 'group') info.groups++;
          continue;
        }
        const value = line.slice(t.end, i + 1 < marks.length ? marks[i + 1].at : line.length).trim();
        info.opcodes[t.name] = (info.opcodes[t.name] ?? 0) + 1;
        if (t.name === 'default_path') info.defaultPath = value.replace(/\\/g, '/');
        else if (t.name === 'sample') info.samples.push({ written: value, withDefault: info.defaultPath + value });
        else if (t.name === 'lokey' || t.name === 'hikey' || t.name === 'key' || t.name === 'pitch_keycenter') {
          const n = keyNumber(value);
          if (n !== null) { info.keyLo = info.keyLo === null ? n : Math.min(info.keyLo, n); info.keyHi = info.keyHi === null ? n : Math.max(info.keyHi, n); }
        } else if (t.name === 'lovel' || t.name === 'hivel') info.velLayers.add(`${t.name}=${value}`);
        else if (t.name === 'trigger' && value === 'release') info.release++;
        else if (t.name === 'seq_length' && Number(value) > 1) info.seq++;
        else if (t.name === 'loop_mode') info.loopModes[value] = (info.loopModes[value] ?? 0) + 1;
      }
      void cur;
    }
  };
  run(text, 0);
  return { ...info, dir };
}

/** The format of a WAV file from its chunk headers only (bounded reads); null when it is not a readable RIFF/WAVE file. */
export function wavInfo(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return null;
    let at = 12, fmt = null, dataBytes = null, smpl = false;
    const h = Buffer.alloc(8);
    for (let n = 0; n < LIMITS.wavChunks && at + 8 <= size; n++) {
      if (fs.readSync(fd, h, 0, 8, at) < 8) break;
      const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
      if (id === 'fmt ' && len >= 16) {
        const b = Buffer.alloc(16);
        fs.readSync(fd, b, 0, 16, at + 8);
        fmt = { tag: b.readUInt16LE(0), channels: b.readUInt16LE(2), rate: b.readUInt32LE(4), blockAlign: b.readUInt16LE(12), bits: b.readUInt16LE(14) };
      } else if (id === 'data') dataBytes = Math.min(len, size - at - 8);
      else if (id === 'smpl') smpl = true;
      at += 8 + len + (len & 1);
    }
    if (!fmt || dataBytes === null || !fmt.blockAlign || !fmt.rate) return null;
    return { ...fmt, frames: Math.floor(dataBytes / fmt.blockAlign), seconds: dataBytes / fmt.blockAlign / fmt.rate, smpl };
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** One instrument: the scan, and each sample resolved to a file of the item (exact, by letter case only, missing or outside). */
export function inspect(itemDir, files, lower, sfzRel) {
  const abs = (rel) => path.join(itemDir, ...rel.split('/'));
  const read = (rel) => {
    if (!files.has(rel)) return null;
    const st = fs.statSync(abs(rel));
    if (st.size > LIMITS.sfzBytes) throw new Error(`${rel} is larger than ${LIMITS.sfzBytes} bytes`);
    return fs.readFileSync(abs(rel), 'utf8');
  };
  const text = read(sfzRel);
  if (text === null) throw new Error(`no such file in the item: ${sfzRel}`);
  const scan = scanSfz(text, read, sfzRel);
  const used = new Map(); // item-relative path -> how it was found
  const counts = { exact: 0, caseOnly: 0, missing: 0, outside: 0, dotdot: 0, backslash: 0 };
  const missing = [];
  for (const s of scan.samples) {
    if (s.withDefault.includes('\\')) counts.backslash++;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(s.withDefault)) counts.dotdot++;
    const rel = insideItem(scan.dir, s.withDefault);
    if (rel === null) { counts.outside++; if (missing.length < 5) missing.push(s.withDefault); continue; }
    if (files.has(rel)) { if (!used.has(rel)) used.set(rel, 'exact'); counts.exact++; continue; }
    const alt = lower.get(rel.toLowerCase());
    if (alt && alt.length === 1) { if (!used.has(alt[0])) used.set(alt[0], 'caseOnly'); counts.caseOnly++; continue; }
    counts.missing++;
    if (missing.length < 5) missing.push(s.withDefault);
  }
  return { sfzRel, scan, used, counts, missing };
}

function overviewLine(itemDir, r) {
  const abs = (rel) => path.join(itemDir, ...rel.split('/'));
  let bytes = 0, smpl = 0, unread = 0;
  const rates = new Set(), bits = new Set(), chans = new Set(), secs = [];
  for (const rel of r.used.keys()) {
    bytes += fs.statSync(abs(rel)).size;
    const w = wavInfo(abs(rel));
    if (!w) { unread++; continue; }
    rates.add(w.rate); bits.add(`${w.bits}${w.tag === 3 ? 'f' : ''}`); chans.add(w.channels); secs.push(w.seconds); if (w.smpl) smpl++;
  }
  secs.sort((a, b) => a - b);
  const s = (x) => (x === undefined ? '-' : x.toFixed(1));
  const c = r.counts, sc = r.scan;
  const list = (set) => [...set].sort().join('/') || '-';
  return `SFZ ${JSON.stringify(r.sfzRel)} regions=${sc.regions} files=${r.used.size} bytes=${bytes} missing=${c.missing} outside=${c.outside} caseOnly=${c.caseOnly} dotdot=${c.dotdot} backslash=${c.backslash}`
    + ` includes=${sc.includes.length}${sc.includeMissing.length ? `(+${sc.includeMissing.length} missing)` : ''} keys=${sc.keyLo ?? '-'}..${sc.keyHi ?? '-'} velMarks=${sc.velLayers.size} release=${sc.release} seq=${sc.seq}`
    + ` loop=${JSON.stringify(sc.loopModes)} smpl=${smpl} rate=${list(rates)} bits=${list(bits)} ch=${list(chans)} sec(min/med/max)=${s(secs[0])}/${s(secs[secs.length >> 1])}/${s(secs[secs.length - 1])}`
    + `${unread ? ` unreadableWav=${unread}` : ''}${r.missing.length ? ` firstMissing=${JSON.stringify(r.missing.slice(0, 2))}` : ''}${sc.problems.length ? ` problems=${JSON.stringify(sc.problems)}` : ''}`;
}

/** The file table of the named instruments: every .sfz, its includes and its samples, once each, sorted by path. */
export function tableLines(itemDir, results) {
  const all = new Set();
  for (const r of results) { all.add(r.sfzRel); for (const i of r.scan.includes) all.add(i); for (const u of r.used.keys()) all.add(u); }
  const rows = [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((rel) => {
    const file = path.join(itemDir, ...rel.split('/'));
    return { rel, bytes: fs.statSync(file).size, sha256: sha256File(file) };
  });
  const lines = rows.map((x) => `${x.sha256}  ${x.bytes}  ${x.rel}`);
  const digest = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  return { lines, digest, bytes: rows.reduce((n, x) => n + x.bytes, 0) };
}

export function run(argv, out = console.log) {
  const a = parseArgs(argv);
  if (a.help) { out('usage: node kit-inventory.mjs --root <library folder> [--item instruments/vsco-2-ce] [--match word,word] [--sfz <path in the item>]...'); return 0; }
  const root = a.root ?? (fs.existsSync('E:\\PULSEFRAME-Library') ? 'E:\\PULSEFRAME-Library' : null);
  if (!root || !fs.existsSync(root)) throw Object.assign(new Error('library folder not found; give it with --root'), { use: true });
  if (insideItem('', a.item) === null || a.item.includes('..')) throw Object.assign(new Error('--item must be a folder inside the library'), { use: true });
  const itemDir = path.join(root, ...a.item.split('/'));
  if (!fs.existsSync(itemDir) || !fs.statSync(itemDir).isDirectory()) throw Object.assign(new Error(`not in the library: ${a.item}`), { use: true });
  const files = walk(itemDir);
  const lower = new Map();
  for (const f of files.keys()) { const k = f.toLowerCase(); if (!lower.has(k)) lower.set(k, []); lower.get(k).push(f); }
  const ext = {};
  for (const f of files.keys()) { const e = path.posix.extname(f).toLowerCase() || '(none)'; ext[e] = (ext[e] ?? 0) + 1; }
  out(`ITEM ${a.item} files=${files.size} byExtension=${JSON.stringify(ext)}`);

  if (a.sfz.length) {
    const results = a.sfz.map((s) => inspect(itemDir, files, lower, s));
    let bad = 0;
    for (const r of results) { out(overviewLine(itemDir, r)); if (r.counts.missing || r.counts.outside || r.scan.includeMissing.length) bad++; }
    const t = tableLines(itemDir, results);
    out('BEGIN');
    for (const l of t.lines) out(l);
    out('END');
    out(`TABLE files=${t.lines.length} bytes=${t.bytes} sha256=${t.digest}`);
    const dir = path.join(root, '_manifests', 'kit-inventory');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${a.item.replace(/[^A-Za-z0-9._-]+/g, '_')}-${t.digest.slice(0, 12)}.txt`;
    fs.writeFileSync(path.join(dir, name), t.lines.join('\n') + '\n');
    out(`saved ${path.join(dir, name)}`);
    return bad ? 1 : 0;
  }

  const sfz = [...files.keys()].filter((f) => f.toLowerCase().endsWith('.sfz')).sort();
  const chosen = a.match.length ? sfz.filter((f) => a.match.some((w) => f.toLowerCase().includes(w))) : sfz;
  out(`SFZ files: ${sfz.length}${a.match.length ? `, ${chosen.length} matching ${a.match.join(',')}` : ''}`);
  for (const s of chosen) {
    try { out(overviewLine(itemDir, inspect(itemDir, files, lower, s))); } catch (e) { out(`SFZ ${JSON.stringify(s)} unreadable: ${e.message}`); }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exitCode = e.use ? 2 : 1; }
}
