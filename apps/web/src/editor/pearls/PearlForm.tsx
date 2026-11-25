/**
 * The inline form of the source viewer that marks and names a pearl (wave 7 pearls track): the stretch, a name, who is in it, save /
 * cancel. P, I, O and the keys of the viewer stay the viewer's; this form owns Escape (decision C19): its own listener on `window`
 * in the capture phase, which runs before the viewer's listener on `document`, calls preventDefault and stopPropagation, so Escape
 * closes the form only (the viewer also checks `defaultPrevented`). One registered operation, one undo.
 * A refusal is shown here in words, next to the control that caused it (for another credential than the owner's: «רק בעל הפרויקט
 * מתייג אנשים»), and nothing is saved. Hebrew first; the name is dir="auto".
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import * as T from '@pulseframe/time';
import type { SourceSpan } from '@pulseframe/core';
import { Button, Chip } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { useEditorState } from '../store.ts';
import { commitWords, newRangeId } from './pearls.commit.ts';
import { addPearlOp } from './pearls.logic.ts';
import { pearlsT } from './pearls.strings.ts';
import { PEARLS_TESTIDS as ID } from './pearls.testids.ts';
import './pearls.css';

export interface PearlFormProps {
  assetId: string; span: SourceSpan | null; rate: T.Rate;
  /** the form is closed (Escape, «ביטול»): the viewer puts the focus back on «שמור כפנינה» */
  onCancel: () => void;
  /** the pearl was committed */
  onSaved: (rangeId: string | null) => void;
}
export function PearlForm({ assetId, span, rate, onCancel, onSaved }: PearlFormProps): ReactElement {
  const { editor, state } = useEditorState();
  const P = pearlsT(state.lang);
  const [name, setName] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const known = Object.entries(state.rawDoc?.people ?? {}).map(([id, p]) => ({ id, name: p.name })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setProblem(null);
    const c = await commitWords(editor, [addPearlOp(assetId, span, name, people)], 'Mark pearl', P('notBuilt'));
    setBusy(false);
    if (!c.ok) { setProblem(c.message); return; }
    if (c.result.transactionId) editor.notify({ kind: 'undo', title: P('saved'), undoes: c.result.transactionId });
    onSaved(newRangeId(c.result));
  };
  return (
    <form className="pf-pearl-form" data-testid={ID.form} aria-label={P('one')} onSubmit={(e) => void submit(e)}>
      <p className="pf-film-muted" role="status">
        {span ? <bdi dir="ltr" className="num">{T.toTimecode(span.start, rate)} – {T.toTimecode(span.end, rate)}</bdi> : P('wholeFile')}
      </p>
      <label>{P('name')}
        <input type="text" dir="auto" maxLength={200} value={name} autoFocus onChange={(e) => setName(e.target.value)} data-testid={ID.formName} />
      </label>
      {known.length > 0 && (
        <div role="group" aria-label={P('who')}>
          <span className="pf-film-muted">{P('who')}</span>
          <div className="pf-pearl-form-people">
            {known.map((p) => <Chip key={p.id} pressed={people.includes(p.id)} data-testid={ID.formPerson} data-person-id={p.id} onClick={() => setPeople((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))}><bdi dir="auto">{p.name}</bdi></Chip>)}
          </div>
        </div>
      )}
      {problem && <p className="pf-pearls-note is-problem" role="alert" data-testid="pearl-form-error">{isolate(problem)}</p>}
      <div className="pf-pearl-form-row">
        <Button type="submit" variant="primary" size="sm" busy={busy} data-testid={ID.formSubmit}>{P('formSave')}</Button>
        <Button variant="ghost" size="sm" data-testid={ID.formCancel} onClick={onCancel}>{P('cancel')}</Button>
      </div>
    </form>
  );
}
