/**
 * The people sheet (ADR-0021, people section; plan §7), opened from the palette «אנשים…» and from «הוספת אדם…» in the field
 * menu: one row per person with the name (dir=auto), the birth date with its Hebrew date beside it, the Seg «בן · בת · —»
 * and a quiet «הסרה» (disabled, with the reason shown, while titles use the person: the refusal personInUse);
 * «הוספת אדם»; «העתקה מפרויקט אחר» (people.api.ts peopleApi.suggestions); and the privacy line PEOPLE_STRINGS.privacy, word
 * for word. Every change is one operation through Editor.commit: add_person, update_person, remove_person. Nothing about a
 * person is kept in browser storage. No photo, no face, no place, no relation: a person is a name, a birth date and a word
 * choice. This is the owner's own screen: birth dates are shown here and nowhere an agent reads.
 * Test ids: PEOPLE_TESTIDS.sheet, privacy, personAdd, peopleCopy, personRow(id) and the row's controls.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Copy, UserPlus } from 'lucide-react';
import type { Key } from '@pulseframe/i18n';
import { PERSON_NAME, MAX_PERSON_NAME, fieldUsersOfPerson, formatHebrewDate, hebrewFromRd, isRealWallDate, peopleOf, personNameKey, rdFromGregorian, storedPersonName, type Person, type ProjectDocument } from '@pulseframe/core';
import { AnchoredError, Button, Dialog, Seg } from '../../ds/index.ts';
import { ApiFailure } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { peopleApi, type PersonSuggestion } from './people.api.ts';
import { PEOPLE_STRINGS, fill } from './people.strings.ts';
import { PEOPLE_TESTIDS } from './people.testids.ts';
import './lifeline.css';

type Form = 'm' | 'f' | 'none';
/** The Hebrew date of a birth day (the day itself, by daytime), or null when the day is not a real one. */
export function birthHebrew(birthDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !isRealWallDate(birthDate)) return null;
  const y = Number(birthDate.slice(0, 4)), m = Number(birthDate.slice(5, 7)), d = Number(birthDate.slice(8, 10));
  return formatHebrewDate(hebrewFromRd(rdFromGregorian({ y, m, d })));
}
/** A name as it would be stored, or null when it cannot be one (empty, braces, colon, bar, line break, too long) or another person has it. */
export function checkedName(doc: ProjectDocument, raw: string, selfId: string | null): string | null {
  const name = storedPersonName(raw);
  if (!name || name.length > MAX_PERSON_NAME || !PERSON_NAME.test(name)) return null;
  const key = personNameKey(name);
  return Object.values(peopleOf(doc)).some((p) => p.id !== selfId && personNameKey(p.name) === key) ? null : name;
}
const formOf = (p: Pick<Person, 'form'>): Form => p.form ?? 'none';

function PersonRow({ person, focus, fail }: { person: Person; focus: boolean; fail: (text: string | null) => void }) {
  const { editor, state, t } = useEditorState();
  const doc = state.doc!;
  const lang = state.lang;
  const P = PEOPLE_STRINGS[lang];
  const [name, setName] = useState(person.name);
  const [busyName, setBusyName] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(person.name); }, [person.name]);
  useEffect(() => { if (focus) input.current?.focus(); }, [focus]);
  const users = fieldUsersOfPerson(doc, person.id);
  const heb = person.birthDate ? birthHebrew(person.birthDate) : null;
  const run = async (args: Record<string, unknown>, label: string) => {
    fail(null);
    const r = await editor.commit([{ op: 'update_person', args: { personId: person.id, ...args } }], label);
    if (!r) fail(editor.getState().error);
    return r;
  };
  const saveName = async () => {
    if (name === person.name) return;
    const ok = checkedName(doc, name, person.id);
    if (!ok) { fail(P.personNameBusy); setName(person.name); return; }
    setBusyName(true);
    await run({ name: ok }, 'Rename person');
    setBusyName(false);
  };
  const remove = async () => {
    fail(null);
    const r = await editor.commit([{ op: 'remove_person', args: { personId: person.id } }], 'Remove person');
    if (!r) fail(editor.getState().error); else if (r.transactionId) editor.notify({ kind: 'undo', title: t('op.remove_person' as Key), undoes: r.transactionId });
  };
  const whyId = `life-person-why-${person.id}`;
  return (
    <li className="pf-pp-row" data-testid={PEOPLE_TESTIDS.personRow(person.id)} data-person-id={person.id}>
      <label className="pf-life-field"><span>{P.name}</span>
        <input ref={input} type="text" dir="auto" value={name} maxLength={MAX_PERSON_NAME} disabled={busyName} data-testid={PEOPLE_TESTIDS.personName(person.id)} onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } }} />
      </label>
      <div className="pf-life-field"><label htmlFor={`life-birth-${person.id}`}>{P.birthDate}</label>
        <input id={`life-birth-${person.id}`} type="date" className="num" dir="ltr" min="1900-01-01" max="2100-12-31" value={person.birthDate ?? ''} data-testid={PEOPLE_TESTIDS.personBirth(person.id)}
          onChange={(e) => { const v = e.target.value; if (v === (person.birthDate ?? '')) return; if (v && !isRealWallDate(v)) { fail(PEOPLE_STRINGS[lang].noBirthDate); return; } void run({ birthDate: v || null }, 'Birth date'); }} />
        <span className="pf-pp-heb" data-testid={PEOPLE_TESTIDS.personBirthHebrew(person.id)} aria-live="polite">{heb ? fill(P.birthDateHebrew, { date: heb }) : P.noBirthDate}</span>
      </div>
      <div className="pf-pp-formrow" data-testid={PEOPLE_TESTIDS.personForm(person.id)}>
        <Seg size="sm" label={P.formLabel} value={formOf(person)} onChange={(v) => void run({ form: v === 'none' ? null : v }, 'Age wording')}
          options={[{ value: 'm', label: P.formM, testId: `life-person-form-${person.id}-m` }, { value: 'f', label: P.formF, testId: `life-person-form-${person.id}-f` }, { value: 'none', label: P.formNone, testId: `life-person-form-${person.id}-none` }]} />
      </div>
      <div className="pf-pp-remove">
        <Button size="sm" variant="ghost" disabledReason={users.length > 0 ? fill(P.removeInUse, { n: users.length }) : undefined} aria-describedby={users.length > 0 ? whyId : undefined} data-testid={PEOPLE_TESTIDS.personRemove(person.id)} onClick={() => void remove()}>{P.remove}</Button>
        {users.length > 0 && <span id={whyId} className="pf-life-why">{fill(P.removeInUse, { n: users.length })}</span>}
      </div>
    </li>
  );
}

function AddPerson({ onDone, fail }: { onDone: (id: string | null) => void; fail: (text: string | null) => void }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const P = PEOPLE_STRINGS[lang];
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [form, setForm] = useState<Form>('none');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const doc = state.doc!;
    const ok = checkedName(doc, name, null);
    if (!ok) { fail(P.personNameBusy); return; }
    if (birth && !isRealWallDate(birth)) { fail(P.noBirthDate); return; }
    setBusy(true); fail(null);
    const r = await editor.commit([{ op: 'add_person', args: { name: ok, ...(birth ? { birthDate: birth } : {}), ...(form === 'none' ? {} : { form }) } }], 'Add person');
    setBusy(false);
    if (!r) { fail(editor.getState().error); return; }
    const id = (r.results[0]?.output as { personId?: string } | undefined)?.personId ?? null;
    onDone(id);
  };
  return (
    <form className="pf-pp-row is-new" onSubmit={(e) => { e.preventDefault(); void add(); }} aria-label={P.personAdd}>
      <label className="pf-life-field"><span>{P.name}</span><input type="text" dir="auto" value={name} maxLength={MAX_PERSON_NAME} autoFocus placeholder={P.personNamePlaceholder} data-testid="life-person-new-name" onChange={(e) => setName(e.target.value)} /></label>
      <label className="pf-life-field"><span>{P.birthDate}</span><input type="date" className="num" dir="ltr" min="1900-01-01" max="2100-12-31" value={birth} data-testid="life-person-new-birth" onChange={(e) => setBirth(e.target.value)} /></label>
      <div className="pf-pp-formrow"><Seg size="sm" label={P.formLabel} value={form} onChange={setForm} options={[{ value: 'm', label: P.formM }, { value: 'f', label: P.formF }, { value: 'none', label: P.formNone }]} /></div>
      <div className="pf-pp-remove"><Button size="sm" variant="primary" type="submit" busy={busy} data-testid="life-person-new-save">{P.personAdd}</Button><Button size="sm" variant="ghost" onClick={() => onDone(null)}>{LIFE_CANCEL[lang]}</Button></div>
    </form>
  );
}
const LIFE_CANCEL = { he: 'ביטול', en: 'Cancel' } as const;

function CopyFromOther({ doc }: { doc: ProjectDocument }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const P = PEOPLE_STRINGS[lang];
  const [list, setList] = useState<PersonSuggestion[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setSaid(null);
    try { setList((await peopleApi.suggestions()).people); }
    catch (e) { setList(null); setSaid(e instanceof ApiFailure && (e.status === 404 || e.status === 501) ? P.copyUnavailable : fill(P.copyFailed, { why: e instanceof Error ? e.message : '' })); }
    finally { setBusy(false); }
  };
  const taken = new Set(Object.values(peopleOf(doc)).map((p) => personNameKey(p.name)));
  const addOne = async (s: PersonSuggestion) => {
    setSaid(null);
    const r = await editor.commit([{ op: 'add_person', args: { name: storedPersonName(s.name), ...(s.birthDate ? { birthDate: s.birthDate } : {}), ...(s.form ? { form: s.form } : {}) } }], 'Copy person');
    if (!r) setSaid(editor.getState().error);
  };
  return (
    <section className="pf-pp-copy" aria-label={P.copyHeading}>
      <Button size="sm" variant="secondary" icon={<Copy size={14} strokeWidth={1.75} aria-hidden="true" />} busy={busy} data-testid={PEOPLE_TESTIDS.peopleCopy} onClick={() => void load()}>{P.copy}</Button>
      {said && <p className="pf-life-note" role="status">{said}</p>}
      {list && list.length === 0 && <p className="pf-life-note" role="status">{P.copyNone}</p>}
      {list && list.length > 0 && (
        <ul className="pf-pp-suggest">
          {list.map((s, i) => (
            <li key={`${s.projectId}-${i}`}>
              <span dir="auto" className="pf-pp-sname">{s.name}</span>
              <span className="pf-life-note">{fill(P.copyFrom, { project: s.projectName })}</span>
              <Button size="sm" variant="ghost" disabled={taken.has(personNameKey(s.name))} disabledReason={taken.has(personNameKey(s.name)) ? P.copyAlready : undefined} onClick={() => void addOne(s)}>{P.copyAdd}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `focusPersonId`: the row to focus when opened from a field (null = the first). `onClose` closes the sheet. */
export function PeopleSheet({ open, focusPersonId, onClose }: { open: boolean; focusPersonId: string | null; onClose: () => void }): ReactElement | null {
  const { state, t } = useEditorState();
  const doc = state.doc;
  const P = PEOPLE_STRINGS[state.lang];
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => { if (open) { setAdding(false); setProblem(null); setFocus(focusPersonId); } }, [open, focusPersonId]);
  if (!open || !doc) return null;
  const people = Object.values(peopleOf(doc)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  const first = focus ?? people[0]?.id ?? null;
  return (
    <Dialog open onClose={onClose} variant="sheet" size="md" title={P.sheetTitle} closeLabel={t('close' as Key)} testId={PEOPLE_TESTIDS.sheet}>
      <div className="pf-pp">
        <p className="pf-pp-privacy" data-testid={PEOPLE_TESTIDS.privacy}>{P.privacy}</p>
        {problem && <AnchoredError blocking onDismiss={() => setProblem(null)} dismissLabel={P.sheetClose}>{problem}</AnchoredError>}
        {people.length === 0 && !adding && <p className="pf-life-note" role="status">{P.personNone}</p>}
        <ul className="pf-pp-list" aria-label={P.sheetTitle}>
          {people.map((p) => <PersonRow key={p.id} person={p} focus={first === p.id && !adding} fail={setProblem} />)}
        </ul>
        {adding && <AddPerson fail={setProblem} onDone={(id) => { setAdding(false); if (id) setFocus(id); }} />}
        <div className="pf-pp-actions">
          {!adding && <Button size="sm" variant="primary" icon={<UserPlus size={14} strokeWidth={1.75} aria-hidden="true" />} data-testid={PEOPLE_TESTIDS.personAdd} onClick={() => setAdding(true)}>{P.personAdd}</Button>}
          <CopyFromOther doc={doc} />
        </div>
      </div>
    </Dialog>
  );
}
