/**
 * A paused player on the one-clip document of a still (core stillDocument: the SAME document the server saves, so the tile and the
 * saved picture draw the same pixels). No transport, no sound. When the document cannot be built (the file has no picture, a side over
 * 8192, a part not built) the refusal is said in words instead of a blank canvas; so is a draw that failed.
 *
 * Each canvas has its OWN media pool (integration, wave 8): every still document has the same clip id (STILL_DOC_IDS), and a pool
 * keys its decoders by clip id, so tiles drawing different frames through the editor's pool shared one decoder and each seek closed
 * the sample another tile was drawing ("VideoSample is closed": proof:stills U4 found blank tiles). The own pool reads only the
 * stored file (no proxy, no copy kept in the browser from the import), the bytes the server's still is rendered from.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { stillDocument, type Asset, type ProjectDocument, type StillsRefusal } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import { MediaPool, type MediaPoolOptions } from '../../media.ts';
import { Player } from '../../player.ts';
import { useEditorState } from '../store.ts';

/** The options of a still canvas's own pool: the stored file only (never the proxy), one decoder (one clip, one frame). */
export const stillPoolOptions = (projectId: string): MediaPoolOptions => ({ assetUrl: (assetId) => `/api/v1/projects/${projectId}/assets/${assetId}/content`, maxDecoders: 1 });

export function StillCanvas({ asset, frame, label, testId }: { asset: Asset; frame: number; label: string; testId?: string }) {
  const { state } = useEditorState();
  const projectId = state.doc?.id;
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const [failed, setFailed] = useState<string | null>(null); // a draw that failed is said in words, never a blank canvas
  const built = useMemo((): { doc: ProjectDocument } | { error: string } => {
    try { return { doc: stillDocument(asset, frame) }; } catch (e) {
      const r = e as Partial<StillsRefusal>;
      return { error: translateRefusal(state.lang, r.message ?? String(e)) ?? r.message ?? String(e) };
    }
  }, [asset, frame, state.lang]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !projectId) return;
    const pool = new MediaPool(stillPoolOptions(projectId));
    const p = new Player(canvas, pool, () => {}, (e) => setFailed(e instanceof Error ? e.message : String(e)));
    player.current = p;
    if ('doc' in built) p.setDoc(built.doc);
    return () => { player.current = null; p.dispose(); void pool.dispose(); };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFailed(null); if ('doc' in built) player.current?.setDoc(built.doc); }, [built]);
  return (
    <div className="cover-canvas-wrap" dir="ltr">
      <canvas ref={ref} className="cover-canvas" role="img" aria-label={label} {...(testId ? { 'data-testid': testId } : {})} hidden={'error' in built} />
      {'error' in built && <p className="muted" role="status">{built.error}</p>}
      {'doc' in built && failed && <p className="muted" role="status" data-still-error="">{translateRefusal(state.lang, failed) ?? failed}</p>}
    </div>
  );
}
