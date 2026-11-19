/**
 * "Check again" in the AI tools panel, kept apart from the panel so it can be tested without a browser.
 * A check that fails (the server is still restarting, the session is no longer known) says nothing about the provider, so
 * it must not change what the panel shows: the setup steps, the failure and the button to try again all stay.
 */
import * as T from '@pulseframe/time';
import { clipEnd, findClip, readingSpeedIssues, sourceAt, staleTranslations, transcriptFor, type Asset, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { ApiFailure, type JobEvent } from '../api.ts';
import type { Attachment, CapInfo, JobProgress, RunSource, SetupState } from './api.ts';

export interface ProviderShape { provider: { configured: boolean; readiness?: { reachable: boolean } | null } }
export type RecheckResult<P> = { ok: true; provider: P; connected: boolean } | { ok: false; error: unknown };

export async function recheckProvider<P extends ProviderShape>(fetchCapabilities: () => Promise<P>): Promise<RecheckResult<P>> {
  try {
    const provider = await fetchCapabilities();
    return { ok: true, provider, connected: provider.provider.configured && !!provider.provider.readiness?.reachable };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The provider state the panel shows after a check: the fresh answer, or exactly what it showed before when the check failed. */
export const providerAfter = <P>(shown: P, r: RecheckResult<P>): P => (r.ok ? r.provider : shown);

/** Why a request for the provider state failed, as the panel says it: the server's refusal code, or none when it did not answer. */
export interface ProviderFailure { code: string | null; message: string }
export function failureOf(e: unknown): ProviderFailure {
  if (e instanceof ApiFailure) return { code: e.code, message: e.message };
  return { code: null, message: e instanceof Error ? e.message : String(e) };
}

/**
 * The latest event of each recent capability job, by id: the event just received replaces that job's earlier one and becomes
 * the newest; only the newest `keep` jobs are kept. Events of several jobs that arrive together are all kept, so a panel
 * that started one of them still sees how it ended.
 */
export function rememberJob(all: Readonly<Record<string, JobEvent>>, j: JobEvent, keep = 30): Record<string, JobEvent> {
  const next: Record<string, JobEvent> = { ...all };
  delete next[j.id];
  next[j.id] = j;
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) delete next[id];
  return next;
}

/**
 * The job a tool card shows: the one this panel started for that tool, as its latest event says, or none. A capability job
 * started by anyone else (an agent, another tool, another tab) is not shown on a card: the job events do not say which tool
 * they belong to, and the card speaks only of what its own button did.
 */
export const cardJob = (capabilityId: string, started: Readonly<Record<string, string>>, jobs: Readonly<Record<string, JobEvent>>): JobEvent | null => {
  const id = started[capabilityId];
  return id ? jobs[id] ?? null : null;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// AI-model wave (ADR-0017): the pure parts of the AI tools panel, run sheet, compare slider and translation review, testable
// without a browser (aiTools.recheck.test.ts).
// ---------------------------------------------------------------------------------------------------------------------------------

export const AI_TABS = ['image', 'video', 'sound', 'captions'] as const;
export type AiTab = (typeof AI_TABS)[number];
/** Which tab a tool belongs to: captions for translation, sound for the voice and vocal tools, video for frame jobs, image otherwise. */
export function tabOf(c: Pick<CapInfo, 'provider' | 'task' | 'frames' | 'inputs' | 'outputs'>): AiTab {
  if (c.task === 'translate') return 'captions';
  if (c.task === 'voice-clean' || c.task === 'vocals-classic') return 'sound';
  if (c.frames || c.inputs?.some((i) => i.type === 'video')) return 'video';
  if (c.inputs?.some((i) => i.type === 'transcript')) return 'captions';
  if (c.inputs?.some((i) => i.type === 'audio') || (c.outputs?.length && c.outputs.every((o) => o.mediaType === 'audio'))) return 'sound';
  return 'image';
}
/** The setup state a card shows: the server's own when it sends one, otherwise derived from the provider probe and the model files. */
export function setupOf(c: Pick<CapInfo, 'setup' | 'provider' | 'models' | 'missingDownloadBytes'>, provider: { configured: boolean; readiness?: { reachable: boolean } | null } | null): SetupState {
  if (c.setup) return c.setup;
  if ((c.provider ?? 'comfyui') === 'comfyui') {
    if (!provider?.configured) return { code: 'provider_not_configured', detail: 'PF_COMFYUI_URL is not set' };
    if (!provider.readiness?.reachable) return { code: 'provider_unreachable', detail: 'ComfyUI does not answer' };
  }
  const missing = (c.models ?? []).filter((m) => m.status && m.status.state !== 'ready');
  if (missing.length) return { code: 'model_missing', detail: missing.map((m) => m.path).join(', '), missingBytes: c.missingDownloadBytes ?? missing.reduce((n, m) => n + (m.status?.missingBytes ?? 0), 0) };
  return { code: 'ready', detail: 'ready' };
}
/** True when the tool would run on this computer's processor (a CPU device, or an engine that only has one). */
export function runsOnCpu(c: Pick<CapInfo, 'task'>, setup: SetupState, providerDeviceType: string | null | undefined): boolean {
  if (c.task === 'voice-clean' || c.task === 'vocals-classic') return true; // ffmpeg and deep-filter run on the processor only
  const dev = c.task ? setup.device : providerDeviceType;
  return typeof dev === 'string' && /^cpu\b/i.test(dev);
}

/** The progress a job reports (job.output.progress), when it is a usable measured count. */
export function progressOf(output: unknown): JobProgress | null {
  const p = (output as { progress?: Partial<JobProgress> } | null)?.progress;
  if (!p || p.basis !== 'measured' || !['frames', 'chunks', 'phrases', 'samples'].includes(p.unit as string)) return null;
  if (!Number.isInteger(p.done) || !Number.isInteger(p.total) || p.total! <= 0 || p.done! < 0) return null;
  return { unit: p.unit!, done: Math.min(p.done!, p.total!), total: p.total!, basis: 'measured' };
}
/** Seconds of sound for a sample count (the sound tools count 48 kHz samples), to one decimal. */
export const samplesToSeconds = (n: number, rate = 48000) => Math.round((n / rate) * 10) / 10;

/**
 * The ordinary ops that place a result the server kept as a proposal ("place anyway"): the clip shows the result
 * (replace_clip_asset, plus the slow-motion speed), or a new clip on its own track. None for anything else (a translation is
 * stored by an internal op only the server commits).
 */
const PLACE_OPS = new Set(['replace_clip_asset', 'add_clip']);
export function placeAnywayOps(a: Attachment | null | undefined): OpCall[] | null {
  if (!a || a.status !== 'proposed' || !a.assetId || !a.proposal) return null;
  const p = a.proposal as { mode?: string; clipId?: string | null; start?: unknown; sourceIn?: unknown; duration?: unknown; speed?: number; op?: string };
  // a proposal already written as one public op (the local tools keep { op: 'replace_clip_asset', args }); an internal op is not offered
  if (typeof p.op === 'string') return PLACE_OPS.has(p.op) && (a.proposal as { args?: unknown }).args ? [{ op: p.op, args: (a.proposal as { args: unknown }).args }] : null;
  if (p.mode === 'replace-clip' && typeof p.clipId === 'string') {
    return [{ op: 'replace_clip_asset', args: { clipId: p.clipId, assetId: a.assetId } }, ...(typeof p.speed === 'number' ? [{ op: 'set_clip_speed', args: { clipId: p.clipId, speed: p.speed } }] : [])];
  }
  if (p.mode === 'new-track' && p.start) {
    return [{ op: 'add_clip', args: { assetId: a.assetId, start: p.start, ...(p.sourceIn ? { sourceIn: p.sourceIn } : {}), ...(p.duration ? { duration: p.duration } : {}), withLinkedAudio: false } }];
  }
  return null;
}

/** What a cancel answer means, in the words the card uses (unknown outcomes are shown as the server wrote them). */
export type CancelMeaning = 'stopped' | 'removed' | 'requested' | 'finished' | 'not-supported' | 'other';
export function cancelMeaning(outcome: string): CancelMeaning {
  if (outcome === 'local' || outcome === 'killed') return 'stopped';
  if (outcome === 'removed-from-queue') return 'removed';
  if (outcome === 'requested' || outcome === 'interrupt-requested' || outcome === 'stopping' || outcome.startsWith('stop-at-chunk-boundary') || outcome.startsWith('running-chunk-not-interrupted')) return 'requested';
  if (outcome === 'already-finished' || outcome === 'completed-before-cancel-took-effect') return 'finished';
  if (outcome === 'not-supported' || outcome === 'not-found') return 'not-supported';
  return 'other';
}

/**
 * Keyboard of the compare slider beyond what a native range input does: Shift with an arrow moves 10 % (the arrows alone move 1 %,
 * Home and End go to the ends natively). Returns the new value, or null when the key is left to the browser.
 */
export function compareStep(key: string, shift: boolean, value: number, rtl = false): number | null {
  if (!shift) return null;
  const sign = key === 'ArrowUp' || key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : key === 'ArrowDown' || key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
  if (!sign) return null;
  return Math.max(0, Math.min(100, Math.round(value) + sign * 10));
}

// ---------- sources ----------
/** Frame rate a source range of an asset is counted in (the server's rule: the picture's own rate, else the project's). */
export const rateOfAsset = (doc: ProjectDocument, a: Asset) => a.video?.frameRate ?? doc.settings.frameRate;
/** Whole frames of an asset at that rate. */
export const framesOfAsset = (doc: ProjectDocument, a: Asset) => (a.kind === 'image' ? 1 : T.frameCount(a.duration, rateOfAsset(doc, a)));
/** Library files a tool of this tab can read. */
export function assetsFor(doc: ProjectDocument, tab: AiTab): Asset[] {
  return Object.values(doc.assets).filter((a) => tab === 'image' ? a.kind === 'image' : tab === 'video' ? !!a.video && a.kind !== 'image' : tab === 'sound' ? !!a.audio : !!transcriptFor(doc, a.id));
}
/** The selected timeline clip, when a tool of this tab can read it. */
export function clipFor(doc: ProjectDocument, clipId: string | undefined, tab: AiTab): MediaClip | null {
  const f = clipId ? findClip(doc, clipId) : undefined;
  if (!f || f.clip.type !== 'media') return null;
  const a = doc.assets[f.clip.assetId];
  if (!a) return null;
  const ok = tab === 'image' ? a.kind === 'image' : tab === 'video' ? !!a.video && a.kind !== 'image' && f.track.kind === 'video' : tab === 'sound' ? !!a.audio && f.track.kind === 'audio' : !!transcriptFor(doc, a.id);
  return ok ? (f.clip as MediaClip) : null;
}
export type SourceChoice = { kind: 'clip'; clipId: string } | { kind: 'asset'; assetId: string; inFrame?: number; outFrame?: number };
/** The RunSource of a choice; a range only when it is a strict part of the file (in < out, inside it). null when the choice is not valid. */
export function runSourceOf(doc: ProjectDocument, c: SourceChoice): RunSource | null {
  if (c.kind === 'clip') return findClip(doc, c.clipId) ? { clipId: c.clipId } : null;
  const a = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId] : undefined;
  if (!a) return null;
  if (a.kind === 'image' || (c.inFrame === undefined && c.outFrame === undefined)) return { assetId: a.id };
  const total = framesOfAsset(doc, a);
  const first = c.inFrame ?? 0, end = c.outFrame ?? total;
  if (!Number.isInteger(first) || !Number.isInteger(end) || first < 0 || end > total || end <= first) return null;
  if (first === 0 && end === total) return { assetId: a.id };
  return { assetId: a.id, range: { firstFrame: first, frameCount: end - first } };
}
/**
 * Where the playhead is in the result and in the original, for the compare view of a clip that now shows a result made from its
 * file: the result's own time, and that time plus where the result starts on the original's clock. null when the playhead is not on it.
 */
export function compareTimes(doc: ProjectDocument, clipId: string, playhead: T.RationalTime): { after: number; before: number } | null {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media' || T.lt(playhead, f.clip.start) || !T.lt(playhead, clipEnd(f.clip))) return null;
  const t = sourceAt(f.clip as MediaClip, playhead);
  const off = doc.assets[(f.clip as MediaClip).assetId]?.provenance.derived?.sourceRangeStart;
  return { after: T.toSeconds(t), before: T.toSeconds(off ? T.add(t, off) : t) };
}

// ---------- translation review ----------
export interface ReviewRow { id: string; kind: 'phrase' | 'cue'; master: string; translated: string | null; stale: boolean; cps: number | null; limit: number | null; assetId?: string }
/**
 * The rows of a translation, side by side: every translated phrase or cue with the master text as it is now, the translated text,
 * and the flags (stale: the master changed after it was translated; fast: above the reading-speed limit of the variant's language).
 */
export function reviewRows(doc: ProjectDocument, variantId: string, limits: Record<string, number>): ReviewRow[] {
  // Ids are data (an imported project can call a phrase «constructor»): every lookup by id is an own-property lookup.
  const own = <V>(o: Record<string, V> | undefined, id: string): V | undefined => (o && Object.hasOwn(o, id) ? o[id] : undefined);
  const v = own(doc.variants, variantId);
  const tl = v?.translation;
  if (!v || !tl) return [];
  const stale = new Set(staleTranslations(doc, variantId));
  const fast = new Map(readingSpeedIssues(doc, variantId, limits).map((x) => [x.id, x]));
  const rows: ReviewRow[] = [];
  const ids = Object.keys(tl.sources);
  const seg = new Map<string, { text: string; assetId: string }>();
  for (const [assetId, tr] of Object.entries(doc.transcripts ?? {})) for (const s of tr.segments) seg.set(s.id, { text: s.text, assetId });
  const cues = new Map<string, { text: string; start: T.RationalTime }>();
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.type === 'caption') cues.set(c.id, { text: c.text, start: c.start });
  for (const id of ids) {
    const f = fast.get(id);
    if (seg.has(id) || Object.hasOwn(v.phraseText ?? {}, id)) {
      const s = seg.get(id);
      rows.push({ id, kind: 'phrase', master: s?.text ?? '', translated: own(v.phraseText, id) ?? null, stale: stale.has(id), cps: f?.cps ?? null, limit: f?.limit ?? null, ...(s ? { assetId: s.assetId } : {}) });
    } else {
      rows.push({ id, kind: 'cue', master: cues.get(id)?.text ?? '', translated: own(v.overrides, id)?.text ?? null, stale: stale.has(id), cps: f?.cps ?? null, limit: f?.limit ?? null });
    }
  }
  return rows;
}
/** What is still open before exporting this translation, preflight-style: the unreviewed mark, then each stale, too fast or missing row. */
export function openItems(doc: ProjectDocument, variantId: string, rows: ReviewRow[]): { kind: 'unreviewed' | 'stale' | 'fast' | 'missing'; id: string | null }[] {
  const tl = doc.variants && Object.hasOwn(doc.variants, variantId) ? doc.variants[variantId]!.translation : undefined;
  if (!tl) return [];
  const out: { kind: 'unreviewed' | 'stale' | 'fast' | 'missing'; id: string | null }[] = [];
  if (tl.review !== 'reviewed') out.push({ kind: 'unreviewed', id: null });
  for (const r of rows) {
    if (r.translated === null || !r.translated.trim()) out.push({ kind: 'missing', id: r.id });
    if (r.stale) out.push({ kind: 'stale', id: r.id });
    if (r.cps !== null) out.push({ kind: 'fast', id: r.id });
  }
  return out;
}
/** Reading-speed limits per language: a setting of this browser (SPEC §16: no universal number), 20 characters per second until changed. */
export const DEFAULT_READING_LIMIT = 20;
const LIMITS_KEY = 'pf.ai.readingLimits.v1';
export function readReadingLimits(): Record<string, number> {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(LIMITS_KEY) ?? 'null') as Record<string, unknown> | null;
    const out: Record<string, number> = {};
    if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(k) && typeof n === 'number' && n >= 5 && n <= 60) out[k] = n;
    return out;
  } catch { return {}; }
}
export function writeReadingLimit(lang: string, cps: number): void {
  try { globalThis.localStorage?.setItem(LIMITS_KEY, JSON.stringify({ ...readReadingLimits(), [lang]: cps })); } catch { /* storage unavailable */ }
}
/** The limit used for a language: this browser's setting, else the default. */
export const readingLimitFor = (limits: Record<string, number>, lang: string) => limits[lang] ?? limits[lang.split('-')[0]!] ?? DEFAULT_READING_LIMIT;
