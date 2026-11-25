/**
 * The catalogue (library/index.ts) and its readers over the SYNTHETIC LIBRARY (packages/evals/src/library-fixtures.ts), against
 * core's own licence table (licenceDuties); no stand-in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIX_COUNTS, FIX_ICON_AUTHOR, FIX_KEYS, FIX_NOT_LISTED, FIX_SVG_COUNTS, makeLibraryFixture, type LibraryFixture } from '../../../../packages/evals/src/library-fixtures.ts';
import type { Config } from '../config.ts';
import { ftsQuery, LibraryService, type LibraryServiceOptions } from './index.ts';
import { REPO_ROOT } from './paths.ts';
import { parsePieces } from './readers/incompetech.ts';
import { parseAnnotations } from './readers/cldr.ts';
import { admittedSets } from './readers/iconify.ts';

let base: string, fx: LibraryFixture;
const services: LibraryService[] = [];
function service(name: string, o: LibraryServiceOptions & { env?: string | null } = {}): LibraryService {
  const dataDir = path.join(base, name);
  fs.mkdirSync(dataDir, { recursive: true });
  const s = new LibraryService({ dataDir, libraryDir: o.env === undefined ? fx.root : o.env } as Config, o);
  services.push(s);
  return s;
}
async function ready(s: LibraryService) { await new Promise((r) => setTimeout(r, 20)); await s.idle(); }
const keys = async (s: LibraryService, q: Parameters<LibraryService['search']>[0]) => (await s.search(q)).rows.map((r) => r.key);

beforeAll(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-libindex-'));
  fx = await makeLibraryFixture(path.join(base, 'fx'));
}, 120_000);
afterAll(() => { for (const s of services) s.close(); fs.rmSync(base, { recursive: true, force: true }); });

describe('the catalogue of the synthetic library', () => {
  let s: LibraryService;
  beforeAll(async () => { s = service('main'); await ready(s); });
  it('counts rows by kind, entries not listed, rows not usable; the root only for the owner', async () => {
    const st = await s.status(true);
    expect(st.state).toBe('ready');
    expect(st.counts).toEqual(FIX_COUNTS);
    expect(st.notListed).toEqual(FIX_NOT_LISTED);
    expect(st.unusable).toEqual({ animated: 1, credit_missing: 1, credit_unresolved: 1, licence_no_derivatives: 1, licence_unknown: 1 });
    expect(st.root).toBe(fx.root);
    expect((await s.status(false)).root).toBeUndefined();
    expect(st.verifiedAt).toBeNull();
    expect(fs.existsSync(path.join(base, 'main', 'library-index.sqlite.tmp'))).toBe(false);
  });
  it('searches Hebrew with and without prefix letters and points, and English, to the same first key', async () => {
    for (const q of ['חנוכיה', 'החנוכיה', 'חֲנֻכִּיָּה', 'menorah', 'MENORAH', 'חנו']) expect({ q, first: (await keys(s, { q }))[0] }).toEqual({ q, first: FIX_KEYS.menorah });
    expect(await keys(s, { q: 'פסנתר' })).toEqual([FIX_KEYS.track90]); // our own Hebrew word for the "Piano" tag
    expect(await keys(s, { q: 'red heart' })).toEqual([FIX_KEYS.heart]);
    expect(await keys(s, { q: 'nothing-like-this' })).toEqual([]);
  });
  it('filters by tempo, kind, credit and commercial use; the same query gives the same order', async () => {
    expect(await keys(s, { bpmMin: 100, bpmMax: 130 })).toEqual([FIX_KEYS.track120]);
    const all = (await s.search({ limit: 200 })).rows;
    expect(all.some((r) => r.duties.credit)).toBe(true);
    expect((await s.search({ credit: 'none', limit: 200 })).rows.some((r) => r.duties.credit)).toBe(false);
    expect((await s.search({ commercial: 'allowed', limit: 200 })).rows.some((r) => r.duties.nonCommercial)).toBe(false);
    expect((await s.search({ kind: 'icon' })).total).toBe(FIX_COUNTS.icon);
    expect(await keys(s, { q: 'tone', limit: 200 })).toEqual(await keys(s, { q: 'tone', limit: 200 }));
    const page1 = await s.search({ limit: 5 }), page2 = await s.search({ limit: 5, cursor: page1.next! });
    expect(page1.next).toBe('5');
    expect(page2.rows[0]!.key).toBe(all[5]!.key);
  });
  it('reads each source as its reader says', async () => {
    const row = (k: string) => s.get(k)!.row;
    // incompetech: title and figures from pieces.json, the credit's leading "Title" replaced; a track without its row is unusable
    expect(row(FIX_KEYS.track120).credit!.text.startsWith('Tone Track Kevin MacLeod')).toBe(true);
    expect(row(FIX_KEYS.track120).meta).toMatchObject({ bpm: 120, durationSeconds: 2, genre: ['Electronic'], mood: ['Bright', 'Driving'], instruments: ['Synth'] });
    expect(row(FIX_KEYS.orphan)).toMatchObject({ unusable: 'credit_unresolved' });
    expect(row(FIX_KEYS.orphan).credit).toBeUndefined();
    // iconify: admitted sets only; MIT icons need no credit; a CC-BY set's credit names its author; one without an author is unusable
    const icons = await keys(s, { kind: 'icon' });
    expect(icons.every((k) => /json\/(fxmit|fxccby|fxccbyna)\.json#/.test(k))).toBe(true);
    expect(row(FIX_KEYS.iconCircle)).toMatchObject({ duties: { credit: false, nonCommercial: false, shareable: false }, badges: { trademark: true } });
    expect(row(FIX_KEYS.ccbyIcon).credit!.text).toContain(FIX_ICON_AUTHOR);
    expect(row(FIX_KEYS.ccbyNoAuthor).unusable).toBe('credit_missing');
    // licences the table refuses stay listed with their reason; personal-use-only is non-commercial
    expect(row(FIX_KEYS.nd).unusable).toBe('licence_no_derivatives');
    expect(row(FIX_KEYS.unknownCustom).unusable).toBe('licence_unknown');
    expect(row(FIX_KEYS.animated).unusable).toBe('animated');
    expect(row(FIX_KEYS.personal).duties).toMatchObject({ nonCommercial: true, shareable: false });
    expect(row(FIX_KEYS.pattern).badges).toEqual({ people: true });
    expect(row(FIX_KEYS.flac).licenceId).toBe('custom:musopen-flac');
    // fluent: 3D PNG stickers with CLDR words; noto: code points to words
    expect(row(FIX_KEYS.menorah)).toMatchObject({ kind: 'sticker', meta: { width: 256, height: 256, unicode: '1f54e' } });
    expect(row(FIX_KEYS.heart).title).toBe('red heart');
    // a file item is listed from the ledger alone: the tampered and linked items are listed (and refused at use)
    expect(s.get(FIX_KEYS.tampered)).not.toBeNull();
    expect(s.get(FIX_KEYS.linked)).not.toBeNull();
  });
});

describe('the index file: swapped whole, cancellable, rebuilt after a cut', () => {
  it('the previous index answers while a build runs; a cancel keeps it; a cut build is rebuilt by the next start', async () => {
    let gate: (() => void) | null = null;
    const held = { on: false };
    const s = service('swap', { onEntry: async () => { if (held.on) await new Promise<void>((r) => { gate = r; }); } });
    await ready(s);
    const before = await keys(s, { q: 'tone', limit: 200 });
    held.on = true;
    s.startBuild();
    await new Promise((r) => setTimeout(r, 200));
    expect((await s.status(true)).state).toBe('indexing');
    expect(fs.existsSync(path.join(base, 'swap', 'library-index.sqlite.tmp'))).toBe(true);
    expect(await keys(s, { q: 'tone', limit: 200 })).toEqual(before);
    expect(s.cancelBuild()).toBe(true);
    held.on = false;
    (gate as (() => void) | null)?.();
    await s.idle();
    expect((await s.status(true)).counts).toEqual(FIX_COUNTS);
    expect(fs.existsSync(path.join(base, 'swap', 'library-index.sqlite.tmp'))).toBe(false);
    // a cut: the ledger changes, a build starts and the process "ends" in the middle (the temp file is left as a crash leaves it)
    fx.handLedger();
    try {
      held.on = true;
      s.startBuild();
      await new Promise((r) => setTimeout(r, 200));
      expect(fs.existsSync(path.join(base, 'swap', 'library-index.sqlite.tmp'))).toBe(true);
      const tmpCopy = fs.readFileSync(path.join(base, 'swap', 'library-index.sqlite.tmp'));
      s.close();
      held.on = false;
      (gate as (() => void) | null)?.();
      await s.idle();
      fs.writeFileSync(path.join(base, 'swap', 'library-index.sqlite.tmp'), tmpCopy);
      const again = new LibraryService({ dataDir: path.join(base, 'swap'), libraryDir: fx.root } as Config);
      services.push(again);
      await ready(again);
      expect((await again.status(true)).counts).toEqual({ ...FIX_COUNTS, music: FIX_COUNTS.music + 1 });
      expect(again.get(FIX_KEYS.dotdot)).not.toBeNull();
    } finally {
      fx.restoreLedger();
    }
  });
});

describe('the root', () => {
  it('is checked: absolute, existing, holding the ledger, outside the data directory and the repository', () => {
    const s = service('roots', { env: null, noStartupBuild: true });
    expect(s.rootProblem('relative/path')).toBe('it is not an absolute path');
    expect(s.rootProblem(path.join(base, 'no-such-folder'))).toBe('it does not exist');
    expect(s.rootProblem(base)).toBe('it holds no _manifests/ledger.json');
    const inData = path.join(base, 'roots', 'lib');
    fs.mkdirSync(path.join(inData, '_manifests'), { recursive: true });
    fs.writeFileSync(path.join(inData, '_manifests', 'ledger.json'), '{"ledgerVersion":1,"entries":[]}');
    expect(s.rootProblem(inData)).toBe('it lies inside the data directory');
    const inRepo = fs.mkdtempSync(path.join(REPO_ROOT, '.pf-libroot-test-'));
    try {
      fs.mkdirSync(path.join(inRepo, '_manifests'));
      fs.writeFileSync(path.join(inRepo, '_manifests', 'ledger.json'), '{"ledgerVersion":1,"entries":[]}');
      expect(s.rootProblem(inRepo)).toBe('it lies inside the repository');
    } finally { fs.rmSync(inRepo, { recursive: true, force: true }); }
    expect(s.rootProblem(fx.root)).toBeNull();
    let err: { code?: string; details?: { reason?: string } } = {};
    try { s.setRoot(path.join(base, 'no-such-folder')); } catch (e) { err = e as typeof err; }
    expect([err.code, err.details?.reason]).toEqual(['library_root_invalid', 'it does not exist']);
    expect(s.configuredRoot()).toBeNull();
    s.setRoot(fx.root);
    expect(s.configuredRoot()).toBe(fx.root);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(base, 'roots', 'library.json')).mode & 0o777).toBe(0o600);
  });
  it('PF_LIBRARY_DIR wins over library.json', () => {
    fs.mkdirSync(path.join(base, 'env'), { recursive: true });
    fs.writeFileSync(path.join(base, 'env', 'library.json'), JSON.stringify({ root: '/somewhere/else' }));
    const s = service('env', { env: fx.root, noStartupBuild: true });
    expect(s.configuredRoot()).toBe(fx.root);
  });
  it('states: root_missing, ledger_missing, ledger_invalid (version 2); the previous index keeps answering', async () => {
    const s = service('states');
    await ready(s);
    const q = { q: 'tone', limit: 200 } as const;
    const before = await keys(s, q);
    fx.ledgerV2();
    try {
      const st = await s.status(true);
      expect(st.state).toBe('ledger_invalid');
      expect(st.problems[0]!.reason).toMatch(/not version 1/);
      expect(await keys(s, q)).toEqual(before);
    } finally { fx.restoreLedger(); }
    fs.renameSync(fx.ledgerFile, `${fx.ledgerFile}.away`);
    try {
      expect((await s.status(true)).state).toBe('ledger_missing');
      expect(await keys(s, q)).toEqual(before);
    } finally { fs.renameSync(`${fx.ledgerFile}.away`, fx.ledgerFile); }
    fs.renameSync(fx.root, `${fx.root}.away`);
    try {
      expect((await s.status(true)).state).toBe('root_missing');
      expect(await keys(s, q)).toEqual(before);
    } finally { fs.renameSync(`${fx.root}.away`, fx.root); }
    expect((await s.status(true)).state).toBe('ready');
    const none = service('none', { env: null });
    expect((await none.status(true))).toMatchObject({ state: 'not_configured', counts: {} });
  });
});

describe('fail closed', () => {
  it('without an SVG rasteriser, SVG rows are not offered and are counted under needs_svg_rasteriser', async () => {
    const s = service('noraster', { rasteriser: async () => false });
    await ready(s);
    const st = await s.status(true);
    const svgTotal = Object.values(FIX_SVG_COUNTS).reduce((a, b) => a + b, 0);
    expect(st.unusable.needs_svg_rasteriser).toBe(svgTotal);
    expect(st.counts).toEqual({ music: 7, sound: 6, sticker: 2, illustration: 2 });
    expect((await s.search({ limit: 200 })).rows.some((r) => /\.svg$|\.json#/.test(r.key))).toBe(false);
  });
  it('when the licence table is not built, nothing is listed and the status says why', async () => {
    const s = service('noduties', { duties: () => { throw new Error('licenceDuties is not built yet'); } });
    await ready(s);
    const st = await s.status(true);
    expect(st.counts).toEqual({});
    expect(st.problems, JSON.stringify(st)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(/licence table is not built/) })]));
  });
});

describe('reader pieces', () => {
  it('pieces.json, CLDR annotations, icon sets admitted by licence', () => {
    const p = parsePieces(JSON.stringify([{ title: 'A', filename: 'A.mp3', length: '1:05', bpm: 'x', genre: 'Rock, Pop' }, { title: '', filename: 'B.mp3' }, 'junk']));
    expect([...p.entries()]).toEqual([['A.mp3', { title: 'A', lengthSeconds: 65, genre: ['Rock', 'Pop'], mood: [], instruments: [] }]]);
    expect(parsePieces('not json').size).toBe(0);
    const m = new Map();
    parseAnnotations('<annotation cp="&amp;">ו | and</annotation><annotation cp="🕎" type="tts">חנוכיה</annotation><annotation cp="❤️">לב</annotation>', 'he', m);
    expect([...m.keys()]).toEqual(['26', '1f54e', '2764']);
    expect(m.get('1f54e')).toMatchObject({ ttsHe: 'חנוכיה' });
    expect(admittedSets({ a: { license: { spdx: 'MIT' } }, ri: { license: { spdx: 'Apache-2.0' } }, g: { license: { spdx: 'GPL-3.0' } }, n: { license: { spdx: 'CC-BY-NC-4.0' } }, s: { license: { spdx: 'CC-BY-SA-4.0' } }, c: { license: { spdx: 'CC-BY-4.0' } }, '../x': { license: { spdx: 'MIT' } } })).toEqual(['a', 'c']);
  });
  it('the FTS query is built only from search-key words', () => {
    expect(ftsQuery('  ')).toBeNull();
    expect(ftsQuery('"x" OR y*')).toBe('({title body}: "x"*) AND ({title body}: "or"*) AND ({title body}: "y"*)');
    expect(ftsQuery('החנוכיה')).toBe('({title body}: "החנוכיה"* OR {tsk bsk}: "החנכה"* OR {title body}: "חנוכיה"* OR {tsk bsk}: "חנכה"*)');
  });
});
