/**
 * A name with a small "rename" button. The button turns the name into a field: Enter or leaving the field commits, Escape cancels.
 * Keyboard and screen-reader users get a real button and a labelled field (no double-click needed).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusNow } from '../ds/focus.ts';

export function InlineRename({ value, label, onCommit, testid, className }: { value: string; label: string; onCommit: (name: string) => void; testid: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editing) { setText(value); input.current?.focus(); input.current?.select(); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  // The button is drawn by the commit that ends the edit: the focus goes to it in that commit's layout effect (not a later task, where the
  // focus sat on the page body and a late focus could pull it from a field the person moved to). Only Enter and Escape ask for it: a
  // blur means the focus has already gone somewhere the person chose.
  const backToButton = useRef(false);
  useLayoutEffect(() => { if (!editing && backToButton.current) { backToButton.current = false; focusNow(button.current); } }, [editing]);
  const done = (commit: boolean, refocus = false) => {
    if (refocus) backToButton.current = true;
    setEditing(false);
    const next = text.trim();
    if (commit && next && next !== value) onCommit(next);
  };
  if (editing)
    return <input ref={input} className={`inline-rename-input ${className ?? ''}`} dir="auto" value={text} aria-label={label} data-testid={`${testid}-input`} maxLength={120}
      onChange={(e) => setText(e.target.value)} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true, true); } else if (e.key === 'Escape') { e.preventDefault(); done(false, true); } }}
      onBlur={() => { if (editing) done(true); }} />;
  return <button ref={button} type="button" className="track-btn inline-rename-btn" aria-label={label} title={label} data-testid={testid} onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing(true)}>✎</button>;
}
