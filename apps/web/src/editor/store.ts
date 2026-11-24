/**
 * Editor session state and actions. One instance per open project. Components subscribe with
 * `useEditorState`; every persistent change goes through `commit` → server operations (the UI holds
 * no second copy of truth). Selection, playhead, language and key bindings are personal session
 * state and never enter the project document (SPEC §5).
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import * as T from '@pulseframe/time';
import { clipEnd, findClip, projectOutput, projectSequence, sequenceDuration, TRACKING_JOB_TYPE, transformAt, type Clip, type Follow, type FollowInfo, type OpCall, type ProjectDocument, type Transform, type TrackRun, type TemplateInput, type ExportMode, type SegmentPlanView } from '@pulseframe/core';
import { groupTimeAt, multicamGroupOf, projectVariant, type SwitchAnglesOutput } from '@pulseframe/core';
import type { TakeRequest, TakeResult } from '@pulseframe/core';
import { defaultTitleDuration, type ExportDestinationId } from '@pulseframe/core';
import { createT, dictionaries, dirOf, translateRefusal, type Key, type Lang } from '@pulseframe/i18n';
import { initGpu, type GpuStatus, type ImageLayer, type RenderGraph, type TextLayer, type VideoLayer } from '@pulseframe/engine';
import { api, ApiFailure, type Approval, type CommitResult, type JobEvent, type Proposal, type RevisionEvent } from '../api.ts';
import { ensureFonts } from '../fonts.ts';
import { MediaPool, prefetchBudget } from '../media.ts';
import { Player } from '../player.ts';
import { timelineDerivatives } from '../clipVisuals.cache.ts';
import { failureOf, rememberJob, type ProviderFailure } from './aiTools.recheck.ts';
import { aiApi, type ApplyMode, type RunSource } from './api.ts';
import { addAssetArgs, dropAssetArgs } from './placement.ts';
import { injectSequenceId } from './shorts.view.ts';
import { followFactor, followOffsetAt, layerOf, ownFromResolved } from './tracking.math.ts';
import { wholeEditOps, type WholeEditPick } from './commands.ts';
import { anglePrefetchPlan } from './anglePrefetch.ts';
import { commitParts, projectionResult, record, reportNotes, reportOf, startSession, unchangedPlaces, type MulticamSession } from './multicamSession.ts';
import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { cutBefore, type ObjectTab } from './inspector.model.ts';
import { ImportsStore, type ImportJobEvent, type ImportsState } from './imports.ts';
import { dropApi, importsApi } from './imports.api.ts';
import type { PhoneDropProblem } from './phoneDrop.strings.ts';
import { RefreshPolicy } from './renderCache.logic.ts';
import type { DropCodeView, DropPublicView, FamilyFilmParams, FamilyFilmPlanView, FilmExclusion, FilmPick } from '@pulseframe/core';
import type { ChannelRef, KeyClipboard, KeyRef } from '@pulseframe/core';
import { pruneKeySel } from './keyStrip.math.ts';

/**
 * The activity list after a live revision event: newest first, at most 50. An undo or redo marks the transaction it reversed
 * (undoneBy), so the command bar's exact undo target stays right without reading the history again (ADR-0027).
 */
export function withRevisionEvent(activity: readonly RevisionEvent[], e: RevisionEvent): RevisionEvent[] {
  return [e, ...activity.map((x) => (e.undoes && x.transactionId === e.undoes ? { ...x, undoneBy: e.transactionId } : x))].slice(0, 50);
}
/** What Editor.commitExact answers (the command bar): committed (replayed = a repeated key), stale (409 stale_revision), or failed. */
export type ExactCommit = { kind: 'committed'; result: CommitResult; replayed: boolean } | { kind: 'stale'; currentRevision: number | null } | { kind: 'failed'; code: string; message: string; hint?: string };
export type SaveState = 'save.saved' | 'save.saving' | 'save.offline' | 'save.conflict';
export type ProviderInfo = Awaited<ReturnType<typeof api.capabilities>>;
export interface EditorState {
  lang: Lang;
  /** The document the editor works on: the ACTIVE sequence's projection of rawDoc (the same object for a single-sequence project). */
  doc: ProjectDocument | null;
  /** The stored document as the server holds it (every sequence). Read-only: edits go through ops. */
  rawDoc: ProjectDocument | null;
  /** The sequence shown and edited (session state, never stored); the main one by default, reset to it when its sequence is gone. */
  activeSequenceId: string;
  revision: number;
  selection: string[];
  save: SaveState;
  activity: RevisionEvent[];
  exportJob: JobEvent | null;
  capJob: JobEvent | null;
  /** The latest event of each recent capability job, by job id (a panel shows the jobs it started, whatever ran since). */
  capJobs: Record<string, JobEvent>;
  provider: ProviderInfo | null;
  /** The provider state is being read from the server (the first request, at boot). */
  providerAsking: boolean;
  /** That request failed: what the server answered (code), or that it did not answer (code null). */
  providerError: ProviderFailure | null;
  /** WebGPU effect passes in this browser (ADR-0008): null until checked. */
  gpu: GpuStatus | null;
  error: string | null;
  /** Translated headline at the start of `error`, when the error was a coded refusal (lets the bar set the direction of the detail on its own). */
  errorHeadline: string | null;
  uploading: boolean;
  /** Bumped when a derivative (thumbnail/waveform/proxy) changes state. */
  derivativeTick: number;
  /** Bumped on every player tick (frame painted, play/pause). */
  tick: number;
  paletteOpen: boolean;
  /** Other participants' transient playhead/selection (agents and other sessions). */
  ghosts: Ghost[];
  /** Opt-in: move my playhead/selection with the agent. Off by default; any manual seek or selection turns it off. */
  followAgent: boolean;
  /** Owner control: agents may not mutate this project while true (enforced by the server). */
  agentsPaused: boolean;
  proposals: Proposal[];
  /** Requests waiting for the owner's decision (pending only). */
  approvals: Approval[];
  /** Timeline zoom in pixels per second. */
  pxPerSecond: number;
  /** Linked format being viewed (session state, never stored in the project). null = master. */
  viewVariantId: string | null;
  /** Show the safe-area guide over the preview (personal setting, default on). */
  safeAreaOn: boolean;
  /** Workspace preset: which Inspector panels are offered. A view setting of this browser; it never changes the project. */
  workspace: Workspace;
  /** Target tracks (chosen with the ◎ button of a track): where clips added from the library, pasted or duplicated go first. Kept in this browser only. */
  targets: { video: string | null; audio: string | null };
  /** Clip ids remembered by Copy (session state only). */
  clipboard: string[];
  /** Clips marked by Cut; they move on the next Paste (nothing is committed until then). */
  cutPending: string[];
  /** Who this browser session is, as the server says (GET /session): the owner's session is `user:…`. null until known. */
  actor: string | null;
  /** The latest event of each tracking job seen in this session, by job id (ADR-0015). */
  trackJobs: Record<string, JobEvent>;
  /** The tracking job this session started for each motion track (motion track id → job id). */
  trackJobFor: Record<string, string>;
  /** The track picker on the monitor (TrackPicker.tsx): open while a point or an area of a clip's picture is being picked. */
  picker: TrackPick | null;
  /** The motion track the tracking panel shows open (the one just created there). Session state only. */
  activeTrackId: string | null;
  /** The Templates drawer of the library is expanded (session view state). */
  templatesOpen: boolean;
  /** Bumped by openTemplates: the drawer moves the keyboard focus to its first card once the cards are there. */
  templatesFocus: number;
  /** The template run applied from this tab, for the post-apply bar (shuffle, another tempo, undo); session state only. */
  templateRun: TemplateRunInfo | null;
  /**
   * The chosen cut: the id of the clip whose start is the cut (the clip after it, which carries a transition), or null. The
   * timeline's cut chips choose it (selectCut), the cut inspector, the ride bar and the loupe read it. Session view state only.
   */
  cutClipId: string | null;
  /** The cut loupe (the frames either side of the chosen cut) is shown in the viewer. */
  loupe: boolean;
  /** A tab of the selected object asked for from outside the inspector; `n` makes each request new. */
  inspectorTab: { tab: ObjectTab; n: number } | null;
  /** A panel asked for by the timeline's ride bar (editor.openPanel): the inspector shows it and moves the focus there. */
  panelRequest: { target: PanelTarget; clipId: string | null; n: number } | null;
  /** The effects gallery is open (EffectGallery.tsx GalleryHost), on this tab of its own; null when closed. */
  gallery: { tab: GalleryTab | null; n: number } | null;
  /** A quiet line over the viewer ("the playhead moved into the title"), with the time it was said. */
  stageNote: { text: string; at: number } | null;
  /** Bumped by openExportSheet: the export sheet's host opens the sheet (ExportSheet.tsx). */
  exportSheet: number;
  /** The destination the last openExportSheet asked to have chosen (the command bar's «ייצא לוואטסאפ»), null = the sheet's own default. */
  exportSheetDestination?: ExportDestinationId | null;
  /** The last notice for the toast queue (App.tsx ToastBridge); `n` makes each one new. Session state only. */
  notice: (Notice & { n: number }) | null;
  /** Render cache (ADR-0024): the latest segment plan of the fast export. Session state only. */
  segmentPlan: SegmentPlanState;
  /** The viewer's «ייצוא מהיר» switch, kept in this browser (localStorage 'pf.fastExport'); never project state. */
  fastExport: boolean;
  /** The options the lane and the sheet line plan with (the export sheet's choices; the encoder id holds the quality). */
  planOptions: Record<string, unknown>;
  /** The import cards (ADR-0023): this tab's uploads merged with the server's import jobs (ImportsStore.snapshot()). */
  imports: ImportsState;
  /** The phone drop dialog (ADR-0023) is shown; the code may live on while it is hidden (the chip in the drawer header). */
  phoneDropOpen: boolean;
  /** The live phone code as the owner sees it (url and PIN only while it waits), or null. */
  drop: DropCodeView | null;
  /** The newest public view of that code from the event stream (counts, state, close reason). */
  dropLive: DropPublicView | null;
  /** An honest state instead of a code (no home network, the port could not open, the server restarted). */
  dropProblem: PhoneDropProblem | null;
  /** Blocker codes of the last segment plan (422 render_blocked): the sheet's switch says why the fast export is unavailable. */
  planBlockers: string[];
  /** Assets whose stored file the server reports missing on disk (GET …/missing-media): the library card and the timeline clips say so, the preview leaves them out. */
  missingMedia: string[];
  // ---- multicam live switching (ADR-0020): session state, never stored or sent in presence ----
  /** The recording of switches in progress (cuts in group time), or null/absent. */
  multicamRec?: MulticamSession | null;
  /** The polite live region's latest sentence (start, stop, «N חתכים נשמרו»); `n` makes each one new. */
  multicamLive?: { text: string; n: number } | null;
  /** The reaction offset in frames (0–10) a new recording starts with. */
  multicamReaction?: number;
  // ---- perform mode (ADR-0025): session state, never stored or sent in presence ----
  /** A planned take shown for review (Editor.showGhost), or null/absent: the player shows it instead of the committed document. */
  performGhost?: ProjectDocument | null;
  /** A take is being recorded (Editor.setPerformRecording): the shortcut gate lets only Space through, and loads draw without stopping the sound when they can. */
  performRecording?: boolean;
  /** The linked format that was viewed when the perform workspace was entered, or that was chosen inside it (setViewVariant refuses it there: the view works on the master and says so, perform.masterOnly), or null. */
  performLeftVariant?: string | null;
  /** The family film dialog (ADR-0026) is open. Session state only. */
  filmOpen: boolean;
  /** What the dialog was opened with: an event's files or the library selection (openFilm). */
  filmSource: FilmSource | null;
  /** The film applied from this tab, for the film bar (undo, other moments, another length, why these clips). Session state only; after a reload the document's run (recipeId template:tpl.family-film) is used. */
  filmRun: FilmRunInfo | null;
  // ---- keyframe curves and motion paths (ADR-0019): session state, never stored in the document or sent in presence ----
  /** The selected keys of the keyframe strip (one clip at a time); pruned on load when the clip is gone (W2). */
  keySel: { clipId: string; keys: KeyRef[] } | null;
  /** Copied keys (values and curves, core keyEdits.ts copyKeys); kept across clips and loads. */
  keyClipboard: KeyClipboard | null;
  /** The curve picker is open for these channels at this clip-local frame (CurvePicker.tsx). */
  curvePicker: { clipId: string; frame: number; channels: ChannelRef[] } | null;
  /** Show the motion path on the stage: a setting of this browser (localStorage 'pf.motionPath'), default on. */
  pathOn: boolean;
}
/** What the family film dialog starts from (FamilyFilmEntry → editor.openFilm). */
export interface FilmSource { assetIds: string[]; event: FamilyFilmParams['event'] }
/** The film run this tab made (the film bar's and FilmWhy's state). */
export interface FilmRunInfo { runId: string; params: FamilyFilmParams; picks: FilmPick[]; excluded: FilmExclusion[]; alternatives: FamilyFilmPlanView['alternatives'] }
/** localStorage key of the «ייצוא מהיר» switch. */
export const FAST_EXPORT_KEY = 'pf.fastExport';
/** localStorage key of the motion path switch (ADR-0019; view.motionPath). */
export const MOTION_PATH_KEY = 'pf.motionPath';
const readPathOn = () => { try { return localStorage.getItem(MOTION_PATH_KEY) !== '0'; } catch { return true; } };
const readFastExport = () => { try { return localStorage.getItem(FAST_EXPORT_KEY) === '1'; } catch { return false; } };
/** A place the ride bar can ask the editor to show: a tab of the inspector, or a gallery (RideBar.tsx, Inspector.tsx). */
export type PanelTarget = 'speed' | 'animation' | 'effects' | 'transition' | 'transitions-gallery' | 'sound' | 'replace';
/** The tabs of the effects gallery that can be asked for from outside it. */
export type GalleryTab = 'effects' | 'looks' | 'transitions' | 'text' | 'motion';
/**
 * A toast the editor asks for. An undo toast names the transaction it reports (`undoes`) and its button reverses exactly that
 * one (editor.undoTransaction), never whatever edit happens to be newest when it is pressed; without `undoes` it has no button.
 */
export interface Notice { kind: 'undo' | 'info'; title: string; body?: string; undoes?: string }
/** What an export is started with (POST /exports): the defaults are left out, as exportSheet.logic.ts exportOptions builds it. */
export interface ExportRequest { variantId?: string; /** a sequence of the project (a short) instead of the main edit (ADR-0018) */ sequenceId?: string; /** frame index of a png still */ frame?: number; quality?: string; captions?: string; format?: string; scale?: number; /** «ייצוא מהיר» (ADR-0024): 'incremental' when the viewer's switch is on and the format is MP4. */ mode?: ExportMode }
/**
 * The fast export's segment plan as the sheet line and the timeline lane read it (ADR-0024). `off`: the lane is hidden (the
 * cache is off, or this project never used the fast export); `updating`: a plan is being made (aria-busy); `error`: the last
 * request failed (the lane says nothing rather than a guess). The lead's wiring refreshes it 1.5 s after the last revision change.
 */
export interface SegmentPlanState { status: 'off' | 'updating' | 'ready' | 'error'; view: SegmentPlanView | null; revision: number | null }
/** What the track picker is picking, and on which clip's picture. */
export interface TrackPick { kind: 'point' | 'region'; clipId: string; assetId: string }
/** A clip as drawn at the playhead: its transform after the follow post-pass (ADR-0015), its own transform, and the follow's scale factor m (resolved scale = own scale · m). */
export interface ResolvedNow { transform: Transform; own: Transform; m: number; follow: FollowInfo | null }
type TransformValues = Partial<Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity', number>>;

/** A JSON request to the server API (the tracking routes, ADR-0015), refusals thrown as ApiFailure like api.ts does. */
async function apiJson<R>(path: string, body?: unknown): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
/** What the post-apply bar knows of the last template applied here (ADR-0016): its run, the params it ran with and the plan's alternatives. */
export interface TemplateRunInfo {
  runId: string;
  templateId: string;
  name: { he: string; en: string };
  params: Partial<TemplateInput>;
  alternatives: { label: string; params: Partial<TemplateInput> }[];
  /** Items the run placed. */
  created: number;
  /** The revision the apply (or the last regenerate) made. */
  revision: number;
}

const SAFE_KEY = 'pf.safearea.v1';
const TARGETS_KEY = 'pf.targets.v1';
const readTargets = (projectId: string): { video: string | null; audio: string | null } => {
  try { const v = JSON.parse(localStorage.getItem(`${TARGETS_KEY}.${projectId}`) ?? 'null'); return { video: typeof v?.video === 'string' ? v.video : null, audio: typeof v?.audio === 'string' ? v.audio : null }; } catch { return { video: null, audio: null }; }
};
/** Drag-and-drop type of a library file dragged onto the timeline (the payload is the asset id). */
export const ASSET_DRAG_TYPE = 'application/x-pulseframe-asset';
export const WORKSPACES = ['pro', 'quick', 'motion', 'color', 'captions', 'sound', 'deliver', 'shorts', 'perform', 'custom'] as const;
export type Workspace = (typeof WORKSPACES)[number];
const WS_KEY = 'pf.workspace.v1';
const readWorkspace = (): Workspace => { try { const v = localStorage.getItem(WS_KEY); return (WORKSPACES as readonly string[]).includes(v ?? '') ? (v as Workspace) : 'pro'; } catch { return 'pro'; } };
const readSafeArea = () => { try { return localStorage.getItem(SAFE_KEY) !== '0'; } catch { return true; } };

export interface Ghost { sessionId: string; actor: string; kind: 'user' | 'agent'; frame: number | null; selection: string[]; label: string | null }

/** The asset set of a document (ids and content hashes): the missing-media list is asked for again when it changes. */
const mediaKey = (doc: ProjectDocument) => Object.values(doc.assets).map((a) => `${a.id}:${a.contentHash}`).sort().join('|');

export class Editor {
  private state: EditorState = {
    lang: localStorage.getItem('pf.lang') === 'en' ? 'en' : 'he', doc: null, rawDoc: null, activeSequenceId: '', revision: 0, selection: [], save: 'save.saved', activity: [], exportJob: null, capJob: null, capJobs: {},
    provider: null, providerAsking: false, providerError: null, gpu: null, error: null, errorHeadline: null, uploading: false, derivativeTick: 0, tick: 0, paletteOpen: false, pxPerSecond: 90, ghosts: [], followAgent: false, agentsPaused: false, proposals: [], approvals: [], viewVariantId: null, safeAreaOn: readSafeArea(), workspace: readWorkspace(), targets: { video: null, audio: null }, clipboard: [], cutPending: [], actor: null,
    trackJobs: {}, trackJobFor: {}, picker: null, activeTrackId: null,
    templatesOpen: false, templatesFocus: 0, templateRun: null,
    cutClipId: null, loupe: false, inspectorTab: null, panelRequest: null, gallery: null, stageNote: null, notice: null, exportSheet: 0,
    segmentPlan: { status: 'off', view: null, revision: null }, fastExport: readFastExport(), planOptions: {}, // the export sheet's first pick (the computer destination: high quality, whose options are all defaults)
    imports: { local: [], jobs: [], room: null, skipped: null }, phoneDropOpen: false, drop: null, dropLive: null, dropProblem: null, planBlockers: [], missingMedia: [],
    filmOpen: false, filmSource: null, filmRun: null,
    keySel: null, keyClipboard: null, curvePicker: null, pathOn: readPathOn(),
  };
  /**
   * The import queue's editor side (ADR-0023): uploads one at a time to POST …/imports, cards from the job events, placement of
   * files dropped on the timeline through dropAsset (the owner's undo stack) once the document holding them is loaded.
   */
  readonly imports = new ImportsStore({
    projectId: () => this.state.doc?.id ?? null,
    upload: (projectId, file, meta, onProgress) => importsApi.upload(projectId, file, meta, onProgress),
    list: (projectId) => importsApi.list(projectId),
    retry: (jobId) => importsApi.retry(jobId),
    cancel: (jobId) => importsApi.cancel(jobId),
    dismiss: (jobId) => importsApi.dismiss(jobId),
    place: (assetId, frame, trackId) => this.placeImported(assetId, frame, trackId),
    provideLocal: (assetId, file) => this.pool?.provideLocal(assetId, file),
    getJob: (id) => importsApi.job(id),
  });
  /** The lane's and the sheet's segment plan (ADR-0024): asked for 1.5 s after the last revision change, only while the switch is on. */
  private planPolicy = new RefreshPolicy((signal, revision) => this.askPlan(signal, revision));
  /** Counter that makes each view request (tab, panel, gallery, notice) a new one. */
  private requests = 0;
  private viewCache: { doc: ProjectDocument; id: string; out: ProjectDocument } | null = null;
  private listeners = new Set<() => void>();
  private es?: EventSource;
  private disposed = false;
  private sessionId = crypto.randomUUID();
  private presenceTimer = 0;
  private lastPresence = '';
  /** True while the editor itself is moving the view to follow an agent (so that does not count as a manual move). */
  private following = false;
  player: Player | null = null;
  pool: MediaPool | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getState = () => this.state;
  set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  t = (key: Key) => createT(this.state.lang)(key);

  // ---------- derived ----------
  get doc() { return this.state.doc; }
  /** The document the preview shows: the master, or the master projected into the viewed format (same projection as export). */
  get viewDoc(): ProjectDocument | null {
    const { doc, rawDoc, activeSequenceId: seq, viewVariantId: id } = this.state;
    const proj = this.sessionDoc(); // a recording of switches shows its local projection (never saved)
    if (proj && doc) {
      if (!id || !proj.variants?.[id]) return proj;
      if (this.viewCache?.doc === proj && this.viewCache.id === id) return this.viewCache.out;
      const o = projectVariant(proj, id);
      this.viewCache = { doc: proj, id, out: o };
      return o;
    }
    if (!doc || !rawDoc || !id || !doc.variants?.[id]) return doc;
    if (this.viewCache?.doc === doc && this.viewCache.id === id) return this.viewCache.out;
    const out = projectOutput(rawDoc, { sequenceId: seq || rawDoc.mainSequenceId, variantId: id });
    this.viewCache = { doc, id, out };
    return out;
  }
  get rate() { return this.state.doc?.settings.frameRate ?? { num: 30, den: 1 }; }
  get frame() { return this.player?.frame ?? 0; }
  get playhead() { return T.frameTime(this.frame, this.rate); }
  get duration() { return this.state.doc ? sequenceDuration(this.state.doc) : T.ZERO; }
  /** Primary selected clip with its track (first of the selection). */
  get selected() { const id = this.state.selection[0]; return this.state.doc && id ? findClip(this.state.doc, id) : undefined; }
  /** True when any selected clip sits on a locked track: editing commands are then inert (the server would refuse them anyway). */
  get selectionLocked() { const d = this.state.doc; if (!d) return false; return this.state.selection.some((id) => findClip(d, id)?.track.locked); }
  /** True when the playhead is strictly inside the selected clip (split/trim are possible). */
  get playheadInsideSelection() { const s = this.selected; return !!s && T.lt(s.clip.start, this.playhead) && T.lt(this.playhead, clipEnd(s.clip)); }
  /** True when the playhead is on a frame the selected clip covers (keyframes can be set). */
  get playheadOnSelection() { const s = this.selected; return !!s && T.lte(s.clip.start, this.playhead) && T.lt(this.playhead, clipEnd(s.clip)); }

  // ---------- lifecycle ----------
  setLang(lang: Lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    localStorage.setItem('pf.lang', lang);
    this.set({ lang });
  }
  fail = (e: unknown) => {
    console.error(e);
    // A refusal from the server carries a code: its headline is shown in the interface language, followed by the server's own detail.
    const headline = e instanceof ApiFailure ? (dictionaries[this.state.lang] as Record<string, string>)[`error.code.${e.code}`] : undefined;
    // The detail: in the interface language when it is one of the common refusals, else as the server wrote it.
    const detail = e instanceof ApiFailure ? translateRefusal(this.state.lang, e.message) ?? e.message : e instanceof Error ? e.message : String(e);
    this.set({ error: headline ? `${headline}: ${detail}` : detail, errorHeadline: headline ?? null });
  };
  /** The asset set the missing-media list was last asked for (ids and content hashes). */
  private mediaChecked = '';
  /**
   * Ask the server which assets' stored files are missing, and show them as missing: the library card and the timeline clips say
   * so (the timeline's own missing-file look), and the preview leaves their pictures out instead of failing the frame. True when
   * the list changed. A failed request changes nothing.
   */
  async checkMedia(projectId: string): Promise<boolean> {
    let missing: unknown;
    try { missing = (await api.missingMedia(projectId))?.missing; } catch { return false; }
    if (!Array.isArray(missing) || !missing.every((id) => typeof id === 'string')) return false; // not an answer this editor knows: nothing changes
    if (this.disposed || this.state.doc?.id !== projectId) return false;
    const changed = this.pool?.setMissing(missing) ?? false;
    if (changed || missing.join() !== (this.state.missingMedia ?? []).join()) this.set({ missingMedia: missing });
    if (changed && this.player && !this.player.playing) this.player.seek(this.player.frame);
    return changed;
  }
  /** A preview frame failed: when a stored file went missing meanwhile, the asset is marked missing and the frame drawn without it; otherwise the error is shown. */
  private async previewFailed(projectId: string, e: unknown) {
    const changed = await this.checkMedia(projectId);
    // The frame may have failed just before the list (asked for on load) arrived: it is drawn again once per list, never in a loop.
    const key = this.state.missingMedia.join();
    if (changed || (key && this.mediaRetried !== key)) {
      this.mediaRetried = key;
      console.warn('preview: a stored media file is missing; its clips are shown as missing', e);
      if (!changed && this.player && !this.player.playing) this.player.seek(this.player.frame);
      return;
    }
    this.fail(e);
  }
  private mediaRetried = '';
  async load(projectId: string) {
    const p = await api.getProject(projectId);
    if (p.revision >= this.state.revision || !this.state.doc) {
      // the active sequence resets to the main one when it is gone (as the viewed format does); the editor works on its projection
      const activeSequenceId = Object.hasOwn(p.project.sequences, this.state.activeSequenceId) ? this.state.activeSequenceId : p.project.mainSequenceId;
      const projected = projectSequence(p.project, activeSequenceId);
      const selection = this.state.selection.filter((id) => findClip(projected, id));
      const viewVariantId = this.state.viewVariantId && p.project.variants?.[this.state.viewVariantId] ? this.state.viewVariantId : null;
      // A document change that removes cut-pending clips cancels the cut.
      const cutAlive = this.state.cutPending.filter((id) => findClip(projected, id));
      const cut = cutAlive.length === this.state.cutPending.length ? {} : { cutPending: [] as string[], clipboard: [] as string[] };
      // target tracks are remembered per project in this browser
      const targets = this.state.doc?.id === p.project.id ? {} : { targets: readTargets(p.project.id) };
      // the track picker closes when the clip it picks on is gone
      const picker = this.state.picker && !findClip(projected, this.state.picker.clipId) ? { picker: null } : {};
      // the chosen cut goes when it is no longer a cut (its clips were moved apart, or one of them is gone)
      const cutGone = this.state.cutClipId && (!selection.includes(this.state.cutClipId) || !cutBefore(projected, this.state.cutClipId)) ? { cutClipId: null, loupe: false } : {};
      // keyframe strip (ADR-0019): selected keys whose clip or key is gone go; the curve picker closes with its clip
      const keySel = pruneKeySel(this.state.keySel, (id) => findClip(projected, id)?.clip, projected.settings.frameRate);
      const curvePicker = this.state.curvePicker && !findClip(projected, this.state.curvePicker.clipId) ? null : this.state.curvePicker;
      this.set({ doc: projected, rawDoc: p.project, activeSequenceId, revision: p.revision, selection, viewVariantId, ...cut, ...targets, ...picker, ...cutGone, keySel, curvePicker });
      const media = mediaKey(p.project);
      if (media !== this.mediaChecked) { this.mediaChecked = media; void this.checkMedia(p.project.id); }
      const vd = this.viewDoc;
      // while switches are being recorded (or committed) the sound plan is unchanged, so playback is not stopped (ADR-0020)
      // perform mode (ADR-0025): a ghost under review stays on screen (the view re-plans it on the new revision and shows it again);
      // while a take is recorded the picture is replaced without stopping the sound when the sound plan is unchanged
      if (vd && !this.state.performGhost) { if (this.state.multicamRec || this.committingSession || this.state.performRecording) this.player?.setPictureDoc(vd); else this.player?.setDoc(vd); }
    }
    return p;
  }
  /** Show and edit another sequence (a short, or the main edit): the editor's document becomes its projection. Session state only. */
  setActiveSequence(id: string) {
    const raw = this.state.rawDoc;
    if (!raw) return;
    const next = Object.hasOwn(raw.sequences, id) ? id : raw.mainSequenceId;
    if (next === this.state.activeSequenceId) return;
    const doc = projectSequence(raw, next);
    // a linked format is project-wide and would replace a short's own frame: back to the sequence itself
    this.set({ activeSequenceId: next, doc, viewVariantId: null, selection: this.state.selection.filter((id2) => findClip(doc, id2)), cutClipId: null, loupe: false, picker: null });
    const vd = this.viewDoc;
    if (vd) this.player?.setDoc(vd);
  }
  /** Switch the preview to a linked format (or back to the master with null). */
  setViewVariant(id: string | null) {
    const doc = this.state.doc;
    const next = id && doc?.variants?.[id] ? id : null;
    // perform mode (ADR-0025) works on the master only: takes and camera keys are planned for it, so a linked format is not
    // shown there; the refused format is remembered for the view's note (perform.masterOnly), as on entering the workspace
    if (next && this.state.workspace === 'perform') { this.set({ performLeftVariant: next }); return; }
    if (next === this.state.viewVariantId) return;
    this.set({ viewVariantId: next });
    const vd = this.viewDoc;
    if (vd) this.player?.setDoc(vd);
  }
  /** Loop playback on/off (session setting; the player restarts from the first frame at the end). */
  toggleLoop() {
    if (!this.player) return;
    this.player.loop = !this.player.loop;
    this.set({ tick: this.state.tick + 1 });
  }
  setSafeArea(on: boolean) {
    try { localStorage.setItem(SAFE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    this.set({ safeAreaOn: on });
  }
  /** Boot: session → project → fonts → player → live revision stream. */
  async boot(canvas: HTMLCanvasElement) {
    this.setLang(this.state.lang);
    try { const who = await api.session(); this.set({ actor: typeof who?.actor === 'string' ? who.actor : null }); } catch (e) { throw e instanceof ApiFailure && e.code === 'owner_key_required' ? new Error(this.t('boot.ownerKey')) : e; }
    await ensureFonts();
    void initGpu().then((g) => { this.set({ gpu: g }); if (this.player && !this.player.playing) this.player.seek(this.player.frame); }); // not awaited: the editor works without it; GPU effects appear once it is ready
    let id = new URLSearchParams(location.search).get('project');
    if (!id) {
      const { projects } = await api.listProjects();
      id = projects[0]?.id ?? (await api.createProject(this.state.lang === 'he' ? 'הפרויקט שלי' : 'My project')).project.id;
    }
    const projectId = id;
    if (this.disposed) return;
    // The import cards follow the store from before the document is shown: a file picked as soon as the library appears is
    // never dropped by a later reset (found by proof:phone-drop P15, lead run 2026-11-18).
    this.imports.subscribe(() => this.set({ imports: this.imports.snapshot(), uploading: this.imports.uploading }));
    this.pool = new MediaPool({
      assetUrl: (assetId) => `/api/v1/projects/${projectId}/assets/${assetId}/content`,
      // Preview decodes the frame-identical proxy once it exists; export always uses the original.
      previewUrl: async (assetId) => ((await api.derivatives(projectId, assetId)).derivatives.find((d) => d.kind === 'proxy')?.status === 'ready' ? `/api/v1/projects/${projectId}/assets/${assetId}/derivatives/proxy` : null),
    });
    this.player = new Player(canvas, this.pool, () => { this.set({ tick: this.state.tick + 1 }); this.announce(projectId); this.multicamTick(); this.multicamWarm(); }, (e) => void this.previewFailed(projectId, e));
    (window as any).__pfMedia = () => this.pool?.stats();
    (window as any).__pfSync = () => this.player?.syncStats();
    const p = await this.load(projectId);
    this.set({ activity: (await api.history(projectId)).events.reverse() });
    void this.imports.refresh().catch(() => {}); // imports still open (or failed) from before this page was loaded
    void this.refreshDrop();
    if (this.state.fastExport) void this.planPolicy.now(p.revision);
    if (this.disposed) return;
    const es = (this.es = api.events(projectId, p.revision));
    es.addEventListener('revision', (m) => {
      const e: RevisionEvent = JSON.parse((m as MessageEvent).data);
      if (!this.state.activity.some((x) => x.revision === e.revision)) this.set({ activity: withRevisionEvent(this.state.activity, e) });
      // Committed remote or local change: converge on the server document. Playhead and selection are local and stay put.
      if (e.revision > this.state.revision) void this.load(projectId).catch(this.fail);
      if (this.state.fastExport) this.planPolicy.changed(e.revision);
    });
    // The phone drop's public view (owner sessions only, no secrets): counts, connected, closed.
    es.addEventListener('drop', (m) => {
      const d: DropPublicView = JSON.parse((m as MessageEvent).data);
      const cur = this.state.drop;
      if (!cur || cur.dropId !== d.dropId) { this.set({ dropLive: d }); return; }
      this.set({ dropLive: d, drop: { ...cur, ...d, url: d.state === 'waiting' ? cur.url : null, pin: d.state === 'waiting' ? cur.pin : null } });
    });
    es.addEventListener('derivative', (m) => {
      const d: { assetId: string; kind: string; status: string } = JSON.parse((m as MessageEvent).data);
      timelineDerivatives.changed(projectId, d.assetId, d.kind); // only timeline clips of that file and kind that are still waiting look again
      this.set({ derivativeTick: this.state.derivativeTick + 1 });
      if (d.kind === 'proxy' && d.status === 'ready') { this.pool?.invalidate(d.assetId); if (this.player && !this.player.playing) this.player.seek(this.player.frame); }
    });
    es.addEventListener('presence', (m) => {
      const p = JSON.parse((m as MessageEvent).data) as Ghost & { gone?: boolean };
      if (p.sessionId === this.sessionId) return;
      const rest = this.state.ghosts.filter((g) => !(g.sessionId === p.sessionId && g.actor === p.actor));
      this.set({ ghosts: p.gone ? rest : [...rest, p] });
      if (this.state.followAgent && !p.gone && p.kind === 'agent') {
        this.following = true;
        try {
          if (p.frame !== null && this.player && !this.player.playing) this.player.seek(p.frame);
          if (p.selection.length && this.state.doc && findClip(this.state.doc, p.selection[0]!)) this.set({ selection: [p.selection[0]!] });
        } finally { this.following = false; }
      }
    });
    const refreshProposals = () => void api.proposals(projectId).then((r) => this.set({ proposals: r.proposals })).catch(() => {});
    es.addEventListener('proposal', refreshProposals);
    const refreshApprovals = () => void api.approvals(projectId).then((r) => this.set({ approvals: r.approvals.filter((a) => a.status === 'pending') })).catch(() => {});
    es.addEventListener('approval', refreshApprovals);
    refreshApprovals();
    es.addEventListener('control', (m) => this.set({ agentsPaused: !!JSON.parse((m as MessageEvent).data).agentsPaused }));
    refreshProposals();
    void api.controls(projectId).then((c) => this.set({ agentsPaused: c.agentsPaused })).catch(() => {});
    es.addEventListener('job', (m) => {
      const j: JobEvent = JSON.parse((m as MessageEvent).data);
      if (j.type === 'import') { this.imports.onJobEvent(j as ImportJobEvent); return; }
      // a fast export that stored segments changes what the next one reuses: the lane and the sheet line ask again
      if (j.type === 'export' && j.status === 'succeeded' && this.state.fastExport && (j.output as { segments?: unknown } | null)?.segments) void this.planPolicy.now(this.state.revision);
      this.set(j.type === 'capability' ? { capJob: j, capJobs: rememberJob(this.state.capJobs, j) } : j.type === 'export' ? { exportJob: j } : j.type === TRACKING_JOB_TYPE ? { trackJobs: rememberJob(this.state.trackJobs, j) } : {});
      // An export this tab started saves its file as soon as it is ready, once; the link in the header stays for another copy.
      if (j.type === 'export' && j.status === 'succeeded' && this.myExports.delete(j.id)) {
        const a = document.createElement('a');
        a.href = `/api/v1/jobs/${j.id}/output`;
        a.download = '';
        a.hidden = true;
        document.body.append(a);
        a.click();
        a.remove();
      }
    });
    es.onerror = () => this.set({ save: 'save.offline' });
    es.onopen = () => { this.set({ save: 'save.saved' }); timelineDerivatives.reconnected(projectId); }; // a derivative announced while the stream was down is looked up again
    // Listing capabilities only reads provider status; it never starts a worker.
    // A failure is kept and shown (AI tools panel) with a way to ask again; it is not taken for "no provider".
    this.set({ providerAsking: true });
    void api.capabilities().then((provider) => this.set({ provider, providerAsking: false, providerError: null }))
      .catch((e) => this.set({ provider: null, providerAsking: false, providerError: failureOf(e) }));
  }
  dispose() {
    this.disposed = true;
    this.planPolicy.dispose();
    this.imports.reset();
    this.es?.close();
    this.player?.dispose();
    void this.pool?.dispose();
  }

  // ---------- perform mode (ADR-0025): the editor side of perform/contract.ts PerformHost (lead) ----------
  get performActive(): boolean { return this.state.workspace === 'perform'; }
  get gpuReady(): boolean { return !!this.state.gpu?.available; }
  /** Multicam live switching owns the number keys (its program is on the video target track): pads then take none. */
  get multicamDigitsLive(): boolean { return !!this.multicamProgram(); }
  setPerformRecording(on: boolean): void { if (!!this.state.performRecording !== on) this.set({ performRecording: on }); }
  /** Review a planned take without committing it (the player restarts with its sound); null shows the committed document again. */
  showGhost(doc: ProjectDocument | null): void {
    this.set({ performGhost: doc });
    const shown = doc ?? this.viewDoc;
    if (shown) this.player?.setDoc(shown);
  }
  /** ONE POST /takes (one transaction, one undo) against the editor's revision, then reload; null when refused (the refusal is shown). */
  async commitTake(req: Omit<TakeRequest, 'expectedRevision' | 'dryRun'>): Promise<TakeResult | null> {
    return this.enqueue(async () => {
      const { doc, revision, rawDoc, activeSequenceId } = this.state;
      if (!doc) return null;
      // the taps are seconds of the sequence shown: a take on another sequence than the main one names it (the server defaults to the main)
      const sequenceId = req.sequenceId ?? (rawDoc && activeSequenceId && activeSequenceId !== rawDoc.mainSequenceId ? activeSequenceId : undefined);
      this.set({ save: 'save.saving', error: null });
      try {
        const r = await api.performTake(doc.id, { ...req, ...(sequenceId ? { sequenceId } : {}), expectedRevision: revision }) as TakeResult;
        this.set({ performGhost: null });
        await this.load(doc.id);
        this.set({ save: 'save.saved' });
        return r;
      } catch (e) {
        if (e instanceof ApiFailure && (e.code === 'stale_revision' || e.code === 'conflict')) { await this.load(doc.id); this.set({ save: 'save.conflict' }); }
        else { this.set({ save: 'save.saved' }); this.fail(e); }
        return null;
      }
    });
  }
  /** A camera take's ops (three replace_clip_keyframes with the take range) as ONE transaction, labelled «צלם». */
  async commitCamera(ops: OpCall[]): Promise<number | null> {
    const r = await this.commit(ops, 'Virtual camera');
    return r ? r.revision : null;
  }
  // ---------- multicam live switching (ADR-0020) ----------
  private sessCache: { doc: ProjectDocument; rec: MulticamSession; out: ProjectDocument } | null = null;
  private committingSession = false;
  private recSaw = false;
  private recTimer = 0;
  /** The local projection of the recording in progress (null when none, or when it has no cuts yet). Memoised on the document and the session. */
  private sessionDoc(): ProjectDocument | null {
    const rec = this.state.multicamRec, doc = this.state.doc;
    if (!rec || !doc || !rec.cuts.length) return null;
    if (this.sessCache?.doc === doc && this.sessCache.rec === rec) return this.sessCache.out;
    const out = projectionResult(doc, rec).doc;
    this.sessCache = { doc, rec, out };
    return out;
  }
  /** What the multicam commands act on: the video target track, when it holds segments of a group (the one under the playhead, else the first). */
  multicamProgram(): { groupId: string; sequenceId: string; trackId: string } | null {
    const d = this.state.doc, trackId = this.target('video');
    if (!d || !trackId) return null;
    const track = d.sequences[d.mainSequenceId]?.tracks.find((t) => t.id === trackId);
    const tagged = (track?.clips ?? []).filter((c) => c.type === 'media' && c.multicam && multicamGroupOf(d, c.multicam.groupId));
    if (!tagged.length) return null;
    const t = this.playhead;
    const under = tagged.find((c) => T.lte(c.start, t) && T.lt(t, clipEnd(c))) ?? tagged[0]!;
    return { groupId: (under as { multicam: { groupId: string } }).multicam.groupId, sequenceId: d.mainSequenceId, trackId };
  }
  /** A session is recording only until stop begins to commit it: from then on digits, Escape and a second stop do nothing. */
  get recordingSwitches(): boolean { return !!this.state.multicamRec && !this.committingSession; }
  private say(text: string) { this.set({ multicamLive: { text, n: (this.state.multicamLive?.n ?? 0) + 1 } }); }
  private ms() { return MULTICAM_STRINGS[this.state.lang]; }
  setMulticamReaction(frames: number) {
    const r = Math.max(0, Math.min(10, Math.round(frames) || 0));
    const rec = this.state.multicamRec;
    this.set({ multicamReaction: r, ...(rec ? { multicamRec: { ...rec, reactionFrames: r } } : {}) });
  }
  /** «הקלטת החלפות» on: digits record cuts in group time while the program plays. Starts playback when it is stopped. */
  startRecording(): void {
    const prog = this.multicamProgram(), doc = this.state.doc;
    if (!prog || !doc || this.state.multicamRec) return;
    this.recSaw = false;
    this.set({ multicamRec: startSession(doc, { ...prog, revision: this.state.revision, reactionFrames: this.state.multicamReaction ?? 0 }) });
    this.say(this.ms().announceStart);
    if (this.player && !this.player.active) void this.player.play();
  }
  /** Record a cut to `angleId` at the group time of the frame on screen minus the reaction offset. Never pauses or restarts anything. */
  recordCut(angleId: string): void {
    const s = this.state.multicamRec, p = this.player, doc = this.state.doc;
    if (!s || !p || !doc || this.committingSession) return;
    const shown = p.painted >= 0 ? p.painted : p.frame;
    const f = Math.max(0, shown - s.reactionFrames);
    const gt = groupTimeAt(doc, s.sequenceId, s.trackId, T.frameTime(f, this.rate));
    if (!gt || gt.groupId !== s.groupId) return;
    this.set({ multicamRec: record(s, gt.g, angleId) });
    const vd = this.viewDoc;
    if (vd) p.setPictureDoc(vd);
  }
  /** The painted frame prefetch was last planned for (-1: nothing is kept warm). */
  private warmAt = -1;
  private warmDoc: ProjectDocument | null = null;
  /**
   * Prefetch for multicam (anglePrefetch.ts, MediaPool.warm): while a multicam program plays at normal speed, keep the decoders of
   * the next segment and, while switches are recorded, of the other picture angles warm within the device's budget; planned once
   * per painted frame. Anything else (paused, shuttling, no program) lets every warm decoder go. Only warms: the picture of every
   * frame is still whatever evaluate gives for it.
   */
  private multicamWarm() {
    const p = this.player, pool = this.pool;
    if (!p || !pool) return;
    const budget = prefetchBudget((globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory);
    // planned from the frame ON SCREEN and the document it was drawn from: right after a live cut, p.doc already shows the new
    // angle on air while its first frame is still being drawn, and a plan from it would let go of the very decoder that frame takes
    const shown = p.painted >= 0 ? p.paintedDoc : null;
    const prog = p.playing && !p.shuttleRate && shown ? this.multicamProgram() : null;
    if (!prog || !shown) { if (this.warmAt !== -1) { this.warmAt = -1; pool.warm([], budget.bytes, budget.off); } return; }
    if (p.painted === this.warmAt && shown === this.warmDoc) return;
    this.warmAt = p.painted;
    this.warmDoc = shown;
    pool.warm(anglePrefetchPlan(shown, prog, p.painted, { quality: p.pictureQuality(), live: this.recordingSwitches }), budget.bytes, budget.off);
  }
  /** Called on every player tick: a pause or the end of the program (not a pause-and-resume inside setDoc) commits the recording. */
  private multicamTick() {
    const s = this.state.multicamRec, p = this.player;
    if (!s || !p || this.committingSession) return;
    if (p.active) { this.recSaw = true; if (this.recTimer) { clearTimeout(this.recTimer); this.recTimer = 0; } return; }
    if (!this.recSaw || this.recTimer) return;
    this.recTimer = window.setTimeout(() => { this.recTimer = 0; if (this.state.multicamRec && !this.player?.active) void this.stopRecording(); }, 200);
  }
  /** One switch_angles (or labelled parts over MAX_CUTS cuts) from the session. A 409 re-sends once at the fresh revision: group-time cuts stay valid. */
  stopRecording(): Promise<void> {
    const s = this.state.multicamRec;
    if (!s || this.committingSession) return Promise.resolve();
    if (this.recTimer) { clearTimeout(this.recTimer); this.recTimer = 0; }
    const S = this.ms();
    const parts = commitParts(s);
    if (!parts.length) { this.set({ multicamRec: null }); this.say(S.announceStop); return Promise.resolve(); }
    this.committingSession = true;
    return this.enqueue(async () => {
      const id = this.state.doc?.id;
      if (!id) { this.committingSession = false; return; }
      const outputs: (SwitchAnglesOutput | undefined)[] = [];
      let revision = s.baseRevision, failed = false;
      this.set({ save: 'save.saving', error: null });
      for (const part of parts) {
        let r: CommitResult | null = null;
        try { r = await api.commit(id, revision, part.ops, part.label); }
        catch (e) {
          if (e instanceof ApiFailure && (e.status === 409 || e.code === 'stale_revision' || e.code === 'conflict')) {
            await this.load(id);
            try { r = await api.commit(id, this.state.revision, part.ops, part.label); } catch (e2) { this.fail(e2); }
          } else this.fail(e);
        }
        if (!r) { failed = true; break; }
        outputs.push(r.results[0]?.output as SwitchAnglesOutput | undefined);
        await this.load(id);
        revision = this.state.revision;
      }
      this.committingSession = false;
      this.set({ multicamRec: null, save: 'save.saved' });
      const vd = this.viewDoc;
      if (vd) this.player?.setPictureDoc(vd);
      const rep = reportOf(outputs);
      const unchanged = unchangedPlaces(rep);
      const skipped = unchanged.reduce((n, k) => n + k.count, 0);
      const why = unchanged.map((k) => (dictionaries[this.state.lang] as Record<string, string>)[`multicam.skip.${k.reason}`] ?? k.reason).join(', ');
      const notes = reportNotes(rep, dictionaries[this.state.lang] as Record<string, string>, S.droppedLine);
      this.say(failed ? S.commitFailed : [S.saved(rep.saved), skipped ? S.skippedSome(skipped, why) : '', ...notes, parts.length > 1 ? S.partsNote(parts.length) : ''].filter(Boolean).join('. '));
    });
  }
  /** Escape: the recording is dropped, nothing is saved, and the program shows as it is. */
  discardRecording(): void {
    if (!this.state.multicamRec || this.committingSession) return;
    if (this.recTimer) { clearTimeout(this.recTimer); this.recTimer = 0; }
    this.set({ multicamRec: null });
    const vd = this.viewDoc;
    if (vd) this.player?.setPictureDoc(vd);
    this.say(this.ms().announceDiscard);
  }
  /** The tagged segment of the program track under the playhead. */
  multicamSegmentAtPlayhead() {
    const prog = this.multicamProgram(), d = this.state.doc;
    if (!prog || !d) return null;
    const t = this.playhead;
    const c = d.sequences[d.mainSequenceId]!.tracks.find((x) => x.id === prog.trackId)?.clips.find((x) => x.type === 'media' && x.multicam && T.lte(x.start, t) && T.lt(t, clipEnd(x)));
    return c && c.type === 'media' ? c : null;
  }
  /**
   * A digit while recording: a cut in group time. While paused: the segment under the playhead takes the angle (one commit);
   * `atPlayhead`: cut there instead (the rest of the program follows, as the default `until` does).
   */
  switchAngle(angleId: string, atPlayhead = false): Promise<unknown> | void {
    if (this.state.multicamRec) return this.recordCut(angleId);
    const prog = this.multicamProgram();
    if (!prog) return;
    if (this.player?.playing) { this.sayOnStage(this.ms().recordHint); return; }
    const base = { groupId: prog.groupId, sequenceId: prog.sequenceId, trackId: prog.trackId, coverage: 'clip' as const };
    if (atPlayhead) return this.commitSwitch({ ...base, cuts: [{ at: this.playhead, angleId }] });
    const seg = this.multicamSegmentAtPlayhead();
    if (!seg) return;
    return this.commitSwitch({ ...base, cuts: [{ at: seg.start, angleId }], until: { at: clipEnd(seg) } });
  }
  private async commitSwitch(args: Record<string, unknown>) {
    const r = await this.commit([{ op: 'switch_angles', args }], 'Switch angles');
    const o = r?.results[0]?.output as SwitchAnglesOutput | undefined;
    if (o) {
      const D = dictionaries[this.state.lang] as Record<string, string>;
      const text = [...o.skipped.map((k) => D[`multicam.skip.${k.reason}`] ?? k.reason), ...reportNotes(o, D, this.ms().droppedLine)].join('. ');
      if (text) this.sayOnStage(text);
    }
    return r;
  }

  // ---------- persistent edits ----------
  /** One call = one transaction = one undo step. Uses baseRevision so unrelated concurrent edits do not conflict. */
  /**
   * This editor's own writes run one after another. Without this, two quick edits (name a marker, then pick its colour)
   * were both sent with the same base revision and the second was refused as a conflict with the user's own first edit.
   * Each queued write reads the revision only when its turn comes; conflicts with OTHER participants are still detected.
   */
  private writes: Promise<unknown> = Promise.resolve();
  private enqueue<R>(fn: () => Promise<R>): Promise<R> {
    const p = this.writes.then(fn, fn);
    this.writes = p.catch(() => undefined);
    return p;
  }
  /** `ops` may be a function: it is called when this write's turn comes, so it can decide from the document as it is then (after the user's earlier queued edits). Returning null or nothing commits nothing. */
  commit(ops: OpCall[] | (() => OpCall[] | null), label?: string): Promise<CommitResult | null> { return this.enqueue(() => this.commitNow(ops, label)); }
  history(mode: 'undo' | 'redo'): Promise<void> { return this.enqueue(() => this.historyNow(mode)); }
  /**
   * Undo exactly the transaction `id` (an undo toast's button): the server reverses that one or refuses with undo_conflict when
   * its items were changed afterwards, so a later edit (the owner's or an agent's) is never undone in its place. One that was
   * already undone (Ctrl+Z got there first) is left as it is.
   */
  undoTransaction(id: string): Promise<void> { return this.enqueue(() => this.historyNow('undo', id)); }
  /** Redo exactly the undo `id` (the command bar's «בצע שוב» names it in its preview). */
  redoTransaction(id: string): Promise<void> { return this.enqueue(() => this.historyNow('redo', id)); }
  /**
   * The command bar's commit (ADR-0027, lead contract (b)): exactly `ops` (already injected and previewed: NOT injected again),
   * as one transaction, STRICT at `expectedRevision` — never rebased onto a newer revision, so nothing runs that the owner did
   * not see — with the given idempotency key ('bar:' + planHash), so a second Enter replays instead of applying twice. Queued
   * like commit. 'stale': the project moved on (the document is reloaded; the bar plans again and shows the new preview).
   * 'failed': refused (an op's own reason, or the network); nothing was applied and the bar shows it (no error bar here).
   */
  commitExact(ops: OpCall[], label: string, expectedRevision: number, idempotencyKey: string): Promise<ExactCommit> { return this.enqueue(() => this.commitExactNow(ops, label, expectedRevision, idempotencyKey)); }
  private async commitExactNow(ops: OpCall[], label: string, expectedRevision: number, idempotencyKey: string): Promise<ExactCommit> {
    const { doc } = this.state;
    if (!doc) return { kind: 'failed', code: 'no_project', message: 'no project is open' };
    if (!ops.length) return { kind: 'failed', code: 'no_change', message: 'nothing to commit' };
    this.set({ save: 'save.saving', error: null });
    try {
      const r = await api.commitExact(doc.id, expectedRevision, ops, label, idempotencyKey);
      await this.load(doc.id);
      this.set({ save: 'save.saved' });
      return { kind: 'committed', result: r, replayed: !!r.replayed };
    } catch (e) {
      this.set({ save: 'save.saved' });
      if (e instanceof ApiFailure && e.code === 'stale_revision') {
        await this.load(doc.id).catch(() => undefined);
        const cur = (e.details as { currentRevision?: unknown } | undefined)?.currentRevision;
        return { kind: 'stale', currentRevision: typeof cur === 'number' ? cur : null };
      }
      return e instanceof ApiFailure ? { kind: 'failed', code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } : { kind: 'failed', code: 'network', message: e instanceof Error ? e.message : String(e) };
    }
  }
  private async commitNow(given: OpCall[] | (() => OpCall[] | null), label?: string): Promise<CommitResult | null> {
    const { doc, revision } = this.state;
    if (!doc) return null;
    const made = typeof given === 'function' ? given() : given;
    if (!made?.length) return null;
    // an operation that names a sequence and omits it works on the one shown (derived from the registered schemas)
    const raw = this.state.rawDoc;
    const ops = raw ? made.map((c) => injectSequenceId(c, this.state.activeSequenceId, raw.mainSequenceId)) : made;
    this.set({ save: 'save.saving', error: null });
    try {
      const r = await api.commit(doc.id, revision, ops, label);
      await this.load(doc.id);
      this.set({ save: 'save.saved' });
      return r;
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'stale_revision' || e.code === 'conflict')) {
        await this.load(doc.id);
        this.set({ save: 'save.conflict' });
      } else {
        this.set({ save: 'save.saved' });
        this.fail(e);
      }
      return null;
    }
  }
  private async historyNow(mode: 'undo' | 'redo', transactionId?: string): Promise<void> {
    const { doc } = this.state;
    if (!doc) return;
    this.set({ error: null });
    try {
      await api.undo(doc.id, mode, transactionId);
      await this.load(doc.id);
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'nothing_to_undo' || e.code === 'nothing_to_redo' || e.code === 'already_undone')) return;
      this.fail(e instanceof ApiFailure && e.code === 'undo_conflict' ? new Error(this.t('undo.conflict')) : e);
    }
  }
  /**
   * Import a file into the library; with `place`, also put it on the timeline there (a file dropped from the computer onto the timeline).
   * A colour table (.cube) only joins the library: it is applied to clips as an effect. Resolves to the asset id, or null when it failed.
   */
  async importFile(file: File, place?: { frame: number; trackId: string | null }): Promise<string | null> {
    const { doc } = this.state;
    if (!doc) return null;
    this.set({ uploading: true, error: null });
    try {
      const r = await api.upload(doc.id, file);
      // A conformed asset is not byte-identical to the local file, so only reuse the local file when it was stored as-is.
      if (!r.asset.conform) this.pool?.provideLocal(r.assetId, file);
      await this.load(doc.id);
      if (place && r.asset.kind !== 'lut') await this.dropAsset(r.assetId, place.frame, place.trackId);
      return r.assetId;
    } catch (e) {
      this.fail(e instanceof ApiFailure && e.code === 'unsupported_media' ? new Error(`${this.t('media.unsupported')}: ${e.message}`) : e);
      return null;
    } finally {
      this.set({ uploading: false });
    }
  }
  /**
   * Several files at once (a multi-file drop or pick): imported one after another, in name order. With `place`, the first goes
   * where it was dropped and each following one starts where the previous one ended, on the same track when it fits there.
   */
  async importFiles(files: File[], place?: { frame: number; trackId: string | null }) {
    // Media goes through the import queue (ADR-0023): the cards show each file; files dropped on the timeline are placed in order
    // when their jobs succeed, through dropAsset (the owner's undo stack). A colour table keeps the synchronous route.
    const cubes = files.filter((f) => /\.cube$/i.test(f.name));
    const media = files.filter((f) => !/\.cube$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (media.length) this.imports.enqueueLocal(media, { via: 'browser', ...(place ? { place } : {}) });
    for (const c of cubes) { await this.importFile(c); if (this.state.error) return; }
  }
  /** A picked folder (webkitdirectory) or a dropped one (collectDropped): media only, natural order, at most 500; the rest is counted. */
  importFolder(entries: { file: File; relativePath: string }[]) { if (entries.length) this.imports.enqueueFolder(entries); }
  /** ImportsHost.place: the document holding the asset is loaded first (dropAsset places nothing for an asset it cannot see). */
  private async placeImported(assetId: string, frame: number, trackId: string | null): Promise<number | null> {
    const pid = this.state.doc?.id;
    if (!pid) return null;
    if (!this.state.doc?.assets[assetId]) await this.load(pid).catch(() => undefined);
    if (!this.state.doc?.assets[assetId]) return null;
    const r = await this.dropAsset(assetId, frame, trackId);
    const clipId = r?.results[0]?.output?.clipId;
    const placed = typeof clipId === 'string' && this.state.doc ? findClip(this.state.doc, clipId) : undefined;
    return placed ? T.frameIndexAt(clipEnd(placed.clip), this.rate) : null;
  }

  /** Choose (or, given the current one, clear) the target track of its kind. */
  toggleTarget(kind: 'video' | 'audio', trackId: string) {
    const targets = { ...this.state.targets, [kind]: this.state.targets[kind] === trackId ? null : trackId };
    const id = this.state.doc?.id;
    if (id) try { localStorage.setItem(`${TARGETS_KEY}.${id}`, JSON.stringify(targets)); } catch { /* storage unavailable: the choice lasts for this visit */ }
    this.set({ targets });
  }
  /** The chosen target track of a kind, if it still exists and is not locked. */
  target(kind: 'video' | 'audio'): string | null {
    const d = this.state.doc, id = this.state.targets[kind];
    const tr = d && id ? d.sequences[d.mainSequenceId]!.tracks.find((t) => t.id === id) : undefined;
    return tr && tr.kind === kind && !tr.locked ? tr.id : null;
  }
  /** The «ייצוא מהיר» switch (ADR-0024): a preference of this browser, never an edit of the project. */
  setFastExport(on: boolean) {
    try { localStorage.setItem(FAST_EXPORT_KEY, on ? '1' : '0'); } catch { /* storage unavailable: the choice lasts for this visit */ }
    this.set({ fastExport: on });
    if (on) void this.planPolicy.now(this.state.revision);
    else { this.planPolicy.cancel(); this.set({ segmentPlan: { status: 'off', view: null, revision: null } }); }
  }
  /** The export sheet's choices changed: the lane and the line plan with them (the quality is part of every segment key). */
  setPlanOptions(options: Record<string, unknown>) {
    if (JSON.stringify(options) === JSON.stringify(this.state.planOptions)) return;
    this.set({ planOptions: options });
    if (this.state.fastExport) void this.planPolicy.now(this.state.revision);
  }
  /** The «רענון» button of the lane (a slow keying stops the lane from refreshing by itself). */
  refreshPlan() { if (this.state.fastExport) void this.planPolicy.now(this.state.revision); }
  /** One plan request (POST …/exports/segments/plan); its blocker codes reach the sheet's switch as `blockerCodes`. */
  private async askPlan(signal: AbortSignal, revision: number): Promise<{ keyingMs: number } | void> {
    const id = this.state.doc?.id;
    if (!id) return;
    this.set({ segmentPlan: { ...this.state.segmentPlan, status: 'updating' }, planBlockers: [] });
    const r = await fetch(`/api/v1/projects/${encodeURIComponent(id)}/exports/segments/plan`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...this.state.planOptions, mode: 'incremental' }) });
    const body = await r.json().catch(() => undefined);
    if (signal.aborted) return;
    if (r.ok && body?.mode === 'incremental') { this.set({ segmentPlan: { status: 'ready', view: body as SegmentPlanView, revision: (body as SegmentPlanView).revision ?? revision } }); return { keyingMs: (body as SegmentPlanView).keyingMs }; }
    const blockers = Array.isArray(body?.error?.details?.blockers) ? (body.error.details.blockers as { code: string }[]).map((b) => b.code) : [];
    this.set({ segmentPlan: { status: blockers.length ? 'off' : 'error', view: null, revision }, planBlockers: blockers });
  }

  // ---------- the phone drop (ADR-0023): the owner's dialog ----------
  /** The family film dialog (ADR-0026): open it on an event's files or a selection; close it; remember the run this tab made. */
  openFilm(source: FilmSource) { this.set({ filmOpen: true, filmSource: { assetIds: [...source.assetIds], event: source.event ?? null } }); }
  closeFilm() { this.set({ filmOpen: false }); }
  setFilmRun(run: FilmRunInfo | null) { this.set({ filmRun: run }); }
  openPhoneDrop() { this.set({ phoneDropOpen: true }); }
  hidePhoneDrop() { this.set({ phoneDropOpen: false }); }
  /** The live code of this project, if any (after a reload; a code never survives a server restart: then it is gone, said so). */
  async refreshDrop() {
    const id = this.state.doc?.id;
    if (!id || this.state.actor !== 'user:local') return;
    try {
      const had = this.state.drop;
      const { drop } = await dropApi.current(id);
      this.set({ drop, ...(had && had.state !== 'closed' && !drop ? { dropProblem: 'restarted' as const } : {}) });
    } catch { /* not the owner, or the drop is not available: nothing to show */ }
  }
  /** The owner confirmed `address` in the dialog (the server never picks one alone). */
  async openDropCode(address: string) {
    const id = this.state.doc?.id;
    if (!id) return;
    try {
      const { drop } = await dropApi.open(id, address);
      this.set({ drop, dropLive: null, dropProblem: null });
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : '';
      if (code === 'no_private_network' || code === 'drop_listen_failed') this.set({ dropProblem: code, drop: null });
      else this.fail(e);
    }
  }
  async closeDropCode(dropId: string) {
    const id = this.state.doc?.id;
    if (!id) return;
    try { const { drop } = await dropApi.close(id, dropId); this.set({ drop, dropLive: null }); } catch (e) { if (e instanceof ApiFailure && e.code === 'drop_not_found') this.set({ drop: null }); else this.fail(e); }
  }
  setWorkspace(workspace: Workspace) {
    try { localStorage.setItem(WS_KEY, workspace); } catch { /* ignore */ }
    if (workspace === this.state.workspace) return;
    // perform mode (ADR-0025) works on the master only: entering it leaves a viewed format (remembered for the view's note);
    // leaving it drops a ghost and a recording
    if (workspace === 'perform') { const left = this.state.viewVariantId; this.set({ workspace, performLeftVariant: left }); if (left) this.setViewVariant(null); return; }
    if (this.state.workspace === 'perform') { this.set({ performRecording: false, performLeftVariant: null }); if (this.state.performGhost) this.showGhost(null); }
    this.set({ workspace });
  }
  /** 'toggle' adds the clip to the selection or removes it (Shift/Ctrl/⌘-click); the default replaces the selection. */
  select(id: string | null, mode: 'replace' | 'toggle' = 'replace') {
    const cur = this.state.selection;
    const selection = !id ? [] : mode === 'toggle' ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id];
    // a chosen cut belongs to the clip after it: any other selection lets it go
    const cutGone = this.state.cutClipId && !(selection.length === 1 && selection[0] === this.state.cutClipId) ? { cutClipId: null, loupe: false } : {};
    // keys selected in a clip's strip belong to that clip's selection: any other selection lets them go
    const ks = this.state.keySel;
    const keySel = ks && !(selection.length === 1 && selection[0] === ks.clipId) ? { keySel: null } : {};
    this.set({ selection, ...cutGone, ...keySel, ...(this.following ? {} : { followAgent: false }) });
  }
  /**
   * Choose the cut at the start of `clipId` (that clip is selected with it, so the inspector and the ride bar show the cut),
   * or let the chosen cut go with null (the selection stays). Choosing a cut shows the loupe unless `loupe: false`.
   */
  selectCut(clipId: string | null, opts: { loupe?: boolean } = {}) {
    if (!clipId) { if (this.state.cutClipId || this.state.loupe) this.set({ cutClipId: null, loupe: false }); return; }
    const loupe = opts.loupe ?? true;
    if (this.state.cutClipId === clipId && this.state.loupe === loupe && this.state.selection.length === 1 && this.state.selection[0] === clipId) return;
    this.set({ selection: [clipId], cutClipId: clipId, loupe, ...(this.following ? {} : { followAgent: false }) });
  }
  /** Show or hide the cut loupe (only while a cut is chosen). */
  setLoupe(on: boolean) { const loupe = on && !!this.state.cutClipId; if (loupe !== this.state.loupe) this.set({ loupe }); }
  // ---------- keyframe strip, curve picker, motion path (ADR-0019): session state only ----------
  /** Select keys of one clip (null clears). The selection is never stored in the document. */
  setKeySel(sel: { clipId: string; keys: KeyRef[] } | null) { this.set({ keySel: sel && sel.keys.length ? sel : null }); }
  /** Keep the copied keys (values and curves) for pastes on this or another clip. */
  setKeyClipboard(cb: KeyClipboard | null) { this.set({ keyClipboard: cb }); }
  /** Open the curve picker for these channels at this clip-local frame. */
  openCurvePicker(clipId: string, frame: number, channels: ChannelRef[]) { this.set({ curvePicker: { clipId, frame, channels } }); }
  closeCurvePicker() { if (this.state.curvePicker) this.set({ curvePicker: null }); }
  /** Show or hide the motion path on the stage: a setting of this browser (localStorage 'pf.motionPath'). */
  setPathOn(on: boolean) { try { localStorage.setItem(MOTION_PATH_KEY, on ? '1' : '0'); } catch { /* ignore */ } this.set({ pathOn: on }); }
  /** Ask the inspector to show a tab of the selected object (it ignores a tab the object does not have). */
  openInspectorTab(tab: ObjectTab) { this.set({ inspectorTab: { tab, n: ++this.requests } }); }
  /**
   * Show a panel for the clip `clipId` (the ride bar's speed, animation, effect, sound, replace and "all transitions"): the
   * inspector opens the tab that holds it and moves the focus there; effects and the transitions gallery open the gallery.
   */
  openPanel(target: PanelTarget, clipId: string | null) {
    if (clipId && !(this.state.selection.length === 1 && this.state.selection[0] === clipId)) this.select(clipId);
    this.set({ panelRequest: { target, clipId, n: ++this.requests } });
    if (target === 'effects') this.openGallery('effects');
    else if (target === 'transitions-gallery') this.openGallery('transitions');
  }
  /** Open the effects gallery for the selected clip, on one of its tabs (its first one when null or not offered). */
  openGallery(tab: GalleryTab | null = null) { if (this.selected) this.set({ gallery: { tab, n: ++this.requests } }); }
  closeGallery() { if (this.state.gallery) this.set({ gallery: null }); }
  /** Say a quiet line over the viewer; null takes it away. */
  sayOnStage(text: string | null) { this.set({ stageNote: text ? { text, at: Date.now() } : null }); }
  /** Open the export sheet (for callers that do not import ExportSheet.tsx, such as the command registry). */
  /**
   * Open the export sheet (for callers that do not import ExportSheet.tsx, such as the command registry and the command bar).
   * With a destination it opens with that destination chosen, exactly as a click on its tile; nothing is exported until the
   * sheet's own button (the owner's decision: Export always opens the sheet).
   */
  openExportSheet(destination: ExportDestinationId | null = null) { this.set({ exportSheet: this.state.exportSheet + 1, exportSheetDestination: destination }); }
  /** Show a toast (App.tsx mounts the queue). */
  notify(notice: Notice) { this.set({ notice: { ...notice, n: ++this.requests } }); }
  selectAll() {
    const doc = this.state.doc;
    if (doc) this.set({ selection: [...doc.sequences[doc.mainSequenceId]!.tracks].reverse().filter((t) => !t.locked).flatMap((t) => t.clips.map((c) => c.id)) });
  }
  /** A manual seek by the user ends Follow Agent: the agent never fights the human for the view. */
  seek(frame: number) { if (this.state.followAgent && !this.following) this.set({ followAgent: false }); this.player?.seek(frame); }
  /** Tell other participants where I am (throttled; transient). */
  private announce(projectId: string) {
    const key = `${this.frame}|${this.state.selection.join(',')}`;
    if (key === this.lastPresence || this.presenceTimer) return;
    this.presenceTimer = window.setTimeout(() => {
      this.presenceTimer = 0;
      this.lastPresence = `${this.frame}|${this.state.selection.join(',')}`;
      if (!this.player?.playing) void api.presence(projectId, this.sessionId, this.frame, this.state.selection).catch(() => {});
    }, 250);
  }
  /** Exports started from this tab that have not finished yet (their file is saved automatically when ready). */
  private myExports = new Set<string>();
  /**
   * An export this tab started (the export sheet, a retry): its file is saved by itself once it is ready, and it becomes the
   * export the top bar's ring follows until a newer one starts.
   */
  trackExport(jobId: string) {
    this.myExports.add(jobId);
    this.set({ exportJob: { id: jobId, type: 'export', status: 'queued', stage: null, output: null, error: null } });
  }
  /**
   * Start an export through the same REST route as every client (the export sheet calls this; the top bar's Export button and
   * the palette open the sheet). Resolves to the job id; a refusal (preflight blockers, a format the server refuses) is
   * thrown to the caller, who says it in place.
   */
  async startExport(options: ExportRequest = {}): Promise<string | null> {
    const { doc } = this.state;
    if (!doc) return null;
    // a short on screen exports as that short (preview = export through one projection); an explicit sequenceId is kept
    const { activeSequenceId, rawDoc } = this.state;
    const opts: ExportRequest = rawDoc && activeSequenceId && activeSequenceId !== rawDoc.mainSequenceId && options.sequenceId === undefined ? { ...options, sequenceId: activeSequenceId } : options;
    const j = await api.startExport(doc.id, Object.keys(opts).length ? opts : undefined);
    this.trackExport(j.jobId);
    return j.jobId;
  }
  /** Pause Agent / Take Over: the server refuses agent mutations until the owner resumes. */
  setAgentsPaused(paused: boolean) { const d = this.state.doc; if (d) api.setPaused(d.id, paused).then((r) => this.set({ agentsPaused: r.agentsPaused })).catch(this.fail); }
  /** The owner's decision on an agent's request. Approving a model download starts it for exactly the bytes that were shown. */
  async decideApproval(approvalId: string, decision: 'approve' | 'reject') {
    const d = this.state.doc;
    if (!d) return;
    try { await api.decideApproval(d.id, approvalId, decision); } catch (e) { this.fail(e); }
    this.set({ approvals: (await api.approvals(d.id).catch(() => ({ approvals: this.state.approvals }))).approvals.filter((a) => a.status === 'pending') });
  }
  async decideProposal(proposalId: string, decision: 'accept' | 'reject') {
    const d = this.state.doc;
    if (!d) return;
    this.set({ error: null });
    try {
      await api.decideProposal(d.id, proposalId, decision);
      await this.load(d.id);
    } catch (e) {
      this.fail(e instanceof ApiFailure && e.code === 'proposal_stale' ? new Error(this.t('proposal.stale')) : e);
    }
    this.set({ proposals: (await api.proposals(d.id).catch(() => ({ proposals: this.state.proposals }))).proposals });
  }
  /**
   * Starts a capability run and returns its job id. The job is recorded as queued unless its first event has already come in
   * (the event stream can be quicker than the answer to the request). A refusal is thrown to the caller, who says it in place.
   */
  async runCapability(capabilityId: string, params: Record<string, unknown> = {}, how: { source?: RunSource; apply?: ApplyMode; confirmLongRun?: boolean } = {}): Promise<string | null> {
    const { doc } = this.state;
    if (!doc) return null;
    // ADR-0017: what the tool reads (source), where the result goes (apply) and the long-run confirmation go with the run, as over REST and MCP.
    const { jobId } = how.source || how.apply || how.confirmLongRun ? await aiApi.run(doc.id, capabilityId, { params, ...how }) : await api.runCapability(doc.id, capabilityId, params);
    if (!this.state.capJobs[jobId]) {
      const queued: JobEvent = { id: jobId, type: 'capability', status: 'queued', stage: null, output: null, error: null };
      this.set({ capJob: queued, capJobs: rememberJob(this.state.capJobs, queued) });
    }
    return jobId;
  }

  /** Read the capabilities and their setup states again (a card's «בדוק שוב»). A failed read keeps what is shown and is rethrown. */
  async refreshCapabilities(): Promise<void> {
    const provider = await api.capabilities();
    this.set({ provider, providerError: null });
  }
  /** True when this browser is the owner's session (only the owner marks a translation reviewed; the server checks it again). */
  get isOwner(): boolean { return !!this.state.actor?.startsWith('user:'); }
  /** The owner's review mark on a machine translation (ADR-0017). The server refuses it for anyone but the owner's session. */
  async reviewTranslation(variantId: string, review: 'reviewed' | 'needed'): Promise<boolean> {
    const d = this.state.doc;
    if (!d) return false;
    try { await aiApi.reviewTranslation(d.id, variantId, review); await this.load(d.id); return true; } catch (e) { this.fail(e); return false; }
  }

  // ---------- editing helpers used by commands and panels ----------
  /** End of the last picture/audio clip: where a newly added asset goes. */
  appendPoint(): T.RationalTime {
    let end = T.ZERO;
    const doc = this.state.doc;
    if (doc) for (const tr of doc.sequences[doc.mainSequenceId]!.tracks) if (tr.kind !== 'text') for (const c of tr.clips) end = T.max(end, clipEnd(c));
    return T.snapToFrame(end, this.rate);
  }
  /**
   * A library file dropped on the timeline: placed at that frame, on the track it was dropped on when the track suits it
   * (a picture file on a picture track, a sound-only file on a sound track), otherwise on the first free track.
   * The linked sound of a picture file goes to the sound target track, if one is chosen and free over the new clip; when the
   * target is occupied there it is not named, and the sound lands on a free sound track instead of on top of what is there.
   * A sound-only file dropped on a sound track stays on that track: the user named it by dropping there.
   */
  dropAsset(assetId: string, frame: number, trackId: string | null) {
    const a = this.state.doc?.assets[assetId];
    if (!a || a.kind === 'lut') return Promise.resolve(null); // a colour table is applied as an effect, never placed
    const start = T.frameTime(Math.max(0, frame), this.rate);
    // decided when this write's turn comes: the sound target is named only while it is free there (see placement.ts)
    return this.commit(() => {
      const d = this.state.doc;
      const args = d ? dropAssetArgs(d, assetId, { start, trackId, audioTarget: this.target('audio') }) : null;
      return args ? [{ op: 'add_clip', args }] : null;
    }, 'Add clip');
  }
  addAsset(assetId: string) {
    if (this.state.doc?.assets[assetId]?.kind === 'lut') return Promise.resolve(null); // a colour table is applied as an effect, never placed
    const playhead = this.playhead; // where the user is now
    // Target tracks: the picture goes to the picture target; the sound (a sound-only file, or the linked sound of a picture file)
    // to the sound target while that track is free there. A picture goes after what is already there; a sound-only file (music,
    // a recording) starts at the playhead. Where exactly is decided when this write's turn comes, from the document as it is
    // then: pressing + twice must not put the second sound on top of the first (an occupied sound target is not named, so the
    // server places the sound on a free sound track).
    return this.commit(() => {
      const d = this.state.doc;
      return d ? [{ op: 'add_clip', args: addAssetArgs(d, assetId, { appendPoint: this.appendPoint(), playhead, videoTarget: this.target('video'), audioTarget: this.target('audio') }) }] : null;
    }, 'Add clip');
  }
  async addText() {
    const rate = this.rate;
    const r = await this.commit([{ op: 'add_text', args: { text: this.t('text.default'), start: this.playhead, duration: defaultTitleDuration(rate) } }], 'Add text');
    const id = r?.results[0]?.output?.clipId;
    if (id) this.select(id);
  }
  /**
   * Change transform properties of a clip at the playhead. A property that is already animated gets a keyframe
   * at the playhead; a static property is set directly. One transaction either way.
   */
  setTransformAtPlayhead(clip: Clip, values: Partial<Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity', number>>, label = 'Transform') {
    const playhead = this.playhead; // where the user is now
    // "Write a key" vs "change the static value" is decided when this edit's turn comes, from the clip as it is then:
    // the clip object handed in may predate the user's own earlier, still queued edits (e.g. the first keyframe).
    return this.commit(() => {
      const cur = this.state.doc ? findClip(this.state.doc, clip.id)?.clip : undefined;
      if (!cur) return null;
      const local = T.sub(playhead, cur.start);
      const ops: OpCall[] = [];
      const still: Record<string, number> = {};
      for (const [p, raw] of Object.entries(values)) {
        const v = Math.round((raw as number) * 1e4) / 1e4; // pointer precision is not meaningful beyond this
        if (cur.keyframes?.[p as 'x']?.length) ops.push({ op: 'set_keyframe', args: { clipId: cur.id, property: p, time: local, value: v } });
        else still[p] = v as number;
      }
      if (Object.keys(still).length) ops.push({ op: 'set_clip_transform', args: { clipId: cur.id, transform: still } });
      return ops;
    }, label);
  }
  /**
   * Canvas edits: while a format is viewed they become a per-format override (master untouched); otherwise a normal transform edit.
   */
  setTransformForView(clip: Clip, values: Partial<Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity', number>>, label = 'Transform') {
    const variantId = this.state.viewVariantId;
    if (!variantId) return this.setTransformAtPlayhead(clip, values, label);
    const transform: Record<string, number> = {};
    for (const [p, raw] of Object.entries(values)) transform[p] = Math.round((raw as number) * 1e4) / 1e4;
    return Object.keys(transform).length ? this.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, transform } }], label) : Promise.resolve(null);
  }
  /** Remember the selected clips for Paste. */
  copySelection() { if (this.state.selection.length) this.set({ clipboard: [...this.state.selection], cutPending: [] }); }
  /** Remember the selected clips and mark them cut-pending; they move on Paste. */
  cutSelection() { if (this.state.selection.length) this.set({ clipboard: [...this.state.selection], cutPending: [...this.state.selection] }); }
  /** Cancel a pending cut (the clipboard goes with it). */
  clearCut() { if (this.state.cutPending.length) this.set({ cutPending: [], clipboard: [] }); }
  /** Copied clip ids that still exist in the document. */
  get clipboardLive(): string[] { const d = this.state.doc; return d ? this.state.clipboard.filter((id) => findClip(d, id)) : []; }
  private preferTracks() { const ids = [this.target('video'), this.target('audio')].filter((x): x is string => !!x); return ids.length ? { preferTrackIds: ids } : {}; }
  private async duplicate(clipIds: string[], at: T.RationalTime, label: string) {
    const r = await this.commit([{ op: 'duplicate_clips', args: { clipIds, at, ...this.preferTracks() } }], label);
    const created = r?.results[0]?.output?.createdClipIds;
    if (Array.isArray(created) && created.length) this.set({ selection: created as string[], ...(this.following ? {} : { followAgent: false }) });
    return r;
  }
  pasteClipboard() {
    const ids = this.clipboardLive;
    if (!ids.length) { this.set({ error: this.t('clipboard.gone') }); return Promise.resolve(null); }
    if (this.state.cutPending.length) return this.pasteCut(ids);
    return this.duplicate(ids, this.playhead, 'Paste');
  }
  /** Cut + paste = one transaction: duplicate at the playhead, then delete the originals. */
  private async pasteCut(ids: string[]) {
    const r = await this.commit([
      { op: 'duplicate_clips', args: { clipIds: ids, at: this.playhead, ...this.preferTracks() } },
      ...ids.map((clipId) => ({ op: 'delete_clip', args: { clipId, includeLinked: false } })),
    ], 'Move clips');
    if (r) {
      const created = r.results[0]?.output?.createdClipIds;
      this.set({ cutPending: [], clipboard: [], ...(Array.isArray(created) && created.length ? { selection: created as string[], ...(this.following ? {} : { followAgent: false }) } : {}) });
    }
    return r;
  }
  duplicateSelection() {
    const doc = this.state.doc;
    if (!doc) return Promise.resolve(null);
    const clips = this.state.selection.map((id) => findClip(doc, id)?.clip).filter((c): c is Clip => !!c);
    if (!clips.length) return Promise.resolve(null);
    const end = clips.reduce((m, c) => T.max(m, clipEnd(c)), clips[0]!.start);
    return this.duplicate(clips.map((c) => c.id), T.snapToFrame(end, this.rate), 'Duplicate');
  }
  // ---------- adjustment layers and templates (ADR-0016) ----------
  /** An adjustment layer over the whole edit, selected so its Look panel is in view (palette: cmd.addAdjustment). */
  async addWholeEditAdjustment() {
    const r = await this.commit([{ op: 'add_adjustment', args: { span: 'edit' } }], 'Adjustment layer');
    const id = r?.results[0]?.output?.clipId;
    if (typeof id === 'string') this.select(id);
    return r;
  }
  /**
   * "Apply to: the whole edit": the effect or look goes on the existing whole-edit adjustment, or on a new one made over the
   * edit (commands.ts wholeEditOps). Decided when the write's turn comes; one transaction either way.
   */
  applyToWholeEdit(pick: WholeEditPick, label = 'Adjust the whole edit') {
    return this.commit(() => (this.state.doc ? wholeEditOps(this.state.doc, pick) : null), label);
  }
  /** Expand the Templates drawer of the library and move the keyboard focus to its first card (palette, Welcome; TemplatesDrawer.tsx). */
  openTemplates() { this.set({ templatesOpen: true, templatesFocus: this.state.templatesFocus + 1 }); }
  setTemplateRun(run: TemplateRunInfo | null) { this.set({ templateRun: run }); }

  /** The selected clip's transform as rendered at the playhead (keyframes applied). */
  transformNow(clip: Clip) { return transformAt(clip, T.max(clip.start, T.min(this.playhead, clipEnd(clip)))); }

  // ---------- motion tracking (ADR-0015) ----------
  /** The playhead moved into the clip: its first frame before it, its last frame after it. */
  timeIn(clip: Clip): T.RationalTime {
    const last = T.max(clip.start, T.sub(clipEnd(clip), T.frameTime(1, this.rate)));
    return T.max(clip.start, T.min(this.playhead, last));
  }
  /**
   * A clip's layer as the one evaluator draws it (preview, stills and export alike) at `time` (default: the playhead) in the
   * viewed format, and the frame it belongs to; null when the clip is not drawn then (another time, a hidden track).
   */
  layerAt(clipId: string, time: T.RationalTime = this.playhead, doc: ProjectDocument | null = this.viewDoc): { layer: VideoLayer | ImageLayer | TextLayer; graph: RenderGraph } | null {
    return doc ? layerOf(doc, clipId, time) : null;
  }
  /**
   * The clip's transform as drawn at the playhead in the viewed format. For a clip that follows a motion track this is the
   * resolved one of the evaluator's follow post-pass (its own transform is then an offset from the tracked point); for any
   * other clip it is its own transform with keyframes applied. The canvas handles, the transform fields and the commands read it.
   */
  resolvedTransformNow(clip: Clip): ResolvedNow {
    const vd = this.viewDoc;
    const viewClip = (vd && findClip(vd, clip.id)?.clip) || clip;
    const time = this.timeIn(viewClip);
    const own = transformAt(viewClip, time);
    if (viewClip.type === 'caption' || !viewClip.follow) return { transform: own, own, m: 1, follow: null };
    const at = this.layerAt(clip.id, time, vd);
    if (!at?.layer.follow) return { transform: own, own, m: 1, follow: at?.layer.follow ?? null };
    return { transform: at.layer.transform, own, m: followFactor(at.layer.transform.scale, own.scale), follow: at.layer.follow };
  }
  /**
   * A change made on the monitor or in the transform fields, in the values the user sees (resolved ones for a follower),
   * written as the clip's own values: for a follower a move of Δ is a move of Δ/m of its offset and a scale s is s/m; rotation
   * and opacity are its own. Through setTransformForView (a keyframe when animated, a format override while a format is viewed).
   */
  setShownTransform(clip: Clip, before: ResolvedNow, values: TransformValues, label = 'Transform') {
    if (!before.follow) return this.setTransformForView(clip, values, label);
    const { rotation, opacity } = values;
    const out: TransformValues = { ...ownFromResolved(before.own, before.transform, { ...(values.x !== undefined ? { x: values.x } : {}), ...(values.y !== undefined ? { y: values.y } : {}), ...(values.scale !== undefined ? { scale: values.scale } : {}) }, before.m) };
    if (rotation !== undefined) out.rotation = rotation;
    if (opacity !== undefined) out.opacity = opacity;
    return this.setTransformForView(clip, out, label);
  }
  /**
   * The offset (transform x, y) that attaches `clipId` to `follow` without moving it on the master frame at the playhead
   * (tracking.math.ts followOffsetAt: keepOffset over the evaluator's own resolver). Null when the clip is not drawn then.
   */
  followOffset(clipId: string, follow: Follow): { x: number; y: number } | null {
    const doc = this.state.doc;
    const found = doc ? findClip(doc, clipId) : undefined;
    return doc && found ? followOffsetAt(doc, clipId, follow, this.timeIn(found.clip)) : null;
  }
  /** Open the track picker on a clip's picture (TrackPicker.tsx). */
  openPicker(kind: 'point' | 'region', clipId: string) {
    const f = this.state.doc ? findClip(this.state.doc, clipId) : undefined;
    if (!f || f.clip.type !== 'media') return;
    this.set({ picker: { kind, clipId, assetId: f.clip.assetId } });
  }
  closePicker() { if (this.state.picker) this.set({ picker: null }); }
  /** Start tracking a motion track (a durable job on the server); resolves to the job id. A refusal is thrown to the caller, who says it in place. */
  async trackMotion(motionTrackId: string, body: Partial<TrackRun> = {}): Promise<string | null> {
    const d = this.state.doc;
    if (!d) return null;
    const r = await apiJson<{ jobId: string; status: string }>(`/projects/${d.id}/motion-tracks/${encodeURIComponent(motionTrackId)}/track`, body);
    const queued: JobEvent = this.state.trackJobs[r.jobId] ?? { id: r.jobId, type: TRACKING_JOB_TYPE, status: r.status, stage: null, output: null, error: null };
    this.set({ trackJobs: rememberJob(this.state.trackJobs, queued), trackJobFor: { ...this.state.trackJobFor, [motionTrackId]: r.jobId } });
    return r.jobId;
  }
  /** Stop the tracking job this session started for a motion track (POST /api/v1/jobs/:id/cancel); nothing is attached. */
  async cancelTracking(motionTrackId: string) {
    const jobId = this.state.trackJobFor[motionTrackId];
    if (jobId) await api.cancelJob(jobId);
  }
}

export const EditorContext = createContext<Editor | null>(null);
export function useEditor(): Editor {
  const e = useContext(EditorContext);
  if (!e) throw new Error('EditorContext missing');
  return e;
}
/** Re-renders when the editor state changes. Returns the editor (for derived getters) and its state. */
export function useEditorState(): { editor: Editor; state: EditorState; t: (k: Key) => string } {
  const editor = useEditor();
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  return { editor, state, t: editor.t };
}
