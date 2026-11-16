import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, pacingReport, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (frames: number) => T.frameTime(frames, R);
const s = (seconds: number) => f(Math.round(seconds * 30));
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `p${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: hash('b'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(300, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 9000 }, provenance: prov };
const voice = { kind: 'audio' as const, name: 'a.wav', contentHash: hash('a'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(300, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };

/** A project with one silent picture asset and one sound asset; helpers add clips, cues and words. */
function setup() {
  let r = tx(createProject({ id: 'prj_p', name: 'P' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: voice } }], true);
  const vid = r.results[0]!.output!.assetId as string, aud = r.results[1]!.output!.assetId as string;
  let doc = r.doc;
  const run = (ops: OpCall[], internal = false) => { r = tx(doc, ops, internal); doc = r.doc; return r.results.map((x) => x.output as any); };
  const picture = (start: number, dur: number, trackId?: string) => run([{ op: 'add_clip', args: { assetId: vid, start: s(start), duration: s(dur), ...(trackId ? { trackId } : {}) } }])[0].clipId as string;
  const sound = (start: number, dur: number, sourceIn = 0) => run([{ op: 'add_clip', args: { assetId: aud, start: s(start), duration: s(dur), sourceIn: s(sourceIn) } }])[0].clipId as string;
  /** `times` are source seconds; each word lasts `len` seconds. */
  const words = (times: number[], len = 0.2) => run([{ op: 'set_transcript', args: { assetId: aud, language: 'en', segments: [{ start: s(times[0]!), duration: s(times[times.length - 1]! + len - times[0]!), text: times.map((_, i) => `w${i}`).join(' '), words: times.map((t, i) => ({ text: `w${i}`, start: s(t), duration: s(len) })) }] } }]);
  const cue = (start: number, dur: number, text: string) => run([{ op: 'add_cue', args: { start: s(start), duration: s(dur), text } }]);
  return { get doc() { return doc; }, run, picture, sound, words, cue };
}

describe('pacingReport windows and cuts', () => {
  it('empty project: no windows, no issues, zeros, no NaN', () => {
    const r = pacingReport(createProject({ id: 'prj_e', name: 'E' }));
    expect(r.windows).toEqual([]); expect(r.issues).toEqual([]);
    expect(r.totals).toEqual({ cuts: 0, words: 0, cutsPerMinute: 0, wordsPerMinute: 0 });
  });
  it('window boundaries are exact when the duration is not a multiple of the window', () => {
    const p = setup(); p.picture(0, 12.5);
    const r = pacingReport(p.doc);
    expect(r.windows.map((w) => [T.toSeconds(w.start), T.toSeconds(w.end)])).toEqual([[0, 5], [5, 10], [10, 12.5]]);
    expect(T.eq(r.windows[2]!.end, r.duration)).toBe(true);
    expect(T.eq(r.windows[1]!.end, r.windows[2]!.start)).toBe(true);
    // 1/3 s windows stay exact (no float stepping)
    const third = pacingReport(p.doc, { windowSeconds: 0.333333 });
    for (let i = 1; i < third.windows.length; i++) expect(T.eq(third.windows[i - 1]!.end, third.windows[i]!.start)).toBe(true);
  });
  it('counts cuts per window, half-open, and simultaneous starts on two video tracks once', () => {
    const p = setup();
    const track2 = p.run([{ op: 'add_track', args: { kind: 'video' } }])[0].trackId as string;
    p.picture(0, 5); p.picture(5, 2); p.picture(7, 5); // cut at 5 belongs to window 1 (not 0)
    p.picture(5, 3, track2); // same start as an existing cut
    p.picture(10, 1, track2);
    const r = pacingReport(p.doc);
    expect(r.windows.map((w) => w.cuts)).toEqual([0, 2, 1]);
    expect(r.totals.cuts).toBe(3);
    expect(r.totals.cutsPerMinute).toBeCloseTo(3 / (12 / 60), 6);
  });
});

describe('pacingReport words and captions', () => {
  it('maps words through a trimmed clip and a moved clip, once per place they play', () => {
    const p = setup();
    p.picture(0, 20);
    p.words([1, 3, 5, 7]);
    p.sound(10, 4, 2); // plays source 2..6: words at 3 and 5 -> timeline 11 and 13
    p.sound(0, 2, 0);  // plays source 0..2: word at 1 -> timeline 1
    const r = pacingReport(p.doc);
    expect(r.totals.words).toBe(3);
    expect(r.windows.map((w) => w.words)).toEqual([1, 0, 2, 0]);
    expect(r.windows[0]!.wordsPerSecond).toBeCloseTo(1 / 5, 9);
  });
  it('counts caption characters from manual cues and, with a transcript caption track, from words', () => {
    const p = setup();
    p.picture(0, 10); p.sound(0, 10); p.words([1]);
    p.cue(6, 3, 'ab cd');
    expect(pacingReport(p.doc).windows.map((w) => w.captionChars)).toEqual([0, 4]);
    p.run([{ op: 'add_caption_track', args: { mode: 'transcript' } }]);
    expect(pacingReport(p.doc).windows.map((w) => w.captionChars)).toEqual([2, 4]); // "w0"
  });
});

describe('pacingReport issues fire exactly when the limit is crossed', () => {
  it('static_picture: at least staticSeconds between cuts, from 0, and to the end', () => {
    const p = setup(); p.picture(0, 8); p.picture(8, 7.9);
    const at = (opts = {}) => pacingReport(p.doc, opts).issues.filter((i) => i.code === 'static_picture');
    const hit = at();
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ value: 8, limit: 8 });
    expect([T.toSeconds(hit[0]!.start), T.toSeconds(hit[0]!.end)]).toEqual([0, 8]);
    expect(hit[0]!.clipIds).toHaveLength(1);
    expect(at({ staticSeconds: 8.1 })).toHaveLength(0);
    expect(at({ staticSeconds: 7.9 })).toHaveLength(2);
    expect(pacingReport(createProject({ id: 'prj_x', name: 'X' })).issues).toEqual([]);
  });
  it('rapid_cuts: more than maxCutsPerWindow, not at the limit', () => {
    const p = setup();
    for (let i = 0; i < 5; i++) p.picture(i, 1); // cuts at 1..4 -> 4 in window 0
    const code = (max: number) => pacingReport(p.doc, { maxCutsPerWindow: max, staticSeconds: 999 }).issues.filter((i) => i.code === 'rapid_cuts');
    expect(code(4)).toHaveLength(0);
    const hit = code(3);
    expect(hit).toHaveLength(1); expect(hit[0]).toMatchObject({ value: 4, limit: 3 });
  });
  it('dense_speech: words per second above the limit, not at it', () => {
    const p = setup(); p.picture(0, 10); p.sound(0, 10);
    p.words([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]); // 10 words in a 5 s window = 2 wps
    const dense = (max: number) => pacingReport(p.doc, { maxWordsPerSecond: max }).issues.filter((i) => i.code === 'dense_speech');
    expect(dense(2)).toHaveLength(0);
    expect(dense(1.9)).toHaveLength(1);
  });
  it('fast_captions: characters per second above the limit, not at it', () => {
    const p = setup(); p.picture(0, 5); p.cue(0, 2, 'abcdefghij'); // 5 cps
    const fast = (max: number) => pacingReport(p.doc, { maxCharsPerSecond: max }).issues.filter((i) => i.code === 'fast_captions');
    expect(fast(5)).toHaveLength(0);
    const hit = fast(4.9);
    expect(hit).toHaveLength(1); expect(hit[0]!.clipIds).toHaveLength(1); expect(hit[0]!.value).toBe(5);
  });
  it('speech_gap: end of a word to the start of the next, as played, at least silenceSeconds', () => {
    const p = setup(); p.picture(0, 12); p.sound(0, 12);
    p.words([1, 4.2], 0.2); // word 1 ends 1.2, next starts 4.2 -> gap 3
    const gap = (sec: number) => pacingReport(p.doc, { silenceSeconds: sec }).issues.filter((i) => i.code === 'speech_gap');
    const hit = gap(3);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ value: 3, limit: 3 });
    expect([T.toSeconds(hit[0]!.start), T.toSeconds(hit[0]!.end)]).toEqual([1.2, 4.2]);
    expect(gap(3.1)).toHaveLength(0);
  });
  it('issues are sorted by start time', () => {
    const p = setup(); p.picture(0, 9); p.sound(0, 9); p.words([0, 4]); p.cue(6, 1, 'x'.repeat(30));
    const starts = pacingReport(p.doc, { silenceSeconds: 1 }).issues.map((i) => T.toSeconds(i.start));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts.length).toBeGreaterThan(2);
  });
});

describe('pacingReport properties', () => {
  it('window cuts sum to totals.cuts and windows tile the duration', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 12 }), (gaps, win) => {
      const p = setup();
      let t = 0;
      p.picture(0, 1);
      for (const g of gaps) { t += g; p.picture(t, 1); }
      const r = pacingReport(p.doc, { windowSeconds: win });
      expect(r.windows.reduce((a, w) => a + w.cuts, 0)).toBe(r.totals.cuts);
      expect(T.eq(r.windows[0]!.start, T.ZERO)).toBe(true);
      expect(T.eq(r.windows[r.windows.length - 1]!.end, r.duration)).toBe(true);
      for (let i = 1; i < r.windows.length; i++) expect(T.eq(r.windows[i - 1]!.end, r.windows[i]!.start)).toBe(true);
      for (const w of r.windows) expect(T.lt(w.start, w.end)).toBe(true);
    }), { numRuns: 40 });
  });
});
