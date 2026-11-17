/**
 * The cut inspector (UX_REDESIGN §4.6, the Studio graft): a cut is where one picture clip ends and the next begins. Its tab
 * rolls the cut a frame at a time or to the nearest beat (two trims, one transaction), shows how much spare footage each
 * side has for a transition, and offers a few transitions for this cut; the second tab holds the transition itself.
 */
import { useId, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { beatPositionAt, followedBeats, TRANSITIONS, transitionDef, type Clip } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { Section } from './Section.tsx';
import { EffectGalleryButton } from './EffectGallery.tsx';
import { TransitionControls } from './LookPanel.tsx';
import { IconBeatLock, IconOnBeat } from './icons.tsx';
import { Switch } from '../ds/index.ts';
import { INSPECTOR_STRINGS } from './inspector.strings.ts';
import { cutBefore, framesToNearestBeat, rollCutOps, secondsText } from './inspector.model.ts';
import { selectCut, setLoupe, useInspectorView } from './inspector.bus.ts';

type Media = Extract<Clip, { type: 'media' }>;
/** The transitions offered first on a cut: one of each family people reach for, all drawn without a graphics adapter. */
const QUICK = ['dissolve', 'push-left', 'wipe-left', 'zoom-in', 'dip-black', 'slide-left'];

function Meter({ label, frames, fps }: { label: string; frames: number | null; fps: number }) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const sec = frames === null ? null : frames / fps;
  // the meter is full at two seconds of spare footage; under half a second (a usual transition) it turns to the attention colour
  const pct = sec === null ? 100 : Math.max(2, Math.min(100, (sec / 2) * 100));
  return (
    <div className={`cut-meter${sec !== null && sec < 0.5 ? ' is-short' : ''}`}>
      <span className="cut-meter-label">{label}</span>
      <span className="cut-meter-val num">{sec === null ? S.handleStill : `${secondsText(sec)} ${S.seconds}`}</span>
      <span className="cut-meter-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={2} aria-valuenow={sec === null ? 2 : Math.min(2, +sec.toFixed(2))} aria-valuetext={sec === null ? S.handleStill : `${secondsText(sec)} ${S.seconds}`}><i style={{ inlineSize: `${pct}%` }} /></span>
    </div>
  );
}

export function CutPanel({ clip }: { clip: Media }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const view = useInspectorView();
  const doc = state.doc;
  const cut = doc ? cutBefore(doc, clip.id) : null;
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalId = useId();
  if (!doc || !cut) return <p className="muted insp-note">{S.noCut}</p>;
  const fps = editor.rate.num / editor.rate.den;
  const at = cut.frame / fps;
  const beats = followedBeats(doc, at - 2, at + 2).map((b) => b.t);
  const toBeat = framesToNearestBeat(cut.frame, beats, fps);
  const pos = toBeat === 0 ? beatPositionAt(doc, clip.start) : null;
  const perBar = barLength(doc, clip);
  const bar = pos ? Math.floor(Math.max(0, Math.round(pos.sinceFirstBar)) / perBar) + 1 : 1, beatInBar = pos ? Math.max(0, Math.round(pos.sinceBar)) % perBar + 1 : 1;
  const roll = async (frames: number) => {
    const r = await editor.commit(() => { const now = editor.doc ? cutBefore(editor.doc, clip.id) : null; return now && editor.doc ? rollCutOps(editor.doc, now, frames) : null; }, 'Roll the cut');
    setRefusal(r ? null : editor.getState().error ?? S.rollRefused);
  };
  const applyTransition = async (type: string) => {
    const frames = clip.transition?.frames ?? Math.max(1, Math.round(fps / 2));
    const r = await editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type: clip.transition?.type === type ? null : type, frames } }], 'Transition');
    setRefusal(r ? null : editor.getState().error);
  };
  const quick = QUICK.map((id) => transitionDef(id)).filter((d): d is NonNullable<typeof d> => !!d && (!d.gpu || !!state.gpu?.available));
  return (
    <>
      <div className="cut-loupe-row">
        <Switch checked={view.loupe} onChange={setLoupe} label={S.loupe} testId="cut-loupe-toggle" />
        <button type="button" className="oh-more" aria-label={S.backToClip} title={S.backToClip} data-testid="cut-close" onClick={() => selectCut(null)}><X size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <Section id="roll" title={S.secRoll} help>
        <div className="cut-roll" dir="ltr" role="group" aria-label={S.secRoll}>
          <button type="button" className="cut-roll-btn" aria-label={S.rollEarlier} title={S.rollEarlier} data-testid="cut-roll-earlier" aria-describedby={refusal ? refusalId : undefined} onClick={() => void roll(-1)}><ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          <span className="cut-roll-at num" data-testid="cut-at">{editor.doc ? fmtTc(cut.frame, fps) : ''}</span>
          <button type="button" className="cut-roll-btn" aria-label={S.rollLater} title={S.rollLater} data-testid="cut-roll-later" aria-describedby={refusal ? refusalId : undefined} onClick={() => void roll(1)}><ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          <button type="button" className="cut-roll-beat" disabled={toBeat === null || toBeat === 0} title={toBeat === null ? S.rollBeatNone : undefined} data-testid="cut-roll-beat" dir={state.lang === 'he' ? 'rtl' : 'ltr'} onClick={() => { if (toBeat) void roll(toBeat); }}><IconBeatLock size={16} /> {S.rollBeat}</button>
        </div>
        {toBeat !== null && (
          <p className={`cut-beat${toBeat === 0 ? ' is-on' : ''}`} role="status" data-testid="cut-beat-state" data-frames={toBeat}>
            <IconOnBeat size={14} /> {toBeat === 0 ? S.onBeat(bar, beatInBar) : S.offBeat(-toBeat)}
          </p>
        )}
        {refusal && <p id={refusalId} className="danger" role="alert" data-testid="cut-refusal">{refusal}</p>}
        <p className="muted pf-help">{S.rollNote}</p>
      </Section>
      <Section id="handles" title={S.secHandles} help>
        <Meter label={S.handleBefore} frames={cut.handleAfter} fps={fps} />
        <Meter label={S.handleAfter} frames={cut.handleBefore} fps={fps} />
        <p className="muted pf-help">{S.handleNote}</p>
      </Section>
      <Section id="cut-transitions" title={S.secFav}>
        <div className="pf-chips" role="group" aria-label={S.secFav}>
          {quick.map((d) => (
            <button key={d.id} type="button" className="pf-chipbtn" aria-pressed={clip.transition?.type === d.id} data-testid="cut-transition" data-value={d.id} onClick={() => void applyTransition(d.id)}>{d.name[state.lang]}</button>
          ))}
        </div>
        <div className="cut-all"><EffectGalleryButton clip={clip} trackKind="video" /><span className="muted num">{TRANSITIONS.length}</span></div>
      </Section>
    </>
  );
}
const fmtTc = (frame: number, fps: number) => { const w = Math.max(1, Math.round(fps)); const s = Math.floor(frame / w); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(frame - s * w).padStart(2, '0')}`; };
/** Beats per bar of the music under the clip's start, from its analysis; 4 when the analysis has no bars. */
function barLength(doc: NonNullable<ReturnType<typeof useEditorState>['state']['doc']>, clip: Media): number {
  const pos = beatPositionAt(doc, clip.start);
  const meter = pos ? doc.analyses?.[findAsset(doc, pos.clipId) ?? '']?.beats?.meter : null;
  return meter ?? 4;
}
function findAsset(doc: NonNullable<ReturnType<typeof useEditorState>['state']['doc']>, clipId: string): string | null {
  for (const tr of doc.sequences[doc.mainSequenceId]?.tracks ?? []) for (const c of tr.clips) if (c.id === clipId && c.type === 'media') return c.assetId;
  return null;
}

/** The transition on the chosen cut: its kind and length, its beat lock and velocity, and its removal. */
export function TransitionPanel({ clip }: { clip: Media }) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  return (
    <div className="look-transition">
      <TransitionControls key={`tr:${clip.id}:${clip.transition?.type ?? ''}:${clip.transition?.frames ?? ''}`} clip={clip} />
      {clip.transition && <div className="row"><button type="button" className="ghost danger" data-testid="transition-remove" onClick={() => void editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type: null, frames: clip.transition!.frames } }], 'Transition')}>{S.removeTransition}</button></div>}
    </div>
  );
}
