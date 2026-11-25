/**
 * Settings → «הספרייה שלי» (wave 7 library track): the folder (owner's own session only), save, «סריקה מחדש», the state in words,
 * counts by kind, «לא אומת מאז ההורדה». A library the build does not have yet shows that, not an empty form.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { LIBRARY_KINDS, type LibraryStatus } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { fillLib, libText, LIBRARY_UI_STRINGS } from './library.strings.ts';
import { isOwnerActor, kindText, stateText, unusableText } from './library.logic.ts';
import { sayFailure } from './LibraryBrowser.tsx';
import { useLibraryStatus } from './useLibraryStatus.ts';

export function LibraryStatusView({ status, lang }: { status: LibraryStatus; lang: Lang }): ReactElement {
  const L = LIBRARY_UI_STRINGS[lang];
  const kinds = LIBRARY_KINDS.filter((k) => (status.counts[k] ?? 0) > 0);
  const unusable = Object.entries(status.unusable).filter(([, n]) => (n ?? 0) > 0) as [keyof typeof status.unusable & string, number][];
  return (
    <>
      <p role="status" data-testid={TID.settingsState} data-state={status.state}>
        {stateText(lang, status.state)}
        {status.state === 'indexing' && status.progress && <> · {fillLib(L.indexing, { rows: status.progress.rows })}</>}
      </p>
      <div data-testid={TID.settingsCounts}>
        <ul className="pf-lib-counts">
          {kinds.map((k) => <li key={k}>{kindText(lang, k)}: <bdi className="num">{status.counts[k]}</bdi></li>)}
          {status.notListed.map((n) => <li key={n.dir}>{n.dir} ({libText(lang, 'library.notRead')}): <bdi className="num">{n.entries}</bdi></li>)}
          {unusable.map(([r, n]) => <li key={r}>{unusableText(lang, r as never)}: <bdi className="num">{n}</bdi></li>)}
        </ul>
        {status.problems.length > 0 && <ul className="pf-lib-problems">{status.problems.map((p, i) => <li key={i} dir="auto">{p.item ?? ''} {p.reason}</li>)}</ul>}
        <p className="pf-lib-muted">{libText(lang, 'library.notVerified')}</p>
      </div>
    </>
  );
}

/** Owner only: any other session draws nothing and asks the server nothing. */
export function LibrarySettings(): ReactElement | null {
  const { state } = useEditorState();
  return isOwnerActor(state.actor) ? <LibrarySettingsOwner lang={state.lang} /> : null;
}

function LibrarySettingsOwner({ lang }: { lang: Lang }): ReactElement {
  const L = LIBRARY_UI_STRINGS[lang];
  const { status, failure, reload, set } = useLibraryStatus();
  const [root, setRoot] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status?.root !== undefined) setRoot(status.root); }, [status?.root]);
  const run = async (f: () => Promise<LibraryStatus>) => {
    setBusy(true); setNote(null);
    try { set(await f()); } catch (e) { setNote({ ok: false, text: sayFailure(lang, e) }); } finally { setBusy(false); reload(); }
  };
  const notBuilt = failure?.code === 'library_not_built' || failure?.status === 501;
  return (
    <section className="pf-lib-settings" data-testid={TID.settings} aria-labelledby="pf-lib-settings-h">
      <h3 id="pf-lib-settings-h" className="pf-set-h">{L.settingsTitle}</h3>
      {notBuilt ? <p className="pf-lib-state" role="status" data-testid={TID.settingsState} data-state="not_built">{L.notBuilt}</p> : (
        <>
          <label className="pf-lib-field" htmlFor="pf-lib-root"><span>{L.root}</span>
            <input id="pf-lib-root" data-testid={TID.settingsRoot} dir="ltr" value={root} onChange={(e) => setRoot(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="pf-lib-root-hint" /></label>
          <p id="pf-lib-root-hint" className="pf-lib-muted">{L.rootHint}</p>
          <div className="row">
            <Button variant="primary" size="sm" data-testid={TID.settingsSave} busy={busy} onClick={() => void run(() => api.setLibraryRoot(root.trim() || null))}>{L.save}</Button>
            <Button variant="secondary" size="sm" data-testid={TID.settingsReindex} busy={busy} disabledReason={status && status.state !== 'not_configured' ? undefined : stateText(lang, 'not_configured')} onClick={() => void run(() => api.reindexLibrary())}>{L.reindex}</Button>
          </div>
          {failure && !notBuilt && <p className="pf-lib-state is-err" role="alert">{sayFailure(lang, failure)}</p>}
          {note && <p className={`pf-lib-state${note.ok ? '' : ' is-err'}`} role="alert">{note.text}</p>}
          {status && <LibraryStatusView status={status} lang={lang} />}
        </>
      )}
    </section>
  );
}
