/**
 * One event of the library (life line, ADR-0021; plan §7): its name (typed, or derived from a holiday, or its date), the
 * Hebrew date, a count and a strip of thumbnails; a ⋯ menu (שינוי שם, מיזוג עם הקודם, פיצול מכאן, הסרת הקיבוץ, הזזת השעון);
 * «הוספת האירוע לציר הזמן» (its clips in capture order: existing add_clip operations, ONE transaction); and, when the two
 * sunset readings differ, a fieldset «מתי צולם?» with two radios that is NEVER preselected (update_event afterSunset). One
 * answer names the event by its holiday, and Ctrl+Z (or the toast) takes it back: the answer is one operation.
 * Test ids: LIFE_TESTIDS.event(id), eventName(id), sunset(id), eventAdd(id).
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Plus } from 'lucide-react';

import { eventDisplayName } from '@pulseframe/core';
import { Badge, Button, AnchoredError } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { onMenuKeyDown } from '../menuKeys.ts';
import { LifeThumb } from './LifeThumb.tsx';
import { FamilyFilmEntry } from '../FamilyFilmEntry.tsx';
import { StoryEntry } from '../story/StoryEntry.tsx';
import { isPictureAsset } from '../familyFilm.logic.ts';
import { ClockShift } from './CaptureEditor.tsx';
import { LIFE_STRINGS, fill } from './lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import { useLifeUi } from './lifeUi.ts';
import { addEventOps, eventFilesInOrder, eventHeading, eventModel, mergePreviousOps, previousEvent, splitOps, sunsetChoices } from './lifeLibrary.logic.ts';
import './lifeline.css';

export function EventRow({ eventId }: { eventId: string }): ReactElement | null {
  const { editor, state } = useEditorState();
  const doc = state.doc;
  const lang = state.lang;
  const S = LIFE_STRINGS[lang];
  const ui = useLifeUi();
  const root = useRef<HTMLLIElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [splitAt, setSplitAt] = useState('');
  const [shifting, setShifting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const legend = useId();
  const event = doc && Object.hasOwn(doc.events ?? {}, eventId) ? doc.events[eventId]! : null;
  // another part of the editor asked for this event to be shown (a field's fix, the «on this day» card): scroll to it and focus its first control
  useEffect(() => {
    if (ui.showEvent?.eventId !== eventId) return;
    root.current?.scrollIntoView?.({ block: 'center' });
    (root.current?.querySelector<HTMLElement>('input[type=radio]') ?? root.current?.querySelector<HTMLElement>('button'))?.focus();
  }, [ui.showEvent?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); btn.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc, true);
    pop.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [menu]);
  if (!doc || !event) return null;
  const m = eventModel(doc, event, lang);
  const choice = sunsetChoices(doc, event, lang, { before: S.sunsetBefore, after: S.sunsetAfter });
  const files = eventFilesInOrder(doc, event);
  const filmFiles = files.filter((id) => isPictureAsset(doc.assets[id]));
  const prev = previousEvent(doc, eventId, lang);
  const heading = eventHeading(m, S.eventUntitled);
  const toast = (title: string, transactionId: string | null | undefined, body?: string) => { if (transactionId) editor.notify({ kind: 'undo', title, ...(body ? { body } : {}), undoes: transactionId }); };
  const open = () => { const r = btn.current!.getBoundingClientRect(); const rtl = document.documentElement.dir === 'rtl'; setMenu({ top: Math.min(r.bottom + 4, window.innerHeight - 240), left: Math.max(8, Math.min(rtl ? r.right - 232 : r.left, window.innerWidth - 240)) }); };

  const answer = async (afterSunset: boolean) => {
    setProblem(null);
    const r = await editor.commit([{ op: 'update_event', args: { eventId, afterSunset } }], 'Sunset answer');
    if (!r) return;
    const now = editor.doc && Object.hasOwn(editor.doc.events ?? {}, eventId) ? editor.doc.events[eventId]! : null;
    const named = now && editor.doc ? eventDisplayName(editor.doc, now, lang) : null;
    toast(named?.name ? fill(S.eventNamed, { name: named.name }) : fill(S.eventSunsetSaved, { answer: afterSunset ? S.sunsetAfter : S.sunsetBefore }), r.transactionId);
  };
  const saveName = async () => {
    const name = draft.trim().replace(/[\r\n]+/g, ' ');
    setRenaming(false);
    if (name === event.name) return;
    const r = await editor.commit([{ op: 'update_event', args: { eventId, name } }], 'Rename event');
    if (r && name) toast(fill(S.eventNamed, { name }), r.transactionId);
  };
  const addToTimeline = async () => {
    const ops = addEventOps(doc, event, { appendPoint: editor.appendPoint(), playhead: editor.playhead, videoTarget: editor.target('video') });
    if (!ops.length) { setProblem(S.eventAddNone); return; }
    setProblem(null);
    const r = await editor.commit(() => { const d = editor.doc; const e = d && Object.hasOwn(d.events ?? {}, eventId) ? d.events[eventId]! : null; return d && e ? addEventOps(d, e, { appendPoint: editor.appendPoint(), playhead: editor.playhead, videoTarget: editor.target('video') }) : null; }, 'Add event to timeline');
    if (r) toast(S.eventAdded, r.transactionId, fill(S.eventAddedBody, { n: ops.length }));
  };
  const act = async (what: 'rename' | 'merge' | 'split' | 'remove' | 'shift') => {
    setMenu(null);
    if (what === 'rename') { setDraft(event.name); setRenaming(true); return; }
    if (what === 'split') { setSplitAt(files[1] ?? ''); setSplitting(true); return; }
    if (what === 'shift') { setShifting(true); return; }
    if (what === 'merge') {
      const ops = mergePreviousOps(doc, eventId, lang);
      if (ops) { const r = await editor.commit(ops, 'Merge events'); if (r) toast(S.eventMerged, r.transactionId); }
      return;
    }
    const r = await editor.commit([{ op: 'remove_event', args: { eventId } }], 'Remove event grouping');
    if (r) toast(S.eventRemoved, r.transactionId);
  };
  const doSplit = async () => {
    const ops = splitOps(doc, eventId, splitAt);
    setSplitting(false);
    if (ops) { const r = await editor.commit(ops, 'Split event'); if (r) toast(S.eventSplit, r.transactionId); }
  };
  return (
    <li ref={root} className="pf-ev" data-testid={LIFE_TESTIDS.event(eventId)} data-event-id={eventId} data-name-kind={m.nameKind}>
      <div className="pf-ev-strip" aria-hidden="true">
        {files.slice(0, 4).map((id) => <LifeThumb key={id} projectId={doc.id} assetId={id} className="pf-ev-th" />)}
        {files.length > 4 && <span className="pf-ev-more num">+{files.length - 4}</span>}
      </div>
      <div className="pf-ev-head">
        <div className="pf-ev-title">
          {renaming ? (
            <form className="pf-ev-rename" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
              <label><span className="pf-sr">{S.eventRenameLabel}</span>
                <input type="text" dir="auto" value={draft} maxLength={120} autoFocus placeholder={S.eventRenameLabel} aria-describedby={`${legend}-hint`} data-testid={`${LIFE_TESTIDS.eventName(eventId)}-input`} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); } }} />
              </label>
              <Button size="sm" variant="primary" type="submit">{S.captureSave}</Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>{S.cancel}</Button>
              <span id={`${legend}-hint`} className="pf-life-note">{S.eventRenameHint}</span>
            </form>
          ) : (
            <strong className="pf-ev-name" dir="auto" data-testid={LIFE_TESTIDS.eventName(eventId)}>{m.name ? m.name : <bdi className="num" dir="ltr">{heading}</bdi>}</strong>
          )}
          {m.nameKind === 'holiday' && !renaming && <Badge tone="hollow">{S.eventDerived}</Badge>}
        </div>
        <p className="pf-ev-meta">
          {m.name && m.dateLabel && <bdi className="num" dir="ltr">{m.dateLabel}</bdi>}
          {m.hebrewLabel && <bdi dir="rtl" className="pf-ev-heb">{m.hebrewLabel}</bdi>}
          <span className="pf-ev-count">{fill(S.eventFiles, { n: m.count })}</span>
        </p>
      </div>
      <div className="pf-ev-actions">
        <Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />} data-testid={LIFE_TESTIDS.eventAdd(eventId)} onClick={() => void addToTimeline()}>{S.eventAddToTimeline}</Button>
        {/* the family film of this event (ADR-0026): its pictures and videos in capture order, with its name and day for the title */}
        {filmFiles.length > 0 && <FamilyFilmEntry variant="event-card" lang={lang} source={{ assetIds: filmFiles, event: m.name ? { id: eventId, name: m.name.slice(0, 80), ...(m.first && /^\d{4}-\d{2}-\d{2}/.test(m.first) ? { date: m.first.slice(0, 10) } : {}) } : null }} />}
        <button ref={btn} type="button" className="pf-life-more" aria-haspopup="menu" aria-expanded={!!menu} aria-label={`${S.eventMenu}: ${heading}`} title={S.eventMenu} data-testid={`life-event-menu-${eventId}`} onClick={() => (menu ? setMenu(null) : open())}><Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      {choice && (
        <fieldset className="pf-ev-sunset" data-testid={LIFE_TESTIDS.sunset(eventId)} aria-describedby={`${legend}-note`}>
          <legend id={legend}>{S.sunsetLegend}</legend>
          {choice.choices.map((c) => (
            <label key={String(c.value)} className="pf-life-radio">
              <input type="radio" name={`sunset-${eventId}`} value={c.value ? 'after' : 'before'} checked={choice.selected === c.value} data-value={c.value ? 'after' : 'before'} onChange={() => void answer(c.value)} />
              <span dir="auto">{c.label}</span>
            </label>
          ))}
          <p id={`${legend}-note`} className="pf-life-note">{S.sunsetNote}</p>
        </fieldset>
      )}
      {splitting && (
        <div className="pf-ev-split">
          <label className="pf-life-field"><span>{S.splitPickLabel}</span>
            <select value={splitAt} onChange={(e) => setSplitAt(e.target.value)} data-testid={`life-event-split-${eventId}`}>
              {files.slice(1).map((id) => <option key={id} value={id}>{doc.assets[id]?.name ?? id}</option>)}
            </select>
          </label>
          <Button size="sm" variant="primary" onClick={() => void doSplit()}>{S.eventSplitHere}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSplitting(false)}>{S.cancel}</Button>
        </div>
      )}
      {problem && <AnchoredError onDismiss={() => setProblem(null)} dismissLabel={S.cancel}>{problem}</AnchoredError>}
      {shifting && <ClockShift assetIds={files} onClose={() => setShifting(false)} />}
      {menu && createPortal(
        <div ref={pop} className="pf-ds pf-mc-pop" style={{ top: menu.top, left: menu.left }}>
          <div className="pf-mc-menu" role="menu" aria-label={`${S.eventMenu}: ${heading}`} onKeyDown={(e) => { if (e.key === 'Tab') { setMenu(null); btn.current?.focus(); } else onMenuKeyDown(e); }}>
            <button type="button" role="menuitem" className="pf-mc-item" data-testid={`life-event-rename-${eventId}`} onClick={() => void act('rename')}>{S.eventRename}</button>
            <button type="button" role="menuitem" className="pf-mc-item" disabled={!prev} data-testid={`life-event-merge-${eventId}`} onClick={() => void act('merge')}>{S.eventMergePrev}</button>
            <button type="button" role="menuitem" className="pf-mc-item" disabled={files.length < 2} data-testid={`life-event-splitopen-${eventId}`} onClick={() => void act('split')}>{S.eventSplitHere}</button>
            <button type="button" role="menuitem" className="pf-mc-item" onClick={() => void act('shift')}>{S.shiftClock}</button>
            {/* «ספרו מה היה» (wave 7 story track; C14): in the ⋯ menu, never a second button in the row */}
            {filmFiles.length > 0 && <StoryEntry variant="event-menu" lang={lang} onChosen={() => setMenu(null)} source={{ assetIds: filmFiles, event: m.name ? { id: eventId, name: m.name.slice(0, 80), ...(m.first && /^\d{4}-\d{2}-\d{2}/.test(m.first) ? { date: m.first.slice(0, 10) } : {}) } : null }} />}
            <div role="separator" className="pf-mc-sep" />
            <button type="button" role="menuitem" className="pf-mc-item is-danger" data-testid={`life-event-remove-${eventId}`} onClick={() => void act('remove')}>{S.eventRemove}</button>
          </div>
        </div>, document.body)}
    </li>
  );
}
