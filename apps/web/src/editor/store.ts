/**
 * Editor session state and actions. One instance per open project. Components subscribe with
 * `useEditorState`; every persistent change goes through `commit` → server operations (the UI holds
 * no second copy of truth). Selection, playhead, language and key bindings are personal session
 * state and never enter the project document (SPEC §5).
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import * as T from '@pulseframe/time';
import { clipEnd, findClip, projectVariant, sequenceDuration, transformAt, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { createT, dictionaries, dirOf, type Key, type Lang } from '@pulseframe/i18n';
import { api, ApiFailure, type Approval, type CommitResult, type JobEvent, type Proposal, type RevisionEvent } from '../api.ts';
import { ensureFonts } from '../fonts.ts';
import { MediaPool } from '../media.ts';
import { Player } from '../player.ts';

export type SaveState = 'save.saved' | 'save.saving' | 'save.offline' | 'save.conflict';
export type ProviderInfo = Awaited<ReturnType<typeof api.capabilities>>;
export interface EditorState {
  lang: Lang;
  doc: ProjectDocument | null;
  revision: number;
  selection: string[];
  save: SaveState;
  activity: RevisionEvent[];
  exportJob: JobEvent | null;
  capJob: JobEvent | null;
  provider: ProviderInfo | null;
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
}

const SAFE_KEY = 'pf.safearea.v1';
const TARGETS_KEY = 'pf.targets.v1';
const readTargets = (projectId: string): { video: string | null; audio: string | null } => {
  try { const v = JSON.parse(localStorage.getItem(`${TARGETS_KEY}.${projectId}`) ?? 'null'); return { video: typeof v?.video === 'string' ? v.video : null, audio: typeof v?.audio === 'string' ? v.audio : null }; } catch { return { video: null, audio: null }; }
};
/** Drag-and-drop type of a library file dragged onto the timeline (the payload is the asset id). */
export const ASSET_DRAG_TYPE = 'application/x-pulseframe-asset';
export const WORKSPACES = ['pro', 'quick', 'motion', 'color', 'captions', 'sound', 'deliver', 'custom'] as const;
export type Workspace = (typeof WORKSPACES)[number];
const WS_KEY = 'pf.workspace.v1';
const readWorkspace = (): Workspace => { try { const v = localStorage.getItem(WS_KEY); return (WORKSPACES as readonly string[]).includes(v ?? '') ? (v as Workspace) : 'pro'; } catch { return 'pro'; } };
const readSafeArea = () => { try { return localStorage.getItem(SAFE_KEY) !== '0'; } catch { return true; } };

export interface Ghost { sessionId: string; actor: string; kind: 'user' | 'agent'; frame: number | null; selection: string[]; label: string | null }

export class Editor {
  private state: EditorState = {
    lang: localStorage.getItem('pf.lang') === 'en' ? 'en' : 'he', doc: null, revision: 0, selection: [], save: 'save.saved', activity: [], exportJob: null, capJob: null,
    provider: null, error: null, errorHeadline: null, uploading: false, derivativeTick: 0, tick: 0, paletteOpen: false, pxPerSecond: 90, ghosts: [], followAgent: false, agentsPaused: false, proposals: [], approvals: [], viewVariantId: null, safeAreaOn: readSafeArea(), workspace: readWorkspace(), targets: { video: null, audio: null }, clipboard: [], cutPending: [],
  };
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
    const { doc, viewVariantId: id } = this.state;
    if (!doc || !id || !doc.variants?.[id]) return doc;
    if (this.viewCache?.doc === doc && this.viewCache.id === id) return this.viewCache.out;
    const out = projectVariant(doc, id);
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
    this.set({ error: headline && e instanceof Error ? `${headline}: ${e.message}` : e instanceof Error ? e.message : String(e), errorHeadline: headline ?? null });
  };
  async load(projectId: string) {
    const p = await api.getProject(projectId);
    if (p.revision >= this.state.revision || !this.state.doc) {
      const selection = this.state.selection.filter((id) => findClip(p.project, id));
      const viewVariantId = this.state.viewVariantId && p.project.variants?.[this.state.viewVariantId] ? this.state.viewVariantId : null;
      // A document change that removes cut-pending clips cancels the cut.
      const cutAlive = this.state.cutPending.filter((id) => findClip(p.project, id));
      const cut = cutAlive.length === this.state.cutPending.length ? {} : { cutPending: [] as string[], clipboard: [] as string[] };
      // target tracks are remembered per project in this browser
      const targets = this.state.doc?.id === p.project.id ? {} : { targets: readTargets(p.project.id) };
      this.set({ doc: p.project, revision: p.revision, selection, viewVariantId, ...cut, ...targets });
      const vd = this.viewDoc;
      if (vd) this.player?.setDoc(vd);
    }
    return p;
  }
  /** Switch the preview to a linked format (or back to the master with null). */
  setViewVariant(id: string | null) {
    const doc = this.state.doc;
    const next = id && doc?.variants?.[id] ? id : null;
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
    try { await api.session(); } catch (e) { throw e instanceof ApiFailure && e.code === 'owner_key_required' ? new Error(this.t('boot.ownerKey')) : e; }
    await ensureFonts();
    let id = new URLSearchParams(location.search).get('project');
    if (!id) {
      const { projects } = await api.listProjects();
      id = projects[0]?.id ?? (await api.createProject(this.state.lang === 'he' ? 'הפרויקט שלי' : 'My project')).project.id;
    }
    const projectId = id;
    if (this.disposed) return;
    this.pool = new MediaPool({
      assetUrl: (assetId) => `/api/v1/projects/${projectId}/assets/${assetId}/content`,
      // Preview decodes the frame-identical proxy once it exists; export always uses the original.
      previewUrl: async (assetId) => ((await api.derivatives(projectId, assetId)).derivatives.find((d) => d.kind === 'proxy')?.status === 'ready' ? `/api/v1/projects/${projectId}/assets/${assetId}/derivatives/proxy` : null),
    });
    this.player = new Player(canvas, this.pool, () => { this.set({ tick: this.state.tick + 1 }); this.announce(projectId); }, this.fail);
    (window as any).__pfMedia = () => this.pool?.stats();
    (window as any).__pfSync = () => this.player?.syncStats();
    const p = await this.load(projectId);
    this.set({ activity: (await api.history(projectId)).events.reverse() });
    if (this.disposed) return;
    const es = (this.es = api.events(projectId, p.revision));
    es.addEventListener('revision', (m) => {
      const e: RevisionEvent = JSON.parse((m as MessageEvent).data);
      if (!this.state.activity.some((x) => x.revision === e.revision)) this.set({ activity: [e, ...this.state.activity].slice(0, 50) });
      // Committed remote or local change: converge on the server document. Playhead and selection are local and stay put.
      if (e.revision > this.state.revision) void this.load(projectId).catch(this.fail);
    });
    es.addEventListener('derivative', (m) => {
      const d: { assetId: string; kind: string; status: string } = JSON.parse((m as MessageEvent).data);
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
    es.addEventListener('job', (m) => { const j: JobEvent = JSON.parse((m as MessageEvent).data); this.set(j.type === 'capability' ? { capJob: j } : j.type === 'export' ? { exportJob: j } : {}); });
    es.onerror = () => this.set({ save: 'save.offline' });
    es.onopen = () => this.set({ save: 'save.saved' });
    // Listing capabilities only reads provider status; it never starts a worker.
    void api.capabilities().then((provider) => this.set({ provider })).catch(() => this.set({ provider: null }));
  }
  dispose() {
    this.disposed = true;
    this.es?.close();
    this.player?.dispose();
    void this.pool?.dispose();
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
  private async commitNow(given: OpCall[] | (() => OpCall[] | null), label?: string): Promise<CommitResult | null> {
    const { doc, revision } = this.state;
    if (!doc) return null;
    const ops = typeof given === 'function' ? given() : given;
    if (!ops?.length) return null;
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
  private async historyNow(mode: 'undo' | 'redo'): Promise<void> {
    const { doc } = this.state;
    if (!doc) return;
    this.set({ error: null });
    try {
      await api.undo(doc.id, mode);
      await this.load(doc.id);
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'nothing_to_undo' || e.code === 'nothing_to_redo')) return;
      this.fail(e instanceof ApiFailure && e.code === 'undo_conflict' ? new Error(this.t('undo.conflict')) : e);
    }
  }
  /** Import a file into the library; with `place`, also put it on the timeline there (a file dropped from the computer onto the timeline). */
  async importFile(file: File, place?: { frame: number; trackId: string | null }) {
    const { doc } = this.state;
    if (!doc) return;
    this.set({ uploading: true, error: null });
    try {
      const r = await api.upload(doc.id, file);
      // A conformed asset is not byte-identical to the local file, so only reuse the local file when it was stored as-is.
      if (!r.asset.conform) this.pool?.provideLocal(r.assetId, file);
      await this.load(doc.id);
      if (place) await this.dropAsset(r.assetId, place.frame, place.trackId);
    } catch (e) {
      this.fail(e instanceof ApiFailure && e.code === 'unsupported_media' ? new Error(`${this.t('media.unsupported')}: ${e.message}`) : e);
    } finally {
      this.set({ uploading: false });
    }
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
  setWorkspace(workspace: Workspace) { try { localStorage.setItem(WS_KEY, workspace); } catch { /* ignore */ } this.set({ workspace }); }
  /** 'toggle' adds the clip to the selection or removes it (Shift/Ctrl/⌘-click); the default replaces the selection. */
  select(id: string | null, mode: 'replace' | 'toggle' = 'replace') {
    const cur = this.state.selection;
    const selection = !id ? [] : mode === 'toggle' ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id];
    this.set({ selection, ...(this.following ? {} : { followAgent: false }) });
  }
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
  startExport(variantId?: string) {
    const { doc } = this.state;
    if (doc) api.startExport(doc.id, variantId ? { variantId } : undefined).then((j) => this.set({ exportJob: { id: j.jobId, type: 'export', status: 'queued', stage: null, output: null, error: null } })).catch(this.fail);
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
  cancelExport() { const j = this.state.exportJob; if (j) api.cancelJob(j.id).catch(this.fail); }
  retryExport() {
    const j = this.state.exportJob;
    if (j) api.retryJob(j.id).then((n) => this.set({ exportJob: { id: n.jobId, type: 'export', status: 'queued', stage: null, output: null, error: null } })).catch(this.fail);
  }
  runCapability(capabilityId: string) {
    const { doc } = this.state;
    if (doc) api.runCapability(doc.id, capabilityId, {}).then((j) => this.set({ capJob: { id: j.jobId, type: 'capability', status: 'queued', stage: null, output: null, error: null } })).catch(this.fail);
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
   * The linked sound of a picture file goes to the sound target track, if one is chosen.
   */
  dropAsset(assetId: string, frame: number, trackId: string | null) {
    const d = this.state.doc, a = d?.assets[assetId];
    if (!d || !a) return Promise.resolve(null);
    const picture = !!a.video || a.kind === 'image';
    const tr = trackId ? d.sequences[d.mainSequenceId]!.tracks.find((t) => t.id === trackId) : undefined;
    const fits = !!tr && !tr.locked && tr.kind === (picture ? 'video' : 'audio');
    const au = this.target('audio');
    return this.commit([{ op: 'add_clip', args: { assetId, start: T.frameTime(Math.max(0, frame), this.rate), ...(fits ? { trackId: tr!.id } : {}), ...(picture && a.audio && au ? { audioTrackId: au } : {}) } }], 'Add clip');
  }
  addAsset(assetId: string) {
    const a = this.state.doc?.assets[assetId];
    const picture = !!a && (!!a.video || a.kind === 'image'), v = this.target('video'), au = this.target('audio');
    // target tracks: the picture (or a sound-only file) goes to its target, the linked sound of a picture file to the sound target
    const where = picture ? { ...(v ? { trackId: v } : {}), ...(au && a?.audio ? { audioTrackId: au } : {}) } : au ? { trackId: au } : {};
    return this.commit([{ op: 'add_clip', args: { assetId, start: this.appendPoint(), ...where } }], 'Add clip');
  }
  async addText() {
    const rate = this.rate;
    const r = await this.commit([{ op: 'add_text', args: { text: this.t('text.default'), start: this.playhead, duration: T.frameTime(Math.round((2 * rate.num) / rate.den), rate) } }], 'Add text');
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
  /** The selected clip's transform as rendered at the playhead (keyframes applied). */
  transformNow(clip: Clip) { return transformAt(clip, T.max(clip.start, T.min(this.playhead, clipEnd(clip)))); }
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
