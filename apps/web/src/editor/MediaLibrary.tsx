import { useEffect, useRef, useState } from 'react';
import { AudioLines, Eye, FileMusic, Film, Image as ImageIcon, Palette, Plus, Trash, Upload, CircleCheck } from 'lucide-react';
import * as T from '@pulseframe/time';
import { assetNotices, lutUsers, type Asset, type ProjectDocument } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { peaksForColumns, pickWaveformLevel } from '../clipVisuals.math.ts';
import { DerivativeLoader, thumbTileAt, type LoadedDerivative } from './mediaThumb.ts';
import { ASSET_DRAG_TYPE, useEditorState } from './store.ts';
import { InlineRename } from './InlineRename.tsx';
import { MEDIA_STRINGS } from './media.strings.ts';
import './mediaLibrary.css';

type Loaded = LoadedDerivative<ImageBitmap> | null;

const fmtDur = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Loads the ingest derivative that suits the asset (filmstrip or waveform). The card loads it once: `refreshKey` (bumped by a
 * derivative event of ANY asset) only makes a card that is still waiting look at the state of its own asset, with a bounded
 * number of retries while it is being made. The decoded filmstrip is closed when it is replaced and when the card goes away
 * (rules and tests: mediaThumb.ts). `loaded` says what to render; `live` is what may be drawn right now: it never holds a
 * closed picture, also between a replacement and the next render. `loads` counts the derivatives this card was handed.
 */
function useDerivative(projectId: string, a: Asset, refreshKey: number): { loaded: Loaded; live: { readonly current: Loaded }; loads: { readonly current: number } } {
  const want = a.kind === 'video' && a.video ? 'thumbnails' : a.kind !== 'image' && a.audio ? 'waveform' : null;
  const [loaded, setLoaded] = useState<Loaded>(null);
  const live = useRef<Loaded>(null);
  const loads = useRef(0);
  const loader = useRef<DerivativeLoader<ImageBitmap> | null>(null);
  const seen = useRef(refreshKey);
  useEffect(() => {
    const l = new DerivativeLoader<ImageBitmap>({
      fetch: (url, signal) => fetch(url, { credentials: 'same-origin', signal }),
      decode: (blob) => createImageBitmap(blob),
      onChange: (v) => { live.current = v; loads.current = l.loads; setLoaded(v); },
    });
    loader.current = l;
    return () => { loader.current = null; live.current = null; setLoaded(null); l.dispose(); };
  }, []);
  useEffect(() => { loader.current?.show(want ? { projectId, assetId: a.id, contentHash: a.contentHash, kind: want } : null); }, [projectId, a.id, a.contentHash, want]);
  useEffect(() => { if (seen.current !== refreshKey) { seen.current = refreshKey; loader.current?.poke(); } }, [refreshKey]);
  return { loaded, live, loads };
}

function Thumb({ projectId, a, refreshKey }: { projectId: string; a: Asset; refreshKey: number }) {
  const { loaded, live, loads } = useDerivative(projectId, a, refreshKey);
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = (frac: number) => {
    const c = canvas.current, cur = live.current;
    if (!c || !cur) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (cur.kind === 'thumbnails') {
      // The canvas takes the size of one tile, which has the aspect of the video; the stylesheet fits it into the 16:9 box (contain, on black).
      const tile = thumbTileAt(cur.meta, frac);
      if (c.width !== tile.width) c.width = tile.width;
      if (c.height !== tile.height) c.height = tile.height;
      ctx.drawImage(cur.bitmap, tile.sx, tile.sy, tile.width, tile.height, 0, 0, tile.width, tile.height);
      c.setAttribute('data-frame', String(tile.index));
    } else {
      const W = 208, H = 117; c.width = W; c.height = H;
      const m = cur.meta;
      const level = pickWaveformLevel(m.levels, m.totalSamples, W);
      const peaks = peaksForColumns({ view: new DataView(cur.buffer), level, firstSample: 0, sampleCount: m.totalSamples, columns: W });
      ctx.fillStyle = '#d2e1ff'; const k = H / 2 / 32768;
      for (let x = 0; x < W; x++) { const top = Math.max(0, H / 2 - peaks[x * 2 + 1]! * k), bot = Math.min(H, H / 2 - peaks[x * 2]! * k); ctx.fillRect(x, top, 1, Math.max(1, bot - top)); }
    }
    c.setAttribute('data-drawn', '1');
    c.setAttribute('data-loads', String(loads.current)); // stays "1" while the card keeps the derivative it loaded; a reload would raise it
  };
  useEffect(() => { draw(0); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  if (a.kind === 'lut') return <Palette size={24} aria-hidden="true" />;
  if (a.kind === 'image') return <img src={`/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(a.id)}/content`} alt="" loading="lazy" draggable={false} />;
  if (loaded) {
    const scrub = loaded.kind === 'thumbnails' && loaded.meta.frameIndices.length > 1 && !reduced();
    return <canvas ref={canvas} data-testid={`thumb-${a.id}`} aria-hidden="true"
      onPointerMove={scrub ? (e) => { const r = e.currentTarget.getBoundingClientRect(); draw(r.width ? (e.clientX - r.left) / r.width : 0); } : undefined}
      onPointerLeave={scrub ? () => draw(0) : undefined} />;
  }
  return a.kind === 'video' ? <Film size={24} aria-hidden="true" /> : <FileMusic size={24} aria-hidden="true" />;
}

export function MediaGrid({ onView }: { onView: (id: string) => void }) {
  const { editor, state, t } = useEditorState();
  const { doc, derivativeTick } = state;
  const S = MEDIA_STRINGS[state.lang];
  if (!doc) return null;
  const used = usedAssets(doc);
  const assets = Object.values(doc.assets);
  if (assets.length === 0) return <p className="media-empty" data-testid="media-empty"><Upload size={22} aria-hidden="true" /><span>{t('media.empty')}</span></p>;
  return (
    <ul className="assets media-grid" aria-label={S.grid}>
      {assets.map((a) => {
        // A colour table (LUT) is not timeline material: it is applied to clips as an effect, and counts as used while an effect names it.
        const isLut = a.kind === 'lut';
        const isUsed = isLut ? lutUsers(doc, a.id).length > 0 : used.has(a.id);
        const usedLabel = isLut ? S.lutInUse : S.inUse;
        const KindIcon = isLut ? Palette : a.kind === 'image' ? ImageIcon : a.kind === 'video' ? Film : AudioLines;
        const add = () => void editor.addAsset(a.id);
        return (
          <li key={a.id} className="media-card" draggable={!isLut} data-testid={`asset-${a.id}`} data-kind={a.kind} title={isLut ? S.lutHint : t('media.dragHint')}
            onDragStart={isLut ? undefined : (e) => { e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
            <div className="mc-thumb" onDoubleClick={isLut ? undefined : add}>
              <Thumb projectId={doc.id} a={a} refreshKey={derivativeTick} />
              <span className="mc-kind" aria-hidden="true"><KindIcon size={12} /></span>
              {isLut
                ? <span className="mc-badge mc-dur" dir="ltr" data-testid={`lut-size-${a.id}`} title={`${S.lut}: ${S.lutSize}`}>{a.lut ? `${a.lut.size}³` : 'LUT'}</span>
                : <span className="mc-badge mc-dur" dir="ltr">{a.kind === 'image' ? `${a.image?.width}×${a.image?.height}` : fmtDur(T.toSeconds(a.duration))}</span>}
              {isUsed && <span className="mc-used" title={usedLabel} role="img" aria-label={usedLabel} data-testid={`used-${a.id}`}><CircleCheck size={12} aria-hidden="true" /></span>}
            </div>
            <span className="mc-name"><span className="asset-name" dir="auto" title={a.name}>{a.name}</span>
              <InlineRename value={a.name} label={`${t('media.rename')}: ${a.name}`} testid={`rename-${a.id}`} onCommit={(name) => void editor.commit([{ op: 'rename_asset', args: { assetId: a.id, name } }], 'Rename file')} /></span>
            {assetNotices(a).length > 0 && (
            <details className="mc-notes" data-testid={`notes-${a.id}`}>
            <summary><span aria-hidden="true">ⓘ </span>{S.notes} <bdi>({assetNotices(a).length})</bdi></summary>
            {assetNotices(a).map((n) => (
              <span key={n.code} className="asset-notice" data-testid="asset-notice" data-code={n.code}>
                <span aria-hidden="true">ⓘ </span>
                {n.code === 'converted' ? `${t('notice.converted')}: ${n.reasons.map((r) => t(`notice.reason.${r}` as Key)).join(', ')}`
                  : n.code === 'picture-starts-late' ? `${t('notice.pictureLate')} (${n.frames})`
                  : n.code === 'sound-offset' ? `${n.seconds > 0 ? t('notice.soundLate') : t('notice.soundEarly')} (${Math.abs(n.seconds).toFixed(2)}s)`
                  : t('notice.colourUntagged')}
                {n.code === 'colour-untagged' && (
                  <label className="notice-choice">{t('notice.colourReadAs')}{' '}
                    <select value={n.readAs} data-testid={`colour-read-${a.id}`} onChange={(e) => void editor.commit([{ op: 'set_asset_colour', args: { assetId: a.id, readAs: e.target.value } }], 'Colour reading')}>
                      <option value="auto">{t('notice.colourReadAs.auto')}</option>
                      <option value="bt601">{t('notice.colourReadAs.bt601')}</option>
                    </select>
                  </label>
                )}
              </span>
            ))}
            </details>
            )}
            <div className="mc-actions">
              {!isLut && <button className="ghost" onClick={add} data-testid={`add-${a.id}`} aria-label={`${t('media.add')}: ${a.name}`} title={t('media.add')}><Plus size={16} aria-hidden="true" /></button>}
              {a.kind !== 'image' && !isLut && <button className="ghost" onClick={() => onView(a.id)} data-testid={`view-${a.id}`} aria-label={`${t('source.open')}: ${a.name}`} title={t('source.open')}><Eye size={16} aria-hidden="true" /></button>}
              <button className="ghost danger" disabled={isUsed} title={isUsed ? (isLut ? S.lutRemoveUsed : t('media.remove.used')) : t('media.remove')} aria-label={`${t('media.remove')}: ${a.name}`} onClick={() => void editor.commit([{ op: 'remove_asset', args: { assetId: a.id } }], 'Remove file')} data-testid={`remove-${a.id}`}><Trash size={16} aria-hidden="true" /></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function usedAssets(doc: ProjectDocument): Set<string> {
  const s = new Set<string>();
  for (const tr of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of tr.clips) if (c.type === 'media') s.add(c.assetId);
  return s;
}
