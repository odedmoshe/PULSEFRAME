/**
 * Pacing report: the rhythm of the cut along the main timeline, measured from what is already in the document
 * (clip boundaries, word-timed transcripts, caption cues). Pure; no audio or picture analysis, no model.
 * Window boundaries are exact multiples of the window length; counts use half-open `[start, end)` windows.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import { clipEnd, sequenceDuration } from './validate.ts';
import { sourceEnd, timelineOfSource } from './speed.ts';

export interface PacingOptions { windowSeconds?: number; staticSeconds?: number; maxCharsPerSecond?: number; maxWordsPerSecond?: number; maxCutsPerWindow?: number; silenceSeconds?: number }
export interface PacingWindow { start: T.RationalTime; end: T.RationalTime; cuts: number; words: number; wordsPerSecond: number; captionChars: number; charsPerSecond: number }
export interface PacingIssue { code: 'static_picture' | 'rapid_cuts' | 'dense_speech' | 'fast_captions' | 'speech_gap'; start: T.RationalTime; end: T.RationalTime; value: number; limit: number; clipIds: string[] }
export interface PacingReport { duration: T.RationalTime; windows: PacingWindow[]; issues: PacingIssue[]; totals: { cuts: number; words: number; cutsPerMinute: number; wordsPerMinute: number } }

const key = (t: T.RationalTime) => { const n = T.normalize(t); return `${n.value}/${n.timescale}`; };
const chars = (s: string) => s.replace(/\s/gu, '').length;
const ORDER: Record<PacingIssue['code'], number> = { static_picture: 0, rapid_cuts: 1, dense_speech: 2, fast_captions: 3, speech_gap: 4 };

export function pacingReport(doc: ProjectDocument, opts: PacingOptions = {}): PacingReport {
  const windowSeconds = opts.windowSeconds ?? 5, staticSeconds = opts.staticSeconds ?? 8, maxCps = opts.maxCharsPerSecond ?? 20;
  const maxWps = opts.maxWordsPerSecond ?? 4.5, maxCuts = opts.maxCutsPerWindow ?? 8, silenceSeconds = opts.silenceSeconds ?? 3;
  const duration = sequenceDuration(doc);
  const seq = doc.sequences[doc.mainSequenceId];
  const zeroTotals = { cuts: 0, words: 0, cutsPerMinute: 0, wordsPerMinute: 0 };
  if (!seq || !T.lt(T.ZERO, duration)) return { duration, windows: [], issues: [], totals: zeroTotals };

  // Exact window grid: window k starts at k * W.
  const W = T.normalize(T.fromSeconds(windowSeconds > 0 ? windowSeconds : 5));
  const wv = BigInt(W.value);
  const at = (k: number) => T.normalize(T.rt(wv * BigInt(k), W.timescale));
  const indexOf = (t: T.RationalTime) => Number((BigInt(t.value) * BigInt(W.timescale)) / (BigInt(t.timescale) * wv));
  const count = indexOf(duration) + (T.eq(at(indexOf(duration)), duration) ? 0 : 1);
  const bounds = Array.from({ length: count }, (_, k) => ({ start: at(k), end: T.min(at(k + 1), duration) }));
  const cuts = new Array<number>(count).fill(0), words = new Array<number>(count).fill(0), capChars = new Array<number>(count).fill(0);
  const bucket = (t: T.RationalTime) => (T.isNegative(t) || !T.lt(t, duration) ? -1 : Math.min(count - 1, indexOf(t)));

  // Cuts: distinct clip start times > 0 on video tracks.
  const cutTimes = new Map<string, T.RationalTime>();
  const picture: { id: string; start: T.RationalTime; end: T.RationalTime }[] = [];
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video') continue;
    for (const c of tr.clips) {
      if (c.type === 'media') picture.push({ id: c.id, start: c.start, end: clipEnd(c) });
      if (T.lt(T.ZERO, c.start)) cutTimes.set(key(c.start), c.start);
    }
  }
  const cutList = [...cutTimes.values()].sort(T.cmp);
  for (const t of cutList) { const b = bucket(t); if (b >= 0) cuts[b]!++; }

  // Words: each word once per place it plays (a linked picture + sound pair plays it at one place).
  const hasTranscriptCaptions = seq.tracks.some((t) => t.kind === 'caption' && t.caption?.mode === 'transcript');
  const placed = new Map<string, { at: T.RationalTime; chars: number }>();
  const gaps = new Map<string, { start: T.RationalTime; end: T.RationalTime; clipIds: string[] }>();
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video' && tr.kind !== 'audio') continue;
    for (const c of tr.clips) {
      if (c.type !== 'media') continue;
      const tx = doc.transcripts?.[c.assetId];
      if (!tx) continue;
      const srcEnd = sourceEnd(c), cEnd = clipEnd(c);
      const spans: { start: T.RationalTime; end: T.RationalTime }[] = [];
      for (const seg of tx.segments) {
        if (seg.timing !== 'word') continue;
        for (const w of seg.words) {
          if (T.lt(w.start, c.sourceIn) || !T.lt(w.start, srcEnd)) continue;
          const s = timelineOfSource(c, w.start);
          placed.set(`${w.id}@${key(s)}`, { at: s, chars: chars(w.text) });
          const e = timelineOfSource(c, T.add(w.start, w.duration));
          const lo = T.min(s, e), hi = T.min(T.max(s, e), cEnd);
          spans.push({ start: lo, end: T.max(lo, hi) });
        }
      }
      spans.sort((a, b) => T.cmp(a.start, b.start));
      for (let i = 1; i < spans.length; i++) {
        const from = spans[i - 1]!.end, to = spans[i]!.start;
        if (!T.lt(from, to)) continue;
        const k = `${key(from)}-${key(to)}`, g = gaps.get(k);
        if (g) g.clipIds.push(c.id); else gaps.set(k, { start: from, end: to, clipIds: [c.id] });
      }
    }
  }
  let totalWords = 0;
  for (const p of placed.values()) {
    const b = bucket(p.at);
    if (b < 0) continue;
    words[b]!++; totalWords++;
    if (hasTranscriptCaptions) capChars[b]! += p.chars;
  }

  // Manual caption cues.
  const cues: { id: string; start: T.RationalTime; duration: T.RationalTime; chars: number }[] = [];
  for (const tr of seq.tracks) for (const c of tr.clips) if (c.type === 'caption') cues.push({ id: c.id, start: c.start, duration: c.duration, chars: chars(c.text) });
  for (const q of cues) { const b = bucket(q.start); if (b >= 0) capChars[b]! += q.chars; }

  const windows: PacingWindow[] = bounds.map((b, k) => {
    const len = T.toSeconds(T.sub(b.end, b.start));
    return { start: b.start, end: b.end, cuts: cuts[k]!, words: words[k]!, wordsPerSecond: words[k]! / len, captionChars: capChars[k]!, charsPerSecond: capChars[k]! / len };
  });

  const issues: PacingIssue[] = [];
  const playingAt = (t: T.RationalTime) => picture.filter((p) => !T.lt(t, p.start) && T.lt(t, p.end)).map((p) => p.id);
  if (picture.length) {
    const edges = [T.ZERO, ...cutList.filter((t) => T.lt(t, duration)), duration];
    const limit = T.fromSeconds(staticSeconds);
    for (let i = 1; i < edges.length; i++) {
      const len = T.sub(edges[i]!, edges[i - 1]!);
      if (T.lte(limit, len) && T.lt(T.ZERO, len)) issues.push({ code: 'static_picture', start: edges[i - 1]!, end: edges[i]!, value: T.toSeconds(len), limit: staticSeconds, clipIds: playingAt(edges[i - 1]!) });
    }
  }
  windows.forEach((w) => {
    if (w.cuts > maxCuts) issues.push({ code: 'rapid_cuts', start: w.start, end: w.end, value: w.cuts, limit: maxCuts, clipIds: picture.filter((p) => T.lt(p.start, w.end) && T.lt(w.start, p.end)).map((p) => p.id) });
    if (w.wordsPerSecond > maxWps) issues.push({ code: 'dense_speech', start: w.start, end: w.end, value: w.wordsPerSecond, limit: maxWps, clipIds: [] });
  });
  for (const q of cues) {
    if (!T.lt(T.ZERO, q.duration)) continue;
    const cps = q.chars / T.toSeconds(q.duration);
    if (cps > maxCps) issues.push({ code: 'fast_captions', start: q.start, end: T.add(q.start, q.duration), value: cps, limit: maxCps, clipIds: [q.id] });
  }
  const gapLimit = T.fromSeconds(silenceSeconds);
  for (const g of gaps.values()) {
    const len = T.sub(g.end, g.start);
    if (T.lte(gapLimit, len)) issues.push({ code: 'speech_gap', start: g.start, end: g.end, value: T.toSeconds(len), limit: silenceSeconds, clipIds: g.clipIds });
  }
  issues.sort((a, b) => T.cmp(a.start, b.start) || ORDER[a.code] - ORDER[b.code]);

  const minutes = T.toSeconds(duration) / 60;
  return { duration, windows, issues, totals: { cuts: cutList.filter((t) => bucket(t) >= 0).length, words: totalWords, cutsPerMinute: cutList.length / minutes, wordsPerMinute: totalWords / minutes } };
}
