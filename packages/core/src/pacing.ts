/**
 * Pacing report: the rhythm of the cut along the main timeline, measured from what is already in the document
 * (clip boundaries, word-timed transcripts, caption cues). Pure; no audio or picture analysis, no model.
 * Window boundaries are exact multiples of the window length; counts use half-open `[start, end)` windows.
 *
 * Cost: the words of a transcript are put in order once per asset, each clip finds the first word of its source span by
 * binary search and walks only the words it plays, and a word is placed by ordinary seconds arithmetic. Every decision that
 * could fall either way (a word on a clip edge, a word on a window boundary, the same word played twice at one place, a
 * pause right at the limit) is settled with exact rational time, so the result is the same as an all-exact count.
 */
import * as T from '@pulseframe/time';
import type { MediaClip, ProjectDocument } from './schema.ts';
import { clipEnd, sequenceDuration } from './validate.ts';
import { isRamped, sourceEnd, speedOf, timelineOfSource } from './speed.ts';
import { transcriptFor, untimedCopyFinder } from './lineage.ts';
import type { SkippedClip } from './cleanup.ts';

export interface PacingOptions { windowSeconds?: number; staticSeconds?: number; maxCharsPerSecond?: number; maxWordsPerSecond?: number; maxCutsPerWindow?: number; silenceSeconds?: number }
export interface PacingWindow { start: T.RationalTime; end: T.RationalTime; cuts: number; words: number; wordsPerSecond: number; captionChars: number; charsPerSecond: number }
export interface PacingIssue { code: 'static_picture' | 'rapid_cuts' | 'dense_speech' | 'fast_captions' | 'speech_gap'; start: T.RationalTime; end: T.RationalTime; value: number; limit: number; clipIds: string[] }
export interface PacingReport {
  duration: T.RationalTime; windows: PacingWindow[]; issues: PacingIssue[]; totals: { cuts: number; words: number; cutsPerMinute: number; wordsPerMinute: number };
  /**
   * Clips whose words are NOT in the counts because they show a copy of a word-timed recording made without a recorded time mapping
   * (a reversed, stretched or generated rendition; lineage.ts timingRelations 'untimed'): where its words play is unknown. Named as
   * the other edits by a recording's times name them (cleanup.ts SkippedClip); a picture and its linked sound are two entries.
   */
  skippedClips: SkippedClip[];
}

const key = (t: T.RationalTime) => { const n = T.normalize(t); return `${n.value}/${n.timescale}`; };
const chars = (s: string) => s.replace(/\s/gu, '').length;
const ORDER: Record<PacingIssue['code'], number> = { static_picture: 0, rapid_cuts: 1, dense_speech: 2, fast_captions: 3, speech_gap: 4 };
/**
 * Seconds arithmetic on times of this size is off by far less than a nanosecond. Two results further apart than EPS are
 * therefore in the order the numbers say; anything closer is compared exactly.
 */
const EPS = 1e-6;
interface TimedWord { id: string; text: string; start: T.RationalTime; duration: T.RationalTime; sec: number; len: number }
interface Span { start: T.RationalTime; end: T.RationalTime }

export function pacingReport(doc: ProjectDocument, opts: PacingOptions = {}): PacingReport {
  const windowSeconds = opts.windowSeconds ?? 5, staticSeconds = opts.staticSeconds ?? 8, maxCps = opts.maxCharsPerSecond ?? 20;
  const maxWps = opts.maxWordsPerSecond ?? 4.5, maxCuts = opts.maxCutsPerWindow ?? 8, silenceSeconds = opts.silenceSeconds ?? 3;
  const duration = sequenceDuration(doc);
  const seq = doc.sequences[doc.mainSequenceId];
  const zeroTotals = { cuts: 0, words: 0, cutsPerMinute: 0, wordsPerMinute: 0 };
  if (!seq || !T.lt(T.ZERO, duration)) return { duration, windows: [], issues: [], totals: zeroTotals, skippedClips: [] };

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
  // The word-timed words of an asset in order of their start, built once however many clips use the asset. A time-preserving copy
  // (an enhanced picture, a cleaned-up voice) has the words of the recording it was made from, moved exactly onto its own clock.
  // A copy made without a recorded time mapping has none: where its words are is unknown, so they are not counted.
  const byStart = (a: TimedWord, b: TimedWord) => a.sec - b.sec || T.cmp(a.start, b.start); // seconds never reverse the exact order; equal seconds are compared exactly
  const index = new Map<string, TimedWord[] | null>();
  const wordsOf = (assetId: string) => {
    let list = index.get(assetId);
    if (list !== undefined) return list;
    const found = transcriptFor(doc, assetId);
    list = null;
    if (found) {
      list = [];
      const shift = !T.isZero(found.offset);
      for (const seg of found.transcript.segments) if (seg.timing === 'word') for (const w of seg.words) { const start = shift ? T.sub(w.start, found.offset) : w.start; list.push({ id: w.id, text: w.text, start, duration: w.duration, sec: T.toSeconds(start), len: T.toSeconds(w.duration) }); }
      for (let i = 1; i < list.length; i++) if (byStart(list[i - 1]!, list[i]!) > 0) { list.sort(byStart); break; }
    }
    index.set(assetId, list);
    return list;
  };
  interface Placed { clip: MediaClip; word: TimedWord; sec: number; at?: T.RationalTime }
  const exactAt = (p: Placed) => (p.at ??= timelineOfSource(p.clip, p.word.start));
  const placed = new Map<string, Placed[]>(); // by word id: the places that word plays
  const gaps = new Map<string, { start: T.RationalTime; end: T.RationalTime; clipIds: string[] }>();
  const gapLimit = T.fromSeconds(silenceSeconds), gapSeconds = T.toSeconds(gapLimit);
  // Clips that play the same stretch of the same asset at the same place in the same way (a picture and its linked sound)
  // place the same words at the same times: the words are walked once, and the pauses found get every such clip's id.
  const sameAs = new Map<string, { start: T.RationalTime; end: T.RationalTime; clipIds: string[] }[]>();
  const wordless: MediaClip[] = []; // clips whose file has no words by lineage: unrelated to any transcript, or an untimed copy of one
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video' && tr.kind !== 'audio') continue;
    for (const c of tr.clips) {
      if (c.type !== 'media') continue;
      const list = wordsOf(c.assetId);
      if (!list) { if (!c.freeze) wordless.push(c); continue; } // a freeze frame plays no time: never in the way
      const signature = JSON.stringify([c.assetId, key(c.start), key(c.duration), key(c.sourceIn), c.speed, c.speedEnd, c.speedCurve, c.rampWindow && [key(c.rampWindow.offset), key(c.rampWindow.total)], !!c.reverse, !!c.freeze]);
      const seen = sameAs.get(signature);
      if (seen) { for (const g of seen) g.clipIds.push(c.id); continue; }
      const found: { start: T.RationalTime; end: T.RationalTime; clipIds: string[] }[] = [];
      sameAs.set(signature, found);
      const srcEnd = sourceEnd(c), cEnd = clipEnd(c);
      const inSec = T.toSeconds(c.sourceIn), endSec = T.toSeconds(srcEnd), startSec = T.toSeconds(c.start), cEndSec = T.toSeconds(cEnd);
      // Where a source time plays on the timeline, in seconds. One speed: plain arithmetic. A gradual speed change has no
      // closed form here, so those clips keep the exact (slower) conversion for each of their words.
      const ramped = isRamped(c), sp = speedOf(c), perSource = sp.den / sp.num;
      const secOf = (src: number) => startSec + (c.reverse ? endSec - src : src - inSec) * perSource;
      const exactSpan = (w: TimedWord): Span => {
        const s = timelineOfSource(c, w.start), e = timelineOfSource(c, T.add(w.start, w.duration));
        const lo = T.min(s, e), hi = T.min(T.max(s, e), cEnd);
        return { start: lo, end: T.max(lo, hi) };
      };
      // first word that starts at or after the clip's source in-point
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid]!.sec < inSec) lo = mid + 1; else hi = mid; }
      while (lo < list.length && list[lo]!.sec === inSec && T.lt(list[lo]!.start, c.sourceIn)) lo++;
      const spans: { lo: number; hi: number; word: TimedWord; exact?: Span }[] = [];
      for (let i = lo; i < list.length; i++) {
        const w = list[i]!;
        if (w.sec > endSec || (w.sec === endSec && !T.lt(w.start, srcEnd))) break; // starts at or after the end of the clip's source span
        let p: Placed, from: number, to: number, exact: Span | undefined;
        if (ramped) {
          exact = exactSpan(w);
          const at = timelineOfSource(c, w.start);
          p = { clip: c, word: w, sec: T.toSeconds(at), at };
          from = T.toSeconds(exact.start); to = T.toSeconds(exact.end);
        } else {
          const s = secOf(w.sec), e = secOf(w.sec + w.len);
          p = { clip: c, word: w, sec: s };
          from = Math.min(s, e); to = Math.max(from, Math.min(Math.max(s, e), cEndSec));
        }
        // the same word at the same place through another clip counts once
        const places = placed.get(w.id);
        if (!places) placed.set(w.id, [p]);
        else if (!places.some((q) => Math.abs(q.sec - p.sec) <= EPS && T.eq(exactAt(q), exactAt(p)))) places.push(p);
        spans.push(exact ? { lo: from, hi: to, word: w, exact } : { lo: from, hi: to, word: w });
      }
      // Pauses: from the end of one word to the start of the next, in the order they play. Only a pause that can reach the
      // limit is worked out exactly.
      const exactOf = (x: (typeof spans)[number]) => (x.exact ??= exactSpan(x.word));
      const byPlay = (a: (typeof spans)[number], b: (typeof spans)[number]) => (Math.abs(a.lo - b.lo) > EPS ? a.lo - b.lo : T.cmp(exactOf(a).start, exactOf(b).start));
      for (let i = 1; i < spans.length; i++) if (byPlay(spans[i - 1]!, spans[i]!) > 0) { spans.sort(byPlay); break; }
      for (let i = 1; i < spans.length; i++) {
        if (spans[i]!.lo - spans[i - 1]!.hi < gapSeconds - EPS) continue;
        const from = exactOf(spans[i - 1]!).end, to = exactOf(spans[i]!).start;
        if (!T.lt(from, to)) continue;
        const k = `${key(from)}-${key(to)}`;
        let g = gaps.get(k);
        if (g) g.clipIds.push(c.id); else { g = { start: from, end: to, clipIds: [c.id] }; gaps.set(k, g); }
        found.push(g);
      }
    }
  }
  // Which window a word falls in: by seconds, except next to a window boundary or the end, where the exact time decides.
  const windowSec = T.toSeconds(W), durationSec = T.toSeconds(duration);
  let totalWords = 0;
  for (const places of placed.values()) {
    for (const p of places) {
      const x = p.sec / windowSec;
      const b = Math.abs(p.sec - Math.round(x) * windowSec) <= EPS || Math.abs(p.sec - durationSec) <= EPS ? bucket(exactAt(p))
        : p.sec < 0 || p.sec > durationSec ? -1 : Math.min(count - 1, Math.floor(x));
      if (b < 0) continue;
      words[b]!++; totalWords++;
      if (hasTranscriptCaptions) capChars[b]! += chars(p.word.text);
    }
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
    // The last window can be a short remainder, where a couple of words make a high rate out of a fraction of a second:
    // a window shorter than half the window length is not judged for dense speech (its rate is still reported).
    const len = T.sub(w.end, w.start);
    if (w.wordsPerSecond > maxWps && T.lte(W, T.add(len, len))) issues.push({ code: 'dense_speech', start: w.start, end: w.end, value: w.wordsPerSecond, limit: maxWps, clipIds: [] });
  });
  for (const q of cues) {
    if (!T.lt(T.ZERO, q.duration)) continue;
    const cps = q.chars / T.toSeconds(q.duration);
    if (cps > maxCps) issues.push({ code: 'fast_captions', start: q.start, end: T.add(q.start, q.duration), value: cps, limit: maxCps, clipIds: [q.id] });
  }
  for (const g of gaps.values()) {
    const len = T.sub(g.end, g.start);
    if (T.lte(gapLimit, len)) issues.push({ code: 'speech_gap', start: g.start, end: g.end, value: T.toSeconds(len), limit: silenceSeconds, clipIds: g.clipIds });
  }
  issues.sort((a, b) => T.cmp(a.start, b.start) || ORDER[a.code] - ORDER[b.code]);

  // The clips left out because they show an untimed copy of a word-timed recording, by name (never guessed onto the timeline).
  const worded = wordless.length ? Object.keys(doc.transcripts ?? {}).filter((id) => doc.transcripts[id]!.segments.some((s) => s.timing === 'word' && s.words.length)) : [];
  const untimedOf = untimedCopyFinder(doc, worded);
  const skippedClips: SkippedClip[] = wordless.filter((c) => untimedOf(c.assetId)).map((c) => ({ clipId: c.id, assetId: c.assetId, reason: 'untimed_copy' as const }));

  const minutes = T.toSeconds(duration) / 60;
  return { duration, windows, issues, skippedClips, totals: { cuts: cutList.filter((t) => bucket(t) >= 0).length, words: totalWords, cutsPerMinute: cutList.length / minutes, wordsPerMinute: totalWords / minutes } };
}
