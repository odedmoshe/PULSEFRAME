/**
 * The cut loupe (UX_REDESIGN §4.5, the Studio graft): while a cut is chosen, the viewer shows the last frame before the cut
 * and the first frame after it side by side, with their timecodes and how much spare footage each side has.
 *
 * Honest frames: both pictures are stills of the timeline rendered by the server's renderer, which is the same evaluate +
 * compositor path as the preview and the export (ADR-0005). Nothing is drawn or blended here. They are fetched again after
 * every edit (the address carries the revision), so a roll shows its result. With a transition on the cut the stills show it,
 * as the video will, and the loupe says so.
 * Left is earlier and right is later in every language: the loupe is never mirrored.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import * as T from '@pulseframe/time';
import { useEditorState } from './store.ts';
import { Kbd } from '../ds/index.ts';
import { IconCutPlus } from './icons.tsx';
import { STAGE_STRINGS } from './stage.strings.ts';
import { cutBefore, secondsText } from './inspector.model.ts';

function Still({ src, alt }: { src: string; alt: string }) {
  const { state } = useEditorState();
  const S = STAGE_STRINGS[state.lang];
  // the picture that is shown stays until the next one has loaded, so a roll never flashes to an empty box
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const url = attempt ? `${src}&try=${attempt}` : src;
  const loading = shown !== url && failed !== url;
  return (
    <div className="loupe-still" data-state={failed === url ? 'failed' : loading ? 'loading' : 'ready'}>
      {shown && <img src={shown} alt={alt} draggable={false} />}
      {shown !== url && failed !== url && <img className="loupe-next" src={url} alt="" aria-hidden="true" onLoad={() => setShown(url)} onError={() => setFailed(url)} />}
      {loading && !shown && <span className="loupe-wait" role="status">{S.loupeLoading}</span>}
      {failed === url && <span className="loupe-wait" role="alert">{S.loupeFailed} <button type="button" className="loupe-retry" onClick={() => { setFailed(null); setAttempt((n) => n + 1); }}>{S.loupeRetry}</button></span>}
    </div>
  );
}

export function CutLoupe() {
  const { editor, state } = useEditorState();
  const S = STAGE_STRINGS[state.lang];
  const doc = state.doc;
  const cut = doc && state.cutClipId ? cutBefore(doc, state.cutClipId) : null;
  const open = !!cut && state.loupe;
  // , and . roll the cut one frame (Shift: five) and Shift+B rolls it to the nearest beat while a cut is chosen: they are
  // registered commands (commands.ts cut.*), listed with the shortcuts and taken ahead of keyframe.prev / keyframe.next.
  if (!doc || !cut || !open) return null;
  const rate = editor.rate, fps = rate.num / rate.den;
  const variant = state.viewVariantId ? `&variant=${encodeURIComponent(state.viewVariantId)}` : '';
  const url = (index: number) => `/api/v1/projects/${encodeURIComponent(doc.id)}/frame?index=${index}${variant}&rev=${state.revision}`;
  const name = (assetId: string) => (doc.assets[assetId]?.name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const tc = (frame: number) => T.toTimecode(T.frameTime(frame, rate), rate);
  const spare = (frames: number | null) => (frames === null ? S.still : `${secondsText(frames / fps)} ${state.lang === 'he' ? 'ש׳' : 's'}`);
  const pct = (frames: number | null) => (frames === null ? 100 : Math.max(2, Math.min(100, (frames / fps / 2) * 100)));
  const after = cut.next.transition ? Math.min(cut.next.transition.frames, Math.max(0, T.frameIndexAt(cut.next.duration, rate) - 1)) : 0;
  const side = (which: 'out' | 'in') => {
    // with a transition on the cut, the first frame that is the incoming clip alone comes after the transition's frames
    const frame = which === 'out' ? cut.frame - 1 : cut.frame + after;
    const clip = which === 'out' ? cut.prev : cut.next;
    const handle = which === 'out' ? cut.handleAfter : cut.handleBefore;
    const what = which === 'out' ? S.lastFrame : after ? S.firstAfter : S.firstFrame;
    const title = `${what} · ${name(clip.assetId)}`;
    return (
      <figure className={`loupe-side is-${which}`} data-testid={`cut-loupe-${which}`} data-frame={frame}>
        {/* what the frame is, then the file's name, which is the part that gives way (its end, never its start) */}
        <figcaption title={title}><span className="loupe-what" dir={state.lang === 'he' ? 'rtl' : 'ltr'}>{what}</span><bdi className="loupe-name" dir="ltr">{name(clip.assetId)}</bdi><span className="tc">{tc(frame)}</span></figcaption>
        <Still src={url(frame)} alt={title} />
        <div className={`loupe-handle${handle !== null && handle / fps < 0.5 ? ' is-short' : ''}`}>
          <span dir="auto">{which === 'out' ? S.spareEnd : S.spareStart}</span><span className="num">{spare(handle)}</span>
          <span className="loupe-meter" aria-hidden="true"><i style={{ width: `${pct(handle)}%` }} /></span>
        </div>
      </figure>
    );
  };
  return (
    <div className="stage-loupe pf-ds pf-force-dark" role="group" aria-label={S.loupe} data-testid="cut-loupe" dir="ltr" data-cut-frame={cut.frame}>
      <div className="loupe-bar" dir={state.lang === 'he' ? 'rtl' : 'ltr'}>
        <span className="loupe-chip"><IconCutPlus size={16} /> {S.loupe}</span>
        <span className="loupe-keys"><Kbd k="," he={false} /><Kbd k="." he={false} /> {S.rollKeys} · <Kbd k="Shift" /><Kbd k="B" /> {S.toBeat}</span>
        <button type="button" className="stage-btn" aria-label={S.loupeClose} title={S.loupeClose} data-testid="cut-loupe-close" onClick={() => editor.setLoupe(false)}><X size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <div className="loupe-pair">
        {side('out')}
        <div className="loupe-mid" aria-hidden="true"><IconCutPlus size={20} /><span className="tc">{tc(cut.frame)}</span></div>
        {side('in')}
      </div>
      <p className="loupe-note" dir={state.lang === 'he' ? 'rtl' : 'ltr'}>{cut.next.transition ? S.loupeWithTransition(cut.next.transition.frames) : S.loupeHow}</p>
    </div>
  );
}
