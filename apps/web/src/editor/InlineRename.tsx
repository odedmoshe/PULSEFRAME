/**
 * A name with a small "rename" button. The button turns the name into a field: Enter or leaving the field commits, Escape cancels.
 * Keyboard and screen-reader users get a real button and a labelled field (no double-click needed).
 */
import { useEffect, useRef, useState } from 'react';

export function InlineRename({ value, label, onCommit, testid, className }: { value: string; label: string; onCommit: (name: string) => void; testid: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editing) { setText(value); input.current?.focus(); input.current?.select(); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (commit: boolean) => {
    setEditing(false);
    const next = text.trim();
    if (commit && next && next !== value) onCommit(next);
    setTimeout(() => button.current?.focus(), 0);
  };
  if (editing)
    return <input ref={input} className={`inline-rename-input ${className ?? ''}`} dir="auto" value={text} aria-label={label} data-testid={`${testid}-input`} maxLength={120}
      onChange={(e) => setText(e.target.value)} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } }}
      onBlur={() => { if (editing) done(true); }} />;
  return <button ref={button} type="button" className="track-btn inline-rename-btn" aria-label={label} title={label} data-testid={testid} onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing(true)}>✎</button>;
}
