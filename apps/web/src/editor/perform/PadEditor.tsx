/**
 * The pad editor (ADR-0025): what one pad does. A pad is chosen from the built-in moves (core MOVES); a title's text, a sound
 * (with a listen button) and a sticker can be changed. The result replaces that pad of the bank in the browser's preferences;
 * nothing is committed to the project. A title in a take is plain text: it never carries live fields (the op refuses them).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ELEMENTS, MOVES, MoveSpecSchema, type MoveSpec } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { api, type SoundEffectInfo } from '../../api.ts';
import { Button, Dialog } from '../../ds/index.ts';
import { PERFORM_TESTIDS as ID } from './perform.testids.ts';
import { moveLabel } from './PadGrid.tsx';
import { performT } from './perform.strings.ts';

export interface PadEditorProps { open: boolean; pad: number; current: MoveSpec | null; lang: Lang; onSave(m: MoveSpec | null): void; onReset(): void; onClose(): void }

export function PadEditor({ open, pad, current, lang, onSave, onReset, onClose }: PadEditorProps) {
  const S = performT(lang);
  const catalogue = useMemo<readonly MoveSpec[]>(() => { const out = [...MOVES]; if (current && !out.some((m) => m.id === current.id)) out.unshift(current); return out; }, [current]);
  const [pick, setPick] = useState(current?.id ?? '');
  const [text, setText] = useState(current?.kind === 'title' ? current.text : '');
  const [sfx, setSfx] = useState(current?.kind === 'sound' ? current.source.sfxId : '');
  const [element, setElement] = useState(current?.kind === 'sticker' ? current.source.elementId : '');
  const [sounds, setSounds] = useState<SoundEffectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<{ el: HTMLAudioElement; url: string } | null>(null);
  const base = catalogue.find((m) => m.id === pick) ?? null;

  useEffect(() => {
    if (!open) return;
    setPick(current?.id ?? ''); setText(current?.kind === 'title' ? current.text : ''); setSfx(current?.kind === 'sound' ? current.source.sfxId : ''); setElement(current?.kind === 'sticker' ? current.source.elementId : ''); setError(null);
  }, [open, pad, current]);
  useEffect(() => {
    if (!open || sounds || base?.kind !== 'sound') return;
    let live = true;
    api.soundEffects().then((l) => live && setSounds(l)).catch(() => live && setError(S('pv.pe.soundsFail')));
    return () => { live = false; };
  }, [open, base?.kind, sounds, S]);
  const stopListening = () => { const a = audio.current; audio.current = null; if (a) { a.el.pause(); URL.revokeObjectURL(a.url); } setPlaying(false); };
  useEffect(() => stopListening, []);
  useEffect(() => { if (!open) stopListening(); }, [open]);

  const listen = async () => {
    if (!sfx) return;
    stopListening();
    try {
      const blob = await api.soundEffectAudio(sfx);
      const url = URL.createObjectURL(blob), el = new Audio(url);
      audio.current = { el, url }; setPlaying(true);
      el.onended = stopListening;
      await el.play();
    } catch { stopListening(); setError(S('pv.pe.soundsFail')); }
  };
  const build = (): MoveSpec | null => {
    if (!base) return null;
    if (base.kind === 'title') return { ...base, text: text.trim() || base.text };
    if (base.kind === 'sound') return { ...base, source: { sfxId: sfx || base.source.sfxId } };
    if (base.kind === 'sticker') return { ...base, source: { ...base.source, elementId: element || base.source.elementId } };
    return base;
  };
  const save = () => {
    const m = build();
    if (m) { const ok = MoveSpecSchema.safeParse(m); if (!ok.success) { setError(ok.error.issues[0]?.message ?? 'invalid'); return; } }
    onSave(m);
  };
  return (
    <Dialog open={open} onClose={onClose} title={S('pv.pe.title', { n: pad + 1 })} testId={ID.padEditor} size="sm"
      footer={<><Button variant="primary" onClick={save}>{S('pv.pe.save')}</Button><Button variant="ghost" onClick={onReset}>{S('pv.pe.reset')}</Button><Button variant="ghost" onClick={onClose}>{S('pv.pe.cancel')}</Button></>}>
      <div className="pf-perform-form">
        {catalogue.length === 0 && <p role="note">{S('pv.pe.noCatalogue')}</p>}
        <label className="pf-perform-field"><span>{S('pv.pe.move')}</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} data-autofocus>
            <option value="">{S('pv.pe.empty')}</option>
            <optgroup label={S('pv.pe.catalogue')}>{catalogue.map((m) => <option key={m.id} value={m.id}>{moveLabel(m, lang)}</option>)}</optgroup>
          </select>
        </label>
        {base?.kind === 'title' && (
          <label className="pf-perform-field"><span>{S('pv.pe.text')}</span><input type="text" dir="auto" maxLength={80} value={text} placeholder={base.text} onChange={(e) => setText(e.target.value)} /><small>{S('pv.pe.liveFieldsNote')}</small></label>
        )}
        {base?.kind === 'sound' && (
          <div className="pf-perform-field"><label><span>{S('pv.pe.sound')}</span>
            <select value={sfx || base.source.sfxId} onChange={(e) => setSfx(e.target.value)}>
              {(sounds ?? []).map((s) => <option key={s.id} value={s.id}>{s.name[lang]}</option>)}
              {!sounds && <option value={base.source.sfxId}>{base.source.sfxId}</option>}
            </select></label>
            <Button size="sm" variant="secondary" onClick={() => void listen()} disabled={playing}>{playing ? S('pv.pe.listening') : S('pv.pe.listen')}</Button>
          </div>
        )}
        {base?.kind === 'sticker' && (
          <label className="pf-perform-field"><span>{S('pv.pe.sticker')}</span>
            <select value={element || base.source.elementId} onChange={(e) => setElement(e.target.value)}>{ELEMENTS.map((x) => <option key={x.id} value={x.id}>{x.name[lang]}</option>)}</select></label>
        )}
        {error && <p role="alert" className="pf-perform-error">{error}</p>}
      </div>
    </Dialog>
  );
}
