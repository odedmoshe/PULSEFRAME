/**
 * The template dialog (ADR-0016): four steps (pictures and videos, music, texts, plan and apply), Hebrew first and right to
 * left. A modal dialog like ProjectsDialog: focus is kept inside, Escape closes it from anywhere, and the drawer returns the
 * focus to the card that opened it. Planning is read-only; "Use" applies the plan as ONE transaction on the server
 * (POST …/apply with the plan's revision as expectedRevision), so the editor sees one new revision and one undo step.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import type { TemplateApplyResult, TemplateInput, TemplatePlanView, TemplateSummary } from '@pulseframe/core';
import { api, ApiFailure } from '../api.ts';
import { ToastSlot } from '../ds/index.ts';
import { useEditorState } from './store.ts';
import { TEMPLATE_STRINGS } from './templates.strings.ts';
import { TEMPLATE_TESTIDS as TID } from './templates.testids.ts';
import { beatState, buildParams, counter, defaultMusic, initialMedia, moveItem, musicAssets, pictureAssets, planChoices, planRows, syncMedia, takeAlternative, templateApi, toggleItem, type AlternativeState, type MediaItem } from './templateDialog.logic.ts';
import { templateRefusal, type Failure } from './templateRefusals.ts';

const STEPS = ['media', 'music', 'texts', 'plan'] as const;
type Step = (typeof STEPS)[number];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface AppliedTemplate { result: TemplateApplyResult; params: Partial<TemplateInput>; alternatives: TemplatePlanView['alternatives'] }

export function TemplateDialog({ summary, onClose, onApplied }: { summary: TemplateSummary; onClose: () => void; onApplied: (a: AppliedTemplate) => void }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const S = TEMPLATE_STRINGS[lang];
  const doc = state.doc;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<Step>('media');
  const [media, setMedia] = useState<MediaItem[]>(() => (doc ? initialMedia(doc) : []));
  const [music, setMusic] = useState<string>(() => (doc ? defaultMusic(doc, summary.needs.music) : ''));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [motionNone, setMotionNone] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /** The parameters of the alternatives taken (tempo, order, seed …); kept by value, since a new plan lists other alternatives. */
  const [overrides, setOverrides] = useState<Partial<TemplateInput>>({});
  const [plan, setPlan] = useState<TemplatePlanView | null>(null);
  /** The last plan that succeeded: its choices stay on screen when a re-plan is refused, so another value can be chosen. */
  const [lastPlan, setLastPlan] = useState<TemplatePlanView | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const planSeq = useRef(0);

  // files imported while the dialog is open join the list (included); files removed elsewhere leave it
  useEffect(() => { if (doc) setMedia((m) => syncMedia(m, doc)); }, [doc]);
  const params = useMemo(() => buildParams({ media, music, texts, motionNone, lang, extra: overrides }), [media, music, texts, motionNone, lang, overrides]);
  /** Take an alternative (or a radio's value): its motion ticks or unticks the checkbox; the rest joins the overrides; plan again. */
  const take = (alt: Partial<TemplateInput>) => {
    const next: AlternativeState = takeAlternative({ overrides, motionNone }, alt);
    setOverrides(next.overrides);
    setMotionNone(next.motionNone);
    void runPlan(buildParams({ media, music, texts, motionNone: next.motionNone, lang, extra: next.overrides }));
  };

  /** A refusal worded in the interface language where it is known (templateRefusals.ts), else as the server wrote it. */
  const failure = (e: unknown): Failure => templateRefusal(lang, e);
  const runPlan = async (p = params) => {
    if (!doc) return;
    const seq = ++planSeq.current;
    setPlanning(true);
    setError(null);
    try {
      const v = await templateApi.plan(doc.id, summary.id, p);
      if (seq === planSeq.current) { setPlan(v); setLastPlan(v); }
    } catch (e) {
      if (seq === planSeq.current) { setPlan(null); setError(failure(e)); }
    } finally { if (seq === planSeq.current) setPlanning(false); }
  };
  // the plan step always plans what is chosen now (choices made in the other steps since the last plan count)
  useEffect(() => { if (step === 'plan') void runPlan(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async () => {
    if (!doc || !plan || planning || applying || plan.blocking.length) return;
    setApplying(true);
    setError(null);
    try {
      const result = await templateApi.apply(doc.id, summary.id, params, plan.revision);
      onApplied({ result, params, alternatives: plan.alternatives });
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'stale_revision') { setNote(S.stale); await runPlan(); }
      else setError(failure(e));
    } finally { setApplying(false); }
  };
  const measure = async (assetId: string) => {
    if (!doc) return;
    setMeasuring(assetId);
    setError(null);
    try { await api.analyzeAsset(doc.id, assetId, { kind: 'beats' }); await editor.load(doc.id); } catch (e) { setError(failure(e)); } finally { setMeasuring(null); }
  };

  // focus: the close button first (as the projects dialog); Escape closes from anywhere; focus is pulled back inside
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const onFocusLost = () => { if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) closeRef.current?.focus(); };
    document.addEventListener('keydown', onDocKey, true);
    const timer = setInterval(onFocusLost, 200);
    return () => { document.removeEventListener('keydown', onDocKey, true); clearInterval(timer); };
  }, [onClose]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // keys typed here are not editor shortcuts
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0]!, last = nodes[nodes.length - 1]!, at = document.activeElement;
    if (e.shiftKey && (at === first || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !dialogRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
  };
  /**
   * A step change moves the focus to the new step's heading in the same commit that draws the step (a layout effect), never in a later
   * task: a deferred focus() fired after the person (or a script) had already put the focus in the new step's first field and taken
   * the typing with it (editor-interactions: one Hebrew letter of «יום הולדת שמח» landed on the heading).
   */
  const focusStep = useRef<Step | null>(null);
  useLayoutEffect(() => {
    if (focusStep.current !== step) return;
    focusStep.current = null;
    document.getElementById(`${titleId}-${step}`)?.focus();
  }, [step, titleId]);
  const go = (s: Step) => {
    setNote(null);
    if (s === step) { document.getElementById(`${titleId}-${s}`)?.focus(); return; }
    focusStep.current = s;
    setStep(s);
  };
  const at = STEPS.indexOf(step);
  if (!doc) return null;

  const name = summary.name[lang];
  const assets = doc.assets;
  /** After a move, the focus stays on the same button of the moved file. */
  const move = (index: number, by: -1 | 1, which: 'earlier' | 'later') => {
    const id = media[index]?.assetId;
    setMedia((m) => moveItem(m, index, by));
    if (id) setTimeout(() => dialogRef.current?.querySelector<HTMLElement>(`li[data-asset-id="${CSS.escape(id)}"] [data-testid="${which === 'earlier' ? TID.mediaEarlier : TID.mediaLater}"]`)?.focus(), 0);
  };
  const rows = plan ? planRows(plan, doc.settings.frameRate) : null;
  const shownPlan = plan ?? lastPlan;
  const choices = shownPlan ? planChoices(shownPlan, params) : null;
  const sound = musicAssets(doc);
  const pictures = pictureAssets(doc);

  return (
    <div className="pf-dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pf-dlg pf-tpl-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-testid={TID.dialog} data-template-id={summary.id} onKeyDown={onKey}>
        <div className="pf-dlg-head">
          <h2 id={titleId}>{S.dialog(name)}</h2>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose} aria-label={S.close} data-testid={TID.close}>×</button>
        </div>
        <ol className="pf-tpl-steps" aria-label={S.stepsLabel}>
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" className={`ghost${s === step ? ' current' : ''}`} data-testid={TID.step} data-step={s} aria-current={s === step ? 'step' : undefined} onClick={() => go(s)}>
                <span className="n" aria-hidden="true">{i + 1}</span> {S.steps[s]}
              </button>
            </li>
          ))}
        </ol>

        {step === 'media' && (
          <section aria-labelledby={`${titleId}-media`}>
            <h3 id={`${titleId}-media`} tabIndex={-1}>{S.steps.media}</h3>
            <p className="muted">{S.mediaIntro(summary.slots.length)}</p>
            {pictures.length === 0 && <p className="muted" role="note">{S.mediaEmpty}</p>}
            <ol className="pf-tpl-media">
              {media.map((m, i) => {
                const a = assets[m.assetId];
                if (!a) return null;
                const label = a.name;
                return (
                  <li key={m.assetId} data-testid={TID.media} data-asset-id={m.assetId} data-included={m.included ? 'true' : 'false'}>
                    <label className="check"><input type="checkbox" checked={m.included} onChange={() => setMedia((x) => toggleItem(x, m.assetId))} aria-label={`${S.include}: ${label}`} /> <span className="n" aria-hidden="true">{i + 1}</span> <bdi>{label}</bdi> <span className="muted">({a.video ? S.kind.video : S.kind.image}{a.video ? <> · <bdi dir="ltr">{T.toSeconds(a.duration).toFixed(1)}s</bdi></> : null})</span></label>
                    <span className="row">
                      <button type="button" className="ghost" data-testid={TID.mediaEarlier} aria-disabled={i === 0 || undefined} aria-label={`${S.earlier}: ${label}`} onClick={() => { if (i > 0) move(i, -1, 'earlier'); }}>↑</button>
                      <button type="button" className="ghost" data-testid={TID.mediaLater} aria-disabled={i === media.length - 1 || undefined} aria-label={`${S.later}: ${label}`} onClick={() => { if (i < media.length - 1) move(i, 1, 'later'); }}>↓</button>
                    </span>
                  </li>
                );
              })}
            </ol>
            <label className="ghost file">
              {state.uploading ? S.importing : S.importMedia}
              <input type="file" multiple accept="video/*,image/png,image/jpeg,image/webp" data-testid="template-media-import" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
            </label>
          </section>
        )}

        {step === 'music' && (
          <section aria-labelledby={`${titleId}-music`}>
            <h3 id={`${titleId}-music`} tabIndex={-1}>{S.steps.music}</h3>
            <p className="muted">{S.musicIntro[summary.needs.music]}</p>
            {summary.needs.music !== 'none' && (
              <fieldset className="pf-tpl-music">
                <legend className="sr-only">{S.steps.music}</legend>
                <label className="check">
                  <input type="radio" name={`${titleId}-music-choice`} checked={music === ''} disabled={summary.needs.music === 'beats'} data-testid={TID.music} data-asset-id="" onChange={() => setMusic('')} /> {S.noMusic}
                </label>
                {sound.length === 0 && <p className="muted" role="note">{S.musicEmpty}</p>}
                {sound.map((a) => {
                  const b = beatState(doc, a.id);
                  return (
                    <div key={a.id} className="row pf-tpl-music-row">
                      <label className="check">
                        <input type="radio" name={`${titleId}-music-choice`} checked={music === a.id} data-testid={TID.music} data-asset-id={a.id} data-beats={b.count} onChange={() => setMusic(a.id)} /> <bdi>{a.name}</bdi>
                      </label>
                      <span className="muted" data-testid="template-beat-state" data-asset-id={a.id}>{b.measured ? S.beatsMeasured(b.count, b.bpm) : S.beatsNot}</span>
                      {!b.measured && <button type="button" className="ghost" disabled={measuring !== null} aria-busy={measuring === a.id || undefined} data-testid={TID.measureBeats} data-asset-id={a.id} onClick={() => void measure(a.id)}>{measuring === a.id ? S.measuring : S.measure}</button>}
                    </div>
                  );
                })}
              </fieldset>
            )}
            {summary.needs.music !== 'none' && (
              <label className="ghost file">
                {state.uploading ? S.importing : S.importMusic}
                <input type="file" accept="audio/*" data-testid="template-music-import" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
              </label>
            )}
          </section>
        )}

        {step === 'texts' && (
          <section aria-labelledby={`${titleId}-texts`}>
            <h3 id={`${titleId}-texts`} tabIndex={-1}>{S.steps.texts}</h3>
            <p className="muted">{summary.texts.length ? S.textsIntro : S.textsNone}</p>
            {summary.texts.map((x) => {
              const value = texts[x.key] ?? '';
              const c = counter(value, x.maxChars);
              const countId = `${titleId}-count-${x.key}`;
              return (
                <div key={x.key} className="pf-tpl-text">
                  <label>{x.role[lang]}
                    <input type="text" dir="auto" value={value} placeholder={x.default[lang]} data-testid={TID.text} data-key={x.key} aria-describedby={countId} aria-invalid={c.over || undefined}
                      onChange={(e) => { const v = e.target.value; setTexts((m) => ({ ...m, [x.key]: v })); }} />
                  </label>
                  <span id={countId} className={`muted${c.over ? ' danger' : ''}`} data-testid={TID.textCount} data-key={x.key} data-used={c.used} data-over={c.over ? 'true' : undefined}>
                    <bdi>{S.count(c.used, c.max)}</bdi>{c.over ? ` · ${S.tooLong}` : ''}
                  </span>
                </div>
              );
            })}
          </section>
        )}

        {step === 'plan' && (
          <section aria-labelledby={`${titleId}-plan`}>
            <h3 id={`${titleId}-plan`} tabIndex={-1}>{S.steps.plan}</h3>
            <div className="pf-tpl-plan" data-testid={TID.plan} aria-live="polite" aria-busy={planning || undefined}>
              {planning && <p className="muted">{S.planning}</p>}
              {note && <p className="muted" role="note">{note}</p>}
              {rows && !planning && (
                <>
                  <p data-testid="template-plan-summary" data-operations={rows.summary.operations}><bdi>{S.planSummary(rows.summary.operations, rows.summary.clock, rows.summary.slots)}</bdi></p>
                  <h4>{S.planSteps}</h4>
                  <ol>{rows.steps.map((x, i) => <li key={i}><bdi dir="auto">{x}</bdi></li>)}</ol>
                  {rows.basis.length > 0 && <><h4>{S.planBasis}</h4><ul>{rows.basis.map((x, i) => <li key={i}><bdi dir="auto">{x}</bdi></li>)}</ul></>}
                  {rows.warnings.length > 0 && <><h4>{S.planWarnings}</h4><ul data-testid="template-warnings">{rows.warnings.map((w, i) => <li key={i} data-code={w.code}>{S.warning[w.code]}: <bdi dir="auto">{w.message}</bdi></li>)}</ul></>}
                  {rows.blocking.length > 0 && <><h4>{S.planBlocking}</h4><ul data-testid={TID.blocking}>{rows.blocking.map((w, i) => <li key={i} data-code={w.code}>{S.warning[w.code]}: <bdi dir="auto">{w.message}</bdi></li>)}</ul></>}
                  <p className="muted">{S.method}</p>
                </>
              )}
            </div>
            {error && (
              <div role="alert" className="danger" data-testid="template-error" data-code={error.code ?? undefined}>
                <bdi dir="auto">{error.message}</bdi>{error.hint && <> — <bdi dir="auto">{error.hint}</bdi></>}
                {error.code === 'needs_analysis' && <> <button type="button" className="ghost" onClick={() => go('music')}>{S.goMusic}</button></>}
              </div>
            )}
            {choices && (
              <div className="pf-tpl-alts">
                <fieldset>
                  <legend>{S.tempo}</legend>
                  {choices.tempo.map((o) => (
                    <label key={o.value} className="check"><input type="radio" name={`${titleId}-tempo`} checked={o.checked} data-testid={TID.alternative} data-index={o.index} data-param="tempo" data-value={o.value}
                      onChange={() => { if (!o.checked) take(o.params); }} /> {S.tempoChoice[o.value]}</label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>{S.order}</legend>
                  {choices.order.map((o) => (
                    <label key={o.value} className="check"><input type="radio" name={`${titleId}-order`} checked={o.checked} data-testid={TID.alternative} data-index={o.index} data-param="order" data-value={o.value}
                      onChange={() => { if (!o.checked) take(o.params); }} /> {S.orderNames[o.value]}</label>
                  ))}
                </fieldset>
                {choices.others.length > 0 && (
                  <fieldset>
                    <legend>{S.alternatives}</legend>
                    {choices.others.map((a) => <button key={a.index} type="button" className="ghost" data-testid={TID.alternative} data-index={a.index} onClick={() => take(a.params)}><bdi dir="auto">{a.label}</bdi></button>)}
                  </fieldset>
                )}
              </div>
            )}
            <label className="check"><input type="checkbox" checked={motionNone} data-testid={TID.motionNone} onChange={(e) => { const v = e.target.checked; setMotionNone(v); void runPlan(buildParams({ media, music, texts, motionNone: v, lang, extra: overrides })); }} /> {S.motionNone}</label>
          </section>
        )}
        {step !== 'plan' && error && <p role="alert" className="danger" data-testid="template-error" data-code={error.code ?? undefined}><bdi dir="auto">{error.message}</bdi>{error.hint && <> — <bdi dir="auto">{error.hint}</bdi></>}</p>}

        <div className="row pf-tpl-nav">
          <button type="button" className="ghost" disabled={at === 0} onClick={() => go(STEPS[at - 1]!)} data-testid="template-back">{S.back}</button>
          <span className="spacer" />
          {step !== 'plan'
            ? <button type="button" className="primary" onClick={() => go(STEPS[at + 1]!)} data-testid="template-next">{S.next}</button>
            : <button type="button" className="primary" disabled={!rows || !rows.canApply || planning || applying} aria-busy={applying || undefined} onClick={() => void use()} data-testid={TID.use}>{applying ? S.using : S.use}</button>}
        </div>
        {/* the toast region while this modal is open: a toast under the page behind could be neither reached nor heard (ds/toastHost.ts) */}
        <ToastSlot />
      </div>
    </div>
  );
}
