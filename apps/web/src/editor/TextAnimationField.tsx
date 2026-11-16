/**
 * Letter / word / line animation of a title: entrance, exit and a repeating movement. Every change is the registered
 * `set_text_animation` op through editor.commit; nothing here keeps project state.
 */
import { DEFAULT_TEXT_ANIMATION, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type Clip, type TextAnimation } from '@pulseframe/core';
import { useEditorState } from './store.ts';

type Text = Extract<Clip, { type: 'text' }>;
const STR = {
  he: {
    title: 'אנימציית טקסט', by: 'מה זז כיחידה', in: 'כניסה', out: 'יציאה', loop: 'תנועה חוזרת', inFrames: 'אורך הכניסה (פריימים)', outFrames: 'אורך היציאה (פריימים)', none: 'בלי', remove: 'הסרת האנימציה',
    note: 'היחידות נכנסות אחת אחרי השנייה לפי סדר הקריאה, כך שעברית מתחילה מימין. כשאין תנועה, הכותרת נראית בדיוק כמו כותרת רגילה.',
    unit: { letter: 'אות', word: 'מילה', line: 'שורה' },
    names: { fade: 'דהייה', typewriter: 'מכונת כתיבה', rise: 'עלייה מלמטה', drop: 'נפילה מלמעלה', pop: 'קפיצה', slide: 'החלקה מהצד', zoom: 'התכנסות', sink: 'שקיעה', lift: 'ריחוף למעלה', shrink: 'כיווץ', wave: 'גל', bounce: 'ניתור', pulse: 'פעימה', jitter: 'רעד' },
  },
  en: {
    title: 'Text animation', by: 'What moves as one piece', in: 'Entrance', out: 'Exit', loop: 'Repeating movement', inFrames: 'Entrance length (frames)', outFrames: 'Exit length (frames)', none: 'None', remove: 'Remove animation',
    note: 'The pieces come in one after another in reading order, so Hebrew starts from the right. When nothing is moving the title looks exactly like a plain title.',
    unit: { letter: 'Letter', word: 'Word', line: 'Line' },
    names: { fade: 'Fade', typewriter: 'Typewriter', rise: 'Rise from below', drop: 'Drop from above', pop: 'Pop', slide: 'Slide from the side', zoom: 'Settle from larger', sink: 'Sink', lift: 'Lift', shrink: 'Shrink', wave: 'Wave', bounce: 'Bounce', pulse: 'Pulse', jitter: 'Jitter' },
  },
} as const;

export function TextAnimationField({ clip }: { clip: Text }) {
  const { editor, state } = useEditorState();
  const S = STR[state.lang];
  const a: TextAnimation = clip.animation ?? DEFAULT_TEXT_ANIMATION;
  const set = (patch: Partial<TextAnimation>) => void editor.commit([{ op: 'set_text_animation', args: { clipId: clip.id, animation: patch } }], 'Text animation');
  const name = (k: string) => (S.names as Record<string, string>)[k] ?? k;
  const pick = (label: string, testid: string, value: string | null, options: readonly string[], key: 'in' | 'out' | 'loop') => (
    <label>{label}
      <select value={value ?? ''} data-testid={testid} onChange={(e) => set({ [key]: e.target.value || null })}>
        <option value="">{S.none}</option>
        {options.map((o) => <option key={o} value={o}>{name(o)}</option>)}
      </select>
    </label>
  );
  const frames = (label: string, testid: string, value: number, key: 'inFrames' | 'outFrames') => (
    <label>{label}
      <input type="number" dir="ltr" min={1} max={600} step={1} defaultValue={value} key={`${key}:${value}`} data-testid={testid}
        onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n) && n >= 1 && n <= 600 && n !== value) set({ [key]: n }); else e.target.value = String(value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
  return (
    <fieldset className="ramp" data-testid="text-animation">
      <legend>{S.title}</legend>
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
        <p className="muted">{S.note}</p>
        {clip.animation && <div className="row"><button type="button" className="ghost" data-testid="text-anim-remove" onClick={() => void editor.commit([{ op: 'set_text_animation', args: { clipId: clip.id, animation: null } }], 'Remove text animation')}>{S.remove}</button></div>}
      </div>
    </fieldset>
  );
}
