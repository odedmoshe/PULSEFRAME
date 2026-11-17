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

/** "n" or "n/d" seconds as an exact time; null for anything else (including zero). */
export function parseFitSeconds(s: string | null): T.RationalTime | null {
  const m = /^([1-9]\d{0,3})(?:\/([1-9]\d{0,3}))?$/.exec(s ?? '');
  return m ? T.rt(Number(m[1]), m[2] === undefined ? 1 : Number(m[2])) : null;
}

export interface LengthChoice { key: LengthKey; bars: number | null; seconds: number | null; bytes: number | null; disabledReason: string | null }
/** What one length chip would make: bars, seconds and the size of the WAV (44 + 16·bars·samplesPerBeat bytes). */
export function sizeOf(style: Pick<MusicStyleSummary, 'bpm'>, bars: number): { seconds: number; bytes: number } {
  const S = 2_880_000 / style.bpm;
  return { seconds: (240 * bars) / style.bpm, bytes: 44 + 16 * bars * S };
}
/**
 * The chips of a row: 8, 16 and 32 bars, and «כאורך הסרטון» (the edit's exact length rounded up to whole bars). A choice the
 * style cannot make is shown with the reason, never hidden: an empty film, a film longer than the longest track.
 */
export function lengthChoices(style: MusicStyleSummary, fitSeconds: string | null, s: MusicStrings): LengthChoice[] {
  const fixed = BAR_CHOICES.map((bars): LengthChoice => {
    const ok = bars >= style.minBars && bars <= style.maxBars;
    return { key: `${bars}` as LengthKey, bars, ...sizeOf(style, bars), disabledReason: ok ? null : s.fitTooLong };
  });
  const fit = parseFitSeconds(fitSeconds);
  if (!fit) return [...fixed, { key: 'fit', bars: null, seconds: null, bytes: null, disabledReason: s.fitEmpty }];
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
export function previewUrl(styleId: string, bars: number, seed: number): string {
  return `/api/v1/music/${encodeURIComponent(styleId)}/audio?bars=${Math.min(bars, PREVIEW_MAX_BARS)}&seed=${seed}`;
}
/** The body of POST /api/v1/projects/:id/music: the chosen length, the seed, placed from the start of the film. */
export function addBody(styleId: string, choice: LengthChoice, fitSeconds: string | null, seed: number): Record<string, unknown> {
  const length = choice.key === 'fit' ? { fitSeconds } : { bars: choice.bars };
  return { styleId, ...length, seed, start: T.ZERO };
}

/** What to tell the person when a request failed: the Hebrew wording of a known refusal, the busy line, or the server's words. */
export function errorText(lang: 'he' | 'en', s: MusicStrings, status: number, body: unknown): string {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (status === 429 || err?.code === 'synthesis_busy') return s.busy;
  const message = err?.message ?? `HTTP ${status}`;
  return `${s.failed}: ${translateRefusal(lang, message) ?? message}`;
}
