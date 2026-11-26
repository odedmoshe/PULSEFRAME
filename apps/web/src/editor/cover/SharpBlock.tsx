/**
 * «הפריים הכי חד» in the object inspector (wave 8 cover, version 1). States (data-state of the panel): idle (the button), measuring
 * (stage and «עצירה»), found (up to three tiles with their numbers), refused (the refusal in words with its next step), picture (a
 * picture file: one frame, only «שמירת התמונה»). On open it reads what is stored (never starts a job by itself). Every number is shown
 * with the label of the heuristic; nothing is called good, right or sharp; nobody has checked the results by eye.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { findClip, rangeOfClip, type Asset, type MediaClip, type SharpAnswer } from '@pulseframe/core';
import { jobStageLabel, translateRefusal } from '@pulseframe/i18n';
import { api, ApiFailure } from '../../api.ts';
import { refusalText } from '../TrackingPanel.tsx';
import { useEditorState } from '../store.ts';
import { SharpTile } from './SharpTile.tsx';
import { StillDialog } from './StillDialog.tsx';
import { coverT } from './cover.strings.ts';
import { COVER_TESTIDS as ID } from './cover.testids.ts';
import { blockKind, forgetRun, panelState, POLL_MS, rememberedRun, rememberRun, settledOf, stillsProgress } from './cover.logic.ts';
import '../tracking.css';
import './cover.css';

/** True once W3 has built the block (InspectorObject.tsx mounts the section only then). */
export const COVER_UI_BUILT = true;

type Range = { from: number; to: number } | { error: string };

export function SharpBlock({ clip: given }: { clip: MediaClip }) {
  const { state } = useEditorState();
  const lang = state.lang;
  const t = coverT(lang);
  const doc = state.doc;
  const clip = (doc && (findClip(doc, given.id)?.clip as MediaClip | undefined)) || given;
  const asset: Asset | undefined = doc && Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  const kind = blockKind(asset);
  const [answer, setAnswer] = useState<SharpAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [jobId, setJobId] = useState<string | undefined>(() => rememberedRun(given.id));
  const [stage, setStage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [saving, setSaving] = useState<{ frame: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // the stretch this clip shows (core rangeOfClip: speed, reverse and freeze honoured; over 600 frames is refused with its next step)
  const range = useMemo((): Range | null => {
    if (!doc || kind !== 'video') return null;
    try { const r = rangeOfClip(doc, clip.id); return { from: r.from, to: r.to }; } catch (e) { return { error: translateRefusal(lang, (e as Error).message) ?? (e as Error).message }; }
  }, [doc, clip, kind, lang]);
  const rangeKey = range && 'from' in range ? `${range.from}-${range.to}` : '';

  // what is stored now (never starts a job); a part not built yet is simply «nothing measured»
  useEffect(() => {
    if (!doc || !asset || !range || !('from' in range)) { setAnswer(null); return; }
    let stop = false;
    api.readSharpFrames(doc.id, asset.id, range.from, range.to).then((a) => { if (!stop) { setAnswer(a); setErr(null); } }, (e) => {
      if (stop) return;
      setAnswer(null);
      if (!(e instanceof ApiFailure && (e.code === 'stills_not_built' || e.status === 501))) setErr(refusalText(lang, e));
    });
    return () => { stop = true; };
  }, [doc?.id, asset?.id, rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the measurement job until it ends
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const j = await api.job(jobId);
        if (stopped || !alive.current) return;
        const s = settledOf(j);
        if (s.kind === 'open') { setStage(j.stage ?? null); setCancelling(j.status === 'cancel-requested'); return; }
        stopped = true; clearInterval(id); forgetRun(given.id); setJobId(undefined); setStage(null); setCancelling(false);
        if (s.kind === 'done') { setAnswer(s.answer); setErr(null); setSaid(t('found', { n: s.answer.candidates.length })); }
        else if (s.kind === 'canceled') setSaid(t('measureStopped'));
        else setErr(refusalText(lang, new ApiFailure(0, s.code, s.message)));
      } catch (e) { if (!stopped && alive.current) { stopped = true; clearInterval(id); forgetRun(given.id); setJobId(undefined); setErr(refusalText(lang, e)); } }
    }, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc || !asset || kind === 'none') return null;
  const locked = !!findClip(doc, clip.id)?.track.locked;
  const measuring = !!jobId;
  const rangeError = range && 'error' in range ? range.error : null;
  const shownErr = err ?? rangeError;
  const panel = panelState({ kind, measuring, refused: !!shownErr, answer });
  const prog = stillsProgress(stage);

  const run = async () => {
    if (!range || !('from' in range)) return;
    setErr(null); setSaid('');
    try {
      const r = await api.findSharpFrames(doc.id, { assetId: asset.id, clipId: clip.id });
      if ('cached' in r) { setAnswer(r.answer); setSaid(t('found', { n: r.answer.candidates.length })); return; }
      rememberRun(given.id, r.jobId); setJobId(r.jobId);
    } catch (e) { setErr(refusalText(lang, e)); }
  };
  const stop = () => { if (jobId) api.cancelJob(jobId).catch((e) => setErr(refusalText(lang, e))); };

  return (
    <div className="fields cover" data-testid={ID.panel} data-state={panel} data-clip-id={clip.id}>
      {kind === 'picture' ? (
        <>
          <p className="muted">{t('picture')}</p>
          <div className="row"><button type="button" className="primary" data-testid={ID.save} onClick={() => setSaving({ frame: 0 })}>{t('save')}</button></div>
        </>
      ) : measuring ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="mtrack-bar" role="progressbar" aria-label={t('progress')} aria-valuemin={0} aria-valuemax={100} {...(prog ? { 'aria-valuenow': prog.percent } : {})} aria-valuetext={jobStageLabel(stage, lang)} data-indeterminate={!prog || undefined}>
            <span style={{ inlineSize: `${prog?.percent ?? 30}%` }} />
          </div>
          <span className="muted"><bdi>{jobStageLabel(stage, lang)}</bdi></span>
          <button type="button" className="ghost danger" data-testid={ID.stop} disabled={cancelling} onClick={stop}>{t('stop')}</button>
        </div>
      ) : (
        <>
          {range && 'from' in range && <p className="muted"><bdi dir="auto">{t('range', { from: range.from, last: range.to - 1, n: range.to - range.from })}</bdi></p>}
          <div className="row"><button type="button" className={panel === 'found' ? 'ghost' : 'primary'} data-testid={ID.measure} disabled={locked || !range || !('from' in range)} onClick={() => void run()}>{t('measure')}</button></div>
        </>
      )}
      {kind === 'video' && panel === 'found' && answer && (
        <div className="cover-found">
          {answer.candidates.length === 0 ? <p>{t('foundNone')}</p> : (
            <>
              <p>{t('found', { n: answer.candidates.length })}</p>
              <div className="cover-tiles">
                {answer.candidates.map((c, i) => (
                  <SharpTile key={`${answer.from}:${c.frame}`} rank={i + 1} startFrame={c.frame} asset={asset} answer={answer} lang={lang} projectRate={doc.settings.frameRate} onSave={(frame) => setSaving({ frame })} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {kind === 'video' && (
        <>
          <p className="muted" data-testid={ID.label}>{t('label')}</p>
          <p className="muted">{t('oneClip')}</p>
          <details className="cover-method" data-testid={ID.method}><summary>{t('method')}</summary><p>{t('methodLong')}</p></details>
        </>
      )}
      <p className={`tracking-msg${shownErr ? ' danger' : ''}`} role={shownErr ? 'alert' : 'status'} aria-live="polite" data-testid={ID.status}>{shownErr ?? said}</p>
      {saving && <StillDialog asset={asset} frame={saving.frame} answer={answer} onClose={() => setSaving(null)} />}
    </div>
  );
}
