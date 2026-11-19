/**
 * Settings, «עוזר השפה» (ADR-0027; plan §6 "Settings"): the owner's own session only; adapter, host, model, the key as a
 * password field never shown back, prices, the monthly limit and the per-request cap, the two switches (off), «מה נשלח?» with the
 * server's exact summary. Nothing is sent until every setting is filled in (the server's status says so). The key is typed into
 * a password field, sent once to PUT /assistant/key and cleared; the page never holds it again.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ASSISTANT_NEVER_SENT, AssistantConfigBodySchema, type AssistantConfigBody, type AssistantStatus } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button, Switch } from '../../ds/index.ts';
import { api, ApiFailure } from '../../api.ts';
import { useBarEditor } from './useBarResult.ts';
import { COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { barText, dict, ltr } from './commandBar.strings.ts';
import { Rich } from './BarPreview.tsx';
import './commandBar.css';

export const OWNER_ACTOR = 'user:local';
/** The section exists for the owner's own session only; an agent or any other actor sees nothing. */
export const settingsVisible = (actor: string | null): boolean => actor === OWNER_ACTOR;

export interface ConfigForm { adapter: string; host: string; model: string; priceIn: string; priceOut: string; monthly: string; cap: string; titles: boolean; people: boolean }
export const formOf = (s: AssistantStatus | null): ConfigForm => ({
  adapter: s?.adapter ?? '', host: s?.host ?? '', model: s?.model ?? '',
  priceIn: s?.pricesCentsPerMTok ? String(s.pricesCentsPerMTok.input) : '', priceOut: s?.pricesCentsPerMTok ? String(s.pricesCentsPerMTok.output) : '',
  monthly: s && s.monthlyLimitCents > 0 ? String(s.monthlyLimitCents) : '', cap: s && s.perRequestCapCents > 0 ? String(s.perRequestCapCents) : '',
  titles: s?.toggles.titlesAndMarkers ?? false, people: s?.toggles.peopleNames ?? false,
});
const blank = (s: string) => s.trim() === '';
const wholeNumber = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const decimal = (s: string): number | null => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : null);
/** The request body for PUT /assistant/config from the form, or null when a field is not a valid number (prices and limits above zero). */
export function configBodyOf(f: ConfigForm): AssistantConfigBody | null {
  const priceIn = blank(f.priceIn) ? null : decimal(f.priceIn);
  const priceOut = blank(f.priceOut) ? null : decimal(f.priceOut);
  if ((blank(f.priceIn) !== blank(f.priceOut)) || (!blank(f.priceIn) && (priceIn === null || priceOut === null || priceIn <= 0 || priceOut <= 0))) return null;
  const monthly = blank(f.monthly) ? 0 : wholeNumber(f.monthly);
  const cap = blank(f.cap) ? 0 : wholeNumber(f.cap);
  if (monthly === null || cap === null) return null;
  const body = {
    adapter: blank(f.adapter) ? null : f.adapter.trim(), host: blank(f.host) ? null : f.host.trim(), model: blank(f.model) ? null : f.model.trim(),
    pricesCentsPerMTok: priceIn !== null && priceOut !== null ? { input: priceIn, output: priceOut } : null,
    monthlyLimitCents: monthly, perRequestCapCents: cap, toggles: { titlesAndMarkers: f.titles, peopleNames: f.people },
  };
  const parsed = AssistantConfigBodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
const reasonOf = (e: unknown): string => (e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : String(e));

export function AssistantSettings(): ReactElement | null {
  const { editor, state } = useBarEditor();
  const lang: Lang = state.lang;
  const owner = settingsVisible(state.actor);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [loaded, setLoaded] = useState<'loading' | 'ok' | string>('loading');
  const [form, setForm] = useState<ConfigForm>(formOf(null));
  const [key, setKey] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ state: 'idle' | 'loading' | 'ok' | 'failed'; text: string }>({ state: 'idle', text: '' });
  const t = (k: Parameters<typeof barText>[1], v?: Record<string, string | number>) => barText(lang, k, v);

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    api.assistantStatus().then((s) => { if (alive) { setStatus(s); setForm(formOf(s)); setLoaded('ok'); } }, (e) => { if (alive) setLoaded(reasonOf(e)); });
    return () => { alive = false; };
  }, [owner]);
  if (!owner) return null;

  const set = <K extends keyof ConfigForm>(k: K, v: ConfigForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const body = configBodyOf(form);
    if (!body) { setNote(t('set.invalid')); return; }
    try { const s = await api.setAssistantConfig(body); setStatus(s); setForm(formOf(s)); setNote(t('set.saved')); } catch (e) { setNote(t('set.saveFailed', { reason: reasonOf(e) })); }
  };
  const saveKey = async () => {
    const k = key;
    setKey(''); // never kept in the page
    if (!k) return;
    try { const r = await api.setAssistantKey(k); setStatus((s) => (s ? { ...s, keySet: r.keySet, keyAddedAt: r.keyAddedAt } : s)); setNote(t('set.saved')); } catch (e) { setNote(t('set.saveFailed', { reason: reasonOf(e) })); }
  };
  const removeKey = async () => {
    try { const r = await api.deleteAssistantKey(); setStatus((s) => (s ? { ...s, keySet: r.keySet, keyAddedAt: r.keyAddedAt } : s)); } catch (e) { setNote(t('set.saveFailed', { reason: reasonOf(e) })); }
  };
  const showSummary = async () => {
    const doc = state.doc;
    if (!doc) return;
    setSummary({ state: 'loading', text: '' });
    try { const s = await api.assistantSummary(doc.id, { playheadFrame: editor.frame, selection: state.selection, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) }); setSummary({ state: 'ok', text: JSON.stringify(s, null, 2) }); }
    catch (e) { setSummary({ state: 'failed', text: reasonOf(e) }); }
  };
  const date = status?.keyAddedAt ? new Date(status.keyAddedAt).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB') : '';
  const money = (c: number) => ltr(`${c}¢`);
  const field = (id: string, label: string, testId: string, value: string, onChange: (v: string) => void, extra: { inputMode?: 'numeric' | 'decimal'; dir?: 'ltr' } = {}) => (
    <label className="pf-asst-field" htmlFor={id}><span>{label}</span><input id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} {...(extra.inputMode ? { inputMode: extra.inputMode } : {})} {...(extra.dir ? { dir: extra.dir } : {})} /></label>
  );

  return (
    <section className="pf-asst" data-testid={TID.settings} aria-labelledby="pf-asst-h">
      <h3 id="pf-asst-h" className="pf-set-h">{dict(lang, 'assistant.title')}</h3>
      <p className="pf-asst-note">{t('set.intro')}</p>
      {loaded === 'loading' && <p className="pf-asst-note" role="status">{t('set.loading')}</p>}
      {loaded !== 'loading' && loaded !== 'ok' && <p className="pf-asst-bad" role="status" data-testid={TID.settingsSetup}>{dict(lang, 'assistant.notConnected')} · {t('set.unavailable', { reason: loaded })}</p>}
      {loaded === 'ok' && status && (
        <>
          <p className="pf-asst-row" role="status" data-testid={TID.settingsSetup} data-setup={status.setup}><strong>{t('set.status')}:</strong> {dict(lang, `assistant.setup.${status.setup}`)}</p>
          <div className="pf-asst-field">
            <span id="pf-asst-adapter">{t('set.adapter')}</span>
            {status.adapters.length === 0
              ? <span className="pf-asst-note" data-testid={TID.settingsAdapter}>{t('set.adapter.none')}</span>
              : <select aria-labelledby="pf-asst-adapter" data-testid={TID.settingsAdapter} value={form.adapter} onChange={(e) => set('adapter', e.target.value)}><option value="">{t('set.adapter.pick')}</option>{status.adapters.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
          </div>
          {field('pf-asst-host', t('set.host'), TID.settingsHost, form.host, (v) => set('host', v), { dir: 'ltr' })}
          {field('pf-asst-model', t('set.model'), TID.settingsModel, form.model, (v) => set('model', v), { dir: 'ltr' })}
          <div className="pf-asst-field">
            <label htmlFor="pf-asst-key">{t('set.key')}</label>
            <span className="pf-asst-row">
              <span data-testid={TID.settingsKeyState} data-set={status.keySet || undefined}>{status.keySet ? t('set.key.set', { date: ltr(date || '—') }) : t('set.key.unset')}</span>
              {status.keySet && <Button size="sm" variant="danger-quiet" data-testid={TID.settingsKeyRemove} onClick={() => void removeKey()}>{t('set.key.remove')}</Button>}
            </span>
            <span />
            <span className="pf-asst-row">
              <input id="pf-asst-key" type="password" data-testid={TID.settingsKey} value={key} autoComplete="new-password" spellCheck={false} aria-label={t('set.key.field')} placeholder={t('set.key.field')} onChange={(e) => setKey(e.target.value)} dir="ltr" />
              <Button size="sm" variant="secondary" disabled={!key} onClick={() => void saveKey()}>{t('set.key.save')}</Button>
            </span>
          </div>
          <p className="pf-asst-note">{t('set.key.note')}</p>
          {field('pf-asst-pin', t('set.priceIn'), TID.settingsPriceIn, form.priceIn, (v) => set('priceIn', v), { inputMode: 'decimal', dir: 'ltr' })}
          {field('pf-asst-pout', t('set.priceOut'), TID.settingsPriceOut, form.priceOut, (v) => set('priceOut', v), { inputMode: 'decimal', dir: 'ltr' })}
          <p className="pf-asst-note">{t('set.prices.note')}</p>
          {field('pf-asst-monthly', t('set.monthly'), TID.settingsMonthly, form.monthly, (v) => set('monthly', v), { inputMode: 'numeric', dir: 'ltr' })}
          {field('pf-asst-cap', t('set.cap'), TID.settingsCap, form.cap, (v) => set('cap', v), { inputMode: 'numeric', dir: 'ltr' })}
          <p className="pf-asst-note" data-testid={TID.settingsSpent}><Rich text={t('set.spent', { month: ltr(status.month), spent: money(status.spentCents), reserved: money(status.reservedCents) })} /></p>
          <div role="group" aria-label={t('set.toggles')} className="pf-asst">
            <Switch checked={form.titles} onChange={(v) => set('titles', v)} label={dict(lang, 'assistant.toggle.titlesAndMarkers')} testId={TID.settingsToggleTitles} />
            <Switch checked={form.people} onChange={(v) => set('people', v)} label={dict(lang, 'assistant.toggle.peopleNames')} testId={TID.settingsTogglePeople} />
          </div>
          <div className="pf-asst-row">
            <Button size="sm" variant="primary" onClick={() => void save()}>{t('set.save')}</Button>
            {note && <span role="status" className="pf-asst-note">{note}</span>}
          </div>
          <div className="pf-asst" data-testid={TID.settingsWhatIsSent}>
            <h4 className="pf-set-h">{t('set.whatSent')}</h4>
            <p className="pf-asst-note">{t('set.never')} {ASSISTANT_NEVER_SENT.map((n) => dict(lang, `assistant.never.${n}`)).join(', ')}.</p>
            {summary.state === 'idle' || summary.state === 'failed'
              ? <Button size="sm" variant="secondary" disabled={!state.doc} onClick={() => void showSummary()}>{t('set.whatSent.show')}</Button>
              : <Button size="sm" variant="ghost" onClick={() => setSummary({ state: 'idle', text: '' })}>{t('set.whatSent.hide')}</Button>}
            {summary.state === 'loading' && <p className="pf-asst-note" role="status">{t('set.whatSent.loading')}</p>}
            {summary.state === 'failed' && <p className="pf-asst-bad" role="status">{t('set.whatSent.failed', { reason: summary.text })}</p>}
            {summary.state === 'ok' && (<><p className="pf-asst-note">{t('set.whatSent.note')}</p><pre className="pf-asst-json" tabIndex={0} aria-label={t('set.whatSent')}>{summary.text}</pre></>)}
          </div>
        </>
      )}
    </section>
  );
}
