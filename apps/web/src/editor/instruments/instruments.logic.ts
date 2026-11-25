/**
 * Pure logic of «כלים מוקלטים» in the editor (wave 7 instruments track). Builder W3 owns this file (tests in instruments.logic.test.ts).
 * The kit view (what the page knows about a style's kit), the add decision, the blind pair's deterministic order, the strict level
 * scale, the duties said before an add, the words of a refusal.
 */
import type { KitState, MusicKitStatus } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';

/** The interface is built (this track's page side). */
export const INSTRUMENTS_UI_BUILT: boolean = true;
export type Sound = 'synth' | 'recorded';
/** The kit of a style in the answer of GET /api/v1/music/kits, or null. */
export const kitOfStyle = (kits: readonly MusicKitStatus[], styleId: string): MusicKitStatus | null => kits.find((k) => k.styleId === styleId) ?? null;

/**
 * The blind order of a comparison: which of «א» and «ב» is the recorded version, mapped from a bit. The bit is auditionBit(): a pure
 * function of the request, so the order looks arbitrary to the listener but a proof can recompute it.
 */
export const auditionOrder = (bit: 0 | 1): { a: Sound; b: Sound } => (bit === 0 ? { a: 'recorded', b: 'synth' } : { a: 'synth', b: 'recorded' });
/** FNV-1a over the request text, then murmur3's finaliser: a bit that looks random, is the same for the same request, nothing stored. */
export function auditionBit(styleId: string, bars: number, seed: number): 0 | 1 {
  let h = 0x811c9dc5;
  for (const ch of `${styleId}\n${bars}\n${seed}`) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return ((h >>> 0) & 1) as 0 | 1;
}
export const auditionPair = (styleId: string, bars: number, seed: number) => auditionOrder(auditionBit(styleId, bars, seed));

/** The longest preview the server plays (bars), as music.logic PREVIEW_MAX_BARS. */
export const AUDITION_MAX_BARS = 32;
/** The preview URL of a style with the chosen sound (and the level-match header asked for when `match`). */
export const instrumentsPreviewUrl = (styleId: string, bars: number, seed: number, instruments: Sound, match = false): string =>
  `/api/v1/music/${encodeURIComponent(styleId)}/audio?bars=${bars}&seed=${seed}${instruments === 'recorded' ? '&instruments=recorded' : ''}${match ? '&match=1' : ''}`;
/** The volume an <audio> element gets from x-pf-level-scale (a decimal ≤ 1; anything else → 1). */
export function levelScale(header: string | null): number {
  const v = header === null ? Number.NaN : Number(header);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
}
/** Strict: the scale, or null when the header is absent or not a decimal in (0, 1]: then the pair is not played (unmatched is not fair). */
export function parseLevelScale(header: string | null): number | null {
  if (header === null || !/^(0(\.\d+)?|1(\.0+)?)$/.test(header.trim())) return null;
  const v = Number(header);
  return v > 0 && v <= 1 ? v : null;
}

/** What the page knows about the kit of one style. */
export type KitPhase = 'checking' | 'failed' | 'no_kit' | KitState;
export interface KitView { phase: KitPhase; kit: MusicKitStatus | null; why?: string }
export type KitsLoad = { phase: 'loading' } | { phase: 'failed'; why: string } | { phase: 'ok'; kits: readonly MusicKitStatus[] };
export function kitView(load: KitsLoad, styleId: string): KitView {
  if (load.phase === 'loading') return { phase: 'checking', kit: null };
  if (load.phase === 'failed') return { phase: 'failed', kit: null, why: load.why };
  const kit = kitOfStyle(load.kits, styleId);
  return kit ? { phase: kit.state, kit } : { phase: 'no_kit', kit: null };
}
export const isReady = (v: KitView): boolean => v.phase === 'ready';

/** Whether a request with the chosen sound may be sent, and the field it carries. Recorded is sent only when chosen AND the kit is ready. */
export function addDecision(sound: Sound, v: KitView): { send: true; instruments?: 'recorded' } | { send: false; phase: KitPhase } {
  if (sound === 'synth') return { send: true };
  return isReady(v) ? { send: true, instruments: 'recorded' } : { send: false, phase: v.phase };
}

/** The licence of a source in words: share-alike, no-derivatives, or another id the ledger refused (null = no reason beyond the id). */
export function licenceWhy(licenceId: string): 'sa' | 'nd' | 'unknown' | 'other' {
  if (/-SA(-|$)/i.test(licenceId)) return 'sa';
  if (/-ND(-|$)/i.test(licenceId)) return 'nd';
  if (licenceId.startsWith('custom:') || licenceId === '' || licenceId === 'unknown') return 'unknown';
  return 'other';
}
export interface Duties { credit: string[]; nonCommercial: boolean; none: string[] }
/** What the sources of a kit ask of a film: whose credit goes in the description, whether it is non-commercial, which have no duty. */
export function dutiesOf(sources: MusicKitStatus['sources']): Duties {
  return {
    credit: sources.filter((s) => s.credit).map((s) => s.title),
    nonCommercial: sources.some((s) => s.nonCommercial),
    none: sources.filter((s) => !s.credit && !s.nonCommercial).map((s) => s.title),
  };
}
/** The parts of a kit as the distinct instrument titles, in the language. */
export const kitInstrumentTitles = (kit: MusicKitStatus, lang: 'he' | 'en'): string[] => [...new Set(kit.parts.map((p) => p.title[lang]))];
/** The day of a mark (YYYY-MM-DD). */
export const heardDate = (kit: MusicKitStatus): string | null => (kit.heard ? kit.heard.at.slice(0, 10) : null);

/** The words of a failed request: Hebrew from the shared patterns (each with its next step); English: the server's sentence and its hint. */
export function refusalWords(lang: 'he' | 'en', f: { message: string; hint?: string; status?: number }): string {
  const he = lang === 'he' ? translateRefusal('he', f.message) : null;
  if (he) return he;
  return f.hint && !f.message.includes(f.hint) ? `${f.message}. ${f.hint}` : f.message;
}
