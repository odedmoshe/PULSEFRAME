import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasHandles } from './editor/CanvasHandles.tsx';
import { CommandPalette } from './editor/CommandPalette.tsx';
import { chordOf, Keymap } from './editor/commands.ts';
import { ErrorBar, Header, Inspector, Library, Transport } from './editor/panels.tsx';
import { shortcutAllowed } from './editor/shortcutGate.ts';
import { Editor, EditorContext, useEditorState } from './editor/store.ts';
import { Timeline } from './editor/Timeline.tsx';
import { Welcome } from './editor/Welcome.tsx';

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
