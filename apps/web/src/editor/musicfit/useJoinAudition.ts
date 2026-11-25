/**
 * «השמעת החיבור»: plays the four bars around a join (GET …/music-fit/join.wav) through one <audio> element; aria-pressed follows it.
 * `played` becomes true once the sound started, which is what «שמעתי — החיבור בסדר» waits for. Nothing autoplays.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JoinRemoval } from '@pulseframe/core';
import type * as T from '@pulseframe/time';
import { musicJoinUrl } from '../../api.ts';

export interface JoinSpec { assetId: string; removal: JoinRemoval; startAt?: T.RationalTime }
export function useJoinAudition(projectId: string) {
  const el = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [failed, setFailed] = useState(false);
  const stop = useCallback(() => { const a = el.current; el.current = null; if (a) { a.pause(); a.removeAttribute('src'); a.load(); } setPlaying(false); }, []);
  useEffect(() => stop, [stop]);
  const toggle = useCallback(async (j: JoinSpec) => {
    if (el.current) { stop(); return; }
    setFailed(false);
    const a = new Audio(musicJoinUrl(projectId, j.assetId, j.removal, j.startAt));
    el.current = a;
    a.onended = () => { if (el.current === a) stop(); };
    a.onerror = () => { if (el.current === a) { stop(); setFailed(true); } };
    setPlaying(true);
    try { await a.play(); setPlayed(true); } catch { if (el.current === a) { stop(); setFailed(true); } }
  }, [projectId, stop]);
  return { playing, played, failed, toggle, stop };
}
