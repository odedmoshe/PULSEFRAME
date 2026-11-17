import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { toSourceSpan, clipEnd, findAudioEffect, sortAudioFx, timelineMarkers, MARKER_COLORS, type Clip, type Marker, type ProjectDocument } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { readSnapBeats, writeSnapBeats } from '../api.ts';
import { ClipVisuals } from '../ClipVisuals.tsx';
import { VolumeLine } from './VolumeLine.tsx';
import { ASSET_DRAG_TYPE, useEditorState } from './store.ts';
import { useTimelineDrag } from './TimelineDrag.tsx';
import { COMMANDS, chordLabel } from './commands.ts';
import { useMarquee } from './TimelineMarquee.tsx';
import { InlineRename } from './InlineRename.tsx';
import { TimelineZoom, useWheelZoom } from './TimelineZoom.tsx';
import { BAR_ICON_COMPONENTS, IconHide, IconLock, IconMute, IconShow, IconSound, IconTarget, IconUnlock } from './icons.tsx';
import { soundTailsFor } from './AudioFxBlock.tsx';
import { findEffect } from '@pulseframe/core';
import './templates.css';
import './timeline.css';

const MAX_MARKERS = 3000;

export const clipLabel = (doc: ProjectDocument, c: Clip) => (c.type === 'media' ? doc.assets[c.assetId]?.name ?? c.assetId : c.type === 'adjustment' ? c.label ?? '' : c.text);

/** Shown while the playhead rests on a user marker: name, colour and removal, each an ordinary committed edit. */
function MarkerBar({ marker }: { marker: Marker }) {
  const { editor, t } = useEditorState();
  const update = (args: Record<string, unknown>) => void editor.commit([{ op: 'update_marker', args: { markerId: marker.id, ...args } }], 'Update marker');
  return (
    <div className="marker-bar" data-testid="marker-bar" role="group" aria-label={t('marker.edit')}>
      <i className={`marker-dot ${marker.color}`} aria-hidden="true" />
      <input key={`${marker.id}:${marker.label}`} type="text" dir="auto" maxLength={200} defaultValue={marker.label} placeholder={t('marker.label')} aria-label={t('marker.label')} data-testid="marker-label"
        onBlur={(e) => { if (e.currentTarget.value !== marker.label) update({ label: e.currentTarget.value }); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <select value={marker.color} aria-label={t('marker.color')} data-testid="marker-color" onChange={(e) => update({ color: e.target.value })}>
        {MARKER_COLORS.map((c) => <option key={c} value={c}>{t(`marker.color.${c}` as Key)}</option>)}
      </select>
      <button className="ghost" data-testid="marker-remove" onClick={() => void editor.commit([{ op: 'remove_marker', args: { markerId: marker.id } }], 'Remove marker')}>{t('marker.remove')}</button>
    </div>
  );
}

/**
 * DOM timeline: every clip is a real button, so the structure is directly accessible (SPEC §3).
 * Time always progresses left-to-right, also in the Hebrew interface.
 */
export function Timeline() {
  const { editor, state, t } = useEditorState();
  const { doc, selection, pxPerSecond: pps, ghosts } = state;
  const ghostSel = new Set(ghosts.flatMap((g) => g.selection));
  const rate = editor.rate;
  const { containerProps, ghost } = useTimelineDrag();
  const { marqueeProps, box } = useMarquee(editor);
  const wheelZoomRef = useWheelZoom();
  const [snapBeats, setSnapBeats] = useState(readSnapBeats);
  // A library file being dragged over the timeline: the frame and track under the pointer.
  const [dropAt, setDropAt] = useState<{ frame: number; trackId: string | null } | null>(null);
  const dropPoint = (e: { clientX: number; target: EventTarget; currentTarget: Element }) => {
    const ruler = e.currentTarget.querySelector('[data-testid=ruler]')!.getBoundingClientRect();
    const frame = Math.max(0, Math.round((((e.clientX - ruler.left) / pps) * rate.num) / rate.den));
    return { frame, trackId: (e.target as Element).closest?.('.track')?.getAttribute('data-track-id') ?? null };
  };
  const markers = useMemo(() => {
    if (!doc) return { scenes: [] as T.RationalTime[], beats: [] as T.RationalTime[], bars: new Set<number>(), truncated: false };
    const m = timelineMarkers(doc);
    const scenes = m.sceneCuts.slice(0, MAX_MARKERS);
    const beats = m.beats.slice(0, MAX_MARKERS - scenes.length);
    return { scenes, beats, bars: new Set(m.downbeats.map((b) => T.nearestFrameIndex(b, rate))), truncated: m.sceneCuts.length + m.beats.length > MAX_MARKERS };
  }, [doc]);
  // Echo and reverb ring on past a clip's end (ADR-0010): the planned tail of each sound clip, from the same audio plan as playback and export.
  const tails = useMemo(() => (doc ? soundTailsFor(doc) : new Map<string, { seconds: number; cut: boolean }>()), [doc]);
  const userMarkers = useMemo(() => (doc ? Object.values(doc.markers ?? {}).filter((m) => m.sequenceId === doc.mainSequenceId).sort((a, b) => T.cmp(a.time, b.time)) : []), [doc]);
  const lastMarkerS = userMarkers.length ? T.toSeconds(userMarkers[userMarkers.length - 1]!.time) : 0;
  const here = userMarkers.find((m) => T.frameIndexAt(m.time, rate) === editor.frame);
  const totalSeconds = Math.max(T.toSeconds(editor.duration) + 2, lastMarkerS + 2, 8);
  const tickEvery = pps >= 60 ? 1 : pps >= 25 ? 2 : 5;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <section className="timeline" dir="ltr" aria-label={t('timeline')}>
      <label className="tl-snap">
        <input type="checkbox" checked={snapBeats} data-testid="snap-beats" onChange={(e) => { setSnapBeats(e.target.checked); writeSnapBeats(e.target.checked); }} />
        {t('snap.beats')}
      </label>
      <TimelineZoom />
      <span className="tl-add-track" role="group" aria-label={t('track.add')}>
        <span className="muted">{t('track.add')}:</span>
        {(['video', 'audio', 'text', 'adjustment'] as const).map((k) => (
          <button key={k} type="button" className="ghost" disabled={!doc} data-testid={`add-track-${k}`} onClick={() => void editor.commit([{ op: 'add_track', args: { kind: k } }], 'Add track')}>{t(`track.${k}` as Key)}</button>
        ))}
      </span>
      <EditBar />
      {menu && <ClipMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {here && <MarkerBar marker={here} />}
      <div className="tl-scroll" ref={wheelZoomRef} {...containerProps}>
        <div className="tl-inner" style={{ width: totalSeconds * pps + 80 }} {...marqueeProps}
          onDragOver={(e) => { if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE) && !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; const at = dropPoint(e); if (!dropAt || dropAt.frame !== at.frame || dropAt.trackId !== at.trackId) setDropAt(at); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(ASSET_DRAG_TYPE), files = [...(e.dataTransfer.files ?? [])], file = files[0];
            if (!id && !file) return;
            e.preventDefault();
            const at = dropPoint(e);
            setDropAt(null);
            // a library file is placed; a file from the computer is imported first and then placed (the first file only)
            if (id) void editor.dropAsset(id, at.frame, at.trackId); else if (file) void editor.importFiles(files, at);
          }}>
          {dropAt && <div className="drop-line" data-testid="drop-line" data-frame={dropAt.frame} style={{ left: T.toSeconds(T.frameTime(dropAt.frame, rate)) * pps }} aria-hidden="true" />}
          {box && <div className="marquee" data-testid="marquee" aria-hidden="true" style={box} />}
          <div className="ruler" data-testid="ruler" onPointerDown={(e) => { const x = e.clientX - e.currentTarget.getBoundingClientRect().left; editor.seek(Math.round(((x / pps) * rate.num) / rate.den)); }}>
            {Array.from({ length: Math.floor(totalSeconds / tickEvery) + 1 }, (_, i) => <span key={i} style={{ left: i * tickEvery * pps }}>{i * tickEvery}s</span>)}
            {userMarkers.map((m) => (
              <button key={m.id} className={`user-marker ${m.color}${here?.id === m.id ? ' current' : ''}`} data-testid="user-marker" data-marker-id={m.id} data-frame={T.frameIndexAt(m.time, rate)} style={{ left: T.toSeconds(m.time) * pps }}
                title={m.label || t('marker.unnamed')} aria-label={`${m.label || t('marker.unnamed')} ${T.toTimecode(m.time, rate)}`}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => editor.seek(T.frameIndexAt(m.time, rate))}>
                {m.label && <bdi>{m.label}</bdi>}
              </button>
            ))}
          </div>
          <div className="tl-markers" data-testid="timeline-markers" data-truncated={markers.truncated ? 'true' : undefined} title={markers.truncated ? t('timeline.markers.truncated') : undefined} aria-hidden="true">
            {markers.beats.map((b, i) => {
              const fr = T.nearestFrameIndex(b, rate);
              return <i key={`b${i}`} className={`beat-marker${markers.bars.has(fr) ? ' bar' : ''}`} data-testid="beat-marker" data-bar={markers.bars.has(fr) ? 'true' : undefined} data-frame={fr} style={{ left: T.toSeconds(b) * pps }} />;
            })}
            {markers.scenes.map((c, i) => {
              const fr = T.nearestFrameIndex(c, rate);
              return <i key={`s${i}`} className="scene-marker" data-testid="scene-marker" data-frame={fr} style={{ left: T.toSeconds(c) * pps }} />;
            })}
          </div>
          {doc && [...doc.sequences[doc.mainSequenceId]!.tracks].reverse().map((tr) => (
            <div className={`track ${tr.kind}${tr.locked ? ' locked' : ''}${tr.hidden || tr.muted ? ' off' : ''}`} data-locked={tr.locked ? 'true' : undefined} data-off={tr.hidden || tr.muted ? 'true' : undefined} key={tr.id} role="list" aria-label={`${t(`track.${tr.kind}` as Key)} ${tr.name}`} data-track-id={tr.id}>
              <span className="track-head">
                <span className="track-name" dir="auto" title={tr.name}>{tr.kind === 'caption' ? `${t('track.caption')}${tr.caption?.mode === 'transcript' ? ' ✦' : ''}` : tr.kind === 'adjustment' ? <><span className="track-kind">{t('track.adjustment')}</span> <bdi>{tr.name}</bdi></> : tr.name}</span>
                <span className="track-buttons">
                  {tr.kind !== 'caption' && <InlineRename value={tr.name} label={`${t('track.rename')}: ${tr.name}`} testid="track-rename" onCommit={(name) => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, name } }], 'Rename track')} />}
                  {(tr.kind === 'video' || tr.kind === 'audio') && (
                    <button type="button" className="track-btn" aria-pressed={state.targets[tr.kind] === tr.id} disabled={tr.locked} data-testid="track-target" aria-label={`${t('track.target')}: ${tr.name}`} title={t('track.target.help')}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => editor.toggleTarget(tr.kind as 'video' | 'audio', tr.id)}><IconTarget /></button>
                  )}
                  <button type="button" className="track-btn" aria-pressed={tr.locked} data-testid="track-lock" aria-label={`${t(tr.locked ? 'track.unlock' : 'track.lock')}: ${tr.name}`} title={t(tr.locked ? 'track.unlock' : 'track.lock')}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, locked: !tr.locked } }], 'Lock track')}>{tr.locked ? <IconLock /> : <IconUnlock />}</button>
                  {tr.kind === 'audio' ? (
                    <button type="button" className="track-btn" aria-pressed={tr.muted} data-testid="track-mute" aria-label={`${t(tr.muted ? 'track.unmute' : 'track.mute')}: ${tr.name}`} title={t(tr.muted ? 'track.unmute' : 'track.mute')}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, muted: !tr.muted } }], 'Mute track')}>{tr.muted ? <IconMute /> : <IconSound />}</button>
                  ) : (
                    <button type="button" className="track-btn" aria-pressed={tr.hidden} data-testid="track-hide" aria-label={`${t(tr.hidden ? 'track.show' : 'track.hide')}: ${tr.name}`} title={t(tr.hidden ? 'track.show' : 'track.hide')}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, hidden: !tr.hidden } }], 'Hide track')}>{tr.hidden ? <IconHide /> : <IconShow />}</button>
                  )}
                </span>
              </span>
              {ghost && tr.clips.some((c) => c.id === ghost.clipId) && (
                <div className={`clip-ghost${ghost.invalid ? ' invalid' : ''}${ghost.snappedTo ? ' snapped' : ''}`} data-testid="clip-ghost" style={{ left: ghost.leftPx, width: ghost.widthPx }} />
              )}
              {tr.clips.map((c) => {
                const width = Math.max(4, T.toSeconds(c.duration) * pps - 1);
                const asset = c.type === 'media' ? doc.assets[c.assetId] : undefined;
                const volLine = c.type === 'media' && tr.kind === 'audio' && asset?.kind !== 'image' && ((c.volume?.length ?? 0) > 0 || (selection.length === 1 && selection[0] === c.id));
                // sound effects of a sound clip: «∿» on the clip, its names and tail in the clip's accessible name, the tail drawn after the clip
                const fxNames = c.type === 'media' && tr.kind === 'audio' ? sortAudioFx(c.audioFx ?? []).filter((x) => x.enabled).map((x) => findAudioEffect(x.type)?.name[state.lang] ?? x.type) : [];
                const tail = tails.get(c.id);
                // an adjustment clip (ADR-0016) is named by its label, else by the track kind and its effects
                const adjFx = c.type === 'adjustment' ? (c.effects ?? []).filter((x) => x.enabled).map((x) => findEffect(x.type)?.name[state.lang] ?? x.type) : [];
                const label = c.type === 'adjustment' && !c.label ? `${t('track.adjustment')}${adjFx.length ? `: ${adjFx.join(', ')}` : ''}` : clipLabel(doc, c);
                const tailS = tail && tail.seconds >= 0.05 ? tail.seconds : 0;
                const fxLabel = `${fxNames.length ? `; ${t('timeline.fx')}: ${fxNames.join(', ')}` : ''}${tailS ? `; ${t('timeline.fx.tail')} ${tailS.toFixed(1)} ${t('sound.fx.seconds')}` : ''}`;
                return (
                  <Fragment key={c.id}>
                  <button role="listitem" className={`clip ${c.type === 'caption' ? 'caption-cue' : ''}${c.type === 'adjustment' ? ' adjust-clip' : ''} ${selection.includes(c.id) ? 'selected' : ''} ${ghostSel.has(c.id) ? 'ghost-selected' : ''}${state.cutPending.includes(c.id) ? ' cut-pending' : ''}`} data-testid={`clip-${c.id}`} data-clip-id={c.id} data-freeze={c.type === 'media' && c.freeze ? 'true' : undefined} data-reverse={c.type === 'media' && c.reverse ? 'true' : undefined} data-ramp={c.type === 'media' && c.speedEnd ? 'true' : undefined} data-clip-type={c.type} data-track-kind={tr.kind}
                    style={{ left: T.toSeconds(c.start) * pps, width }} onClick={(e) => editor.select(c.id, e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace')} aria-pressed={selection.includes(c.id)}
                    onContextMenu={(e) => { e.preventDefault(); if (!selection.includes(c.id)) editor.select(c.id); setMenu({ x: e.clientX, y: e.clientY }); }}
                    aria-label={`${label} ${T.toTimecode(c.start, rate)}–${T.toTimecode(clipEnd(c), rate)}${fxLabel}`} data-fx={fxNames.length ? 'true' : undefined}>
                    {asset && asset.kind !== 'image' && (tr.kind === 'video' || tr.kind === 'audio') && (
                      <ClipVisuals projectId={doc.id} asset={asset} kind={tr.kind} sourceIn={(c as Extract<Clip, { type: 'media' }>).sourceIn} duration={c.type === 'media' && c.freeze ? T.frameTime(1, rate) : toSourceSpan(c, c.duration) /* the stretch of SOURCE shown, so thumbnails and waveform follow the clip speed; a freeze frame shows one picture */} widthPx={width} heightPx={34} reverse={c.type === 'media' && !!c.reverse} />
                    )}
                    <span dir="auto" className="clip-label">{c.type === 'media' && c.freeze ? '❄ ' : ''}{c.type === 'media' && c.reverse ? '◀ ' : ''}{c.type === 'media' && c.speedEnd ? '⤴ ' : ''}{fxNames.length ? <span className="clip-fx-badge" aria-hidden="true" data-testid="clip-fx-badge">∿ </span> : ''}{c.type === 'adjustment' ? <span className="adjust-badge" aria-hidden="true">◐ </span> : ''}{label}</span>
                    {c.keyframes && [...new Set(Object.values(c.keyframes).flatMap((ks) => (ks ?? []).map((k) => T.toSeconds(k.time))))].filter((s) => s >= 0 && s <= T.toSeconds(c.duration)).map((s) => (
                      <i key={s} className="kf" style={{ left: s * pps }} aria-hidden="true" />
                    ))}
                  </button>
                  {volLine && <VolumeLine clip={c as Extract<Clip, { type: 'media' }>} selected={selection.length === 1 && selection[0] === c.id} editable={!tr.locked} pps={pps} left={T.toSeconds(c.start) * pps} width={width} />}
                  {tailS > 0 && <div className="clip-tail" aria-hidden="true" data-testid="clip-tail" data-tail-of={c.id} data-cut={tail!.cut ? 'true' : undefined} style={{ left: T.toSeconds(clipEnd(c)) * pps, width: Math.max(2, tailS * pps) }} />}
                  </Fragment>
                );
              })}
            </div>
          ))}
          {/* Other participants: a labelled marker only. It never moves this user's playhead. */}
          {ghosts.filter((g) => g.frame !== null).map((g) => (
            <div key={`${g.actor}:${g.sessionId}`} className={`ghost-playhead ${g.kind}`} data-testid="ghost-playhead" data-actor={g.actor} data-frame={g.frame} style={{ left: T.toSeconds(T.frameTime(g.frame!, rate)) * pps }}>
              <span>{g.kind === 'agent' ? t('actor.agent') : g.actor}{g.label ? ` · ${g.label}` : ''}</span>
            </div>
          ))}
          <div className="playhead" style={{ left: T.toSeconds(editor.playhead) * pps }} />
        </div>
      </div>
    </section>
  );
}

/** The everyday clip actions, always in view above the tracks: each is the same command the keyboard runs, with its key shown. */
const BAR_COMMANDS = ['edit.split', 'edit.delete', 'edit.duplicate', 'edit.copy', 'edit.paste'] as const;
function EditBar() {
  const { editor, state, t } = useEditorState();
  void state.selection; void state.tick; // re-render when the selection or the playhead changes: the buttons' availability depends on both
  return (
    <span className="tl-edit" role="toolbar" aria-label={t('timeline.actions')} data-testid="timeline-actions">
      {BAR_COMMANDS.map((id) => {
        const c = COMMANDS.find((x) => x.id === id)!;
        const on = !!state.doc && (!c.enabled || c.enabled(editor));
        return (
          <button key={id} type="button" className={`ghost${id === 'edit.delete' ? ' danger' : ''}`} disabled={!on} data-testid={`bar-${id.slice(5)}`}
            title={`${t(c.label as Key)}${c.keys[0] ? ` (${chordLabel(c.keys[0])})` : ''}`} onClick={() => void c.run(editor)}>
            {(() => { const I = BAR_ICON_COMPONENTS[id]; return I ? <I /> : null; })()}{t(`bar.${id.slice(5)}` as Key)}
          </button>
        );
      })}
      {!state.selection.length && <span className="muted tl-edit-hint">{t('timeline.actions.hint')}</span>}
    </span>
  );
}
/** Right-click menu of a clip: the same commands, where the pointer is. Escape or a click elsewhere closes it. */
function ClipMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { editor, t } = useEditorState();
  const items = ['edit.split', 'edit.duplicate', 'edit.copy', 'edit.cut', 'edit.delete'];
  const box = useRef<HTMLDivElement>(null);
  // the keyboard focus goes to the first action that can be used (the first one may be unavailable)
  useEffect(() => { box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, []);
  return (
    <>
      <div className="clip-menu-veil" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={box} className="clip-menu" role="menu" aria-label={t('timeline.actions')} data-testid="clip-menu" dir={editor.getState().lang === 'he' ? 'rtl' : 'ltr'} style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 230) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          all[(all.indexOf(document.activeElement as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
        }}>
        {items.map((id) => {
          const c = COMMANDS.find((k) => k.id === id)!;
          return (
            <button key={id} type="button" role="menuitem" className={id === 'edit.delete' ? 'danger' : ''} disabled={!!c.enabled && !c.enabled(editor)} data-testid={`menu-${id.slice(5)}`}
              onClick={() => { onClose(); void c.run(editor); }}>
              {(() => { const I = BAR_ICON_COMPONENTS[id]; return I ? <I /> : null; })()}<span>{t(`bar.${id.slice(5)}` as Key)}</span>{c.keys[0] && <kbd>{chordLabel(c.keys[0])}</kbd>}
            </button>
          );
        })}
      </div>
    </>
  );
}
