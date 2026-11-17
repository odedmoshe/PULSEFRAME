/**
 * Caption evaluation and layout (SPEC §16). Pure: no DOM, no I/O.
 *
 * Transcript captions are derived at render time from SOURCE time: timeline time -> playing clip ->
 * source time -> phrase/word. Nothing is re-timed when the edit changes, so captions cannot drift from a cut.
 */
import * as T from '@pulseframe/time';
import { sourceAt, sourceEnd, timelineAt, transcriptFor, type CaptionStyle, type ProjectDocument, type Segment, type Sequence, type Track, type Transcript } from '@pulseframe/core';

export type WordState = 'past' | 'current' | 'future' | 'plain';
export interface CaptionLayer {
  kind: 'caption';
  trackId: string;
  /** Cue clip id (manual) or transcript phrase id. */
  sourceId: string;
  style: CaptionStyle;
  /** Words of the page being shown, in reading (logical) order. `plain` = no per-word timing available. */
  /** `since`: seconds since the word started being spoken (only for words that have started less than a second ago, and only when the style animates word entrances). */
  words: { text: string; state: WordState; since?: number }[];
}

const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

/** Greedy split of words into pages of at most `capacity` characters (a single longer word gets its own page). */
export function captionPages(words: string[], capacity: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [], used = 0;
  words.forEach((w, i) => {
    const need = (cur.length ? 1 : 0) + w.length;
    if (cur.length && used + need > capacity) { pages.push(cur); cur = []; used = 0; }
    used += (cur.length ? 1 : 0) + w.length;
    cur.push(i);
  });
  if (cur.length) pages.push(cur);
  return pages;
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
type Dir = 'rtl' | 'ltr';
/** Direction of a word from its first strong characters: rtl if it has any right-to-left letter, ltr if it has Latin letters, null for digits and symbols only. */
export const wordDir = (w: string): Dir | null => (RTL.test(w) ? 'rtl' : LTR.test(w) ? 'ltr' : null);

/**
 * Word-level visual order for one line (left to right on screen), a word-granular form of UAX #9:
 * words run in the base direction; a run of opposite-direction words keeps its own internal order.
 * Words without letters (numbers, symbols) join the opposite-direction run only when they sit inside one.
 */
export function visualOrder(words: string[], base: Dir): number[] {
  const dirs = words.map(wordDir);
  const resolved: Dir[] = dirs.map((d, i) => {
    if (d) return d;
    let p = i - 1, n = i + 1;
    while (p >= 0 && !dirs[p]) p--;
    while (n < dirs.length && !dirs[n]) n++;
    return p >= 0 && n < dirs.length && dirs[p] === dirs[n] ? dirs[p]! : base;
  });
  // Start from the base direction (rtl: last word leftmost), then restore the internal order of opposite-direction runs.
  const order = words.map((_, i) => i);
  if (base === 'rtl') order.reverse();
  const opposite: Dir = base === 'rtl' ? 'ltr' : 'rtl';
  for (let i = 0; i < order.length; ) {
    if (resolved[order[i]!] !== opposite) { i++; continue; }
    let j = i;
    while (j < order.length && resolved[order[j]!] === opposite) j++;
    for (let a = i, b = j - 1; a < b; a++, b--) [order[a], order[b]] = [order[b]!, order[a]!];
    i = j;
  }
  return order;
}

/** Greedy line breaking in logical order. Words are never split; an over-long word gets its own line. */
export function wrapWords(widths: number[], spaceWidth: number, maxWidth: number): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [], w = 0;
  widths.forEach((ww, i) => {
    const need = (cur.length ? spaceWidth : 0) + ww;
    if (cur.length && w + need > maxWidth) { lines.push(cur); cur = []; w = 0; }
    w += (cur.length ? spaceWidth : 0) + ww;
    cur.push(i);
  });
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * The transcript that describes a clip's speech and the offset of the clip's file on its clock (ADR-0017 time lineage): a derived copy
 * that keeps the timing of its source (an enhanced picture, a cleaned voice) speaks the source's transcript. Cached per call.
 */
type Spoken = { transcript: Transcript; offset: T.RationalTime } | null;
const spokenBy = (doc: ProjectDocument, cache: Map<string, Spoken>, assetId: string): Spoken => {
  let s = cache.get(assetId);
  if (s === undefined) { s = transcriptFor(doc, assetId); cache.set(assetId, s); }
  return s;
};
/** The clips of `src` that speak the same transcript, with the stretch of it each one plays (on the transcript's clock). */
const spokenSpans = (doc: ProjectDocument, cache: Map<string, Spoken>, src: Track, transcript: Transcript) => {
  const out: { from: T.RationalTime; to: T.RationalTime }[] = [];
  for (const c of src.clips) {
    if (c.type !== 'media' || c.reverse) continue;
    const s = spokenBy(doc, cache, c.assetId);
    if (s?.transcript !== transcript) continue;
    out.push({ from: T.add(c.sourceIn, s.offset), to: T.add(sourceEnd(c), s.offset) });
  }
  return out;
};

const activeMedia = (track: Track, time: T.RationalTime) => {
  for (const c of track.clips) if (c.type === 'media' && !c.reverse && !T.lt(time, c.start) && T.lt(time, T.add(c.start, c.duration))) return c;
  return null;
};

function transcriptLayer(doc: ProjectDocument, seq: Sequence, track: Track, time: T.RationalTime): CaptionLayer | null {
  const cfg = track.caption!;
  const sources = cfg.linkedTrackId ? seq.tracks.filter((t) => t.id === cfg.linkedTrackId) : seq.tracks.filter((t) => t.kind === 'audio' || t.kind === 'video');
  const cache = new Map<string, Spoken>();
  for (const src of sources) {
    const clip = activeMedia(src, time);
    const spoken = clip && spokenBy(doc, cache, clip.assetId);
    if (!clip || !spoken) continue;
    const transcript = spoken.transcript;
    const st = T.add(sourceAt(clip, time), spoken.offset); // on the transcript's clock
    const seg: Segment | undefined = transcript.segments.find((s) => !T.lt(st, s.start) && T.lt(st, T.add(s.start, s.duration)));
    if (!seg) return null;
    const capacity = cfg.style.maxLines * cfg.style.maxCharsPerLine;
    if (seg.words.length === 0) {
      // Only the phrase is timed: pages advance in proportion to their length (a display estimate, never used for cuts).
      const words = tokens(seg.text);
      const pages = captionPages(words, capacity);
      const total = words.reduce((n, w) => n + w.length, 0) || 1;
      const frac = T.toSeconds(T.sub(st, seg.start)) / T.toSeconds(seg.duration);
      let acc = 0, page = pages[pages.length - 1] ?? [];
      for (const p of pages) { acc += p.reduce((n, i) => n + words[i]!.length, 0); if (frac < acc / total) { page = p; break; } }
      return { kind: 'caption', trackId: track.id, sourceId: seg.id, style: cfg.style, words: page.map((i) => ({ text: words[i]!, state: 'plain' })) };
    }
    // Hide words whose audio is no longer on the linked track (cut out), so the caption shows what is heard.
    const used = spokenSpans(doc, cache, src, transcript);
    const heard = seg.words.filter((w) => {
      const mid = T.add(w.start, { value: w.duration.value, timescale: w.duration.timescale * 2 });
      return used.some((u) => !T.lt(mid, u.from) && T.lt(mid, u.to));
    });
    if (heard.length === 0) return null;
    const pages = captionPages(heard.map((w) => w.text), capacity);
    let lastStarted = 0;
    heard.forEach((w, i) => { if (!T.lt(st, w.start)) lastStarted = i; });
    const page = pages.find((p) => p.includes(lastStarted)) ?? pages[0]!;
    const timed = seg.timing === 'word';
    return {
      kind: 'caption', trackId: track.id, sourceId: seg.id, style: cfg.style,
      words: page.map((i) => {
        const w = heard[i]!;
        const state: WordState = !timed ? 'plain' : T.lt(st, w.start) ? 'future' : T.lt(st, T.add(w.start, w.duration)) ? 'current' : 'past';
        const since = timed && state !== 'future' && cfg.style.wordEntrance && cfg.style.wordEntrance !== 'none' ? T.toSeconds(T.sub(st, w.start)) : 1;
        return { text: w.text, state, ...(since < 1 ? { since: Number(since.toFixed(4)) } : {}) };
      }),
    };
  }
  return null;
}

/** The caption (if any) a caption track shows at `time`. */
export function captionAt(doc: ProjectDocument, seq: Sequence, track: Track, time: T.RationalTime): CaptionLayer | null {
  if (track.kind !== 'caption' || !track.caption || track.hidden) return null;
  if (track.caption.mode === 'transcript') return transcriptLayer(doc, seq, track, time);
  for (const c of track.clips) {
    if (c.type !== 'caption' || T.lt(time, c.start) || !T.lt(time, T.add(c.start, c.duration))) continue;
    const words = tokens(c.text);
    const pages = captionPages(words, track.caption.style.maxLines * track.caption.style.maxCharsPerLine);
    // Long manual cues page evenly over the cue.
    const frac = T.toSeconds(T.sub(time, c.start)) / T.toSeconds(c.duration);
    const page = pages[Math.min(pages.length - 1, Math.floor(frac * pages.length))] ?? [];
    return { kind: 'caption', trackId: track.id, sourceId: c.id, style: track.caption.style, words: page.map((i) => ({ text: words[i]!, state: 'plain' })) };
  }
  return null;
}

/**
 * A caption track resolved to timeline cues (for SRT/VTT/ASS export and burn-in checks).
 * Manual tracks return their cues. Transcript tracks return what is heard: one cue per clip x phrase x page,
 * snapped to frames, with words that were cut out omitted.
 */
export function captionCues(doc: ProjectDocument, seq: Sequence, track: Track): { start: T.RationalTime; end: T.RationalTime; text: string }[] {
  if (track.kind !== 'caption' || !track.caption) return [];
  if (track.caption.mode === 'manual') return track.clips.filter((c) => c.type === 'caption').map((c) => ({ start: c.start, end: T.add(c.start, c.duration), text: (c as { text: string }).text }));
  const cfg = track.caption, rate = doc.settings.frameRate, capacity = cfg.style.maxLines * cfg.style.maxCharsPerLine;
  const sources = cfg.linkedTrackId ? seq.tracks.filter((t) => t.id === cfg.linkedTrackId) : seq.tracks.filter((t) => t.kind === 'audio' || t.kind === 'video');
  const out: { start: T.RationalTime; end: T.RationalTime; text: string }[] = [];
  const push = (start: T.RationalTime, end: T.RationalTime, text: string) => {
    const s = T.snapToFrame(start, rate), e = T.snapToFrame(end, rate);
    const prev = out.at(-1);
    const from = prev && T.lt(s, prev.end) ? prev.end : s;
    if (!T.lt(from, e) || !text) return;
    if (prev && prev.text === text && T.eq(prev.end, from)) prev.end = e; // the same phrase continuing across a cut is one cue
    else out.push({ start: from, end: e, text });
  };
  // Timeline instants already captioned by an earlier source track are skipped (the renderer picks the first source too).
  const covered: { start: T.RationalTime; end: T.RationalTime }[] = [];
  const cache = new Map<string, Spoken>();
  for (const src of sources) {
    for (const clip of src.clips) {
      if (clip.type !== 'media' || clip.reverse) continue; // a reversed clip plays no speech
      const spoken = spokenBy(doc, cache, clip.assetId);
      const cEnd = T.add(clip.start, clip.duration);
      if (!spoken || covered.some((r) => T.lt(clip.start, r.end) && T.lt(r.start, cEnd))) continue;
      const { transcript, offset } = spoken;
      covered.push({ start: clip.start, end: cEnd });
      // the clip's stretch on the transcript's clock (the same as its own unless its file is a derived copy, ADR-0017)
      const srcIn = T.add(clip.sourceIn, offset), srcEnd = T.add(sourceEnd(clip), offset);
      const toTimeline = (t: T.RationalTime) => timelineAt(clip, T.sub(T.min(T.max(t, srcIn), srcEnd), offset));
      for (const seg of transcript.segments) {
        const segEnd = T.add(seg.start, seg.duration);
        if (!T.lt(seg.start, srcEnd) || !T.lt(srcIn, segEnd)) continue;
        if (seg.words.length === 0) { push(toTimeline(seg.start), toTimeline(segEnd), seg.text); continue; }
        const mid = (w: { start: T.RationalTime; duration: T.RationalTime }) => T.add(w.start, { value: w.duration.value, timescale: w.duration.timescale * 2 });
        // Same rule as the renderer: a phrase shows every word still heard somewhere on this track.
        const used = spokenSpans(doc, cache, src, transcript);
        const here = seg.words.filter((w) => used.some((u) => !T.lt(mid(w), u.from) && T.lt(mid(w), u.to)));
        const pages = captionPages(here.map((w) => w.text), capacity);
        pages.forEach((p, pi) => {
          const first = here[p[0]!]!, nextPage = pages[pi + 1];
          const start = pi === 0 ? T.max(seg.start, srcIn) : first.start;
          const end = nextPage ? here[nextPage[0]!]!.start : segEnd;
          push(toTimeline(start), toTimeline(end), p.map((i) => here[i]!.text).join(' '));
        });
      }
    }
  }
  return out.sort((a, b) => T.cmp(a.start, b.start));
}
