/**
 * The one-line name field Ctrl+S opens (wave 7 craft): prefilled «גרסה 4 · 25.11 14:32»; Enter saves a named version of the film
 * (POST …/versions) and a toast says so; Escape closes. Opening it commits nothing, so Ctrl+S with the cursor in a title field only
 * shows this field. A refusal (the 50-version limit, a propose-only credential, a full disk) stays on the field in words.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { craftFailure, defaultVersionName, nameProblem, say, type Failure } from './craft.logic.ts';

export function SaveVersionField() {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const doc = state.doc;
  const [name, setName] = useState(() => defaultVersionName(lang, [], new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const id = useId();
  const pid = doc?.id;
  const close = () => { craftSurface.set(null); const o = opener.current; setTimeout(() => { if (o && o.isConnected) o.focus(); }, 0); };
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  // the next number comes from the versions already saved; the field keeps what the person typed meanwhile
  useEffect(() => {
    if (!pid) return;
    let live = true;
    api.versions(pid).then((r) => { if (live) setName((cur) => (touched ? cur : defaultVersionName(lang, r.versions.map((v) => v.name), new Date()))); }, () => undefined);
    return () => { live = false; };
  }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pid) return null;
  const problem = nameProblem(lang, name);
  const save = async () => {
    if (busy) return;
    if (problem) { setError({ code: null, message: problem }); input.current?.focus(); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.saveVersion(pid, name.trim());
      editor.notify({ kind: 'info', title: say(lang, 'saveSaved', { name: r.name }) });
      close();
    } catch (e) { setError(craftFailure(lang, e)); setBusy(false); input.current?.focus(); }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const save2 = (e.ctrlKey || e.metaKey) && e.code === 'KeyS';
    if (!(e.ctrlKey || e.metaKey) || save2) e.stopPropagation();
    if (e.key === 'Enter' || save2) { e.preventDefault(); void save(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  return (
    <div className="pf-craft-pop pf-craft-save" role="dialog" aria-modal="false" aria-labelledby={`${id}-t`} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-testid={TID.saveVersionField}>
      <h2 id={`${id}-t`}>{say(lang, 'saveVersion')}</h2>
      <input ref={input} type="text" dir="auto" value={name} maxLength={200} aria-label={say(lang, 'saveNameLabel')} aria-describedby={`${id}-h`} aria-invalid={!!error || undefined} data-testid={TID.saveVersionInput}
        onChange={(e) => { setTouched(true); setName(e.target.value); setError(null); }} onKeyDown={onKey} />
      {error && <p className="pf-craft-error" role="alert" data-code={error.code ?? undefined}><bdi dir="auto">{error.message}</bdi>{error.hint ? <> — <bdi dir="auto">{error.hint}</bdi></> : null}</p>}
      <p id={`${id}-h`} className="pf-craft-hint">{busy ? say(lang, 'saving') : say(lang, 'saveHint')}</p>
      <div className="pf-craft-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{say(lang, 'saveVersion')}</button>
        <button type="button" className="ghost" onClick={close}>{say(lang, 'cancel')}</button>
      </div>
    </div>
  );
}
