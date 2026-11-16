/**
 * Speed curves for the selected clip: twelve named shapes and a hand-made curve drawn on a small graph.
 * Applying one is the registered `apply_speed_curve` op through editor.commit; nothing here keeps project state.
 */
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as T from '@pulseframe/time';
import { curvePolyline, segmentsFromPoints, SPEED_CURVES, toSourceSpan, type Clip, type CurvePoint, type CurveSegment } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import './speedCurves.css';

type Media = Extract<Clip, { type: 'media' }>;
const STR = {
  he: {
    title: 'עקומות מהירות', intro: 'צורה מוכנה של מהירות לאורך הקליפ. הקליפ מתחלק לחלקים, כל אחד במהירות שלו, והתמונה והצליל המקושר משתנים יחד.',
    ripple: 'להזיז את הקליפים שאחריו באותו ערוץ', length: (x: string) => `אורך ×${x}`, custom: 'עקומה משלך', customHint: 'גוררים נקודה למעלה כדי להאיץ ולמטה כדי להאט. לחיצה כפולה על הגרף מוסיפה נקודה; Delete מוחק את הנקודה שבמיקוד.',
    smooth: 'מעברים רכים בין המהירויות', apply: 'החלת העקומה', reset: 'איפוס', newLength: (a: string, b: string) => `אורך אחרי ההחלה: כ-${a} שנ׳ (עכשיו ${b} שנ׳)`,
    point: (i: number, at: string, v: string) => `נקודה ${i}: מיקום ${at}%, מהירות ${v}×`, graph: 'גרף מהירות: מיקום בקליפ מול מהירות',
    blocked: { keyframes: 'יש בקליפ נקודות מפתח או עוצמת קול משתנה. יש להסיר אותן קודם.', transition: 'יש מעבר בקליפ הזה או אחריו. יש להסיר אותו קודם.', reverse: 'קליפ שמתנגן לאחור לא יכול לקבל עקומת מהירות.' },
    done: (n: number) => `העקומה הוחלה: ${n} חלקים נבחרו בציר הזמן. Ctrl+Z מבטל.`,
  },
  en: {
    title: 'Speed curves', intro: 'A ready-made shape of speed along the clip. The clip is divided into parts, each at its own speed; picture and linked sound change together.',
    ripple: 'Move the clips after it on the same track', length: (x: string) => `length ×${x}`, custom: 'Your own curve', customHint: 'Drag a point up to speed up and down to slow down. Double-click the graph to add a point; Delete removes the focused point.',
    smooth: 'Ease between speeds', apply: 'Apply curve', reset: 'Reset', newLength: (a: string, b: string) => `Length after applying: about ${a} s (now ${b} s)`,
    point: (i: number, at: string, v: string) => `Point ${i}: position ${at}%, speed ${v}×`, graph: 'Speed graph: position in the clip against speed',
    blocked: { keyframes: 'The clip has keyframes or volume keys. Remove them first.', transition: 'There is a transition on this clip or after it. Remove it first.', reverse: 'A clip that plays backwards cannot take a speed curve.' },
    done: (n: number) => `Curve applied: ${n} parts selected on the timeline. Ctrl+Z undoes it.`,
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
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const doc = editor.doc;
  if (!doc) return null;
  const track = doc.sequences[doc.mainSequenceId]!.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id));
  const next = track?.clips[track.clips.findIndex((c) => c.id === clip.id) + 1];
  const blocked = clip.reverse ? S.blocked.reverse
    : clip.keyframes || clip.volume || clip.effects?.some((e) => e.keyframes) ? S.blocked.keyframes
    : clip.transition || (next?.type === 'media' && next.transition && T.eq(next.start, T.add(clip.start, clip.duration))) ? S.blocked.transition : null;
  const nowSeconds = T.toSeconds(clip.duration), sourceSeconds = T.toSeconds(toSourceSpan(clip, clip.duration));

  const apply = async (args: Record<string, unknown>, label: string) => {
    setStatus(null);
    const r = await editor.commit([{ op: 'apply_speed_curve', args: { clipId: clip.id, ...args, ...(ripple ? {} : { ripple: false }) } }], label);
    const ids = (r?.results[0]?.output as { partClipIds?: string[] } | undefined)?.partClipIds;
    if (!ids?.length) return;
    editor.select(ids[0]!);
    for (const id of ids.slice(1)) editor.select(id, 'toggle');
    setStatus(S.done(ids.length));
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
      <p className="muted">{S.intro}</p>
      {blocked && <p className="sc-blocked" role="note" data-testid="speed-curve-blocked">{blocked}</p>}
      <div className="sc-grid" role="group" aria-label={S.title}>
        {SPEED_CURVES.map((c) => (
          <button key={c.id} type="button" className="sc-tile" data-testid="speed-curve" data-id={c.id} title={c.hint[state.lang]} aria-label={`${c.name[state.lang]}: ${c.hint[state.lang]}`}
            onClick={() => void apply({ preset: c.id }, `Speed curve ${c.id}`)}>
            <Thumb segments={c.segments} smooth={c.smooth} />
            <span className="sc-name">{c.name[state.lang]}</span>
            <span className="sc-len"><bdi>{S.length(num(lengthFactor(c.segments), 2))}</bdi></span>
          </button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={ripple} data-testid="speed-curve-ripple" onChange={(e) => setRipple(e.target.checked)} /> {S.ripple}</label>
      <details className="sc-custom" data-testid="speed-curve-custom">
        <summary>{S.custom}</summary>
        <p className="muted">{S.customHint}</p>
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
          <button type="button" className="primary" disabled={!segments || flat} data-testid="speed-curve-apply" onClick={() => void apply({ points, ...(smooth ? {} : { smooth: false }) }, 'Speed curve')}>{S.apply}</button>
          <button type="button" className="ghost" data-testid="speed-curve-reset" onClick={() => setPoints(DEFAULT_POINTS)}>{S.reset}</button>
        </div>
      </details>
      <p className="muted sc-status" role="status" data-testid="speed-curve-status">{status ?? ''}</p>
    </fieldset>
  );
}
