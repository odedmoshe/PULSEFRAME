/**
 * The Pulse Strip (docs/design/UX_REDESIGN.md §4.7): the top row of the timeline. It shows TIME as the music counts it:
 * numbered bar starts and the beats between them, as the beat analysis found them on the timeline. Nothing is invented:
 * without an analysis the strip says so and offers to run one; song sections are not shown (no analysis of them exists).
 * A press on the strip moves the playhead to the bar (or, without bars, the beat) under the pointer.
 *
 * It is drawn once per analysis and zoom (memo): playback never re-renders it. The beat under the playhead is a separate
 * small element moved by the playhead (Timeline.tsx), animated in CSS only.
 * The strip keeps the timeline's marker test ids: timeline-markers (the strip), beat-marker (data-frame, data-bar) and
 * scene-marker (cuts found in the footage, drawn as quiet notches on the strip's lower edge).
 */
import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { Metronome } from 'lucide-react';
import type { Lang } from '@pulseframe/i18n';
import { barLabelEvery, lastAtOrBefore } from './interactions.math.ts';
import { TL_STRINGS } from './timeline.strings.ts';

export interface PulseBeat { /** seconds on the timeline */ s: number; frame: number; bar: boolean; /** bar number (1-based) when this beat starts a bar */ n: number | null }
export interface PulseModel { beats: PulseBeat[]; scenes: { s: number; frame: number }[]; truncated: boolean; /** median seconds between two beats; null with fewer than two beats */ beatSeconds: number | null; /** median seconds between two bar starts */ barSeconds: number | null }

export const PulseStrip = memo(function PulseStrip({ model, pps, lang, onSeekFrame, truncatedTitle }: { model: PulseModel; pps: number; lang: Lang; onSeekFrame: (frame: number) => void; truncatedTitle: string }) {
  const s = TL_STRINGS[lang];
  const { beats, scenes } = model;
  const pxPerBeat = model.beatSeconds ? model.beatSeconds * pps : 0;
  const every = model.barSeconds ? barLabelEvery(model.barSeconds * pps) : 1;
  // beat ticks thin out as the zoom shrinks: all of them, every other one between bars, or bar starts only
  const density = pxPerBeat >= 9 ? 'all' : pxPerBeat >= 4.5 ? 'half' : 'bars';
  const seek = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !beats.length) return;
    const at = (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps;
    const bars = beats.filter((b) => b.bar);
    const list = bars.length ? bars : beats;
    const i = lastAtOrBefore(list.map((b) => b.s), at);
    onSeekFrame(list[Math.max(0, i)]!.frame);
  };
  let sinceBar = 0;
  return (
    <div className="pulse-strip tl-markers" data-testid="timeline-markers" data-density={density} data-empty={beats.length ? undefined : 'true'} data-truncated={model.truncated ? 'true' : undefined}
      title={model.truncated ? truncatedTitle : undefined} onPointerDown={seek}>
      {beats.map((b, i) => {
        sinceBar = b.bar ? 0 : sinceBar + 1;
        const label = b.n !== null && (b.n - 1) % every === 0;
        return (
          <i key={`b${i}`} className={`beat-marker${b.bar ? ' bar' : ''}${!b.bar && sinceBar % 2 === 1 ? ' odd' : ''}`} data-testid="beat-marker" data-bar={b.bar ? 'true' : undefined} data-frame={b.frame} style={{ left: b.s * pps }} aria-hidden="true">
            {label && <b className="num">{b.n}</b>}
          </i>
        );
      })}
      {scenes.map((c, i) => <i key={`s${i}`} className="scene-marker" data-testid="scene-marker" data-frame={c.frame} style={{ left: c.s * pps }} title={s.sceneCut} aria-hidden="true" />)}
    </div>
  );
});

/**
 * The start of the strip's row, in the track-header column: the measured tempo, or, while the beat has not been analysed,
 * the action that analyses it. The tempo is the analysis's own estimate; it is never guessed here.
 */
export function TempoHead({ lang, bpm, hasBeats, canAnalyse, analysing, onAnalyse }: { lang: Lang; bpm: number | null; hasBeats: boolean; canAnalyse: boolean; analysing: boolean; onAnalyse: () => void }) {
  const s = TL_STRINGS[lang];
  if (hasBeats) {
    return (
      <span className="tempo" data-testid="tl-tempo" dir={lang === 'he' ? 'rtl' : 'ltr'}>
        <Metronome size={13} strokeWidth={1.75} aria-hidden="true" />
        <span>{s.tempo}</span>
        {bpm !== null && <bdi className="num" data-testid="tl-bpm">{Math.round(bpm)}</bdi>}
      </span>
    );
  }
  return (
    <button type="button" className="tempo tempo-run" data-testid="tl-analyse-beats" dir={lang === 'he' ? 'rtl' : 'ltr'} disabled={!canAnalyse || analysing} title={canAnalyse ? s.noBeats : s.noMusic} onClick={onAnalyse}>
      <Metronome size={13} strokeWidth={1.75} aria-hidden="true" />
      <span>{analysing ? s.analysingBeats : s.analyseBeats}</span>
    </button>
  );
}
