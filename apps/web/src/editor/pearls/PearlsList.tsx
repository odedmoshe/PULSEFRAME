/**
 * The «פנינים» view of the media drawer (wave 7 pearls track). Built against the settled contracts: core sourceRangesContract.ts
 * (ops, PearlsView, PEARL_SHORT_LIMITS), pearls.logic.ts, api.pearls, the strings (pearl.*) and the ids (pearls.testids.ts).
 * Library.tsx mounts it, and lifeline LifeViewSwitch offers the view, only while PEARLS_UI_BUILT is true.
 *
 * The rows come from the read route (GET …/pearls), so what is shown is exactly what this credential may read: when the route says
 * `labelsHidden` the names are not shown and the list says so, never a guessed or cached name. A 501 `pearls_not_built` is the honest
 * "not available yet" state, any other refusal is worded next to the list. Search, «הכול» / «לא בשימוש» / a chip per person; rows by
 * the route's order (capture time, then source time); a row = picture at the span start, name (dir="auto"; F2 renames), time range
 * and length in <bdi dir="ltr">, people, usage line, «סומן על ידי סוכן» for an `agent:` creator.
 * Keyboard: arrows move between rows (roving focus), Enter shows the pearl in the viewer, Shift+Enter inserts it at the playhead,
 * Delete removes it, F2 renames. Every edit is ONE registered operation through editor.commit (one undo each); the two placements
 * go through the pure builder placement.range.ts.
 * Semantics: a list with focusable items (role list), not a listbox, because every row holds buttons and an option may not.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Eye, Film as FilmIcon, Plus, Scissors, Trash2 } from 'lucide-react';
import * as T from '@pulseframe/time';
import { placeRangeArgs, type Asset, type PearlRow, type PearlsView } from '@pulseframe/core';
import { api, ApiFailure } from '../../api.ts';
import { Badge, Button, Chip } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { addedClipDuration, addAssetArgs } from '../placement.ts';
import { placementLabel, placementOps } from '../placement.range.ts';
import { SourceViewer } from '../SourceViewer.tsx';
import { useEditorState } from '../store.ts';
import { PearlThumb } from './PearlThumb.tsx';
import { commitWords } from './pearls.commit.ts';
import { listState, oneLine, personChips, rangeById, secondsText, shortBlock, shortBody, usageNumbers, visibleRows, rowSeconds, type ListState } from './pearls.logic.ts';
import { pearlsT } from './pearls.strings.ts';
import { PEARLS_TESTIDS as ID } from './pearls.testids.ts';
import { getPearlsUi, usePearlsUi } from './pearls.ui.ts';
import './pearls.css';

/** True once the pearls surfaces are built (every mount point checks it). */
export const PEARLS_UI_BUILT = true;

interface Loaded { view: PearlsView | null; failure: { status: number; code: string; message: string } | null; loaded: boolean }

export function PearlsList({ onView }: { onView?: (assetId: string) => void }): ReactElement | null {
  void onView; // the list opens the viewer itself, on the pearl's own stretch
  const { editor, state } = useEditorState();
  const P = pearlsT(state.lang);
  const pid = state.doc?.id ?? null, revision = state.revision, seq = state.activeSequenceId;
  const [res, setRes] = useState<Loaded>({ view: null, failure: null, loaded: false });
  const [text, setText] = useState('');
  const ui = usePearlsUi();
  const [filter, setFilter] = useState(ui.filter);
  const [personId, setPersonId] = useState<string | null>(ui.personId);
  const [viewing, setViewing] = useState<{ rangeId: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // another surface asked for a filter («פנינים שלא בשימוש של …»): take it once per request
  const seen = useRef(ui.n);
  useEffect(() => { if (ui.n !== seen.current) { seen.current = ui.n; const u = getPearlsUi(); setFilter(u.filter); setPersonId(u.personId); } }, [ui.n]);

  useEffect(() => {
    if (!pid) return;
    let live = true;
    api.pearls(pid, seq || undefined).then(
      (view) => { if (live) setRes({ view, failure: null, loaded: true }); },
      (e) => { if (live) setRes({ view: null, failure: e instanceof ApiFailure ? { status: e.status, code: e.code, message: e.message } : { status: 0, code: 'network', message: e instanceof Error ? e.message : String(e) }, loaded: true }); },
    );
    return () => { live = false; };
  }, [pid, revision, seq]);

  const pearls = useMemo(() => (res.view?.ranges ?? []).filter((r) => r.kind === 'pearl'), [res.view]);
  const unused = res.view?.unused ?? [];
  const rows = useMemo(() => visibleRows(pearls, unused, { text, filter, personId }), [pearls, unused, text, filter, personId]);
  const chips = useMemo(() => personChips(pearls), [pearls]);
  const st: ListState = listState(res.view && !pearls.length ? { ...res.view, ranges: [] } : res.view, res.failure);
  const rawDoc = state.rawDoc, doc = state.doc;
  const onClose = useCallback(() => { const id = viewing?.rangeId; setViewing(null); if (id) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-range-id="${CSS.escape(id)}"] [data-testid="${ID.rowShow}"]`)?.focus()); }, [viewing]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const renameGuard = useRef<string | null>(null);
  if (!doc || !rawDoc) return null;
  const hidden = !!res.view?.labelsHidden;

  const fail = (m: string) => setProblem(m);
  const nameOf = (r: PearlRow) => (hidden ? '' : r.label);
  const assetOf = (r: PearlRow): Asset | undefined => (Object.hasOwn(rawDoc.assets, r.assetId) ? rawDoc.assets[r.assetId] : undefined);

  const place = async (r: PearlRow, mode: 'add' | 'insert') => {
    const range = rangeById(rawDoc, r.id), asset = assetOf(r);
    if (!range || !asset) return;
    setBusy(`${mode}:${r.id}`); setProblem(null);
    try {
      const rate = editor.rate;
      const a = placeRangeArgs(rawDoc, range, rate);
      const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
      const live = (id: string | null, kind: 'video' | 'audio') => (id && tracks.some((t) => t.id === id && t.kind === kind && !t.locked) ? id : undefined);
      const playhead = T.frameTime(editor.frame, rate);
      const where = addAssetArgs(doc, r.assetId, { appendPoint: editor.appendPoint(), playhead, videoTarget: editor.target('video'), audioTarget: editor.target('audio') });
      const picture = !!asset.video || asset.kind === 'image';
      const trackId = mode === 'add' ? (where.trackId as string | undefined) : live(editor.target(picture ? 'video' : 'audio'), picture ? 'video' : 'audio');
      const audioTrackId = mode === 'add' ? (where.audioTrackId as string | undefined) : picture && asset.audio ? live(editor.target('audio'), 'audio') : undefined;
      const ops = placementOps({
        mode, assetId: r.assetId, at: mode === 'add' ? (where.start as T.RationalTime) : playhead,
        range: 'sourceIn' in a ? { sourceIn: a.sourceIn, duration: a.duration } : null, ...('sourceIn' in a ? {} : { wholeDuration: addedClipDuration(asset, rate) }),
        ...(trackId ? { trackId } : {}), ...(audioTrackId ? { audioTrackId } : {}),
      });
      if (!ops.length) return;
      const c = await commitWords(editor, ops, placementLabel(mode), P('notBuilt'));
      if (!c.ok) fail(c.message);
    } catch (e) { fail(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const remove = async (r: PearlRow) => {
    setBusy(`delete:${r.id}`); setProblem(null);
    const c = await commitWords(editor, [{ op: 'remove_source_range', args: { rangeId: r.id } }], 'Remove pearl', P('notBuilt'));
    setBusy(null);
    if (!c.ok) { fail(c.message); return; }
    if (c.result.transactionId) editor.notify({ kind: 'undo', title: P('deleted'), undoes: c.result.transactionId });
  };
  const rename = async (r: PearlRow, label: string) => {
    if (renameGuard.current !== r.id) return; // Enter and the blur that follows it must save once
    renameGuard.current = null;
    setRenaming(null);
    const next = oneLine(label);
    if (next === r.label) return;
    setBusy(`rename:${r.id}`); setProblem(null);
    const c = await commitWords(editor, [{ op: 'update_source_range', args: { rangeId: r.id, label: next } }], 'Rename pearl', P('notBuilt'));
    setBusy(null);
    if (!c.ok) fail(c.message);
  };
  const makeShort = async (r: PearlRow) => {
    const body = shortBody(r);
    if (!body || !pid) return;
    setBusy(`short:${r.id}`); setProblem(null);
    try {
      const view = await api.planShorts(pid, body);
      const made = await api.makeShorts(pid, { ...body, expectedRevision: view.revision });
      await editor.load(pid);
      const first = made.sequenceIds[0];
      if (first) editor.setActiveSequence(first);
    } catch (e) { fail(e instanceof ApiFailure ? `${e.message}${e.hint ? ` — ${e.hint}` : ''}` : e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const focusRow = (i: number) => { const els = listRef.current?.querySelectorAll<HTMLElement>(':scope > li'); els?.[Math.max(0, Math.min(i, els.length - 1))]?.focus(); };
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, r: PearlRow, i: number) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(rows.length - 1); }
    else if (e.target !== e.currentTarget) return; // the keys below belong to the row itself, not to a button inside it
    else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) void place(r, 'insert'); else setViewing({ rangeId: r.id }); }
    else if (e.key === 'Delete') { e.preventDefault(); void remove(r); }
    else if (e.key === 'F2' && !hidden) { e.preventDefault(); renameGuard.current = r.id; setRenaming(r.id); }
  };
  const viewed = viewing ? rangeById(rawDoc, viewing.rangeId) : null;

  const stateName: string = !res.loaded ? 'loading' : st;
  return (
    <section className="pf-pearls pf-ds" aria-label={P('view')} data-testid={ID.list} data-state={stateName} aria-busy={!res.loaded || undefined}>
      {st === 'not-built' && <p className="pf-pearls-note" role="status" data-testid="pearls-not-built">{P('notBuilt')}</p>}
      {st === 'refused' && <p className="pf-pearls-note is-problem" role="alert" data-testid="pearls-refused">{isolate(res.failure!.message)}</p>}
      {hidden && <p className="pf-pearls-note" role="status" data-testid="pearls-labels-hidden">{P('labelsHidden')}</p>}
      {(st === 'list' || pearls.length > 0) && (
        <div className="pf-pearls-tools">
          <label className="pf-bw-search">
            <input type="search" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={P('search')} aria-label={P('search')} data-testid={ID.search} />
          </label>
          <div className="pf-pearls-chips" role="group" aria-label={P('view')}>
            <Chip pressed={filter === 'all'} data-testid={ID.filterAll} onClick={() => setFilter('all')}>{P('filterAll')}</Chip>
            <Chip pressed={filter === 'unused'} data-testid={ID.filterUnused} count={unused.length} onClick={() => setFilter('unused')}>{P('filterUnused')}</Chip>
            {chips.map((c) => <Chip key={c.id} pressed={personId === c.id} data-testid={ID.filterPerson} data-person-id={c.id} onClick={() => setPersonId(personId === c.id ? null : c.id)}><bdi dir="auto">{c.name}</bdi></Chip>)}
          </div>
        </div>
      )}
      {st === 'empty' && res.loaded && <p className="pf-pearls-empty" role="status" data-testid="pearls-empty">{P('empty')}</p>}
      {problem && <p className="pf-pearls-note is-problem" role="alert" data-testid="pearls-problem">{isolate(problem)}</p>}
      {rows.length > 0 && (
        <ul ref={listRef} className="pf-pearls-rows" aria-label={P('view')}>
          {rows.map((r, i) => {
            const asset = assetOf(r), isUsed = !unused.includes(r.id), nums = usageNumbers(r, asset ? T.toSeconds(asset.duration) : undefined), len = rowSeconds(r);
            const block = shortBlock(r, !!asset?.video);
            const name = nameOf(r);
            return (
              <li key={r.id} className="pf-pearl-row" tabIndex={r.id === (focusId && rows.some((x) => x.id === focusId) ? focusId : rows[0]!.id) ? 0 : -1} onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(r.id); }} data-testid={ID.row} data-range-id={r.id} data-used={isUsed ? 'yes' : 'no'}
                aria-label={`${name || (hidden ? r.assetName : P('unnamed'))} — ${isUsed ? (nums ? P('used', nums) : P('used', { used: '·', total: '·' })) : P('unused')}`}
                onKeyDown={(e) => onRowKey(e, r, i)}>
                {asset && pid && <PearlThumb projectId={pid} asset={asset} span={r.span} />}
                <div className="pf-pearl-main">
                  {renaming === r.id
                    ? <input className="pf-pearl-rename" dir="auto" maxLength={200} autoFocus defaultValue={r.label} aria-label={P('name')} data-testid={ID.formName}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void rename(r, e.currentTarget.value); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renameGuard.current = null; setRenaming(null); (e.currentTarget.closest('li') as HTMLElement | null)?.focus(); } }}
                        onBlur={(e) => void rename(r, e.currentTarget.value)} />
                    : <b className="pf-pearl-label" dir="auto">{name || (hidden ? '' : P('unnamed'))}{hidden && <span className="pf-film-muted">{isolate(r.assetName)}</span>}</b>}
                  {!hidden && name && <span className="pf-pearl-file" dir="auto">{isolate(r.assetName)}</span>}
                  <span className="pf-pearl-time">
                    {r.span && r.startSeconds !== null && r.endSeconds !== null
                      ? <><bdi dir="ltr" className="num">{secondsText(r.startSeconds)}–{secondsText(r.endSeconds)}</bdi> · <bdi dir="ltr" className="num">{secondsText(len ?? 0)}</bdi></>
                      : P('wholeFile')}
                  </span>
                  {r.people.length > 0 && <span className="pf-pearl-people">{r.people.map((p) => <Badge key={p.id} tone="neutral"><bdi dir="auto">{p.name}</bdi></Badge>)}</span>}
                  <span className="pf-pearl-usage" data-testid={ID.rowUsage}>{isUsed ? (nums ? isolate(P('used', nums)) : isolate(P('used', { used: '·', total: '·' }))) : P('unused')}</span>
                  {r.usage.untimedCopies.length > 0 && <span className="pf-film-muted">{P('untimedCopy')}</span>}
                  {r.byAgent && <Badge tone="agent">{P('byAgent')}</Badge>}
                </div>
                <div className="pf-pearl-actions">
                  <Button size="sm" variant="ghost" icon={<Eye size={14} aria-hidden="true" />} data-testid={ID.rowShow} onClick={() => setViewing({ rangeId: r.id })}>{P('show')}</Button>
                  <Button size="sm" variant="ghost" icon={<Plus size={14} aria-hidden="true" />} data-testid={ID.rowAddEnd} busy={busy === `add:${r.id}`} onClick={() => void place(r, 'add')}>{P('addEnd')}</Button>
                  <Button size="sm" variant="ghost" icon={<FilmIcon size={14} aria-hidden="true" />} data-testid={ID.rowInsert} busy={busy === `insert:${r.id}`} onClick={() => void place(r, 'insert')}>{P('insertAt')}</Button>
                  <Button size="sm" variant="ghost" icon={<Scissors size={14} aria-hidden="true" />} data-testid={ID.rowShort} busy={busy === `short:${r.id}`}
                    {...(block ? { disabledReason: P(`shortBlocked.${block}`) } : {})} onClick={() => void makeShort(r)}>{P('short')}</Button>
                  <Button size="sm" variant="danger-quiet" icon={<Trash2 size={14} aria-hidden="true" />} data-testid={ID.rowDelete} busy={busy === `delete:${r.id}`} onClick={() => void remove(r)}>{P('delete')}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {viewing && viewed?.span && <SourceViewer assetId={viewed.assetId} startAt={viewed.span.start} initialSpan={viewed.span} onClose={onClose} />}
      {viewing && viewed && !viewed.span && <SourceViewer assetId={viewed.assetId} onClose={onClose} />}
    </section>
  );
}
