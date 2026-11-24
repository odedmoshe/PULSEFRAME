// These sheets come before every component sheet (the first imports of this file). The shell grid first; then the stage and
// timeline rules, which stood in styles.css, ahead of all the components' own sheets, and keep that place in the cascade.
import './ds/shell.css';
import './editor/stage.css';
import './editor/timeline.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ToastProvider, useToasts } from './ds/index.ts';
import { CanvasHandles } from './editor/CanvasHandles.tsx';
import { TrackPicker } from './editor/TrackPicker.tsx';
import { CommandPalette } from './editor/CommandPalette.tsx';
import { chordOf, Keymap } from './editor/commands.ts';
import { ErrorBar } from './editor/ErrorBar.tsx';
import { GalleryHost } from './editor/EffectGallery.tsx';
import { ExportSheetHost } from './editor/ExportSheet.tsx';
import { FolderPicker, PhoneDropHost } from './editor/ImportHosts.tsx';
import { Header } from './editor/Header.tsx';
import { Inspector } from './editor/Inspector.tsx';
import { Library } from './editor/Library.tsx';
import { Rail } from './editor/Rail.tsx';
import { Splitter } from './editor/Splitter.tsx';
import { StageHeader } from './editor/StageHeader.tsx';
import { StatusBar } from './editor/StatusBar.tsx';
import { Transport } from './editor/Transport.tsx';
import { isTyping, shortcutAllowed } from './editor/shortcutGate.ts';
import { Editor, EditorContext, useEditorState } from './editor/store.ts';
import { toastOf } from './editor/undoToast.ts';
import { Timeline } from './editor/Timeline.tsx';
import { Welcome } from './editor/Welcome.tsx';
import { FamilyFilmDialog } from './editor/FamilyFilmDialog.tsx';
import { CurvePicker } from './editor/CurvePicker.tsx';
import { findClip, findEffect } from '@pulseframe/core';
import { isDecodeBudgetReason } from '@pulseframe/engine';
import { clipLabel } from './editor/Timeline.tsx';

export function App() {
  const editor = useMemo(() => new Editor(), []);
  const keymap = useMemo(() => new Keymap(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void editor.boot(canvasRef.current!).catch(editor.fail);
    return () => editor.dispose();
  }, [editor]);

  // One keyboard dispatcher for every command. Editing shortcuts are disabled while typing (SPEC §3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const chord = chordOf(e);
      const typing = isTyping(e.target as HTMLInputElement | null, chord);
      // a chord may belong to more than one command (the cut's , and . before the keyframe steps): the first that can run now acts
      const bound = keymap.lookupAll(chord);
      const cmd = bound.find((c) => !c.enabled || c.enabled(editor)) ?? bound[0];
      if (!cmd) return;
      // any modal dialog (whatever its class) is open: editor shortcuts do not act on the timeline behind it
      if (!shortcutAllowed(chord, cmd, { typing, paletteOpen: editor.getState().paletteOpen, modalOpen: !!document.querySelector('[aria-modal="true"]'), performRecording: !!editor.getState().performRecording })) return;
      e.preventDefault();
      if (!cmd.enabled || cmd.enabled(editor)) void cmd.run(editor);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, keymap]);

  return (
    <EditorContext.Provider value={editor}>
      <Toasts>
        <Shell canvasRef={canvasRef} keymap={keymap} />
      </Toasts>
    </EditorContext.Provider>
  );
}

const APP_STRINGS = { he: { close: 'סגירה', undo: 'ביטול', notifications: 'התראות' }, en: { close: 'Close', undo: 'Undo', notifications: 'Notifications' } } as const;
/** The toast queue of the editor (ds ToastProvider), in the interface language. */
function Toasts({ children }: { children: React.ReactNode }) {
  const { state } = useEditorState();
  return <ToastProvider closeLabel={APP_STRINGS[state.lang].close} label={APP_STRINGS[state.lang].notifications}>{children}<ToastBridge /></ToastProvider>;
}
/** The editor's notices (editor.notify) go to the toast queue; an undo toast undoes exactly the transaction it names (undoToast.ts). */
function ToastBridge() {
  const { editor, state } = useEditorState();
  const toasts = useToasts();
  const seen = useRef(0);
  const n = state.notice;
  useEffect(() => {
    if (!n || n.n === seen.current) return;
    seen.current = n.n;
    toasts.push(toastOf(n, APP_STRINGS[state.lang].undo, editor));
  }, [n?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const NOTICE_STRINGS = {
  he: { without: 'התמונה מוצגת כרגע בלי האפקט הזה, כי החומר שלו לא נטען. המערכת מנסה שוב מעצמה; ייצוא ותמונות בודדות יסורבו עד שייטען.',
    budget: 'בפריים הזה יש יותר תמונות וידאו לפענוח בבת אחת ממה שהעורך פותח, ולכן הוא מוצג בלי אפקט הזמן. ניסיון חוזר לא יעזור: אפשר להקטין את מספר ההדים, להסיר אפקט זמן או להרחיק זה מזה את הקליפים החופפים. בדיקה לפני ייצוא מראה אילו פריימים יסורבו בייצוא.' },
  en: { without: 'The picture is shown without this effect for now, because its material could not be loaded. Loading is tried again automatically; stills and exports are refused until it loads.',
    budget: 'This frame needs more video pictures decoded at once than the editor opens, so it is shown without its time effect. Trying again will not help: lower the count of a time effect, remove one, or move the overlapping clips apart. Preflight lists the frames an export would refuse.' },
} as const;
/**
 * The frame on screen had to be drawn without an effect whose own material could not be loaded (a colour table whose file
 * could not be fetched or read): say so over the preview, with the effect and the reason, instead of showing it silently.
 * A missing graphics adapter is a different state with its own notice (Look panel).
 */
function PreviewNotice() {
  const { editor, state, t } = useEditorState(); // the player ticks the state after every painted frame
  const reasons = editor.player?.unavailableReasons ?? {};
  // A frame over the decoder budget (ADR-0011) is a different state from material that failed to load: no retry helps it.
  const budget = Object.keys(reasons).filter((id) => isDecodeBudgetReason(reasons[id]));
  const ids = Object.keys(reasons).filter((id) => !isDecodeBudgetReason(reasons[id]));
  // Sound clips whose effects cannot run in this browser play without them (ADR-0010 D7): said here too, never silently.
  const sound = editor.player?.unavailableAudioFx ?? {};
  const soundIds = Object.keys(sound);
  if (ids.length === 0 && budget.length === 0 && soundIds.length === 0) return null;
  const nameOf = (clipId: string) => { const f = state.doc ? findClip(state.doc, clipId) : undefined; return f && state.doc ? clipLabel(state.doc, f.clip, state.lang) : clipId; };
  return (
    <div className="preview-notice" role="status" data-testid="effect-unavailable">
      {budget.length > 0 && <div data-testid="decode-budget-notice">
        <p>{NOTICE_STRINGS[state.lang].budget}</p>
        <ul>{budget.map((id) => <li key={id}><strong><bdi>{findEffect(id)?.name[state.lang] ?? id}</bdi></strong></li>)}</ul>
      </div>}
      {ids.length > 0 && <>
        <p>{NOTICE_STRINGS[state.lang].without}</p>
        <ul>{ids.map((id) => <li key={id}><strong><bdi>{findEffect(id)?.name[state.lang] ?? id}</bdi></strong> — <bdi dir="ltr">{reasons[id]}</bdi></li>)}</ul>
      </>}
      {soundIds.length > 0 && <div data-testid="audio-fx-unavailable">
        <p>{t('sound.fx.unavailable.title')}</p>
        <ul>{soundIds.map((id) => <li key={id}><strong><bdi>{nameOf(id)}</bdi></strong> — <bdi dir="ltr">{sound[id]}</bdi></li>)}</ul>
      </div>}
    </div>
  );
}

function Shell({ canvasRef, keymap }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; keymap: Keymap }) {
  const { t, state } = useEditorState();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  return (
    // The shell grid (ds/shell.css): top bar, error bar, rail, browser, stage, inspector, splitter, timeline, status bar.
    // The rail, the splitter and the status bar are mounts: empty, and without room in the grid, until they are built.
    <div className="app">
      <Header />
      <ErrorBar />
      <Rail />
      <Library />
      {/* the stage and the timeline show the active sequence: the sequence tabs (SequenceSwitcher) control them */}
      <main className="stage" id="pf-stage">
        <StageHeader />
        <div className="canvas-wrap">
          <canvas ref={(el) => { (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el; setCanvasEl(el); }} aria-label={t('preview')} data-testid="preview" />
          <CanvasHandles canvas={canvasEl} />
          <TrackPicker canvas={canvasEl} />
          <PreviewNotice />
          <Welcome />
        </div>
        <Transport />
      </main>
      <Inspector keymap={keymap} />
      <Splitter />
      <Timeline />
      <StatusBar />
      <CommandPalette keymap={keymap} />
      {/* one host each: the export sheet (the top bar's Export, the palette and the Deliver panel open it) and the effects gallery (the rail, the ride bar and the inspector open it) */}
      <ExportSheetHost />
      <PhoneDropHost />
      <FolderPicker />
      <GalleryHost />
      {/* the family film dialog (ADR-0026): draws nothing until an entry, the event card or the palette opens it */}
      <FamilyFilmDialog lang={state.lang} />
      {/* the curve picker (ADR-0019): draws nothing until a keyframe, a strip key or a curve chip opens it */}
      <CurvePicker />
    </div>
  );
}
