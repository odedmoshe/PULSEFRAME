/**
 * «חיפוש בצילומים» — properties over seeded random synthetic documents (builder A; search-decisions.md §5): AND semantics; a token
 * never adds results; shuffled key order gives the same JSON; an agent's answer never holds a pearl or person source or a label;
 * picture spans lie inside their files on project frame edges, outward, with deterministic ties; frame targets are exact.
 * Invented words only; no media.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  createProject, mergePictureHits, sampleFrameTargets, searchFootage,
  type Asset, type Moment, type PictureHit, type ProjectDocument,
} from './index.ts';

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const RATES: T.Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }, { num: 24000, den: 1001 }];
const VOCAB = ['נרות', 'בנרות', 'הנרות', 'עוגה', 'בעוגה', 'ים', 'לים', 'סבתא', 'שָׁלוֹם', 'חנוכה', 'טיול', 'ball', 'cake', 'Beach', 'party', 'גן', 'גינה', 'שמש', 'משחק'];
const QUERY_WORDS = ['נרות', 'עוגה', 'ים', 'סבתא', 'שלום', 'טיול', 'ball', 'cake', 'beach', 'party', 'גן', 'שמש', 'מש', 'ב', '2024', 'חנוכה', 'דצמבר', 'תשפ״ה', 'אלפא', 'ביתא'];
const PEOPLE = ['אלפא', 'ביתא', 'Gamma'];
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const pick = <V>(r: () => number, xs: readonly V[]): V => xs[Math.floor(r() * xs.length)]!;

function randomDoc(seed: number): ProjectDocument {
  const r = rng(seed);
  const doc = createProject({ id: `prj_${seed}`, name: 'P' });
  const n = 2 + Math.floor(r() * 5);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `ast_${seed}_${i}`, rate = pick(r, RATES), frames = 30 + Math.floor(r() * 600);
    const words = Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, VOCAB));
    const day = 20 + Math.floor(r() * 10);
    const a = {
      id, kind: r() < 0.85 ? 'video' : 'image', name: `${words.join('_')}.mp4`, contentHash: `sha256:${String(seed * 100 + i).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4',
      duration: T.frameTime(frames, rate), video: { width: 64, height: 64, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames }, audio: { sampleRate: 48000, channels: 1, codec: 'aac' }, provenance: prov,
      ...(r() < 0.7 ? { capture: { at: `${pick(r, ['2023', '2024', '2025'])}-12-${day}T${String(Math.floor(r() * 24)).padStart(2, '0')}:00:00`, utcOffsetMinutes: null, source: 'container' } } : {}),
    } as unknown as Asset;
    doc.assets[id] = a;
    ids.push(id);
    if (a.kind === 'video' && r() < 0.7) {
      let at = 0;
      const segments = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, s) => {
        const ws = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => { const d = 100 + Math.floor(r() * 900); const w = { id: `w${s}_${k}`, text: pick(r, VOCAB), start: T.rt(at, 1000), duration: T.rt(d, 1000), confidence: null }; at += d; return w; });
        return { id: `s${s}`, start: ws[0]!.start, duration: T.sub(T.add(ws[ws.length - 1]!.start, ws[ws.length - 1]!.duration), ws[0]!.start), text: ws.map((w) => w.text).join(' '), original: null, speaker: null, timing: 'word', words: ws };
      });
      doc.transcripts[id] = { assetId: id, language: 'he', origin: { kind: 'manual', provider: null, model: null, createdAt: prov.importedAt, createdBy: 'test' }, segments } as never;
    }
  }
  if (r() < 0.6) doc.events = { evt_1: { id: 'evt_1', name: r() < 0.5 ? `${pick(r, VOCAB)} ${pick(r, VOCAB)}` : '', afterSunset: pick(r, [null, true, false]), assetIds: ids.slice(0, 2), origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: true } } };
  doc.people = Object.fromEntries(PEOPLE.map((name, i) => [`per_${i}`, { id: `per_${i}`, name, birthDate: null }]));
  const ranges: NonNullable<ProjectDocument['sourceRanges']> = {};
  for (let k = 0; k < 2; k++) {
    if (r() < 0.4) continue;
    const id = pick(r, ids), a = doc.assets[id]!;
    ranges[`rng_${k}`] = { id: `rng_${k}`, assetId: id, kind: 'pearl', span: a.kind === 'video' ? { start: T.ZERO, end: a.duration } : null, label: `${pick(r, VOCAB)} סודי${k}`, people: [`per_${Math.floor(r() * 3)}`], createdBy: 'user:owner' };
  }
  if (Object.keys(ranges).length) doc.sourceRanges = ranges;
  return doc;
}
const reorder = <V>(rec: Record<string, V>, r: () => number): Record<string, V> => {
  const keys = Object.keys(rec);
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [keys[i], keys[j]] = [keys[j]!, keys[i]!]; }
  return Object.fromEntries(keys.map((k) => [k, rec[k]!]));
};
const contains = (outer: Moment, inner: Moment) => outer.start === null || (inner.start !== null && T.lte(outer.start, inner.start!) && T.lte(inner.end!, outer.end!));
const DOCS = Array.from({ length: 150 }, (_, i) => randomDoc(i + 1));
const QUERIES = (seed: number): [string, string][] => { const r = rng(seed * 7 + 3); return Array.from({ length: 12 }, () => [pick(r, QUERY_WORDS), pick(r, QUERY_WORDS)]); };

describe('searchFootage properties (150 random documents × 12 query pairs × 2 readers)', () => {
  it('AND: the files found by "a b" are found by "a" and by "b"; a token never adds results (each moment of "a b" is covered by one of "a")', () => {
    let nonEmpty = 0;
    DOCS.forEach((doc, i) => {
      for (const [a, b] of QUERIES(i)) for (const reader of ['owner', 'agent'] as const) {
        const ab = searchFootage(doc, `${a} ${b}`, { reader, limit: 50 }), ra = searchFootage(doc, a, { reader, limit: 50 }), rb = searchFootage(doc, b, { reader, limit: 50 });
        expect(ra.length).toBeLessThan(50);
        const filesA = new Set(ra.map((m) => m.assetId)), filesB = new Set(rb.map((m) => m.assetId));
        for (const m of ab) {
          expect(filesA.has(m.assetId) && filesB.has(m.assetId)).toBe(true);
          // covered: "a" found the whole file, or a moment of this file inside this moment (the same phrase with fewer words found, or the same pearl)
          expect(ra.some((s) => s.assetId === m.assetId && contains(s.start === null ? s : m, s.start === null ? m : s)), `${a} ${b} / ${reader}`).toBe(true);
        }
        if (ab.length) nonEmpty++;
      }
    });
    expect(nonEmpty).toBeGreaterThan(100); // the generator makes queries that find things
  });
  it('the same document in shuffled key order, or after a JSON round trip, gives the same JSON', () => {
    DOCS.forEach((doc, i) => {
      const r = rng(i + 99);
      const shuffled = { ...doc, assets: reorder(doc.assets, r), transcripts: reorder(doc.transcripts, r), people: reorder(doc.people ?? {}, r), ...(doc.sourceRanges ? { sourceRanges: reorder(doc.sourceRanges, r) } : {}) } as ProjectDocument;
      const round = JSON.parse(JSON.stringify(doc)) as ProjectDocument;
      for (const [a, b] of QUERIES(i).slice(0, 6)) for (const reader of ['owner', 'agent'] as const) {
        const want = JSON.stringify(searchFootage(doc, `${a} ${b}`, { reader }));
        expect(JSON.stringify(searchFootage(shuffled, `${a} ${b}`, { reader }))).toBe(want);
        expect(JSON.stringify(searchFootage(round, `${a} ${b}`, { reader }))).toBe(want);
      }
    });
  });
  it('an agent never gets a pearl or person source, a snippet or a label; its moments are among the owner\'s', () => {
    DOCS.forEach((doc, i) => {
      const labels = Object.values(doc.sourceRanges ?? {}).map((x) => x.label.split(' ')[1]!);
      for (const [a] of QUERIES(i)) for (const q of [a, ...PEOPLE, 'סודי0', 'סודי1']) {
        const ag = searchFootage(doc, q, { reader: 'agent', limit: 50 }), ow = searchFootage(doc, q, { reader: 'owner', limit: 50 });
        const text = JSON.stringify(ag);
        for (const l of labels) expect(text).not.toContain(l);
        for (const m of ag) {
          expect(m.sources.some((s) => s === 'pearl' || s === 'person' || s === 'picture')).toBe(false);
          expect(m.snippet).toBeUndefined();
          expect(ow.some((o) => o.assetId === m.assetId && JSON.stringify([o.start, o.end]) === JSON.stringify([m.start, m.end]))).toBe(true);
        }
      }
    });
  });
  it('transcript spans lie inside their files and use the words\' exact times', () => {
    DOCS.forEach((doc, i) => {
      for (const [a, b] of QUERIES(i)) for (const m of searchFootage(doc, `${a} ${b}`, { reader: 'owner', limit: 50 })) {
        if (m.start === null) continue;
        const dur = doc.assets[m.assetId]!.duration;
        expect(T.isNegative(m.start)).toBe(false);
        expect(T.lt(m.start, m.end!)).toBe(true);
        expect(T.lte(m.end!, dur)).toBe(true);
      }
    });
  });
});

describe('picture helpers properties', () => {
  it('sampleFrameTargets: strictly increasing, below frameCount, one per second, exact ceil(s·r)', () => {
    const r = rng(5);
    for (let t = 0; t < 300; t++) {
      const rate = r() < 0.2 ? { num: 1 + Math.floor(r() * 5), den: 1 + Math.floor(r() * 10) } : pick(r, RATES), count = Math.floor(r() * 2000);
      const k = sampleFrameTargets(rate, count);
      for (let i = 0; i < k.length; i++) { expect(k[i]!).toBeLessThan(count); if (i) expect(k[i]!).toBeGreaterThan(k[i - 1]!); }
      if (rate.num >= rate.den) k.forEach((x, s) => expect(BigInt(x)).toBe((BigInt(s) * BigInt(rate.num) + BigInt(rate.den) - 1n) / BigInt(rate.den)));
      // nothing is missed: the next second's frame would be at or past the end
      if (rate.num >= rate.den) expect((BigInt(k.length) * BigInt(rate.num) + BigInt(rate.den) - 1n) / BigInt(rate.den) >= BigInt(count)).toBe(true);
    }
  });
  it('mergePictureHits: spans inside the file, on project frame edges, outward of [first − 1 s, last + 1 s]; shuffled hits give the same answer', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 13);
      const doc = createProject({ id: 'prj_m', name: 'M' });
      const assets: Asset[] = [];
      for (let i = 0; i < 3; i++) {
        const rate = pick(r, RATES), frames = 1 + Math.floor(r() * 900);
        const a = { id: `ast_${i}`, kind: 'video', name: `v${i}.mp4`, contentHash: `sha256:${String(i).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, rate), video: { width: 64, height: 64, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov } as unknown as Asset;
        doc.assets[a.id] = a; assets.push(a);
      }
      const proj = pick(r, RATES);
      const hits: PictureHit[] = [];
      for (const a of assets) for (const f of sampleFrameTargets(a.video!.frameRate, a.video!.frameCount!)) if (r() < 0.4) hits.push({ assetId: a.id, frame: f, relevance: Math.floor(r() * 4) / 4 + 0.01 });
      const out = mergePictureHits(doc, hits, proj, 50);
      const shuffled = Object.values(reorder(Object.fromEntries(hits.map((h, i) => [`h${i}`, h])), r));
      expect(mergePictureHits(doc, shuffled, proj, 50)).toEqual(out);
      for (const m of out) {
        expect(m.sources).toEqual(['picture']);
        expect(Object.keys(m).sort()).toEqual(['assetId', 'end', 'frame', 'sources', 'start']);
        const a = doc.assets[m.assetId]!;
        if (m.start === null) { expect(T.lt(a.duration, T.frameTime(1, proj))).toBe(true); continue; }
        expect(T.isFrameAligned(m.start, proj) && T.isFrameAligned(m.end!, proj)).toBe(true);
        expect(T.isNegative(m.start)).toBe(false);
        expect(T.lte(m.end!, a.duration)).toBe(true);
        expect(T.lt(m.start, m.end!)).toBe(true);
        // the best frame lies in its moment, padded by one second each side before the snap
        const at = T.frameTime(m.frame!, a.video!.frameRate);
        expect(T.lte(m.start, T.max(T.ZERO, T.sub(at, T.rt(1, 1))))).toBe(true);
        const padded = T.min(a.duration, T.add(at, T.rt(1, 1)));
        // outward unless the file's end cut it to the last project frame edge inside the file
        expect(T.lte(padded, m.end!) || T.eq(m.end!, T.frameTime(T.frameIndexAt(a.duration, proj), proj))).toBe(true);
      }
    }
  });
});
