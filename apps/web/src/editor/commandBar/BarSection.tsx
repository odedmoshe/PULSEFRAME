/**
 * The bar's rows at the top of the palette's listbox (ADR-0027; plan §6): the result row (BAR_DOM_IDS.result, the first option,
 * active by default), the choices of an ambiguous request, the nearest commands under an unknown one, the preview panel the
 * input's aria-describedby names, and the one polite live region. Draws nothing while the query is empty.
 */
import { useEffect, type ReactElement } from 'react';
import { Terminal } from 'lucide-react';
import { COMMAND_BAR_TESTIDS as TID, BAR_DOM_IDS } from './commandBar.testids.ts';
import { barText, plain } from './commandBar.strings.ts';
import type { BarPanelProps, BarSectionProps } from './contract.ts';
import { PreviewPanel, RefusalText, Rich, Typed, commandLabel, readWords, refusalReason } from './BarPreview.tsx';
import { describeAction, intentName } from './describe.ts';
import { sigOf, isBarSlot, useBarEditor, type BarEntry, type BarSlot } from './useBarResult.ts';
import './commandBar.css';

export function BarSection(props: BarSectionProps): ReactElement | null {
  if (!isBarSlot(props.slot)) return null;
  return <Section {...props} slot={props.slot} />;
}

function Section({ slot, query, activeKey, onHover, optionDomId }: BarSectionProps & { slot: BarSlot }): ReactElement | null {
  const { state } = useBarEditor();
  const lang = state.lang;
  const { view } = slot;
  const rate = state.doc?.settings.frameRate;
  // the rows only: the listbox owns options and groups, nothing else (the live region and the preview are BarPanel's, outside it)
  if (!view.result || view.entries.length === 0) return null;
  const r = view.result;
  const act = (e: BarEntry) => { if (e.key !== activeKey) onHover(e.key); else slot.activate(e.key); };

  const resultRow = view.entries[0]!;
  const summary = (() => {
    switch (r.kind) {
      case 'plan': case 'action': return <><span className="pf-bar-lead">{barText(lang, 'understood')}</span> <Typed query={query} readings={r.readings} /></>;
      case 'ambiguous': return <span className="pf-bar-lead">{barText(lang, 'ambiguous.heading')}</span>;
      case 'incomplete': return <><span className="pf-bar-lead">{barText(lang, 'incomplete.heard', { words: readWords(query, r.readings) || query.trim() })}</span> <span>{barText(lang, 'incomplete.missing', { missing: r.missing.map((m) => barText(lang, `missing.${m}` as never)).join(', ') })}</span></>;
      case 'refused': return <><span className="pf-bar-lead">{barText(lang, 'refused.heading')}</span> <bdi dir="auto">{refusalReason(r, lang)}</bdi></>;
      case 'unknown': return <span className="pf-bar-lead">{barText(lang, 'unknown.heading')}</span>;
    }
  })();
  const kind = r.kind === 'plan' || r.kind === 'action' ? (r.kind === 'plan' ? intentName(r.intent, lang) : plain(describeAction(r.action, lang, rate))) : null;

  return (
    <div role="group" aria-label={barText(lang, 'bar.label')} className="pf-bar" data-testid="bar-section">
      <div
        id={optionDomId(resultRow.key)} role="option" className="pf-pal-option pf-bar-row" data-testid={TID.result}
        aria-selected={resultRow.key === activeKey} aria-describedby={resultRow.key === activeKey ? BAR_DOM_IDS.preview : undefined} data-active={resultRow.key === activeKey || undefined}
        data-kind={r.kind} data-intent={'intent' in r ? r.intent : undefined} data-plan-hash={r.kind === 'plan' ? r.planHash : undefined}
        onMouseMove={() => resultRow.key !== activeKey && onHover(resultRow.key)} onClick={() => act(resultRow)}
      >
        <span className="pf-pal-names"><Terminal size={14} strokeWidth={1.75} aria-hidden="true" className="pf-pal-ic" /><span className="pf-pal-label">{summary}</span></span>
        {kind && <span className="pf-pal-kind"><Rich text={kind} /></span>}
      </div>
      {view.entries.some((e) => e.target?.kind === 'nearest' || e.target?.kind === 'example') && <div className="pf-bar-nearest-head" aria-hidden="true">{barText(lang, 'unknown.nearest')}</div>}
      {view.entries.slice(1).map((e, i) => {
        const nearest = e.target?.kind === 'nearest' || e.target?.kind === 'example';
        const example = e.target?.kind === 'example' ? e.target : null;
        const label = example ? barText(lang, 'example.row', { text: example.text }) : nearest ? commandLabel((e.target as { commandId: string }).commandId, lang) : e.label?.[lang] ?? '';
        const alt = nearest && !example ? commandLabel((e.target as { commandId: string }).commandId, lang === 'he' ? 'en' : 'he') : null;
        return (
          <div
            key={e.key} id={optionDomId(e.key)} role="option" className="pf-pal-option pf-bar-row" aria-selected={e.key === activeKey} data-active={e.key === activeKey || undefined}
            aria-describedby={e.key === activeKey ? BAR_DOM_IDS.preview : undefined}
            {...(example ? { 'data-testid': TID.nearest, 'data-intent': example.intent, 'data-example': 'true' } : nearest ? { 'data-testid': TID.nearest, 'data-command-id': (e.target as { commandId: string }).commandId } : { 'data-testid': TID.choice, 'data-index': i })}
            onMouseMove={() => e.key !== activeKey && onHover(e.key)} onClick={() => act(e)}
          >
            <span className="pf-pal-names"><span className="pf-pal-label" lang={lang}><bdi dir="auto">{label}</bdi></span>{alt && alt !== label && <span className="pf-pal-alt" lang={lang === 'he' ? 'en' : 'he'}>{alt}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The live region and the preview of the active row, OUTSIDE the palette's listbox (a listbox owns only options and groups;
 * the input's aria-describedby names the preview by id). The one polite live region is always mounted, so an announcement
 * is heard even while the query is empty. Enter acts only on a preview that is on the screen: the effect marks it after paint.
 */
export function BarPanel(props: BarPanelProps): ReactElement | null {
  if (!isBarSlot(props.slot)) return null;
  return <Panel {...props} slot={props.slot} />;
}
function Panel({ slot, query, activeKey, off }: BarPanelProps & { slot: BarSlot }): ReactElement {
  const { state } = useBarEditor();
  const lang = state.lang;
  const { view, session } = slot;
  const rate = state.doc?.settings.frameRate;
  const shown = off ? undefined : view.entries.find((e) => e.key === activeKey) ?? view.entries[0];
  const shownSig = shown?.target ? sigOf(shown.target) : null;
  useEffect(() => { session.markRendered(shown?.target ?? null); }, [session, shownSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = <div role="status" aria-live="polite" className="pf-bar-sr" data-testid={TID.live}>{session.live.text}</div>;
  const r = view.result;
  if (off || !r || view.entries.length === 0) return <div className="pf-bar-panel">{live}</div>;
  return (
    <div className="pf-bar-panel" data-testid="bar-panel">
      {live}
      <PreviewPanel entry={shown} result={r} lang={lang} query={query} rate={rate} busy={slot.pending || session.busy} />
      {session.busy && <p className="pf-bar-hint">{barText(lang, 'busy.line')}</p>}
      {session.stale && <p className="pf-bar-stale" data-testid={TID.stale}>{barText(lang, 'stale.line')}</p>}
      {session.failure && <p className="pf-bar-stale" data-testid={TID.refused} data-code={session.failure.code}><RefusalText words={session.failure} lang={lang} /></p>}
    </div>
  );
}
