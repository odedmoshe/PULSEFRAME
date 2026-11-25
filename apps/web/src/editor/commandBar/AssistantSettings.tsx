/**
 * Settings, «עוזר השפה» (ADR-0027; plan §6 "Settings"): the owner's own session only; adapter, host, model, the key as a
 * password field never shown back, prices, the monthly limit and the per-request cap, the two switches (off), «מה נשלח?» with the
 * server's exact summary. Nothing is sent until every setting is filled in (the server's status says so). The key is typed into
 * a password field, sent once to PUT /assistant/key and cleared; the page never holds it again.
 * Under the month's amounts: «סכומים שמורים», one row for each amount still counted for a request that was canceled or failed
 * after it had been sent, each with «שחרור הסכום השמור» (ReleaseHeld.tsx: the confirmation says what a release is and is not).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ASSISTANT_LOCAL_ADAPTER_ID, ASSISTANT_NEVER_SENT, AssistantConfigBodySchema, isOwnerStatus, type AssistantConfigBody, type AssistantHeldAmount, type AssistantLocalCheck, type AssistantStatus } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button, Switch } from '../../ds/index.ts';
import { api, ApiFailure } from '../../api.ts';
import { useBarEditor } from './useBarResult.ts';
import { COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { barText, dict, ltr } from './commandBar.strings.ts';
import { Rich, WithReason } from './BarPreview.tsx';
import { refusalLine, refusalWords, type RefusalWords } from './describe.ts';
import { heldLine, money, ReleaseHeld, releasedWords, withoutHeld } from './ReleaseHeld.tsx';
import { isLocalAdapter, LOCAL_ADDRESS, LOCAL_PORT_MAX, LOCAL_PORT_MIN, LOCAL_TIMEOUT_MAX, LOCAL_TIMEOUT_MIN, localFormOf, localText, parseLocalSettings } from './localAssistant.logic.ts';
import './commandBar.css';

export const OWNER_ACTOR = 'user:local';
/** The section exists for the owner's own session only; an agent or any other actor sees nothing. */
export const settingsVisible = (actor: string | null): boolean => actor === OWNER_ACTOR;

export interface ConfigForm { adapter: string; host: string; model: string; priceIn: string; priceOut: string; monthly: string; cap: string; titles: boolean; people: boolean; /** the local assistant's port and time limit, as typed (wave 7) */ port: string; timeout: string }
export const formOf = (s: AssistantStatus | null): ConfigForm => ({
  adapter: s?.adapter ?? '', host: s?.host ?? '', model: s?.model ?? '',
  priceIn: s?.pricesCentsPerMTok ? String(s.pricesCentsPerMTok.input) : '', priceOut: s?.pricesCentsPerMTok ? String(s.pricesCentsPerMTok.output) : '',
  monthly: s && s.monthlyLimitCents > 0 ? String(s.monthlyLimitCents) : '', cap: s && s.perRequestCapCents > 0 ? String(s.perRequestCapCents) : '',
  titles: s?.toggles.titlesAndMarkers ?? false, people: s?.toggles.peopleNames ?? false,
  ...localFormOf(s?.local),
});
const blank = (s: string) => s.trim() === '';
const wholeNumber = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const decimal = (s: string): number | null => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : null);
/** The request body for PUT /assistant/config from the form, or null when a field is not a valid number (prices and limits above zero). */
export function configBodyOf(f: ConfigForm): AssistantConfigBody | null {
  if (isLocalAdapter(f.adapter)) {
    // the local assistant: a port and a time limit and nothing else (no host, model, key, price, limit or data switch); the host is never typed
    const l = parseLocalSettings(f.port, f.timeout);
    if (!l.ok) return null;
    const local = AssistantConfigBodySchema.safeParse({ adapter: ASSISTANT_LOCAL_ADAPTER_ID, host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false }, local: l.local });
    return local.success ? local.data : null;
  }
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
/** A server refusal in words: Hebrew (with its next step) in a Hebrew interface; the English only when unworded, marked (describe.ts). */
export const wordsOf = (lang: Lang, e: unknown): RefusalWords => refusalWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message, hint: e.hint ?? null } : { message: e instanceof Error ? e.message : String(e) });
type Note = { ok: string } | { failed: RefusalWords };

/** The month's held amounts, one row each with its release button; nothing at all when none is held. */
export function HeldAmounts({ lang, held, onDone }: { lang: Lang; held: readonly AssistantHeldAmount[]; onDone: (r: { jobId: string; cents: number; gone: boolean }) => void }): ReactElement | null {
  if (held.length === 0) return null;
  return (
    <div className="pf-asst" role="group" aria-labelledby="pf-asst-held-h" data-testid={TID.settingsHeld}>
      <h4 id="pf-asst-held-h" className="pf-set-h">{barText(lang, 'set.held.heading')}</h4>
      <p className="pf-asst-note">{barText(lang, 'set.held.note')}</p>
      <ul className="pf-asst-held">
        {held.map((h) => (
          <li key={h.jobId} className="pf-asst-row" data-testid={TID.settingsHeldRow} data-job={h.jobId} data-how={h.status ?? 'gone'}>
            <span><Rich text={heldLine(lang, h)} /></span>
            <ReleaseHeld lang={lang} held={h} look="button" onDone={onDone} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LocalCheckState { busy: boolean; result: AssistantLocalCheck | null; failed: RefusalWords | null }
/**
 * The local assistant's Settings fields (wave 7): the port (the ONLY address setting: a whole number, no host field of any kind), the
 * time limit, «בדיקת חיבור» with the honest state in words, and what is sent and where. Pure: rendered to markup in tests.
 */
export function LocalSettingsFields({ lang, form, set, savedPort, check, onCheck }: { lang: Lang; form: ConfigForm; set: <K extends keyof ConfigForm>(k: K, v: ConfigForm[K]) => void; savedPort: number | null; check: LocalCheckState; onCheck: () => void }): ReactElement {
  const t = (k: Parameters<typeof barText>[1], v?: Record<string, string | number>) => barText(lang, k, v);
  const status = { local: savedPort === null ? null : { port: savedPort } };
  const labelled = (id: string, label: string, testId: string, value: string, onChange: (v: string) => void) => (
    <label className="pf-asst-field" htmlFor={id}><span>{label}</span><input id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} inputMode="numeric" dir="ltr" /></label>
  );
  return (
    <div className="pf-asst" role="group" aria-labelledby="pf-asst-local-h" data-testid={TID.assistantLocalSettings}>
      <h4 id="pf-asst-local-h" className="pf-set-h">{dict(lang, 'assistant.local.title')}</h4>
      {labelled('pf-asst-lport', t('set.local.port'), TID.assistantLocalPort, form.port, (v) => set('port', v))}
      <p className="pf-asst-note">{t('set.local.portHelp', { address: ltr(LOCAL_ADDRESS) })} · {localText(lang, 'set.local.noHost')}</p>
      {labelled('pf-asst-ltimeout', t('set.local.timeout'), TID.assistantLocalTimeout, form.timeout, (v) => set('timeout', v))}
      <p className="pf-asst-note">{t('set.local.invalid', { min: LOCAL_PORT_MIN, max: LOCAL_PORT_MAX, tmin: LOCAL_TIMEOUT_MIN, tmax: LOCAL_TIMEOUT_MAX })}</p>
      <div className="pf-asst-row">
        <Button size="sm" variant="secondary" data-testid={TID.assistantLocalCheck} disabled={check.busy || status.local?.port !== Number(form.port.trim())} onClick={onCheck}>{check.busy ? t('set.local.checking') : t('set.local.check')}</Button>
        {status.local?.port !== Number(form.port.trim()) && <span className="pf-asst-note">{localText(lang, 'set.local.saveFirst')}</span>}
      </div>
      <p className="pf-asst-row" role="status" data-testid={TID.assistantLocalState} data-state={check.result?.state ?? 'unchecked'}>
        <strong>{localText(lang, 'set.local.stateLabel')}:</strong> {check.busy ? t('set.local.checking') : check.failed ? <bdi dir="auto">{localText(lang, 'set.local.checkFailed', { reason: refusalLine(lang, check.failed) })}</bdi> : check.result ? dict(lang, `assistant.local.state.${check.result.state}`) : localText(lang, 'set.local.notChecked')}
        {check.result && !check.busy && !check.failed && <span className="pf-asst-note"> · {t('set.local.lastCheck', { time: ltr(new Date(check.result.checkedAt).toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-GB')) })}</span>}
      </p>
      {check.result?.state === 'running' && check.result.model && <p className="pf-asst-note" data-testid={TID.assistantLocalModel}>{t('set.local.model', { model: ltr(check.result.model) })}</p>}
      <h4 className="pf-set-h">{localText(lang, 'set.local.what')}</h4>
      <p className="pf-asst-note">{localText(lang, 'set.local.whatSent')}</p>
      <p className="pf-asst-note">{localText(lang, 'set.local.runsHere', { address: ltr(LOCAL_ADDRESS) })}</p>
      <p className="pf-asst-note">{dict(lang, 'assistant.local.nothingLeaves')}</p>
      <p className="pf-asst-note" data-testid={TID.assistantLocalUnmeasured}>{dict(lang, 'assistant.local.unmeasured')}</p>
      <p className="pf-asst-note" data-testid={TID.assistantLocalGuide}>{localText(lang, 'set.local.guideLine')}</p>
    </div>
  );
}

export function AssistantSettings(): ReactElement | null {
  const { editor, state } = useBarEditor();
  const lang: Lang = state.lang;
  const owner = settingsVisible(state.actor);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [loaded, setLoaded] = useState<'loading' | 'ok' | RefusalWords>('loading');
  const [form, setForm] = useState<ConfigForm>(formOf(null));
  const [key, setKey] = useState('');
  const [note, setNote] = useState<Note | null>(null);
  const [check, setCheck] = useState<{ busy: boolean; result: AssistantLocalCheck | null; failed: RefusalWords | null }>({ busy: false, result: null, failed: null });
  const [released, setReleased] = useState<{ jobId: string; cents: number; gone: boolean } | null>(null);
  const releasedRef = useRef<HTMLParagraphElement>(null);
  const [summary, setSummary] = useState<{ state: 'idle' | 'loading' | 'ok'; text: string } | { state: 'failed'; words: RefusalWords }>({ state: 'idle', text: '' });
  const t = (k: Parameters<typeof barText>[1], v?: Record<string, string | number>) => barText(lang, k, v);

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    // the owner's session reads the whole status; anything else (a session that is not the owner's after all) is shown as unknown
    api.assistantStatus().then((a) => { if (!alive) return; const s = isOwnerStatus(a) ? a : null; setStatus(s); setForm(formOf(s)); setCheck((c) => ({ ...c, result: s?.local?.lastCheck ?? null })); setLoaded(s ? 'ok' : wordsOf(lang, new ApiFailure(403, 'owner_required', 'the language assistant is set up and used from the owner\'s own session only'))); }, (e) => { if (alive) setLoaded(wordsOf(lang, e)); });
    return () => { alive = false; };
  }, [owner]);
  // the pressed button left with its amount: the sentence that says what the release did takes the focus (and is read out)
  useEffect(() => { if (released) releasedRef.current?.focus(); }, [released]);
  if (!owner) return null;

  const set = <K extends keyof ConfigForm>(k: K, v: ConfigForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const body = configBodyOf(form);
    if (!body) { setNote({ ok: isLocalAdapter(form.adapter) ? t('set.local.invalid', { min: LOCAL_PORT_MIN, max: LOCAL_PORT_MAX, tmin: LOCAL_TIMEOUT_MIN, tmax: LOCAL_TIMEOUT_MAX }) : t('set.invalid') }); return; }
    try { const s = await api.setAssistantConfig(body); setStatus(s); setForm(formOf(s)); setCheck((c) => ({ ...c, result: s.local?.lastCheck ?? null, failed: null })); setNote({ ok: t('set.saved') }); } catch (e) { setNote({ failed: wordsOf(lang, e) }); }
  };
  const saveKey = async () => {
    const k = key;
    setKey(''); // never kept in the page
    if (!k) return;
    try { const r = await api.setAssistantKey(k); setStatus((s) => (s ? { ...s, keySet: r.keySet, keyAddedAt: r.keyAddedAt } : s)); setNote({ ok: t('set.saved') }); } catch (e) { setNote({ failed: wordsOf(lang, e) }); }
  };
  const removeKey = async () => {
    try { const r = await api.deleteAssistantKey(); setStatus((s) => (s ? { ...s, keySet: r.keySet, keyAddedAt: r.keyAddedAt } : s)); } catch (e) { setNote({ failed: wordsOf(lang, e) }); }
  };
  const runCheck = async () => {
    setCheck((c) => ({ ...c, busy: true, failed: null }));
    try { const r = await api.assistantLocalCheck(); setCheck({ busy: false, result: r, failed: null }); }
    catch (e) { setCheck((c) => ({ ...c, busy: false, failed: wordsOf(lang, e) })); }
  };
  const showSummary = async () => {
    const doc = state.doc;
    if (!doc) return;
    setSummary({ state: 'loading', text: '' });
    try { const s = await api.assistantSummary(doc.id, { playheadFrame: editor.frame, selection: state.selection, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) }); setSummary({ state: 'ok', text: JSON.stringify(s, null, 2) }); }
    catch (e) { setSummary({ state: 'failed', words: wordsOf(lang, e) }); }
  };
  const date = status?.keyAddedAt ? new Date(status.keyAddedAt).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB') : '';
  const onReleased = (r: { jobId: string; cents: number; gone: boolean }) => { setStatus((s) => (s ? withoutHeld(s, r.jobId) : s)); setReleased(r); };
  const field = (id: string, label: string, testId: string, value: string, onChange: (v: string) => void, extra: { inputMode?: 'numeric' | 'decimal'; dir?: 'ltr' } = {}) => (
    <label className="pf-asst-field" htmlFor={id}><span>{label}</span><input id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} {...(extra.inputMode ? { inputMode: extra.inputMode } : {})} {...(extra.dir ? { dir: extra.dir } : {})} /></label>
  );

  return (
    <section className="pf-asst" data-testid={TID.settings} aria-labelledby="pf-asst-h">
      <h3 id="pf-asst-h" className="pf-set-h">{dict(lang, 'assistant.title')}</h3>
      <p className="pf-asst-note">{t('set.intro')}</p>
      {loaded === 'loading' && <p className="pf-asst-note" role="status">{t('set.loading')}</p>}
      {loaded !== 'loading' && loaded !== 'ok' && <p className="pf-asst-bad" role="status" data-testid={TID.settingsSetup}>{dict(lang, 'assistant.notConnected')} · <WithReason lang={lang} k="set.unavailable" words={loaded} /></p>}
      {loaded === 'ok' && status && (
        <>
          <p className="pf-asst-row" role="status" data-testid={TID.settingsSetup} data-setup={status.setup}><strong>{t('set.status')}:</strong> {dict(lang, `assistant.setup.${status.setup}`)}</p>
          <div className="pf-asst-field">
            <span id="pf-asst-adapter">{t('set.adapter')}</span>
            <select aria-labelledby="pf-asst-adapter" data-testid={TID.settingsAdapter} value={form.adapter} onChange={(e) => set('adapter', e.target.value)}>
              <option value="">{t('set.adapter.pick')}</option>
              <option value={ASSISTANT_LOCAL_ADAPTER_ID}>{dict(lang, 'assistant.local.adapter')}</option>
              {status.adapters.filter((a) => a !== ASSISTANT_LOCAL_ADAPTER_ID).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {form.adapter === '' && <p className="pf-asst-note">{localText(lang, 'set.local.pickHint')}</p>}
          {isLocalAdapter(form.adapter) && <LocalSettingsFields lang={lang} form={form} set={set} savedPort={status.local?.port ?? null} check={check} onCheck={() => void runCheck()} />}
          {!isLocalAdapter(form.adapter) && (
          <>
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
          </>
          )}
          {!isLocalAdapter(form.adapter) && <p className="pf-asst-note" data-testid={TID.settingsSpent}><Rich text={t('set.spent', { month: ltr(status.month), spent: money(status.spentCents), reserved: money(status.reservedCents) })} /></p>}
          <HeldAmounts lang={lang} held={status.held} onDone={onReleased} />
          {released && <p ref={releasedRef} tabIndex={-1} role="status" className="pf-asst-note pf-asst-released" data-testid={TID.released} data-job={released.jobId}><Rich text={released.gone ? t('release.gone') : releasedWords(lang, released.cents)} /></p>}
          {!isLocalAdapter(form.adapter) && <div role="group" aria-label={t('set.toggles')} className="pf-asst">
            <Switch checked={form.titles} onChange={(v) => set('titles', v)} label={dict(lang, 'assistant.toggle.titlesAndMarkers')} testId={TID.settingsToggleTitles} />
            <Switch checked={form.people} onChange={(v) => set('people', v)} label={dict(lang, 'assistant.toggle.peopleNames')} testId={TID.settingsTogglePeople} />
          </div>}
          <div className="pf-asst-row">
            <Button size="sm" variant="primary" onClick={() => void save()}>{t('set.save')}</Button>
            {note && <span role="status" className={'ok' in note ? 'pf-asst-note' : 'pf-asst-bad'} data-testid={'ok' in note ? undefined : TID.settingsRefused}>{'ok' in note ? note.ok : <WithReason lang={lang} k="set.saveFailed" words={note.failed} />}</span>}
          </div>
          {!isLocalAdapter(form.adapter) && <div className="pf-asst" data-testid={TID.settingsWhatIsSent}>
            <h4 className="pf-set-h">{t('set.whatSent')}</h4>
            <p className="pf-asst-note">{t('set.never')} {ASSISTANT_NEVER_SENT.map((n) => dict(lang, `assistant.never.${n}`)).join(', ')}.</p>
            {summary.state === 'idle' || summary.state === 'failed'
              ? <Button size="sm" variant="secondary" disabled={!state.doc} onClick={() => void showSummary()}>{t('set.whatSent.show')}</Button>
              : <Button size="sm" variant="ghost" onClick={() => setSummary({ state: 'idle', text: '' })}>{t('set.whatSent.hide')}</Button>}
            {summary.state === 'loading' && <p className="pf-asst-note" role="status">{t('set.whatSent.loading')}</p>}
            {summary.state === 'failed' && <p className="pf-asst-bad" role="status"><WithReason lang={lang} k="set.whatSent.failed" words={summary.words} /></p>}
            {summary.state === 'ok' && (<><p className="pf-asst-note">{t('set.whatSent.note')}</p><pre className="pf-asst-json" tabIndex={0} aria-label={t('set.whatSent')}>{summary.text}</pre></>)}
          </div>}
        </>
      )}
    </section>
  );
}
