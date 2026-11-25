/**
 * «השוואת עוצמה» in the sound panel (wave 7 send): measure the selected clips (api.measureClipLoudness), offer a target (the
 * median of the clips; −18 LUFS for a single one; typed targets allowed), show what each clip will change by (core planMatchGain, the
 * function the op runs), commit match_clip_loudness at the measurement's revision (one transaction, one undo), and list what happened
 * per clip. A clip that cannot be measured is listed with its reason and is left alone. LUFS is not the ear: the panel says so.
 */
import { useEffect, useMemo, useState } from 'react';
import { findClip, type ClipLoudnessResult, type MatchClipOutput } from '@pulseframe/core';
import { dictionaries, translateRefusal } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { api, ApiFailure } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { SEND_TESTIDS as ID } from './send.testids.ts';
import { SEND_STRINGS } from './send.strings.ts';
import { defaultMatchTarget, fmtDbSigned, matchOpArgs, parseTarget, planMatch, skippedRows, usable } from './send.logic.ts';

export interface LoudnessMatchProps { lang: 'he' | 'en'; projectId: string; clipIds: string[]; /** the per-track button's name for the selection, when it asked */ scopeLabel?: string }
type Done = { revision: number; transactionId: string | null; clips: MatchClipOutput[] };

export function LoudnessMatch({ lang, projectId, clipIds, scopeLabel }: LoudnessMatchProps) {
  const { editor, state } = useEditorState();
  const D = dictionaries[lang], S = SEND_STRINGS[lang];
  const [busy, setBusy] = useState<'measure' | 'apply' | null>(null);
  const [res, setRes] = useState<ClipLoudnessResult | null>(null);
  const [target, setTarget] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = clipIds.join(' ');
  // a measurement belongs to the clips it was made for: a different selection starts over
  useEffect(() => { setRes(null); setDone(null); setProblem(null); }, [ids, projectId]);
  const doc = state.doc;
  const say = (e: unknown) => (e instanceof ApiFailure ? (translateRefusal(lang, e.message) ?? `${e.message}${e.hint ? `. ${e.hint}` : ''}`) : e instanceof Error ? e.message : String(e));
  const label = (id: string) => { const f = doc ? findClip(doc, id) : undefined; const c = f?.clip; return c && c.type === 'media' && doc?.assets[c.assetId]?.name ? doc.assets[c.assetId]!.name : id; };
  const measure = async () => {
    if (!clipIds.length) return;
    setBusy('measure'); setProblem(null); setDone(null);
    try {
      const seq = state.rawDoc && state.activeSequenceId !== state.rawDoc.mainSequenceId ? state.activeSequenceId : undefined;
      const r = await api.measureClipLoudness(projectId, { clipIds, ...(seq ? { sequenceId: seq } : {}) });
      setRes(r);
      const t = defaultMatchTarget(r.clips, r.medianLufs);
      setTarget(t === null ? '' : String(t).replace('-', '−'));
    } catch (e) { setRes(null); setProblem(say(e)); } finally { setBusy(null); }
  };
  const t = parseTarget(target);
  const fresh = !!res && res.revision === state.revision;
  const plan = useMemo(() => (doc && res && t !== null ? planMatch(doc, res.clips, t) : []), [doc, res, t]);
  const apply = async () => {
    if (!res || t === null || !plan.length) return;
    setBusy('apply'); setProblem(null);
    const r = await editor.commitExact([{ op: 'match_clip_loudness', args: matchOpArgs(res.clips, t) }], 'Match loudness', res.revision, `match:${crypto.randomUUID()}`);
    setBusy(null);
    if (r.kind === 'committed') {
      const out = r.result.results[0]?.output as { clips?: MatchClipOutput[] } | undefined;
      setDone({ revision: r.result.revision, transactionId: r.result.transactionId ?? null, clips: out?.clips ?? [] });
    } else if (r.kind === 'stale') setProblem(S.stale);
    else setProblem(translateRefusal(lang, r.message) ?? (r.code === 'incompatible' && /changed since/.test(r.message) ? S.stale : `${r.message}${r.hint ? `. ${r.hint}` : ''}`));
  };
  const undo = async () => { if (done?.transactionId) { await editor.undoTransaction(done.transactionId); setDone(null); setRes(null); } };
  const skipped = res ? skippedRows(res.clips) : [];
  return (
    <div className="pf-send-match" data-testid={ID.match} role="group" aria-label={D['send.match']}>
      <p className="muted pf-help">{scopeLabel ? `${scopeLabel}. ` : ''}{S.matchHelp}</p>
      <Button size="sm" variant="secondary" busy={busy === 'measure'} disabledReason={clipIds.length ? undefined : S.noneSelected} onClick={() => void measure()} data-testid={ID.matchRun}>{busy === 'measure' ? S.measuring : S.matchRun}</Button>
      {problem && <p className="pf-send-refusal" role="alert" dir="auto" data-testid="loudness-match-error">{isolate(problem)}</p>}
      {res && !done && (
        <div className="pf-send-match-plan" data-testid="loudness-match-plan">
          <label className="num-unit pf-send-field">{S.targetLufs}
            <input type="text" inputMode="decimal" dir="ltr" value={target} aria-invalid={target !== '' && t === null} data-testid="loudness-match-target" onChange={(e) => setTarget(e.target.value)} />
          </label>
          <span className="muted">{res.clips.filter(usable).length === 1 ? S.single : S.median}</span>
          {target !== '' && t === null && <p className="pf-send-refusal" role="alert">{S.targetInvalid}</p>}
          {!fresh && <p className="pf-send-honest" role="status">{S.stale}</p>}
          <ul className="pf-send-match-list" data-testid="loudness-match-preview">
            {plan.map((p, i) => (
              <li key={p.clipId} data-clip-id={p.clipId} data-limited-by={p.limitedBy ?? ''}>
                <b dir="auto">{label(p.clipId) || S.clipOf(i + 1)}</b> · <bdi dir="ltr" className="num">{fmtDbSigned(p.changeDb)} {S.dbUnit}</bdi>
                {p.limitedBy && <small> · {p.limitedBy === 'peak' ? D['send.limitedByPeak'] : D['send.limitedByRange']}</small>}
              </li>
            ))}
            {skipped.map((r) => <li key={r.clipId} data-clip-id={r.clipId} data-skipped={r.status}><b dir="auto">{label(r.clipId)}</b> · {S.skipped}: {S.status[r.status]}</li>)}
          </ul>
          <Button size="sm" variant="primary" busy={busy === 'apply'} disabledReason={!fresh ? S.stale : t === null ? S.targetInvalid : !plan.length ? S.noneSelected : undefined} onClick={() => void apply()} data-testid="loudness-match-apply">{busy === 'apply' ? S.applying : S.apply}</Button>
          <p className="muted pf-help">{D['send.lufsNote']}</p>
        </div>
      )}
      {done && (
        <div role="status" data-testid={ID.matchResult} className="pf-send-match-done">
          <b>{S.matched(done.clips.length)}</b>
          <ul className="pf-send-match-list">
            {done.clips.map((c, i) => (
              <li key={c.clipId} data-clip-id={c.clipId} data-limited-by={c.limitedBy ?? ''}>
                <b dir="auto">{label(c.clipId) || S.clipOf(i + 1)}</b> · {S.was} <bdi dir="ltr" className="num">×{c.from}</bdi> → {S.willBe} <bdi dir="ltr" className="num">×{c.to}</bdi> · <bdi dir="ltr" className="num">{fmtDbSigned(c.changeDb)} {S.dbUnit}</bdi>
                {c.limitedBy && <small> · {c.limitedBy === 'peak' ? D['send.limitedByPeak'] : D['send.limitedByRange']}</small>}
              </li>
            ))}
            {skipped.map((r) => <li key={r.clipId} data-clip-id={r.clipId} data-skipped={r.status}><b dir="auto">{label(r.clipId)}</b> · {S.skipped}: {S.status[r.status]}</li>)}
          </ul>
          {done.transactionId && <Button size="sm" variant="secondary" onClick={() => void undo()} data-testid="loudness-match-undo">{S.undo}</Button>}
          <p className="muted pf-help">{D['send.lufsNote']}</p>
        </div>
      )}
    </div>
  );
}
