import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasHandles } from './editor/CanvasHandles.tsx';
import { CommandPalette } from './editor/CommandPalette.tsx';
import { chordOf, Keymap } from './editor/commands.ts';
import { ErrorBar, Header, Inspector, Library, Transport } from './editor/panels.tsx';
import { shortcutAllowed } from './editor/shortcutGate.ts';
import { Editor, EditorContext, useEditorState } from './editor/store.ts';
import { Timeline } from './editor/Timeline.tsx';
import { Welcome } from './editor/Welcome.tsx';
import { findClip, findEffect } from '@pulseframe/core';
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
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      const chord = chordOf(e);
      const cmd = keymap.lookup(chord);
      if (!cmd) return;
      // any modal dialog (whatever its class) is open: editor shortcuts do not act on the timeline behind it
      if (!shortcutAllowed(chord, cmd, { typing, paletteOpen: editor.getState().paletteOpen, modalOpen: !!document.querySelector('[aria-modal="true"]') })) return;
      e.preventDefault();
      if (!cmd.enabled || cmd.enabled(editor)) void cmd.run(editor);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, keymap]);

  return (
    <EditorContext.Provider value={editor}>
      <Shell canvasRef={canvasRef} keymap={keymap} />
    </EditorContext.Provider>
  );
}

const NOTICE_STRINGS = {
  he: { without: 'התמונה מוצגת כרגע בלי האפקט הזה, כי החומר שלו לא נטען. המערכת מנסה שוב מעצמה; ייצוא ותמונות בודדות יסורבו עד שייטען.' },
  en: { without: 'The picture is shown without this effect for now, because its material could not be loaded. Loading is tried again automatically; stills and exports are refused until it loads.' },
} as const;
/**
 * The frame on screen had to be drawn without an effect whose own material could not be loaded (a colour table whose file
 * could not be fetched or read): say so over the preview, with the effect and the reason, instead of showing it silently.
 * A missing graphics adapter is a different state with its own notice (Look panel).
 */
function PreviewNotice() {
  const { editor, state, t } = useEditorState(); // the player ticks the state after every painted frame
  const reasons = editor.player?.unavailableReasons ?? {};
  const ids = Object.keys(reasons);
  // Sound clips whose effects cannot run in this browser play without them (ADR-0010 D7): said here too, never silently.
  const sound = editor.player?.unavailableAudioFx ?? {};
  const soundIds = Object.keys(sound);
  if (ids.length === 0 && soundIds.length === 0) return null;
  const nameOf = (clipId: string) => { const f = state.doc ? findClip(state.doc, clipId) : undefined; return f && state.doc ? clipLabel(state.doc, f.clip) : clipId; };
  return (
    <div className="preview-notice" role="status" data-testid="effect-unavailable">
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
  const { t } = useEditorState();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  return (
    <div className="app">
      <Header />
      <ErrorBar />
      <Library />
      <main className="stage">
        <div className="canvas-wrap">
          <canvas ref={(el) => { (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el; setCanvasEl(el); }} aria-label={t('preview')} data-testid="preview" />
          <CanvasHandles canvas={canvasEl} />
          <PreviewNotice />
          <Welcome />
        </div>
        <Transport />
      </main>
      <Inspector keymap={keymap} />
      <Timeline />
      <CommandPalette keymap={keymap} />
    </div>
  );
}
