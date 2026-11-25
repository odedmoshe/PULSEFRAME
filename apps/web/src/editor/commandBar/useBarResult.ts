/**
 * The bar's state for the palette (ADR-0027): interpret on every query change, the rendered-plan gate for Enter, the strict
 * commit (editor.commitExact with the plan's basisRevision and 'bar:' + planHash), the re-plan on 409, the actions, the one live
 * region's announcements. The logic is plain classes and functions (BarSession, LiveAnnouncer, viewOf) so it is tested without a
 * DOM; useBarSlot is the thin hook the palette calls.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BAR_RECENT_MAX, BAR_PREFS_KEY, INTENT_COMMANDS, INTENT_EXAMPLES, type IntentId, barIdempotencyKey, interpret as coreInterpret, type BarActionResult, type BarContext, type BarPlan, type BarResult, type BarResultKind, type BarAction, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, translateRefusal, type Lang } from '@pulseframe/i18n';
import { COMMANDS } from '../commands.ts';
import { normalize, rankWithRescue } from '../palette.search.ts';
import { useEditor, type Editor, type EditorState, type ExactCommit, type Notice, type Workspace } from '../store.ts';
import { BAR_DOM_IDS, BAR_KEYS, BAR_TEST_HOOK } from './commandBar.testids.ts';
import { barText, dict, plain } from './commandBar.strings.ts';
import { buildBarContext } from './context.ts';
import type { BarPaletteHost, BarPaletteSlot } from './contract.ts';
import { describeAction, intentName, opWords, refusalLine, refusalWords, type RefusalWords } from './describe.ts';

/** A nearest command offered under an unknown request (runs that registry command). */
export interface NearestTarget { kind: 'nearest'; commandId: string }
/** An example sentence the grammar understands (a partial reading's, or a common one): Enter puts it in the input, nothing runs. */
export interface ExampleTarget { kind: 'example'; text: string; intent: IntentId }
export type BarTarget = BarPlan | BarActionResult | NearestTarget | ExampleTarget;
export interface BarEntry { key: string; /** null: the row only says something (a choice question, an unknown request) and Enter runs nothing */ target: BarTarget | null; label: { he: string; en: string } | null }
export interface BarView { query: string; result: BarResult | null; entries: BarEntry[]; kind: BarResultKind | null; intent: string | null }
export const EMPTY_VIEW: BarView = Object.freeze({ query: '', result: null, entries: [], kind: null, intent: null }) as BarView;

/** What identifies a thing the preview can show (the plan hash for a plan): the Enter gate compares it with what was rendered. */
export function sigOf(t: BarTarget): string {
  if (t.kind === 'plan') return t.planHash;
  if (t.kind === 'action') return `action:${t.intent}:${JSON.stringify(t.action)}`;
  if (t.kind === 'example') return `example:${t.text}`;
  return `command:${t.commandId}`;
}

const SEARCH_ITEMS = COMMANDS.map((c) => ({ id: c.id, he: c.text?.he ?? dictionaries.he[c.label], en: c.text?.en ?? dictionaries.en[c.label] }));
const KNOWN = new Set(COMMANDS.map((c) => c.id));
export const MAX_NEAREST = 5;
/**
 * The nearest commands under a request that runs nothing and offers no choice (plan §6, proof check 6: «at least one nearest
 * command or choice»): unknown — the commands of the intents that partly matched; incomplete, or refused without choices — the
 * command the intent stands beside; then the palette's own ranking. At most 5.
 */
export function nearestCommandIds(result: BarResult, query: string): string[] {
  if (result.kind !== 'unknown' && result.kind !== 'incomplete' && !(result.kind === 'refused' && !result.choices?.length)) return [];
  const out: string[] = [];
  const add = (id: string | null | undefined) => { if (id && KNOWN.has(id) && !out.includes(id)) out.push(id); };
  if (result.kind === 'unknown') for (const p of result.partial) add(INTENT_COMMANDS[p]);
  else add(INTENT_COMMANDS[result.intent]);
  if (normalize(query)) for (const id of rankWithRescue(query, SEARCH_ITEMS).ids) add(id);
  return out.slice(0, MAX_NEAREST);
}

/** Sentences offered when no nearer command exists (plan §6: the grammar's partial readings): the intents that partly matched or
 * the one that lacks a word; when the grammar read nothing at all, a few common ones, so the owner sees what the bar understands. */
export const COMMON_EXAMPLE_INTENTS: readonly IntentId[] = ['split_here', 'add_title', 'delete_clip'];
export function exampleTargets(result: BarResult, query: string, room: number): ExampleTarget[] {
  if (room <= 0) return [];
  const he = /[\u0590-\u05FF]/.test(query) || !/[a-z]/i.test(query);
  const intents: IntentId[] = result.kind === 'unknown' ? [...result.partial] : result.kind === 'incomplete' || result.kind === 'refused' ? [result.intent] : [];
  const pool = intents.length ? intents : result.kind === 'unknown' ? [...COMMON_EXAMPLE_INTENTS] : [];
  const out: ExampleTarget[] = [];
  for (const intent of pool) {
    const list = INTENT_EXAMPLES[intent]?.[he ? 'he' : 'en'] ?? [];
    const text = result.kind === 'incomplete' && result.intent === intent ? result.example[he ? 'he' : 'en'] : list[0];
    if (text && text !== query.trim() && !out.some((x) => x.text === text)) out.push({ kind: 'example', text, intent });
    if (out.length >= room) break;
  }
  return out;
}

export function entriesOf(result: BarResult, query: string): BarEntry[] {
  const bar = (target: BarTarget | null): BarEntry => ({ key: BAR_KEYS.result, target, label: null });
  const nearest = (): BarEntry[] => {
    const cmds = nearestCommandIds(result, query);
    const ex = exampleTargets(result, query, MAX_NEAREST - cmds.length);
    return [...cmds.map((id): BarTarget => ({ kind: 'nearest', commandId: id })), ...ex].map((target, i) => ({ key: BAR_KEYS.nearest(i), target, label: null }));
  };
  switch (result.kind) {
    case 'plan': case 'action': return [bar(result)];
    case 'ambiguous': return [bar(null), ...result.choices.map((c, i) => ({ key: BAR_KEYS.choice(i), target: c.result, label: { he: c.he, en: c.en } }))];
    case 'refused': return result.choices?.length ? [bar(null), ...result.choices.map((c, i) => ({ key: BAR_KEYS.choice(i), target: c.result, label: { he: c.he, en: c.en } }))] : [bar(null), ...nearest()];
    case 'unknown': case 'incomplete': return [bar(null), ...nearest()];
  }
}
export const intentOf = (r: BarResult | null): string | null => (!r ? null : r.kind === 'unknown' ? null : r.intent);

/** The view for a query: nothing for an empty query or without a project; else the grammar's answer and the rows it makes. */
export function viewOf(query: string, ctx: BarContext | null, interpret: (text: string, ctx: BarContext) => BarResult = coreInterpret): BarView {
  if (!query.trim() || !ctx) return { ...EMPTY_VIEW, query };
  const result = interpret(query, ctx);
  return { query, result, entries: entriesOf(result, query), kind: result.kind, intent: intentOf(result) };
}

// ---- the live region ----
/** The live region changes only when this changes: the kind and the intent, never the typed text. */
export const liveKeyOf = (v: BarView): string | null => (v.kind ? `${v.kind}:${v.intent ?? ''}` : null);
const reasonOf = (r: Extract<BarResult, { kind: 'refused' }>, lang: Lang): string => {
  const base = dict(lang, `bar.refusal.${r.code}`);
  if (r.opError) return translateRefusal(lang, r.opError.message) ?? base;
  return base;
};
/** What the live region says for a view (plain words, no isolates). */
export function liveTextOf(v: BarView, lang: Lang): string {
  const r = v.result;
  if (!r) return '';
  const t = (k: Parameters<typeof barText>[1], vars?: Record<string, string | number>) => plain(barText(lang, k, vars));
  switch (r.kind) {
    case 'plan': return t('live.plan', { what: intentName(r.intent, lang) });
    case 'action': return t('live.action', { what: plain(describeAction(r.action, lang)) });
    case 'ambiguous': return t('live.ambiguous');
    case 'incomplete': return t('live.incomplete', { missing: r.missing.map((m) => barText(lang, `missing.${m}` as never)).join(lang === 'he' ? ', ' : ', ') });
    case 'refused': return t('live.refused', { reason: plain(reasonOf(r, lang)) });
    case 'unknown': { const n = v.entries.length - 1; return n > 0 ? t('live.nearest', { n }) : t('live.unknown'); }
  }
}

export interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
export const LIVE_DEBOUNCE_MS = 500;
/**
 * The one polite live region: its text changes when the kind or intent of the result changes (debounced 500 ms, so typing
 * never talks), and at once on a commit or a failure (`say`). The same key twice is silent.
 */
export class LiveAnnouncer {
  text = '';
  private key: string | null = null;
  private timer: unknown = null;
  constructor(private onChange: (text: string) => void, private timers: Timers = realTimers, private ms = LIVE_DEBOUNCE_MS) {}
  update(v: BarView, lang: Lang): void {
    const key = liveKeyOf(v);
    if (key === this.key) return;
    this.key = key;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (key === null) { this.set(''); return; }
    this.timer = this.timers.set(() => { this.timer = null; this.set(liveTextOf(v, lang)); }, this.ms);
  }
  say(text: string): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    this.set(text);
  }
  dispose(): void { if (this.timer !== null) this.timers.clear(this.timer); this.timer = null; }
  private set(text: string) { this.text = text; this.onChange(text); }
}

// ---- remembered intents (never typed text) ----
export function rememberIntent(intent: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    if (!storage) return;
    const raw = JSON.parse(storage.getItem(BAR_PREFS_KEY) ?? '{}') as { recent?: unknown };
    const prev = Array.isArray(raw.recent) ? raw.recent.filter((x): x is string => typeof x === 'string') : [];
    storage.setItem(BAR_PREFS_KEY, JSON.stringify({ recent: [intent, ...prev.filter((x) => x !== intent)].slice(0, BAR_RECENT_MAX) }));
  } catch { /* not remembered in a private window */ }
}

// ---- the session ----
/** What the bar needs from the editor (Editor satisfies it; tests give a labelled stand-in). */
export interface BarPort {
  context(): BarContext | null;
  commitExact(ops: BarPlan['ops'], label: string, expectedRevision: number, key: string): Promise<ExactCommit>;
  undoTransaction(id: string): Promise<void>;
  redoTransaction(id: string): Promise<void>;
  setWorkspace(w: string): void; openExportSheet(destination: string): void; seek(frame: number): void; play(): void; pause(): void;
  selectAll(): void; deselect(): void; setLang(l: Lang): void; runCommand(id: string): void; notify(n: Notice): void;
}
export function portOf(editor: Editor): BarPort {
  const run = (id: string) => { const c = COMMANDS.find((x) => x.id === id); if (c && (!c.enabled || c.enabled(editor))) void c.run(editor); };
  return {
    context: () => buildBarContext(editor),
    commitExact: (ops, label, rev, key) => editor.commitExact([...ops], label, rev, key),
    undoTransaction: (id) => editor.undoTransaction(id), redoTransaction: (id) => editor.redoTransaction(id),
    setWorkspace: (w) => editor.setWorkspace(w as Workspace), openExportSheet: (d) => editor.openExportSheet(d as never), seek: (f) => editor.seek(f),
    play: () => void editor.player?.play(), pause: () => editor.player?.pause(), selectAll: () => editor.selectAll(),
    deselect: () => { editor.clearCut(); editor.select(null); }, setLang: (l) => editor.setLang(l), runCommand: run, notify: (n) => editor.notify(n),
  };
}

export type Activation = 'committed' | 'action' | 'stale' | 'failed' | 'blocked' | 'not_rendered' | 'nothing';
/** A refused commit in words (describe.ts refusalWords): Hebrew in a Hebrew interface, the server's English only when unworded, marked. */
export interface BarFailure extends RefusalWords { code: string }

/** Everything between the rows and the editor: the shown view, what was rendered, the strict commit, the actions. */
export class BarSession {
  view: BarView = EMPTY_VIEW;
  /** The query as typed now (the view may lag it for a large document: Enter waits). */
  currentQuery = '';
  rendered: string | null = null;
  stale = false;
  busy = false;
  failure: BarFailure | null = null;
  version = 0;
  /** The grammar (replaceable in tests). */
  interpret: (text: string, ctx: BarContext) => BarResult = coreInterpret;
  readonly live: LiveAnnouncer;
  private listeners = new Set<() => void>();
  constructor(public port: BarPort, public host: BarPaletteHost, timers: Timers = realTimers, private win: Record<string, unknown> | null = typeof window === 'undefined' ? null : (window as unknown as Record<string, unknown>)) {
    this.live = new LiveAnnouncer(() => this.bump(), timers);
  }
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = (): number => this.version;
  private bump() { this.version++; for (const l of this.listeners) l(); }
  private get lang(): Lang { return this.host.lang; }

  /** Takes the view for the current render. A new query clears the stale line and a failure. */
  setView(view: BarView): void {
    if (view.query !== this.view.query) { this.stale = false; this.failure = null; }
    this.view = view;
    this.live.update(view, this.lang);
  }
  /** The preview of `target` is on the screen now (BarSection's effect). Enter acts only on a rendered preview. */
  markRendered(target: BarTarget | null): void {
    this.rendered = target ? sigOf(target) : null;
    const hook = this.win;
    if (hook) {
      // the context the plan was made in, without the documents (the proof rebuilds it in Node on the server's document at
      // `revision` and compares the plan hash: one grammar, the same answer in Node and in the browser)
      const c = target && target.kind === 'plan' && typeof this.port.context === 'function' ? this.port.context() : null;
      const context = c ? { revision: c.revision, activeSequenceId: c.activeSequenceId, selection: [...c.selection], playheadFrame: c.playheadFrame, cutClipId: c.cutClipId, workspace: c.workspace, performRecording: c.performRecording, viewVariantId: c.viewVariantId, lang: c.lang, undoTarget: c.undoTarget, redoTarget: c.redoTarget } : null;
      hook[BAR_TEST_HOOK] = { lastPlan: target && target.kind === 'plan' ? JSON.parse(JSON.stringify(target, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) : null, context };
    }
  }

  entry(key: string): BarEntry | undefined { return this.view.entries.find((e) => e.key === key); }

  async activate(key: string): Promise<Activation> {
    if (this.busy) return 'blocked';
    if (this.view.query !== this.currentQuery) return 'blocked'; // the answer is for older text
    const e = this.entry(key);
    const target = e?.target;
    if (!e) return 'nothing';
    if (!target) { this.live.say(liveTextOf(this.view, this.lang)); return 'nothing'; }
    if (this.rendered !== sigOf(target)) return 'not_rendered'; // the first Enter renders the preview, the second acts
    if (target.kind === 'plan') return this.commitPlan(target);
    if (target.kind === 'nearest') { this.host.close(); setTimeout(() => this.port.runCommand(target.commandId), 0); return 'action'; }
    if (target.kind === 'example') { this.host.setQuery?.(target.text); return 'nothing'; } // nothing runs: the example's own preview comes next
    this.runAction(target.action);
    rememberIntent(target.intent);
    this.live.say(barText(this.lang, 'live.doneAction', { what: plain(describeAction(target.action, this.lang)) }));
    return 'action';
  }

  private runAction(a: BarAction): void {
    const p = this.port;
    switch (a.kind) {
      case 'undo': this.host.close(); void p.undoTransaction(a.transactionId); return;
      case 'redo': this.host.close(); void p.redoTransaction(a.transactionId); return;
      case 'command': this.host.close(); setTimeout(() => p.runCommand(a.commandId), 0); return;
      case 'recipe': this.host.close(); setTimeout(() => p.runCommand('view.openTemplates'), 0); return;
      case 'workspace': p.setWorkspace(a.workspace); break;
      case 'export_sheet': p.openExportSheet(a.destination); break;
      case 'seek': p.seek(a.frame); break;
      case 'play': p.play(); break;
      case 'pause': p.pause(); break;
      case 'select_all': p.selectAll(); break;
      case 'deselect': p.deselect(); break;
      case 'zoom': p.runCommand(a.dir > 0 ? 'view.zoomIn' : 'view.zoomOut'); break;
      case 'language': p.setLang(a.to); break;
    }
    this.host.close();
  }

  private async commitPlan(plan: BarPlan): Promise<Activation> {
    this.busy = true; this.failure = null; this.bump();
    let r: ExactCommit;
    try { r = await this.port.commitExact(plan.ops, plan.label, plan.basisRevision, barIdempotencyKey(plan.planHash)); }
    catch (err) { r = { kind: 'failed', code: 'network', message: err instanceof Error ? err.message : String(err) }; }
    this.busy = false;
    const lang = this.lang;
    if (r.kind === 'committed') {
      const what = plan.steps.map((s) => opWords(s.op, lang)).filter((w, i, a) => a.indexOf(w) === i).join(', ');
      rememberIntent(plan.intent);
      const done = plain(barText(lang, 'live.done', { what }));
      this.live.say(done);
      this.port.notify({ kind: r.result.transactionId ? 'undo' : 'info', title: plain(barText(lang, 'live.doneAction', { what })), ...(r.result.transactionId ? { undoes: r.result.transactionId } : {}) });
      this.host.close();
      return 'committed';
    }
    if (r.kind === 'stale') {
      // the editor reloaded the document: plan again on it and show the new preview; nothing the owner did not see is committed
      this.stale = true;
      // clear only the mark of the plan that was just refused: the re-plan may already be on screen and marked (the reload renders before this resumes)
      if (this.rendered === plan.planHash) this.rendered = null;
      this.view = viewOf(this.view.query, this.port.context(), this.interpret);
      this.live.say(dict(lang, 'bar.projectChanged'));
      this.bump();
      return 'stale';
    }
    const words = refusalWords(lang, r);
    this.failure = { code: r.code, ...words };
    this.live.say(plain(barText(lang, 'live.failed', { reason: refusalLine(lang, words) })));
    this.bump();
    return 'failed';
  }
  dispose(): void { this.live.dispose(); }
}

// ---- what the local assistant's row needs from the bar (wave 7): the grammar's result for the query, and the palette's input ----
/** The bar's result kind for a query (published by useBarSlot, after its own debounce) and the palette's way to put text in its input. */
export interface BarBridgeState { query: string; kind: BarResultKind | null }
let bridgeState: BarBridgeState = { query: '', kind: null };
let bridgeSetQuery: ((text: string) => void) | null = null;
const bridgeListeners = new Set<() => void>();
export const subscribeBarBridge = (l: () => void): (() => void) => { bridgeListeners.add(l); return () => { bridgeListeners.delete(l); }; };
export const getBarBridge = (): BarBridgeState => bridgeState;
/** The row's «הכנס לשורה»: the palette's own setQuery (the input gets the focus; the bar reads the text like typed text). False without a palette. */
export function putInBar(text: string): boolean { if (!bridgeSetQuery) return false; bridgeSetQuery(text); return true; }
function publishBar(query: string, kind: BarResultKind | null): void {
  if (bridgeState.query === query && bridgeState.kind === kind) return;
  bridgeState = { query, kind };
  for (const l of bridgeListeners) l();
}

// ---- the hook ----
/** The editor and its state (the same as useEditorState, with the server snapshot too so the components render to markup in tests). */
export function useBarEditor(): { editor: Editor; state: EditorState } {
  const editor = useEditor();
  const state = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState);
  return { editor, state };
}
/** A document with more clips than this plans after 150 ms of quiet instead of on every key (the dry run applies the ops to a copy). */
export const LARGE_DOC_CLIPS = 400;
export const LARGE_DOC_DEBOUNCE_MS = 150;
export const clipCountOf = (doc: ProjectDocument | null): number => (doc ? Object.values(doc.sequences).reduce((n, s) => n + s.tracks.reduce((m, t) => m + t.clips.length, 0), 0) : 0);

/** The slot as the palette sees it (BarPaletteSlot), plus what BarSection draws from. */
export interface BarSlot extends BarPaletteSlot { session: BarSession; view: BarView; version: number; pending: boolean }
export const isBarSlot = (s: BarPaletteSlot): s is BarSlot => 'session' in s;

export function useBarSlot(query: string, host: BarPaletteHost): BarSlot {
  const { editor, state } = useBarEditor();
  const ref = useRef<BarSession | null>(null);
  if (!ref.current) ref.current = new BarSession(portOf(editor), host);
  const session = ref.current;
  session.host = host;
  session.currentQuery = query;
  const version = useSyncExternalStore(session.subscribe, session.getVersion);
  useEffect(() => () => session.dispose(), [session]);

  const large = clipCountOf(state.rawDoc) > LARGE_DOC_CLIPS;
  const [settled, setSettled] = useState(query);
  useEffect(() => {
    if (!large) return;
    const h = setTimeout(() => setSettled(query), LARGE_DOC_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query, large]);
  const planned = large ? settled : query;
  const frame = editor.frame;
  const fresh = useMemo(
    () => viewOf(planned, buildBarContext(editor)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planned, state.revision, state.selection, frame, state.cutClipId, state.workspace, state.lang, state.activity, state.activeSequenceId, state.viewVariantId, state.performRecording, state.doc, state.rawDoc, state.actor],
  );
  const view = fresh; // after a 409 the editor has reloaded the document, so this is the re-planned view
  session.setView(view);
  useEffect(() => { const f = host.setQuery ?? null; bridgeSetQuery = f; return () => { if (bridgeSetQuery === f) bridgeSetQuery = null; }; });
  useEffect(() => { publishBar(view.query, view.kind); }, [view.query, view.kind]);
  useEffect(() => () => publishBar('', null), []);

  const keysRef = useRef<readonly string[]>([]);
  const joined = view.entries.map((e) => e.key).join('|');
  const keys = useMemo(() => { keysRef.current = view.entries.map((e) => e.key); return keysRef.current; }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  const activate = useRef((key: string) => { void ref.current!.activate(key); }).current;
  const describedBy = view.kind ? BAR_DOM_IDS.preview : null;
  return useMemo(() => ({ keys, activate, describedBy, session, view, version, pending: planned !== query }), [keys, activate, describedBy, session, view, version, planned, query]);
}
