/**
 * The angle viewer (ADR-0020): core multiviewDocument (a layoutPlacements grid of the live angles, labels, no sound) drawn by a
 * SECOND Player with its own MediaPool({ assetUrl, previewUrl, maxDecoders: 4 }), slaved through Player.follow(frame) from the
 * program's group time and throttled to at most 15 frames a second (4 under reduced motion). Angles beyond the 4 live tiles show
 * the nearest thumbnail (mediaThumb.ts), labelled «תמונה ממוזערת, לא חי»; the program pool (10 decoders) is untouched.
 * The viewer never plays sound and never touches the program's transport.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { fromGroupExact, groupTimeAt, multicamGroupOf, multiviewDocument, pieceCoverage, syncGrid, type MulticamAngle, type MulticamGroup, type ProjectDocument } from '@pulseframe/core';
import { api } from '../api.ts';
import { MediaPool } from '../media.ts';
import { Player } from '../player.ts';
import { DerivativeLoader, thumbTileAt, type LoadedDerivative } from './mediaThumb.ts';
import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';
import { useEditorState } from './store.ts';

export interface AngleViewerProps { groupId: string; lang: 'he' | 'en'; liveAngleIds: string[] }
/** The most frames a second the viewer is drawn at while the program plays. */
export const VIEWER_FPS = 15;
export const VIEWER_FPS_REDUCED = 4;
export const LIVE_TILES = 4;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Group-time span the placed pieces of a group cover, or null when none is placed (or the maths is not available). */
export function groupSpan(doc: ProjectDocument, group: MulticamGroup): { g0: T.RationalTime; duration: T.RationalTime } | null {
  try {
    const grid = syncGrid(group.sampleRate, doc.settings.frameRate);
    let lo: T.RationalTime | null = null, hi: T.RationalTime | null = null;
    for (const a of group.angles) for (const p of a.pieces) {
      const asset = doc.assets[p.assetId];
      if (!asset || !p.anchors.length) continue;
      const c = pieceCoverage(p, asset.duration, grid);
      if (!c) continue;
      lo = lo ? T.min(lo, c.start) : c.start; hi = hi ? T.max(hi, c.end) : c.end;
    }
    return lo && hi && T.lt(lo, hi) ? { g0: lo, duration: T.sub(hi, lo) } : null;
  } catch { return null; }
}

/** The group time of the picture on the program track under the playhead (re-read on every player tick), or null. */
export function useProgramGroupTime(): { g: T.RationalTime; groupId: string } | null {
  const { editor, state } = useEditorState();
  void state.tick;
  const prog = editor.multicamProgram(), d = state.doc;
  if (!prog || !d) return null;
  try { const r = groupTimeAt(d, prog.sequenceId, prog.trackId, editor.playhead); return r ? { g: r.g, groupId: r.groupId } : null; } catch { return null; }
}

export function AngleViewer({ groupId, lang, liveAngleIds }: AngleViewerProps) {
  const { editor, state } = useEditorState();
  const S = MULTICAM_STRINGS[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const span = useRef<{ g0: T.RationalTime; duration: T.RationalTime } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const doc = state.doc;
  const group = doc ? multicamGroupOf(doc, groupId) : undefined;
  const key = `${groupId}|${liveAngleIds.join(',')}|${JSON.stringify(group)}`;

  // one pool and one draft-only player for the life of the viewer
  useEffect(() => {
    const el = canvas.current, projectId = editor.getState().doc?.id;
    if (!el || !projectId) return;
    const pool = new MediaPool({
      assetUrl: (assetId) => `/api/v1/projects/${projectId}/assets/${assetId}/content`,
      previewUrl: async (assetId) => ((await api.derivatives(projectId, assetId)).derivatives.find((d) => d.kind === 'proxy')?.status === 'ready' ? `/api/v1/projects/${projectId}/assets/${assetId}/derivatives/proxy` : null),
      maxDecoders: 4,
    });
    const p = new Player(el, pool, () => {}, (e) => setProblem(e instanceof Error ? e.message : String(e)), { draftOnly: { maxHeight: 270 } });
    player.current = p;
    (window as unknown as { __pfViewerMedia?: () => unknown }).__pfViewerMedia = () => pool.stats();
    return () => { player.current = null; p.dispose(); void pool.dispose(); delete (window as unknown as { __pfViewerMedia?: unknown }).__pfViewerMedia; };
  }, [editor]);

  // the multiview document: rebuilt only when the group, its live angles or its files change
  useEffect(() => {
    const p = player.current, d = editor.getState().doc;
    if (!p || !d || !group) return;
    const s = groupSpan(d, group);
    span.current = s;
    if (!s || !liveAngleIds.length) { setProblem(null); return; }
    try {
      const mv = multiviewDocument(d, groupId, { liveAngleIds, g0: s.g0, duration: s.duration, width: 480, height: 270 });
      setProblem(null);
      p.setDoc(mv);
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // slaved to the program: its group time, at most VIEWER_FPS draws a second
  const last = useRef(0), timer = useRef(0), want = useRef<number | null>(null);
  const gt = useProgramGroupTime();
  useEffect(() => {
    const p = player.current, s = span.current;
    if (!p || !s || !gt || gt.groupId !== groupId) return;
    want.current = Math.max(0, T.frameIndexAt(T.sub(gt.g, s.g0), editor.rate));
    const every = 1000 / (reduced() ? VIEWER_FPS_REDUCED : VIEWER_FPS);
    const paused = !editor.player?.playing;
    const fire = () => { timer.current = 0; last.current = performance.now(); if (want.current !== null) player.current?.follow(want.current); };
    if (paused) { if (timer.current) { clearTimeout(timer.current); timer.current = 0; } fire(); return; }
    if (timer.current) return;
    timer.current = window.setTimeout(fire, Math.max(0, every - (performance.now() - last.current)));
  }, [gt?.g.value, gt?.g.timescale, gt?.groupId, groupId, editor]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="mc-viewer" data-testid={ID.viewer}>
      <canvas ref={canvas} className="mc-viewer-canvas" role="img" aria-label={`${S.viewerLabel}: ${S.liveTiles}`} width={480} height={270} />
      {problem && <p className="muted" role="status">{problem}</p>}
    </div>
  );
}

type Loaded = LoadedDerivative<ImageBitmap> | null;
/** An angle beyond the live four: the nearest thumbnail of its file at the program's group time, labelled as not live. */
export function ThumbnailTile({ angle, group, lang }: { angle: MulticamAngle; group: MulticamGroup; lang: 'he' | 'en' }) {
  const { editor, state } = useEditorState();
  const S = MULTICAM_STRINGS[lang];
  const doc = state.doc as ProjectDocument;
  const gt = useProgramGroupTime();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const loader = useRef<DerivativeLoader<ImageBitmap> | null>(null);
  // the piece showing at the group time, and where in its file that is (a fraction of its duration)
  const where = useMemo(() => {
    if (!gt) return { piece: angle.pieces[0]!, frac: 0 };
    for (const piece of angle.pieces) {
      const dur = doc.assets[piece.assetId]?.duration;
      if (!dur || !piece.anchors.length) continue;
      try {
        const f = fromGroupExact(piece, gt.g);
        const sec = Number(f.n) / Number(f.d), total = T.toSeconds(dur);
        if (sec >= 0 && sec <= total) return { piece, frac: sec / total };
      } catch { /* unplaced */ }
    }
    return { piece: angle.pieces[0]!, frac: 0 };
  }, [gt?.g.value, gt?.g.timescale, angle, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const asset = doc.assets[where.piece.assetId];
  useEffect(() => {
    const l = new DerivativeLoader<ImageBitmap>({ fetch: (url, signal) => fetch(url, { credentials: 'same-origin', signal }), decode: (b) => createImageBitmap(b), onChange: (v) => setLoaded(v) });
    loader.current = l;
    return () => { loader.current = null; l.dispose(); };
  }, []);
  useEffect(() => { if (asset) loader.current?.show({ projectId: doc.id, assetId: asset.id, contentHash: asset.contentHash, kind: 'thumbnails' }); }, [doc.id, asset?.id, asset?.contentHash]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loader.current?.poke(); }, [state.derivativeTick]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !loaded || loaded.kind !== 'thumbnails') return;
    const tile = thumbTileAt(loaded.meta, where.frac);
    c.width = tile.width; c.height = tile.height;
    c.getContext('2d')?.drawImage(loaded.bitmap, tile.sx, tile.sy, tile.width, tile.height, 0, 0, tile.width, tile.height);
  }, [loaded, where.frac]);
  void editor;
  return (
    <span className="mc-thumb" data-testid={ID.thumbnail} data-angle-id={angle.id}>
      <canvas ref={canvas} aria-hidden="true" />
      <span className="mc-thumb-note">{S.thumbnailNote}</span>
    </span>
  );
}
