/**
 * The shorts fixture's truth and its pure picture and sound functions (no encoder run: generateShortsFixture is the lead's,
 * for proof:shorts). Expected values are typed here from the fixture's own definition, never from the code under test.
 */
import { describe, expect, it } from 'vitest';
// the fixture package does not depend on core; the test checks the transcript against the real operation by path
import { applyTransaction, createProject } from '../../core/src/index.ts';
import { BARCODE, readBarcode } from './index.ts';
import { EXCLUDED_WORD, FILLER_WORD, SHORTS_FIXTURE, shortsDisc, shortsFixtureTruth, shortsFrame, shortsSamples, shortsShotOf } from './shorts.ts';

const rms = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i]! * x[i]!; return Math.sqrt(s / Math.max(1, b - a)); };

describe('shorts fixture truth', () => {
  const truth = shortsFixtureTruth();
  it('holds the planted statements Q, R, X and P once each, the fillers, the two pauses and the reaction burst', () => {
    expect(truth.frames).toBe(7200);
    expect(truth.statements.filter((s) => s.tag).map((s) => s.tag)).toEqual(['Q', 'R', 'X', 'P']);
    const tag = (t: string) => truth.statements.find((s) => s.tag === t)!;
    expect(tag('Q').text.endsWith('?')).toBe(true);
    expect(tag('R').text.startsWith('אז כמו שאמרתי')).toBe(true);
    expect(tag('X').text).toContain(EXCLUDED_WORD);
    expect(truth.fillers.map((i) => truth.words[i]!.text)).toEqual([FILLER_WORD, FILLER_WORD]);
    expect(truth.pauses.map((p) => p.seconds)).toEqual([0.8, 1.5]);
    const r0 = Number(truth.reaction.start.split('/')[0]), r1 = Number(truth.reaction.end.split('/')[0]);
    expect(r1 - r0).toBe(2000);
    expect(truth.words.some((w) => w.endMs > r0 && w.startMs < r1)).toBe(false);
    expect(truth.cuts).toEqual([1500, 2700, 4200, 5700]);
  });
  it('words are in order, inside the file, exact milliseconds; every statement but the last ends with . or ?', () => {
    for (let i = 1; i < truth.words.length; i++) expect(truth.words[i]!.startMs).toBeGreaterThanOrEqual(truth.words[i - 1]!.endMs);
    expect(truth.words.at(-1)!.endMs).toBeLessThanOrEqual(240_000);
    for (const w of truth.words) expect(w.start).toBe(`${w.startMs}/1000`);
    for (const s of truth.statements) expect(/[.?]$/.test(s.text)).toBe(true);
    expect(truth.statements.length).toBeGreaterThan(30);
  });
  it('the transcript is accepted by set_transcript as it is (manual, word-timed)', () => {
    let doc = createProject({ id: 'prj_fx', name: 'fx', width: 1920, height: 1080 });
    const asset = { kind: 'video', name: 'talk.mp4', contentHash: `sha256:${'f'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: { value: '240', timescale: 1 }, video: { width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 7200 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture', importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' } };
    const r = applyTransaction(doc, [{ op: 'import_asset', args: { asset } }], { idSeed: 'fx_', actor: 'test', allowInternal: true });
    const assetId = r.results[0]!.output!.assetId as string;
    doc = applyTransaction(r.doc, [{ op: 'set_transcript', args: { assetId, ...truth.transcript } }], { idSeed: 'fy_', actor: 'test' }).doc;
    const tr = doc.transcripts[assetId]!;
    expect(tr.segments.length).toBe(truth.statements.length);
    expect(tr.segments.flatMap((s) => s.words).map((w) => w.text)).toEqual(truth.words.map((w) => w.text));
    expect(tr.segments.every((s) => s.timing === 'word')).toBe(true);
  });
});

describe('shorts fixture picture', () => {
  it('each frame carries its index; the shot colour changes exactly at the planted cuts; the disc is drawn where the truth says', () => {
    const F = SHORTS_FIXTURE, W = F.width, H = F.height;
    const strip = Math.round(H * BARCODE.stripFrac);
    for (const f of [0, 1499, 1500, 5701]) {
      const px = shortsFrame(f);
      expect(readBarcode(px, W, 3, { x: 0, y: 0, w: W, h: H })).toBe(f);
      const d = shortsDisc(f);
      const at = (x: number, y: number) => [...px.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
      expect(at(Math.floor(d.cx), Math.floor(d.cy))).toEqual([255, 255, 255]);
      expect(at(5, H - 5)).toEqual([...F.shots[shortsShotOf(f)]!]);
      expect(d.cy - d.r).toBeGreaterThan(strip);
    }
    expect([1499, 1500, 2699, 2700].map(shortsShotOf)).toEqual([0, 1, 1, 2]);
  });
});

describe('shorts fixture sound', () => {
  const truth = shortsFixtureTruth(150);
  const x = shortsSamples(truth);
  const sr = SHORTS_FIXTURE.sampleRate;
  const span = (aMs: number, bMs: number): [number, number] => [Math.round((aMs * sr) / 1000), Math.round((bMs * sr) / 1000)];
  it('the words of Q are 6.02 dB louder than the others; pauses are silent; the reaction burst is loud', () => {
    const q = truth.statements.find((s) => s.tag === 'Q')!;
    const other = truth.statements.find((s) => !s.tag)!;
    const level = (s: typeof q) => rms(x, ...span(truth.words[s.firstWord]!.startMs + 10, truth.words[s.firstWord]!.endMs - 10));
    expect(20 * Math.log10(level(q) / level(other))).toBeGreaterThan(5.5);
    expect(20 * Math.log10(level(q) / level(other))).toBeLessThan(6.5);
    for (const p of truth.pauses) expect(rms(x, ...span(Number(p.start.split('/')[0]), Number(p.end.split('/')[0])))).toBe(0);
    expect(rms(x, ...span(Number(truth.reaction.start.split('/')[0]) + 10, Number(truth.reaction.end.split('/')[0]) - 10))).toBeGreaterThan(0.1);
  });
});
