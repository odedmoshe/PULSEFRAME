/**
 * The stage around the viewer (UX_REDESIGN §4.5). App.tsx mounts this component after the viewer (and the stage header,
 * StageHeader.tsx, before it, so the DOM and tab order match the picture); it renders what lies over the viewer (the cut loupe, the note of a moved
 * playhead, the hint of an edit with no clips yet), the scopes docked beside the viewer in Look mode at wide windows, and the
 * transport bar: timecode, steps, play, loop, the beat under the playhead, full screen. The transport runs left to right in
 * every language.
 */
import { useEffect, useState } from 'react';
import { SkipBack, SkipForward } from 'lucide-react';
import * as T from '@pulseframe/time';
import { beatPositionAt } from '@pulseframe/core';
import { meterOf } from './analysis.logic.ts';
import { COMMANDS } from './commands.ts';
import { useEditorState, type Editor } from './store.ts';
import { IconLoop, IconNextFrame, IconPause, IconPlay, IconPrevFrame } from './icons.tsx';
import { Scopes } from './Scopes.tsx';
import { CutLoupe } from './CutLoupe.tsx';
import { MulticamPanel } from './MulticamPanel.tsx';
import { PerformView } from './perform/PerformView.tsx';
import { playControl } from './playControl.ts';
import { STAGE_STRINGS } from './stage.strings.ts';
import { TimecodeButton } from './craft/TimecodeButton.tsx';
import './stage.css';

const run = (editor: Editor, id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(editor)) void c.run(editor); };

/** True at the widths where the scopes dock beside the viewer in Look mode (UX_REDESIGN §4.9); below it they stand in the inspector. */
export function useWideStage(): boolean {
  const q = '(min-width: 1800px)';
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q), on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** The beat under the playhead as bar.beat ("4.1"), from the analysed music there; null where no analysed music plays. */
function beatNow(editor: Editor): { bar: number; beat: number; index: number } | null {
  const doc = editor.doc;
  const pos = doc ? beatPositionAt(doc, editor.playhead) : null;
  if (!doc || !pos || pos.beat < 0) return null;
  let meter = 4;
  for (const tr of doc.sequences[doc.mainSequenceId]?.tracks ?? []) for (const c of tr.clips) if (c.id === pos.clipId && c.type === 'media') meter = meterOf(doc, c.assetId) ?? 4; // by the lineage beatPositionAt followed
  const since = Math.max(0, Math.floor(pos.sinceFirstBar + 1e-6));
  return { bar: Math.floor(since / meter) + 1, beat: (since % meter) + 1, index: since };
}

/** What lies over the viewer: the cut loupe; a quiet note that fades by itself; the hint of an edit that has files but no clips yet. */
function StageOverlay() {
  const { editor, state } = useEditorState();
  const S = STAGE_STRINGS[state.lang];
  const note = state.stageNote;
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => editor.sayOnStage(null), 4200);
    return () => window.clearTimeout(t);
  }, [note?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = state.doc;
  const noClips = !!doc && Object.keys(doc.assets).length > 0 && Object.values(doc.sequences).every((s) => s.tracks.every((t) => t.clips.length === 0));
  return (
    <>
      <CutLoupe />
      <div className="stage-over pf-ds pf-force-dark">
        {noClips && <p className="stage-empty" data-testid="stage-empty"><strong>{S.emptyStage}</strong><span>{S.emptyOr} <b className="num">+</b> {S.emptyKeyHint}</span></p>}
        <p className="stage-note" role="status" data-testid="stage-note" data-on={note ? 'true' : 'false'}>{note?.text ?? ''}</p>
      </div>
    </>
  );
}

export function Transport() {
  const { editor, state, t } = useEditorState();
  const S = STAGE_STRINGS[state.lang];
  const rate = editor.rate;
  const p = editor.player;
  const wide = useWideStage();
  const beat = beatNow(editor);
  // The viewer frame takes the shape of the viewed format: the stage carries it as a property the sheet reads (stage.css).
  const vw = editor.viewDoc?.settings.width, vh = editor.viewDoc?.settings.height;
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.app > .stage');
    if (el && vw && vh) el.style.setProperty('--pf-ar', String(+(vw / vh).toFixed(6)));
  }, [vw, vh]);
  return (
    <>
      <StageOverlay />
      {/* perform mode (ADR-0025): the pads, the take lane and the camera live on the stage while the workspace is perform */}
      {state.workspace === 'perform' && <PerformView />}
      {state.workspace === 'color' && wide && <aside className="stage-side pf-ds pf-insp pf-force-dark" aria-label={S.scopes} data-testid="stage-scopes"><Scopes /></aside>}
      {/* multicam (ADR-0020): the docked angle panel takes the same side slot whenever the scopes do not */}
      {!(state.workspace === 'color' && wide) && <MulticamPanel />}
      <div className="transport pf-ds pf-force-dark" dir="ltr" role="group" aria-label={t('cmd.playPause')}>
        <div className="tp-time">
          <TimecodeButton text={T.toTimecode(editor.playhead, rate)} />
          <span className="tp-total tc" aria-label={`${S.of} ${T.toTimecode(editor.duration, rate)}`}>/ {T.toTimecode(editor.duration, rate)}</span>
        </div>
        <div className="tp-keys">
          <button className="tp-btn tp-outer" onClick={() => run(editor, 'transport.start')} aria-label={S.toStart} title={S.toStart} data-testid="to-start"><SkipBack size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          <button className="tp-btn" onClick={() => run(editor, 'transport.prevFrame')} aria-label={t('frame.prev')} title={t('frame.prev')}><IconPrevFrame /></button>
          <button className="tp-play" onClick={() => run(editor, 'transport.toggle')} aria-label={p?.playing ? t('pause') : t('play')} {...playControl(editor.playerReady || !!p?.playing, S.playNotReady)} data-testid="play" data-playing={p?.playing ? 'true' : 'false'}>{p?.playing ? <IconPause size={20} /> : <IconPlay size={20} />}</button>
          <button className="tp-btn" onClick={() => run(editor, 'transport.nextFrame')} aria-label={t('frame.next')} title={t('frame.next')}><IconNextFrame /></button>
          <button className="tp-btn tp-outer" onClick={() => run(editor, 'transport.end')} aria-label={S.toEnd} title={S.toEnd} data-testid="to-end"><SkipForward size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          <button className="tp-btn tp-outer" onClick={() => run(editor, 'transport.loop')} aria-pressed={!!p?.loop} aria-label={t('cmd.loop')} title={t('cmd.loop')} data-testid="loop"><IconLoop /></button>
          {!!p?.shuttleRate && <span className="shuttle num" role="status" data-testid="shuttle" aria-label={`${t(p.shuttleRate < 0 ? 'cmd.shuttleBack' : 'cmd.shuttleForward')} ×${Math.abs(p.shuttleRate)}`}>{p.shuttleRate < 0 ? '◀◀' : '▶▶'} ×{Math.abs(p.shuttleRate)}</span>}
        </div>
        <div className="tp-end">
          {beat && (
            <span className="tp-beat" data-testid="beat-chip" data-bar={beat.bar} data-beat={beat.beat} title={S.beatChip(beat.bar, beat.beat)}>
              <i key={beat.index} className="tp-beat-dot" data-playing={p?.playing ? 'true' : 'false'} aria-hidden="true" />
              <span className="tp-beat-word" dir={state.lang === 'he' ? 'rtl' : 'ltr'}>{S.bar}</span>
              <span className="num">{beat.bar}.{beat.beat}</span>
              <span className="pf-sr">{S.beatChip(beat.bar, beat.beat)}</span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}
