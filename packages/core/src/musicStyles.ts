/**
 * Built-in music (ADR-0022): the styles, and everything about a track that is known BEFORE a single sample is made: its exact
 * length, its beats, bars and sections. Pure arithmetic in integers and exact rationals, shared by the template planner, the
 * server's synthesiser (apps/server/src/music.ts and music/) and the editor.
 *
 * - The music itself is original: it is synthesised by this build's own TypeScript code from a style, a number of bars and a
 *   seed. No recordings, no samples, no downloaded music, no songs, lyrics or melodies of songs. Every asset says so in its
 *   provenance (MUSIC_GENERATOR).
 * - Timing is exact: 48,000 samples a second; every allowed tempo divides 2,880,000, so a beat is a whole number of samples
 *   (samplesPerBeat = 2,880,000 / bpm). Beat k is at sample k·samplesPerBeat and at k·60/bpm seconds, a bar is four beats, and
 *   N bars are exactly 4·N·samplesPerBeat sample frames: 240·N/bpm seconds.
 * - Beats, bars and sections therefore come from the recipe, never from a measurement: they are attached to the asset with
 *   MUSIC_METHOD and confidence null (packOps.ts attachKnownGrid), and the beat tracker is not run on this path.
 * - Nothing musical is a default until the owner has listened: every style carries review 'unheard' and is shown with
 *   MUSIC_UNHEARD_LABEL; a 'rejected' style is not listed, planned or made.
 *
 * The form of a track of N bars (musicLayout):
 *   ending E = 1 bar (the last). Intro I = 4 bars when N >= 24, 2 when N >= 12, 1 when N >= 6, else none. body = N − I − E.
 *   The body is cut into c = max(1, round(body/16)) cycles of floor(body/c) bars (the first body mod c cycles get one more).
 *   A cycle of L bars is a build of max(1, floor(3L/8)) bars and then a peak of the rest; from the second cycle on, the
 *   first two build bars are a break when L >= 8. Levels: intro 0, break 0, build 1, peak 2, the last peak 3, ending 3.
 *   16 bars: intro 0–2, build 2–6, peak 6–15, ending 15–16.
 */
import * as T from '@pulseframe/time';
import { z } from 'zod';
import { MAX_MUSIC_SECTIONS, MUSIC_SECTION_KINDS, MusicSectionSchema, RationalTimeSchema, type Analysis, type Asset } from './schema.ts';

export const MUSIC_SAMPLE_RATE = 48000;
/** Version of the synthesiser as a whole (recorded in every asset as params.synth); a change that gives other bytes raises it. */
export const MUSIC_SYNTH_VERSION = 1;
export const MUSIC_GENERATOR = 'pulseframe music synthesiser 1: TypeScript formula; no recordings, no samples, no third-party content' as const;
export const MUSIC_METHOD = 'known by construction: PULSEFRAME built-in music; beats, bars and sections come from the recipe, nothing was measured' as const;
/** Each divides 2,880,000 (= 48,000 · 60): a whole number of samples per beat at 48 kHz. */
export const MUSIC_BPMS = [72, 80, 90, 96, 100, 120, 125, 128] as const;
/** The longest built-in track, in seconds (an uncompressed 48 kHz stereo WAV is 11.52 MB a minute). */
export const MUSIC_MAX_SECONDS = 300;
/** The id of a built-in music style; also the procedural id of the assets it makes. */
export const MUSIC_STYLE_ID = /^music\.[a-z0-9-]{1,24}$/;
export const MUSIC_MAX_SEED = 1_000_000;
export type MusicReview = 'unheard' | 'approved' | 'rejected';
export interface MusicStyle {
  id: `music.${string}`; version: number; name: { he: string; en: string }; hint: { he: string; en: string };
  bpm: (typeof MUSIC_BPMS)[number]; meter: 4; minBars: number; mood: 'festive' | 'happy' | 'calm' | 'energetic' | 'mellow' | 'moving';
  /** 'unheard' until the owner listens; only the lead changes it, with the date in docs/PROGRESS.md. A 'rejected' style is not listed, planned or made. */
  review: MusicReview;
}
/** The names and hints are starting points: nobody has listened to any of these yet. */
export const MUSIC_STYLES: readonly MusicStyle[] = [
  { id: 'music.festive', version: 1, name: { he: 'חגיגי', en: 'Festive' }, hint: { he: 'קצב קופצני בסולם חגיגי, פריטה ומחיאות כפיים', en: 'A bouncy beat in a festive scale, plucks and claps' }, bpm: 125, meter: 4, minBars: 4, mood: 'festive', review: 'unheard' },
  { id: 'music.birthday', version: 1, name: { he: 'יום הולדת עליז', en: 'Cheerful birthday' }, hint: { he: 'פריטה קלילה, פעמונים ומחיאות כפיים', en: 'Light plucks, bells and claps' }, bpm: 120, meter: 4, minBars: 4, mood: 'happy', review: 'unheard' },
  { id: 'music.calm', version: 1, name: { he: 'רגוע ונעים', en: 'Calm and warm' }, hint: { he: 'אקורדים רכים וארפג׳ איטי לזיכרונות משפחתיים', en: 'Soft chords and a slow arpeggio for family memories' }, bpm: 80, meter: 4, minBars: 4, mood: 'calm', review: 'unheard' },
  { id: 'music.pop', version: 1, name: { he: 'פופ קצבי', en: 'Upbeat pop' }, hint: { he: 'בס ותוף על כל פעימה לסרטונים קצרים', en: 'Bass and a kick on every beat, for shorts' }, bpm: 128, meter: 4, minBars: 4, mood: 'energetic', review: 'unheard' },
  { id: 'music.lofi', version: 1, name: { he: 'לו־פיי', en: 'Lo-fi' }, hint: { he: 'פסנתר חשמלי רך וקצב נינוח', en: 'Soft electric piano and a relaxed beat' }, bpm: 90, meter: 4, minBars: 4, mood: 'mellow', review: 'unheard' },
  { id: 'music.cinematic', version: 1, name: { he: 'קולנועי מרגש', en: 'Cinematic' }, hint: { he: 'מיתרים שנבנים לאט לשיא גדול', en: 'Strings that build slowly to a big peak' }, bpm: 72, meter: 4, minBars: 4, mood: 'moving', review: 'unheard' },
];
/** The style with this id, unless it was rejected (a rejected style is as good as absent everywhere). */
export const findMusicStyle = (id: string): MusicStyle | undefined => MUSIC_STYLES.find((s) => s.id === id && s.review !== 'rejected');
/** Shown with every style and every track of a style whose review is 'unheard'. */
export const MUSIC_UNHEARD_LABEL = { he: 'מוזיקה מובנית — עוד לא הושמעה לאף אחד', en: 'Built-in music — nobody has listened to it yet' } as const;
/** Shown once the owner approved a style. */
export const MUSIC_APPROVED_LABEL = { he: 'מוזיקה מובנית', en: 'Built-in music' } as const;
export const musicLabel = (style: Pick<MusicStyle, 'review'>): { he: string; en: string } => (style.review === 'approved' ? MUSIC_APPROVED_LABEL : MUSIC_UNHEARD_LABEL);

export type MusicSectionKind = (typeof MUSIC_SECTION_KINDS)[number];
export interface MusicLayoutSection { startBar: number; bars: number; start: T.RationalTime; kind: MusicSectionKind; level: 0 | 1 | 2 | 3 }
export interface MusicLayout {
  styleId: string; version: number; bars: number; bpm: number; meter: 4;
  /** 2,880,000 / bpm */
  samplesPerBeat: number;
  /** (bars − 1) · 4 · samplesPerBeat + endFrames stereo sample frames; the WAV file is 44 + 4 · totalFrames bytes */
  totalFrames: number;
  /**
   * Sample frames of the ending (the last "bar"): one bar (4 · samplesPerBeat) unless an exact length was asked for (wave 7
   * musicfit, exactLayoutFor), then 2 to 6 beats. Only a track whose ending is not one bar records it (params.end).
   */
  endFrames: number;
  /** totalFrames / 48,000 seconds, exact (240 · bars / bpm with the default ending) */
  duration: T.RationalTime;
  /** k · 60 / bpm seconds for every k with k · samplesPerBeat < totalFrames (k = 0 … 4·bars − 1 with the default ending) */
  beats: T.RationalTime[];
  /** every fourth beat */
  downbeats: T.RationalTime[];
  /** contiguous, from bar 0 to the last bar; the last is the one-bar ending */
  sections: MusicLayoutSection[];
}
/** The form of N bars as [kind, level, bars] runs (see the header). */
function formOf(bars: number): { kind: MusicSectionKind; level: 0 | 1 | 2 | 3; bars: number }[] {
  const intro = bars >= 24 ? 4 : bars >= 12 ? 2 : bars >= 6 ? 1 : 0;
  const body = bars - intro - 1;
  const cycles = Math.max(1, Math.floor((2 * body + 16) / 32)); // round(body / 16), halves up, in integers
  const out: { kind: MusicSectionKind; level: 0 | 1 | 2 | 3; bars: number }[] = [];
  if (intro) out.push({ kind: 'intro', level: 0, bars: intro });
  for (let j = 0; j < cycles; j++) {
    const length = Math.floor(body / cycles) + (j < body % cycles ? 1 : 0);
    const build = Math.max(1, Math.floor((3 * length) / 8));
    const rest = j > 0 && length >= 8 ? 2 : 0; // a break before the build of every cycle but the first
    if (rest) out.push({ kind: 'break', level: 0, bars: rest });
    out.push({ kind: 'build', level: 1, bars: build - rest });
    out.push({ kind: 'peak', level: j === cycles - 1 ? 3 : 2, bars: length - build });
  }
  out.push({ kind: 'ending', level: 3, bars: 1 });
  return out.filter((s) => s.bars > 0);
}
/** The shortest and longest exact ending, in beats (wave 7 musicfit, decisions §2.2): exactLayoutFor gives 2 ≤ ending < 6 beats. */
export const MUSIC_ENDING_MIN_BEATS = 2;
export const MUSIC_ENDING_MAX_BEATS = 6;
/**
 * Everything known about a track of `bars` bars in this style. Pure. Throws RangeError for an unknown or rejected style,
 * a number of bars that is not a whole number or is below the style's minBars, an ending that is not a whole number of sample
 * frames from MUSIC_ENDING_MIN_BEATS to MUSIC_ENDING_MAX_BEATS beats, or a length over MUSIC_MAX_SECONDS.
 * `endFrames` (wave 7 musicfit): the length of the last "bar", the ending, in 48 kHz sample frames; absent = one bar, which gives
 * exactly the layout (and the bytes, names and params) of a track made before it existed.
 */
export function musicLayout(styleId: string, bars: number, endFrames?: number): MusicLayout {
  const style = findMusicStyle(styleId);
  if (!style) throw new RangeError(`there is no built-in music style "${styleId}"`);
  if (!Number.isInteger(bars) || bars < style.minBars) throw new RangeError(`${style.id} is made in whole bars, at least ${style.minBars}; got ${bars}`);
  const samplesPerBeat = (MUSIC_SAMPLE_RATE * 60) / style.bpm;
  const bar = style.meter * samplesPerBeat;
  const ending = endFrames ?? bar;
  if (!Number.isInteger(ending) || ending < MUSIC_ENDING_MIN_BEATS * samplesPerBeat || ending > MUSIC_ENDING_MAX_BEATS * samplesPerBeat) throw new RangeError(`the ending of ${style.id} lasts ${MUSIC_ENDING_MIN_BEATS} to ${MUSIC_ENDING_MAX_BEATS} beats in whole sample frames (${MUSIC_ENDING_MIN_BEATS * samplesPerBeat} to ${MUSIC_ENDING_MAX_BEATS * samplesPerBeat}); got ${endFrames}`);
  const totalFrames = (bars - 1) * bar + ending;
  if (totalFrames > MUSIC_MAX_SECONDS * MUSIC_SAMPLE_RATE) throw new RangeError(`${bars} bars of ${style.id} last ${Math.ceil(totalFrames / MUSIC_SAMPLE_RATE)} s; a built-in track is at most ${MUSIC_MAX_SECONDS} s (${maxMusicBars(style)} bars)`);
  const beatAt = (k: number): T.RationalTime => T.normalize(T.rt(60 * k, style.bpm)); // lowest terms: the form documents are compared in
  const beats = Array.from({ length: Math.ceil(totalFrames / samplesPerBeat) }, (_, k) => beatAt(k)); // k · spb < totalFrames
  let at = 0;
  const sections = formOf(bars).map((s): MusicLayoutSection => { const startBar = at; at += s.bars; return { startBar, bars: s.bars, start: beatAt(startBar * style.meter), kind: s.kind, level: s.level }; });
  return {
    styleId: style.id, version: style.version, bars, bpm: style.bpm, meter: style.meter, samplesPerBeat, totalFrames, endFrames: ending,
    duration: T.normalize(T.rt(totalFrames, MUSIC_SAMPLE_RATE)), beats, downbeats: beats.filter((_, k) => k % style.meter === 0), sections,
  };
}
/** Whole 48 kHz sample frames that cover `duration`, rounded UP (a clip of that length never runs past the file). Pure, exact. */
export function sampleFramesFor(duration: T.RationalTime): number {
  if (T.isNegative(duration)) throw new RangeError('a duration is not negative');
  const n = BigInt(duration.value) * BigInt(MUSIC_SAMPLE_RATE), d = BigInt(duration.timescale);
  return Number(n / d + (n % d === 0n ? 0n : 1n));
}
/**
 * The bars and ending of a track of exactly `lengthFrames` sample frames in this style (wave 7 musicfit, decisions §2.2): K =
 * floor((L − 2·spb) / bar) whole bars before the final chord and an ending of L − K·bar frames (2 to just under 6 beats); the
 * track has K + 1 bars in the sense of musicLayout. Throws RangeError like musicLayout (too short for the style's minBars, or
 * longer than MUSIC_MAX_SECONDS).
 */
export function exactLayoutFor(styleId: string, lengthFrames: number): { bars: number; endFrames: number } {
  const style = findMusicStyle(styleId);
  if (!style) throw new RangeError(`there is no built-in music style "${styleId}"`);
  if (!Number.isInteger(lengthFrames) || lengthFrames <= 0) throw new RangeError(`a length is a positive whole number of sample frames; got ${lengthFrames}`);
  const spb = (MUSIC_SAMPLE_RATE * 60) / style.bpm, bar = style.meter * spb;
  const k = Math.floor((lengthFrames - MUSIC_ENDING_MIN_BEATS * spb) / bar);
  const out = { bars: k + 1, endFrames: lengthFrames - k * bar };
  musicLayout(style.id, out.bars, out.endFrames); // the same refusals as musicLayout
  return out;
}
/** The most bars of a style that stay within MUSIC_MAX_SECONDS. */
export const maxMusicBars = (style: Pick<MusicStyle, 'bpm'>): number => Math.floor((MUSIC_MAX_SECONDS * style.bpm) / 240);
/**
 * The fewest whole bars that last at least `duration`: max(minBars, ceil(seconds · bpm / 240)), in exact integers.
 * Throws RangeError for an unknown or rejected style or a negative duration. The result may be more than the style allows
 * (musicLayout then refuses it, naming the length).
 */
export function barsForDuration(styleId: string, duration: T.RationalTime): number {
  const style = findMusicStyle(styleId);
  if (!style) throw new RangeError(`there is no built-in music style "${styleId}"`);
  if (T.isNegative(duration)) throw new RangeError('a duration is not negative');
  const n = BigInt(duration.value) * BigInt(style.bpm), d = BigInt(duration.timescale) * 240n;
  const bars = n / d + (n % d === 0n ? 0n : 1n);
  return Math.max(style.minBars, Number(bars));
}

/** What a caller asks for (POST /api/v1/projects/:id/music, MCP add_builtin_music). Exactly one of bars and fitSeconds; the server checks that. */
export const MusicRequestSchema = z.object({
  styleId: z.string().regex(MUSIC_STYLE_ID),
  bars: z.number().int().min(1).max(600).optional(),
  fitSeconds: z.string().regex(/^[1-9]\d{0,3}(\/[1-9]\d{0,3})?$/).optional().describe('Exact seconds n or n/d; rounded UP to whole bars. Exactly one of bars and fitSeconds.'),
  /** Wave 7 musicfit: the ending in 48 kHz sample frames (2 to 6 beats), only with `bars`; exactLayoutFor gives both. Absent = one bar. */
  endFrames: z.number().int().min(1).max(MUSIC_MAX_SECONDS * MUSIC_SAMPLE_RATE).optional().describe('The ending in 48 kHz sample frames (2 to 6 beats), only together with bars; absent = one bar'),
  seed: z.number().int().min(0).max(MUSIC_MAX_SEED).default(1),
  /** Wave 7 instruments «כלים מוקלטים»: 'recorded' makes every part of the style's kit with samples of the owner's library, or is refused (all-or-nothing, never silently synthesised). Absent = 'synth' = the bytes of ADR-0022. */
  instruments: z.enum(['synth', 'recorded']).optional().describe('synth (default) or recorded: every part of the style\'s kit played with recorded instrument samples from the owner\'s library, all or nothing; refused with the reason when the kit is not ready. Unheard until the owner listens'),
}).strict();
export type MusicRequest = z.infer<typeof MusicRequestSchema>;

/**
 * The beat data that travels with a generated track (add_builtin_music.grid, apply_template.assets[].analysis): exactly
 * what attachKnownGrid writes as the asset's beat analysis. Times are source times of the track.
 */
export const KnownGridSchema = z.object({
  method: z.literal(MUSIC_METHOD), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(),
  bpm: z.number().min(20).max(400), meter: z.literal(4),
  beats: z.array(RationalTimeSchema).min(2).max(50000), downbeats: z.array(RationalTimeSchema).min(1).max(50000), sections: z.array(MusicSectionSchema).min(1).max(MAX_MUSIC_SECTIONS),
}).strict();
export type KnownGrid = z.infer<typeof KnownGridSchema>;
/** What the formula was asked for, as it is recorded in the asset (provenance.procedural.params) and in the grid's origin. */
/** `end` (sample frames of the ending) only when the ending is not one bar, so a track made before wave 7 keeps its params. */
export const musicProvenanceParams = (layout: MusicLayout, seed: number): { bars: number; seed: number; bpm: number; meter: number; synth: number; end?: number } =>
  ({ bars: layout.bars, seed, bpm: layout.bpm, meter: layout.meter, synth: MUSIC_SYNTH_VERSION, ...(layout.endFrames !== layout.meter * layout.samplesPerBeat ? { end: layout.endFrames } : {}) });
/** The known grid of a layout. `createdAt` is the caller's (the server's clock when the track was made). */
export const knownGridOf = (layout: MusicLayout, seed: number, createdAt: string): KnownGrid => ({
  method: MUSIC_METHOD, params: { styleId: layout.styleId, version: layout.version, ...musicProvenanceParams(layout, seed) }, createdAt, bpm: layout.bpm, meter: layout.meter,
  beats: layout.beats, downbeats: layout.downbeats, sections: layout.sections.map((s) => ({ start: s.start, kind: s.kind, level: s.level })),
});

/** True for a library file made by the built-in music synthesiser. */
export const isBuiltinMusic = (asset: Pick<Asset, 'provenance'> | undefined): boolean => MUSIC_STYLE_ID.test(asset?.provenance.procedural?.id ?? '');
/** True when a beat analysis is the recipe's own grid (never measured), still as it was attached or corrected by hand since. */
export const isKnownGrid = (beats: NonNullable<Analysis['beats']> | undefined): boolean => beats?.origin.method === MUSIC_METHOD;

/** A style as the gallery, the catalogue and GET /api/v1/music list it. */
export interface MusicStyleSummary extends MusicStyle {
  /** seconds of one bar (240 / bpm) */ barSeconds: number;
  /** bytes of one bar of the stored WAV (16 · samplesPerBeat) */ bytesPerBar: number;
  minSeconds: number; maxBars: number;
  /** MUSIC_UNHEARD_LABEL while review is 'unheard' */ label: { he: string; en: string };
  source: typeof MUSIC_GENERATOR;
}
export const summarizeMusicStyle = (s: MusicStyle): MusicStyleSummary => ({ ...s, barSeconds: 240 / s.bpm, bytesPerBar: (16 * MUSIC_SAMPLE_RATE * 60) / s.bpm, minSeconds: (240 * s.minBars) / s.bpm, maxBars: maxMusicBars(s), label: musicLabel(s), source: MUSIC_GENERATOR });
/** The styles that are offered (rejected ones are left out). */
export const listMusicStyles = (): MusicStyleSummary[] => MUSIC_STYLES.filter((s) => s.review !== 'rejected').map(summarizeMusicStyle);
