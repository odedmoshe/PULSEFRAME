import { useEffect, useRef, useState } from 'react';
import { AudioLines, Eye, FileMusic, Film, Image as ImageIcon, Plus, Trash, Upload, CircleCheck } from 'lucide-react';
import * as T from '@pulseframe/time';
import { assetNotices, type Asset, type ProjectDocument } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { peaksForColumns, pickWaveformLevel } from '../clipVisuals.math.ts';
import { ASSET_DRAG_TYPE, useEditorState } from './store.ts';
import { InlineRename } from './InlineRename.tsx';
import { MEDIA_STRINGS } from './media.strings.ts';
import './mediaLibrary.css';

interface ThumbMeta { tileWidth: number; tileHeight: number; columns: number; rows: number; frameIndices: number[] }
interface WaveLevel { samplesPerBucket: number; buckets: number; byteOffset: number }
interface WaveMeta { sampleRate: number; totalSamples: number; levels: WaveLevel[] }
type Row = { kind: string; status: string; meta: any };
type Loaded = { kind: 'thumbnails'; bitmap: ImageBitmap; meta: ThumbMeta } | { kind: 'waveform'; buffer: ArrayBuffer; meta: WaveMeta } | null;

const RETRY_MS = [1000, 3000, 8000];
const fmtDur = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Loads the ingest derivative that suits the asset (filmstrip or waveform), retrying a bounded number of times while it is being made. */
function useDerivative(projectId: string, a: Asset, refreshKey: number): Loaded {
  const want = a.kind === 'video' && a.video ? 'thumbnails' : a.kind !== 'image' && a.audio ? 'waveform' : null;
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    if (!want) return;
    let dead = false; let timer: ReturnType<typeof setTimeout> | undefined; let bmp: ImageBitmap | null = null;
    const base = `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(a.id)}/derivatives`;
    const attempt = async (n: number) => {
      let ok = false;
      try {
        const r = await fetch(base, { credentials: 'same-origin' });
        if (r.ok) {
          const row = ((await r.json()) as { derivatives: Row[] }).derivatives.find((d) => d.kind === want);
          if (row?.status === 'not-applicable') return;
          if (row?.status === 'ready') {
            const b = await fetch(`${base}/${want}`, { credentials: 'same-origin' });
            if (b.ok && !dead) {
              if (want === 'thumbnails') { bmp = await createImageBitmap(await b.blob()); if (dead) { bmp.close(); return; } setLoaded({ kind: 'thumbnails', bitmap: bmp, meta: row.meta as ThumbMeta }); }
              else setLoaded({ kind: 'waveform', buffer: await b.arrayBuffer(), meta: row.meta as WaveMeta });
              ok = true;
            }
          }
        }
      } catch { /* try again below */ }
      if (!ok && !dead && n < RETRY_MS.length) timer = setTimeout(() => void attempt(n + 1), RETRY_MS[n]);
    };
    void attempt(0);
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [projectId, a.id, a.contentHash, want, refreshKey]);
  return loaded;
}

function Thumb({ projectId, a, refreshKey }: { projectId: string; a: Asset; refreshKey: number }) {
  const loaded = useDerivative(projectId, a, refreshKey);
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = (frac: number) => {
    const c = canvas.current;
    if (!c || !loaded) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (loaded.kind === 'thumbnails') {
      const m = loaded.meta; const n = m.frameIndices.length;
      const i = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
      c.width = m.tileWidth; c.height = m.tileHeight;
      ctx.drawImage(loaded.bitmap, (i % m.columns) * m.tileWidth, Math.floor(i / m.columns) * m.tileHeight, m.tileWidth, m.tileHeight, 0, 0, m.tileWidth, m.tileHeight);
    } else {
      const W = 208, H = 117; c.width = W; c.height = H;
      const m = loaded.meta;
      const level = pickWaveformLevel(m.levels, m.totalSamples, W);
      const peaks = peaksForColumns({ view: new DataView(loaded.buffer), level, firstSample: 0, sampleCount: m.totalSamples, columns: W });
      ctx.fillStyle = '#d2e1ff'; const k = H / 2 / 32768;
      for (let x = 0; x < W; x++) { const top = Math.max(0, H / 2 - peaks[x * 2 + 1]! * k), bot = Math.min(H, H / 2 - peaks[x * 2]! * k); ctx.fillRect(x, top, 1, Math.max(1, bot - top)); }
    }
    c.setAttribute('data-drawn', '1');
  };
  useEffect(() => { draw(0); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
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
        const isUsed = used.has(a.id);
        const KindIcon = a.kind === 'image' ? ImageIcon : a.kind === 'video' ? Film : AudioLines;
        const add = () => void editor.addAsset(a.id);
        return (
          <li key={a.id} className="media-card" draggable data-testid={`asset-${a.id}`} title={t('media.dragHint')}
            onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
            <div className="mc-thumb" onDoubleClick={add}>
              <Thumb projectId={doc.id} a={a} refreshKey={derivativeTick} />
              <span className="mc-kind" aria-hidden="true"><KindIcon size={12} /></span>
              <span className="mc-badge mc-dur" dir="ltr">{a.kind === 'image' ? `${a.image?.width}×${a.image?.height}` : fmtDur(T.toSeconds(a.duration))}</span>
              {isUsed && <span className="mc-used" title={S.inUse} role="img" aria-label={S.inUse} data-testid={`used-${a.id}`}><CircleCheck size={12} aria-hidden="true" /></span>}
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
              <button className="ghost" onClick={add} data-testid={`add-${a.id}`} aria-label={`${t('media.add')}: ${a.name}`} title={t('media.add')}><Plus size={16} aria-hidden="true" /></button>
              {a.kind !== 'image' && <button className="ghost" onClick={() => onView(a.id)} data-testid={`view-${a.id}`} aria-label={`${t('source.open')}: ${a.name}`} title={t('source.open')}><Eye size={16} aria-hidden="true" /></button>}
              <button className="ghost danger" disabled={isUsed} title={isUsed ? t('media.remove.used') : t('media.remove')} aria-label={`${t('media.remove')}: ${a.name}`} onClick={() => void editor.commit([{ op: 'remove_asset', args: { assetId: a.id } }], 'Remove file')} data-testid={`remove-${a.id}`}><Trash size={16} aria-hidden="true" /></button>
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
