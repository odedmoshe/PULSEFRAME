/**
 * «חיפוש והחלפה» (Ctrl+F): a non-modal role="dialog" at the inspector's edge, so the stage and the timeline stay live. It handles and
 * stops its own keys: in the list every unmodified key (Q, D, Delete, Space, arrows, Enter …) never reaches the window's shortcut
 * dispatcher (proof F10). Flags are stated as the rules they are (a line under each). The search is the server's (POST …/text/find,
 * the project's revision with the answer); the replacement is planned on the document of that revision (core planReplace) and committed
 * as ONE replace_text transaction at that revision (commitExact), so an edit in between answers «הפרויקט השתנה — בדקו שוב» and changes
 * nothing. The list is a listbox: arrows move, Space ticks a row, Enter goes to the clip (seeks and selects).
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import { type FindResult, type ProjectDocument } from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { afterOf, clipOfMatch, craftFailure, DEFAULT_FIND, findQueryOf, groupMatches, listKey, noteLines, replaceNotes, replacePlanOf, replaceablePicks, say, snippetOf, type FindOptions, type Failure } from './craft.logic.ts';

type Flag = 'wholeWord' | 'ignoreMarks' | 'finalsEqual' | 'ignoreCase';
const FLAGS: { flag: Flag; label: 'wholeWord' | 'ignoreMarks' | 'finalsEqual' | 'ignoreCase'; rule: 'ruleWholeWord' | 'ruleIgnoreMarks' | 'ruleFinalsEqual' | 'ruleIgnoreCase' }[] = [
  { flag: 'wholeWord', label: 'wholeWord', rule: 'ruleWholeWord' }, { flag: 'ignoreMarks', label: 'ignoreMarks', rule: 'ruleIgnoreMarks' },
  { flag: 'finalsEqual', label: 'finalsEqual', rule: 'ruleFinalsEqual' }, { flag: 'ignoreCase', label: 'ignoreCase', rule: 'ruleIgnoreCase' },
];
interface Shown { result: FindResult; query: NonNullable<ReturnType<typeof findQueryOf>>; doc: ProjectDocument | null }
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function FindReplacePanel() {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const id = useId();
  const [text, setText] = useState('');
  const [repl, setRepl] = useState('');
  const [opts, setOpts] = useState<FindOptions>(DEFAULT_FIND);
  const [shown, setShown] = useState<Shown | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [active, setActive] = useState(0);
  const [error, setError] = useState<Failure | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const pid = state.doc?.id;
  const selection = state.selection;
  const viewed = state.viewVariantId;
  const query = useMemo(() => findQueryOf(text, opts, selection, viewed), [text, opts, selection, viewed]);
  const close = () => { craftSurface.set(null); const o = opener.current; setTimeout(() => { if (o && o.isConnected) o.focus(); }, 0); };

  // Ctrl+F again (or the command from elsewhere) brings the focus back to the search field
  const serial = craftSurface.serial;
  useEffect(() => { findRef.current?.focus(); findRef.current?.select(); }, [serial]);

  // search: after a short pause, the server's answer with its revision; the document of that revision is kept for planning
  useEffect(() => {
    const mine = ++seq.current;
    setError(null);
    if (!pid || !query) { setShown(null); setSearching(false); setStale(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      api.findText(pid, query).then((result) => {
        if (mine !== seq.current) return;
        const s = editor.getState();
        const doc = s.revision === result.revision ? s.rawDoc : null;
        setShown({ result, query, doc }); setStale(!doc); setSearching(false); setActive(0);
        setPicked(new Set(result.matches.map((_m, i) => i)));
      }, (e) => { if (mine === seq.current) { setShown(null); setSearching(false); setError(craftFailure(lang, e)); } });
    }, 250);
    return () => clearTimeout(timer);
  }, [pid, query, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  // the project moved since the answer: said at once; replacing then answers the same from the server and changes nothing
  useEffect(() => { if (shown && state.revision !== shown.result.revision) setStale(true); }, [state.revision, shown]);

  const matches = shown?.result.matches ?? [];
  const groups = useMemo(() => (state.rawDoc && shown ? groupMatches(state.rawDoc, matches, lang) : []), [state.rawDoc, shown, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const picks = useMemo(() => replaceablePicks(matches, repl, picked), [matches, repl, picked]);
  const planned = useMemo(() => (shown?.doc && picks.length ? replacePlanOf(shown.doc, shown.query, repl, picks) : null), [shown, picks, repl]);
  const notes = useMemo(() => (planned ? noteLines(lang, replaceNotes(planned.plan)) : []), [planned, lang]);
  const truncated = !!shown?.result.truncated;

  const jump = (i: number) => {
    const m = matches[i];
    if (!m) return;
    if (m.frame !== null) editor.seek(m.frame);
    const clip = clipOfMatch(m);
    if (clip) editor.select(clip);
  };
  const go = async (only: number | null) => {
    if (!shown || busy) return;
    const use = only === null ? picks : picks.filter((i) => i === only);
    const built = shown.doc ? replacePlanOf(shown.doc, shown.query, repl, use) : null;
    if (!shown.doc) { setStale(true); return; }
    if (!built) { setError({ code: null, message: say(lang, 'replaceNothing') }); return; }
    setBusy(true); setError(null);
    const r = await editor.commitExact(built.ops, 'Replace text', shown.result.revision, `craft:find:${shown.result.revision}:${hash(JSON.stringify(built.ops))}`);
    setBusy(false);
    if (r.kind === 'committed') {
      editor.notify({ kind: r.result.transactionId ? 'undo' : 'info', title: say(lang, 'replaceDone', { n: built.plan.edits.length }), ...(r.result.transactionId ? { undoes: r.result.transactionId } : {}) });
      setStale(false); setError(null);
      // the document moved by our own commit: search again on the new revision
      const q = shown.query, pidNow = pid!;
      api.findText(pidNow, q).then((result) => { const s = editor.getState(); setShown({ result, query: q, doc: s.revision === result.revision ? s.rawDoc : null }); setStale(s.revision !== result.revision); setActive(0); setPicked(new Set(result.matches.map((_m, i) => i))); }, () => undefined);
    } else if (r.kind === 'stale') { setStale(true); setError({ code: 'stale_revision', message: say(lang, 'projectChanged') }); }
    else setError({ code: r.code, message: translateRefusal(lang, r.message) ?? r.message, ...(lang === 'en' && r.hint ? { hint: r.hint } : {}) });
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // every key without Ctrl/⌘ belongs to the panel; chords (undo, Ctrl+S, Ctrl+F …) go on to the editor's own rules
    if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const next = listKey(e.key, active, matches.length);
    if (next !== null) { e.preventDefault(); setActive(next); document.getElementById(`${id}-o${next}`)?.scrollIntoView?.({ block: 'nearest' }); return; }
    if (e.key === ' ') { e.preventDefault(); setPicked((p) => { const n = new Set(p); if (n.has(active)) n.delete(active); else n.add(active); return n; }); }
    else if (e.key === 'Enter') { e.preventDefault(); jump(active); }
  };
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const countText = !query ? say(lang, 'findEmptyQuery') : searching ? say(lang, 'findSearching') : shown ? (shown.result.total === 0 ? say(lang, 'findNone', { q: text }) : `${shown.result.total === 1 ? say(lang, 'findCountOne') : say(lang, 'findCountMany', { n: shown.result.total })}${picks.length !== shown.result.total ? ` · ${say(lang, 'findPicked', { n: picks.length })}` : ''}`) : '';
  const set = <K extends keyof FindOptions>(k: K, v: FindOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const noClips = selection.length === 0, noFormat = !viewed;
  return (
    <div className="pf-craft-pop pf-craft-find" role="dialog" aria-modal="false" aria-labelledby={`${id}-t`} dir={dir} lang={lang} data-testid={TID.findPanel} onKeyDown={onPanelKey}>
      <div className="pf-craft-row"><h2 id={`${id}-t`}>{say(lang, 'findTitle')}</h2><span className="spacer" /><button type="button" className="ghost" onClick={close} aria-label={say(lang, 'close')}>×</button></div>
      <label>{say(lang, 'find')}
        <input ref={findRef} type="text" dir="auto" value={text} maxLength={200} data-testid={TID.findInput} autoComplete="off" onChange={(e) => setText(e.target.value)} />
      </label>
      <label>{say(lang, 'replaceWith')}
        <input type="text" dir="auto" value={repl} maxLength={4000} data-testid={TID.replaceInput} autoComplete="off" onChange={(e) => setRepl(e.target.value)} />
      </label>
      <fieldset>
        {FLAGS.map((f) => (
          <div className="pf-craft-flag" key={f.flag}>
            <label><input type="checkbox" checked={opts[f.flag]} aria-describedby={`${id}-${f.flag}`} data-testid={`${TID.findOption}-${f.flag}`} onChange={(e) => set(f.flag, e.target.checked)} /> {say(lang, f.label)}</label>
            <span className="rule" id={`${id}-${f.flag}`}>{say(lang, f.rule)}</span>
          </div>
        ))}
        <p className="pf-craft-hint">{say(lang, 'presentationFormsNote')}</p>
      </fieldset>
      <fieldset>
        <legend>{say(lang, 'where')}</legend>
        <label><input type="radio" name={`${id}-scope`} checked={opts.scope === 'project'} onChange={() => set('scope', 'project')} data-testid="craft-find-scope-project" /> {say(lang, 'wholeProject')}</label>
        <label><input type="radio" name={`${id}-scope`} checked={opts.scope === 'clips'} disabled={noClips} aria-describedby={noClips ? `${id}-noclips` : undefined} onChange={() => set('scope', 'clips')} data-testid="craft-find-scope-clips" /> {say(lang, 'selectedClips')}{noClips && <span className="pf-craft-hint" id={`${id}-noclips`}> — {say(lang, 'noClipsSelected')}</span>}</label>
      </fieldset>
      <fieldset>
        <legend>{say(lang, 'formats')}</legend>
        {(['all', 'master', 'viewed'] as const).map((f) => (
          <label key={f}><input type="radio" name={`${id}-fmt`} checked={opts.formats === f} disabled={f === 'viewed' && noFormat} onChange={() => set('formats', f)} data-testid={`craft-find-formats-${f}`} /> {say(lang, f === 'all' ? 'allFormats' : f === 'master' ? 'masterOnly' : 'viewedFormat')}{f === 'viewed' && noFormat && <span className="pf-craft-hint"> — {say(lang, 'noFormatShown')}</span>}</label>
        ))}
      </fieldset>
      <p className="pf-craft-line" role="status" aria-live="polite" data-testid="craft-find-count" data-total={shown?.result.total ?? ''} data-kind={searching ? 'busy' : shown && shown.result.total === 0 ? 'none' : 'ok'}>{countText}</p>
      {truncated && shown && <p className="pf-craft-error" role="status">{say(lang, 'findTruncated', { total: shown.result.total, n: matches.length })}</p>}
      {matches.length > 0 && (
        <>
          <div ref={listRef} className="pf-craft-list" role="listbox" aria-multiselectable="true" aria-label={say(lang, 'findListLabel')} aria-describedby={`${id}-keys`} tabIndex={0} aria-activedescendant={`${id}-o${active}`}
            data-testid={TID.findList} onKeyDown={onListKey}>
            {groups.map((g) => (
              <div role="group" aria-label={g.label} key={g.key + g.items[0]}>
                <div className="pf-craft-gl" aria-hidden="true">{g.label}</div>
                {g.items.map((i) => {
                  const m = matches[i]!;
                  const sn = snippetOf(m.text, m.ranges);
                  const after = afterOf(m, repl);
                  const asn = after ? snippetOf(after.text, after.spans.map(([s, e]) => [s, e] as [number, number])) : null;
                  const ticked = picked.has(i) && !!after;
                  return (
                    <div key={i} id={`${id}-o${i}`} role="option" aria-selected={ticked} aria-disabled={!after || undefined} className="pf-craft-opt" data-active={i === active} data-testid={`${TID.findRow}-${i}`} data-kind={m.kind}
                      onClick={() => { setActive(i); listRef.current?.focus(); if (after) setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; }); }} onDoubleClick={() => jump(i)}>
                      <span className="tick" aria-hidden="true">{ticked ? '☑' : '☐'}</span>
                      <span className="lines">
                        <div dir="auto">{sn.cutBefore && '… '}{sn.parts.map((p, k) => (p.match ? <mark key={k}><bdi>{p.text}</bdi></mark> : <Fragment key={k}><bdi>{p.text}</bdi></Fragment>))}{sn.cutAfter && ' …'}</div>
                        {(asn ? <div className="after" dir="auto">→ {asn.cutBefore && '… '}{asn.parts.map((p, k) => (p.match ? <mark key={k}><bdi>{p.text}</bdi></mark> : <Fragment key={k}><bdi>{p.text}</bdi></Fragment>))}{asn.cutAfter && ' …'}</div> : <div className="after pf-craft-error">{say(lang, 'findRowEmpty')}</div>)}
                        {m.frame !== null && <div className="where"><bdi dir="ltr">{T.toTimecode(T.frameTime(m.frame, editor.rate), editor.rate)}</bdi></div>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="pf-craft-hint" id={`${id}-keys`}>{say(lang, 'findKeysHint')}</p>
        </>
      )}
      {notes.length > 0 && <ul className="pf-craft-notes" data-testid={TID.findNotes}>{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {stale && <p className="pf-craft-error" role="alert" data-testid="craft-find-stale">{error?.code === 'stale_revision' ? error.message : say(lang, 'projectChanged')}</p>}
      {error && error.code !== 'stale_revision' && <p className="pf-craft-error" role="alert" data-code={error.code ?? undefined}><bdi dir="auto">{error.message}</bdi>{error.hint ? <> — <bdi dir="auto">{error.hint}</bdi></> : null}</p>}
      <div className="pf-craft-row">
        <button type="button" className="ghost" data-testid="craft-replace-one" disabled={busy || !matches.length || !picks.includes(active) || truncated} onClick={() => void go(active)}>{say(lang, 'replaceOne')}</button>
        <button type="button" className="primary" data-testid={TID.replaceAll} disabled={busy || !picks.length || truncated} aria-busy={busy || undefined} onClick={() => void go(null)}>{say(lang, 'replaceAllCount', { n: picks.length })}</button>
      </div>
    </div>
  );
}
