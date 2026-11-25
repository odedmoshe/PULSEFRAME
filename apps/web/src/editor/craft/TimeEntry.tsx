/**
 * The typed-time field with its live line (core timeEntry.ts parseTimeEntry). `TimeField` is the field itself (used inline by the
 * versions compare); `TimeEntry` is the small non-modal popover that G («מעבר לזמן») and D («משך הקליפ») open over the transport
 * timecode. A small dir="ltr" input; under it the line says what Enter will do («← 00:00:05:00 · פריים 150»), that the time was
 * rounded, or the refusal in words. Enter commits, Escape closes and gives the focus back to what opened it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import { durationOps, findClip } from '@pulseframe/core';
import { useEditorState } from '../store.ts';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { durationNotice, laterThatStayed, say, timeLine, type Lang, type TimeLine, type TimeMode } from './craft.logic.ts';

export interface TimeFieldProps {
  lang: Lang; rate: T.Rate; mode: TimeMode; base: number; several?: boolean; last?: number;
  label: string; initial?: string; autoFocus?: boolean; testId?: string; lineTestId?: string;
  onCommit(frame: number): void | Promise<void>;
  onEscape?(): void;
}
export function TimeField({ lang, rate, mode, base, several, last, label, initial = '', autoFocus, testId = TID.timeInput, lineTestId = TID.timeLine, onCommit, onEscape }: TimeFieldProps) {
  const [text, setText] = useState(initial);
  const lineId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const line: TimeLine = timeLine(lang, text, rate, mode, { base, ...(several !== undefined ? { several } : {}), ...(last !== undefined ? { last } : {}) });
  useEffect(() => { if (autoFocus) { ref.current?.focus(); ref.current?.select(); } }, [autoFocus]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!(e.ctrlKey || e.metaKey)) e.stopPropagation(); // typed here, not an editor shortcut
    if (e.key === 'Enter') { e.preventDefault(); if (line.kind === 'ok' && line.frame !== undefined) void onCommit(line.frame); }
    else if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); }
  };
  return (
    <>
      <input ref={ref} type="text" dir="ltr" inputMode="text" autoComplete="off" spellCheck={false} value={text} aria-label={label} aria-describedby={lineId} aria-invalid={line.kind === 'refused' || undefined}
        data-testid={testId} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <p id={lineId} className="pf-craft-line" role="status" aria-live="polite" data-testid={lineTestId} data-kind={line.kind} dir="auto">{line.text}</p>
    </>
  );
}

/** The popover over the transport timecode. */
export function TimeEntry({ target }: { target: 'goto' | 'duration' }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const doc = state.doc;
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [box] = useState<{ left: number; bottom: number }>(() => {
    const r = document.querySelector<HTMLElement>('[data-testid=timecode]')?.getBoundingClientRect();
    return r ? { left: Math.max(8, Math.min(r.left, window.innerWidth - 376)), bottom: Math.max(8, window.innerHeight - r.top + 8) } : { left: 16, bottom: 120 };
  });
  const titleId = useId();
  const ids = state.selection.filter((id) => doc && findClip(doc, id));
  const rate = editor.rate;
  const close = () => { craftSurface.set(null); const o = opener.current; setTimeout(() => (o && o !== document.body && o.isConnected ? o : document.querySelector<HTMLElement>('[data-testid=timecode]'))?.focus(), 0); };
  // a click anywhere else closes the field (it is not modal); the focus stays where the click put it
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-testid=timecode],[data-testid=craft-clip-start],[data-testid=craft-clip-duration]')) craftSurface.set(null); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  if (!doc) return null;
  const single = ids.length === 1 ? findClip(doc, ids[0]!)?.clip : undefined;
  const lastFrame = Math.max(0, (editor.player?.frameCount ?? 1) - 1);
  const goto = target === 'goto';
  const base = goto ? editor.frame : single ? T.frameIndexAt(single.duration, rate) : 0;
  const commit = async (frame: number) => {
    if (goto) { editor.seek(Math.min(frame, lastFrame)); close(); return; }
    const ops = durationOps(doc, ids, frame);
    if (!ops) { editor.notify({ kind: 'info', title: say(lang, 'lineNoClip') }); close(); return; }
    if (!ops.length) { editor.notify({ kind: 'info', title: say(lang, ids.length === 1 ? 'durationSame' : 'durationSameMany') }); close(); return; }
    // the earliest old end among the clips that change: what lies after it and did not move is said in the toast
    const from = ids.map((id) => findClip(doc, id)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => T.add(f.clip.start, f.clip.duration)).reduce((a, b) => (T.lt(a, b) ? a : b));
    const r = await editor.commit(ops, 'Clip duration');
    close();
    if (!r) return; // refused: the error bar says why
    const moved = r.results.flatMap((x) => (x.output as { movedClipIds?: string[] } | undefined)?.movedClipIds ?? []);
    const ripple = r.results.some((x) => x.op === 'ripple_trim');
    editor.notify(durationNotice(lang, { clips: ops.length, frames: frame, stayed: ripple ? laterThatStayed(doc, from, [...moved, ...ids]) : 0 }, r.transactionId ?? null));
  };
  const title = goto ? say(lang, 'gotoTitle') : ids.length > 1 ? say(lang, 'durationTitleMany', { c: ids.length }) : say(lang, 'durationTitle');
  return (
    <div ref={root} className="pf-craft-pop" role="dialog" aria-modal="false" aria-labelledby={titleId} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-testid={TID.timeEntry} data-target={target}
      style={{ left: box.left, bottom: box.bottom }}>
      <h2 id={titleId}>{title}</h2>
      <TimeField lang={lang} rate={rate} mode={target === 'goto' ? 'goto' : 'duration'} base={base} several={ids.length > 1} last={lastFrame} autoFocus
        label={goto ? say(lang, 'timeInputLabel') : say(lang, 'durationInputLabel')} initial="" onCommit={commit} onEscape={close} />
      <p className="pf-craft-hint">{say(lang, 'moveToTimeHint')}</p>
      <p className="pf-craft-hint">{goto ? say(lang, 'timeEnterToGo') : say(lang, 'timeEnterToSet')}{!goto && single ? ` · ${say(lang, 'relativeFrom', { tc: T.toTimecode(single.duration, rate) })}` : ''}</p>
    </div>
  );
}
