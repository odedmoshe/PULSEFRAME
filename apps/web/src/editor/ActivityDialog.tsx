/**
 * The whole history of the project (the panel shows only the latest edits): every committed transaction, newest first,
 * with who made it, when, and what it did in the interface language. Filter by who. Read-only.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { dictionaries, type Key } from '@pulseframe/i18n';
import { api, type RevisionEvent } from '../api.ts';
import { describeError } from './ProjectsDialog.tsx';
import { useEditorState } from './store.ts';
import { actorKind, actorWord } from './actorLabel.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
type Who = 'all' | 'user' | 'agent';

export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const { state, t } = useEditorState();
  const [events, setEvents] = useState<RevisionEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<Who>('all');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const projectId = state.doc?.id;
  useEffect(() => {
    closeRef.current?.focus();
    if (!projectId) return;
    api.history(projectId).then((r) => setEvents([...r.events].reverse()), (e) => setErr(describeError(e)));
  }, [projectId, state.revision]);
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onDocKey, true);
    return () => document.removeEventListener('keydown', onDocKey, true);
  }, [onClose]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!nodes.length) return;
    const first = nodes[0]!, last = nodes[nodes.length - 1]!, at = document.activeElement;
    if (e.shiftKey && (at === first || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !dialogRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
  };
  const isAgent = (e: RevisionEvent) => actorKind(e.actor) === 'agent';
  const shown = (events ?? []).filter((e) => who === 'all' || (who === 'agent') === isAgent(e));
  const what = (e: RevisionEvent) => `${e.kind === 'undo' ? `${t('undo')}: ` : e.kind === 'redo' ? `${t('redo')}: ` : ''}${e.ops?.length ? e.ops.map((o) => dictionaries[state.lang][`op.${o}` as Key] ?? o).join(' · ') : e.summary}`;
  return (
    <div className="pf-dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pf-dlg" role="dialog" aria-modal="true" aria-label={t('activity.dialog')} data-testid="activity-dialog" onKeyDown={onKey}>
        <div className="pf-dlg-head">
          <h2>{t('activity.dialog')}</h2>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose} aria-label={t('projects.close')} data-testid="activity-close">×</button>
        </div>
        <div className="row">
          <label>{t('activity.filter')}{' '}
            <select value={who} onChange={(e) => setWho(e.target.value as Who)} data-testid="activity-filter">
              <option value="all">{t('activity.filter.all')}</option>
              <option value="user">{t('activity.filter.user')}</option>
              <option value="agent">{t('activity.filter.agent')}</option>
            </select>
          </label>
          <span className="muted" role="status" data-testid="activity-count"><bdi dir="ltr">{shown.length}</bdi> {t('activity.count')}</span>
        </div>
        {err && <p className="muted danger" role="alert">{err}</p>}
        <ol className="pf-dlg-list activity-full" data-testid="activity-full">
          {shown.map((e) => (
            <li key={e.revision} data-actor={e.actor} data-revision={e.revision}>
              <span className={`actor ${actorKind(e.actor)}`} data-actor-kind={actorKind(e.actor)}>{actorWord(t, e.actor)}</span>{' '}
              <span dir="auto" title={e.summary}>{what(e)}</span>{' '}
              <span className="muted"><bdi dir="ltr">#{e.revision} · {new Date(e.at).toLocaleString()}</bdi>{isAgent(e) ? <> · <bdi>{e.actor.replace(/^agent:/, '')}</bdi></> : null}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
