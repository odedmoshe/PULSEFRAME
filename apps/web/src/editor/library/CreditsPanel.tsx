/**
 * Deliver → «קרדיטים» (wave 7 library track): the lines now (api.credits), «העתקת קרדיטים לתיאור» (clipboard = descriptionText of
 * the interface language), «כרטיס קרדיטים» (the add_credits_card op through the editor's commit), what is missing on screen.
 * Nothing is drawn while the library is not built or the project has no library material; the panel never claims a credit is
 * "done": it lists lines and what the server found missing on screen.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreditsView } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { fillLib, LIBRARY_UI_STRINGS } from './library.strings.ts';
import { sayFailure } from './LibraryBrowser.tsx';

export function CreditsView_({ view, lang, copied, busy, onCopy, onCard, cardRefused }: { view: CreditsView; lang: Lang; copied: boolean; busy: boolean; onCopy: () => void; onCard: () => void; cardRefused?: string | null }): ReactElement {
  const L = LIBRARY_UI_STRINGS[lang];
  return (
    <section className="pf-lib-credits" data-testid={TID.credits} aria-labelledby="pf-credits-h">
      <h3 id="pf-credits-h">{L.creditsTitle}</h3>
      {view.lines.length === 0 ? <p className="muted small">{L.creditsNone}</p> : (
        <ul className="pf-lib-credit-list">
          {view.lines.map((l) => <li key={`${l.assetId}:${l.text}`} data-testid={TID.creditsLine} data-asset-id={l.assetId}><b dir="auto">{l.title}</b> <span dir="auto">{l.text}</span></li>)}
        </ul>
      )}
      {view.onScreenMissing.length > 0 && (
        <p className="pf-lib-credit-missing" role="alert" data-testid={TID.creditsMissing}>{L.missingOnScreen}: <span dir="auto">{view.onScreenMissing.map((l) => l.title).join(', ')}</span></p>
      )}
      {view.lines.length > 0 && (
        <div className="row">
          <Button variant="secondary" size="sm" data-testid={TID.creditsCopy} onClick={onCopy}>{copied ? L.copied : L.copyCredits}</Button>
          <Button variant="secondary" size="sm" data-testid={TID.creditsCard} busy={busy} onClick={onCard}>{L.creditsCard}</Button>
        </div>
      )}
      {view.lines.length > 0 && <p className="pf-lib-muted">{L.creditsCardNote}</p>}
      {cardRefused != null && <p className="pf-lib-state is-err" role="alert">{fillLib(L.creditsCardRefused, { reason: cardRefused }).replace(/: $/, "")}</p>}
    </section>
  );
}

export function CreditsPanel({ projectId }: { projectId: string }): ReactElement | null {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const [view, setView] = useState<CreditsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    let alive = true;
    setCopied(false);
    api.credits(projectId, { lang, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) }).then(
      (v) => { if (alive) { setView(v); setError(null); } },
      (e: unknown) => { if (alive) { setView(null); setError((e as { code?: string })?.code === 'library_not_built' ? null : sayFailure(lang, e)); } },
    );
    return () => { alive = false; };
  }, [projectId, lang, state.revision, state.activeSequenceId]);
  if (error) return <p className="pf-lib-state is-err" role="alert" data-testid={TID.credits}>{error}</p>;
  if (!view) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(view.descriptionText); setCopied(true); } catch { setCopied(false); } };
  const card = async () => {
    setBusy(true);
    setRefused(false);
    // the editor's commit answers null when the server refused it (the reason is then the editor's error line, in the interface language)
    try { setRefused(!(await editor.commit([{ op: 'add_credits_card', args: { lang, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) } }], 'Credits card'))); } catch { setRefused(true); } finally { setBusy(false); }
  };
  return <CreditsView_ view={view} lang={lang} copied={copied} busy={busy} onCopy={() => void copy()} onCard={() => void card()} cardRefused={refused ? state.error ?? '' : null} />;
}
