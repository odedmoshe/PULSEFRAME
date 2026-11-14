import * as T from '@pulseframe/time';
import { clipEnd, type Clip, type ProjectDocument } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { ClipVisuals } from '../ClipVisuals.tsx';
import { useEditorState } from './store.ts';
import { useTimelineDrag } from './TimelineDrag.tsx';

export const clipLabel = (doc: ProjectDocument, c: Clip) => (c.type === 'media' ? doc.assets[c.assetId]?.name ?? c.assetId : c.text);

/**
 * DOM timeline: every clip is a real button, so the structure is directly accessible (SPEC §3).
 * Time always progresses left-to-right, also in the Hebrew interface.
 */
export function Timeline() {
  const { editor, state, t } = useEditorState();
  const { doc, selection, pxPerSecond: pps, derivativeTick, ghosts } = state;
  const ghostSel = new Set(ghosts.flatMap((g) => g.selection));
  const rate = editor.rate;
  const { containerProps, ghost } = useTimelineDrag();
  const totalSeconds = Math.max(T.toSeconds(editor.duration) + 2, 8);
  const tickEvery = pps >= 60 ? 1 : pps >= 25 ? 2 : 5;
  return (
    <section className="timeline" dir="ltr" aria-label={t('timeline')}>
      <div className="tl-scroll" {...containerProps}>
        <div className="tl-inner" style={{ width: totalSeconds * pps + 80 }}>
          <div className="ruler" data-testid="ruler" onPointerDown={(e) => { const x = e.clientX - e.currentTarget.getBoundingClientRect().left; editor.seek(Math.round(((x / pps) * rate.num) / rate.den)); }}>
            {Array.from({ length: Math.floor(totalSeconds / tickEvery) + 1 }, (_, i) => <span key={i} style={{ left: i * tickEvery * pps }}>{i * tickEvery}s</span>)}
          </div>
          {doc && [...doc.sequences[doc.mainSequenceId]!.tracks].reverse().map((tr) => (
            <div className={`track ${tr.kind}`} key={tr.id} role="list" aria-label={`${t(`track.${tr.kind}` as Key)} ${tr.name}`} data-track-id={tr.id}>
              <span className="track-name">{tr.kind === 'caption' ? `${t('track.caption')}${tr.caption?.mode === 'transcript' ? ' ✦' : ''}` : tr.name}</span>
              {ghost && tr.clips.some((c) => c.id === ghost.clipId) && (
                <div className={`clip-ghost${ghost.invalid ? ' invalid' : ''}${ghost.snappedTo ? ' snapped' : ''}`} data-testid="clip-ghost" style={{ left: ghost.leftPx, width: ghost.widthPx }} />
              )}
              {tr.clips.map((c) => {
                const width = Math.max(4, T.toSeconds(c.duration) * pps - 1);
                const asset = c.type === 'media' ? doc.assets[c.assetId] : undefined;
                return (
                  <button key={c.id} role="listitem" className={`clip ${c.type === 'caption' ? 'caption-cue' : ''} ${selection.includes(c.id) ? 'selected' : ''} ${ghostSel.has(c.id) ? 'ghost-selected' : ''}`} data-testid={`clip-${c.id}`} data-clip-id={c.id} data-clip-type={c.type} data-track-kind={tr.kind}
                    style={{ left: T.toSeconds(c.start) * pps, width }} onClick={() => editor.select(c.id)} aria-pressed={selection.includes(c.id)}
                    aria-label={`${clipLabel(doc, c)} ${T.toTimecode(c.start, rate)}–${T.toTimecode(clipEnd(c), rate)}`}>
                    {asset && asset.kind !== 'image' && (tr.kind === 'video' || tr.kind === 'audio') && (
                      <ClipVisuals projectId={doc.id} asset={asset} kind={tr.kind} sourceIn={(c as Extract<Clip, { type: 'media' }>).sourceIn} duration={c.duration} widthPx={width} heightPx={34} refreshKey={derivativeTick} />
                    )}
                    <span dir="auto" className="clip-label">{clipLabel(doc, c)}</span>
                    {c.keyframes && [...new Set(Object.values(c.keyframes).flatMap((ks) => (ks ?? []).map((k) => T.toSeconds(k.time))))].filter((s) => s >= 0 && s <= T.toSeconds(c.duration)).map((s) => (
                      <i key={s} className="kf" style={{ left: s * pps }} aria-hidden="true" />
                    ))}
                  </button>
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
