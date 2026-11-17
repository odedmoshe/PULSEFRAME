/**
 * Pure logic of the export sheet (UX_REDESIGN §4.12): what a job's stage means as progress, which formats a project can be
 * exported in, what a destination card sets, and what the sheet may claim. No React and no I/O, so it is unit-tested.
 * Nothing here estimates what the server has not measured: no time estimate exists without measured history, and a size
 * is shown only when the server's plan carries one.
 */
import { FORMAT_PROFILES, type ProjectDocument } from '@pulseframe/core';

export const ACTIVE_JOB = ['queued', 'running', 'cancel-requested'] as const;
export const isActiveJob = (status: string) => (ACTIVE_JOB as readonly string[]).includes(status);

/** The words the server reports as a job's stage, in the order an export passes through them. */
export const STAGE_ORDER = ['preparing', 'rendering audio', 'rendering', 'encoding', 'validating'] as const;
export type StageId = (typeof STAGE_ORDER)[number];

export interface StageInfo {
  /** the known stage word, or null before the first one is reported */
  id: StageId | null;
  /** index into STAGE_ORDER (-1 before the first stage) */
  index: number;
  /** frames done and in total while the picture is being drawn ("rendering 557/870") */
  done: number | null;
  total: number | null;
}
/** "rendering 557/870" -> the stage, and the frame counts. Unknown words give id null (shown as the raw word elsewhere). */
export function parseStage(stage: string | null | undefined): StageInfo {
  if (!stage) return { id: null, index: -1, done: null, total: null };
  const id = [...STAGE_ORDER].sort((a, b) => b.length - a.length).find((w) => stage === w || stage.startsWith(`${w} `)) ?? null;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(stage);
  return { id, index: id ? STAGE_ORDER.indexOf(id) : -1, done: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null };
}

export interface JobLike { status: string; stage: string | null }
/**
 * Progress of one job in 0..1, or null while it is only preparing (no number is invented). The picture is the long part, so
 * it counts for 0..0.92; encoding and checking the file are the rest. A finished job is 1.
 */
export function jobFraction(job: JobLike): number | null {
  if (job.status === 'succeeded') return 1;
  const s = parseStage(job.stage);
  if (s.id === 'rendering' && s.done != null && s.total) return Math.min(1, s.done / s.total) * 0.92;
  if (s.id === 'encoding') return 0.94;
  if (s.id === 'validating') return 0.98;
  return null;
}
/** The mean progress of several jobs, null while none of them has a number. Unstarted jobs count as 0 once another has one. */
export function overallFraction(jobs: JobLike[]): number | null {
  if (!jobs.length) return null;
  const parts = jobs.map(jobFraction);
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((s, p) => s + (p ?? 0), 0) / jobs.length;
}

export type ExportQuality = 'draft' | 'standard' | 'high';
export type ExportCaptions = 'burned' | 'sidecar-srt' | 'none';
export type ExportFormat = 'mp4-h264-aac' | 'webm-vp9-opus';
export type ExportScale = 1 | 0.5 | 0.25;
export interface ExportChoices { quality: ExportQuality; captions: ExportCaptions; format: ExportFormat; scale: ExportScale }
export const DEFAULT_CHOICES: ExportChoices = { quality: 'standard', captions: 'burned', format: 'mp4-h264-aac', scale: 1 };

/** The body of POST /exports. Defaults are left out, so a plain export sends exactly what the editor's own button always sent. */
export function exportOptions(c: ExportChoices, variantId: string | null): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (variantId) o.variantId = variantId;
  if (c.quality !== 'high') o.quality = c.quality;
  if (c.captions !== 'burned') o.captions = c.captions;
  if (c.format !== 'mp4-h264-aac') o.format = c.format;
  if (c.scale !== 1) o.scale = c.scale;
  return o;
}

/** A format the sheet can export: the master, a linked format of the project, or a profile that would be linked first. */
export interface ExportTarget {
  key: string;
  kind: 'master' | 'variant' | 'profile';
  variantId: string | null;
  profileId: string | null;
  width: number;
  height: number;
  fit: 'contain' | 'cover';
  name: { he: string; en: string };
}
export function exportTargets(doc: ProjectDocument): ExportTarget[] {
  const s = doc.settings;
  const out: ExportTarget[] = [{ key: 'master', kind: 'master', variantId: null, profileId: null, width: s.width, height: s.height, fit: s.fit ?? 'contain', name: aspectName(s.width, s.height) }];
  const variants = Object.values(doc.variants ?? {});
  for (const v of variants) out.push({ key: `variant:${v.id}`, kind: 'variant', variantId: v.id, profileId: v.profileId ?? null, width: v.width, height: v.height, fit: v.fit, name: aspectName(v.width, v.height, v.name) });
  for (const p of FORMAT_PROFILES) {
    const taken = variants.some((v) => v.profileId === p.id) || (p.width === s.width && p.height === s.height);
    if (!taken) out.push({ key: `profile:${p.id}`, kind: 'profile', variantId: null, profileId: p.id, width: p.width, height: p.height, fit: p.fit, name: aspectName(p.width, p.height) });
  }
  return out;
}
/** "אנכי 9:16" style words for a size, by its shape. A given name (a custom linked format) wins. */
export function aspectName(w: number, h: number, given?: string): { he: string; en: string } {
  const r = w / h;
  const [he, en, ratio] = Math.abs(r - 9 / 16) < 0.02 ? ['אנכי', 'Vertical', '9:16'] : Math.abs(r - 1) < 0.02 ? ['ריבוע', 'Square', '1:1'] : Math.abs(r - 16 / 9) < 0.02 ? ['רחב', 'Wide', '16:9'] : Math.abs(r - 4 / 5) < 0.02 ? ['פורטרט', 'Portrait', '4:5'] : ['מותאם', 'Custom', `${w}:${h}`];
  return given ? { he: given, en: given } : { he: `${he} ${ratio}`, en: `${en} ${ratio}` };
}

export interface Destination {
  id: 'reels' | 'youtube' | 'whatsapp' | 'computer' | 'custom';
  /** what it asks of the format: a profile id, or 'master' */
  format: string | null;
  choices: Partial<ExportChoices>;
}
export const DESTINATIONS: readonly Destination[] = [
  { id: 'reels', format: 'vertical-9x16', choices: { quality: 'standard', scale: 1, captions: 'burned' } },
  { id: 'youtube', format: 'landscape-16x9', choices: { quality: 'high', scale: 1 } },
  { id: 'whatsapp', format: 'master', choices: { quality: 'draft', scale: 0.5 } },
  { id: 'computer', format: 'master', choices: { quality: 'high', scale: 1 } },
  { id: 'custom', format: null, choices: {} },
];
/** The target key a destination points at in this project: its profile when it is linked or can be, else the master. */
export function destinationKey(d: Destination, targets: ExportTarget[]): string | null {
  if (d.format === null) return null;
  if (d.format === 'master') return 'master';
  const hit = targets.find((t) => t.profileId === d.format) ?? null;
  if (hit) return hit.key;
  // the profile has the master's own shape (a 16:9 project and "YouTube"): the master is that format
  const p = FORMAT_PROFILES.find((x) => x.id === d.format);
  return p && targets[0] && targets[0].width === p.width && targets[0].height === p.height ? 'master' : null;
}

/** Size of the output of a target at a scale: even numbers, as the server rounds them. */
export function scaledSize(t: { width: number; height: number }, scale: ExportScale): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(t.width), height: even(t.height) };
}
/** "1080p": the short side, the usual name of a video size. */
export const shortSideLabel = (t: { width: number; height: number }, scale: ExportScale) => { const s = scaledSize(t, scale); return `${Math.min(s.width, s.height)}p`; };
/** 4K (a short side of 2160) is offered only when the project's own size reaches it; otherwise it is shown disabled with its reason. */
export const fourKReachable = (t: { width: number; height: number }) => Math.min(t.width, t.height) >= 2160;

/** "37.6 MB" or "412 KB"; decimal units, as a file size on disk. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
/** "0:29" / "1:07" for a length in seconds. */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
