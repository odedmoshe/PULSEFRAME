/**
 * Editor session state and actions. One instance per open project. Components subscribe with
 * `useEditorState`; every persistent change goes through `commit` → server operations (the UI holds
 * no second copy of truth). Selection, playhead, language and key bindings are personal session
 * state and never enter the project document (SPEC §5).
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import * as T from '@pulseframe/time';
import { clipEnd, findClip, sequenceDuration, transformAt, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { createT, dirOf, type Key, type Lang } from '@pulseframe/i18n';
import { api, ApiFailure, type CommitResult, type JobEvent, type Proposal, type RevisionEvent } from '../api.ts';
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
  /** Timeline zoom in pixels per second. */
  pxPerSecond: number;
}

export interface Ghost { sessionId: string; actor: string; kind: 'user' | 'agent'; frame: number | null; selection: string[]; label: string | null }

export class Editor {
  private state: EditorState = {
    lang: localStorage.getItem('pf.lang') === 'en' ? 'en' : 'he', doc: null, revision: 0, selection: [], save: 'save.saved', activity: [], exportJob: null, capJob: null,
    provider: null, error: null, uploading: false, derivativeTick: 0, tick: 0, paletteOpen: false, pxPerSecond: 90, ghosts: [], followAgent: false, agentsPaused: false, proposals: [],
  };
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
  get rate() { return this.state.doc?.settings.frameRate ?? { num: 30, den: 1 }; }
  get frame() { return this.player?.frame ?? 0; }
  get playhead() { return T.frameTime(this.frame, this.rate); }
  get duration() { return this.state.doc ? sequenceDuration(this.state.doc) : T.ZERO; }
  /** Primary selected clip with its track (first of the selection). */
  get selected() { const id = this.state.selection[0]; return this.state.doc && id ? findClip(this.state.doc, id) : undefined; }
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
    this.set({ error: e instanceof Error ? e.message : String(e) });
  };
  async load(projectId: string) {
    const p = await api.getProject(projectId);
    if (p.revision >= this.state.revision || !this.state.doc) {
      const selection = this.state.selection.filter((id) => findClip(p.project, id));
      this.set({ doc: p.project, revision: p.revision, selection });
      this.player?.setDoc(p.project);
    }
    return p;
  }
  /** Boot: session → project → fonts → player → live revision stream. */
  async boot(canvas: HTMLCanvasElement) {
    this.setLang(this.state.lang);
    await api.session();
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
  async commit(ops: OpCall[], label?: string): Promise<CommitResult | null> {
    const { doc, revision } = this.state;
    if (!doc) return null;
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
  async history(mode: 'undo' | 'redo') {
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
  async importFile(file: File) {
    const { doc } = this.state;
    if (!doc) return;
    this.set({ uploading: true, error: null });
    try {
      const r = await api.upload(doc.id, file);
      // A conformed asset is not byte-identical to the local file, so only reuse the local file when it was stored as-is.
      if (!r.asset.conform) this.pool?.provideLocal(r.assetId, file);
      await this.load(doc.id);
    } catch (e) {
      this.fail(e instanceof ApiFailure && e.code === 'unsupported_media' ? new Error(`${this.t('media.unsupported')}: ${e.message}`) : e);
    } finally {
      this.set({ uploading: false });
    }
  }
  select(id: string | null) { this.set({ selection: id ? [id] : [], ...(this.following ? {} : { followAgent: false }) }); }
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
  startExport() {
    const { doc } = this.state;
    if (doc) api.startExport(doc.id).then((j) => this.set({ exportJob: { id: j.jobId, type: 'export', status: 'queued', stage: null, output: null, error: null } })).catch(this.fail);
  }
  /** Pause Agent / Take Over: the server refuses agent mutations until the owner resumes. */
  setAgentsPaused(paused: boolean) { const d = this.state.doc; if (d) api.setPaused(d.id, paused).then((r) => this.set({ agentsPaused: r.agentsPaused })).catch(this.fail); }
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
  addAsset(assetId: string) { return this.commit([{ op: 'add_clip', args: { assetId, start: this.appendPoint() } }], 'Add clip'); }
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
    const local = T.sub(this.playhead, clip.start);
    const ops: OpCall[] = [];
    const still: Record<string, number> = {};
    for (const [p, raw] of Object.entries(values)) {
      const v = Math.round((raw as number) * 1e4) / 1e4; // pointer precision is not meaningful beyond this
      if (clip.keyframes?.[p as 'x']?.length) ops.push({ op: 'set_keyframe', args: { clipId: clip.id, property: p, time: local, value: v } });
      else still[p] = v as number;
    }
    if (Object.keys(still).length) ops.push({ op: 'set_clip_transform', args: { clipId: clip.id, transform: still } });
    return ops.length ? this.commit(ops, label) : Promise.resolve(null);
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
