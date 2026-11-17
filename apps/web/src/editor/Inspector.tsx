/**
 * The inspector column (UX_REDESIGN §4.6, §4.9). What it shows follows the mode and the selection:
 *   the selection   a header that names the object, its own tab set (one category per screen), closed sections with a summary
 *                   of their values, help behind "?", and a quiet footer;
 *   the mode        Sound adds the mixer, Captions the caption and transcript panels, Deliver the delivery, review and
 *                   recipe panels; Look holds the object on its colour tab with the scopes above it.
 * "All tools on one screen" (the legacy `all` panel, still chosen by `pf.inspector.tab.v1 = all`) lays every panel and every
 * tab of the object out in one scroll with every section open.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LayoutList, ListCollapse } from 'lucide-react';
import * as T from '@pulseframe/time';
import { clipEnd } from '@pulseframe/core';
import { dictionaries, type Key } from '@pulseframe/i18n';
import type { Keymap } from './commands.ts';
import { Scopes } from './Scopes.tsx';
import { useEditorState, type PanelTarget } from './store.ts';
import { DeliverPanel } from './DeliverPanel.tsx';
import { RecipesPanel } from './RecipesPanel.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { PacingPanel } from './PacingPanel.tsx';
import { Section, SECTION_STRINGS, SectionsContext, setAllSections } from './Section.tsx';
import { formatBytes } from './ProjectsDialog.tsx';
import { AccessPanel } from './AccessPanel.tsx';
import { ActivityDialog } from './ActivityDialog.tsx';
import { CaptionControls, FillerPanel, SilencePanel, TranscribeAll, TranscriptPanel } from './TranscriptPanel.tsx';
import { TAB_ICON_COMPONENTS } from './icons.tsx';
import { INSPECTOR_STRINGS } from './inspector.strings.ts';
import { activeTab, INSPECTOR_PAGES, objectKind, pagesFor, pinnedTab, REAL_PAGES, tabsFor, type InspectorPage, type ObjectTab } from './inspector.model.ts';
import { ObjectFooter, ObjectHeader, ObjectPanels } from './InspectorObject.tsx';
import { STAGE_STRINGS } from './stage.strings.ts';
import { useWideStage } from './Transport.tsx';
import './inspector.css';

const TAB_KEY = 'pf.inspector.tab.v1';
const CUSTOM_TABS_KEY = 'pf.workspace.custom.v1';
function loadCustomTabs(): InspectorPage[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_TABS_KEY) ?? 'null');
    const ok = Array.isArray(v) ? REAL_PAGES.filter((x) => v.includes(x)) : [];
    if (ok.length) return ok;
  } catch { /* fall through */ }
  return ['clip', 'sound', 'deliver'];
}
function loadTab(): InspectorPage {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if ((INSPECTOR_PAGES as readonly string[]).includes(v ?? '')) return v as InspectorPage;
  } catch { /* storage unavailable */ }
  return 'clip';
}

/** The tab of an object that holds what the ride bar asks for (editor.openPanel); null when the object has none (the gallery targets open the gallery instead). */
export function panelTab(target: PanelTarget, kind: string): ObjectTab | null {
  switch (target) {
    case 'speed': return 'speed';
    case 'animation': return kind === 'text' ? 'anim' : 'motion';
    case 'effects': return 'effects';
    case 'transition': return 'transition';
    case 'sound': return 'audio';
    case 'replace': return kind === 'sound' ? 'beat' : 'basic';
    default: return null;
  }
}
/** The control the focus moves to once the tab of a panel request is shown: the kept test ids of that content. */
const PANEL_FOCUS: Partial<Record<PanelTarget, string>> = {
  speed: '[data-testid=clip-speed]', animation: '[data-testid=text-animation], [data-testid=animate-controls]', transition: '[data-testid=transition-type], [data-testid=transition-controls]',
  replace: '[data-testid=replace-media-block]', sound: '[data-testid=insp-panel-audio]',
};
/** Opens the closed section around `el` (its toggle), scrolls it into view and moves the focus to its first control. */
function revealControl(el: HTMLElement | null) {
  if (!el) return;
  const sec = el.closest<HTMLElement>('.pf-section[data-open=false]');
  sec?.querySelector<HTMLButtonElement>('.pf-section-toggle')?.click();
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'center' });
    (el.matches('button, input, select, textarea, [tabindex]') ? el : el.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]'))?.focus({ preventScroll: true });
  });
}

function FillerSection() {
  const { state, t } = useEditorState();
  if (!state.doc || !Object.keys(state.doc.transcripts).length) return null;
  return (<><h2>{t('filler')}</h2><FillerPanel /></>);
}

/** Fills the track of every native slider of the inspector up to its value (the --v custom property; inspector.css draws it). */
function paintRanges(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((el) => {
    const min = Number(el.min || 0), max = Number(el.max || 100);
    const v = max > min ? `${(((Number(el.value) - min) / (max - min)) * 100).toFixed(1)}%` : '0%';
    if (el.style.getPropertyValue('--v') !== v) el.style.setProperty('--v', v);
  });
}

export function Inspector({ keymap }: { keymap: Keymap }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const sel = editor.selected;
  const root = useRef<HTMLElement>(null);
  const [page, setPageState] = useState<InspectorPage>(loadTab);
  const [activityOpen, setActivityOpen] = useState(false);
  const setPage = (next: InspectorPage) => {
    setPageState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  };
  const flat = page === 'all';
  // The custom workspace offers the panels the user ticked (kept in this browser), in the usual order; at least one.
  const [custom, setCustom] = useState<InspectorPage[]>(loadCustomTabs);
  const toggleCustom = (id: Exclude<InspectorPage, 'all'>) => {
    const next = REAL_PAGES.filter((x) => (x === id ? !custom.includes(x) : custom.includes(x)));
    if (!next.length) return; // the last panel stays
    setCustom(next);
    try { localStorage.setItem(CUSTOM_TABS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    if (!(next as readonly InspectorPage[]).includes(page)) setPage(next[0]!);
  };
  const waiting = state.proposals.length + state.approvals.length;
  const pages = pagesFor(state.workspace, { custom, waiting, flat });
  // The mode narrows the panels on offer. Choosing a mode shows its first panel; a panel that is no longer offered gives way to the first one.
  const lastWs = useRef(state.workspace);
  useEffect(() => {
    if (lastWs.current !== state.workspace) { lastWs.current = state.workspace; setPage(pagesFor(state.workspace, { custom, waiting, flat: false })[0]!); }
    else if (!pages.includes(page)) setPage(pages[0]!);
  }, [state.workspace, pages.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the object ----
  const kind = objectKind(state.doc, state.selection, state.cutClipId);
  const [chosen, setChosen] = useState<ObjectTab | null>(null);
  const tab = activeTab(kind, chosen, state.workspace);
  const selKey = state.selection.join(',');
  const lastSel = useRef(selKey);
  useEffect(() => {
    if (lastSel.current === selKey) return;
    lastSel.current = selKey;
    // A new selection always opens the object's first tab, and the object itself when the mode offers it beside another panel.
    setChosen(null);
    if (selKey && !flat && page !== 'clip' && pages.includes('clip')) setPage('clip');
    // A title or a caption chosen while the playhead is elsewhere: the playhead moves into it, so it shows in the viewer.
    // A move of the view only, never an edit.
    const one = state.selection.length === 1 ? editor.selected : undefined;
    if (one && (one.clip.type === 'text' || one.clip.type === 'caption') && !editor.player?.playing && !(T.lte(one.clip.start, editor.playhead) && T.lt(editor.playhead, clipEnd(one.clip)))) {
      const a = T.frameIndexAt(one.clip.start, editor.rate), b = T.frameIndexAt(clipEnd(one.clip), editor.rate);
      editor.seek(Math.min(b - 1, a + Math.floor((b - a) / 2)));
      editor.sayOnStage(STAGE_STRINGS[state.lang][one.clip.type === 'text' ? 'movedIntoTitle' : 'movedIntoCue']);
    }
  }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // a cut that no longer exists (its clips were moved apart, or the clip is gone) is no longer chosen
  useEffect(() => { if (state.cutClipId && kind !== 'cut') editor.selectCut(null); }, [state.cutClipId, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // another part of the editor asks for a tab of the object (the gallery after it applied an effect)
  useEffect(() => { const r = state.inspectorTab; if (r && tabsFor(kind).includes(r.tab)) { setChosen(r.tab); if (!flat && page !== 'clip' && pages.includes('clip')) setPage('clip'); } }, [state.inspectorTab?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // the ride bar asks for a panel (editor.openPanel): the object's tab that holds it, then the focus on its first control. After
  // the selection effect above, so a request that also selected the clip lands on the new object's tab.
  useEffect(() => {
    const r = state.panelRequest;
    if (!r) return;
    const want = panelTab(r.target, kind);
    if (want && tabsFor(kind).includes(want)) setChosen(want);
    if (!flat && page !== 'clip' && pages.includes('clip')) setPage('clip');
    const target = PANEL_FOCUS[r.target];
    if (!target) return;
    // two frames: the tab chosen above has rendered by then
    let h = requestAnimationFrame(() => { h = requestAnimationFrame(() => revealControl(root.current?.querySelector<HTMLElement>(target) ?? null)); });
    return () => cancelAnimationFrame(h);
  }, [state.panelRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // an effect added to the selected clip: the effects tab opens on it
  const fxCount = sel && sel.clip.type !== 'caption' ? sel.clip.effects?.length ?? 0 : 0;
  const lastFx = useRef({ key: selKey, n: fxCount });
  useEffect(() => {
    const grew = lastFx.current.key === selKey && fxCount > lastFx.current.n;
    lastFx.current = { key: selKey, n: fxCount };
    if (grew && tabsFor(kind).includes('effects')) setChosen('effects');
  }, [selKey, fxCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => { paintRanges(root.current); });
  useEffect(() => {
    const el = root.current; if (!el) return;
    const on = (e: Event) => { const x = e.target as HTMLElement; if (x instanceof HTMLInputElement && x.type === 'range') paintRanges(el); };
    el.addEventListener('input', on);
    return () => el.removeEventListener('input', on);
  }, []);

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = pages.indexOf(page);
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let n = i;
    // Visual left/right; DOM order runs right-to-left in RTL.
    if (e.key === 'ArrowRight') n = rtl ? i - 1 : i + 1;
    else if (e.key === 'ArrowLeft') n = rtl ? i + 1 : i - 1;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = pages.length - 1;
    else return;
    e.preventDefault();
    n = (n + pages.length) % pages.length;
    setPage(pages[n]!);
    document.getElementById(`inspector-tab-${pages[n]}`)?.focus();
  };
  const show = (id: InspectorPage) => flat || page === id;
  const panelProps = (id: Exclude<InspectorPage, 'all'>) => ({
    role: 'tabpanel' as const,
    id: `inspector-panel-${id}`,
    'aria-labelledby': pages.length > 1 ? `inspector-tab-${id}` : undefined,
    'aria-label': pages.length > 1 ? undefined : S.inspector,
    hidden: !show(id),
    className: 'inspector-panel',
    'data-testid': `inspector-panel-${id}`,
  });
  const pageLabel = (id: InspectorPage) => (id === 'all' ? S.allTools : id === 'clip' ? S.pageObject : id === 'sound' ? S.pageSound : id === 'speech' ? S.pageSpeech : t(`inspector.tab.${id}` as Key));
  const colour = state.workspace === 'color';
  const wide = useWideStage(); // at wide windows the scopes dock beside the viewer (Transport.tsx)
  const motionOnly = state.workspace === 'motion';
  const noColour = colour && pinnedTab('color', kind) === null;
  return (
    <SectionsContext.Provider value={{ flat, labels: { help: S.help, reset: S.reset } }}>
    <aside ref={root} className="inspector pf-ds pf-insp" aria-label={t('inspector')} data-view={flat ? 'all' : 'tabs'} data-mode={state.workspace} data-page={page} data-kind={kind}>
      <h2 className="sr-only">{t('inspector')}</h2>
      {state.workspace === 'custom' && (
        <fieldset className="custom-panels" data-testid="custom-panels">
          <legend>{t('workspace.custom.choose')}</legend>
          {REAL_PAGES.map((id) => (
            <label key={id} className="check">
              <input type="checkbox" checked={custom.includes(id)} disabled={custom.length === 1 && custom.includes(id)} data-testid={`custom-panel-${id}`} onChange={() => toggleCustom(id)} />
              {t(`inspector.tab.${id}` as Key)}
            </label>
          ))}
        </fieldset>
      )}
      {pages.length > 1 && (
        <div className={`inspector-tabs${pages.length > 4 ? ' is-icons' : ''}`} role="tablist" aria-label={S.pages} onKeyDown={onTabKey}>
          {pages.map((id) => (
            <button key={id} type="button" role="tab" id={`inspector-tab-${id}`} data-testid={`inspector-tab-${id}`} title={pageLabel(id)}
              aria-selected={page === id} aria-controls={id === 'all' ? REAL_PAGES.map((x) => `inspector-panel-${x}`).join(' ') : `inspector-panel-${id}`}
              tabIndex={page === id ? 0 : -1} className={`inspector-tab ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
              {(() => { const TabIcon = TAB_ICON_COMPONENTS[id]; return TabIcon ? <TabIcon /> : null; })()}
              <span className="inspector-tab-label">{pageLabel(id)}</span>
              {id === 'review' && waiting > 0 && (
                <span className="tab-badge" role="img" aria-label={`${waiting} ${t('inspector.tab.review.badge')}`} data-testid="inspector-review-badge">{waiting}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div {...panelProps('clip')}>
        <div className="insp-top">
          <ObjectHeader kind={kind} keymap={keymap} />
          {flat
            ? <button type="button" className="oh-more" data-testid="inspector-tabs-back" aria-label={S.allToolsBack} title={S.allToolsBack} onClick={() => setPage('clip')}><ListCollapse size={18} strokeWidth={1.75} aria-hidden="true" /></button>
            : <button type="button" className="oh-more" data-testid={pages.includes('all') ? undefined : 'inspector-tab-all'} aria-label={S.allTools} title={S.allTools} onClick={() => setPage('all')}><LayoutList size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
        </div>
        {flat && (
          <div className="pf-sections-bar" role="group" aria-label={SECTION_STRINGS[state.lang].group}>
            <span className="muted">{S.allToolsOn}</span>
            <button type="button" className="ghost" data-testid="sections-open-all" onClick={() => setAllSections(true)}>{SECTION_STRINGS[state.lang].openAll}</button>
            <button type="button" className="ghost" data-testid="sections-close-all" onClick={() => setAllSections(false)}>{SECTION_STRINGS[state.lang].closeAll}</button>
          </div>
        )}
        {/* Look mode: the scopes of the frame on screen stand above the colour tab (at wide windows they dock beside the viewer instead: Transport.tsx) */}
        {colour && !flat && !wide && <div className="insp-scopes" data-testid="insp-scopes"><Section id="scopes" title={S.secScopes} help><Scopes /></Section></div>}
        {(colour || motionOnly) && <p className="sr-only" data-testid="clip-focus-note">{t(motionOnly ? 'workspace.motion.note' : 'workspace.color.note')}</p>}
        {noColour && sel ? <p className="muted insp-note" data-testid="color-none">{t('workspace.color.none')}</p> : null}
        <ObjectPanels key={`${kind}:${sel?.clip.id ?? ''}`} kind={kind} tab={tab} onTab={setChosen} keymap={keymap} firstIsClipTab={!(pages.includes('clip') && pages.length > 1)} />
        <ObjectFooter kind={kind} />
      </div>
      <div {...panelProps('speech')}>
        <h2>{t('transcript')}</h2>
        <TranscribeAll />
        <TranscriptPanel />
        <FillerSection />
        <h2>{t('silence')}</h2>
        <SilencePanel />
      </div>
      <div {...panelProps('captions')}>
        <h2>{t('captions')}</h2>
        <CaptionControls editor={editor} />
      </div>
      <div {...panelProps('sound')}>
        <h2>{S.pageSound}</h2>
        <SoundPanel />
      </div>
      <div {...panelProps('deliver')}>
        <h2>{t('inspector.tab.deliver')}</h2>
        <DeliverPanel />
        <PacingPanel />
      </div>
      <div {...panelProps('recipes')}>
        <h2>{t('inspector.tab.recipes')}</h2>
        <RecipesPanel />
      </div>
      <div {...panelProps('review')}>
      <h2>{t('proposals')}</h2>
      {state.proposals.length === 0 ? <p className="muted">{t('proposals.none')}</p> : (
        <ul className="proposals" data-testid="proposals">
          {state.proposals.map((p) => (
            <li key={p.id} data-proposal-id={p.id}>
              <span className="muted">{t('proposal.from')} <bdi>{p.actor}</bdi></span>
              <strong dir="auto">{p.label ?? p.summary}</strong>
              {/* Before/after stills rendered by the export compositor at the middle of the first clip the proposal changes. */}
              <span className="ba">
                {(['before', 'after'] as const).map((side) => (
                  <figure key={side}><img alt={t(`proposal.${side}` as Key)} loading="lazy" src={`/api/v1/projects/${state.doc?.id}/proposals/${p.id}/frame?side=${side}&scale=0.25&index=${p.previewFrame}`} /><figcaption>{t(`proposal.${side}` as Key)}</figcaption></figure>
                ))}
              </span>
              <span className="row">
                <button className="primary" onClick={() => void editor.decideProposal(p.id, 'accept')} data-testid="proposal-accept">{t('proposal.accept')}</button>
                <button className="ghost" onClick={() => void editor.decideProposal(p.id, 'reject')} data-testid="proposal-reject">{t('proposal.reject')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.approvals.length > 0 && (
        <>
          <h2>{t('approvals')}</h2>
          <ul className="proposals" data-testid="approvals">
            {state.approvals.map((a) => (
              <li key={a.id} data-approval-id={a.id}>
                <span className="muted">{t('proposal.from')} <bdi>{a.requestedBy}</bdi></span>
                {a.kind === 'model-download' ? (
                  <>
                    <strong>{t('approval.modelDownload')}: <bdi dir="ltr">{a.action.capabilityId}</bdi></strong>
                    <span data-testid="approval-size">{t('approval.size')}: <bdi dir="ltr">{formatBytes(a.action.bytes ?? 0)}</bdi> · {(a.action.models ?? []).length} {t('storage.files')}</span>
                    <span className="muted" dir="ltr">{(a.action.models ?? []).map((m) => m.path).join(', ')}</span>
                  </>
                ) : <strong><bdi dir="ltr">{a.kind}</bdi></strong>}
                <span className="muted">{t('approval.expires')}: <bdi dir="ltr">{new Date(a.expiresAt).toLocaleTimeString()}</bdi></span>
                <span className="row">
                  <button className="primary" onClick={() => void editor.decideApproval(a.id, 'approve')} data-testid="approval-approve">{t('approval.approve')}</button>
                  <button className="ghost" onClick={() => void editor.decideApproval(a.id, 'reject')} data-testid="approval-reject">{t('proposal.reject')}</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>{t('activity')}</h2>
      <button type="button" className="ghost" data-testid="activity-open" onClick={() => setActivityOpen(true)}>{t('activity.all')}</button>
      {activityOpen && <ActivityDialog onClose={() => { setActivityOpen(false); setTimeout(() => document.querySelector<HTMLElement>('[data-testid=activity-open]')?.focus(), 0); }} />}
      <label className="check"><input type="checkbox" checked={state.followAgent} onChange={(e) => editor.set({ followAgent: e.target.checked })} data-testid="follow-agent" /> {t('follow.agent')}</label>
      <ol className="activity" data-testid="activity" aria-live="polite">
        {state.activity.length === 0 && <li className="muted">{t('activity.empty')}</li>}
        {state.activity.map((e) => (
          <li key={e.revision} data-actor={e.actor}>
            <span className={`actor ${e.actor.startsWith('agent') ? 'agent' : ''}`}>{e.actor.startsWith('agent') ? t('actor.agent') : t('actor.user')}</span>
            {/* Described in the interface language from the operation names; the server's detailed English summary stays available as a tooltip. */}
            <span dir="auto" title={e.summary}>{e.kind === 'undo' ? `${t('undo')}: ` : e.kind === 'redo' ? `${t('redo')}: ` : ''}{e.ops?.length ? e.ops.map((o) => dictionaries[state.lang][`op.${o}` as Key] ?? o).join(' · ') : e.summary}</span>
          </li>
        ))}
      </ol>
      <AccessPanel />
      </div>
    </aside>
    </SectionsContext.Provider>
  );
}
