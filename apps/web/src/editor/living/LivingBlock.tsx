/**
 * The «תמונה חיה» block of the object inspector's «תנועה» tab (wave 8 living track). Mounted by InspectorObject.tsx behind
 * LIVING_UI_BUILT for one selected photo clip. data-state: offer | on | not-offered | refused. «הפכו לתמונה חיה» opens DepthDialog with
 * the clip's depth or core LIVING_RAMP_START; «שמירה» commits ONE set_living_picture carrying the depth (one undo). Then the move chips
 * push | slide (a radio group), the amount slider capped at core livingMaxAmount, the depth line, «ציירו עומק» (set_clip_depth) and
 * «הסירו תמונה חיה». The limits are a rule of thumb and the depth is the owner's drawing; nobody has looked at the result: said in the block.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { LIVING_MOVES, LIVING_REFUSALS, type LivingMove, type MediaClip } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import { findClip } from '@pulseframe/core';
import { useEditorState } from '../store.ts';
import { DepthDialog } from './DepthDialog.tsx';
import { LivingComputeState } from './LivingComputeState.tsx';
import { livingT } from './living.strings.ts';
import { LIVING_TESTIDS as ID } from './living.testids.ts';
import { amountFor, applyOp, changeOp, livingView, maxFor, moveAfterKey, removeOp, replacedAny, saveOp, startDepth } from './living.logic.ts';
import './living.css';

/** True when the block and the dialog are built and the a11y states pass (InspectorObject.tsx mounts the section only then). */
export const LIVING_UI_BUILT: boolean = true;

export function LivingBlock({ clip: given }: { clip: MediaClip }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = livingT(lang);
  const doc = state.doc;
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const chips = useRef<Record<string, HTMLButtonElement | null>>({});
  if (!doc) return null;
  const clip = (findClip(doc, given.id)?.clip as MediaClip | undefined) ?? given;
  const view = livingView(doc, clip);
  const locked = !!findClip(doc, clip.id)?.track.locked;
  const gpuOff = state.gpu !== null && !state.gpu.available;
  const state_ = err ? 'refused' : view.kind;

  const words = (): string => editor.getState().error ?? translateRefusal(lang, LIVING_REFUSALS.needsDepth.message()) ?? '';
  /** One commit; a refusal is said in words (the store already put it through translateRefusal). */
  const commit = async (op: ReturnType<typeof applyOp>, label: string): Promise<string | null> => {
    setErr(null);
    const r = await editor.commit([op], label);
    if (!r) { const w = words(); setErr(w); return w; }
    if (op.op === 'set_living_picture') setReplaced(replacedAny(r.results[0]?.output));
    return null;
  };
  const save = async (depth: Parameters<typeof applyOp>[1]) => {
    const w = await commit(saveOp(view, clip.id, depth), view.kind === 'on' ? 'Drew the depth' : 'Living picture');
    if (w === null) setOpen(false);
    return w;
  };
  const pickMove = (m: LivingMove) => {
    if (m === view.move || locked) return;
    void commit(changeOp(clip.id, m, amountFor(view.amount, maxFor(doc, view, m))), 'Living picture');
  };
  const chipKey = (e: KeyboardEvent) => {
    const n = moveAfterKey(e.key, lang, view.move);
    if (n) { e.preventDefault(); chips.current[n]?.focus(); pickMove(n); }
  };
  const release = () => {
    const v = liveRef.current;
    if (v === null) return;
    liveRef.current = null; setLive(null);
    if (v !== view.amount) void commit(changeOp(clip.id, view.move, amountFor(v, view.maxAmount)), 'Living picture');
  };
  const shownAmount = live ?? view.amount;
  const unavailable = view.unavailable;

  return (
    <div className="fields living" data-testid={ID.block} data-state={state_} data-clip-id={clip.id}>
      {view.kind === 'not-offered' ? <p className="muted living-line">{t(view.reason === 'video' ? 'living.notOffered.video' : 'living.notOffered.rotated')}</p> : (
        <>
          {view.kind === 'offer' && (
            <div className="living-row">
              <button type="button" className="primary" data-testid={ID.apply} disabled={locked || view.tooShort || !view.shown} onClick={() => { setErr(null); setOpen(true); }}>{t('living.apply')}</button>
              {view.tooShort && <span className="living-line">{translateRefusal(lang, LIVING_REFUSALS.tooShort.message()) ?? ''}</span>}
            </div>
          )}
          {view.kind === 'on' && (
            <>
              <fieldset className="living-chips" role="radiogroup" aria-label={t('living.moveGroup')}>
                <legend>{t('living.move')}</legend>
                {LIVING_MOVES.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={view.move === m} tabIndex={view.move === m ? 0 : -1} className="ghost living-chip" disabled={locked}
                    data-testid={m === 'push' ? ID.movePush : ID.moveSlide} ref={(el) => { chips.current[m] = el; }} onKeyDown={chipKey} onClick={() => pickMove(m)}>{t(`living.move.${m}`)}</button>
                ))}
              </fieldset>
              <label className="living-amount">
                <span>{t('living.amount')} <bdi dir="ltr" aria-hidden="true">{shownAmount.toFixed(2)}</bdi></span>
                <input type="range" min={0} max={view.maxAmount} step={0.05} value={Math.min(shownAmount, view.maxAmount)} disabled={locked} data-testid={ID.amount} aria-valuetext={t('living.amountValue', { n: shownAmount.toFixed(2) })}
                  onChange={(e) => { liveRef.current = Number(e.target.value); setLive(Number(e.target.value)); }} onPointerUp={release} onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) release(); }} onBlur={release} />
              </label>
              {view.capped && <p className="living-line" data-testid={ID.amountCapped}>{t('living.amountCapped', { max: view.maxAmount.toFixed(2) })}</p>}
              <p className="living-line" data-testid={ID.depthState}>{view.strokes ? t('living.depth.drawn', { n: view.strokes }) : t('living.depth.estimated')}</p>
              <div className="living-row">
                <button type="button" className="ghost" data-testid={ID.depthOpen} disabled={locked || !view.shown} onClick={() => { setErr(null); setOpen(true); }}>{t('living.depth.open')}</button>
                <button type="button" className="ghost danger" data-testid={ID.remove} disabled={locked} onClick={() => { setReplaced(false); void commit(removeOp(clip.id), 'Remove living picture'); }}>{t('living.remove')}</button>
              </div>
              <p className="living-line">{t('living.removeKeepsDepth')}</p>
              {replaced && <p className="living-line" role="status">{t('living.replaced')}</p>}
              {view.refit && <div className="living-row"><button type="button" className="ghost" data-testid={ID.refit} disabled={locked} onClick={() => void commit(changeOp(clip.id, view.move, amountFor(view.amount, view.maxAmount)), 'Living picture')}>{t('living.refit')}</button></div>}
              {unavailable && <p className="living-err" role="status">{t(`living.unavailable.${unavailable}`)}</p>}
            </>
          )}
          <p className="muted living-line" data-testid={ID.drawnNote}>{t('living.drawnNote')}</p>
          <p className="muted living-line">{t('living.unseen')}</p>
          <p className="muted living-line" data-testid={ID.ruleOfThumb}>{t('living.ruleOfThumb')}</p>
          {gpuOff && <p className="muted living-line" data-testid={ID.gpuNote}>{t('living.gpu')}</p>}
          <LivingComputeState assetId={clip.assetId} />
        </>
      )}
      {err && <p className="living-err" role="alert" data-testid="living-refusal"><bdi dir="auto">{t('living.refused')}: {err}</bdi></p>}
      {open && view.shown && (
        <DepthDialog start={startDepth(view)} shown={view.shown} lang={lang} projectId={doc.id} assetId={clip.assetId} onSave={save} onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}
