/**
 * The sound card of «תא הבדיקה» (wave 8 booth, builder W3). Play and stop are ONE button with aria-pressed and a name that says which
 * sound; the state is a polite status line; nothing plays by itself. The bytes come from the booth's own audio route (the product's own
 * generator), are fetched on the first press, and their `x-pf-content-sha256` is handed back as `played` (what this machine was served,
 * not how it sounds). The volume is the booth's own, kept in this browser. An <audio> element is in the page so the sound is a real element.
 */
import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react';
import { Play, Square } from 'lucide-react';
import type { BoothItemView, BoothSay } from '@pulseframe/core';
import { Button, Slider } from '../../ds/index.ts';
import { api } from '../../api.ts';
import { refusalLine, refusalWords } from '../commandBar/describe.ts';
import { BOOTH_TESTIDS as TID } from './booth.testids.ts';
import { playedHash } from './booth.logic.ts';
import type { Lang } from '@pulseframe/i18n';

type Phase = 'idle' | 'loading' | 'playing' | 'stopped' | 'ended' | 'failed';
export interface AudioControl { restart: () => void }
export interface AudioCardProps {
  lang: Lang; say: BoothSay; view: BoothItemView; volume: number; onVolume: (v: number) => void;
  /** the sha256 of the bytes this machine was served, once they are in */ onPlayed: (sha: string) => void;
  /** «שוב» (R): the dialog calls this to play from the start */ control: MutableRefObject<AudioControl | null>;
}

export function AudioCard({ lang, say, view, volume, onVolume, onPlayed, control }: AudioCardProps): ReactElement {
  const [phase, setPhase] = useState<Phase>('idle');
  const [why, setWhy] = useState('');
  const [everPlayed, setEverPlayed] = useState(false);
  const el = useRef<HTMLAudioElement>(null);
  const held = useRef<{ url: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const id = view.item.id;

  useEffect(() => { if (el.current) el.current.volume = volume; }, [volume]);
  useEffect(() => () => {
    abort.current?.abort(); el.current?.pause();
    if (held.current) URL.revokeObjectURL(held.current.url);
    held.current = null;
  }, []);

  const failed = (e: unknown) => {
    const f = e as { code?: string; message?: string; hint?: string };
    setWhy(refusalLine(lang, refusalWords(lang, { code: f.code ?? null, message: f.message ?? (e instanceof Error ? e.message : String(e)), hint: f.hint ?? null })));
    setPhase('failed');
  };
  const play = async (fromStart: boolean) => {
    const a = el.current;
    if (!a) return;
    if (!held.current) {
      setPhase('loading');
      const ac = new AbortController();
      abort.current = ac;
      try {
        const r = await fetch(api.boothAudioUrl(id), { credentials: 'same-origin', signal: ac.signal });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: { code?: string; message?: string; hint?: string } } | null;
          throw Object.assign(new Error(body?.error?.message ?? `HTTP ${r.status}`), { code: body?.error?.code, hint: body?.error?.hint });
        }
        const sha = playedHash(r.headers.get('x-pf-content-sha256'));
        const url = URL.createObjectURL(await r.blob());
        held.current = { url };
        a.src = url;
        if (sha) onPlayed(sha);
      } catch (e) { if (!ac.signal.aborted) failed(e); return; }
    }
    if (fromStart) a.currentTime = 0;
    a.volume = volume;
    try { await a.play(); setPhase('playing'); setEverPlayed(true); } catch (e) { failed(e); }
  };
  const stop = () => { el.current?.pause(); setPhase('stopped'); };
  control.current = { restart: () => { void play(true); } };

  const playing = phase === 'playing';
  const label = `${playing ? say('page.sound.stop') : say('page.sound.play')}: ${view.item.title[lang]}`;
  return (
    <div className="pf-booth-audio">
      {!everPlayed && <p className="pf-booth-note" data-part="volume-first">{say('booth.volumeFirst')}</p>}
      <div className="pf-booth-actions">
        <Button variant="primary" data-testid={TID.play} aria-pressed={playing} aria-label={label} icon={playing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          busy={phase === 'loading'} onClick={() => { if (playing) stop(); else void play(false); }}>{playing ? say('booth.stop') : say('booth.play')}</Button>
        <div className="pf-booth-volume">
          <span className="pf-booth-volume-label">{say('booth.volume')}</span>
          <Slider value={volume} min={0} max={1} step={0.05} label={say('booth.volume')} valueText={say('page.sound.volumeValue', { n: Math.round(volume * 100) })} onChange={onVolume} onCommit={onVolume} />
        </div>
      </div>
      <p className="pf-booth-note" role="status" aria-live="polite" data-part="sound-state" data-phase={phase}>
        {phase === 'idle' ? say('page.sound.idle') : phase === 'loading' ? say('page.sound.loading') : phase === 'playing' ? say('page.sound.playing')
          : phase === 'stopped' ? say('page.sound.stopped') : phase === 'ended' ? say('page.sound.ended') : say('page.sound.failed', { why })}
      </p>
      <p className="pf-booth-note">{say('page.sound.hashNote')}</p>
      <audio ref={el} preload="none" onEnded={() => setPhase('ended')} />
    </div>
  );
}
