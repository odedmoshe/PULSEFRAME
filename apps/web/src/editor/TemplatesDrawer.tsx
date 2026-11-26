/**
 * The Templates drawer of the library (ADR-0016): the template gallery from GET /api/v1/templates (the six built-ins and the
 * two that need a model this machine does not have, shown unavailable with their reason), genre chips (aria-pressed toggles),
 * cards that open the template dialog, and, after a template was applied here, a non-modal bar with Shuffle, Another tempo
 * and Undo (each one transaction: regenerate keeps hand-edited items; Undo is the editor's own). No animated previews in
 * wave 1; nothing here keeps project state.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { focusNow } from '../ds/focus.ts';
import { removedByHand, TEMPLATE_GENRES, type TemplateSummary } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { LayoutTemplate } from 'lucide-react';
import { useEditorState, type TemplateRunInfo } from './store.ts';
import { TEMPLATE_STRINGS } from './templates.strings.ts';
import { TEMPLATE_TESTIDS as TID } from './templates.testids.ts';
import { clock, filterByGenre, nextTempo, shuffleParams, templateApi, toggleGenre } from './templateDialog.logic.ts';
import { TemplateDialog, type AppliedTemplate } from './TemplateDialog.tsx';
import { templateRefusal } from './templateRefusals.ts';
import './templates.css';
import { MUSICFIT_UI_BUILT } from './musicfit/MusicFitBlock.tsx';
import { SwapMusicButton } from './musicfit/SwapMusicDialog.tsx';
import { OwnTemplateSection } from './owntemplate/OwnTemplateSection.tsx';
import type { OwnTemplateSummary } from '@pulseframe/core';

/** The card is in the page while its dialog is open: the focus goes back to it first, then the dialog closes, in one task. */
const focusCard = (id: string) => focusNow(document.querySelector<HTMLElement>(`[data-testid=${TID.card}][data-template-id="${CSS.escape(id)}"]`));

export function TemplatesDrawer() {
  const { editor, state, t } = useEditorState();
  const lang = state.lang;
  const S = TEMPLATE_STRINGS[lang];
  const open = state.templatesOpen;
  const headId = useId(), bodyId = useId();
  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [dialog, setDialog] = useState<TemplateSummary | null>(null);
  const load = () => { setFailed(null); templateApi.list().then((r) => setList(r.templates)).catch((e) => { const f = templateRefusal(lang, e); setFailed(f.hint ? `${f.message} — ${f.hint}` : f.message); }); };
  useEffect(() => { if (open && !list) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // opened from the palette or Welcome: the focus goes to the first card once the cards are there (to the toggle if none load)
  const focused = useRef(0);
  // a layout effect: the focus is given in the commit that draws the cards (or the failure note), not in a later task
  useLayoutEffect(() => {
    if (!state.templatesFocus || focused.current === state.templatesFocus || (!list && !failed)) return;
    focused.current = state.templatesFocus;
    focusNow(document.querySelector<HTMLElement>(`[data-testid=${TID.drawer}] [data-testid=${TID.card}]`) ?? document.querySelector<HTMLElement>(`[data-testid=${TID.drawer}] [data-testid=templates-toggle]`));
  }, [state.templatesFocus, list, failed]);
  // the run bar (and its Shuffle button) is drawn by the commit that stores the applied run: AppliedBar takes the focus then
  const shuffleFor = useRef<string | null>(null);

  const applied = (s: TemplateSummary, a: AppliedTemplate) => {
    shuffleFor.current = a.result.runId; // before the store is told: its listeners may draw the bar at once
    setDialog(null);
    editor.setTemplateRun({ runId: a.result.runId, templateId: s.id, name: s.name, params: a.params, alternatives: a.alternatives, created: a.result.createdIds.length, revision: a.result.revision });
  };
  const shown = list ? filterByGenre(list, genres) : [];
  const reasonOf = (s: TemplateSummary) => (s.needs.model ? t(`template.unavailable.${s.needs.model}` as Key) : null) ?? s.unavailableReason ?? '';

  return (
    <section className="pf-tpl-drawer" data-testid={TID.drawer} aria-labelledby={headId}>
      <h2 id={headId} className="pf-tpl-head">
        <button type="button" className="ghost pf-tpl-toggle" data-testid="templates-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => editor.set({ templatesOpen: !open })}>
          <LayoutTemplate size={16} aria-hidden="true" /> {S.title}
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="pf-tpl-body">
          <p className="muted">{S.intro}</p>
          {/* «התבניות שלכם» and «שמירת הסרט כתבנית» (wave 8 owntemplate; draws nothing until W3, who owns this file and the section) */}
          <OwnTemplateSection lang={lang} templates={(list ?? []).filter((x): x is OwnTemplateSummary => 'own' in x && !!(x as { own?: unknown }).own)} onOpen={(x) => setDialog(x)} onDeleted={() => { setList(null); load(); }} />
          <div className="pf-tpl-chips" role="group" aria-label={S.genres}>
            {TEMPLATE_GENRES.map((g) => (
              <button key={g} type="button" className="ghost pf-tpl-chip" data-testid={TID.genreChip} data-genre={g} aria-pressed={genres.includes(g)} onClick={() => setGenres((x) => toggleGenre(x, g))}>{S.genre[g]}</button>
            ))}
          </div>
          {failed && <p className="danger" role="alert" data-testid="templates-error">{S.loadFailed}: <bdi dir="auto">{failed}</bdi> <button type="button" className="ghost" onClick={load}>{S.retry}</button></p>}
          {!list && !failed && <p className="muted" role="status">{S.loading}</p>}
          {list && shown.length === 0 && <p className="muted" role="status">{S.noneInGenre}</p>}
          <ul className="pf-tpl-cards">
            {shown.map((s) => {
              const reason = s.available ? null : reasonOf(s);
              const reasonId = `${bodyId}-why-${s.id}`;
              return (
                <li key={s.id}>
                  <button type="button" className={`pf-tpl-card${s.available ? '' : ' unavailable'}`} data-testid={TID.card} data-template-id={s.id} data-available={s.available ? 'true' : 'false'} data-genre={s.genre}
                    aria-disabled={!s.available || undefined} aria-describedby={reason ? reasonId : undefined} aria-label={s.available ? S.open(s.name[lang]) : `${s.name[lang]} — ${S.unavailable}`}
                    onClick={() => { if (s.available) setDialog(s); }}>
                    <strong className="pf-tpl-name">{s.name[lang]}</strong>
                    <span className="pf-tpl-hint">{s.hint[lang]}</span>
                    <span className="pf-tpl-meta">
                      {s.available && <><bdi dir="ltr">{clock(s.seconds)}</bdi> · {S.slots(s.slots.length)} · {S.designedFor[s.designedFor]}</>}
                    </span>
                    <span className="pf-tpl-badges">
                      {s.available && <span className="pf-tpl-badge">{S.needs[s.needs.music]}</span>}
                      {s.needs.elements && <span className="pf-tpl-badge">{S.needs.elements}</span>}
                      {s.needs.gpu && <span className="pf-tpl-badge">{S.needs.gpu}</span>}
                      {!s.available && <span className="pf-tpl-badge off">{S.unavailable}</span>}
                    </span>
                    {reason && <span id={reasonId} className="pf-tpl-reason" data-testid={TID.cardReason}>{reason}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <AppliedBar shuffleFor={shuffleFor} />
      {dialog && <TemplateDialog summary={dialog} onClose={() => { focusCard(dialog.id); setDialog(null); }} onApplied={(a) => applied(dialog, a)} />}
    </section>
  );
}

/** After apply: what was done, and Shuffle / Another tempo (regenerate, one transaction each) and Undo. Not modal. */
function AppliedBar({ shuffleFor }: { shuffleFor: MutableRefObject<string | null> }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const S = TEMPLATE_STRINGS[lang];
  const run = state.templateRun;
  const [busy, setBusy] = useState<'shuffle' | 'tempo' | 'restore' | null>(null);

  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { setSaid(null); setFailed(null); }, [run?.templateId]);
  useLayoutEffect(() => {
    if (!run || shuffleFor.current !== run.runId) return;
    shuffleFor.current = null;
    focusNow(document.querySelector<HTMLElement>(`[data-testid=${TID.shuffle}]`));
  }, [run?.runId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!run || !state.doc) return null;
  // items of the run deleted by hand: a regeneration leaves them out, and bringing them back is an explicit choice
  const removed = removedByHand(state.doc, (Object.hasOwn(state.doc.recipeRuns, run.runId) ? state.doc.recipeRuns[run.runId]!.slots : undefined) ?? []).length;
  const regenerate = async (kind: 'shuffle' | 'tempo' | 'restore') => {
    const doc = state.doc;
    if (!doc || busy) return;
    const change = kind === 'shuffle' ? shuffleParams(run.params) : kind === 'tempo' ? nextTempo(run.params, run.alternatives) : {};
    setBusy(kind);
    setFailed(null);
    try {
      const r = await templateApi.regenerate(doc.id, run.runId, change, kind === 'restore');
      const next: TemplateRunInfo = { ...run, runId: r.runId, params: { ...run.params, ...change }, created: r.createdIds.length, revision: r.revision };
      editor.setTemplateRun(next);
      const tempo = kind === 'tempo' && change.tempo ? ` ${S.tempoNow(S.tempoNames[change.tempo])}` : '';
      const left = r.removed?.length ?? 0;
      // items that had only been moved in time (a Delete that closed the gap moved them) are back on their slots: said, not silent
      const back = r.movedBack?.length ?? 0;
      setSaid(`${S.regenerated(r.replaced, r.protected.length)}${tempo}${back ? S.movedBack(back) : ''}${left ? S.removedLeftOut(left) : ''}${kind === 'restore' ? ` ${S.restored}` : ''}`);
    } catch (e) {
      const f = templateRefusal(lang, e); // worded in the interface language, as the dialog and the editor's refusals are
      setFailed(f.hint ? `${f.message} — ${f.hint}` : f.message);
    } finally { setBusy(null); }
  };
  return (
    <div className="pf-tpl-applied" role="region" aria-label={S.appliedLabel} data-testid={TID.applied} data-run-id={run.runId}>
      <p role="status">{said ?? S.applied(run.name[lang], run.created)}</p>
      <div className="row">
        <button type="button" className="ghost" disabled={!!busy} aria-busy={busy === 'shuffle' || undefined} data-testid={TID.shuffle} onClick={() => void regenerate('shuffle')}>{S.shuffle}</button>
        <button type="button" className="ghost" disabled={!!busy} aria-busy={busy === 'tempo' || undefined} data-testid={TID.otherTempo} onClick={() => void regenerate('tempo')}>{S.otherTempo}</button>
        {removed > 0 && <button type="button" className="ghost" disabled={!!busy} aria-busy={busy === 'restore' || undefined} data-testid="template-restore-removed" onClick={() => void regenerate('restore')}>{S.restoreRemoved}</button>}
        {/* «מוזיקה אחרת» (wave 7 musicfit): once builder C has built it */}
        {MUSICFIT_UI_BUILT && <SwapMusicButton host={{ kind: 'template', runId: run.runId }} />}
        <button type="button" className="ghost" disabled={!!busy} data-testid="template-undo" onClick={() => { void editor.history('undo'); editor.setTemplateRun(null); }}>{S.undo}</button>
        <button type="button" className="ghost" aria-label={S.dismiss} data-testid="template-applied-close" onClick={() => editor.setTemplateRun(null)}>×</button>
      </div>
      {failed && <p className="danger" role="alert"><bdi dir="auto">{failed}</bdi></p>}
    </div>
  );
}
