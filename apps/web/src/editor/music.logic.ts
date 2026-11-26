/**
 * The logic of the built-in music browser (ADR-0022), apart from React: the rows, the length choices with their seconds and
 * megabytes, the section strip from the real layout (core musicLayout), the seed stepper, the request bodies and URLs of the
 * planned routes (plan §7: GET /api/v1/music/:styleId/audio?bars&seed, POST /api/v1/projects/:id/music), and the error words.
 * Everything a row shows is computed from core musicStyles.ts, the same arithmetic the server makes the track with, so what is
 * promised before adding (length, size, sections) is what is added.
 */
import * as T from '@pulseframe/time';
import { barsForDuration, listMusicStyles, MUSIC_MAX_SEED, musicLayout, type MusicLayoutSection, type MusicStyleSummary } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import type { MusicStrings } from './music.strings.ts';

/** The fixed length chips (bars), then «כאורך הסרטון». */
export const BAR_CHOICES = [8, 16, 32] as const;
/** The longest preview the server plays (bars); a longer choice previews its first 32 bars. */
export const PREVIEW_MAX_BARS = 32;
export type LengthKey = `${(typeof BAR_CHOICES)[number]}` | 'fit';

export interface MusicRow { id: string; name: string; hint: string; bpm: number; unheard: boolean; label: string; style: MusicStyleSummary }
/** The styles the server offers (rejected ones are left out), in the catalogue's order, in one language. */
export function musicRows(lang: 'he' | 'en'): MusicRow[] {
  return listMusicStyles().map((s) => ({ id: s.id, name: s.name[lang], hint: s.hint[lang], bpm: s.bpm, unheard: s.review === 'unheard', label: s.label[lang], style: s }));
}

/**
 * The film's exact length, "n" or "n/d" seconds with any number of digits (an NTSC edit is 1200199/10000 s, one ending on a
 * 48 kHz clip 1234567/48000 s), as an exact time. `null` for an empty film (no length, or zero); `'unknown'` for text that is
 * not such a length (a decimal, a denominator past the largest exact timescale), which is shown as its own reason.
 */
export function parseFitSeconds(s: string | null): T.RationalTime | null | 'unknown' {
  if (s === null || s === '') return null;
  const m = /^(\d+)(?:\/(\d+))?$/.exec(s);
  if (!m) return 'unknown';
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isSafeInteger(den) || den <= 0) return 'unknown';
  return BigInt(m[1]!) === 0n ? null : T.rt(BigInt(m[1]!), den);
}

export interface LengthChoice { key: LengthKey; bars: number | null; seconds: number | null; bytes: number | null; disabledReason: string | null }
/** What one length chip would make: bars, seconds and the size of the WAV (44 + 16·bars·samplesPerBeat bytes). */
export function sizeOf(style: Pick<MusicStyleSummary, 'bpm'>, bars: number): { seconds: number; bytes: number } {
  const S = 2_880_000 / style.bpm;
  return { seconds: (240 * bars) / style.bpm, bytes: 44 + 16 * bars * S };
}
/**
 * The chips of a row: 8, 16 and 32 bars, and «כאורך הסרטון» (the edit's exact length rounded up to whole bars, computed here
 * with core barsForDuration, the server's own rounding, from any exact length). A choice the style cannot make is shown with
 * its true reason, never hidden: a fixed length shorter or longer than the style makes, an empty film, a film whose length
 * cannot be read, a film longer than the longest track.
 */
export function lengthChoices(style: MusicStyleSummary, fitSeconds: string | null, s: MusicStrings): LengthChoice[] {
  const fixed = BAR_CHOICES.map((bars): LengthChoice => {
    const reason = bars < style.minBars ? s.barsTooShort : bars > style.maxBars ? s.barsTooLong : null;
    return { key: `${bars}` as LengthKey, bars, ...sizeOf(style, bars), disabledReason: reason };
  });
  const fit = parseFitSeconds(fitSeconds);
  if (fit === null || fit === 'unknown') return [...fixed, { key: 'fit', bars: null, seconds: null, bytes: null, disabledReason: fit === null ? s.fitEmpty : s.fitUnknown }];
  const bars = barsForDuration(style.id, fit);
  if (bars > style.maxBars) return [...fixed, { key: 'fit', bars, seconds: null, bytes: null, disabledReason: s.fitTooLong }];
  return [...fixed, { key: 'fit', bars, ...sizeOf(style, bars), disabledReason: null }];
}

export interface StripPart { kind: MusicLayoutSection['kind']; level: number; startBar: number; bars: number; /** share of the whole width, 0..1 */ share: number; label: string }
/** The section strip of a track of `bars` bars, from the layout the server makes it with; every part carries its name. */
export function sectionStrip(styleId: string, bars: number, s: MusicStrings): StripPart[] {
  return musicLayout(styleId, bars).sections.map((x) => ({ kind: x.kind, level: x.level, startBar: x.startBar, bars: x.bars, share: x.bars / bars, label: s.section[x.kind] }));
}

/** The next seed in either direction, kept inside 0..MUSIC_MAX_SEED. */
export const stepSeed = (seed: number, delta: number): number => Math.max(0, Math.min(MUSIC_MAX_SEED, Math.floor(seed) + delta));

/** "0:16" or "1:04" for seconds (whole seconds, rounded up so a promise is never short). */
export function formatDuration(seconds: number): string {
  const whole = Math.ceil(seconds - 1e-9);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
/** Megabytes with one decimal (1 MB = 1,000,000 bytes, as file browsers show it). */
export const formatMegabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);

/** GET /api/v1/music/:styleId/audio for listening: at most 32 bars. */
export function previewUrl(styleId: string, bars: number, seed: number, instruments?: 'recorded'): string {
  return `/api/v1/music/${encodeURIComponent(styleId)}/audio?bars=${Math.min(bars, PREVIEW_MAX_BARS)}&seed=${seed}${instruments === 'recorded' ? '&instruments=recorded' : ''}`;
}
/**
 * The body of POST /api/v1/projects/:id/music: the chosen length in bars, the seed, placed from the start of the film.
 * «כאורך הסרטון» sends the bars computed from the exact length (lengthChoices), not `fitSeconds`: the request schema's
 * fitSeconds takes only short "n/d" forms, and the bars are the same number the server would round to.
 */
export function addBody(styleId: string, choice: LengthChoice, seed: number, instruments?: 'recorded'): Record<string, unknown> {
  if (choice.bars === null) throw new RangeError('this length cannot be added');
  // wave 7 instruments: the optional field is present ONLY for a recorded request; an ordinary request is exactly what it was before
  return instruments === 'recorded' ? { styleId, bars: choice.bars, seed, start: T.ZERO, instruments } : { styleId, bars: choice.bars, seed, start: T.ZERO };
}

/** What to tell the person when a request failed: the Hebrew wording of a known refusal, the busy line, or the server's words. */
export function errorText(lang: 'he' | 'en', s: MusicStrings, status: number, body: unknown): string {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (status === 429 || err?.code === 'synthesis_busy') return s.busy;
  const message = err?.message ?? `HTTP ${status}`;
  return `${s.failed}: ${translateRefusal(lang, message) ?? message}`;
}
