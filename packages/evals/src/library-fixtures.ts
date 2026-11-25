/**
 * SYNTHETIC LIBRARY (wave 7 library track, worker A): a small content library made in a temp folder for pnpm proof:library and
 * the server's library tests. No downloaded file and no owner media: every sound and picture is made here by ffmpeg or written
 * here as text. The ledger is written by the fetch tool's own code (tools/library/fetch.mjs run()) against a server on 127.0.0.1
 * through the tool's test-only plain-http transport (insecureOk, tests only), so the ledger format cannot drift from the tool's.
 * What the tool refuses to write is planted afterwards: one file item whose bytes are changed (same size), one file item replaced
 * by a link to a file outside the library; and `handLedger()` writes a hand-edited copy with a `..` path, `ledgerV2()` a
 * version-2 ledger.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { CUSTOM_LICENCES, licenceDuties, SPDX_LICENCES, type LicenceDuties } from '@pulseframe/core';
import { makeTransport, run } from '../../../tools/library/fetch.mjs';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 26 });

/** A zip with stored (uncompressed) entries. */
function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), crc = zlib.crc32(e.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, e.data); centrals.push(ch, name); off += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** A tar.gz of regular files. */
function tgz(entries: { name: string; data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(e.data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148);
    h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

/** The keys the proof and the tests ask for (catalogue keys are `${ledger item}/${path}` [#member]). */
export const FIX_KEYS = {
  track120: 'fx-incompetech/tone-120/Tone Track.mp3',
  track90: 'fx-incompetech/tone-90/Slow Track.mp3',
  orphan: 'fx-incompetech/orphan/Orphan.mp3',
  flac: 'musopen-flac/aria/Aria.flac',
  whoosh: 'fx-cc0-sounds/pack/whoosh.wav',
  toneA: 'fx-cc0-sounds/pack/tone-a.wav',
  m4a: 'fx-cc0-sounds/pack/tone-c.m4a',
  tampered: 'fx-cc0-music/tampered/tampered.wav',
  linked: 'fx-cc0-music/linked/linked.wav',
  nd: 'fx-nd/nd/nd.wav',
  unknownCustom: 'fx-custom/custom/custom.wav',
  personal: 'fx-personal/personal/personal.wav',
  pattern: 'fx-people/pattern/pattern.png',
  animated: 'fx-people/anim/anim.png',
  unsafe: 'fx-unsafe/unsafe/unsafe.svg',
  menorah: 'fx-fluent/assets/assets/Menorah/3D/menorah_3d.png',
  grin: 'fx-fluent/assets/assets/Grinning face/3D/grinning_face_3d.png',
  heart: 'fx-noto/svg/2D/svg/emoji_u2764.svg',
  notoGrin: 'fx-noto/svg/2D/svg/emoji_u1f600.svg',
  iconCircle: 'fx-iconify/package/json/fxmit.json#red-circle',
  iconSquare: 'fx-iconify/package/json/fxmit.json#square',
  iconStar: 'fx-iconify/package/json/fxmit.json#star',
  ccbyIcon: 'fx-iconify/package/json/fxccby.json#leaf',
  ccbyNoAuthor: 'fx-iconify/package/json/fxccbyna.json#drop',
  dotdot: 'fx-cc0-music/escape/secret.wav',
} as const;
/** Rows per kind the fixture's catalogue must hold (with an SVG rasteriser; `svg` of them are SVG rows). */
export const FIX_COUNTS = { music: 7, sound: 6, sticker: 4, icon: 5, illustration: 3 } as const;
export const FIX_SVG_COUNTS = { sticker: 2, icon: 5, illustration: 1 } as const;
/** Entries counted, not listed. */
export const FIX_NOT_LISTED = [{ dir: 'instruments', entries: 1 }, { dir: 'source:fsd50k', entries: 1 }];
/** The CC-BY icon set's author (the credit must name it) and the incompetech credit as the ledger has it. */
export const FIX_ICON_AUTHOR = 'Synthetic Leaf Maker';
export const FIX_INCOMPETECH_CREDIT = 'Title Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0\nhttps://creativecommons.org/licenses/by/4.0/';
/** CUSTOM_LICENCES['musopen-flac'].custom, exactly. */
const MUSOPEN_CUSTOM = 'Public Domain Mark 1.0 as labelled on the archive.org item (rights statement by the uploader, not by Musopen)';

export interface LibraryFixture {
  root: string;
  /** A folder outside the root that holds the file the planted link points to. */
  outside: string;
  secretFile: string;
  ledgerFile: string;
  /** Writes the hand-edited ledger copy (adds an entry whose path climbs out with `..`). */
  handLedger(): void;
  /** Writes a ledger of version 2 (the tool's own refusal); restore() puts the real one back. */
  ledgerV2(): void;
  restoreLedger(): void;
  /** Changes a tree file's time after indexing (its size stays). */
  touchTreeFile(): void;
}

export async function makeLibraryFixture(base: string, log: (s: string) => void = () => {}): Promise<LibraryFixture> {
  const root = path.join(base, 'SYNTHETIC-LIBRARY'), work = path.join(base, 'work'), outside = path.join(base, 'outside');
  for (const d of [root, work, outside]) fs.mkdirSync(d, { recursive: true });
  for (const d of ['music', 'sounds', 'visual', 'models', 'instruments']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const w = (n: string) => path.join(work, n);
  // ---- media, made here
  const tone = (f: number, out: string, extra: string[] = []) => ff(['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=2:sample_rate=44100`, ...extra, w(out)]);
  tone(440, 'tone120.mp3', ['-c:a', 'libmp3lame', '-b:a', '64k']);
  tone(330, 'tone90.mp3', ['-c:a', 'libmp3lame', '-b:a', '64k']);
  tone(220, 'orphan.mp3', ['-c:a', 'libmp3lame', '-b:a', '64k']);
  tone(523, 'aria.flac', ['-c:a', 'flac']);
  tone(600, 'tone-a.wav'); tone(700, 'tone-b.wav'); tone(800, 'tone-c.m4a', ['-c:a', 'aac', '-b:a', '64k']);
  tone(900, 'tampered.wav'); tone(1000, 'linked.wav'); tone(1100, 'nd.wav'); tone(1200, 'custom.wav'); tone(1300, 'personal.wav'); tone(1400, 'fsd.wav'); tone(1500, 'secret.wav');
  ff(['-f', 'lavfi', '-i', 'anoisesrc=d=1:c=pink:a=0.5', '-af', 'afade=t=in:d=0.4,afade=t=out:st=0.5:d=0.5', w('whoosh.wav')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1', '-frames:v', '1', w('pattern.png')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=0.3', '-plays', '0', '-f', 'apng', w('anim.png')]);
  const sticker = (r: number, g: number, b: number, out: string) => ff(['-f', 'lavfi', '-i', 'color=c=black:s=256x256', '-frames:v', '1', '-vf', `format=rgba,geq=r='${r}':g='${g}':b='${b}':a='if(lt(hypot(X-128,Y-128),100),255,0)'`, w(out)]);
  sticker(255, 170, 0, 'menorah_3d.png'); sticker(255, 220, 0, 'grin_3d.png');
  const read = (n: string) => fs.readFileSync(w(n));
  fs.writeFileSync(path.join(outside, 'secret.wav'), read('secret.wav'));
  const pieces = JSON.stringify([
    { title: 'Tone Track', filename: 'Tone Track.mp3', length: '0:02', bpm: '120', genre: 'Electronic', feel: 'Bright, Driving', instruments: 'Synth' },
    { title: 'Slow Track', filename: 'Slow Track.mp3', length: '0:02', bpm: '90', genre: 'Ambient', feel: 'Calm', instruments: 'Piano' },
  ]);
  const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><image href="file:///etc/passwd"/></svg>';
  const notoHeart = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="60" fill="#ff0000"/></svg>';
  const notoGrin = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="60" fill="#ffcc00"/></svg>';
  const he = '<?xml version="1.0" encoding="UTF-8" ?>\n<ldml><annotations>\n<annotation cp="🕎">חנוכיה | מנורה | חג</annotation>\n<annotation cp="🕎" type="tts">חנוכיה</annotation>\n<annotation cp="😀">פרצוף | מחייך</annotation>\n<annotation cp="😀" type="tts">פרצוף מחייך</annotation>\n<annotation cp="❤">לב | אהבה</annotation>\n<annotation cp="❤" type="tts">לב אדום</annotation>\n</annotations></ldml>\n';
  const en = '<?xml version="1.0" encoding="UTF-8" ?>\n<ldml><annotations>\n<annotation cp="🕎">menorah | candelabrum | religion</annotation>\n<annotation cp="🕎" type="tts">menorah</annotation>\n<annotation cp="😀">face | grin</annotation>\n<annotation cp="😀" type="tts">grinning face</annotation>\n<annotation cp="❤">heart | love</annotation>\n<annotation cp="❤" type="tts">red heart</annotation>\n</annotations></ldml>\n';
  const fluentZip = zip([
    { name: 'assets/Menorah/metadata.json', data: Buffer.from(JSON.stringify({ cldr: 'menorah', group: 'Activities', keywords: ['candle', 'hanukkah'], unicode: '1f54e', tts: 'menorah' })) },
    { name: 'assets/Menorah/3D/menorah_3d.png', data: read('menorah_3d.png') },
    { name: 'assets/Grinning face/metadata.json', data: Buffer.from(JSON.stringify({ cldr: 'grinning face', group: 'Smileys & Emotion', keywords: ['face', 'smile'], unicode: '1f600', tts: 'grinning face' })) },
    { name: 'assets/Grinning face/3D/grinning_face_3d.png', data: read('grin_3d.png') },
  ]);
  const notoZip = zip([{ name: '2D/svg/emoji_u2764.svg', data: Buffer.from(notoHeart) }, { name: '2D/svg/emoji_u1f600.svg', data: Buffer.from(notoGrin) }, { name: '2D/svg/LICENSE', data: Buffer.from('Apache-2.0 (synthetic)') }]);
  const soundsZip = zip([{ name: 'whoosh.wav', data: read('whoosh.wav') }, { name: 'tone-a.wav', data: read('tone-a.wav') }, { name: 'tone-b.wav', data: read('tone-b.wav') }, { name: 'tone-c.m4a', data: read('tone-c.m4a') }, { name: 'readme.txt', data: Buffer.from('synthetic') }]);
  const set = (prefix: string, icons: Record<string, string>) => Buffer.from(JSON.stringify({ prefix, width: 24, height: 24, icons: Object.fromEntries(Object.entries(icons).map(([k, body]) => [k, { body }])) }));
  const collections = {
    fxmit: { name: 'Fixture MIT', author: { name: 'Fixture Author' }, license: { title: 'MIT', spdx: 'MIT', url: 'https://example.invalid/mit' } },
    fxccby: { name: 'Fixture Leaves', author: { name: FIX_ICON_AUTHOR }, license: { title: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } },
    fxccbyna: { name: 'Fixture Drops', license: { title: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } },
    fxnc: { name: 'Fixture NC', author: { name: 'X' }, license: { title: 'CC BY-NC 4.0', spdx: 'CC-BY-NC-4.0', url: 'https://example.invalid/nc' } },
    fxgpl: { name: 'Fixture GPL', author: { name: 'X' }, license: { title: 'GPL', spdx: 'GPL-3.0-only', url: 'https://example.invalid/gpl' } },
    ri: { name: 'Remix Icon (shape)', author: { name: 'X' }, license: { title: 'Apache 2.0', spdx: 'Apache-2.0', url: 'https://example.invalid/ri' } },
  };
  const pkg = tgz([
    { name: 'package/package.json', data: Buffer.from(JSON.stringify({ name: '@iconify/json', version: '9.9.9' })) },
    { name: 'package/collections.json', data: Buffer.from(JSON.stringify(collections)) },
    { name: 'package/json/fxmit.json', data: set('fxmit', { 'red-circle': '<circle cx="12" cy="12" r="10" fill="currentColor"/>', square: '<rect x="4" y="4" width="16" height="16" fill="currentColor"/>', star: '<path d="M12 2l3 7h7l-6 5 2 8-6-5-6 5 2-8-6-5h7z" fill="currentColor"/>' }) },
    { name: 'package/json/fxccby.json', data: set('fxccby', { leaf: '<path d="M4 20C4 8 12 4 20 4c0 8-4 16-16 16z" fill="currentColor"/>' }) },
    { name: 'package/json/fxccbyna.json', data: set('fxccbyna', { drop: '<path d="M12 2C8 8 6 12 6 15a6 6 0 0012 0c0-3-2-7-6-13z" fill="currentColor"/>' }) },
    { name: 'package/json/fxnc.json', data: set('fxnc', { nc: '<rect width="24" height="24"/>' }) },
    { name: 'package/json/fxgpl.json', data: set('fxgpl', { gpl: '<rect width="24" height="24"/>' }) },
    { name: 'package/json/ri.json', data: set('ri', { ri: '<rect width="24" height="24"/>' }) },
  ]);
  // ---- the loopback server the fetch tool reads from
  const files = new Map<string, Buffer>();
  const serve = (name: string, b: Buffer) => { files.set(`/f/${name}`, b); return name; };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? '').split('?')[0]!);
    const b = files.get(u) ?? (u.startsWith('/licence/') ? Buffer.from(`SYNTHETIC licence text for ${u.slice(9)}\n`) : null);
    if (!b) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': String(b.length), 'content-type': 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : b);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base0 = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pkgIntegrity = `sha512-${createHash('sha512').update(pkg).digest('base64')}`;
  files.set('/@iconify/json/9.9.9', Buffer.from(JSON.stringify({ name: '@iconify/json', version: '9.9.9', dist: { integrity: pkgIntegrity, tarball: `${base0}/f/iconify.tgz`, unpackedSize: 100000 } })));
  serve('iconify.tgz', pkg);
  const lic = (id: string, spdxOrCustom: { spdx?: string; custom?: string }) => ({ ...spdxOrCustom, url: `${base0}/licence/${id}`, readOn: '2026-11-25', quote: 'SYNTHETIC fixture licence quote' });
  const flags = (o: Partial<Record<string, boolean>> = {}) => ({ diskOnly: false, creditInExport: false, shareAlike: false, people: false, aiGenerated: false, repoAllowed: false, ...o });
  const fileItem = (id: string, dest: string, data: Buffer) => ({ id, kind: 'file', url: `${base0}/f/${serve(id.replace(/\//g, '_'), data)}`, dest, sha256: sha256(data), bytes: data.length });
  const manifest = {
    manifestVersion: 1, id: 'synthetic-library', title: 'SYNTHETIC LIBRARY (pnpm proof:library)', created: '2026-11-25',
    sources: [
      { id: 'incompetech', title: 'SYNTHETIC incompetech-shaped', licence: lic('incompetech', { spdx: 'CC-BY-4.0' }), credit: FIX_INCOMPETECH_CREDIT, ...flags({ creditInExport: true }), items: [
        fileItem('fx-incompetech/pieces', 'music/incompetech/pieces.json', Buffer.from(pieces)),
        fileItem('fx-incompetech/tone-120', 'music/incompetech/mp3/Tone Track.mp3', read('tone120.mp3')),
        fileItem('fx-incompetech/tone-90', 'music/incompetech/mp3/Slow Track.mp3', read('tone90.mp3')),
        fileItem('fx-incompetech/orphan', 'music/incompetech/mp3/Orphan.mp3', read('orphan.mp3')),
      ] },
      { id: 'musopen-flac', title: 'SYNTHETIC musopen-flac-shaped', licence: lic('musopen-flac', { custom: MUSOPEN_CUSTOM }), credit: null, ...flags({ diskOnly: true }), items: [fileItem('musopen-flac/aria', 'music/musopen/flac/Aria.flac', read('aria.flac'))] },
      { id: 'fx-cc0-sounds', title: 'SYNTHETIC CC0 sounds', licence: lic('fx-cc0-sounds', { spdx: 'CC0-1.0' }), credit: null, ...flags(), items: [
        { id: 'fx-cc0-sounds/pack', kind: 'archive', format: 'zip', url: `${base0}/f/${serve('sounds.zip', soundsZip)}`, sha256: sha256(soundsZip), bytes: soundsZip.length, dest: 'sounds/fx-cc0' },
      ] },
      { id: 'fx-cc0-music', title: 'SYNTHETIC CC0 music', licence: lic('fx-cc0-music', { spdx: 'CC0-1.0' }), credit: null, ...flags(), items: [
        fileItem('fx-cc0-music/tampered', 'music/fx-cc0/tampered.wav', read('tampered.wav')),
        fileItem('fx-cc0-music/linked', 'music/fx-cc0/linked.wav', read('linked.wav')),
      ] },
      { id: 'fx-nd', title: 'SYNTHETIC no-derivatives', licence: lic('fx-nd', { spdx: 'CC-BY-ND-4.0' }), credit: 'SYNTHETIC ND credit', ...flags(), items: [fileItem('fx-nd/nd', 'sounds/fx-nd/nd.wav', read('nd.wav'))] },
      { id: 'fx-custom', title: 'SYNTHETIC unknown custom licence', licence: lic('fx-custom', { custom: 'A licence nobody has read' }), credit: null, ...flags({ diskOnly: true }), items: [fileItem('fx-custom/custom', 'music/fx-custom/custom.wav', read('custom.wav'))] },
      { id: 'fx-personal', title: 'SYNTHETIC personal use only', licence: lic('fx-personal', { spdx: 'CC0-1.0' }), credit: null, ...flags({ diskOnly: true, personalOnly: true }), items: [fileItem('fx-personal/personal', 'sounds/fx-personal/personal.wav', read('personal.wav'))] },
      { id: 'fx-people', title: 'SYNTHETIC pictures with people', licence: lic('fx-people', { spdx: 'CC0-1.0' }), credit: null, ...flags({ people: true }), items: [
        fileItem('fx-people/pattern', 'visual/illustrations/fx/pattern.png', read('pattern.png')),
        fileItem('fx-people/anim', 'visual/illustrations/fx/anim.png', read('anim.png')),
      ] },
      { id: 'fx-unsafe', title: 'SYNTHETIC unsafe SVG', licence: lic('fx-unsafe', { spdx: 'CC0-1.0' }), credit: null, ...flags(), items: [fileItem('fx-unsafe/unsafe', 'visual/illustrations/fx/unsafe.svg', Buffer.from(unsafeSvg))] },
      { id: 'fluent-emoji', title: 'SYNTHETIC fluent-shaped', licence: lic('fluent-emoji', { spdx: 'MIT' }), credit: null, ...flags({ repoAllowed: true }), items: [
        { id: 'fx-fluent/assets', kind: 'archive', format: 'zip', url: `${base0}/f/${serve('fluent.zip', fluentZip)}`, sha256: sha256(fluentZip), bytes: fluentZip.length, dest: 'visual/emoji/fluent' },
      ] },
      { id: 'noto-emoji', title: 'SYNTHETIC noto-shaped', licence: lic('noto-emoji', { spdx: 'Apache-2.0' }), credit: null, ...flags({ repoAllowed: true }), items: [
        { id: 'fx-noto/svg', kind: 'archive', format: 'zip', url: `${base0}/f/${serve('noto.zip', notoZip)}`, sha256: sha256(notoZip), bytes: notoZip.length, dest: 'visual/emoji/noto' },
      ] },
      { id: 'cldr-annotations', title: 'SYNTHETIC CLDR-shaped annotations (six own rows)', licence: lic('cldr-annotations', { spdx: 'Unicode-3.0' }), credit: null, ...flags({ repoAllowed: true }), items: [
        fileItem('fx-cldr/he', 'visual/emoji/cldr/annotations/he.xml', Buffer.from(he)),
        fileItem('fx-cldr/en', 'visual/emoji/cldr/annotations/en.xml', Buffer.from(en)),
      ] },
      { id: 'iconify-json', title: 'SYNTHETIC iconify-shaped package', licence: lic('iconify-json', { custom: 'Mixed (SYNTHETIC)' }), credit: null, ...flags({ diskOnly: true, trademark: true }), items: [
        { id: 'fx-iconify/package', kind: 'npm', name: '@iconify/json', version: '9.9.9', integrity: pkgIntegrity, dest: 'visual/icons/iconify' },
      ] },
      { id: 'fx-instrument', title: 'SYNTHETIC instrument (counted, not listed)', licence: lic('fx-instrument', { spdx: 'CC0-1.0' }), credit: null, ...flags(), items: [fileItem('fx-instrument/one', 'instruments/fx/one.wav', read('tone-a.wav'))] },
      { id: 'fsd50k', title: 'SYNTHETIC per-clip-licence set (counted, not read)', licence: lic('fsd50k', { custom: 'Per-clip (SYNTHETIC)' }), credit: null, ...flags({ diskOnly: true }), items: [fileItem('fx-fsd/one', 'sounds/fsd50k/one.wav', read('fsd.wav'))] },
    ],
  };
  const manifestFile = path.join(work, 'synthetic-library.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  const lines: string[] = [];
  let r;
  try {
    r = await run(['--root', root, '--manifest', manifestFile, '--delay-ms', '0'], { transport: makeTransport(http, 'http:'), insecureOk: true, sleep: async () => {}, log: (s: string) => lines.push(s), npmRegistry: base0 });
  } finally {
    server.close();
  }
  if (r.code !== 0) throw new Error(`the fetch tool could not build the synthetic library (code ${r.code}):\n${lines.slice(-30).join('\n')}`);
  log(`synthetic library: ${r.results?.length ?? 0} items fetched by tools/library/fetch.mjs from 127.0.0.1`);
  // ---- what the tool refuses to write, planted afterwards
  const tamperedPath = path.join(root, 'music', 'fx-cc0', 'tampered.wav');
  const t = fs.readFileSync(tamperedPath);
  t[t.length - 1] = t[t.length - 1]! ^ 0xff; // same size, other bytes
  fs.writeFileSync(tamperedPath, t);
  const linkedPath = path.join(root, 'music', 'fx-cc0', 'linked.wav');
  fs.rmSync(linkedPath);
  const secretFile = path.join(outside, 'secret.wav');
  fs.symlinkSync(secretFile, linkedPath);
  const ledgerFile = path.join(root, '_manifests', 'ledger.json');
  const original = fs.readFileSync(ledgerFile);
  return {
    root, outside, secretFile, ledgerFile,
    handLedger() {
      const l = JSON.parse(original.toString('utf8'));
      const like = l.entries.find((e: { item: string }) => e.item === 'fx-cc0-music/tampered');
      l.entries.push({ ...like, item: 'fx-cc0-music/escape', path: 'music/../../outside/secret.wav', time: new Date().toISOString() });
      fs.writeFileSync(ledgerFile, JSON.stringify(l, null, 1));
    },
    ledgerV2() { const l = JSON.parse(original.toString('utf8')); l.ledgerVersion = 2; fs.writeFileSync(ledgerFile, JSON.stringify(l)); },
    restoreLedger() { fs.writeFileSync(ledgerFile, original); },
    touchTreeFile() { const p = path.join(root, 'sounds', 'fx-cc0', 'tone-b.wav'); const t2 = new Date(Date.now() + 60_000); fs.utimesSync(p, t2, t2); },
  };
}

/**
 * TEST STAND-IN for worker B's core licenceDuties, used by the server's library TESTS only while core's is not built in this
 * build (`coreDutiesBuilt()` false); never by the server and never by pnpm proof:library. It follows the fail-closed rules written
 * in packages/core/src/libraryDuties.ts over its own tables (SPDX_LICENCES, CUSTOM_LICENCES); it is not the product's table.
 */
export function coreDutiesBuilt(): boolean {
  try { licenceDuties('x', { spdx: 'MIT' }, {}); return true; } catch { return false; }
}
export function fixtureDutiesStandIn(sourceId: string, l: { spdx?: string; custom?: string }, f: Readonly<Record<string, boolean>>): LicenceDuties {
  const no = (use: LicenceDuties['use']): LicenceDuties => ({ use, licenceId: l.spdx ?? `custom:${sourceId}`, credit: false, nonCommercial: false, shareable: false, placement: 'description' });
  let row: { credit: boolean; nonCommercial: boolean; shareable: boolean } | undefined, id: string;
  if (l.spdx) {
    id = l.spdx; row = Object.hasOwn(SPDX_LICENCES, l.spdx) ? SPDX_LICENCES[l.spdx] : undefined;
    if (!row) return no(/-ND/.test(l.spdx) ? 'licence_no_derivatives' : /-SA|^GPL/.test(l.spdx) ? 'licence_share_alike' : 'licence_unknown');
  } else {
    const c = Object.hasOwn(CUSTOM_LICENCES, sourceId) ? CUSTOM_LICENCES[sourceId] : undefined;
    if (!c || c.custom !== l.custom) return no('licence_unknown');
    row = c; id = `custom:${sourceId}`;
  }
  if (f.shareAlike) return no('licence_share_alike');
  const nonCommercial = row.nonCommercial || !!f.personalOnly;
  return { use: 'ok', licenceId: id, credit: row.credit, nonCommercial, shareable: row.shareable && !nonCommercial && !f.diskOnly && f.repoAllowed !== false, placement: f.creditOnScreen ? 'on_screen' : 'description' }; // lead amendment 2026-11-25: on screen only with creditOnScreen
}
