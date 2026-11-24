import { useState } from 'react';
import * as T from '@pulseframe/time';
import { describeRecipes, FORMAT_PROFILES, PERFORM_RECIPE_ID } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { api, ApiFailure, type RecipeAlternative, type RecipeParams, type RecipePlanResult } from '../api.ts';
import { useEditorState } from './store.ts';
import { RECIPE_FORM_IDS, recipeParams, recipeSources } from './recipeParams.ts';
import { skippedNotes } from './transcriptLineage.logic.ts';

/** Only the recipes this panel has a form for (recipeParams.test.ts checks that every recipe has one). */
const RECIPES = describeRecipes().filter((r) => RECIPE_FORM_IDS.includes(r.id));
const LOUDNESS = ['off', '-14', '-16', '-23'] as const;
type Form = Record<string, unknown>;
interface Failure { message: string; hint?: string; code?: string }
interface Outcome { kind: 'applied'; created: number; at: number }

const toFailure = (e: unknown): Failure => e instanceof ApiFailure ? { message: e.message, hint: e.hint, code: e.code } : { message: e instanceof Error ? e.message : String(e) };
const loudnessValue = (v: unknown): string => (v === null ? 'off' : typeof v === 'number' ? String(v) : 'off');
const loudnessParam = (v: string): number | null => (v === 'off' ? null : Number(v));

/** Rule-based recipes: plan, preview and apply multi-step edits; re-run them while keeping hand edits (SPEC §23, §24). */
export function RecipesPanel() {
  const { editor, state, t } = useEditorState();
  const { doc, lang, revision } = state;
  // Per-recipe edits to the form; anything not edited falls back to a default derived from the project.
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [plans, setPlans] = useState<Record<string, { plan: RecipePlanResult; params: RecipeParams }>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [errors, setErrors] = useState<Record<string, Failure | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [regen, setRegen] = useState<Record<string, { replaced: number; protectedCount: number; removedCount: number }>>({});

  const rate = doc?.settings.frameRate;
  const sources = recipeSources(doc ?? null, editor.selected?.clip.id);
  const { pictureAssets, audioAssets, audioClips, pictureClips } = sources;

  const patch = (recipeId: string, p: Form) => setForms((f) => ({ ...f, [recipeId]: { ...f[recipeId], ...p } }));

  /** Effective parameters sent to the server, built from the form plus defaults. */
  const paramsFor = (recipeId: string): RecipeParams => recipeParams(recipeId, forms[recipeId], sources);

  /** Load server-provided params (an alternative) into the form. */
  const loadParams = (recipeId: string, p: RecipeParams) => {
    if (recipeId === 'beat-montage') {
      const ids = Array.isArray(p.assetIds) ? (p.assetIds as string[]) : pictureAssets.map((a) => a.id);
      setForms((f) => ({ ...f, [recipeId]: { musicClipId: p.musicClipId, unchecked: pictureAssets.map((a) => a.id).filter((id) => !ids.includes(id)), everyBeats: p.everyBeats, cutOn: p.cutOn, order: p.order, seed: p.seed } }));
    } else setForms((f) => ({ ...f, [recipeId]: { ...f[recipeId], ...p } }));
  };

  const guard = async (key: string, recipeId: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErrors((e) => ({ ...e, [recipeId]: null }));
    try { await fn(); } catch (e) { setErrors((er) => ({ ...er, [recipeId]: toFailure(e) })); } finally { setBusy(null); }
  };
  const plan = (recipeId: string, params = paramsFor(recipeId)) => {
    if (!doc) return Promise.resolve();
    return guard(`plan:${recipeId}`, recipeId, async () => {
      const r = await api.planRecipe(doc.id, recipeId, params);
      setPlans((p) => ({ ...p, [recipeId]: { plan: r, params } }));
    });
  };
  const apply = (recipeId: string) => {
    if (!doc) return Promise.resolve();
    return guard(`apply:${recipeId}`, recipeId, async () => {
      const r = await api.applyRecipe(doc.id, recipeId, paramsFor(recipeId));
      setOutcomes((o) => ({ ...o, [recipeId]: { kind: 'applied', created: r.createdIds.length, at: r.revision } }));
      setPlans((p) => { const { [recipeId]: _drop, ...rest } = p; return rest; });
      // The new revision reaches the editor through the event stream; no manual reload.
    });
  };
  const regenerate = (runId: string, recipeId: string, restoreRemoved = false) => {
    if (!doc) return Promise.resolve();
    return guard(`regen:${runId}`, recipeId, async () => {
      const r = await api.regenerateRecipeRun(doc.id, runId, paramsFor(recipeId), restoreRemoved);
      setRegen((g) => ({ ...g, [runId]: { replaced: r.replaced, protectedCount: r.protected.length, removedCount: r.removed?.length ?? 0 } }));
    });
  };
  const useAlternative = (recipeId: string, alt: RecipeAlternative) => { loadParams(recipeId, alt.params); void plan(recipeId, alt.params); };

  // a perform take (ADR-0025) is recorded as a run too; it has no form here, only its name
  const recipeName = (id: string) => (id === PERFORM_RECIPE_ID ? t('perform.recipe') : RECIPES.find((r) => r.id === id)?.name[lang] ?? id);
  const runs = doc ? Object.values(doc.recipeRuns ?? {}) : [];
  const assetName = (id: string) => doc?.assets[id]?.name ?? id;
  const clipLabel = (c: (typeof audioClips)[number]) => `${c.type === 'media' ? assetName(c.assetId) : c.id} · ${rate ? T.toTimecode(c.start, rate) : ''}`;

  const renderForm = (recipeId: string) => {
    const f = forms[recipeId] ?? {};
    const p = paramsFor(recipeId);
    const dom = `recipe-${recipeId}`;
    if (recipeId === 'beat-montage') {
      const checked = (p.assetIds as string[]) ?? [];
      return (
        <div className="fields">
          <label>{t('recipes.music')}
            <select data-testid="recipe-music" value={p.musicClipId as string} onChange={(e) => patch(recipeId, { musicClipId: e.target.value })}>
              {audioClips.length === 0 && <option value="">{t('recipes.music.none')}</option>}
              {audioClips.map((c) => <option key={c.id} value={c.id}>{clipLabel(c)}</option>)}
            </select>
          </label>
          <fieldset className="recipe-assets">
            <legend>{t('recipes.pictures')}</legend>
            {pictureAssets.length === 0 && <p className="muted">{t('recipes.pictures.none')}</p>}
            {pictureAssets.map((a) => (
              <label key={a.id} className="check">
                <input type="checkbox" data-testid="recipe-asset" data-asset-id={a.id} checked={checked.includes(a.id)}
                  onChange={(e) => { const un = new Set((f.unchecked as string[] | undefined) ?? []); if (e.target.checked) un.delete(a.id); else un.add(a.id); patch(recipeId, { unchecked: [...un] }); }} />
                <bdi>{a.name}</bdi>
              </label>
            ))}
          </fieldset>
          <label>{t('recipes.cutOn')}
            <select data-testid="recipe-cut-on" value={p.cutOn === 'bars' ? 'bars' : 'beats'} onChange={(e) => patch(recipeId, { cutOn: e.target.value })}>
              <option value="beats">{t('recipes.cutOn.beats')}</option>
              <option value="bars">{t('recipes.cutOn.bars')}</option>
            </select>
          </label>
          <label>{t('recipes.every')}
            <select data-testid="recipe-every" value={String(p.everyBeats)} onChange={(e) => patch(recipeId, { everyBeats: Number(e.target.value) })}>
              {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>{t('recipes.order')}
            <select data-testid="recipe-order" value={p.order as string} onChange={(e) => patch(recipeId, { order: e.target.value })}>
              {(['sequence', 'reverse', 'shuffle'] as const).map((o) => <option key={o} value={o}>{t(`recipes.order.${o}` as Key)}</option>)}
            </select>
          </label>
        </div>
      );
    }
    if (recipeId === 'social-pack') {
      const profiles = p.profiles as string[];
      return (
        <div className="fields">
          <fieldset className="recipe-assets">
            <legend>{t('recipes.profiles')}</legend>
            {FORMAT_PROFILES.map((fp) => (
              <label key={fp.id} className="check">
                <input type="checkbox" data-testid="recipe-profile" data-profile-id={fp.id} checked={profiles.includes(fp.id)}
                  onChange={(e) => patch(recipeId, { profiles: e.target.checked ? [...profiles, fp.id] : profiles.filter((x) => x !== fp.id) })} />
                {fp.name[lang]}
              </label>
            ))}
          </fieldset>
          <label className="check"><input type="checkbox" data-testid="recipe-captions" checked={p.captions as boolean} onChange={(e) => patch(recipeId, { captions: e.target.checked })} /> {t('recipes.captions')}</label>
          <label>{t('recipes.loudness')}
            <select data-testid="recipe-loudness" id={`${dom}-loudness`} value={loudnessValue(p.loudness)} onChange={(e) => patch(recipeId, { loudness: loudnessParam(e.target.value) })}>
              {LOUDNESS.map((l) => <option key={l} value={l}>{l === 'off' ? t('recipes.loudness.off') : `${l} LUFS`}</option>)}
            </select>
          </label>
        </div>
      );
    }
    if (recipeId === 'portrait-blur') {
      const chosen = pictureClips.find((c) => c.clipId === p.clipId);
      const cutouts = chosen?.cutoutIds ?? [];
      const radius = p.radius as number;
      return (
        <div className="fields">
          <label>{t('recipes.pictureClip')}
            <select data-testid="recipe-picture-clip" value={p.clipId as string} onChange={(e) => patch(recipeId, { clipId: e.target.value, cutoutAssetId: undefined })}>
              {pictureClips.length === 0 && <option value="">{t('recipes.pictureClip.none')}</option>}
              {pictureClips.map((c) => <option key={c.clipId} value={c.clipId}>{`${assetName(c.assetId)} · ${rate ? T.toTimecode(c.start, rate) : ''}`}</option>)}
            </select>
          </label>
          {chosen && (cutouts.length === 0
            ? <p className="muted" data-testid="recipe-cutout-none" dir="auto">{t('recipes.cutout.none')}</p>
            : (
              <label>{t('recipes.cutout')}
                <select data-testid="recipe-cutout" value={(p.cutoutAssetId as string | undefined) ?? cutouts[0]} onChange={(e) => patch(recipeId, { cutoutAssetId: e.target.value })}>
                  {cutouts.map((id) => <option key={id} value={id}>{assetName(id)}</option>)}
                </select>
              </label>
            ))}
          <label>{t('recipes.radius')}
            <input type="number" dir="ltr" data-testid="recipe-radius" min={0.2} max={20} step={0.1} value={Number((radius * 100).toFixed(2))}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.2 && v <= 20) patch(recipeId, { radius: Number((v / 100).toFixed(5)) }); }} />
          </label>
        </div>
      );
    }
    return (
      <div className="fields">
        <label>{t('recipes.speechAsset')}
          <select data-testid="recipe-speech-asset" value={p.assetId as string} onChange={(e) => patch(recipeId, { assetId: e.target.value })}>
            {audioAssets.length === 0 && <option value="">{t('recipes.speechAsset.none')}</option>}
            {audioAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>{t('recipes.keepSeconds')}
          <input type="number" dir="ltr" data-testid="recipe-keep-seconds" min={0} max={2} step={0.01} value={p.keepSeconds as number}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) patch(recipeId, { keepSeconds: v }); }} />
        </label>
      </div>
    );
  };

  return (
    <div className="recipes" data-testid="recipes-panel">
      <p className="muted" data-testid="recipes-intro">{t('recipes.intro')}</p>
      {RECIPES.map((r) => {
        const err = errors[r.id];
        const entry = plans[r.id];
        const stale = !!entry && entry.plan.revision !== revision;
        const done = outcomes[r.id];
        const heading = `recipe-h-${r.id}`;
        return (
          <section key={r.id} className="recipe-card" data-testid="recipe-card" data-recipe-id={r.id} aria-labelledby={heading}>
            <h3 id={heading} dir="auto">{r.name[lang]}</h3>
            <p dir="auto">{lang === 'en' ? r.description : t(`recipes.desc.${r.id}` as Key)}</p>
            <p className="muted small-text"><strong>{t('recipes.needs')}:</strong> <span dir="auto">{lang === 'en' ? r.needs : t(`recipes.needs.${r.id}` as Key)}</span></p>
            {renderForm(r.id)}
            <div className="row">
              <button type="button" className="ghost" data-testid="recipe-plan" disabled={!doc || busy !== null} onClick={() => void plan(r.id)}>{busy === `plan:${r.id}` ? t('recipes.planning') : t('recipes.plan')}</button>
              <button type="button" className="primary" data-testid="recipe-apply" disabled={!doc || busy !== null} onClick={() => void apply(r.id)}>{busy === `apply:${r.id}` ? t('recipes.applying') : t('recipes.apply')}</button>
            </div>
            <div aria-live="polite">
              {err && (
                <p className="danger" role="alert" data-testid="recipe-error" data-code={err.code}>
                  <span dir="auto">{err.message}</span>{err.hint && <> <span className="muted" dir="auto" data-testid="recipe-error-hint">{err.hint}</span></>}
                </p>
              )}
              {done && <p data-testid="recipe-applied" data-created={done.created}>{t('recipes.applied')}: {done.created} {t('recipes.created')}</p>}
              {entry && (
                <div data-testid="recipe-plan-result" data-stale={String(stale)}>
                  <h4>{t('recipes.steps')}</h4>
                  <ol className="recipe-steps" data-testid="recipe-steps">
                    {entry.plan.steps.map((s, i) => <li key={i} dir="auto">{s}</li>)}
                  </ol>
                  {entry.plan.basis.length > 0 && (
                    <>
                      <h4>{t('recipes.basis')}</h4>
                      <ul className="recipe-basis" data-testid="recipe-basis">{entry.plan.basis.map((s, i) => <li key={i} dir="auto" className="muted">{s}</li>)}</ul>
                    </>
                  )}
                  {doc && skippedNotes(doc, entry.plan.skippedClips, t('transcript.untimedSkipped')).map((n) => <p key={n} className="muted" role="status" data-testid="recipe-skipped-note">{n}</p>)}
                  {entry.plan.note && <p className="muted" dir="auto">{entry.plan.note}</p>}
                  {stale && <p className="warn" data-testid="recipe-plan-stale">{t('recipes.stale')}</p>}
                  {entry.plan.alternatives.length > 0 && (
                    <>
                      <h4>{t('recipes.alternatives')}</h4>
                      <div className="row" role="group" aria-label={t('recipes.alternatives')}>
                        {entry.plan.alternatives.map((alt, i) => (
                          <button key={`${alt.label}:${i}`} type="button" className="ghost small" data-testid="recipe-alternative" disabled={busy !== null} onClick={() => useAlternative(r.id, alt)}>{alt.label}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })}

      <section aria-labelledby="recipe-runs-h" data-testid="recipe-runs">
        <h3 id="recipe-runs-h">{t('recipes.runs')}</h3>
        {runs.length === 0 ? <p className="muted">{t('recipes.runs.none')}</p> : (
          <ul className="recipe-runs">
            {runs.map((run) => {
              const meta = RECIPES.find((r) => r.id === run.recipeId);
              const g = regen[run.id];
              return (
                <li key={run.id} data-testid="recipe-run" data-run-id={run.id} data-recipe-id={run.recipeId}>
                  <strong dir="auto">{recipeName(run.recipeId)}</strong>
                  <span className="muted"> · {run.createdIds.length} {t('recipes.created')}</span>
                  <ul className="recipe-steps">{run.steps.map((s, i) => <li key={i} dir="auto">{s}</li>)}</ul>
                  {meta?.regenerable && (
                    <button type="button" className="ghost small" data-testid="recipe-regenerate" disabled={!doc || busy !== null} onClick={() => void regenerate(run.id, run.recipeId)}>
                      {busy === `regen:${run.id}` ? t('recipes.regenerating') : t('recipes.regenerate')}
                    </button>
                  )}
                  {g && (
                    <p aria-live="polite" data-testid="recipe-regenerate-result" data-replaced={g.replaced} data-protected={g.protectedCount}>
                      {t('recipes.replaced')}: {g.replaced} · {t('recipes.kept')}: {g.protectedCount}{g.removedCount > 0 && <> · {t('recipes.removed')}: {g.removedCount}</>}
                    </p>
                  )}
                  {g && g.removedCount > 0 && (
                    <button type="button" className="ghost small" data-testid="recipe-restore-removed" disabled={!doc || busy !== null} onClick={() => void regenerate(run.id, run.recipeId, true)}>{t('recipes.restoreRemoved')}</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
