/**
 * Speed curves for the selected clip: twelve named shapes and a hand-made curve drawn on a small graph.
 * Applying one is the registered `apply_speed_curve` op through editor.commit; nothing here keeps project state.
 */
import { useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as T from '@pulseframe/time';
import { curvePolyline, findClip, segmentsFromPoints, SPEED_CURVES, toSourceSpan, type Clip, type CurvePoint, type CurveSegment } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { repeatClick } from './oneAtATime.ts';
import { clipsLook, curveApplier, curveBlocker } from './speedCurves.apply.ts';
import { SectionsContext } from './Section.tsx';
import './speedCurves.css';

type Media = Extract<Clip, { type: 'media' }>;
const STR = {
  he: {
    title: 'עקומות מהירות', more: (n: number) => `עוד ${n} עקומות`, fewer: 'פחות עקומות', intro: 'צורה מוכנה של מהירות לאורך הקליפ. הקליפ מתחלק לחלקים, כל אחד במהירות שלו, והתמונה והצליל המקושר משתנים יחד.',
    ripple: 'להזיז את הקליפים שאחריו באותו ערוץ', length: (x: string) => `אורך ×${x}`, custom: 'עקומה משלך', customHint: 'גוררים נקודה למעלה כדי להאיץ ולמטה כדי להאט. לחיצה כפולה על הגרף מוסיפה נקודה; Delete מוחק את הנקודה שבמיקוד.',
    smooth: 'מעברים רכים בין המהירויות', apply: 'החלת העקומה', reset: 'איפוס', newLength: (a: string, b: string) => `אורך אחרי ההחלה: כ-${a} שנ׳ (עכשיו ${b} שנ׳)`,
    point: (i: number, at: string, v: string) => `נקודה ${i}: מיקום ${at}%, מהירות ${v}×`, graph: 'גרף מהירות: מיקום בקליפ מול מהירות',
    blocked: {
      keyframes: 'יש בקליפ נקודות מפתח או עוצמת קול משתנה. יש להסיר אותן קודם.',
      transition: 'יש מעבר בתחילת התמונה של הקליפ הזה או של הקליפ שמיד אחריו, ועקומת מהירות לא יכולה לשמור עליו: קודם בוחרים "ללא" בסוג המעבר (במקטע "מראה ואפקטים"), ואחר כך מחילים את העקומה.',
      crossfade: 'הצליל של הקליפ הזה עובר במעבר חלק לקליפ הסמוך לו באותו ערוץ, ועקומת מהירות לא יכולה לשמור עליו: קודם מאפסים את המעבר החלק בלשונית "סאונד" (בקליפ המאוחר מבין השניים), ואחר כך מחילים את העקומה.',
      overlap: 'הצליל של הקליפ הזה חופף לקליפ הסמוך לו באותו ערוץ: מקצרים אחד מהם כך שרק ייגעו זה בזה, או מעבירים אחד מהם לערוץ אחר, ואחר כך מחילים את העקומה.',
      reverse: 'קליפ שמתנגן לאחור לא יכול לקבל עקומת מהירות: קודם מבטלים את "ניגון לאחור".',
      freeze: 'תמונה מוקפאת לא יכולה לקבל עקומת מהירות.',
    },
    done: (n: number) => `העקומה הוחלה: ${n} חלקים נבחרו בציר הזמן. Ctrl+Z מבטל. כדי לנסות עקומה אחרת, מבטלים קודם.`,
    doneOne: 'העקומה הוחלה על הקליפ. Ctrl+Z מבטל; עקומה אחרת תחליף אותה.',
    repeat: 'העקומה כבר הוחלה והחלקים שלה נבחרו. כדי לנסות עקומה אחרת מבטלים קודם (Ctrl+Z); כדי לתת עקומה לחלק אחד, בוחרים אותו בציר הזמן.',
  },
  en: {
    title: 'Speed curves', more: (n: number) => `${n} more curves`, fewer: 'Fewer curves', intro: 'A ready-made shape of speed along the clip. The clip is divided into parts, each at its own speed; picture and linked sound change together.',
    ripple: 'Move the clips after it on the same track', length: (x: string) => `length ×${x}`, custom: 'Your own curve', customHint: 'Drag a point up to speed up and down to slow down. Double-click the graph to add a point; Delete removes the focused point.',
    smooth: 'Ease between speeds', apply: 'Apply curve', reset: 'Reset', newLength: (a: string, b: string) => `Length after applying: about ${a} s (now ${b} s)`,
    point: (i: number, at: string, v: string) => `Point ${i}: position ${at}%, speed ${v}×`, graph: 'Speed graph: position in the clip against speed',
    blocked: {
      keyframes: 'The clip has keyframes or volume keys. Remove them first.',
      transition: 'The picture of this clip, or of the clip right after it, starts with a transition, which a speed curve cannot keep: set the transition type to None (in "Look and effects") first, then apply the curve.',
      crossfade: 'The sound of this clip crossfades with the clip next to it on its track, which a speed curve cannot keep: set that crossfade to 0 in the Sound tab (on the later of the two clips) first, then apply the curve.',
      overlap: 'The sound of this clip overlaps the clip next to it on its track: trim one of them so that they only touch, or move one to another track, then apply the curve.',
      reverse: 'A clip that plays backwards cannot take a speed curve: turn off "Play backwards" first.',
      freeze: 'A freeze frame cannot take a speed curve.',
    },
    done: (n: number) => `Curve applied: ${n} parts selected on the timeline. Ctrl+Z undoes it. To try another curve, undo first.`,
    doneOne: 'Curve applied to the clip. Ctrl+Z undoes it; another curve replaces this one.',
    repeat: 'The curve is already applied and its parts are selected. To try another curve, undo first (Ctrl+Z); to give one part a curve of its own, choose that part on the timeline.',
  },
} as const;

const LO = Math.log(0.1), HI = Math.log(8);
/** 0 (slowest, 0.1×) … 1 (fastest, 8×) on a logarithmic scale, so 0.5× and 2× sit the same distance from 1×. */
const level = (speed: number) => (Math.log(Math.min(8, Math.max(0.1, speed))) - LO) / (HI - LO);
const speedAt = (lvl: number) => Math.round(Math.exp(LO + Math.min(1, Math.max(0, lvl)) * (HI - LO)) * 100) / 100;
/** Timeline length of a curve as a multiple of the source it shows (1 = as long as at normal speed). */
const lengthFactor = (segments: readonly CurveSegment[]) => { const sum = segments.reduce((n, s) => n + s.weight, 0); return segments.reduce((n, s) => n + s.weight / sum / ((s.from + s.to) / 2), 0); };
const num = (x: number, d = 1) => String(Number(x.toFixed(d)));

function Thumb({ segments, smooth }: { segments: readonly CurveSegment[]; smooth: boolean }) {
  const W = 84, H = 34, pad = 3;
  const pts = useMemo(() => curvePolyline(segments, smooth).map((p) => `${(pad + p.x * (W - 2 * pad)).toFixed(1)},${(H - pad - level(p.speed) * (H - 2 * pad)).toFixed(1)}`).join(' '), [segments, smooth]);
  const one = H - pad - level(1) * (H - 2 * pad);
  return (
    <svg className="sc-thumb" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      <line x1={pad} x2={W - pad} y1={one} y2={one} className="sc-one" />
      <polyline points={pts} className="sc-line" />
    </svg>
  );
}

const DEFAULT_POINTS: CurvePoint[] = [{ at: 0, speed: 1 }, { at: 0.25, speed: 1 }, { at: 0.5, speed: 1 }, { at: 0.75, speed: 1 }, { at: 1, speed: 1 }];
const GW = 280, GH = 132, GP = 12;

export function SpeedCurveField({ clip }: { clip: Media }) {
  const { editor, state } = useEditorState();
  const S = STR[state.lang];
  const [ripple, setRipple] = useState(true);
  const [points, setPoints] = useState<CurvePoint[]>(DEFAULT_POINTS);
  const [smooth, setSmooth] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  // One action at a time: see speedCurves.apply.ts. `busy` only repaints the controls; the guard itself reads live state.
  const [curve] = useState(() => curveApplier({
    commit: (ops, label) => editor.commit(ops, label), select: (id, mode) => editor.select(id, mode), selection: () => editor.getState().selection,
    hasClip: (id) => { const d = editor.getState().doc; return !!d && !!findClip(d, id); },
  }));
  const [busy, setBusy] = useState(false);
  // The status line speaks of certain clips as they were when it was written. When they change (an undo, above all) it goes;
  // edits elsewhere in the project leave it.
  const about = useRef<{ ids: readonly string[]; was: string } | null>(null);
  const look = (ids: readonly string[]) => { const d = editor.getState().doc; return clipsLook((id) => d && findClip(d, id)?.clip, ids); };
  const say = (text: string, ids: readonly string[]) => { about.current = { ids, was: look(ids) }; setStatus(text); };
  // A redo brings the parts of an undone curve back; they are selected again, as the apply left them: see documentChanged.
  useEffect(() => {
    if (curve.documentChanged() === 'back') { say(STR[editor.getState().lang].repeat, editor.getState().selection); return; }
    if (about.current && look(about.current.ids) !== about.current.was) { about.current = null; setStatus(null); }
  }, [curve, editor, state.doc]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const doc = editor.doc;
  // Six curves show at first (one screen); the rest open on request. The all-tools view shows every curve.
  const { flat: allTools } = useContext(SectionsContext);
  const [more, setMore] = useState(allTools);
  if (!doc) return null;
  // What the op would refuse for every curve (its own checks, over the clip and what is linked to it), said before the
  // click; a refusal it still gives is reported by the editor as before.
  const block = curveBlocker(doc, clip.id);
  const blocked = block ? S.blocked[block] : null;
  const nowSeconds = T.toSeconds(clip.duration), sourceSeconds = T.toSeconds(toSourceSpan(clip, clip.duration));

  // Not the `disabled` attribute: a tile that disables itself under the keyboard focus would drop the focus (and with it Ctrl+Z).
  const held = busy || curve.repeat();
  const apply = async (args: Record<string, unknown>, label: string, clicks: number) => {
    if (repeatClick(clicks)) return; // the second click of a double-click, before or after the first one's commit has landed
    if (curve.busy) return; // a commit is on its way: this click is not a second edit
    if (curve.repeat()) { say(S.repeat, editor.getState().selection); return; }
    about.current = null; setStatus(null); setBusy(true);
    try {
      const r = await curve.apply(clip.id, { ...args, ...(ripple ? {} : { ripple: false }) }, label);
      if (r.kind === 'applied') say(r.partIds.length > 1 ? S.done(r.partIds.length) : S.doneOne, r.partIds);
    } finally { setBusy(false); }
  };

  // ---- the hand-made curve ----
  const segments = segmentsFromPoints(points);
  const px = (p: CurvePoint) => GP + p.at * (GW - 2 * GP), py = (p: CurvePoint) => GH - GP - level(p.speed) * (GH - 2 * GP);
  const fromEvent = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * GW, y = ((e.clientY - r.top) / r.height) * GH;
    return { at: Math.min(1, Math.max(0, (x - GP) / (GW - 2 * GP))), speed: speedAt((GH - GP - y) / (GH - 2 * GP)) };
  };
  const move = (i: number, to: { at: number; speed: number }) => setPoints((ps) => ps.map((p, k) => {
    if (k !== i) return p;
    const lo = k === 0 ? 0 : ps[k - 1]!.at + 0.01, hi = k === ps.length - 1 ? 1 : ps[k + 1]!.at - 0.01;
    return { at: k === 0 ? 0 : k === ps.length - 1 ? 1 : Math.round(Math.min(hi, Math.max(lo, to.at)) * 1000) / 1000, speed: Math.min(8, Math.max(0.1, to.speed)) };
  }));
  const onDown = (i: number) => (e: ReactPointerEvent<SVGCircleElement>) => { drag.current = i; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); e.currentTarget.focus(); };
  const onMove = (e: ReactPointerEvent<SVGCircleElement>) => { if (drag.current !== null) move(drag.current, fromEvent(e)); };
  const onUp = () => { drag.current = null; };
  const onKey = (i: number) => (e: ReactKeyboardEvent<SVGCircleElement>) => {
    const p = points[i]!, big = e.shiftKey ? 5 : 1;
    const act: Record<string, () => void> = {
      ArrowUp: () => move(i, { at: p.at, speed: Math.round((p.speed + 0.05 * big) * 100) / 100 }),
      ArrowDown: () => move(i, { at: p.at, speed: Math.round((p.speed - 0.05 * big) * 100) / 100 }),
      ArrowLeft: () => move(i, { at: p.at - 0.01 * big, speed: p.speed }),
      ArrowRight: () => move(i, { at: p.at + 0.01 * big, speed: p.speed }),
      Delete: () => { if (i > 0 && i < points.length - 1 && points.length > 2) setPoints((ps) => ps.filter((_, k) => k !== i)); },
    };
    act.Backspace = act.Delete!;
    const fn = act[e.key];
    if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    fn();
  };
  const addPoint = (e: { clientX: number; clientY: number }) => {
    if (points.length >= 12) return;
    const p = fromEvent(e);
    if (points.some((q) => Math.abs(q.at - p.at) < 0.02)) return;
    setPoints((ps) => [...ps, { at: Math.round(p.at * 1000) / 1000, speed: p.speed }].sort((a, b) => a.at - b.at));
  };
  const line = segments ? curvePolyline(segments, smooth, 12) : [];
  // the graph's x axis is the position in the clip (source), so place each sample of the line by its share of the source
  const path = useMemo(() => {
    if (!segments) return '';
    const sum = segments.reduce((n, s) => n + s.weight, 0);
    const out: string[] = [];
    let acc = 0;
    for (const s of segments) {
      const x0 = acc / sum, x1 = (acc + s.weight) / sum;
      for (let i = 0; i <= 12; i++) {
        const u = i / 12; // time within the segment
        const sp = s.from + (s.to - s.from) * (smooth ? u * u * (3 - 2 * u) : u);
        // source covered up to time u within the segment, as a share of the segment
        const cover = s.from === s.to ? u : (s.from * u + (s.to - s.from) * (smooth ? u * u * u - (u * u * u * u) / 2 : (u * u) / 2)) / ((s.from + s.to) / 2);
        out.push(`${(GP + (x0 + (x1 - x0) * cover) * (GW - 2 * GP)).toFixed(1)},${(GH - GP - level(sp) * (GH - 2 * GP)).toFixed(1)}`);
      }
      acc += s.weight;
    }
    return out.join(' ');
  }, [segments, smooth]);
  const flat = points.every((p) => p.speed === points[0]!.speed);

  return (
    <fieldset className="speed-curves" data-testid="speed-curves" disabled={!!blocked}>
      <legend>{S.title}</legend>
      <p className="muted pf-help">{S.intro}</p>
      {blocked && <p className="sc-blocked" role="note" data-testid="speed-curve-blocked" data-reason={block ?? undefined}>{blocked}</p>}
      <div className="sc-grid" role="group" aria-label={S.title}>
        {(more ? SPEED_CURVES : SPEED_CURVES.slice(0, 6)).map((c) => (
          <button key={c.id} type="button" className="sc-tile" data-testid="speed-curve" data-id={c.id} title={c.hint[state.lang]} aria-label={`${c.name[state.lang]}: ${c.hint[state.lang]}`}
            aria-disabled={held || undefined} aria-busy={busy || undefined} onClick={(e) => void apply({ preset: c.id }, `Speed curve ${c.id}`, e.detail)}>
            <Thumb segments={c.segments} smooth={c.smooth} />
            <span className="sc-name">{c.name[state.lang]}</span>
            <span className="sc-len"><bdi>{S.length(num(lengthFactor(c.segments), 2))}</bdi></span>
          </button>
        ))}
      </div>
      {!allTools && SPEED_CURVES.length > 6 && <button type="button" className="ghost sc-more" aria-expanded={more} data-testid="speed-curve-more" onClick={() => setMore(!more)}>{more ? S.fewer : S.more(SPEED_CURVES.length - 6)}</button>}
      <label className="check"><input type="checkbox" checked={ripple} data-testid="speed-curve-ripple" onChange={(e) => setRipple(e.target.checked)} /> {S.ripple}</label>
      <details className="sc-custom" data-testid="speed-curve-custom">
        <summary>{S.custom}</summary>
        <p className="muted pf-help">{S.customHint}</p>
        <svg ref={svg} className="sc-graph" viewBox={`0 0 ${GW} ${GH}`} role="group" aria-label={S.graph} direction="ltr" data-testid="speed-curve-graph" onDoubleClick={addPoint}>
          {[0.25, 0.5, 1, 2, 4].map((v) => {
            const y = GH - GP - level(v) * (GH - 2 * GP);
            return <g key={v}><line x1={GP} x2={GW - GP} y1={y} y2={y} className={v === 1 ? 'sc-one' : 'sc-rule'} /><text x={GP + 2} y={y - 2} className="sc-tick">{v}×</text></g>;
          })}
          <polyline points={path} className="sc-line" />
          {points.map((p, i) => (
            <circle key={i} cx={px(p)} cy={py(p)} r={6} className="sc-point" tabIndex={0} role="slider" data-testid="speed-curve-point"
              aria-label={S.point(i + 1, num(p.at * 100, 0), num(p.speed, 2))} aria-valuemin={0.1} aria-valuemax={8} aria-valuenow={p.speed} aria-valuetext={`${num(p.speed, 2)}×`} aria-orientation="vertical"
              onPointerDown={onDown(i)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey(i)} onDoubleClick={(e) => e.stopPropagation()} />
          ))}
        </svg>
        <p className="muted" data-testid="speed-curve-length" aria-live="polite">{segments && line.length ? S.newLength(num(sourceSeconds * lengthFactor(segments), 1), num(nowSeconds, 1)) : ''}</p>
        <label className="check"><input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} data-testid="speed-curve-smooth" /> {S.smooth}</label>
        <div className="row">
          <button type="button" className="primary" disabled={!segments || flat} aria-disabled={held || undefined} aria-busy={busy || undefined} data-testid="speed-curve-apply" onClick={(e) => void apply({ points, ...(smooth ? {} : { smooth: false }) }, 'Speed curve', e.detail)}>{S.apply}</button>
          <button type="button" className="ghost" data-testid="speed-curve-reset" onClick={() => setPoints(DEFAULT_POINTS)}>{S.reset}</button>
        </div>
      </details>
      <p className="muted sc-status" role="status" data-testid="speed-curve-status">{status ?? ''}</p>
    </fieldset>
  );
}
