/**
 * A paused player on the one-clip document of a still (core stillDocument: the SAME document the server saves, so the tile and the
 * saved picture draw the same pixels). No transport, no sound. When the document cannot be built (the file has no picture, a side over
 * 8192, a part not built) the refusal is said in words instead of a blank canvas.
 */
import { useEffect, useMemo, useRef } from 'react';
import { stillDocument, type Asset, type ProjectDocument, type StillsRefusal } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import { Player } from '../../player.ts';
import { useEditorState } from '../store.ts';

export function StillCanvas({ asset, frame, label, testId }: { asset: Asset; frame: number; label: string; testId?: string }) {
  const { editor, state } = useEditorState();
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const built = useMemo((): { doc: ProjectDocument } | { error: string } => {
    try { return { doc: stillDocument(asset, frame) }; } catch (e) {
      const r = e as Partial<StillsRefusal>;
      return { error: translateRefusal(state.lang, r.message ?? String(e)) ?? r.message ?? String(e) };
    }
  }, [asset, frame, state.lang]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !editor.pool) return;
    const p = new Player(canvas, editor.pool, () => {}, () => {});
    p.sharpness = editor.getState().playSharpness;
    player.current = p;
    return () => { player.current = null; p.dispose(); };
  }, [editor]);
  useEffect(() => { if ('doc' in built) player.current?.setDoc(built.doc); }, [built]);
  return (
    <div className="cover-canvas-wrap" dir="ltr">
      <canvas ref={ref} className="cover-canvas" role="img" aria-label={label} {...(testId ? { 'data-testid': testId } : {})} hidden={'error' in built} />
      {'error' in built && <p className="muted" role="status">{built.error}</p>}
    </div>
  );
}
