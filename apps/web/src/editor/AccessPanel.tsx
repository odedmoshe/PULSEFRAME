import { useEffect, useState } from 'react';
import type { Key } from '@pulseframe/i18n';
import { api, type GrantItem, type GrantMode } from '../api.ts';
import { useEditorState } from './store.ts';
import { describeError } from './ProjectsDialog.tsx';

const MODES: GrantMode[] = ['observe', 'propose', 'edit', 'autopilot'];

export function AccessPanel() {
  const { state, t } = useEditorState();
  const projectId = state.doc?.id ?? null;
  const [grants, setGrants] = useState<GrantItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<GrantMode>('propose');
  const [thisProject, setThisProject] = useState(true);
  const [budget, setBudget] = useState('0');
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rpm, setRpm] = useState('');

  const load = async () => {
    try { setGrants((await api.listGrants()).grants); } catch (e) { setErr(describeError(e)); setGrants([]); }
  };
  // Wait until the project is loaded: by then the owner session exists. Asking earlier gets a 401.
  useEffect(() => { if (projectId) void load(); }, [projectId]);

  const statusOf = (g: GrantItem): 'active' | 'revoked' | 'expired' =>
    g.revokedAt ? 'revoked' : g.expiresAt && Date.parse(g.expiresAt) <= Date.now() ? 'expired' : 'active';
  const scopeOf = (g: GrantItem) => (!g.projectIds ? t('access.scope.all') : g.projectIds.length === 1 && g.projectIds[0] === projectId ? t('access.scope.this') : `${t('access.scope.project')} (${g.projectIds.length})`);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const units = Math.max(0, Math.floor(Number(budget) || 0));
      const r = await api.createGrant({
        name: name.trim(), mode,
        ...(thisProject && projectId ? { projectIds: [projectId] } : {}),
        ...(mode === 'autopilot' && units > 0 ? { budgetCents: units * 100 } : {}),
        ...(Math.floor(Number(rpm)) >= 1 ? { requestsPerMinute: Math.min(100000, Math.floor(Number(rpm))) } : {}),
      });
      setToken(r.token); setCopied(false); setName('');
      await load();
    } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setErr(null);
    try { await api.revokeGrant(id); await load(); } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!token) return;
    try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setErr(describeError(new Error('clipboard unavailable'))); }
  };

  return (
    <section className="fields access" data-testid="access-panel" aria-labelledby="pf-access-h">
      <h3 id="pf-access-h">{t('access.title')}</h3>
      <p className="muted">{t('access.intro')}</p>
      {err && <p className="muted danger" role="alert" data-testid="access-error">{err}</p>}

      {token && (
        <div className="access-token" role="group" aria-label={t('access.token.title')}>
          <strong>{t('access.token.title')}</strong>
          <p className="danger">{t('access.token.once')}</p>
          <input readOnly dir="ltr" value={token} onFocus={(e) => e.currentTarget.select()} aria-label={t('access.token.title')} data-testid="grant-token" />
          <div className="row">
            <button type="button" className="ghost" onClick={() => void copy()} data-testid="grant-token-copy">{copied ? t('access.token.copied') : t('access.token.copy')}</button>
            <button type="button" className="primary" onClick={() => { setToken(null); setCopied(false); }} data-testid="grant-token-dismiss">{t('access.token.dismiss')}</button>
          </div>
          <p className="muted">{t('access.token.endpoint')}: <bdi dir="ltr" data-testid="grant-endpoint">{`${location.origin}/mcp`}</bdi></p>
          <p className="muted">{t('access.token.usage')}</p>
        </div>
      )}

      {grants?.length === 0 && <p className="muted">{t('access.empty')}</p>}
      <ul className="access-list">
        {grants?.map((g) => {
          const st = statusOf(g);
          return (
            <li key={g.id} data-testid="grant-row" data-grant-id={g.id} data-status={st}>
              <strong dir="auto">{g.name}</strong>
              <span>{t(`access.mode.${g.mode}` as Key)} <span className="muted">— {t(`access.mode.${g.mode}.hint` as Key)}</span></span>
              <span className="muted">{scopeOf(g)} · {t(`access.status.${st}` as Key)}{g.requestsPerMinute ? <> · <bdi dir="ltr" data-testid="grant-rpm-shown">{g.requestsPerMinute}</bdi> {t('access.rpm.unit')}</> : null}</span>
              {st === 'active' && <button type="button" className="ghost danger" disabled={busy} onClick={() => void revoke(g.id)} data-testid="grant-revoke">{t('access.revoke')}</button>}
            </li>
          );
        })}
      </ul>

      <form className="fields" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <h4>{t('access.create')}</h4>
        <label>{t('access.name')}
          <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} data-testid="grant-name" />
        </label>
        <label>{t('access.mode')}
          <select value={mode} onChange={(e) => setMode(e.target.value as GrantMode)} data-testid="grant-mode">
            {MODES.map((m) => <option key={m} value={m}>{t(`access.mode.${m}` as Key)}</option>)}
          </select>
        </label>
        <p className="muted">{t(`access.mode.${mode}.hint` as Key)}</p>
        <label className="check">
          <input type="checkbox" checked={thisProject} onChange={(e) => setThisProject(e.target.checked)} data-testid="grant-this-project" /> {t('access.thisProject')}
        </label>
        {mode === 'autopilot' && (
          <>
            <label>{t('access.budget')}
              <input type="number" dir="ltr" min={0} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="grant-budget" />
            </label>
            <p className="muted">{t('access.budget.hint')}</p>
          </>
        )}
        <label>{t('access.rpm')}
          <input type="number" dir="ltr" min={1} max={100000} step={1} value={rpm} placeholder="—" onChange={(e) => setRpm(e.target.value)} data-testid="grant-rpm" />
        </label>
        <p className="muted">{t('access.rpm.hint')}</p>
        <button type="submit" className="primary" disabled={busy || !name.trim()} data-testid="grant-create">{t('access.createBtn')}</button>
      </form>
    </section>
  );
}
