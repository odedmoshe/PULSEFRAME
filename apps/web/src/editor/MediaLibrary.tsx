import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Check, Ellipsis, Eye, FileMusic, Film, Image as ImageIcon, Palette, Plus, Trash2, Info, TriangleAlert } from 'lucide-react';
import * as T from '@pulseframe/time';
import { assetNotices, lutUsers, type Asset, type ProjectDocument } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { peaksForColumns, pickWaveformLevel } from '../clipVisuals.math.ts';
import { DerivativeLoader, thumbTileAt, type LoadedDerivative } from './mediaThumb.ts';
import { ASSET_DRAG_TYPE, useEditorState } from './store.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { onMenuKeyDown } from './menuKeys.ts';
import { InlineRename } from './InlineRename.tsx';
import { MEDIA_STRINGS } from './media.strings.ts';
import { CaptureEditor, DateBadge } from './lifeline/CaptureEditor.tsx';
import { LIFE_STRINGS } from './lifeline/lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline/lifeline.testids.ts';
import { assetDisplayName } from './assetLabel.ts';
import { togglePick, usePicks } from './MulticamLibraryEntry.tsx';
import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { TL_STRINGS } from './timeline.strings.ts';
import './mediaLibrary.css';
import './multicam.css';

type Loaded = LoadedDerivative<ImageBitmap> | null;

const fmtDur = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
const formatOf = (a: Asset) => (/\.([A-Za-z0-9]{1,5})$/.exec(a.name)?.[1] ?? a.mimeType.split('/')[1] ?? a.kind).toUpperCase();
export type MediaFilter = 'all' | 'video' | 'audio' | 'image' | 'unused';
/** The assets a filter and a search word keep (the drawer's chips and search box). */
export function filterAssets(doc: ProjectDocument, query: string, filter: MediaFilter): Asset[] {
  const used = usedAssets(doc); const q = query.trim().toLowerCase();
  return Object.values(doc.assets).filter((a) => (filter === 'all' || (filter === 'unused' ? a.kind !== 'lut' && !used.has(a.id) : a.kind === filter)) && (!q || a.name.toLowerCase().includes(q)));
}
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

function Thumb({ projectId, a, refreshKey, missing }: { projectId: string; a: Asset; refreshKey: number; missing: boolean }) {
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
      ctx.fillStyle = getComputedStyle(c).getPropertyValue('--pf-k-sfx').trim() || 'currentColor'; const k = H / 2 / 32768;
      for (let x = 0; x < W; x++) { const top = Math.max(0, H / 2 - peaks[x * 2 + 1]! * k), bot = Math.min(H, H / 2 - peaks[x * 2]! * k); ctx.fillRect(x, top, 1, Math.max(1, bot - top)); }
    }
    c.setAttribute('data-drawn', '1');
    c.setAttribute('data-loads', String(loads.current)); // stays "1" while the card keeps the derivative it loaded; a reload would raise it
  };
  useEffect(() => { draw(0); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  if (a.kind === 'lut') return <Palette size={24} aria-hidden="true" />;
  if (a.kind === 'image' && missing) return <ImageIcon size={24} aria-hidden="true" />; // its file is missing: no broken picture
  if (a.kind === 'image') return <img src={`/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(a.id)}/content`} alt="" loading="lazy" draggable={false} />;
  if (loaded) {
    const scrub = loaded.kind === 'thumbnails' && loaded.meta.frameIndices.length > 1 && !reduced();
    return <canvas ref={canvas} data-testid={`thumb-${a.id}`} aria-hidden="true"
      onPointerMove={scrub ? (e) => { const r = e.currentTarget.getBoundingClientRect(); draw(r.width ? (e.clientX - r.left) / r.width : 0); } : undefined}
      onPointerLeave={scrub ? () => draw(0) : undefined} />;
  }
  return a.kind === 'video' ? <Film size={24} aria-hidden="true" /> : <FileMusic size={24} aria-hidden="true" />;
}


/** One card's ⋯ menu: view, notes about the file, remove. A popover placed from the button, closed by Esc, a click away or a choice. */
function CardMenu({ a, doc, isLut, isUsed, onView }: { a: Asset; doc: ProjectDocument; isLut: boolean; isUsed: boolean; onView: (id: string) => void }) {
  const { editor, state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const M = MEDIA_STRINGS[state.lang];
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [dating, setDating] = useState(false); // the capture date dialog (life line, ADR-0021)
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const notices = assetNotices(a);
  useEffect(() => {
    if (!at) return;
    const away = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAt(null); btn.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc, true);
    pop.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled),select')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [at]);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    setAt({ top: Math.min(r.bottom + 4, window.innerHeight - 260), left: Math.max(8, Math.min(rtl ? r.right - 232 : r.left, window.innerWidth - 240)) });
  };
  const close = () => { setAt(null); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="pf-mc-btn" aria-haspopup="menu" aria-expanded={!!at} aria-label={`${S.cardMore}: ${a.name}`} title={S.cardMore} data-testid={`more-${a.id}`} onClick={() => (at ? setAt(null) : open())}><Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      {at && createPortal(
        <div ref={pop} className="pf-ds pf-mc-pop" style={{ top: at.top, left: at.left }}>
          {notices.length > 0 && (
            <details className="pf-mc-notes" data-testid={`notes-${a.id}`} open>
              <summary><Info size={16} strokeWidth={1.75} aria-hidden="true" />{S.fixNotes} <bdi className="num">({notices.length})</bdi></summary>
              {notices.map((n) => (
                <span key={n.code} className="pf-mc-note" data-testid="asset-notice" data-code={n.code}>
                  {n.code === 'converted' ? `${t('notice.converted')}: ${n.reasons.map((r) => t(`notice.reason.${r}` as Key)).join(', ')}`
                    : n.code === 'picture-starts-late' ? `${t('notice.pictureLate')} (${n.frames})`
                    : n.code === 'sound-offset' ? `${n.seconds > 0 ? t('notice.soundLate') : t('notice.soundEarly')} (${Math.abs(n.seconds).toFixed(2)}s)`
                    : t('notice.colourUntagged')}
                  {n.code === 'colour-untagged' && (
                    <label className="pf-mc-choice">{t('notice.colourReadAs')}{' '}
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
          <div className="pf-mc-menu" role="menu" aria-label={`${S.cardMore}: ${a.name}`} onKeyDown={(e) => { if (e.key === 'Tab') close(); else onMenuKeyDown(e); }}>
          {a.kind !== 'image' && !isLut && <button type="button" role="menuitem" className="pf-mc-item" data-testid={`view-${a.id}`} onClick={() => { setAt(null); onView(a.id); }}><Eye size={16} strokeWidth={1.75} aria-hidden="true" />{t('source.open')}</button>}
          {(a.kind === 'video' || a.kind === 'image') && <button type="button" role="menuitem" className="pf-mc-item" data-testid={LIFE_TESTIDS.captureEdit} onClick={() => { setAt(null); setDating(true); }}>{LIFE_STRINGS[state.lang].captureMenu}</button>}
          <div role="separator" className="pf-mc-sep" />
          <button type="button" role="menuitem" className="pf-mc-item is-danger" disabled={isUsed} aria-disabled={isUsed || undefined} aria-describedby={isUsed ? `why-${a.id}` : undefined} title={isUsed ? (isLut ? M.lutRemoveUsed : t('media.remove.used')) : undefined} data-testid={`remove-${a.id}`}
            onClick={() => { close(); void editor.commit([{ op: 'remove_asset', args: { assetId: a.id } }], 'Remove file'); }}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />{S.cardRemove}</button>
          </div>
          {isUsed && <p className="pf-mc-why" id={`why-${a.id}`}>{isLut ? M.lutRemoveUsed : t('media.remove.used')}</p>}
        </div>, document.body)}
      {dating && <CaptureEditor assetId={a.id} onClose={() => { setDating(false); btn.current?.focus(); }} />}
    </>
  );
}

export function MediaGrid({ onView, query = '', filter = 'all', only }: { onView: (id: string) => void; query?: string; filter?: MediaFilter; only?: readonly string[] }) {
  const { editor, state, t } = useEditorState();
  const { doc, derivativeTick } = state;
  const S = MEDIA_STRINGS[state.lang];
  const C = CHROME_STRINGS[state.lang];
  if (!doc) return null;
  const picked = usePicks(); // the multicam selection (ADR-0020)
  const used = usedAssets(doc);
  const missingFiles = state.missingMedia; // stored files missing on disk: said on the card with the timeline's own words (clipMissing)
  const all = Object.values(doc.assets);
  if (all.length === 0) return null; // the drawer shows the drop zone (Library.tsx)
  const assets = only ? only.flatMap((id) => (Object.hasOwn(doc.assets, id) ? [doc.assets[id]!] : [])) : filterAssets(doc, query, filter); // `only`: the files of one group of the life-line views, in the order given
  if (assets.length === 0) return <p className="pf-mc-none" role="status" data-testid="media-nomatch">{C.noMatch(query.trim() || C.filters)}</p>;
  return (
    <ul className="assets media-grid pf-mc-grid" aria-label={S.grid}>
      {assets.map((a) => {
        // A colour table (LUT) is not timeline material: it is applied to clips as an effect, and counts as used while an effect names it.
        const isLut = a.kind === 'lut';
        const isUsed = isLut ? lutUsers(doc, a.id).length > 0 : used.has(a.id);
        const isMissing = missingFiles.includes(a.id);
        const usedLabel = isLut ? S.lutInUse : S.inUse;
        const KindIcon = isLut ? Palette : a.kind === 'image' ? ImageIcon : a.kind === 'video' ? Film : AudioLines;
        const add = () => void editor.addAsset(a.id);
        const an = doc.analyses[a.id];
        const bpm = an?.beats?.bpm ? Math.round(an.beats.bpm) : null;
        const shots = an?.scenes ? an.scenes.cuts.length + 1 : null;
        const lang = doc.transcripts[a.id]?.language.split('-')[0]?.toUpperCase() ?? null;
        return (
          <li key={a.id} className={`media-card pf-mc${isMissing ? ' is-missing' : ''}`} draggable={!isLut} data-testid={`asset-${a.id}`} data-kind={a.kind} data-missing={isMissing || undefined} title={isLut ? S.lutHint : t('media.dragHint')}
            onDragStart={isLut ? undefined : (e) => { e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
            <div className="mc-thumb pf-mc-thumb" onDoubleClick={isLut ? undefined : add}>
              <Thumb projectId={doc.id} a={a} refreshKey={derivativeTick} missing={isMissing} />
              {isMissing && <span className="pf-mc-missing" data-testid={`missing-${a.id}`}><TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />{TL_STRINGS[state.lang].clipMissing}</span>}
              {(a.kind === 'video' || a.kind === 'audio') && <input type="checkbox" className="mc-pick" checked={picked.includes(a.id)} onChange={() => togglePick(a.id)} aria-label={MULTICAM_STRINGS[state.lang].libSelect(a.name)} data-testid={`pick-${a.id}`} />}
              <span className="pf-mc-badge pf-mc-fmt num"><bdi dir="ltr">{isLut ? 'CUBE' : formatOf(a)}</bdi></span>
              <span className="pf-mc-badge pf-mc-dur num"><bdi dir="ltr" className="pf-mc-durIn">
                <KindIcon size={11} aria-hidden="true" />{isLut ? <span data-testid={`lut-size-${a.id}`} title={`${S.lut}: ${S.lutSize}`}>{a.lut ? `${a.lut.size}³` : 'LUT'}</span> : a.kind === 'image' ? `${a.image?.width}×${a.image?.height}` : fmtDur(T.toSeconds(a.duration))}
              </bdi></span>
              {isUsed && <span className="pf-mc-used" title={usedLabel} role="img" aria-label={usedLabel} data-testid={`used-${a.id}`}><Check size={12} strokeWidth={2.5} aria-hidden="true" /></span>}
              <span className="pf-mc-hover">
                {!isLut && <button type="button" className="pf-mc-add" onClick={add} data-testid={`add-${a.id}`} aria-label={`${t('media.add')}: ${a.name}`} title={C.cardAdd}><Plus size={18} strokeWidth={2} aria-hidden="true" /></button>}
                <CardMenu a={a} doc={doc} isLut={isLut} isUsed={isUsed} onView={onView} />
              </span>
            </div>
            <span className="pf-mc-name"><span className="asset-name" dir="auto" title={a.name}>{stem(assetDisplayName(a, state.lang) ?? a.name)}</span>
              <InlineRename value={a.name} label={`${t('media.rename')}: ${a.name}`} testid={`rename-${a.id}`} className="pf-mc-rename" onCommit={(name) => void editor.commit([{ op: 'rename_asset', args: { assetId: a.id, name } }], 'Rename file')} /></span>
            <DateBadge assetId={a.id} />
            {(bpm || shots || lang) && (
              <span className="pf-mc-glyphs">
                {bpm && <span title={C.badgeBeat}><bdi className="num">{bpm}</bdi> {C.bpmWord}</span>}
                {shots && shots > 1 && <span title={C.badgeShots}><bdi className="num">{shots}</bdi> {C.shotsWord}</span>}
                {lang && <span title={C.badgeVoice}><bdi className="num">{lang}</bdi></span>}
              </span>
            )}
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
