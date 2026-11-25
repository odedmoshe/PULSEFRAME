/**
 * «חיפוש בצילומים» — core functions (builder A; .artifacts/wave7/search-decisions.md §4–5). Synthetic documents only: invented
 * names («אלף», "Gimel", «תוויתסוד»), no real media. Covers the it.todo rows of footageSearchContracts.test.ts.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  agentAnswerOf, createProject, FOOTAGE_LIMITS, FOOTAGE_SEARCH_BUILT, footageQueryForms, int8Dot, mergePictureHits, MomentSchema, parseFootageQuery, PICTURE_MIN_RELEVANCE,
  quantiseInt8, sampleFrameTargets, searchFootage, validateProject,
  type Asset, type Capture, type Moment, type ProjectDocument,
} from './index.ts';

const R30 = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const hash = (s: string) => `sha256:${[...s].reduce((h, c) => ((h * 31 + c.codePointAt(0)!) >>> 0), 7).toString(16).padStart(8, '0').repeat(8)}`;
const sec = (n: number, d = 1) => T.normalize(T.rt(n, d));
const cap = (at: string, extra: Partial<Capture> = {}): Capture => ({ at, utcOffsetMinutes: null, source: 'filename', ...extra });

function video(id: string, name: string, frames: number, extra: Partial<Asset> = {}, rate = R30): Asset {
  return {
    id, kind: 'video', name, contentHash: hash(id), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, rate),
    video: { width: 320, height: 180, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov, ...extra,
  } as Asset;
}
const still = (id: string, name: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'image', name, contentHash: hash(id), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 64, height: 64, codec: 'png', hasAlpha: false }, provenance: prov, ...extra }) as Asset;

/** talk.mp4: «תכבי את הנרות» then «שירי חנוכה»; word times in 1/1000 s (not frame edges: a word edge is not a frame edge). */
function transcript(assetId: string, phrases: { start: number; words: [string, number, number][] }[]) {
  return {
    assetId, language: 'he', origin: { kind: 'manual' as const, provider: null, model: null, createdAt: '2026-11-25T00:00:00Z', createdBy: 'test' },
    segments: phrases.map((p, i) => ({
      id: `seg_${i}`, start: sec(p.start, 1000), duration: sec(p.words[p.words.length - 1]![1] + p.words[p.words.length - 1]![2] - p.start, 1000),
      text: p.words.map((w) => w[0]).join(' '), original: null, speaker: null, timing: 'word' as const,
      words: p.words.map(([text, s, d], k) => ({ id: `w_${i}_${k}`, text, start: sec(s, 1000), duration: sec(d, 1000), confidence: null })),
    })),
  };
}

function fixture(): ProjectDocument {
  const doc = createProject({ id: 'prj_fs', name: 'חיפוש' });
  const assets: Asset[] = [
    video('ast_col', 'colours.mp4', 360),
    video('ast_col2', 'colours2.mp4', 180),
    video('ast_han', 'VID_20241226_183000.mp4', 120, { capture: cap('2024-12-26T18:30:00', { circa: true }) }),
    video('ast_talk', 'talk.mp4', 300, { capture: cap('2025-04-12T11:00:00'), audio: { sampleRate: 48000, channels: 1, codec: 'aac' } }),
    still('ast_beach', 'beach.png', { capture: cap('2023-08-01T10:00:00') }),
    video('ast_seder', 'ערב פסח.mp4', 90, { capture: cap('2025-04-12T20:30:00', { utcOffsetMinutes: 180 }) }),
  ];
  for (const a of assets) doc.assets[a.id] = a;
  doc.transcripts.ast_talk = transcript('ast_talk', [
    { start: 1000, words: [['תכבי', 1000, 400], ['את', 1400, 200], ['הנרות', 1600, 533]] },
    { start: 5000, words: [['שירי', 5000, 300], ['בנרות', 5300, 700], ['Gimel', 6000, 250]] },
  ]) as never;
  doc.events = { evt_trip: { id: 'evt_trip', name: 'טיול לים', afterSunset: null, assetIds: ['ast_beach'], origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: true } } };
  doc.people = { per_alef: { id: 'per_alef', name: 'אלף', birthDate: null }, per_gimel: { id: 'per_gimel', name: 'Gimel', birthDate: null } };
  doc.sourceRanges = {
    rng_secret: { id: 'rng_secret', assetId: 'ast_col2', kind: 'pearl', span: { start: sec(1), end: sec(7, 2) }, label: 'תוויתסוד', people: ['per_alef'], createdBy: 'user:owner' },
    rng_here: { id: 'rng_here', assetId: 'ast_col', kind: 'presence', span: null, label: '', people: ['per_gimel'], createdBy: 'user:owner' },
  };
  return doc;
}
const ids = (ms: Moment[]) => ms.map((m) => m.assetId);
const owner = (doc: ProjectDocument, q: string, limit?: number) => searchFootage(doc, q, { reader: 'owner', limit });
const agent = (doc: ProjectDocument, q: string, limit?: number) => searchFootage(doc, q, { reader: 'agent', limit });

describe('the fixture', () => {
  it('is a valid document and the flag says built', () => {
    expect(validateProject(fixture())).toEqual([]);
    expect(FOOTAGE_SEARCH_BUILT).toBe(true);
  });
});

describe('query forms (searchKey, points, final letters, prefixes)', () => {
  it('takes off up to two prefix letters while two letters remain; Latin words keep one form', () => {
    expect(footageQueryForms('בנרות')).toEqual(['בנרות', 'נרות']);
    expect(footageQueryForms('ובנרות')).toEqual(['ובנרות', 'בנרות', 'נרות']);
    expect(footageQueryForms('הנר')).toEqual(['הנר', 'נר']);
    expect(footageQueryForms('לב')).toEqual(['לב']);
    expect(footageQueryForms('Gimel')).toEqual(['gimel']);
    expect(footageQueryForms('')).toEqual([]);
  });
  it('drops points and reads final letters as regular', () => {
    expect(footageQueryForms('שָׁלוֹם')).toEqual(['שלומ', 'לומ', 'ומ']);
    expect(footageQueryForms('שלום')).toEqual(footageQueryForms('שָׁלוֹם'));
    expect(footageQueryForms('הַנֵּרוֹת')).toEqual(['הנרות', 'נרות']);
  });
});

describe('date and holiday parsing', () => {
  it('years, Gregorian and Hebrew months, Hebrew years and holiday families', () => {
    expect(parseFootageQuery('חנוכה 2024')).toEqual({ words: [], dates: [{ kind: 'holiday', family: 'hanukkah' }, { kind: 'year', year: 2024 }] });
    expect(parseFootageQuery('דצמבר').dates).toEqual([{ kind: 'month', month: 12 }]);
    expect(parseFootageQuery('בדצמבר').dates).toEqual([{ kind: 'month', month: 12 }]);
    expect(parseFootageQuery('December').dates).toEqual([{ kind: 'month', month: 12 }]);
    expect(parseFootageQuery('כסלו').dates).toEqual([{ kind: 'hebrewMonth', month: 3 }]);
    expect(parseFootageQuery('אדר ב׳').dates).toEqual([{ kind: 'hebrewMonth', month: 14 }]);
    expect(parseFootageQuery('אדר').dates).toEqual([{ kind: 'hebrewMonth', month: 6 }]);
    expect(parseFootageQuery('תשפ״ה').dates).toEqual([{ kind: 'hebrewYear', year: 5785 }]);
    expect(parseFootageQuery('ה׳תשפ"ה').dates).toEqual([{ kind: 'hebrewYear', year: 5785 }]);
    expect(parseFootageQuery('בתשפ״ה').dates).toEqual([{ kind: 'hebrewYear', year: 5785 }]);
    expect(parseFootageQuery('ראש השנה').dates).toEqual([{ kind: 'holiday', family: 'rosh-hashana' }]);
    expect(parseFootageQuery('ט״ו בשבט').dates).toEqual([{ kind: 'holiday', family: 'tu-bishvat' }]);
    expect(parseFootageQuery('בחנוכה').dates).toEqual([{ kind: 'holiday', family: 'hanukkah' }]);
    expect(parseFootageQuery('חֲנֻכָּה').dates).toEqual([{ kind: 'holiday', family: 'hanukkah' }]);
    expect(parseFootageQuery('Hanukkah').dates).toEqual([{ kind: 'holiday', family: 'hanukkah' }]);
  });
  it('words stay words: out-of-range years, short stripped month forms, ordinary words', () => {
    expect(parseFootageQuery('1850 באב נרות')).toEqual({ words: [{ token: '1850', forms: ['1850'] }, { token: 'באב', forms: ['באב', 'אב'] }, { token: 'נרות', forms: ['נרות'] }], dates: [] });
    expect(parseFootageQuery('ט״ו').words.map((w) => w.token)).toEqual(['טו']);
    expect(parseFootageQuery('   ')).toEqual({ words: [], dates: [] });
  });
});

describe('searchFootage', () => {
  const doc = fixture();
  it('S2: «חנוכה 2024» finds exactly the VID_20241226 file', () => {
    expect(owner(doc, 'חנוכה 2024')).toEqual([{ assetId: 'ast_han', start: null, end: null, sources: ['date'] }]);
    expect(owner(doc, 'Hanukkah')).toEqual([{ assetId: 'ast_han', start: null, end: null, sources: ['date'] }]);
    expect(owner(doc, 'כסלו תשפ״ה').map((m) => m.assetId)).toEqual(['ast_han']);
  });
  it('S2: «נרות» finds the «בנרות» phrase (and «הנרות») with the exact rational word span', () => {
    const r = owner(doc, 'נרות');
    expect(r).toEqual([
      { assetId: 'ast_talk', start: sec(1600, 1000), end: sec(2133, 1000), sources: ['transcript'], snippet: 'תכבי את הנרות' },
      { assetId: 'ast_talk', start: sec(5300, 1000), end: sec(6000, 1000), sources: ['transcript'], snippet: 'שירי בנרות Gimel' },
    ]);
    // a phrase's span runs from the first found word's start to the last found word's end
    expect(owner(doc, 'תכבי נרות')[0]).toMatchObject({ start: sec(1), end: sec(2133, 1000) });
    // pointed query, prefixed query
    expect(owner(doc, 'בַּנֵּרוֹת').length).toBe(2);
  });
  it('holidays by the Hebrew day with the sunset window (talk.mp4 at 11:00 is Erev Pesach; the Seder file at 20:30 is 15 Nisan night either way)', () => {
    expect(ids(owner(doc, 'פסח'))).toEqual(['ast_talk', 'ast_seder']);
    expect(ids(owner(doc, 'ליל הסדר'))).toEqual(['ast_talk', 'ast_seder']); // the family, not the evening: a heuristic of families
    expect(ids(owner(doc, 'חנוכה פסח'))).toEqual([]);
    expect(ids(owner(doc, 'ניסן'))).toEqual(['ast_talk', 'ast_seder']);
  });
  it('file names, events and Latin words; AND semantics', () => {
    expect(owner(doc, 'colours')).toEqual([{ assetId: 'ast_col', start: null, end: null, sources: ['name'] }, { assetId: 'ast_col2', start: null, end: null, sources: ['name'] }]);
    expect(owner(doc, 'colours2')).toEqual([{ assetId: 'ast_col2', start: null, end: null, sources: ['name'] }]);
    expect(owner(doc, 'לים')).toEqual([{ assetId: 'ast_beach', start: null, end: null, sources: ['event'] }]);
    expect(owner(doc, 'טיול beach 2023')).toEqual([{ assetId: 'ast_beach', start: null, end: null, sources: ['name', 'date', 'event'] }]);
    expect(owner(doc, 'טיול 2024')).toEqual([]);
    // a transcript word and the file's name together
    expect(owner(doc, 'talk שירי')).toEqual([{ assetId: 'ast_talk', start: sec(5), end: sec(53, 10), sources: ['name', 'transcript'], snippet: 'שירי בנרות Gimel' }]);
  });
  it('the owner finds pearl names and tagged people; an agent never does', () => {
    expect(owner(doc, 'תוויתסוד')).toEqual([{ assetId: 'ast_col2', start: sec(1), end: sec(7, 2), sources: ['pearl'], snippet: 'תוויתסוד' }]);
    expect(owner(doc, 'אלף')).toEqual([{ assetId: 'ast_col2', start: sec(1), end: sec(7, 2), sources: ['person'], snippet: 'תוויתסוד' }]);
    expect(owner(doc, 'gimel')).toEqual([
      { assetId: 'ast_talk', start: sec(6), end: sec(625, 100), sources: ['transcript'], snippet: 'שירי בנרות Gimel' },
      { assetId: 'ast_col', start: null, end: null, sources: ['person'] },
    ]);
    expect(agent(doc, 'תוויתסוד')).toEqual([]);
    expect(agent(doc, 'אלף')).toEqual([]);
    // an agent finds what was said, without a snippet
    expect(agent(doc, 'gimel')).toEqual([{ assetId: 'ast_talk', start: sec(6), end: sec(625, 100), sources: ['transcript'] }]);
  });
  it('agent reader NEVER reads doc.sourceRanges, doc.people, a label or a tag (getters that throw when read)', () => {
    const planted = fixture();
    const reads: string[] = [];
    const trap = (what: string) => () => { reads.push(what); throw new Error(`read ${what}`); };
    Object.defineProperty(planted, 'sourceRanges', { get: trap('sourceRanges'), enumerable: true, configurable: true });
    Object.defineProperty(planted, 'people', { get: trap('people'), enumerable: true, configurable: true });
    for (const q of ['תוויתסוד', 'אלף', 'gimel', 'נרות', 'colours', 'חנוכה 2024', 'טיול']) expect(() => agent(planted, q)).not.toThrow();
    expect(reads).toEqual([]);
    // and the same trap fires for the owner: it proves the trap works
    expect(() => owner(planted, 'נרות')).toThrow(/read (sourceRanges|people)/);
    // a range object whose label and people throw when read: still never touched for an agent
    reads.length = 0;
    const deep = fixture();
    const r = deep.sourceRanges!.rng_secret!;
    Object.defineProperty(r, 'label', { get: trap('label'), enumerable: true });
    Object.defineProperty(r, 'people', { get: trap('people[]'), enumerable: true });
    Object.defineProperty(deep.people!.per_alef!, 'name', { get: trap('name'), enumerable: true });
    expect(agent(deep, 'אלף')).toEqual([]);
    expect(reads).toEqual([]);
  });
  it('agent answers carry only agent sources and pass agentAnswerOf unchanged', () => {
    for (const q of ['נרות', 'gimel', 'colours', 'חנוכה', 'טיול', 'תוויתסוד', 'אלף']) {
      const a = agent(doc, q);
      for (const m of a) { expect(m.sources.every((s) => ['name', 'date', 'event', 'transcript'].includes(s))).toBe(true); expect(m.snippet).toBeUndefined(); expect(m.frame).toBeUndefined(); }
      expect(agentAnswerOf({ exact: a }).exact).toEqual(a);
      expect(JSON.stringify(a)).not.toMatch(/תוויתסוד|אלף|per_/);
    }
  });
  it('S17: nothing found is an empty list, never padded; every moment is schema-valid; a limit is a limit', () => {
    expect(owner(doc, 'zzqxw')).toEqual([]);
    expect(owner(doc, 'colours zzqxw')).toEqual([]);
    expect(owner(doc, '?!')).toEqual([]);
    for (const q of ['נרות', 'colours', 'gimel', 'אלף', 'פסח']) for (const m of owner(doc, q)) expect(MomentSchema.parse(m)).toEqual(m);
    expect(owner(doc, 'colours', 1)).toHaveLength(1);
    expect(() => owner(doc, 'x', 0)).toThrow(RangeError);
    expect(owner(doc, 'colours', 500)).toHaveLength(2);
  });
  it('order: spans first, then capture time (dated first), then name in code-point order', () => {
    const d = fixture();
    d.assets.ast_b = video('ast_b', 'b clip.mp4', 30, { capture: cap('2020-01-01') });
    d.assets.ast_a = video('ast_a', 'a clip.mp4', 30, { capture: cap('2021-01-01') });
    d.assets.ast_c = video('ast_c', 'c clip.mp4', 30);
    d.assets.ast_0 = video('ast_0', '0 clip.mp4', 30);
    expect(ids(owner(d, 'clip'))).toEqual(['ast_b', 'ast_a', 'ast_0', 'ast_c']);
  });
  it('transcripts follow copies with their offset; words outside a trimmed copy are not read', () => {
    const d = fixture();
    d.assets.ast_trim = video('ast_trim', 'trim.mp4', 120, { provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test',
      derived: { jobId: 'job_t', capabilityId: 'local.video.trim', capabilityVersion: '1', graphDigest: hash('g'), params: {}, sourceAssetIds: ['ast_talk'], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: { id: 'ffmpeg' }, sourceRangeStart: sec(3) } } } as never);
    const hits = owner(d, 'בנרות').filter((m) => m.assetId === 'ast_trim');
    expect(hits).toEqual([{ assetId: 'ast_trim', start: sec(23, 10), end: sec(3), sources: ['transcript'], snippet: 'שירי בנרות Gimel' }]);
    // «הנרות» at 1.6 s of the original lies before the copy's start: not in the copy
    expect(owner(d, 'תכבי').map((m) => m.assetId)).toEqual(['ast_talk']);
  });
  it('the same answer in Node and the browser: no locale API, no Date, no bare sort in the source', () => {
    const src = fs.readFileSync(new URL('./footageSearch.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of [/localeCompare/, /\bIntl\b/, /\bDate\b/, /toLocale/, /\.sort\(\s*\)/, /Collator/]) expect(src).not.toMatch(bad);
  });
});

describe('sampleFrameTargets', () => {
  it('30000/1001 over 300 frames equals ceil(s·r) for every s with exact rationals, and never reaches frameCount', () => {
    const got = sampleFrameTargets(NTSC, 300);
    const want: number[] = [];
    for (let s = 0n; ; s++) { const k = (s * 30000n + 1000n) / 1001n; if (k >= 300n) break; want.push(Number(k)); }
    expect(got).toEqual(want);
    expect(got.slice(0, 4)).toEqual([0, 30, 60, 90]);
    expect(got.every((k) => k < 300)).toBe(true);
    // each target is the first frame at or after s seconds: frameTime(k) ≥ s > frameTime(k − 1)
    got.forEach((k, s) => { expect(T.lte(T.rt(s, 1), T.frameTime(k, NTSC))).toBe(true); if (k > 0) expect(T.lt(T.frameTime(k - 1, NTSC), T.rt(s, 1))).toBe(true); });
  });
  it('integer rates, slow rates, empty files, bad input', () => {
    expect(sampleFrameTargets(R30, 360)).toEqual(Array.from({ length: 12 }, (_, i) => i * 30));
    expect(sampleFrameTargets(R30, 361)).toHaveLength(13);
    expect(sampleFrameTargets({ num: 1, den: 2 }, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleFrameTargets(R30, 0)).toEqual([]);
    expect(() => sampleFrameTargets({ num: 0, den: 1 }, 10)).toThrow(RangeError);
    expect(() => sampleFrameTargets(R30, 1.5)).toThrow(RangeError);
  });
});

describe('int8 quantising and the dot product', () => {
  it('rounds half away from zero (written out); max maps to ±127; zeros stay zero', () => {
    const v = new Float32Array([127 / 64, -127 / 64, 1.5 / 64, -1.5 / 64, -2.5 / 64, 0]); // scale 1/64: every quotient exact
    const { scale, q } = quantiseInt8(v);
    expect(scale).toBe(1 / 64);
    expect([...q]).toEqual([127, -127, 2, -2, -3, 0]); // 1.5 → 2, −1.5 → −2 and −2.5 → −3 (Math.round would give −1 and −2)
    expect(quantiseInt8(new Float32Array(4))).toEqual({ scale: 0, q: new Int8Array(4) });
    expect(() => quantiseInt8(new Float32Array([1, NaN]))).toThrow(RangeError);
  });
  it('int8Dot is the exact integer dot; scaled it equals the float dot of the dequantised vectors within 1/127² per dimension of the originals', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    for (let t = 0; t < 20; t++) {
      const unit = () => { const v = new Float32Array(FOOTAGE_LIMITS.embedDim); let n = 0; for (let i = 0; i < v.length; i++) { v[i] = rnd(); n += v[i]! * v[i]!; } for (let i = 0; i < v.length; i++) v[i] = v[i]! / Math.sqrt(n); return v; };
      const a = unit(), b = unit();
      const qa = quantiseInt8(a), qb = quantiseInt8(b);
      let exact = 0, deq = 0, ref = 0;
      for (let i = 0; i < a.length; i++) { exact += qa.q[i]! * qb.q[i]!; deq += qa.q[i]! * qa.scale * qb.q[i]! * qb.scale; ref += a[i]! * b[i]!; }
      const d = int8Dot(qa.q, qb.q);
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBe(exact);
      expect(Math.abs(d * qa.scale * qb.scale - deq)).toBeLessThan(1e-12);
      // provable bound: per dimension |a·b − â·b̂| ≤ sa·sb·(127 + 1/4) ≤ (127.25/127²)·max|a|·max|b|·127² / 127²
      expect(Math.abs(ref - d * qa.scale * qb.scale)).toBeLessThanOrEqual(a.length * qa.scale * qb.scale * 127.25);
      // and in practice well inside 1/127² per dimension
      expect(Math.abs(ref - d * qa.scale * qb.scale)).toBeLessThan(a.length / (127 * 127));
    }
    expect(() => int8Dot(new Int8Array(2), new Int8Array(3))).toThrow(RangeError);
  });
});

describe('mergePictureHits', () => {
  const doc = fixture();
  const blue = [3, 4, 5].map((s) => ({ assetId: 'ast_col', frame: s * 30, relevance: 0.5 + s / 100 }));
  it('S9: blue frames at 3, 4, 5 s give exactly [2 s, 6 s] at 30 fps, snapped outward at 29.97', () => {
    expect(mergePictureHits(doc, blue, R30, 30)).toEqual([{ assetId: 'ast_col', start: sec(2), end: sec(6), sources: ['picture'], frame: 150 }]);
    const ntsc = mergePictureHits(doc, blue, NTSC, 30)[0]!;
    expect(ntsc.start).toEqual(T.normalize(T.frameTime(59, NTSC))); // floor(2 · 29.97) = 59
    expect(ntsc.end).toEqual(T.normalize(T.frameTime(180, NTSC))); // ceil(6 · 29.97) = 180
  });
  it('merges closer than 3 s, splits at 3 s; ranks by best relevance, ties by (assetId, start); clamps into the file', () => {
    const hits = [
      { assetId: 'ast_col', frame: 0, relevance: 0.2 }, { assetId: 'ast_col', frame: 90, relevance: 0.2 }, // 3 s apart: two moments
      { assetId: 'ast_col', frame: 330, relevance: 0.2 }, // 11 s: end clamps to 12 s
      { assetId: 'ast_col2', frame: 0, relevance: 0.2 },
    ];
    expect(mergePictureHits(doc, hits, R30, 30)).toEqual([
      { assetId: 'ast_col', start: sec(0), end: sec(1), sources: ['picture'], frame: 0 },
      { assetId: 'ast_col', start: sec(2), end: sec(4), sources: ['picture'], frame: 90 },
      { assetId: 'ast_col', start: sec(10), end: sec(12), sources: ['picture'], frame: 330 },
      { assetId: 'ast_col2', start: sec(0), end: sec(1), sources: ['picture'], frame: 0 },
    ]);
    expect(mergePictureHits(doc, hits, R30, 2)).toHaveLength(2);
  });
  it('S17: below the floor, unknown files, stills and frames past the end give nothing; never a score', () => {
    expect(mergePictureHits(doc, [{ assetId: 'ast_col', frame: 30, relevance: PICTURE_MIN_RELEVANCE / 2 }], R30, 30)).toEqual([]);
    expect(mergePictureHits(doc, [{ assetId: 'ast_gone', frame: 30, relevance: 0.9 }, { assetId: 'ast_beach', frame: 0, relevance: 0.9 }, { assetId: 'ast_col', frame: 360, relevance: 0.9 }], R30, 30)).toEqual([]);
    expect(JSON.stringify(mergePictureHits(doc, blue, R30, 30))).not.toMatch(/relevance|0\.5|score/);
    expect(() => mergePictureHits(doc, [{ assetId: 'ast_col', frame: 1, relevance: NaN }], R30, 30)).toThrow(RangeError);
  });
  it('uses only the best 200 frames', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ assetId: 'ast_long', frame: i * 300, relevance: i < 100 ? 0.01 : 0.5 }));
    const d = fixture();
    d.assets.ast_long = video('ast_long', 'long.mp4', 300 * 300);
    const out = mergePictureHits(d, many, R30, 50);
    // frames 10 s apart never merge: 200 moments would exist, the limit gives 50, all from the better 200
    expect(out).toHaveLength(50);
    expect(out.every((m) => m.frame! >= 100 * 300)).toBe(true);
  });
});
