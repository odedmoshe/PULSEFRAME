/**
 * The bar's preview (ADR-0027; plan §4.5, §6): «הבנתי:» with the understood words marked in the typed text, one step per op
 * (op words plus the detail sentence; data-op and data-detail), the notes decided by rule, and the footer. Times, frame
 * numbers and dB values are in <bdi dir="ltr" class="num">, quoted and typed words in <bdi dir="auto">. For the kinds that run
 * nothing (ambiguous, incomplete, refused, unknown) it says why in words, with the next step beside the reason.
 */
import type { ReactElement, ReactNode } from 'react';
import type { BarReading, OpCall, BarResult } from '@pulseframe/core';
import type * as T from '@pulseframe/time';
import { translateRefusal, type Lang } from '@pulseframe/i18n';
import { BAR_DOM_IDS, COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { FSI, LRI, PDI, barText, dict, type BarTextKey } from './commandBar.strings.ts';
import { describeAction, describeNote, describeStep, intentName } from './describe.ts';
import type { BarEntry, BarTarget } from './useBarResult.ts';
import { COMMANDS } from '../commands.ts';
import { dictionaries } from '@pulseframe/i18n';

/** Turns the isolates of the strings into <bdi> elements: LRI…PDI is a number (ltr), FSI…PDI is the owner's own word (auto). */
export function Rich({ text }: { text: string }): ReactElement {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === LRI || ch === FSI) {
      const end = text.indexOf(PDI, i + 1);
      if (end > i) {
        const inner = text.slice(i + 1, end);
        out.push(ch === LRI ? <bdi key={k++} dir="ltr" className="num">{inner}</bdi> : <bdi key={k++} dir="auto">{inner}</bdi>);
        i = end + 1;
        continue;
      }
    }
    let j = i + 1;
    while (j < text.length && text[j] !== LRI && text[j] !== FSI) j++;
    out.push(text.slice(i, j));
    i = j;
  }
  return <>{out}</>;
}

/** The typed text cut into stretches, marking those the grammar read (merged, in order). */
export function highlightSegments(query: string, readings: readonly BarReading[]): { text: string; hit: boolean }[] {
  const spans = readings.map((r) => r.span).filter(([a, b]) => b > a && a >= 0 && a < query.length).map(([a, b]) => [a, Math.min(b, query.length)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]); }
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of merged) { if (a > at) out.push({ text: query.slice(at, a), hit: false }); out.push({ text: query.slice(a, b), hit: true }); at = b; }
  if (at < query.length) out.push({ text: query.slice(at), hit: false });
  return out;
}
/** The words the grammar read, from their spans (for «הבנתי "…"»). */
export const readWords = (query: string, readings: readonly BarReading[]): string =>
  highlightSegments(query, readings).filter((s) => s.hit).map((s) => s.text.trim()).filter(Boolean).join(' ');

export function Typed({ query, readings }: { query: string; readings: readonly BarReading[] }): ReactElement {
  return <bdi dir="auto" className="pf-bar-typed">{highlightSegments(query, readings).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}</bdi>;
}

/** The quoted words an op carries (a title's text, a marker's label): shown in the owner's own browser only. */
export function stepQuote(call: OpCall | undefined): string | null {
  const a = (call?.args ?? {}) as Record<string, unknown>;
  const v = call?.op === 'add_text' ? a.text : call?.op === 'add_marker' ? a.label : null;
  return typeof v === 'string' && v ? v : null;
}

const commandLabel = (id: string, lang: Lang): string => { const c = COMMANDS.find((x) => x.id === id); return c ? (c.text?.[lang] ?? (dictionaries[lang] as Record<string, string>)[c.label] ?? id) : id; };
export const refusalReason = (r: Extract<BarResult, { kind: 'refused' }>, lang: Lang): string => {
  const base = dict(lang, `bar.refusal.${r.code}`);
  return (r.opError ? translateRefusal(lang, r.opError.message) ?? (lang === 'he' ? base : r.opError.message) : base);
};

function PlanBody({ plan, lang, query }: { plan: Extract<BarTarget, { kind: 'plan' }>; lang: Lang; query: string }): ReactElement {
  const t = (k: BarTextKey, v?: Record<string, string | number>) => barText(lang, k, v);
  return (
    <>
      <p className="pf-bar-understood" data-testid={TID.understood}>{t('understood')} <Typed query={query} readings={plan.readings} /></p>
      <ol className="pf-bar-steps" aria-label={t('steps.label')}>
        {plan.steps.map((s, i) => {
          const w = describeStep(s, lang);
          const q = stepQuote(plan.ops[i]);
          return (
            <li key={i} data-testid={TID.step} data-op={s.op} data-detail={s.detail.kind}>
              <span className="pf-bar-op">{w.op}</span>: <Rich text={w.detail} />{q && <> <bdi dir="auto" className="pf-bar-quote">«{q}»</bdi></>}
            </li>
          );
        })}
      </ol>
      {plan.notes.length > 0 && (
        <ul className="pf-bar-notes" aria-label={t('notes.label')}>
          {plan.notes.map((n, i) => <li key={i} data-testid={TID.note} data-code={n.code}><Rich text={describeNote(n, lang)} /></li>)}
        </ul>
      )}
      <p className="pf-bar-footer" data-testid={TID.footer}>{t('footer.plan')}</p>
    </>
  );
}

/** The preview of one row's target (a plan, an action or a nearest command). */
export function TargetPreview({ target, lang, query, rate }: { target: BarTarget; lang: Lang; query: string; rate?: T.Rate }): ReactElement {
  const t = (k: BarTextKey) => barText(lang, k);
  if (target.kind === 'plan') return <PlanBody plan={target} lang={lang} query={query} />;
  if (target.kind === 'action') {
    return (
      <>
        <p className="pf-bar-understood" data-testid={TID.understood}>{t('understood')} <Typed query={query} readings={target.readings} /></p>
        <p className="pf-bar-action"><span className="pf-bar-lead">{t('action.lead')}</span> <Rich text={describeAction(target.action, lang, rate)} /></p>
        {target.notes.length > 0 && <ul className="pf-bar-notes">{target.notes.map((n, i) => <li key={i} data-testid={TID.note} data-code={n.code}><Rich text={describeNote(n, lang)} /></li>)}</ul>}
        <p className="pf-bar-footer" data-testid={TID.footer}>{t('footer.action')}</p>
      </>
    );
  }
  return <p className="pf-bar-action"><span className="pf-bar-lead">{t('action.lead')}</span> <Rich text={describeAction({ kind: 'command', commandId: target.commandId }, lang)} /></p>;
}

/** What a row with no target says: the question of an ambiguous request, what is missing, why not, what was not understood. */
export function ResultMessage({ result, lang, query }: { result: BarResult; lang: Lang; query: string }): ReactElement | null {
  const t = (k: BarTextKey, v?: Record<string, string | number>) => barText(lang, k, v);
  switch (result.kind) {
    case 'ambiguous': return (<><p className="pf-bar-understood">{result.question[lang]}</p><p className="pf-bar-footer" data-testid={TID.footer}>{t('footer.choose')}</p></>);
    case 'incomplete': {
      const words = readWords(query, result.readings);
      const missing = result.missing.map((m) => t(`missing.${m}` as BarTextKey)).join(', ');
      return (
        <div data-testid={TID.incomplete} data-missing={result.missing.join(',')}>
          <p className="pf-bar-understood">{words && <><bdi dir="auto">{t('incomplete.heard', { words })}</bdi> </>}{t('incomplete.missing', { missing })}</p>
          <p className="pf-bar-example"><bdi dir="auto">{t('incomplete.example', { example: result.example[lang] })}</bdi></p>
          <p className="pf-bar-footer">{t('footer.nothing')}</p>
        </div>
      );
    }
    case 'refused': return (
      <div data-testid={TID.refused} data-code={result.code} data-op-code={result.opError?.code}>
        <p className="pf-bar-understood"><span className="pf-bar-lead">{t('refused.heading')}</span> <bdi dir="auto">{refusalReason(result, lang)}</bdi></p>
        <p className="pf-bar-hint">{t(`hint.${result.code}` as BarTextKey)}</p>
        {result.choices && result.choices.length > 0 && <p className="pf-bar-hint">{t('refused.choices')}</p>}
        <p className="pf-bar-footer">{result.choices?.length ? t('footer.choose') : t('footer.nothing')}</p>
      </div>
    );
    case 'unknown': {
      const unread = result.unread.map(([a, b]) => query.slice(a, b).trim()).filter(Boolean).join(' · ');
      const read = readWords(query, result.readings);
      return (
        <div data-testid={TID.unknown}>
          <p className="pf-bar-understood">{t('unknown.heading')}</p>
          {read && <p className="pf-bar-hint" data-testid={TID.understood}><bdi dir="auto">{t('unknown.read', { words: read })}</bdi></p>}
          {unread && <p className="pf-bar-hint" data-testid={TID.unread}><bdi dir="auto">{t('unknown.unread', { words: unread })}</bdi></p>}
          <p className="pf-bar-hint">{t('unknown.hint')}</p>
        </div>
      );
    }
    default: return null;
  }
}

/** The one preview panel (the input's aria-describedby): the active row's preview, or the result's own words. */
export function PreviewPanel({ entry, result, lang, query, rate, busy }: { entry: BarEntry | undefined; result: BarResult; lang: Lang; query: string; rate?: T.Rate; busy: boolean }): ReactElement {
  return (
    <div id={BAR_DOM_IDS.preview} className="pf-bar-preview" data-testid={TID.preview} aria-busy={busy || undefined} aria-label={barText(lang, 'preview.label')} role="group">
      {entry?.target ? <TargetPreview target={entry.target} lang={lang} query={query} rate={rate} /> : <ResultMessage result={result} lang={lang} query={query} />}
    </div>
  );
}
export { commandLabel, intentName };
