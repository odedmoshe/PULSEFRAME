/**
 * A small still of a library file of ANY project (the event strips and the «on this day» card), from the server's own routes
 * and nothing else: a picture is its content; for a video the first tile of its thumbnails derivative, cut out of the sprite with
 * CSS. A file whose thumbnails are not ready is shown as a quiet placeholder (never a made-up picture). Decorative: the card
 * that holds it names the file.
 */
import { useState } from 'react';
import { Film } from 'lucide-react';
import type { ThumbMeta } from '../mediaThumb.ts';

const enc = encodeURIComponent;
export function LifeThumb({ projectId, assetId, className }: { projectId: string; assetId: string; className?: string }) {
  const [mode, setMode] = useState<{ kind: 'img' } | { kind: 'sprite'; meta: ThumbMeta } | { kind: 'none' }>({ kind: 'img' });
  const base = `/api/v1/projects/${enc(projectId)}/assets/${enc(assetId)}`;
  const fallback = async () => {
    try {
      const r = await fetch(`${base}/derivatives`, { credentials: 'same-origin' });
      const row = r.ok ? ((await r.json()) as { derivatives?: { kind: string; status: string; meta: ThumbMeta }[] }).derivatives?.find((d) => d.kind === 'thumbnails' && d.status === 'ready') : undefined;
      setMode(row ? { kind: 'sprite', meta: row.meta } : { kind: 'none' });
    } catch { setMode({ kind: 'none' }); }
  };
  if (mode.kind === 'img') return <img className={className} src={`${base}/content`} alt="" loading="lazy" draggable={false} onError={() => void fallback()} />;
  if (mode.kind === 'sprite') {
    const { columns, rows } = mode.meta;
    return <span className={className} aria-hidden="true" style={{ backgroundImage: `url(${base}/derivatives/thumbnails)`, backgroundSize: `${columns * 100}% ${rows * 100}%`, backgroundPosition: '0 0', backgroundRepeat: 'no-repeat' }} />;
  }
  return <span className={className} aria-hidden="true"><Film size={16} strokeWidth={1.75} /></span>;
}
