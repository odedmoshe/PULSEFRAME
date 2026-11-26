/**
 * Pure logic of the export sheet (UX_REDESIGN §4.12): what a job's stage means as progress, which formats a project can be
 * exported in, what a destination card sets, and what the sheet may claim. No React and no I/O, so it is unit-tested.
 * Nothing here estimates what the server has not measured: no time estimate exists without measured history, and a size
 * is shown only when the server's plan carries one.
 */
import type { ExportRequest } from './store.ts';
import { FORMAT_PROFILES, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { isShortActive, loudnessOps } from './shorts.view.ts';

export const ACTIVE_JOB = ['queued', 'running', 'cancel-requested'] as const;
export const isActiveJob = (status: string) => (ACTIVE_JOB as readonly string[]).includes(status);

export interface JobView { id: string; status: string; stage: string | null; output: unknown; error: unknown }
/**
 * Fold fresher views of jobs into the list the sheet holds RIGHT NOW, by id. The list is never replaced by an older copy: a job added
 * after a poll began stays, and a job that has already finished is not taken back to a running state by a late answer.
 */
export function mergeJobViews<J extends JobView>(current: J[], views: JobView[]): J[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  return current.map((j) => {
    const v = byId.get(j.id);
    if (!v || !isActiveJob(j.status)) return j;
    return { ...j, status: v.status, stage: v.stage, output: v.output, error: v.error };
  });
}

/**
 * The jobs the sheet shows when it opens. The sheet's own run is kept while it is running, or when the top bar's chip asks for
 * the last run (`last`). The chip follows the newest export of the project (`followed`), which the sheet may not have started: one
 * the agent started over MCP or REST, another tab's, or one still running after a reload. Asked for by the chip, that one is
 * shown too (next to the sheet's own running files, or in place of a finished run), so its progress, cancel, file and retry are
 * there; otherwise a finished run is cleared and the sheet opens on its settings.
 */
export function jobsOnOpen<J extends JobView>(jobs: J[], opts: { last?: boolean }, followed: J | null): J[] {
  const running = jobs.some((j) => isActiveJob(j.status));
  if (opts.last && followed && !jobs.some((j) => j.id === followed.id)) return running ? [...jobs, followed] : [followed];
  return running || (opts.last && jobs.length) ? jobs : [];
}
/**
 * How the sheet names an export it did not start, from the options the server stored with it (GET /jobs/:id `options`): the
 * format it was made for, its file type and its size. Without options (not fetched yet) it is the project's own shape.
 */
export function describeExport(doc: ProjectDocument, options: { variantId?: unknown; format?: unknown; scale?: unknown } | null | undefined, lang: 'he' | 'en'): { label: string; variantId: string | null; ext: string; w: number; h: number } {
  const targets = exportTargets(doc);
  const variantId = typeof options?.variantId === 'string' ? options.variantId : null;
  const t = (variantId && targets.find((x) => x.variantId === variantId)) || targets[0]!;
  const scale: ExportScale = options?.scale === 0.5 || options?.scale === 0.25 ? options.scale : 1;
  const size = scaledSize(t, scale);
  return { label: t.name[lang], variantId: t.variantId, ext: options?.format === 'webm-vp9-opus' ? 'webm' : 'mp4', w: size.width, h: size.height };
}

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
/** `targetBytes`: the size a «מתאים לשליחה» export must fit (null: none chosen, which the sheet will not export). */
export interface ExportChoices { quality: ExportQuality; captions: ExportCaptions; format: ExportFormat; scale: ExportScale; targetBytes: number | null }
export const DEFAULT_CHOICES: ExportChoices = { quality: 'standard', captions: 'burned', format: 'mp4-h264-aac', scale: 1, targetBytes: null };

/** The body of POST /exports. Defaults are left out, so a plain export sends exactly what the editor's own button always sent. */
export function exportOptions(c: ExportChoices, variantId: string | null): ExportRequest {
  const o: ExportRequest = {};
  if (variantId) o.variantId = variantId;
  if (c.quality !== 'high') o.quality = c.quality;
  if (c.captions !== 'burned') o.captions = c.captions;
  if (c.format !== 'mp4-h264-aac') o.format = c.format;
  if (c.scale !== 1) o.scale = c.scale;
  // a target size (wave 7 send): the server picks the picture size and the rates, and renders at full quality first
  if (c.targetBytes !== null) o.sizeFit = { targetBytes: c.targetBytes };
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
  for (const v of variants) out.push({ key: variantTargetKey(v.id), kind: 'variant', variantId: v.id, profileId: v.profileId ?? null, width: v.width, height: v.height, fit: v.fit, name: aspectName(v.width, v.height, v.name) });
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
  // «מתאים לשליחה»: a size is required and nothing is preselected (targetBytes stays null until the owner picks or types one); the scale is the largest the fit may use
  { id: 'whatsapp', format: 'master', choices: { quality: 'high', scale: 1, format: 'mp4-h264-aac', targetBytes: null } },
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
/** What choosing destination `d` sets in the sheet (a click on its tile, or openExportSheet({ destination })): the destination, its format when the project has it, and its quality and size over the current choices. */
export function destinationPick(d: Destination, targets: ExportTarget[], choices: ExportChoices): { dest: Destination['id']; keys?: string[]; choices: ExportChoices } {
  const key = destinationKey(d, targets);
  return { dest: d.id, ...(key ? { keys: [key] } : {}), choices: { ...choices, targetBytes: null, ...d.choices } };
}

/** The export target key of a linked format or a version for an audience (exportTargets' `variant:` rows). */
export const variantTargetKey = (variantId: string): string => `variant:${variantId}`;
/**
 * What the sheet chooses when it is opened ON a version (the audience panel's «לשליחה»): that version's target alone, as a click on its
 * format row would leave it (a custom destination, so no target size is carried over). A key the project no longer has is dropped by the
 * sheet's own check (back to the master), so a version removed meanwhile never exports something else silently.
 */
export function variantPick(variantId: string, choices: ExportChoices): { dest: 'custom'; keys: string[]; choices: ExportChoices } {
  return { dest: 'custom', keys: [variantTargetKey(variantId)], choices: { ...choices, targetBytes: null } };
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

/**
 * The "also in another shape" suggestion after an export: the first format of the other orientation (a vertical one for a wide
 * project and the reverse) that this run did not export. A linked format is preferred over one that would be created. null when
 * the run already covered every other shape, or the project is square.
 */
export function alsoSuggestion(targets: ExportTarget[], exportedVariantIds: ReadonlySet<string | null>): ExportTarget | null {
  const master = targets[0];
  if (!master || master.width === master.height) return null;
  const tall = master.height > master.width;
  const done = (t: ExportTarget) => (t.kind === 'master' ? exportedVariantIds.has(null) : t.variantId !== null && exportedVariantIds.has(t.variantId));
  const other = targets.filter((t) => t.kind !== 'master' && (t.height > t.width) !== tall && t.height !== t.width && !done(t));
  return other.find((t) => t.kind === 'variant') ?? other[0] ?? null;
}

/**
 * The label of a preflight fix button in the interface language. The server words its fixes in English (apps/server/src/preflight.ts);
 * each wording it can send is recognised here and said from the strings. A label that is not recognised is shown as the server sent it.
 */
export function fixLabel(F: { removeStretch: string; removeTransition: string; removeRamp: string; shorten: (m: string) => string; lowerRamp: (v: string) => string; atVelocity: (v: string) => string; noRamp: string; noBeatLock: string; and: string }, serverLabel: string): string {
  if (serverLabel === 'Remove this stretch from every track') return F.removeStretch;
  if (serverLabel === 'Remove the transition') return F.removeTransition;
  if (serverLabel === 'Remove the velocity ramp') return F.removeRamp;
  const ramp = /^Lower the velocity ramp to ×(\d+)$/.exec(serverLabel);
  if (ramp) return F.lowerRamp(ramp[1]!);
  const sh = /^Shorten the transition to (\d+) frames(?:, (.+))?$/.exec(serverLabel);
  if (sh) {
    const parts = (sh[2] ?? '').split(' and ').filter(Boolean).map((x) => { const v = /^at velocity ×(\d+)$/.exec(x); return v ? F.atVelocity(v[1]!) : x === 'without its velocity ramp' ? F.noRamp : x === 'without the beat lock' ? F.noBeatLock : x; });
    return parts.length ? `${F.shorten(sh[1]!)}, ${parts.join(F.and)}` : F.shorten(sh[1]!);
  }
  return serverLabel;
}

/** Why the sheet will not start yet because of the «מתאים לשליחה» tile, or null: a size must be chosen first. */
export function sendBlock(dest: Destination['id'] | null, choices: Pick<ExportChoices, 'targetBytes'>): 'choose_size' | null {
  return dest === 'whatsapp' && choices.targetBytes === null ? 'choose_size' : null;
}
/** Job stage words of the size fit ('fitting size 1/2', 'checking size', 'checking the export'), for the progress line. */
export const isFitStage = (stage: string | null | undefined) => !!stage && /^(fitting size|checking size|checking the export)( |$)/.test(stage);

/**
 * The output the sheet's loudness row measures and what its «יישור ל־14−» commits (wave 8 qc, verifier C2): the CHOSEN output, as
 * export renders it — the short on screen (a short exports as itself, store.startExport) and the lead format or audience version.
 * On a short the fix sets that short's own target (update_sequence format.loudness), never the project's; otherwise the project's.
 */
export function loudnessCheckOf(raw: ProjectDocument | null, activeSequenceId: string, variantId: string | null | undefined): { sequenceId: string | null; variantId: string | null; fix: (target: number) => OpCall[] } {
  const sequenceId = isShortActive(raw, activeSequenceId) ? activeSequenceId : null;
  return { sequenceId, variantId: variantId ?? null, fix: (target) => (raw ? loudnessOps(raw, activeSequenceId, target) : [{ op: 'set_loudness_target', args: { target } }]) };
}
