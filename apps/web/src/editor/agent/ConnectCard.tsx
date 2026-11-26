/**
 * «חיבור מודל»: one row per preset (GET /agent/providers), its address, model, key field (not for local presets), «בדיקה» with the
 * worded answer, «מחיקת המפתח»; the ONE line on what is sent is always visible (information, not a question). The key is typed here
 * and never shown again. Key, address and probe are owner-floor routes: a 403 owner_required says so in the row.
 */
import { useState } from 'react';
import type { AgentProviderView } from '@pulseframe/core';
import { ApiFailure, api } from '../../api.ts';
import { Button } from '../../ds/index.ts';
import { AGENT_TESTIDS as ID } from './agent.testids.ts';
import { failureText, priceText, probeText, readDates, rowsOf, tr, type Lang, type ModelRow } from './agentState.ts';

interface RowNote { text: string; code: string | null; kind: 'probe' | 'error' | 'saved' }

export function ConnectCard({ lang, providers, models, selected, onSelect, onChanged }: {
  lang: Lang; providers: AgentProviderView[]; models: ModelRow[]; selected: string | null; onSelect: (id: string) => void; onChanged: () => void;
}) {
  return (
    <section className="pf-agent-connect" aria-labelledby="pf-agent-connect-h" data-testid={ID.connect}>
      <h3 id="pf-agent-connect-h">{tr(lang, 'agent.connect.title')}</h3>
      <p className="pf-agent-sent" data-testid={ID.sentLine}>{tr(lang, 'agent.connect.sent')}</p>
      <ul className="pf-agent-providers">
        {providers.map((p) => <ProviderRow key={p.id} lang={lang} p={p} rows={rowsOf(models, p.id)} selected={selected === p.id} onSelect={onSelect} onChanged={onChanged} />)}
      </ul>
    </section>
  );
}

function ProviderRow({ lang, p, rows, selected, onSelect, onChanged }: { lang: Lang; p: AgentProviderView; rows: ModelRow[]; selected: boolean; onSelect: (id: string) => void; onChanged: () => void }) {
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [model, setModel] = useState(p.model ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'probe' | 'forget'>('');
  const [note, setNote] = useState<RowNote | null>(null);
  const dates = readDates(rows);
  const dirty = baseUrl !== p.baseUrl || model !== (p.model ?? '');
  const fail = (e: unknown) => { const f = e instanceof ApiFailure ? e : null; setNote({ kind: 'error', code: f?.code ?? null, text: failureText(lang, { status: f?.status, code: f?.code, message: f?.message ?? String(e) }) }); };
  const run = async (what: 'save' | 'probe' | 'forget', fn: () => Promise<void>) => {
    setBusy(what); setNote(null);
    try { await fn(); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const save = () => run('save', async () => {
    if (dirty) await api.setAgentProvider(p.id, { baseUrl, model: model.trim() || null });
    if (key.trim()) await api.setAgentKey(p.id, key.trim());
    setKey(''); setNote({ kind: 'saved', code: null, text: tr(lang, 'agent.connect.saved') }); onChanged();
  });
  const probe = () => run('probe', async () => {
    // an address or key typed but not saved yet is saved first: the probe tests what is stored, never what is only on screen
    if (dirty || key.trim()) await save2();
    const a = await api.probeAgentProvider(p.id);
    setNote({ kind: 'probe', code: a.ok ? 'ok' : (a.code ?? 'unknown'), text: probeText(lang, a) });
    onChanged();
  });
  const save2 = async () => { if (dirty) await api.setAgentProvider(p.id, { baseUrl, model: model.trim() || null }); if (key.trim()) await api.setAgentKey(p.id, key.trim()); setKey(''); };
  const forget = () => run('forget', async () => { await api.deleteAgentKey(p.id); setNote(null); onChanged(); });
  const pid = `pf-agent-${p.id}`;
  return (
    <li className="pf-agent-provider" data-testid={ID.provider} data-provider={p.id} data-selected={selected ? 'true' : 'false'}>
      <label className="pf-agent-use">
        <input type="radio" name="pf-agent-provider" checked={selected} onChange={() => onSelect(p.id)} aria-label={`${tr(lang, 'agent.connect.use')}: ${tr(lang, `agent.preset.${p.id}`)}`} />
        <b>{tr(lang, `agent.preset.${p.id}`)}</b>
      </label>
      {p.local ? <p className="pf-agent-note" data-testid={ID.localSmall}>{tr(lang, 'agent.connect.localSmall')}</p> : null}
      {p.local && !p.needsKey ? <p className="pf-agent-note">{tr(lang, 'agent.connect.localNoKey')}</p> : null}
      {p.compatNote ? <p className="pf-agent-note" data-testid={ID.compat}>{tr(lang, 'agent.connect.compat')}</p> : null}
      {p.unencrypted ? <p className="pf-agent-warn" role="note" data-testid={ID.unencrypted}>{tr(lang, 'agent.connect.unencrypted')}</p> : null}
      <div className="pf-agent-fields">
        <label htmlFor={`${pid}-url`}>{tr(lang, 'agent.connect.baseUrl')}</label>
        <input id={`${pid}-url`} type="url" dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} data-testid={ID.baseUrl} />
        <label htmlFor={`${pid}-model`}>{tr(lang, 'agent.connect.model')}</label>
        <input id={`${pid}-model`} type="text" dir="ltr" list={`${pid}-models`} value={model} onChange={(e) => setModel(e.target.value)} data-testid={ID.model} />
        <datalist id={`${pid}-models`}>{rows.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</datalist>
        {p.needsKey ? (
          <>
            <label htmlFor={`${pid}-key`}>{tr(lang, 'agent.connect.key')}</label>
            <input id={`${pid}-key`} type="password" dir="ltr" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.keySet ? tr(lang, 'agent.connect.keySet') : ''} data-testid={ID.key} />
          </>
        ) : null}
      </div>
      {p.needsKey ? <p className="pf-agent-dim">{p.keySet ? tr(lang, 'agent.connect.keySet') : tr(lang, 'agent.connect.keyHint')}</p> : null}
      {rows.length ? (
        <details className="pf-agent-prices">
          <summary>{tr(lang, 'agent.connect.prices', { date: dates.join(', ') })}</summary>
          <ul>{rows.map((r) => <li key={r.id}><bdi dir="ltr">{r.id}</bdi> · {priceText(lang, r)}{r.note ? ` · ${r.note}` : ''}</li>)}</ul>
        </details>
      ) : <p className="pf-agent-dim">{tr(lang, 'agent.connect.noModelRows')}</p>}
      <div className="pf-agent-actions">
        <Button variant="secondary" size="sm" busy={busy === 'save'} onClick={() => void save()} disabledReason={!dirty && !key.trim() ? tr(lang, 'agent.connect.saved') : undefined}>{tr(lang, 'agent.connect.save')}</Button>
        <Button variant="secondary" size="sm" busy={busy === 'probe'} onClick={() => void probe()} data-testid={ID.probe}>{tr(lang, 'agent.connect.probe')}</Button>
        {p.keySet ? <Button variant="danger-quiet" size="sm" busy={busy === 'forget'} onClick={() => void forget()} data-testid={ID.forgetKey}>{tr(lang, 'agent.connect.keyForget')}</Button> : null}
      </div>
      <div role="status" aria-live="polite" className="pf-agent-answer">
        {note ? <p data-testid={note.kind === 'probe' ? ID.probeResult : note.kind === 'error' ? ID.error : undefined} data-code={note.code ?? undefined} className={note.kind === 'probe' && note.code === 'ok' ? 'pf-agent-ok' : note.kind === 'saved' ? 'pf-agent-dim' : 'pf-agent-warn'}>{note.text}</p> : null}
      </div>
    </li>
  );
}
