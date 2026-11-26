/**
 * «מה שונה בגרסה הזו» — the change list of the viewed version for an audience (wave 8 audiences track). DeliverPanel.tsx mounts it in
 * the formats section while a version with `audience` is viewed. It holds (plan §3.6, corrected by the verifier; sharing is cut): the
 * groups changes / fast cuts not changed / sound / what the version does not do, from api.audienceChanges (refetched when the revision
 * changes); each row a button (one roving tab stop, ds rovingNext) whose Enter or click moves the playhead to its startFrame and moves
 * no focus; «להשאיר כמו במקור» / «להחזיר את השינוי» commits set_audience_keep once; sound rows with role, reason and a role select
 * (update_audience_version.sound) and the integer-dB music level (musicDb) said «ביחס לשאר הקול», every sound row «לא נשמע»;
 * «לשליחה» opens the export sheet on this version (openExportSheet({ variantId }) chooses its target). A 501 shows audience.notBuilt. Ids: AUDIENCE_TESTIDS. No focus is moved in a later task
 * (CAPABILITIES "Keyboard focus is never moved in a later task").
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SOUND_ROLES, type AudienceChanges, type SoundRole, type Variant } from '@pulseframe/core';
import { api, ApiFailure } from '../../api.ts';
import { rovingNext, useDir } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { openExportSheet } from '../ExportSheet.tsx';
import { audienceT } from './audience.strings.ts';
import { AUDIENCE_TESTIDS as ID } from './audience.testids.ts';
import { appliedCount, changeText, fastCutText, frameClock, jumpable, jumpRows, keepOp, keepRuleOf } from './audience.logic.ts';
import './audience.css';

/** True once the editor surfaces (the menu group, the chip mark, this panel, the stage note) are built; the server answers them. */
export const AUDIENCE_UI_BUILT = true;

type Load = { state: 'loading' } | { state: 'list'; data: AudienceChanges } | { state: 'refused' | 'not-built'; why: string };

/** The change list of one version, refetched when the document's revision changes; the last list stays on screen while it reloads. */
export function useAudienceChanges(projectId: string | undefined, variantId: string | undefined, revision: number): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    if (!projectId || !variantId) return;
    let dead = false;
    api.audienceChanges(projectId, variantId).then((data) => { if (!dead) setLoad({ state: 'list', data }); }).catch((e: unknown) => {
      if (dead) return;
      const f = e instanceof ApiFailure ? e : null;
      setLoad(f?.status === 501 ? { state: 'not-built', why: '' } : { state: 'refused', why: e instanceof Error ? e.message : String(e) });
    });
    return () => { dead = true; };
  }, [projectId, variantId, revision]);
  return load;
}

export function AudiencePanel({ variant }: { variant: Variant }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = audienceT(lang);
  const dir = useDir();
  const doc = state.doc;
  const load = useAudienceChanges(doc?.id, variant.id, state.revision);
  const rate = editor.rate;
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [level, setLevel] = useState<string | null>(null); // the music level being typed; null = the stored value
  const stored = variant.audience?.musicDb;
  const data = load.state === 'list' ? load.data : null;
  const main = state.rawDoc?.mainSequenceId ?? doc?.mainSequenceId ?? null;
  const jumps = data ? jumpRows(data, main) : [];
  const jumpAt = new Map(jumps.map((j, n) => [j.key, n]));
  const seqName = (id: string) => state.rawDoc?.sequences[id]?.name || id;
  const at = Math.min(active, Math.max(0, jumps.length - 1));
  const wrapDir = lang === 'he' ? 'rtl' : 'ltr';

  const jump = (frame: number) => editor.seek(frame);
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = rovingNext(i, e.key, { count: jumps.length, dir, orientation: 'vertical' });
    if (to === null) return;
    e.preventDefault(); setActive(to); rows.current[to]?.focus();
  };
  const commitLevel = () => {
    if (level === null) return;
    const text = level.trim();
    const next = text === '' ? null : Math.round(Number(text));
    setLevel(null);
    if (next !== null && !Number.isFinite(next)) return;
    if ((next ?? undefined) === stored) return;
    void editor.commit([{ op: 'update_audience_version', args: { variantId: variant.id, musicDb: next } }], 'Music level of a version');
  };
  const trackName = (id: string) => {
    const tracks = doc ? Object.values(doc.sequences).flatMap((s) => s.tracks) : [];
    const i = tracks.findIndex((x) => x.id === id);
    return tracks[i]?.name || t('track', { n: tracks.filter((x) => x.kind === 'audio').findIndex((x) => x.id === id) + 1 });
  };
  const panelState = load.state === 'list' ? (data!.changes.length + data!.fastCuts.length + data!.soundRoles.length === 0 ? 'empty' : 'list') : load.state;

  return (
    <section className="aud-panel" dir={wrapDir} aria-labelledby="aud-panel-h" data-testid={ID.panel} data-state={panelState} data-profile={variant.audience?.profile}>
      <h4 id="aud-panel-h">{t('panel')}</h4>
      <p className="aud-lead">{t(variant.audience?.profile ?? 'calm')} · {t(`${variant.audience?.profile ?? 'calm'}.desc`)} · <span>{t('unseen')}</span></p>
      {load.state === 'loading' && <p className="muted" role="status">{t('working')}</p>}
      {load.state === 'not-built' && <p className="muted" role="status">{t('notBuilt')}</p>}
      {load.state === 'refused' && <p className="danger" role="alert">{t('failed', { why: load.why })}</p>}
      {data && (
        <>
          <p className="muted" aria-live="polite">{t('changeCount', { n: appliedCount(data) })}{data.changes.some((c) => c.kept) ? ` · ${t('keptCount', { n: data.changes.filter((c) => c.kept).length })}` : ''}</p>
          {panelState === 'empty' && <p className="muted">{t('none')}</p>}
          {data.changes.length > 0 && (
            <>
              <h5>{t('changes')}</h5>
              <ul className="aud-rows" aria-label={t('changes')}>
                {data.changes.map((c) => {
                  const op = keepOp(variant.id, c);
                  const i = jumpAt.get(c.key) ?? -1;
                  return (
                    <li key={c.key} className={c.kept ? 'is-kept' : undefined}>
                      {!jumpable(c, main) ? (
                        // a row of another sequence (a short): its frames are on that sequence's clock, so it is listed without a jump
                        <span className="aud-row is-elsewhere" data-testid={ID.change} data-rule={c.rule} data-clip-id={c.clipId ?? undefined} data-sequence-id={c.sequenceId} data-kept={String(c.kept)}>
                          <span dir="auto">{changeText(c, lang)}</span>
                          <span className="muted" dir="auto">{t('elsewhere', { name: seqName(c.sequenceId) })}</span>
                          {c.kept && <span className="aud-kept">{t('kept')}</span>}
                        </span>
                      ) : (
                      <button type="button" className="aud-row" ref={(el) => { rows.current[i] = el; }} tabIndex={i === at ? 0 : -1} onFocus={() => setActive(i)} onKeyDown={(e) => onKey(e, i)} onClick={() => jump(c.startFrame)}
                        aria-label={`${changeText(c, lang)}${c.kept ? ` · ${t('kept')}` : ''} · ${t('jump', { time: frameClock(c.startFrame, rate) })}`}
                        data-testid={ID.change} data-rule={c.rule} data-clip-id={c.clipId ?? undefined} data-start-frame={c.startFrame} data-kept={String(c.kept)}>
                        <span dir="auto">{changeText(c, lang)}</span>
                        <bdi dir="ltr" className="num aud-time">{frameClock(c.startFrame, rate)}</bdi>
                        {c.kept && <span className="aud-kept">{t('kept')}</span>}
                      </button>
                      )}
                      {op && keepRuleOf(c) && (
                        <button type="button" className="ghost small" data-testid={ID.keep} onClick={() => void editor.commit([op], 'Keep as in the original')}>{c.kept ? t('giveBack') : t('keep')}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {data.fastCuts.length > 0 && (
            <>
              <h5>{t('fastCuts')}</h5>
              <ul className="aud-rows" aria-label={t('fastCuts')}>
                {data.fastCuts.map((f, k) => {
                  const i = jumpAt.get(`fast:${k}:${f.startFrame}`) ?? -1;
                  return (
                    <li key={`fast:${k}:${f.startFrame}`}>
                      <button type="button" className="aud-row" ref={(el) => { rows.current[i] = el; }} tabIndex={i === at ? 0 : -1} onFocus={() => setActive(i)} onKeyDown={(e) => onKey(e, i)} onClick={() => jump(f.startFrame)}
                        aria-label={`${fastCutText(f, lang)} · ${t('jump', { time: frameClock(f.startFrame, rate) })}`} data-testid={ID.fastCut} data-start-frame={f.startFrame}>
                        <span dir="auto">{fastCutText(f, lang)}</span>
                        <bdi dir="ltr" className="num aud-time">{frameClock(f.startFrame, rate)}</bdi>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <h5>{t('sound')} · <span>{t('unheard')}</span></h5>
          <label className="aud-level">{t('musicDb')}
            <input type="number" dir="ltr" min={-20} max={0} step={1} value={level ?? (stored ?? '')} placeholder={String(data.musicDb)} data-testid={ID.musicDb}
              onChange={(e) => setLevel(e.target.value)} onBlur={commitLevel} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLevel(); } }} />
            <span className="muted">{stored === undefined ? t('musicDefault') : ''} · <bdi dir="ltr" className="num">{t('levelNow', { db: data.musicDb })}</bdi></span>
          </label>
          {data.soundRoles.length === 0 ? <p className="muted">{t('soundNone')}</p> : (
            <ul className="aud-sound">
              {data.soundRoles.map((s) => {
                const own = variant.audience?.sound?.[s.trackId] ?? '';
                return (
                  <li key={s.trackId} data-testid={ID.soundRow} data-track-id={s.trackId} data-role={s.role} data-why={s.why}>
                    <span dir="auto"><strong>{trackName(s.trackId)}</strong> · {t(`role.${s.role}`)} · <span className="muted">{t(`why.${s.why}`)}</span> · <span>{t('unheard')}</span></span>
                    <label>{t('roleLabel')}
                      <select value={own} data-testid={ID.roleSelect} onChange={(e) => { const role = e.target.value as SoundRole | ''; void editor.commit([{ op: 'update_audience_version', args: { variantId: variant.id, sound: { trackId: s.trackId, role: role || null } } }], 'Sound role of a version'); }}>
                        <option value="">{t('role.auto')}</option>
                        {SOUND_ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <h5>{t('notHandledTitle')}</h5>
      <ul className="aud-not">
        {(data?.notHandled ?? ['pace', 'keys', 'not_medical', 'flash_check', 'sound_unheard']).map((code) => <li key={code} data-testid={ID.notHandled} data-code={code} dir="auto">{t(`notHandled.${code}`)}</li>)}
      </ul>
      <button type="button" className="primary small" data-testid={ID.send} onClick={() => openExportSheet({ variantId: variant.id })}>{t('send')}…</button>
    </section>
  );
}
