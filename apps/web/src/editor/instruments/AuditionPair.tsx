/**
 * «השוואה עיוורת» (wave 7 instruments track; builder W3): the synthesised and the recorded version of the same request, two unlabelled
 * players «א» and «ב» in an order drawn from the request (auditionBit: looks arbitrary, is the same for the same request), each at the
 * level the server's x-pf-level-scale header says (audio.volume; no sample is scaled), and «מה היה מה?» only after both were played.
 * Nothing is stored: closing the pair forgets it. Refused in words, never played, when the server sends no level scale or answers with
 * the other version.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '../../ds/index.ts';
import { INSTRUMENTS_TESTIDS as ID } from './instruments.testids.ts';
import { auditionPair, instrumentsPreviewUrl, parseLevelScale, refusalWords, type Sound } from './instruments.logic.ts';
import { instrumentsT } from './instruments.strings.ts';

interface Version { el: HTMLAudioElement; url: string }
type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; text: string };
const SLOT = ['a', 'b'] as const;
type Slot = (typeof SLOT)[number];

export function AuditionPair({ styleId, lang, bars, seed, onPlay }: { styleId: string; lang: 'he' | 'en'; bars: number; seed: number; onPlay?: () => void }): ReactElement {
  const t = instrumentsT(lang);
  const order = auditionPair(styleId, bars, seed);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [playing, setPlaying] = useState<Slot | null>(null);
  const [heardSlots, setHeardSlots] = useState<Record<Slot, boolean>>({ a: false, b: false });
  const [revealed, setRevealed] = useState(false);
  const versions = useRef<Partial<Record<Slot, Version>>>({});

  const release = () => {
    for (const v of Object.values(versions.current)) { v.el.pause(); v.el.removeAttribute('src'); URL.revokeObjectURL(v.url); }
    versions.current = {};
  };
  useEffect(() => {
    const ac = new AbortController();
    setPhase({ kind: 'loading' }); setPlaying(null); setHeardSlots({ a: false, b: false }); setRevealed(false);
    (async () => {
      const got: Partial<Record<Slot, { blob: Blob; scale: number }>> = {};
      for (const slot of SLOT) {
        const want: Sound = order[slot];
        const r = await fetch(instrumentsPreviewUrl(styleId, bars, seed, want, true), { credentials: 'same-origin', signal: ac.signal });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: { message?: string; hint?: string } } | null;
          throw new Error(refusalWords(lang, { message: body?.error?.message ?? `HTTP ${r.status}`, ...(body?.error?.hint ? { hint: body.error.hint } : {}) }));
        }
        if (r.headers.get('x-pf-instruments') !== want) throw new Error(t('auditionWrongVersion'));
        const scale = parseLevelScale(r.headers.get('x-pf-level-scale'));
        if (scale === null) throw new Error(t('auditionNoLevel'));
        got[slot] = { blob: await r.blob(), scale };
      }
      if (ac.signal.aborted) return;
      for (const slot of SLOT) {
        const g = got[slot]!;
        const url = URL.createObjectURL(g.blob);
        const el = new Audio(url);
        el.volume = g.scale;
        el.onended = () => setPlaying((p) => (p === slot ? null : p));
        versions.current[slot] = { el, url };
      }
      setPhase({ kind: 'ready' });
    })().catch((e) => { if (!ac.signal.aborted) setPhase({ kind: 'failed', text: `${t('auditionFailed')}: ${e instanceof Error ? e.message : String(e)}` }); });
    return () => { ac.abort(); release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleId, bars, seed, lang]);

  const toggle = async (slot: Slot) => {
    const v = versions.current[slot];
    if (!v) return;
    if (playing === slot) { v.el.pause(); setPlaying(null); return; }
    onPlay?.();
    for (const o of Object.values(versions.current)) o.el.pause();
    v.el.currentTime = 0;
    try { await v.el.play(); setPlaying(slot); setHeardSlots((h) => ({ ...h, [slot]: true })); }
    catch (e) { setPhase({ kind: 'failed', text: `${t('auditionPlayFailed')}: ${e instanceof Error ? e.message : String(e)}` }); }
  };
  const ready = phase.kind === 'ready';
  const both = heardSlots.a && heardSlots.b;
  const name = (s: Sound) => t(s);
  return (
    <div className="pf-instr-pair" id={`pf-instr-pair-${styleId.replace(/\W/g, '-')}`}>
      <p className="pf-instr-help">{t('auditionHelp')}</p>
      {phase.kind === 'loading' && <p className="pf-instr-line" role="status">{t('auditionLoading')}</p>}
      {phase.kind === 'failed' && <p className="pf-instr-line is-err" role="status" data-part="audition-status">{phase.text}</p>}
      <div className="pf-instr-actions">
        {SLOT.map((slot) => (
          <Button key={slot} size="sm" data-testid={slot === 'a' ? ID.auditionA : ID.auditionB} aria-pressed={playing === slot}
            aria-label={`${playing === slot ? t('auditionStop') : t('auditionPlay')} ${t(slot === 'a' ? 'auditionA' : 'auditionB')}`}
            disabledReason={ready ? undefined : t('auditionLoading')} onClick={() => void toggle(slot)}>{t(slot === 'a' ? 'auditionA' : 'auditionB')}</Button>
        ))}
        <Button size="sm" data-testid={ID.reveal} disabledReason={ready && both ? undefined : ready ? t('revealNeed') : t('auditionLoading')} onClick={() => setRevealed(true)}>{t('reveal')}</Button>
      </div>
      {revealed && <p className="pf-instr-line" role="status" data-part="revealed">{t('revealed', { a: name(order.a), b: name(order.b) })}</p>}
      <p className="pf-instr-help" data-testid={ID.levelNote}>{t('levelNote')}</p>
    </div>
  );
}
