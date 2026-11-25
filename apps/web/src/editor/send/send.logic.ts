/**
 * Pure logic of the send components (wave 7, track send): the typed target size, how the server's plan reads as a sentence, the
 * export report as rows, the clip loudness match as rows, and the limiter meter. No React and no I/O, so it is unit-tested.
 * Nothing here says a file is fine or what an app will do with it: only bytes are promised, and a finding is a finding.
 */
import { planMatchGain, matchCeiling, medianLufs, LOUDNESS_MATCH, SEND_FIT, type ExportChecks, type ExportFinding, type MatchClipInput, type MatchClipOutput, type ClipLoudnessRow, type ProjectDocument } from '@pulseframe/core';
import type { RationalTime } from '@pulseframe/time';

// ---------------------------------------------------------------- target size
/** The sizes offered as buttons, in «מ״ב» (1 MB = 1,000,000 bytes). */
export const SIZE_CHOICES_MB = [16, 64, 100] as const;
export const bytesOfMb = (mb: number) => Math.round(mb * SEND_FIT.megabyte);
/** "15.6": megabytes with one decimal, decimal units, as the file card shows them. */
export const fmtMb = (bytes: number) => (bytes / SEND_FIT.megabyte).toFixed(1);
/** A target as the owner would say it: whole megabytes without a decimal point ("16"), else one decimal ("16.5"). */
export const sayMb = (bytes: number) => { const mb = bytes / SEND_FIT.megabyte; return Number.isInteger(mb) ? String(mb) : mb.toFixed(1); };

export type TargetParse = { ok: true; bytes: number } | { ok: false; reason: 'empty' | 'not_a_number' | 'too_small' | 'too_big' };
/** What was typed in «גודל יעד (מ״ב)»: digits with an optional decimal point or comma; the schema's range is 1 to 4,000 MB. */
export function parseTargetMb(text: string): TargetParse {
  const s = text.trim().replace(',', '.');
  if (s === '') return { ok: false, reason: 'empty' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'not_a_number' };
  const bytes = bytesOfMb(Number(s));
  if (bytes < SEND_FIT.minTargetBytes) return { ok: false, reason: 'too_small' };
  if (bytes > SEND_FIT.maxTargetBytes) return { ok: false, reason: 'too_big' };
  return { ok: true, bytes };
}

/** What the plan route said about the fit, reduced to what the sheet shows. */
export type FitView =
  | { kind: 'none' }
  | { kind: 'checking' }
  | { kind: 'plan'; width: number; height: number; scale: number; targetBytes: number }
  | { kind: 'refused'; code: string; message: string; hint: string | null; minBytes: number | null }
  | { kind: 'unknown' };
/** The body of POST /exports/plan (manifest.fit, blockers) as a view. A blocker about the fit wins; any other blocker is the sheet's own business. */
export function readFitPlan(body: unknown): FitView {
  const b = body as { manifest?: { fit?: { width?: unknown; height?: unknown; scale?: unknown; targetBytes?: unknown } }; blockers?: { code?: unknown; message?: unknown; hint?: unknown; minBytes?: unknown }[] } | null;
  const blockers = Array.isArray(b?.blockers) ? b!.blockers! : [];
  const bad = blockers.find((x) => typeof x.code === 'string' && x.code.startsWith('size_fit'));
  if (bad) return { kind: 'refused', code: String(bad.code), message: String(bad.message ?? ''), hint: typeof bad.hint === 'string' ? bad.hint : null, minBytes: typeof bad.minBytes === 'number' ? bad.minBytes : null };
  const f = b?.manifest?.fit;
  if (f && typeof f.width === 'number' && typeof f.height === 'number' && typeof f.scale === 'number' && typeof f.targetBytes === 'number') return { kind: 'plan', width: f.width, height: f.height, scale: f.scale, targetBytes: f.targetBytes };
  return { kind: 'unknown' };
}
/** The fitted picture is smaller than the project's own when the plan's size differs from the asked size. */
export const isShrunk = (v: Extract<FitView, { kind: 'plan' }>, asked: { width: number; height: number }) => v.width !== asked.width || v.height !== asked.height;

/** The job's fit as the file card's line: bytes, the target and the attempt that succeeded (the last one made). */
export function fitLineParts(fit: { targetBytes: number; bytes: number; attempts: unknown[]; result: string } | null | undefined): { got: string; target: string; attempt: number; already: boolean } | null {
  if (!fit || typeof fit.bytes !== 'number' || typeof fit.targetBytes !== 'number') return null;
  return { got: fmtMb(fit.bytes), target: sayMb(fit.targetBytes), attempt: Math.max(1, Array.isArray(fit.attempts) ? fit.attempts.length : 1), already: fit.result === 'already_fits' };
}

// ---------------------------------------------------------------- the export report
/** "1:07.3": a time of the film as the sheet's other lists write it. */
export function clockOf(t: RationalTime): string {
  const v = Number(t.value) / t.timescale;
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(1).padStart(4, '0')}`;
}
/** The frame a time falls in, exactly (rational arithmetic; never a float second). */
export function frameAt(t: RationalTime, rate: { num: number; den: number }): number {
  const n = BigInt(t.value) * BigInt(rate.num), d = BigInt(t.timescale) * BigInt(rate.den);
  const q = n / d;
  return Number(n < 0n && n % d !== 0n ? q - 1n : q);
}
export interface FindingRow { key: string; kind: ExportFinding['kind']; from: RationalTime; to: RationalTime; fromText: string; toText: string; frame: number; context: ExportFinding['context'] | null; soundPlays: boolean | null; measured: string }
const lt = (a: RationalTime, b: RationalTime) => BigInt(a.value) * BigInt(b.timescale) < BigInt(b.value) * BigInt(a.timescale);
/** Every finding of the report, earliest first, with the measurement behind it as "name value" pairs. */
export function findingRows(checks: ExportChecks | null | undefined, rate: { num: number; den: number }): FindingRow[] {
  if (!checks) return [];
  const all = [...checks.picture.findings, ...checks.sound.findings];
  all.sort((a, b) => (lt(a.from, b.from) ? -1 : lt(b.from, a.from) ? 1 : 0));
  return all.map((f, i) => ({
    key: `${f.kind}:${f.from.value}/${f.from.timescale}:${i}`, kind: f.kind, from: f.from, to: f.to, fromText: clockOf(f.from), toText: clockOf(f.to), frame: frameAt(f.from, rate),
    context: f.context ?? null, soundPlays: f.soundPlays ?? null,
    measured: Object.entries(f.measured ?? {}).map(([k, v]) => `${k} ${Number.isInteger(v) ? v : Number(v.toFixed(3))}`).join(' · '),
  }));
}
/** How many findings a job's report holds (0 for no report: an old export, or a part that did not measure). */
export const findingCount = (checks: ExportChecks | null | undefined) => (checks ? checks.picture.findings.length + checks.sound.findings.length : 0);
/** The kinds a quiet report may name: only the ones whose part measured (never "fine" for a part that did not look). */
export function lookedKinds(checks: ExportChecks): { kinds: ExportFinding['kind'][]; allMeasured: boolean } {
  const pic = checks.picture.status === 'measured', snd = checks.sound.status === 'measured';
  return { kinds: checks.lookedFor.filter((k) => (k === 'black' || k === 'frozen' ? pic : snd)), allMeasured: pic && snd };
}

// ---------------------------------------------------------------- the limiter and its meter
export const LIMITER_MIN = -9, LIMITER_MAX = 0;
/** The ceiling a new limiter starts at: the loudness target's true peak, else −1 dB. */
export const defaultCeiling = (doc: Pick<ProjectDocument, 'settings'>) => Math.min(LIMITER_MAX, Math.max(LIMITER_MIN, doc.settings.loudness?.truePeak ?? -1));
/** A typed ceiling in −9…0 dB, or null for anything else. */
export function parseCeiling(text: string): number | null {
  const s = text.trim().replace(',', '.').replace('−', '-');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v >= LIMITER_MIN && v <= LIMITER_MAX ? Math.round(v * 10) / 10 : null;
}
/** The reduction bar: 0 to 100 % of a 12 dB scale (a reduction past that is full). null (no limiter running) is no bar. */
export const reductionPct = (db: number | null) => (db === null ? null : Math.min(100, Math.max(0, (-db / 12) * 100)));

/** What the meter says about the limiter. */
export type LimiterState = 'off' | 'on' | 'unavailable';
export function limiterState(ceiling: number | null, unavailable: string | null, active: boolean): LimiterState {
  if (ceiling === null) return 'off';
  return unavailable || !active ? 'unavailable' : 'on';
}

// ---------------------------------------------------------------- the clip loudness match
export interface MeasuredClip { clipId: string; label: string; row: ClipLoudnessRow }
export const usable = (r: ClipLoudnessRow): r is ClipLoudnessRow & { measuredLufs: number; peakDbfs: number } => (r.status === 'measured' || r.status === 'short') && r.measuredLufs !== null && r.peakDbfs !== null;
/** The target offered: the median of the measured clips; −18 LUFS for a single one. */
export function defaultMatchTarget(rows: ClipLoudnessRow[], median: number | null): number | null {
  const ok = rows.filter(usable);
  if (ok.length === 0) return null;
  if (ok.length === 1) return LOUDNESS_MATCH.singleClipTarget;
  return median ?? medianLufs(ok.map((r) => r.measuredLufs));
}
/** A typed target in −40…−5 LUFS, or null. */
export function parseTarget(text: string): number | null {
  const s = text.trim().replace(',', '.').replace('−', '-');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v >= -40 && v <= -5 ? v : null;
}
export interface MatchPlanRow { clipId: string; from: number; to: number; changeDb: number; limitedBy: MatchClipOutput['limitedBy'] }
/** What the op will do, with the same function the op runs (core planMatchGain), so the preview cannot disagree with the commit. */
export function planMatch(doc: Pick<ProjectDocument, 'settings'>, rows: ClipLoudnessRow[], target: number): MatchPlanRow[] {
  const ceiling = matchCeiling(doc);
  return rows.filter(usable).map((r) => planMatchGain({ clipId: r.clipId, measuredLufs: r.measuredLufs, peakDbfs: r.peakDbfs, gain: r.gain } satisfies MatchClipInput, target, ceiling));
}
/** The op's arguments, from the measurement: one transaction for every clip that could be measured. */
export function matchOpArgs(rows: ClipLoudnessRow[], target: number) {
  return { target, clips: rows.filter(usable).map((r) => ({ clipId: r.clipId, measuredLufs: r.measuredLufs, peakDbfs: r.peakDbfs, gain: r.gain })) };
}
/** Clips that are in the selection but not in the plan, with the measurement's own reason. */
export const skippedRows = (rows: ClipLoudnessRow[]) => rows.filter((r) => !usable(r));
/** Clips of a track that carry sound (the per-track button's selection); the measurement says which of them can be matched. */
export function trackClipIds(track: { clips: { id: string; type: string }[] }): string[] { return track.clips.filter((c) => c.type === 'media').map((c) => c.id).slice(0, LOUDNESS_MATCH.maxClips); }
export const fmtLufs = (v: number) => v.toFixed(1).replace('-', '−');
export const fmtDbSigned = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
