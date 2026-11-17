/**
 * Before/after compare of an AI tool's result (ADR-0017). The control is a native range input: the arrows move 1 %, Shift with an
 * arrow 10 % (compareStep), Home and End go to the ends. Pictures and video frames are a wipe (no animation, so reduced motion is
 * respected by construction; CSS also drops transitions); a video shows the frame under the playhead in both files. Sound is a mix:
 * the slider sets how much of the result is heard, the rest is the original, played together on demand (never automatically).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { compareStep } from './aiTools.recheck.ts';
import type { AI_STRINGS } from './aiTools.strings.ts';

type S = (typeof AI_STRINGS)['he' | 'en'];
export interface CompareProps {
  kind: 'image' | 'video' | 'audio';
  before: string;
  after: string;
  /** Seconds into each file to show (video) or start from (sound): the playhead's place in the original and in the result. */
  times?: { before: number; after: number } | null;
  /** The project frame under the playhead, shown with a video compare. */
  frame?: number | null;
  S: S;
  rtl: boolean;
}

export function AiCompare({ kind, before, after, times, frame, S, rtl }: CompareProps) {
  const [value, setValue] = useState(50);
  const [playing, setPlaying] = useState(false);
  const id = useId();
  const bRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const aRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  // video: both files at the playhead's moment; sound: the mix follows the slider
  useEffect(() => {
    if (kind !== 'video') return;
    const set = (el: HTMLVideoElement | null, t: number) => { if (el && Number.isFinite(t)) { try { el.currentTime = t; } catch { /* not seekable yet; loadedmetadata sets it */ } } };
    set(bRef.current, times?.before ?? 0);
    set(aRef.current, times?.after ?? 0);
  }, [kind, times?.before, times?.after, before, after]);
  useEffect(() => {
    if (kind !== 'audio') return;
    if (bRef.current) bRef.current.volume = (100 - value) / 100;
    if (aRef.current) aRef.current.volume = value / 100;
  }, [kind, value]);
  useEffect(() => () => { bRef.current?.pause(); aRef.current?.pause(); }, []);
  const toggle = async () => {
    const b = bRef.current, a = aRef.current;
    if (!b || !a) return;
    if (playing) { b.pause(); a.pause(); setPlaying(false); return; }
    b.currentTime = times?.before ?? 0;
    a.currentTime = times?.after ?? 0;
    try { await Promise.all([b.play(), a.play()]); setPlaying(true); } catch { setPlaying(false); }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = compareStep(e.key, e.shiftKey, value, rtl);
    if (next === null) return;
    e.preventDefault();
    setValue(next);
  };
  // the result covers the inline-start part of the picture: clip the rest away (logical, so it follows the reading direction)
  const cut = `${100 - value}%`;
  const clip = rtl ? `inset(0 0 0 ${cut})` : `inset(0 ${cut} 0 0)`;
  return (
    <div className="pf-ai-compare" data-testid="ai-compare" data-kind={kind} data-value={value} role="group" aria-labelledby={`${id}-label`}>
      <p className="muted" id={`${id}-label`}>{S.compareLabel}</p>
      {kind === 'audio' ? (
        <div className="pf-ai-row">
          <audio ref={bRef} src={before} preload="metadata" onEnded={() => setPlaying(false)} />
          <audio ref={aRef} src={after} preload="metadata" onEnded={() => setPlaying(false)} />
          <button type="button" className="ghost" onClick={() => void toggle()} aria-pressed={playing} data-testid="ai-compare-play">{playing ? S.compareStop : S.comparePlay}</button>
        </div>
      ) : (
        <div className="pf-ai-wipe" data-testid="ai-compare-view">
          {kind === 'image' ? (
            <>
              <img src={before} alt={S.compareBefore} />
              <img src={after} alt={S.compareAfter} className="pf-ai-wipe-after" style={{ clipPath: clip }} />
            </>
          ) : (
            <>
              <video ref={bRef} src={before} muted preload="auto" playsInline aria-label={S.compareBefore} onLoadedMetadata={(e) => { e.currentTarget.currentTime = times?.before ?? 0; }} />
              <video ref={aRef} src={after} muted preload="auto" playsInline aria-label={S.compareAfter} className="pf-ai-wipe-after" style={{ clipPath: clip }} onLoadedMetadata={(e) => { e.currentTarget.currentTime = times?.after ?? 0; }} />
            </>
          )}
          <span className="pf-ai-wipe-tag pf-ai-wipe-tag-after" aria-hidden="true">{S.compareAfter}</span>
          <span className="pf-ai-wipe-tag pf-ai-wipe-tag-before" aria-hidden="true">{S.compareBefore}</span>
        </div>
      )}
      {kind === 'video' && <p className="muted" data-testid="ai-compare-frame">{frame !== null && frame !== undefined && times ? S.compareFrame(frame) : S.compareNoFrame}</p>}
      <label className="pf-ai-compare-slider">
        <span>{kind === 'audio' ? S.compareMix : S.compareAfter}</span>
        <input type="range" min={0} max={100} step={1} value={value} onChange={(e) => setValue(Number(e.target.value))} onKeyDown={onKey}
          aria-valuetext={S.compareValue(value)} data-testid="ai-compare-slider" aria-describedby={`${id}-hint`} />
      </label>
      <p className="muted" id={`${id}-hint`}>{S.compareHint} <bdi data-testid="ai-compare-value">{S.compareValue(value)}</bdi></p>
    </div>
  );
}
