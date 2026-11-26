/**
 * Settings › «חיבורים» — the outside services (wave 8 sources, W3, C1): one card per service, «מה נשלח», the download limit.
 * Storing a key or contact line is the owner's own session; any other session sees the state only (no dead button).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { SOURCE_TERMS, SEARCHABLE_SOURCES, type SearchableSourceId, type SourceCredentialsBody, type SourceState, type SourcesSettings } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { sayFailure } from '../library/LibraryBrowser.tsx';
import { isOwnerActor } from '../library/library.logic.ts';
import { useEditorState } from '../store.ts';
import { SOURCES_TESTIDS as TID } from './sources.testids.ts';
import { sourcesApi } from './sourcesApi.ts';
import { providerName, sizeText, sx } from './sources.logic.ts';
import './sources.css';

const SIGNUP: Record<'pixabay' | 'openverse', string> = { pixabay: 'https://pixabay.com/api/docs/', openverse: 'https://api.openverse.org/v1/' };
const stateWord = (lang: Lang, s: SourceState): string => (s.state === 'needs_key' ? sx(lang, 'sources.needsKey') : s.state === 'needs_contact' ? sx(lang, 'sources.needsContact') : s.state === 'ready' ? sx(lang, 'sources.state.ready') : sx(lang, 'sources.state.not_built'));

function Secret({ id, label, value, onChange, type = 'password' }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string }): ReactElement {
  return (
    <label className="pf-src-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type={type} dir="ltr" className="pf-src-input" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
    </label>
  );
}

export function ConnectionCard({ s, lang, owner, onChanged }: { s: SourceState; lang: Lang; owner: boolean; onChanged: (s: SourceState) => void }): ReactElement {
  const p: SearchableSourceId = s.provider;
  const [key, setKey] = useState(''); const [cid, setCid] = useState(''); const [secret, setSecret] = useState(''); const [contact, setContact] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const body = (): SourceCredentialsBody | null => {
    if (p === 'pixabay') return key.trim() ? { key: key.trim() } : null;
    if (p === 'wikimedia') return contact.trim().length >= 3 ? { contact: contact.trim() } : null;
    if (cid.trim() && secret.trim()) return { clientId: cid.trim(), clientSecret: secret.trim() };
    return null;
  };
  const run = async (f: () => Promise<SourceState>, done: string) => {
    setBusy(true); setNote(null);
    try { onChanged(await f()); setKey(''); setCid(''); setSecret(''); setContact(''); setNote({ ok: true, text: done }); } catch (e) { setNote({ ok: false, text: sayFailure(lang, e) }); } finally { setBusy(false); }
  };
  const save = (e: FormEvent) => { e.preventDefault(); const b = body(); if (b) void run(() => sourcesApi.setCredentials(p, b), sx(lang, 'sources.connect.stored')); };
  const hasSecret = s.keySet;
  const title = p === 'wikimedia' ? sx(lang, 'sources.connect.wikimedia') : providerName(p);
  const hint = p === 'pixabay' ? sx(lang, 'sources.connect.pixabayHint') : p === 'openverse' ? sx(lang, 'sources.connect.openverseHint') : sx(lang, 'sources.connect.contactHint');
  const policy = SOURCE_TERMS['wikimedia.user_agent']!;
  return (
    <section className="pf-src-card-conn" data-testid={TID.card(p)} aria-labelledby={`pf-conn-h-${p}`}>
      <h4 id={`pf-conn-h-${p}`}><bdi>{title}</bdi> <span className="pf-src-muted">{stateWord(lang, s)}</span></h4>
      <p className="pf-src-muted" dir="auto">{hint}</p>
      {p === 'openverse' && (
        <p className="pf-src-muted" dir="auto">
          {s.mode === 'client' ? sx(lang, 'sources.connect.clientMode') : s.remaining ? sx(lang, 'sources.connect.anonymous', { n: s.remaining.count }) : null}
        </p>
      )}
      <p className="pf-src-muted" dir="auto">
        {p === 'wikimedia' ? sx(lang, s.keySet ? 'sources.connect.contactSet' : 'sources.connect.noContact') : s.keySet ? sx(lang, 'sources.connect.keySet', { at: s.keyAddedAt ?? '' }) : sx(lang, 'sources.connect.noKey')}
      </p>
      {p === 'pixabay' && <a href={SIGNUP.pixabay} target="_blank" rel="noopener noreferrer" dir="ltr">{sx(lang, 'sources.connect.signup')}</a>}
      {p === 'openverse' && <a href={SIGNUP.openverse} target="_blank" rel="noopener noreferrer">{sx(lang, 'sources.connect.openverseClient')}</a>}
      {p === 'wikimedia' && <a href={policy.url} target="_blank" rel="noopener noreferrer">{sx(lang, 'sources.connect.policy')}</a>}
      {owner ? (
        <form className="pf-src-conn" onSubmit={save}>
          {p === 'pixabay' && <Secret id="pf-conn-key-pixabay" label={sx(lang, 'sources.connect.key')} value={key} onChange={setKey} />}
          {p === 'openverse' && <><Secret id="pf-conn-cid" label={sx(lang, 'sources.connect.clientId')} value={cid} onChange={setCid} type="text" /><Secret id="pf-conn-secret" label={sx(lang, 'sources.connect.clientSecret')} value={secret} onChange={setSecret} /></>}
          {p === 'wikimedia' && <Secret id="pf-conn-contact" label={sx(lang, 'sources.connect.contact')} value={contact} onChange={setContact} type="text" />}
          <div className="pf-src-row">
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !body()} data-testid={TID.save(p)}>{sx(lang, 'sources.connect.save')}</Button>
            {hasSecret && <Button type="button" size="sm" variant="ghost" disabled={busy} data-testid={TID.forget(p)} onClick={() => void run(() => sourcesApi.deleteCredentials(p), sx(lang, 'sources.connect.removed'))}>{sx(lang, 'sources.connect.forget')}</Button>}
          </div>
        </form>
      ) : null}
      <p role="status" className={note && !note.ok ? 'pf-src-err' : 'pf-src-muted'} dir="auto">{note?.text}</p>
    </section>
  );
}

export function ConnectionsSection(): ReactElement {
  const { state } = useEditorState();
  const lang = state.lang;
  const owner = isOwnerActor(state.actor);
  const [list, setList] = useState<SourceState[] | null>(null);
  const [settings, setSettings] = useState<SourcesSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    sourcesApi.list().then((r) => { if (!live) return; setList(r.sources); setSettings(r.settings); }).catch((e) => { if (live) setError(sayFailure(lang, e)); });
    return () => { live = false; };
  }, [lang]);
  const changed = useCallback((s: SourceState) => setList((l) => l?.map((x) => (x.provider === s.provider ? s : x)) ?? l), []);
  const saveLimit = async (e: FormEvent) => {
    e.preventDefault(); setNote(null);
    const mb = limit.trim() === '' ? null : Math.floor(Number(limit) * 1024 * 1024);
    if (mb !== null && !(mb > 0)) return;
    try { setSettings(await sourcesApi.setSettings(mb)); setLimit(''); setNote({ ok: true, text: sx(lang, 'sources.connect.stored') }); } catch (err) { setNote({ ok: false, text: sayFailure(lang, err) }); }
  };
  return (
    <section className="pf-src pf-src-conn" data-testid={TID.connections} aria-labelledby="pf-conn-h">
      <h3 className="pf-set-h" id="pf-conn-h">{sx(lang, 'sources.connect.title')}</h3>
      {error && <p className="pf-src-err" role="alert" dir="auto">{error}</p>}
      {!list && !error && <p className="pf-src-muted" role="status">{sx(lang, 'sources.connect.loading')}</p>}
      {!owner && list && <p className="pf-src-muted" dir="auto">{sx(lang, 'sources.connect.stateOnly')}. {sx(lang, 'sources.connect.ownerOnly')}</p>}
      {list && SEARCHABLE_SOURCES.map((p) => { const s = list.find((x) => x.provider === p); return s ? <ConnectionCard key={p} s={s} lang={lang} owner={owner} onChanged={changed} /> : null; })}
      <p className="pf-src-muted" dir="auto">{sx(lang, 'sources.connect.sent')}</p>
      {settings && (
        <form className="pf-src-conn" onSubmit={(e) => void saveLimit(e)}>
          <label className="pf-src-field" htmlFor="pf-conn-max">
            <span>{sx(lang, 'sources.connect.maxBytes')} (MB)</span>
            <input id="pf-conn-max" type="number" min={1} step={1} dir="ltr" className="pf-src-input" value={limit} onChange={(e) => setLimit(e.target.value)} data-testid={TID.maxBytes} placeholder={String(Math.round(settings.effectiveMaxBytes / 1024 ** 2))} />
          </label>
          <p className="pf-src-muted" dir="auto">{sx(lang, 'sources.connect.maxBytesHint', { max: sizeText(settings.maxUploadBytes) })}. {settings.maxDownloadBytes ? sx(lang, 'sources.connect.limitNow', { n: sizeText(settings.effectiveMaxBytes) }) : sx(lang, 'sources.connect.noLimit')}</p>
          <div className="pf-src-row"><Button type="submit" size="sm" variant="secondary">{sx(lang, 'sources.connect.save')}</Button></div>
          <p role="status" className={note && !note.ok ? 'pf-src-err' : 'pf-src-muted'} dir="auto">{note?.text}</p>
        </form>
      )}
      {owner && <p className="pf-src-muted" dir="auto">{sx(lang, 'sources.connect.windows')}</p>}
    </section>
  );
}
