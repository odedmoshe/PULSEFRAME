/**
 * «ספרו מה היה» — the interface's pure logic (W3): choices → params, the dialog's blockers, the strip's order, the music line,
 * the recorder session (the privacy line: the engine's release() on every path), the saved recording's job, tap times, the tap
 * view's flow of planning and the comparison with the server's plan. No React here, so every rule has a unit test.
 *
 * The planner is a PORT (StoryPlannerPort): the components pass the real core functions (planStory, storyLiveDocument); the unit
 * tests pass the labelled double (packages/core/src/story.testDouble.ts). A planner that is not built answers StoryNotBuilt and the
 * view says so in words (isNotBuilt); nothing here makes a plan up.
 */
import {
  StoryNotBuilt, type Asset, type ProjectDocument, type RecipeRun, type StoryChip, type StoryParams, type StoryPlan, type StoryPlanContext, type StoryPlanView, type StoryApplyResult, type ImportJobView,
  STORY_RUN_RECIPE_ID, storyRunParams, storyRunPicked, StoryParamsSchema,
} from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { RECORDER_LIMITS, type RecorderPorts, type RecorderState, type StoryRecorderHandle } from './recorder.contract.ts';
import { clockOf, storyStrings, type StoryStrings } from './story.strings.ts';
import type { RevisionEvent } from '../../api.ts';
import type { StorySource } from '../store.ts';

type Lang = 'he' | 'en';

// ---------------------------------------------------------------------------------------------------------------------------
// choices → params
// ---------------------------------------------------------------------------------------------------------------------------
/** What the dialog holds: everything but the taps. */
export interface StoryChoices {
  narrationAssetId: string | null;
  /** Pictures and videos in show order. */
  assetIds: string[];
  musicAssetId: string | null;
  ownSound: 'under' | 'mute';
  openingTitle: boolean;
  openingText: string;
  event: StoryParams['event'] | null;
  lang: Lang;
}
export const isPictureAsset = (a: Asset | undefined): a is Asset => !!a && a.kind !== 'lut' && a.kind !== 'audio' && (!!a.video || !!a.image);
/** Sound files of the project (the narration and the music are chosen from these). */
export const soundFiles = (doc: ProjectDocument): Asset[] => Object.values(doc.assets).filter((a) => a.kind === 'audio' && !!a.audio);
export const assetSeconds = (a: Asset | undefined): number => (a ? T.toSeconds(a.duration) : 0);

export function defaultChoices(source: StorySource, doc: ProjectDocument, lang: Lang): StoryChoices {
  const ids = [...new Set(source.assetIds)].filter((id) => isPictureAsset(doc.assets[id])).slice(0, 200);
  return { narrationAssetId: null, assetIds: ids, musicAssetId: null, ownSound: 'under', openingTitle: true, openingText: '', event: source.event ?? null, lang };
}
/**
 * The dialog's first choices: the ones kept while the owner went to the phone dialog (Editor.storyToPhone), with any file that left
 * the library dropped; otherwise the defaults of the source.
 */
export function initialChoices(source: StorySource, doc: ProjectDocument, lang: Lang, kept: StoryChoices | null): StoryChoices {
  if (!kept) return defaultChoices(source, doc, lang);
  const sound = (id: string | null) => (id && doc.assets[id]?.kind === 'audio' ? id : null);
  return { ...kept, assetIds: kept.assetIds.filter((id) => isPictureAsset(doc.assets[id])), narrationAssetId: sound(kept.narrationAssetId), musicAssetId: sound(kept.musicAssetId) };
}
/** The request for the plan routes (no taps: the tap view adds cutsMs). Null while there is no narration. */
export function buildStoryParams(c: StoryChoices): StoryParams | null {
  if (!c.narrationAssetId || c.assetIds.length === 0) return null;
  const text = c.openingText.trim();
  const p: StoryParams = {
    narrationAssetId: c.narrationAssetId, assetIds: [...c.assetIds], musicAssetId: c.musicAssetId, ownSound: c.ownSound, openingTitle: c.openingTitle, lang: c.lang,
    ...(c.openingTitle && text ? { openingText: text.slice(0, 200) } : {}), ...(c.event ? { event: c.event } : {}),
  };
  return StoryParamsSchema.safeParse(p).success ? p : null;
}
export type Playable = 'checking' | 'ok' | 'unplayable' | 'unknown';
/** Why the build buttons are off (null = they are on). One sentence with its next step, in the interface language. */
export function buildBlocker(c: StoryChoices, playable: Playable, lang: Lang, codec: string): string | null {
  const S = storyStrings(lang);
  if (!c.narrationAssetId) return S.needNarration;
  if (c.assetIds.length === 0) return S.needPictures;
  if (playable === 'unplayable') return S.unplayable(codec);
  if (playable === 'checking') return S.checking;
  return null;
}
/** The audio codec the file reports, for the unplayable line. */
export const codecOf = (a: Asset | undefined): string => a?.audio?.codec || '?';

// ---------------------------------------------------------------------------------------------------------------------------
// the strip
// ---------------------------------------------------------------------------------------------------------------------------
/** The ids with the item at `from` moved to `to` (both clamped); a new array. */
export function moveItem<T0>(items: readonly T0[], from: number, to: number): T0[] {
  const out = [...items];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x!);
  return out;
}
/** Where an arrow key moves an item, given the interface direction (in right-to-left the left arrow is "later"). Null: not a move. */
export function moveOfKey(e: { key: string; altKey: boolean }, rtl: boolean): -1 | 1 | null {
  if (!e.altKey) return null;
  if (e.key === 'ArrowUp') return -1;
  if (e.key === 'ArrowDown') return 1;
  if (e.key === 'ArrowLeft') return rtl ? 1 : -1;
  if (e.key === 'ArrowRight') return rtl ? -1 : 1;
  return null;
}
/** Library pictures and videos that are not in the story yet. */
export const addableAssets = (doc: ProjectDocument, assetIds: readonly string[]): Asset[] => Object.values(doc.assets).filter((a) => isPictureAsset(a) && !assetIds.includes(a.id));

// ---------------------------------------------------------------------------------------------------------------------------
// music
// ---------------------------------------------------------------------------------------------------------------------------
/** The music's and the narration's seconds when the music is shorter (the plan says music_short; the dialog says it before building). */
export function musicShort(doc: ProjectDocument, musicId: string | null, narrationId: string | null): { music: number; narration: number } | null {
  if (!musicId || !narrationId) return null;
  const m = assetSeconds(doc.assets[musicId]), n = assetSeconds(doc.assets[narrationId]);
  return m > 0 && n > 0 && m + 1e-9 < n ? { music: m, narration: n } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// the honest "cannot be played in the editor" state
// ---------------------------------------------------------------------------------------------------------------------------
/** The part of an HTMLAudioElement the probe uses (a fake in the tests). */
export interface AudioProbe {
  src: string; preload: string;
  addEventListener(type: 'loadedmetadata' | 'error', fn: () => void): void;
  removeEventListener(type: 'loadedmetadata' | 'error', fn: () => void): void;
  load(): void;
}
export const PROBE_TIMEOUT_MS = 8000;
/** Opens the file in the browser and says whether it can be played: loadedmetadata → ok; an error → unplayable; no answer in time → unknown (never blocks). */
export function probePlayable(make: () => AudioProbe, url: string, timeoutMs = PROBE_TIMEOUT_MS, setTimer: (fn: () => void, ms: number) => unknown = setTimeout, clearTimer: (h: unknown) => void = (h) => clearTimeout(h as never)): { result: Promise<'ok' | 'unplayable' | 'unknown'>; cancel(): void } {
  const a = make();
  let done: ((v: 'ok' | 'unplayable' | 'unknown') => void) | null = null;
  const result = new Promise<'ok' | 'unplayable' | 'unknown'>((resolve) => { done = resolve; });
  let timer: unknown = null;
  const finish = (v: 'ok' | 'unplayable' | 'unknown') => {
    if (!done) return;
    const d = done; done = null;
    if (timer !== null) clearTimer(timer);
    a.removeEventListener('loadedmetadata', onOk); a.removeEventListener('error', onErr);
    try { a.src = ''; a.load(); } catch { /* nothing to release */ }
    d(v);
  };
  const onOk = () => finish('ok'), onErr = () => finish('unplayable');
  a.addEventListener('loadedmetadata', onOk); a.addEventListener('error', onErr);
  timer = setTimer(() => finish('unknown'), timeoutMs);
  a.preload = 'metadata'; a.src = url;
  return { result, cancel: () => finish('unknown') };
}

// ---------------------------------------------------------------------------------------------------------------------------
// the recorder session (privacy line: release() on every path; the WAV goes only through the import queue)
// ---------------------------------------------------------------------------------------------------------------------------
/** Builds the engine from ports (recorder.ts createRecorder in the product, a fake in the tests). */
export type EngineFactory = (ports: RecorderPorts) => StoryRecorderHandle;
export interface RecorderSession {
  readonly handle: StoryRecorderHandle;
  /** The last state the engine reported (idle until it reports). */
  readonly state: RecorderState;
  start(): Promise<void>;
  stop(): void;
  /** «הקלטה מחדש»: drops the take and releases the microphone. */
  discard(): void;
  /** The dialog is closing (any path) or the take is saved: releases the microphone. Idempotent. Later states of the engine are still reported. */
  release(): void;
  /** The component is unmounting: releases the microphone and silences the session (no state is forwarded to a gone component). Idempotent. */
  dispose(): void;
  /** The release() calls made on the engine, for the proof's counter. */
  releases(): number;
}
/**
 * The session around the engine. It owns two rules the lead reviews: (1) the engine's release() runs when the dialog closes
 * (`release`) AND when the component unmounts (`dispose`), whichever comes first and again; (2) after `dispose` nothing is reported.
 * The WAV is never stored here: `state` holds the Blob in memory only until the owner saves it (saveRecording) or drops it.
 */
export function createRecorderSession(make: EngineFactory, onState: (s: RecorderState) => void, opts: { maxMs?: number; getUserMedia: RecorderPorts['getUserMedia']; createContext: RecorderPorts['createContext'] }): RecorderSession {
  let state: RecorderState = { kind: 'idle' };
  let disposed = false, releases = 0;
  const handle = make({
    getUserMedia: opts.getUserMedia, createContext: opts.createContext, ...(opts.maxMs ? { maxMs: opts.maxMs } : {}),
    onState: (s) => { state = s; if (!disposed) onState(s); },
  });
  const release = () => { releases++; handle.release(); };
  return {
    handle,
    get state() { return state; },
    start: () => handle.start(),
    stop: () => handle.stop(),
    discard: () => handle.discard(),
    release,
    dispose: () => { disposed = true; release(); },
    releases: () => releases,
  };
}
/** The name of a saved recording: a date and a time only («קריינות 2026-11-25 14.32.wav»), never a person's name. */
export function recordingName(now: Date, lang: Lang): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${lang === 'en' ? 'Narration' : 'קריינות'} ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}.wav`;
}
/** The only way a recording leaves the page: a File to the import queue (Editor.importFiles → POST …/imports, via 'browser'). */
export interface ImportQueue { importFiles(files: File[]): Promise<void> | void }
export function saveRecording(queue: ImportQueue, wav: Blob, name: string): File {
  const file = new File([wav], name, { type: 'audio/wav', lastModified: Date.now() });
  void queue.importFiles([file]);
  return file;
}
/** The import job of the saved recording: the first job of this name that was not there before the save (`knownJobIds`), and what it is now. */
export function savedJob(jobs: readonly ImportJobView[], name: string, knownJobIds: ReadonlySet<string>): { state: 'waiting' | 'ready' | 'failed'; assetId: string | null; message: string | null } {
  const job = jobs.find((j) => j.name === name && !knownJobIds.has(j.jobId));
  if (!job) return { state: 'waiting', assetId: null, message: null };
  if (job.state === 'ready' && job.assetId) return { state: 'ready', assetId: job.assetId, message: null };
  if (job.state === 'failed' || job.state === 'canceled') return { state: 'failed', assetId: null, message: job.error?.message ?? null };
  return { state: 'waiting', assetId: null, message: null };
}
/** «שקט מדי» / «חזק מדי» for a finished take: numbers, never "good". */
export function takeNotice(s: Extract<RecorderState, { kind: 'stopped' | 'limit' }>, lang: Lang): string[] {
  const S = storyStrings(lang), out: string[] = [];
  if (s.peakDbfs === null || s.peakDbfs < RECORDER_LIMITS.quietDbfs) out.push(S.tooQuiet(s.peakDbfs ?? -96));
  if (s.clipped > 0) out.push(S.clipped(s.clipped));
  return out;
}
export const recorderSeconds = (s: { samples: number; rate: number }): number => (s.rate > 0 ? s.samples / s.rate : 0);
/** The words of a state that has one (the others are drawn by the component). */
export function recorderStateText(s: RecorderState, S: StoryStrings): string | null {
  switch (s.kind) {
    case 'unsupported': return S.recState.unsupported;
    case 'denied': return S.recState.denied;
    case 'no-device': return S.recState.noDevice;
    case 'asking': return S.recState.asking;
    case 'limit': return S.recState.limit;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// taps
// ---------------------------------------------------------------------------------------------------------------------------
/** The narration clip of a document (the one with the narration's asset on a sound track), or null. */
export function narrationClip(doc: ProjectDocument, narrationAssetId: string): { start: T.RationalTime; sourceIn: T.RationalTime } | null {
  for (const seq of Object.values(doc.sequences)) {
    for (const tr of seq.tracks) {
      if (tr.kind !== 'audio') continue;
      for (const c of tr.clips) if (c.type === 'media' && c.assetId === narrationAssetId) return { start: c.start, sourceIn: c.sourceIn ?? T.rt(0, 1) };
    }
  }
  return null;
}
/** A tap's narration SOURCE time in whole milliseconds, from timeline seconds and where the narration clip lies. */
export function tapMsOf(timelineSeconds: number, startSeconds: number, sourceInSeconds: number): number {
  return Math.max(0, Math.round((timelineSeconds - startSeconds + sourceInSeconds) * 1000));
}
/** The other way: a narration source time in ms back to timeline seconds (for «המשיכו מכאן»). */
export const timelineOfMs = (ms: number, startSeconds: number, sourceInSeconds: number): number => ms / 1000 + startSeconds - sourceInSeconds;
/** The taps kept when tapping goes on from `fromMs`: those before it (a tap at the same instant is dropped). */
export const tapsBefore = (cutsMs: readonly number[], fromMs: number): number[] => cutsMs.filter((c) => c < fromMs);
/** Taps from a capture's snapshot (timeline seconds), as narration source ms, sorted. */
export function cutsFromSnapshot(snapshot: readonly { down: number }[], startSeconds: number, sourceInSeconds: number): number[] {
  return snapshot.map((t) => tapMsOf(t.down, startSeconds, sourceInSeconds)).sort((a, b) => a - b);
}
/** The most taps the plan accepts (core STORY.maxCuts through the schema). */
export const MAX_TAPS = 400;
/** The id the Enter key presses with (a pointer id no real pointer has). */
export const ENTER_POINTER_ID = -7;

// ---------------------------------------------------------------------------------------------------------------------------
// planning (browser-side ghost, the same pure code and inputs as the server)
// ---------------------------------------------------------------------------------------------------------------------------
export interface StoryPlannerPort {
  plan(doc: ProjectDocument, params: unknown, ctx: StoryPlanContext): StoryPlan;
  live(base: ProjectDocument, params: unknown, ctx: StoryPlanContext, tapsMs: readonly number[]): ProjectDocument | null;
}
export const isNotBuilt = (e: unknown): boolean => e instanceof StoryNotBuilt || (!!e && typeof e === 'object' && (e as { code?: unknown }).code === 'not_built');

export interface StoryReview {
  /** The picture for review (the plan applied in memory), or null when the plan refused. */
  ghost: ProjectDocument | null;
  chips: StoryChip[];
  cuts: number[];
  seconds: number;
  warnings: StoryPlan['warnings'];
  blocking: StoryPlan['blocking'];
  /** The planner is not built here (the view says so); never a made-up plan. */
  notBuilt: boolean;
  /** The planner's own refusal, in its words, when it refused. */
  refusal: string | null;
}
/** The review of `cutsMs`: the plan from the view's context, its chips and cut frames, and its picture. */
export function reviewOf(base: ProjectDocument, params: Partial<StoryParams>, view: StoryPlanView, cutsMs: readonly number[], planner: StoryPlannerPort): StoryReview {
  const withCuts = { ...params, cutsMs: [...cutsMs] };
  try {
    const plan = planner.plan(base, withCuts, view.context);
    const ghost = plan.blocking.length ? null : planner.live(base, withCuts, view.context, cutsMs);
    return { ghost, chips: plan.chips, cuts: plan.predicted.cuts, seconds: plan.predicted.seconds, warnings: plan.warnings, blocking: plan.blocking, notBuilt: false, refusal: null };
  } catch (e) {
    return { ghost: null, chips: [], cuts: [], seconds: 0, warnings: [], blocking: [], notBuilt: isNotBuilt(e), refusal: isNotBuilt(e) ? null : (e instanceof Error ? e.message : String(e)) };
  }
}
/** Whether the server's plan agrees with the one shown (the cut frames, in order). */
export const sameCutFrames = (shown: readonly number[], server: readonly number[]): boolean => shown.length === server.length && shown.every((f, i) => f === server[i]);
/** After apply: what to tell the owner when the server's cuts differ from the ghost's (U14). */
export function afterApply(shownCuts: readonly number[], applied: Pick<StoryApplyResult, 'predicted'>, lang: Lang): { differs: boolean; message: string | null } {
  const differs = !sameCutFrames(shownCuts, applied.predicted.cuts);
  return { differs, message: differs ? storyStrings(lang).differs : null };
}
/** The chip's line: `Hebrew/English` with the time and, when held, the reason. */
export function chipLine(chip: StoryChip, lang: Lang): string {
  const S = storyStrings(lang);
  const sec = chip.cutMs / 1000;
  return chip.state === 'kept' ? S.chipKept(chip.index + 1, sec) : S.chipHeld(chip.index + 1, sec, chip.reason ? S.held[chip.reason] : '');
}
/** The ticks of the tap lane: where the voice pauses end (the onsets of the plan's measure), as fractions of the narration. Empty when not measured. */
export function pauseTicks(onsetsMs: readonly number[], narrationSeconds: number): number[] {
  const total = narrationSeconds * 1000;
  return total > 0 ? onsetsMs.filter((o) => o > 0 && o < total).map((o) => o / total) : [];
}
/** A tap's place on the lane, 0..1. */
export const laneFraction = (cutMs: number, narrationSeconds: number): number => (narrationSeconds > 0 ? Math.max(0, Math.min(1, cutMs / (narrationSeconds * 1000))) : 0);

/** At most one run per animation frame: `schedule` is called for every change, `run` once per frame. */
export function frameThrottle(run: () => void, raf: (fn: () => void) => number, caf: (id: number) => void): { schedule(): void; cancel(): void } {
  let id = 0;
  return { schedule() { if (!id) id = raf(() => { id = 0; run(); }); }, cancel() { if (id) { caf(id); id = 0; } } };
}

// ---------------------------------------------------------------------------------------------------------------------------
// failures and the bar
// ---------------------------------------------------------------------------------------------------------------------------
export interface StoryFailure { status: number; code: string; message: string; stale: boolean }
const codeOf = (e: unknown): { status: number; code: string; message: string } => {
  const x = (e ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  return { status: typeof x.status === 'number' ? x.status : 0, code: typeof x.code === 'string' ? x.code : '', message: typeof x.message === 'string' ? x.message : '' };
};
/** A route's refusal in the interface language: the server's sentence is Hebrew already for the codes it words; a stale revision and "not built" are ours. */
export function storyFailure(lang: Lang, e: unknown, t?: (key: string) => string): StoryFailure {
  const S = storyStrings(lang);
  const { status, code, message } = codeOf(e);
  const stale = code === 'stale_revision' || code === 'conflict';
  const i18n = (k: string, fallback: string) => { try { const v = t?.(k); return v && v !== k ? v : fallback; } catch { return fallback; } };
  if (code === 'story_not_built' || code === 'not_built') return { status, code, stale: false, message: S.notBuilt };
  if (stale) return { status, code, stale: true, message: S.staleProject };
  if (code === 'story_blocked') return { status, code, stale: false, message: message || i18n('error.code.story_blocked', S.planFailed) };
  if (code === 'story_retap_not_built') return { status, code, stale: false, message: i18n('error.code.story_retap_not_built', S.retapNote) };
  return { status, code, stale: false, message: message || S.planFailed };
}

export interface StoryRunView { run: RecipeRun; params: StoryParams | null; picked: ReturnType<typeof storyRunPicked> }
const toView = (run: RecipeRun): StoryRunView => {
  const parsed = StoryParamsSchema.safeParse(storyRunParams(run.params as Record<string, unknown>));
  return { run, params: parsed.success ? parsed.data : null, picked: storyRunPicked(run.params as Record<string, unknown>) };
};
/** The story run the bar shows: the tab's own run when it is still in the document, else the newest story run of the document (after a reload). */
export function currentStoryRun(doc: ProjectDocument, runId: string | null | undefined): StoryRunView | null {
  const runs = Object.values(doc.recipeRuns ?? {}).filter((r) => r.recipeId === STORY_RUN_RECIPE_ID);
  const mine = runId ? runs.find((r) => r.id === runId) : undefined;
  const run = mine ?? runs.at(-1);
  return run ? toView(run) : null;
}
/** The transaction that applied the run (found through the clips it created), for the bar's undo. */
export function findStoryTransaction(activity: readonly RevisionEvent[], createdIds: readonly string[]): string | null {
  if (!createdIds.length) return null;
  const ids = new Set(createdIds);
  for (const ev of activity) {
    const e = ev as unknown as { transactionId?: string; undoneBy?: string | null; createdIds?: string[]; summary?: { createdIds?: string[] } };
    const made = e.createdIds ?? e.summary?.createdIds ?? [];
    if (e.transactionId && !e.undoneBy && made.some((x) => ids.has(x))) return e.transactionId;
  }
  return null;
}
/** The options a rebuild can change (never the taps): other music, none, the other own-sound choice. */
export interface RebuildOption { id: string; label: string; change: Partial<StoryParams> }
export function rebuildOptions(doc: ProjectDocument, params: StoryParams, lang: Lang): RebuildOption[] {
  const S = storyStrings(lang), out: RebuildOption[] = [];
  const current = params.musicAssetId ?? null;
  if (current !== null) out.push({ id: 'music-none', label: S.musicNone, change: { musicAssetId: null } });
  for (const a of soundFiles(doc)) if (a.id !== current && a.id !== params.narrationAssetId) out.push({ id: `music-${a.id}`, label: S.optionMusic(a.name), change: { musicAssetId: a.id } });
  const muted = (params.ownSound ?? 'under') === 'mute';
  out.push({ id: 'own-sound', label: S.optionOwnSound(!muted), change: { ownSound: muted ? 'under' : 'mute' } });
  return out;
}
export { clockOf };
