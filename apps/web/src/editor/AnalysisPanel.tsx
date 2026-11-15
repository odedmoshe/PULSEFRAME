import { useEffect, useState } from 'react';
import { findClip, sourceAt, sourceEnd } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import type { Clip } from '@pulseframe/core';
import { api, ApiFailure } from '../api.ts';
import { useEditorState } from './store.ts';

type MediaClip = Extract<Clip, { type: 'media' }>;
type Kind = 'scenes' | 'beats';

/** Nearest time of `list` to `t` (exact rational compare), or null when the list is empty. */
function nearest(list: readonly T.RationalTime[], t: T.RationalTime): T.RationalTime | null {
  let best: T.RationalTime | null = null;
  let bestD: T.RationalTime | null = null;
  for (const x of list) {
    const d = T.cmp(x, t) < 0 ? T.sub(t, x) : T.sub(x, t);
    if (bestD === null || T.lt(d, bestD)) { best = x; bestD = d; }
  }
  return best;
}

/** Stored scene-cut / beat results of the selected media clip's asset, plus runners and manual correction (no AI involved). */
export function AnalysisPanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const sel = editor.selected;
  const clip = sel?.clip.type === 'media' ? (sel.clip as MediaClip) : null;
  const assetId = clip?.assetId ?? null;
  const [busy, setBusy] = useState<Kind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); }, [assetId]);
  if (!doc || !clip || !assetId || state.selection.length !== 1) return null;

  const asset = doc.assets[assetId];
  const an = doc.analyses?.[assetId];
  const hasVideo = !!asset?.video;
  const hasAudio = !!asset?.audio;
  const scenes = an?.scenes;
  const beats = an?.beats;
  const clipEndT = T.add(clip.start, clip.duration);
  const ph = editor.playhead;
  const inside = T.lte(clip.start, ph) && T.lt(ph, clipEndT);
  const srcNow = inside ? sourceAt(clip, ph) : null;
  const srcEnd = sourceEnd(clip);
  const cutsInClip = scenes ? scenes.cuts.filter((c) => T.lt(clip.sourceIn, c) && T.lt(c, srcEnd)).length : 0;

  const run = async (kind: Kind) => {
    setBusy(kind); setErr(null);
    try { await api.analyzeAsset(doc.id, assetId, { kind }); }
    catch (e) { setErr(e instanceof ApiFailure ? `${e.message}${e.code === 'no_video' ? ` (${t('analysis.noVideo')})` : e.code === 'no_audio' ? ` (${t('analysis.noAudio')})` : ''}` : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  // Handlers read the playhead when they run (a seek may not have re-rendered this panel yet), and "which point is
  // nearest" is decided from the document as it is when the edit's turn comes.
  const liveSrc = () => { const c = editor.doc ? findClip(editor.doc, clip.id)?.clip : undefined; const at = editor.playhead; return c && c.type === 'media' && T.lte(c.start, at) && T.lt(at, T.add(c.start, c.duration)) ? sourceAt(c, at) : null; };
  const add = (kind: Kind) => { const at = liveSrc(); if (at) void editor.commit([{ op: 'edit_analysis', args: { assetId, kind, add: [at] } }], 'Edit analysis'); };
  const remove = (kind: Kind) => {
    const at = liveSrc();
    if (!at) return;
    void editor.commit(() => {
      const cur = editor.doc?.analyses?.[assetId];
      const n = nearest(kind === 'scenes' ? cur?.scenes?.cuts ?? [] : cur?.beats?.beats ?? [], at);
      return n ? [{ op: 'edit_analysis', args: { assetId, kind, remove: [n] } }] : null;
    }, 'Edit analysis');
  };

  const conf = beats?.confidence ?? null;
  const origin = (o: { method: string; edited: boolean }) => (
    <span className="muted"> {t('analysis.method')}: <bdi>{o.method}</bdi>{o.edited && <> <span className="badge" data-testid="analysis-edited">{t('analysis.edited')}</span></>}</span>
  );
  const noneToRemove = (k: Kind) => (k === 'scenes' ? !scenes || scenes.cuts.length === 0 : !beats || beats.beats.length === 0);

  return (
    <div className="fields analysis" data-testid="analysis-panel" data-asset-id={assetId}>
      <h2>{t('analysis')}</h2>
      <p className="muted" data-testid="analysis-note">{t('analysis.note')}</p>
      <p className="stat" data-testid="analysis-scenes" data-count={scenes ? scenes.cuts.length : undefined}>
        <strong>{t('analysis.scenes')}:</strong> {scenes ? <><bdi>{scenes.cuts.length}</bdi>{origin(scenes.origin)}</> : <span className="muted">{t('analysis.none')}</span>}
      </p>
      <p className="stat" data-testid="analysis-beats" data-count={beats ? beats.beats.length : undefined}>
        <strong>{t('analysis.beats')}:</strong>{' '}
        {beats ? (
          <>
            <bdi>{beats.beats.length}</bdi>
            {beats.bpm !== null && <span> · {t('analysis.bpm')}: <bdi data-testid="analysis-bpm">{beats.bpm.toFixed(1)}</bdi></span>}
            {conf !== null && <span> · {t('analysis.confidence')}: <bdi data-testid="analysis-confidence">{Math.round(conf * 100)}%</bdi></span>}
            {origin(beats.origin)}
          </>
        ) : <span className="muted">{t('analysis.none')}</span>}
      </p>
      {conf !== null && conf < 0.3 && <p className="muted danger" role="alert" data-testid="analysis-low-confidence">{t('analysis.lowConfidence')}</p>}
      <div className="row">
        <button className="ghost" disabled={busy !== null || !hasVideo} title={hasVideo ? undefined : t('analysis.noVideo')} onClick={() => void run('scenes')} data-testid="analysis-run-scenes">{busy === 'scenes' ? t('analysis.running') : t('analysis.runScenes')}</button>
        <button className="ghost" disabled={busy !== null || !hasAudio} title={hasAudio ? undefined : t('analysis.noAudio')} onClick={() => void run('beats')} data-testid="analysis-run-beats">{busy === 'beats' ? t('analysis.running') : t('analysis.runBeats')}</button>
      </div>
      {!hasVideo && <p className="muted">{t('analysis.noVideo')}</p>}
      {!hasAudio && <p className="muted">{t('analysis.noAudio')}</p>}
      {err && <p className="muted danger" role="alert" data-testid="analysis-error">{err}</p>}
      <button className="ghost" disabled={cutsInClip === 0} title={cutsInClip === 0 ? t('analysis.splitNone') : undefined}
        onClick={() => void editor.commit([{ op: 'split_at_scenes', args: { clipId: clip.id } }], 'Split at scenes')} data-testid="analysis-split-scenes">{t('analysis.split')}</button>
      {!inside && <p className="muted">{t('analysis.outside')}</p>}
      <div className="row">
        <button className="ghost" disabled={!inside} onClick={() => add('beats')} data-testid="analysis-add-beat">{t('analysis.addBeat')}</button>
        <button className="ghost" disabled={!inside || noneToRemove('beats')} onClick={() => remove('beats')} data-testid="analysis-remove-beat">{t('analysis.removeBeat')}</button>
      </div>
      <div className="row">
        <button className="ghost" disabled={!inside} onClick={() => add('scenes')} data-testid="analysis-add-cut">{t('analysis.addCut')}</button>
        <button className="ghost" disabled={!inside || noneToRemove('scenes')} onClick={() => remove('scenes')} data-testid="analysis-remove-cut">{t('analysis.removeCut')}</button>
      </div>
    </div>
  );
}
