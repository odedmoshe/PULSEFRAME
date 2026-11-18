/**
 * The archive option «בלי פרטי משפחה» (ADR-0021, people section), mounted beside the archive download link of the deliver
 * panel (DeliverPanel.tsx, the `archive-download` link). Shown only when the project has people. A checkbox; when it is on, the
 * link is peopleApi.archiveUrl(id, 'omit'), the note PEOPLE_STRINGS.archiveFamilyNote is shown (media files are unchanged), and
 * the titles of peopleApi.familyCheck are listed before the download (frozen at their first value; fields without data), each
 * with the words it shows, so nothing is silently broken. A server without the route says so (the option is then off).
 * Test ids: PEOPLE_TESTIDS.archiveFamily, archiveFamilyVarying, archiveFamilyEmpty.
 */
import { useEffect, useId, useState, type ReactElement } from 'react';
import { findClip, peopleOf } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { boxText } from './fieldText.logic.ts';
import { peopleApi } from './people.api.ts';
import { PEOPLE_STRINGS, fill } from './people.strings.ts';
import { PEOPLE_TESTIDS } from './people.testids.ts';
import './lifeline.css';

export function ArchiveFamilyOption({ projectId, onHref }: { projectId: string; onHref: (href: string) => void }): ReactElement | null {
  const { state } = useEditorState();
  const doc = state.doc;
  const P = PEOPLE_STRINGS[state.lang];
  const id = useId();
  const [on, setOn] = useState(false);
  const [check, setCheck] = useState<{ varying: string[]; empty: string[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const has = !!doc && Object.keys(peopleOf(doc)).length > 0;
  useEffect(() => { onHref(peopleApi.archiveUrl(projectId, on ? 'omit' : 'keep')); }, [on, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) { setCheck(null); return; }
    let live = true;
    peopleApi.familyCheck(projectId).then((r) => { if (live) setCheck(r); }).catch((e) => {
      if (!live) return;
      setCheck(null);
      setOn(false); // the full archive is never offered under the name of the one without family details
      setProblem(e instanceof ApiFailure && (e.status === 404 || e.status === 501) ? P.archiveFamilyUnavailable : fill(P.archiveFamilyFailed, { why: e instanceof Error ? e.message : '' }));
    });
    return () => { live = false; };
  }, [on, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!has || !doc) return null;
  /** A title as the person knows it: the words it holds, in the readable form. */
  const label = (clipId: string): string => {
    const c = findClip(doc, clipId)?.clip;
    return c && c.type === 'text' ? boxText(state.lang, doc, c) || clipId : clipId;
  };
  const list = (testId: string, head: string, ids: readonly string[]) => ids.length === 0 ? null : (
    <div data-testid={testId}><p className="pf-life-note">{head}</p><ul className="pf-fam-list">{ids.map((c) => <li key={c} dir="auto" data-clip-id={c}>{label(c)}</li>)}</ul></div>
  );
  return (
    <div className="pf-fam">
      <label className="pf-life-check" htmlFor={id}><input id={id} type="checkbox" checked={on} data-testid={PEOPLE_TESTIDS.archiveFamily} aria-describedby={`${id}-note`} onChange={(e) => { setProblem(null); setOn(e.target.checked); }} /> <span>{P.archiveFamily}</span></label>
      {on && <p id={`${id}-note`} className="pf-life-note">{P.archiveFamilyNote}</p>}
      {on && !check && <p className="pf-life-note" role="status">{P.archiveFamilyChecking}</p>}
      {problem && <p className="pf-life-note danger" role="alert">{problem}</p>}
      {on && check && (<>{list(PEOPLE_TESTIDS.archiveFamilyVarying, P.archiveFamilyVarying, check.varying)}{list(PEOPLE_TESTIDS.archiveFamilyEmpty, P.archiveFamilyEmpty, check.empty)}</>)}
    </div>
  );
}
