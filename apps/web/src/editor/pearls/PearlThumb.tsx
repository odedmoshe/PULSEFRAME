/**
 * The picture of a pearl: a still as it is, a video as the thumbnail-sprite tile nearest the span's first frame, a quiet icon until
 * the thumbnails exist or for a file without picture. A view only; the span start is read through core sourceFrameOfTime.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { AudioLines, Film } from 'lucide-react';
import { sourceFrameOfTime, videoFrames, type Asset, type SourceSpan } from '@pulseframe/core';
import { api } from '../../api.ts';
import { spriteStyle, spriteTileIndex } from '../familyFilm.logic.ts';

interface Meta { columns: number; rows: number; frameIndices: number[] }
const cache = new Map<string, Meta>();
const enc = encodeURIComponent;
export function PearlThumb({ projectId, asset, span }: { projectId: string; asset: Asset; span: SourceSpan | null }): ReactElement {
  const key = `${projectId}:${asset.id}`;
  const [meta, setMeta] = useState<Meta | null>(() => cache.get(key) ?? null);
  const video = asset.kind !== 'image' && !!asset.video;
  useEffect(() => {
    if (!video || meta) return;
    let on = true;
    api.derivatives(projectId, asset.id).then((r) => {
      const row = r.derivatives.find((d) => d.kind === 'thumbnails' && d.status === 'ready');
      if (row && on) { cache.set(key, row.meta as Meta); setMeta(row.meta as Meta); }
    }).catch(() => undefined);
    return () => { on = false; };
  }, [video, meta, projectId, asset.id, key]);
  if (asset.kind === 'image') return <img className="pf-pearl-thumb" src={`/api/v1/projects/${enc(projectId)}/assets/${enc(asset.id)}/content`} alt="" loading="lazy" draggable={false} />;
  if (!video) return <span className="pf-pearl-thumb is-empty" aria-hidden="true"><AudioLines size={16} /></span>;
  if (!meta) return <span className="pf-pearl-thumb is-empty" aria-hidden="true"><Film size={16} /></span>;
  const frames = videoFrames(asset) ?? 1;
  const at = span ? Math.min(Math.max(0, sourceFrameOfTime(asset, span.start)), frames - 1) : 0;
  const index = spriteTileIndex(at, frames, meta.frameIndices.length);
  return <span className="pf-pearl-thumb" aria-hidden="true" style={{ backgroundImage: `url(/api/v1/projects/${enc(projectId)}/assets/${enc(asset.id)}/derivatives/thumbnails)`, backgroundRepeat: 'no-repeat', ...spriteStyle(meta.columns, meta.rows, index) }} />;
}
