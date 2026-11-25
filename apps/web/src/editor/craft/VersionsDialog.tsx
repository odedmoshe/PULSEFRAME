/**
 * «גרסאות» (the button beside the history, or the palette): a modal (design-system Dialog). The list shows each saved version (name,
 * date, who, frames, size with «המדיה לא מועתקת», «זהה למצב הנוכחי», «נשמרה לפני שינוי באזורי הפרטיות»). Rename and delete are the
 * owner's own session only (said in words otherwise; the server refuses too). A chosen version opens a comparison: its still next to
 * another version's or the current one's, at the same frame, through the existing wipe (AiCompare) with a frame stepper and the typed-time
 * field; a frame past the end of the shorter side is said. «מה השתנה» is counts first and then names, from the server's DiffSummary;
 * what restore will not bring back is listed apart. Restore is ONE undoable step; when it would remove or change a privacy region the
 * dialog names the count and asks a second time.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DiffSummary, VersionInfo } from '@pulseframe/core';
import { api, ApiFailure } from '../../api.ts';
import { Dialog } from '../../ds/index.ts';
import { AiCompare } from '../AiCompare.tsx';
import { AI_STRINGS } from '../aiTools.strings.ts';
import { useEditorState } from '../store.ts';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { TimeField } from './TimeEntry.tsx';
import { craftApi, craftFailure, currentFrameUrl, diffRowSentence, diffSentence, frameState, loadStill, privacyAtStake, restoresRows, say, stepFrame, versionMeta, type Failure, type Lang } from './craft.logic.ts';

type Still = { state: 'loading' } | { state: 'ok'; url: string } | { state: 'failed'; message: string; code: string | null } | { state: 'absent' };

/** One side of the comparison: its still, read with the refusal that goes with it. */
function useStill(url: string | null, lang: Lang): Still {
  const [still, setStill] = useState<Still>({ state: 'absent' });
  useEffect(() => {
    if (!url) { setStill({ state: 'absent' }); return; }
    const ctl = new AbortController();
    let made: string | null = null;
    setStill({ state: 'loading' });
    loadStill(url, lang, ctl.signal).then((r) => { if (r.ok) { made = r.url; setStill({ state: 'ok', url: r.url }); } else setStill({ state: 'failed', message: r.message, code: r.code }); }, () => undefined);
    return () => { ctl.abort(); if (made) URL.revokeObjectURL(made); };
  }, [url, lang]);
  return still;
}

export function VersionsDialog() {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const pid = state.doc?.id;
  const owner = state.actor === 'user:local';
  const id = useId();
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [against, setAgainst] = useState<string>('current');
  const [index, setIndex] = useState<number>(() => editor.frame);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [restoreDiff, setRestoreDiff] = useState<DiffSummary | null>(null);
  const [diffError, setDiffError] = useState<Failure | null>(null);
  const [confirmPrivacy, setConfirmPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Failure | null>(null);
  const loadSeq = useRef(0);
  const close = () => craftSurface.set(null);

  const reload = async () => {
    if (!pid) return;
    try { const r = await api.versions(pid); setVersions(r.versions); setError(null); setChosen((c) => (c && r.versions.some((v) => v.id === c) ? c : null)); }
    catch (e) { setVersions([]); setError(craftFailure(lang, e)); }
  };
  useEffect(() => { void reload(); }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = versions?.find((v) => v.id === chosen) ?? null;
  const b = against === 'current' ? null : versions?.find((v) => v.id === against) ?? null;
  const currentFrames = editor.player?.frameCount ?? 0;
  const aFrames = a?.frames ?? 0, bFrames = b ? b.frames : currentFrames;
  const fs = a ? frameState(index, aFrames, bFrames) : 'ok';
  const aUrl = a && pid && (fs === 'ok' || fs === 'b') ? api.versionFrameUrl(pid, a.id, index) : null;
  const bUrl = a && pid && (fs === 'ok' || fs === 'a') ? (b ? api.versionFrameUrl(pid, b.id, index) : currentFrameUrl(pid, index, state.revision)) : null;
  const stillA = useStill(aUrl, lang), stillB = useStill(bUrl, lang);

  // what changed (A against B) and what restore would do (A against the current state): read when the choice changes
  useEffect(() => {
    setDiff(null); setRestoreDiff(null); setDiffError(null); setConfirmPrivacy(false); setNote(null);
    if (!pid || !chosen) return;
    const mine = ++loadSeq.current;
    const fail = (e: unknown) => { if (mine === loadSeq.current) setDiffError(craftFailure(lang, e)); };
    craftApi.versionDiff(pid, chosen, against).then((d) => { if (mine === loadSeq.current) { setDiff(d); if (against === 'current') setRestoreDiff(d); } }, fail);
    if (against !== 'current') craftApi.versionDiff(pid, chosen, 'current').then((d) => { if (mine === loadSeq.current) setRestoreDiff(d); }, () => undefined);
  }, [pid, chosen, against, state.revision, lang]);

  if (!pid) return null;
  const rename = async (v: VersionInfo) => {
    if (!newName.trim()) return;
    setBusy(true);
    try { await api.renameVersion(pid, v.id, newName.trim()); setRenaming(null); await reload(); } catch (e) { setNote(craftFailure(lang, e)); }
    setBusy(false);
  };
  const remove = async (v: VersionInfo) => {
    setBusy(true);
    try { await api.deleteVersion(pid, v.id); setDeleting(null); if (chosen === v.id) setChosen(null); if (against === v.id) setAgainst('current'); await reload(); } catch (e) { setNote(craftFailure(lang, e)); }
    setBusy(false);
  };
  const stakes = restoreDiff ? privacyAtStake(restoreDiff) : 0;
  const restore = async (confirmed: boolean) => {
    if (!a || busy) return;
    if (stakes > 0 && !confirmed) { setConfirmPrivacy(true); return; }
    setBusy(true); setNote(null);
    try {
      const r = await api.restoreVersion(pid, a.id, { expectRevision: state.revision, ...(stakes > 0 ? { confirmPrivacy: true } : {}) });
      await editor.load(pid);
      editor.notify({ kind: r.transactionId ? 'undo' : 'info', title: say(lang, 'restoreDone', { name: a.name }), ...(r.transactionId ? { undoes: r.transactionId } : {}) });
      close();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'restore_needs_confirmation') setConfirmPrivacy(true);
      else if (e instanceof ApiFailure && (e.code === 'stale_revision' || e.code === 'version_conflict')) setNote({ code: e.code, message: say(lang, 'restoreStale') });
      else setNote(craftFailure(lang, e));
    }
    setBusy(false);
  };
  const last = Math.max(0, Math.min(aFrames, bFrames) - 1);
  const compareS = a ? { ...AI_STRINGS[lang], compareLabel: `${a.name} · ${b ? b.name : say(lang, 'current')} · ${say(lang, 'frameLabel')} ${index}`, compareBefore: a.name, compareAfter: b ? b.name : say(lang, 'current'), compareValue: (v: number) => `${b ? b.name : say(lang, 'current')} ${v}%`, compareHint: '' } : null;
  const { restored, kept } = diff ? restoresRows(diff) : { restored: [], kept: [] };
  const restoreRows = restoreDiff ? restoresRows(restoreDiff) : null;
  const nothingToRestore = !!restoreDiff && restoreDiff.rows.length === 0 && restoreDiff.more === 0;
  const stillMsg = (s: Still, side: string) => (s.state === 'failed' ? <p className="pf-craft-still-msg" role="alert" data-code={s.code ?? undefined} data-side={side}>{s.code === 'version_privacy_changed' ? say(lang, 'stillPrivacy') : s.message}</p> : s.state === 'loading' ? <p className="pf-craft-still-msg" role="status">{say(lang, 'stillLoading')}</p> : null);
  const frameMsg = fs === 'ok' ? null : fs === 'both' ? say(lang, 'noSuchFrame') : `${fs === 'a' ? a?.name : b ? b.name : say(lang, 'current')}: ${say(lang, 'noSuchFrame')}`;

  return (
    <Dialog open onClose={close} title={say(lang, 'versions')} size="lg" closeLabel={say(lang, 'close')} testId={TID.versionsDialog}>
      <div className="pf-craft-versions" dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang}>
        {versions === null && <p role="status">{say(lang, 'versionsLoading')}</p>}
        {error && <p className="pf-craft-error" role="alert" data-code={error.code ?? undefined}><bdi dir="auto">{error.message}</bdi>{error.hint ? <> — <bdi dir="auto">{error.hint}</bdi></> : null}</p>}
        {versions && versions.length === 0 && !error && <p data-testid="craft-versions-empty" role="status">{say(lang, 'versionsEmpty')}</p>}
        {versions && versions.length > 0 && (
          <>
            <p className="pf-craft-hint" data-testid="craft-versions-count">{say(lang, 'versionCountLine', { n: versions.length })}</p>
            <ul className="pf-craft-vlist" aria-label={say(lang, 'versionsListLabel')} dir="auto">
              {versions.map((v, n) => (
                <li key={v.id} className="pf-craft-vrow" data-testid={`${TID.versionRow}-${n}`} data-version-id={v.id} aria-current={v.id === chosen || undefined}>
                  {renaming === v.id ? (
                    <div className="pf-craft-row">
                      <input type="text" dir="auto" value={newName} maxLength={80} aria-label={say(lang, 'renameLabel')} data-testid={TID.versionRename} autoFocus onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void rename(v); } else if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); } }} style={{ flex: 1 }} />
                      <button type="button" className="primary" disabled={busy || !newName.trim()} onClick={() => void rename(v)}>{say(lang, 'renameSave')}</button>
                      <button type="button" className="ghost" onClick={() => setRenaming(null)}>{say(lang, 'cancel')}</button>
                    </div>
                  ) : (
                    <>
                      <span className="name"><bdi dir="auto">{v.name}</bdi></span>
                      <span className="meta"><bdi dir="auto">{versionMeta(lang, v)}</bdi> · {say(lang, 'mediaNotCopied')}</span>
                      <span className="pf-craft-row">
                        {v.sameAsCurrent && <span className="pf-craft-badge">{say(lang, 'sameAsCurrent')}</span>}
                        {v.privacyChanged && <span className="pf-craft-badge" data-tone="privacy" data-testid="craft-version-privacy">{say(lang, 'privacyLabel')}</span>}
                      </span>
                    </>
                  )}
                  {renaming !== v.id && deleting !== v.id && (
                    <div className="pf-craft-row">
                      <button type="button" className="ghost" aria-pressed={v.id === chosen} data-testid={TID.versionCompare} onClick={() => { setChosen(v.id === chosen ? null : v.id); setAgainst('current'); setIndex(editor.frame); }}>{say(lang, 'compare')}</button>
                      <button type="button" className="ghost" disabled={!owner} aria-describedby={owner ? undefined : `${id}-owner`} data-testid={`${TID.versionRename}-open`} onClick={() => { setRenaming(v.id); setNewName(v.name); }}>{say(lang, 'rename')}</button>
                      <button type="button" className="ghost danger" disabled={!owner} aria-describedby={owner ? undefined : `${id}-owner`} data-testid={TID.versionDelete} onClick={() => setDeleting(v.id)}>{say(lang, 'delete')}</button>
                    </div>
                  )}
                  {deleting === v.id && (
                    <div className="pf-craft-row" role="group" aria-label={say(lang, 'deleteConfirm', { name: v.name })}>
                      <span><bdi dir="auto">{say(lang, 'deleteConfirm', { name: v.name })}</bdi></span>
                      <button type="button" className="ghost danger" disabled={busy} data-testid="craft-version-delete-yes" autoFocus onClick={() => void remove(v)}>{say(lang, 'deleteYes')}</button>
                      <button type="button" className="ghost" onClick={() => setDeleting(null)}>{say(lang, 'deleteNo')}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!owner && <p className="pf-craft-hint" id={`${id}-owner`} data-testid="craft-versions-owner-only">{say(lang, 'ownerOnly')}</p>}
          </>
        )}
        {note && <p className="pf-craft-error" role="alert" data-code={note.code ?? undefined}><bdi dir="auto">{note.message}</bdi>{note.hint ? <> — <bdi dir="auto">{note.hint}</bdi></> : null}</p>}

        {a && versions && (
          <section className="pf-craft-cmp" aria-label={`${say(lang, 'compare')}: ${a.name}`} data-testid="craft-version-panel">
            <div className="pf-craft-row">
              <label>{say(lang, 'compareWith')}{' '}
                <select value={against} onChange={(e) => setAgainst(e.target.value)} data-testid="craft-version-against">
                  <option value="current">{say(lang, 'current')}</option>
                  {versions.filter((v) => v.id !== a.id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            </div>
            <div className="pf-craft-row" role="group" aria-label={say(lang, 'frameLabel')} dir="ltr"
              onKeyDown={(e) => { if (e.target instanceof HTMLButtonElement && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); setIndex((i) => stepFrame(i, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1), Math.max(aFrames, bFrames, 1) - 1)); } }}>
              <button type="button" className="ghost" onClick={() => setIndex((i) => stepFrame(i, -10, Math.max(aFrames, bFrames, 1) - 1))} aria-label={say(lang, 'frameMinus10')}>«</button>
              <button type="button" className="ghost" onClick={() => setIndex((i) => stepFrame(i, -1, Math.max(aFrames, bFrames, 1) - 1))} aria-label={say(lang, 'frameMinus1')}>‹</button>
              <output data-testid="craft-version-frame" aria-live="polite">{say(lang, 'frameLabel')} <bdi dir="ltr">{index}</bdi></output>
              <button type="button" className="ghost" onClick={() => setIndex((i) => stepFrame(i, 1, Math.max(aFrames, bFrames, 1) - 1))} aria-label={say(lang, 'framePlus1')}>›</button>
              <button type="button" className="ghost" onClick={() => setIndex((i) => stepFrame(i, 10, Math.max(aFrames, bFrames, 1) - 1))} aria-label={say(lang, 'framePlus10')}>»</button>
            </div>
            <div dir="ltr">
              <TimeField lang={lang} rate={editor.rate} mode="goto" base={index} last={Math.max(0, Math.max(aFrames, bFrames) - 1)} label={say(lang, 'frameLabel')} testId="craft-version-time" lineTestId="craft-version-time-line" onCommit={(f) => setIndex(f)} />
            </div>
            {frameMsg && <p className="pf-craft-still-msg" role="status" data-testid="craft-version-nosuchframe">{frameMsg}</p>}
            {fs === 'ok' && stillA.state === 'ok' && stillB.state === 'ok' && compareS && <div data-testid={TID.versionWipe}><AiCompare kind="image" before={stillA.url} after={stillB.url} S={compareS as typeof AI_STRINGS['he']} rtl={lang === 'he'} /></div>}
            {fs === 'ok' && stillMsg(stillA, 'a')}{fs === 'ok' && stillMsg(stillB, 'b')}

            <h3 style={{ margin: 0, fontSize: 14 }}>{say(lang, 'whatChanged')}</h3>
            {diffError && <p className="pf-craft-error" role="alert" data-code={diffError.code ?? undefined}><bdi dir="auto">{diffError.message}</bdi></p>}
            {!diff && !diffError && <p role="status">{say(lang, 'diffLoading')}</p>}
            {diff && (
              <div data-testid={TID.versionDiff} data-added={diff.counts.added} data-removed={diff.counts.removed} data-changed={diff.counts.changed}>
                {diff.rows.length === 0 && diff.more === 0 ? <p>{say(lang, 'diffNone')}</p> : (
                  <>
                    <p data-testid="craft-version-diff-sentence"><strong><bdi dir="auto">{diffSentence(lang, diff)}</bdi></strong></p>
                    {restored.length > 0 && <ul className="pf-craft-diff" aria-label={say(lang, 'diffRestoresList')}>{restored.map((r) => <li key={r.entity + r.id} data-change={r.change}><bdi dir="auto">{diffRowSentence(lang, r)}</bdi></li>)}</ul>}
                    {kept.length > 0 && <><p className="pf-craft-hint">{say(lang, 'notRestored')}</p><ul className="pf-craft-diff">{kept.map((r) => <li key={r.entity + r.id} data-change={r.change}><bdi dir="auto">{diffRowSentence(lang, r)}</bdi></li>)}</ul></>}
                    {diff.more > 0 && <p className="pf-craft-hint">{say(lang, 'diffMore', { n: diff.more })}</p>}
                  </>
                )}
              </div>
            )}

            <p className="pf-craft-hint">{say(lang, 'restoreWill')} · {say(lang, 'restoreKeeps')}</p>
            {restoreRows && stakes > 0 && <div className="pf-craft-warn" role="alert" data-testid="craft-version-privacy-warning" data-stakes={stakes}><strong>{say(lang, 'restorePrivacy', { n: stakes })}</strong><br />{say(lang, 'restorePrivacyAsk')}</div>}
            {nothingToRestore && <p className="pf-craft-hint" role="status">{say(lang, 'restoreNothing')}</p>}
            <div className="pf-craft-row">
              {!confirmPrivacy && <button type="button" className="primary" data-testid={TID.versionRestore} disabled={busy || !restoreDiff || nothingToRestore} aria-busy={busy || undefined} onClick={() => void restore(false)}>{busy ? say(lang, 'restoring') : say(lang, 'restore')}</button>}
              {confirmPrivacy && <button type="button" className="primary danger" data-testid={TID.versionRestoreConfirm} disabled={busy} autoFocus onClick={() => void restore(true)}>{say(lang, 'restorePrivacyConfirm')}</button>}
              {confirmPrivacy && <button type="button" className="ghost" onClick={() => setConfirmPrivacy(false)}>{say(lang, 'cancel')}</button>}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
