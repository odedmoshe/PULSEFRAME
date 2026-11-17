/**
 * Letter / word / line animation of a title: entrance, exit and a repeating movement. Every change is the registered
 * `set_text_animation` op through editor.commit; nothing here keeps project state.
 */
import { useState } from 'react';
import * as T from '@pulseframe/time';
import { DEFAULT_TEXT_ANIMATION, findClip, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type Clip, type TextAnimation } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { fitTextAnimation, framesRoom } from './textAnimation.fit.ts';

type Text = Extract<Clip, { type: 'text' }>;
const MAX_FRAMES = 600; // the op's upper bound for one entrance or exit
const STR = {
  he: {
    title: 'אנימציית טקסט', by: 'מה זז כיחידה', in: 'כניסה', out: 'יציאה', loop: 'תנועה חוזרת', inFrames: 'אורך הכניסה (פריימים)', outFrames: 'אורך היציאה (פריימים)', none: 'בלי', remove: 'הסרת האנימציה',
    note: 'היחידות נכנסות אחת אחרי השנייה לפי סדר הקריאה, כך שעברית מתחילה מימין. כשאין תנועה, הכותרת נראית בדיוק כמו כותרת רגילה.',
    unit: { letter: 'אות', word: 'מילה', line: 'שורה' },
    names: { fade: 'דהייה', typewriter: 'מכונת כתיבה', rise: 'עלייה מלמטה', drop: 'נפילה מלמעלה', pop: 'קפיצה', slide: 'החלקה מהצד', zoom: 'התכנסות', blur: 'טשטוש', write: 'כתיבה', sink: 'שקיעה', lift: 'ריחוף למעלה', shrink: 'כיווץ', wave: 'גל', bounce: 'ניתור', pulse: 'פעימה', jitter: 'רעד' },
    shortened: (total: number, i: number, o: number) => `הכותרת באורך ${total} פריימים, ולכן האורכים קוצרו למה שנכנס בה: ${[i ? `כניסה ${i}` : '', o ? `יציאה ${o}` : ''].filter(Boolean).join(', ')}.`,
    cap: (max: number) => `האורך המרבי של כניסה או יציאה הוא ${max} פריימים.`,
  },
  en: {
    title: 'Text animation', by: 'What moves as one piece', in: 'Entrance', out: 'Exit', loop: 'Repeating movement', inFrames: 'Entrance length (frames)', outFrames: 'Exit length (frames)', none: 'None', remove: 'Remove animation',
    note: 'The pieces come in one after another in reading order, so Hebrew starts from the right. When nothing is moving the title looks exactly like a plain title.',
    unit: { letter: 'Letter', word: 'Word', line: 'Line' },
    names: { fade: 'Fade', typewriter: 'Typewriter', rise: 'Rise from below', drop: 'Drop from above', pop: 'Pop', slide: 'Slide from the side', zoom: 'Settle from larger', blur: 'Blur in', 'out:blur': 'Blur out', write: 'Write-on', sink: 'Sink', lift: 'Lift', shrink: 'Shrink', wave: 'Wave', bounce: 'Bounce', pulse: 'Pulse', jitter: 'Jitter' },
    shortened: (total: number, i: number, o: number) => `The title is ${total} frames long, so the lengths were shortened to what fits: ${[i ? `entrance ${i}` : '', o ? `exit ${o}` : ''].filter(Boolean).join(', ')}.`,
    cap: (max: number) => `An entrance or exit can be at most ${max} frames long.`,
  },
} as const;

export function TextAnimationField({ clip }: { clip: Text }) {
  const { editor, state } = useEditorState();
  const S = STR[state.lang];
  const a: TextAnimation = clip.animation ?? DEFAULT_TEXT_ANIMATION;
  const [note, setNote] = useState<string | null>(null);
  const total = T.frameIndexAt(clip.duration, editor.rate); // the title's length in frames, as the op counts it
  /**
   * Sends a change with lengths that fit the title (the default 20 and 15 frames are longer than a short title, and the op
   * refuses lengths that exceed the clip). Resolves to true when something was stored.
   */
  const change = async (patch: Partial<TextAnimation>, capped = false): Promise<boolean> => {
    let said: string | null = capped ? S.cap(MAX_FRAMES) : null, sent = false;
    // Fitted when this write's turn comes, from the title as it is then: an earlier change of this panel may still be on its way.
    const r = await editor.commit(() => {
      const live = editor.doc ? findClip(editor.doc, clip.id)?.clip : undefined;
      const now = live?.type === 'text' ? live : clip;
      const frames = T.frameIndexAt(now.duration, editor.rate);
      const fit = fitTextAnimation(now.animation ?? DEFAULT_TEXT_ANIMATION, patch, frames);
      const next = { ...(now.animation ?? DEFAULT_TEXT_ANIMATION), ...fit.patch };
      if (fit.shortened) said = S.shortened(frames, next.in ? fit.frames.inFrames : 0, next.out ? fit.frames.outFrames : 0);
      sent = Object.keys(fit.patch).length > 0;
      return sent ? [{ op: 'set_text_animation', args: { clipId: clip.id, animation: fit.patch } }] : null;
    }, 'Text animation');
    const ok = !sent || !!r; // nothing to send is not a refusal
    setNote(ok ? said : null);
    return ok && sent;
  };
  const set = (patch: Partial<TextAnimation>) => void change(patch);
  const storedFrames = (key: 'inFrames' | 'outFrames') => { const live = editor.doc ? findClip(editor.doc, clip.id)?.clip : undefined; return live?.type === 'text' ? live.animation?.[key] : undefined; };
  /** The option's name; an exit may have its own (`out:blur`, ADR-0012) where the entrance of the same name reads differently. */
  const name = (k: string, key?: 'in' | 'out' | 'loop') => (S.names as Record<string, string>)[`${key}:${k}`] ?? (S.names as Record<string, string>)[k] ?? k;
  const pick = (label: string, testid: string, value: string | null, options: readonly string[], key: 'in' | 'out' | 'loop') => (
    <label>{label}
      <select value={value ?? ''} data-testid={testid} onChange={(e) => set({ [key]: e.target.value || null })}>
        <option value="">{S.none}</option>
        {options.map((o) => <option key={o} value={o}>{name(o, key)}</option>)}
      </select>
    </label>
  );
  const frames = (label: string, testid: string, value: number, key: 'inFrames' | 'outFrames') => (
    <label>{label}
      <input type="number" dir="ltr" min={1} max={Math.min(MAX_FRAMES, framesRoom(a, key, total))} step={1} defaultValue={value} key={`${key}:${value}`} data-testid={testid}
        onBlur={(e) => {
          const el = e.currentTarget, typed = Math.round(Number(el.value));
          if (!Number.isFinite(typed) || typed < 1 || typed === value) { el.value = String(value); return; }
          // Whatever became of the change (stored, shortened, refused, nothing to send), the field then shows the stored length:
          // a refused value never stays. When the stored length changed, the field was remounted and this write is a no-op.
          void change({ [key]: Math.min(MAX_FRAMES, typed) }, typed > MAX_FRAMES).then(() => { el.value = String(storedFrames(key) ?? value); });
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
  return (
    <fieldset className="ramp" data-testid="text-animation">
      <legend className="sr-only">{S.title}</legend>
      <div className="fields">
        <label>{S.by}
          <select value={a.by} data-testid="text-anim-by" onChange={(e) => set({ by: e.target.value as TextAnimation['by'] })} disabled={!clip.animation}>
            {(['letter', 'word', 'line'] as const).map((u) => <option key={u} value={u}>{S.unit[u]}</option>)}
          </select>
        </label>
        {pick(S.in, 'text-anim-in', a.in, TEXT_ANIM_IN, 'in')}
        {pick(S.out, 'text-anim-out', a.out, TEXT_ANIM_OUT, 'out')}
        {pick(S.loop, 'text-anim-loop', a.loop, TEXT_ANIM_LOOP, 'loop')}
        {a.in && frames(S.inFrames, 'text-anim-in-frames', a.inFrames, 'inFrames')}
        {a.out && frames(S.outFrames, 'text-anim-out-frames', a.outFrames, 'outFrames')}
        {note && <p className="muted" data-testid="text-anim-status">{note}</p>}
        <span className="sr-only" role="status">{note ?? ''}</span>
        <p className="muted pf-help">{S.note}</p>
        {clip.animation && <div className="row"><button type="button" className="ghost" data-testid="text-anim-remove" onClick={() => void editor.commit([{ op: 'set_text_animation', args: { clipId: clip.id, animation: null } }], 'Remove text animation')}>{S.remove}</button></div>}
      </div>
    </fieldset>
  );
}
