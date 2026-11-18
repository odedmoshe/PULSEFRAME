/**
 * Live fields of a title (life line, ADR-0021; plan §7), under the text box of the title inspector: the menu «הוסף שדה»
 * (תאריך צילום, תאריך עברי, שנה, שנה עברית, שם האירוע and, for the project's people, גיל / שם, with «הוספת אדם…»), each item
 * with its value at the playhead or «אין נתון»; the `aria-live=polite` line «מוצג כעת: …», or an anchored error with the fix
 * («אין תאריך לקליפ שמתחת לכותרת · קביעת תאריך», «התאריך העברי תלוי בשקיעה · בחירה באירוע»); and «קבע כטקסט רגיל» with an
 * undo toast.
 * Inserting at the caret is ONE transaction: update_text (existing braces doubled: core escapeFieldText; the token added) +
 * set_text_fields enabled:true. «קבע כטקסט רגיל» commits the operations core freezeOps returns, and only when no field lacks
 * data. The text box of a title with fields shows the readable form (core fieldsToDisplay / fieldsFromDisplay): FieldTextBox.
 * Nothing here is kept in browser storage; every edit is editor.commit with registered operations.
 * Test ids: LIFE_TESTIDS.fieldAdd, fieldItem(token), fieldLive, fieldFreeze.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Snowflake } from 'lucide-react';
import { eventOfAsset, findClip, type MissingReason, type TextClip } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { AnchoredError, Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { onMenuKeyDown } from '../menuKeys.ts';
import { CaptureEditor } from './CaptureEditor.tsx';
import { boxText, commitBox, fixedItems, freezeModel, insertField, insertOps, liveModel, personItems, pictureUnder, timeInTitle, valueAt, type FixKind, type FieldItem } from './fieldText.logic.ts';
import { LIFE_STRINGS, fill, type LifeKey, type LifeWords } from './lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import { PEOPLE_STRINGS, type PeopleWords } from './people.strings.ts';
import { openPeople, showEvent } from './lifeUi.ts';
import './lifeline.css';

const FORMAT_KEY: Record<string, LifeKey> = { long: 'fieldFormatLong', numeric: 'fieldFormatNumeric', monthYear: 'fieldFormatMonthYear', english: 'fieldFormatEnglish', monthYearEnglish: 'fieldFormatMonthYearEnglish', noYear: 'fieldFormatNoYear' };
const itemLabel = (S: LifeWords, i: FieldItem): string => `${S[i.words.base as LifeKey]}${i.words.format ? ` · ${S[FORMAT_KEY[i.words.format]!]}` : ''}`;
const GROUPS: { id: 'date' | 'hebrewDate' | 'other'; label: LifeKey }[] = [{ id: 'date', label: 'fieldDate' }, { id: 'hebrewDate', label: 'fieldHebrewDate' }, { id: 'other', label: 'fieldYear' }];

/** The title `clipId` with the sequence it is in, or null. */
function useTitle(clipId: string): { clip: TextClip; seqId: string } | null {
  const { state } = useEditorState();
  const f = state.doc ? findClip(state.doc, clipId) : undefined;
  return f && f.clip.type === 'text' ? { clip: f.clip, seqId: f.seq.id } : null;
}

/** The «הוסף שדה» menu and «קבע כטקסט רגיל» for the title `clipId`; `caret` is where the token goes in the text box (null = the end). */
export function FieldMenu({ clipId, caret }: { clipId: string; caret: number | null }): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const title = useTitle(clipId);
  const lang = state.lang;
  const S = LIFE_STRINGS[lang], P = PEOPLE_STRINGS[lang];
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const hintId = useId();
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); btn.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc, true);
    pop.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [menu]);
  const doc = state.doc;
  if (!doc || !title) return null;
  const { clip, seqId } = title;
  const formView = state.viewVariantId !== null;
  const at = timeInTitle(clip, editor.playhead);
  const open = () => { const r = btn.current!.getBoundingClientRect(); const rtl = document.documentElement.dir === 'rtl'; setMenu({ top: Math.min(r.bottom + 4, Math.max(8, window.innerHeight - 440)), left: Math.max(8, Math.min(rtl ? r.right - 320 : r.left, window.innerWidth - 328)) }); };
  const wordsOf = (token: string): string => { const v = valueAt(doc, seqId, clip, at, token); return 'words' in v ? v.words : S.fieldNoData; };

  const insert = async (token: string) => {
    setMenu(null); setProblem(null);
    const held: { problems: { token: string; reason: string }[] | null } = { problems: null };
    const r = await editor.commit(() => {
      const d = editor.doc, f = d ? findClip(d, clipId) : undefined;
      if (!d || !f || f.clip.type !== 'text') return null;
      const res = insertField({ lang, doc: d, shown: boxText(lang, d, f.clip), caret, fieldsOn: !!f.clip.fields, token });
      if (!res.ok) { held.problems = res.problems; return null; }
      return insertOps(clipId, res.value);
    }, 'Insert field');
    if (held.problems) setProblem(fill(S.fieldInsertRefused, { why: held.problems.map((p) => p.token).join(', ') }));
    else if (r) document.querySelector<HTMLElement>('[data-testid="text-content"]')?.focus();
  };
  const freeze = async () => {
    setProblem(null);
    const held: { problem: string | null; varies?: boolean } = { problem: null };
    const r = await editor.commit(() => {
      const d = editor.doc, f = d ? findClip(d, clipId) : undefined;
      if (!d || !f || f.clip.type !== 'text' || !f.clip.fields) { held.problem = S.fieldFreezeNone; return null; }
      const m = freezeModel(d, f.seq.id, f.clip, timeInTitle(f.clip, editor.playhead));
      if (!m) { held.problem = S.fieldFreezeFailed; return null; }
      if (m.missing.length) { held.problem = fill(S.fieldFreezeMissing, { tokens: [...new Set(m.missing.map((x) => x.token))].join(', ') }); return null; }
      if (m.tooLong.length) { held.problem = S.fieldFreezeTooLong; return null; }
      held.varies = m.varies;
      return m.ops;
    }, 'Make title plain text');
    if (held.problem) setProblem(held.problem);
    else if (r?.transactionId) editor.notify({ kind: 'undo', title: S.fieldFrozen, ...(held.varies ? { body: S.fieldVaries } : {}), undoes: r.transactionId });
  };

  const fixed = fixedItems();
  const people = personItems(doc);
  const item = (token: string, label: string) => (
    <button key={token} type="button" role="menuitem" className="pf-mc-item pf-fm-item" data-testid={LIFE_TESTIDS.fieldItem(token)} data-token={token} onClick={() => void insert(token)}>
      <span className="pf-fm-name" dir="auto">{label}</span><span className="pf-fm-val" dir="auto">{wordsOf(token)}</span>
    </button>
  );
  return (
    <div className="pf-fm">
      <div className="pf-fm-bar">
        <Button ref={btn} size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />} aria-haspopup="menu" aria-expanded={!!menu} aria-describedby={formView ? hintId : undefined}
          disabledReason={formView ? S.fieldMasterOnly : undefined} data-testid={LIFE_TESTIDS.fieldAdd} onClick={() => (menu ? setMenu(null) : open())}>{S.fieldAdd}</Button>
        {clip.fields && <Button size="sm" variant="ghost" icon={<Snowflake size={14} strokeWidth={1.75} aria-hidden="true" />} data-testid={LIFE_TESTIDS.fieldFreeze} onClick={() => void freeze()}>{S.fieldFreeze}</Button>}
      </div>
      {formView && <p id={hintId} className="pf-life-note">{S.fieldMasterOnly}</p>}
      {problem && <AnchoredError blocking onDismiss={() => setProblem(null)} dismissLabel={S.cancel}>{problem}</AnchoredError>}
      {menu && createPortal(
        <div ref={pop} className="pf-ds pf-mc-pop pf-fm-pop" style={{ top: menu.top, left: menu.left }}>
          <div className="pf-mc-menu" role="menu" aria-label={S.fieldMenuLabel} onKeyDown={(e) => { if (e.key === 'Tab') { setMenu(null); btn.current?.focus(); } else onMenuKeyDown(e); }}>
            {GROUPS.map((g) => (
              <div key={g.id} role="group" aria-label={S[g.label]} className="pf-fm-group">
                <p className="pf-fm-gh" aria-hidden="true">{g.id === 'other' ? `${S.fieldYear} · ${S.fieldEvent}` : S[g.label]}</p>
                {fixed.filter((i) => (g.id === 'other' ? i.group !== 'date' && i.group !== 'hebrewDate' : i.group === g.id)).map((i) => item(i.token, itemLabel(S, i)))}
              </div>
            ))}
            <div role="group" aria-label={P.fieldPeopleGroup} className="pf-fm-group">
              <p className="pf-fm-gh" aria-hidden="true">{P.fieldPeopleGroup}</p>
              {people.map((p) => item(p.token, fill(p.kind === 'age' ? P.fieldAge : p.kind === 'ageWords' ? P.fieldAgeWords : P.fieldName, { name: p.person.name })))}
              <button type="button" role="menuitem" className="pf-mc-item pf-fm-item" data-testid="field-item-add-person" onClick={() => { setMenu(null); openPeople(null); }}><span className="pf-fm-name">{P.fieldAddPerson}</span></button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}

const FIX_LABEL = (S: LifeWords, P: PeopleWords, fix: FixKind): string | null => (fix === 'set_date' ? S.fieldFixDate : fix === 'choose_event' ? S.fieldFixSunset : fix === 'people' ? P.fieldFixPeople : null);

/** The line that says what the title shows at the playhead, or why a field has no words and how to fix it. */
export function FieldLiveLine({ clipId }: { clipId: string }): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const title = useTitle(clipId);
  const [dating, setDating] = useState<string | null>(null);
  const lang = state.lang;
  const S = LIFE_STRINGS[lang], P = PEOPLE_STRINGS[lang];
  const doc = state.doc;
  if (!doc || !title || !title.clip.fields) return null;
  const { clip, seqId } = title;
  const at = timeInTitle(clip, editor.playhead);
  const m = liveModel(doc, seqId, clip, at);
  // one message per reason, with the fields it concerns
  const byReason = new Map<MissingReason, { tokens: string[]; fix: FixKind }>();
  for (const p of m.problems) { const e = byReason.get(p.reason) ?? { tokens: [], fix: p.fix }; if (p.token) e.tokens.push(p.token); byReason.set(p.reason, e); }
  const fix = async (kind: FixKind, reason: MissingReason) => {
    if (kind === 'set_date') { setDating(m.anchorAssetId ?? pictureUnder(doc, seqId, at)); return; }
    if (kind === 'people') { openPeople(null); return; }
    if (kind === 'choose_event') {
      const asset = m.anchorAssetId ?? pictureUnder(doc, seqId, at);
      let ev = m.eventId && Object.hasOwn(doc.events ?? {}, m.eventId) ? doc.events[m.eventId]! : asset ? eventOfAsset(doc, asset) : null;
      if (!ev) {
        const r = await editor.commit([{ op: 'cluster_events', args: {} }], 'Arrange by events');
        const d = editor.doc;
        ev = r && d && asset ? eventOfAsset(d, asset) : null;
      }
      if (ev) showEvent(ev.id);
      void reason;
    }
  };
  const noPicture = !m.anchorAssetId && !pictureUnder(doc, seqId, at);
  return (
    <div className="pf-fm-live" data-testid={LIFE_TESTIDS.fieldLive} aria-live="polite" aria-atomic="true">
      <p className="pf-fm-now"><span>{fill(S.fieldLive, { text: '' }).trimEnd()}</span> <bdi dir="auto" className="pf-fm-text">{m.text || S.fieldLiveEmpty}</bdi></p>
      {[...byReason.entries()].map(([reason, e]) => {
        const label = e.fix === 'set_date' && noPicture ? null : FIX_LABEL(S, P, e.fix);
        const noEvent = reason === 'sunset_undecided' && !m.eventId;
        return (
          <AnchoredError key={reason} fix={label ?? undefined} onFix={label ? () => void fix(e.fix, reason) : undefined}>
            {t(`life.missing.${reason}` as Key)}{e.tokens.length > 0 && <> · <bdi dir="ltr" className="num">{e.tokens.join(' ')}</bdi></>}{noEvent ? ` · ${S.fieldFixNoEvent}` : ''}
          </AnchoredError>
        );
      })}
      {dating && <CaptureEditor assetId={dating} onClose={() => setDating(null)} />}
    </div>
  );
}

/**
 * The text box of a title WITH live fields: the readable form of its text (core fieldsToDisplay), read back on blur
 * (core fieldsFromDisplay). A group that is not a field, or a person who is not in the project, is refused where it was typed:
 * an anchored error names the groups and nothing is saved. `onCaret` reports where the caret is, for the field menu. The same
 * test id as the plain box (`text-content`), so every proof that types in the title keeps working.
 */
export function FieldTextBox({ clipId, onCaret }: { clipId: string; onCaret: (caret: number) => void }): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const title = useTitle(clipId);
  const S = LIFE_STRINGS[state.lang], P = PEOPLE_STRINGS[state.lang];
  const doc = state.doc;
  const stored = title && doc ? boxText(state.lang, doc, title.clip) : '';
  const [text, setText] = useState(stored);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  useEffect(() => { if (document.activeElement !== area.current) { setText(stored); setProblem(null); } }, [stored, clipId]);
  if (!doc || !title) return null;
  const save = () => {
    const c = commitBox(state.lang, doc, title.clip, text);
    if (c.kind === 'ops') { setProblem(null); void editor.commit(c.ops, 'Title text'); }
    else if (c.kind === 'error') setProblem(c.problems.map((p) => (p.reason === 'unknown_person' ? fill(P.fieldUnknownPerson, { group: p.token }) : fill(S.fieldBoxRefused, { groups: p.token }))).join(' '));
    else setProblem(null);
  };
  return (
    <>
      <label className="insp-area"><span className="sr-only">{t('text.content')}</span>
        <textarea ref={area} dir="auto" rows={3} value={text} data-testid="text-content" data-fields="true" aria-describedby={`${hintId} ${problem ? `${hintId}-err` : ''}`.trim()} aria-invalid={!!problem || undefined}
          onChange={(e) => { setText(e.target.value); onCaret(e.target.selectionStart); }} onSelect={(e) => onCaret(e.currentTarget.selectionStart)} onBlur={save} />
        <span className="insp-count num" aria-hidden="true">{text.length}</span>
      </label>
      <p id={hintId} className="pf-life-note">{S.fieldBoxHint}</p>
      {problem && <div id={`${hintId}-err`}><AnchoredError blocking onDismiss={() => setProblem(null)} dismissLabel={S.cancel}>{problem}</AnchoredError></div>}
    </>
  );
}
