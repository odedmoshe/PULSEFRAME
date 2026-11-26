/**
 * «שמירת התמונה»: one source frame of one file saved at the stored file's own pixels, whole or cut to a paper shape. Role dialog
 * (ds Dialog: focus trapped, Escape closes and the focus goes back to what opened it, the «שמירת התמונה» button). The crop frame
 * moves with the arrows (1 % of the picture, Shift 10 %), resizes with + and − (the shape kept) and by a pointer drag. The
 * pixels-per-inch lines are a rule of thumb from the pixel count only; the picture is the browser's reading of the stored file.
 * The save is the owner's own session (the server refuses any other credential).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ORIENTATIONS, PAPER_IDS, PAPERS, type Asset, type Orientation, type PaperId, type SharpAnswer, type StillOutput } from '@pulseframe/core';
import { dictionaries, jobStageLabel, translateRefusal } from '@pulseframe/i18n';
import { api, ApiFailure } from '../../api.ts';
import { Dialog } from '../../ds/Dialog.tsx';
import { refusalText } from '../TrackingPanel.tsx';
import { useEditorState } from '../store.ts';
import { StillCanvas } from './StillCanvas.tsx';
import { coverT } from './cover.strings.ts';
import { COVER_TESTIDS as ID } from './cover.testids.ts';
import {
  cropBox, cropOf, downloadName, draggedCrop, frameTimecode, movedCrop, OPEN_JOB, orientationFor, pictureSize, POLL_MS, ppiRows, resizedCrop, resizeSign, stillBody, stillNotes,
  tooLargeSentence, type Selection,
} from './cover.logic.ts';

type Phase = { kind: 'ready' } | { kind: 'running'; jobId: string; stage: string | null; cancelling: boolean } | { kind: 'done'; jobId: string; out: StillOutput | null } | { kind: 'failed'; text: string };

export function StillDialog({ asset, frame, answer, onClose }: { asset: Asset; frame: number; answer: SharpAnswer | null; onClose: () => void }) {
  const { state } = useEditorState();
  const lang = state.lang;
  const t = coverT(lang);
  const doc = state.doc!;
  const size = pictureSize(asset)!;
  const [sel, setSel] = useState<Selection>({ paper: null, orientation: orientationFor(size) });
  const [crop, setCrop] = useState(() => cropOf({ paper: null, orientation: 'landscape' }, size));
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [cropErr, setCropErr] = useState<string | null>(null);
  const pic = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: typeof crop; id: number } | null>(null);
  const tooLarge = tooLargeSentence(size);
  const closeLabel = (dictionaries[lang] as Record<string, string>)['projects.close'] ?? t('close');

  const choose = (next: Selection) => {
    setSel(next); setCropErr(null);
    try { setCrop(cropOf(next, size)); } catch (e) { setCropErr(refusalText(lang, new ApiFailure(0, (e as { code?: string }).code ?? 'failed', (e as Error).message))); }
  };
  const guard = <T,>(f: () => T, fallback: T): T => { try { setCropErr(null); return f(); } catch (e) { setCropErr(translateRefusal(lang, (e as Error).message) ?? (e as Error).message); return fallback; } };
  const onCropKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const sign = resizeSign(e.key);
    if (sign !== null) { e.preventDefault(); setCrop((c) => guard(() => resizedCrop(c, sign, size, sel), c)); return; }
    const next = guard(() => movedCrop(crop, e.key, e.shiftKey, size, sel), null);
    if (next) { e.preventDefault(); setCrop(next); }
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (sel.paper === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: crop, id: e.pointerId };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current, box = pic.current?.getBoundingClientRect();
    if (!d || d.id !== e.pointerId || !box || box.width === 0) return;
    const k = size.width / box.width;
    setCrop(guard(() => draggedCrop(d.start, (e.clientX - d.x) * k, (e.clientY - d.y) * k, size, sel), d.start));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  const rows = useMemo(() => { try { return { rows: ppiRows(crop, sel.orientation), error: null }; } catch (e) { return { rows: [], error: translateRefusal(lang, (e as Error).message) ?? (e as Error).message }; } }, [crop, sel.orientation, lang]);
  const notes = stillNotes(asset, size, answer);

  // follow the saving job
  const jobId = phase.kind === 'running' ? phase.jobId : null;
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const id = setInterval(async () => {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        if (OPEN_JOB.has(j.status)) { setPhase((p) => (p.kind === 'running' ? { ...p, stage: j.stage ?? null, cancelling: j.status === 'cancel-requested' } : p)); return; }
        stop = true; clearInterval(id);
        if (j.status === 'succeeded') setPhase({ kind: 'done', jobId, out: ((j.output as { still?: StillOutput } | null)?.still) ?? null });
        else if (j.status === 'canceled') setPhase({ kind: 'failed', text: t('saveStopped') });
        else setPhase({ kind: 'failed', text: refusalText(lang, new ApiFailure(0, j.error?.code ?? 'failed', j.error?.message ?? j.status)) });
      } catch (e) { if (!stop) { stop = true; clearInterval(id); setPhase({ kind: 'failed', text: refusalText(lang, e) }); } }
    }, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setPhase({ kind: 'running', jobId: '', stage: null, cancelling: false });
    try {
      const r = await api.exportStill(doc.id, format, stillBody(asset.id, frame, sel, crop));
      setPhase({ kind: 'running', jobId: r.jobId, stage: null, cancelling: false });
    } catch (e) { setPhase({ kind: 'failed', text: e instanceof ApiFailure && e.code === 'owner_required' ? t('ownerOnly') : refusalText(lang, e) }); }
  };
  const stop = () => { if (phase.kind === 'running' && phase.jobId) api.cancelJob(phase.jobId).catch((e) => setPhase({ kind: 'failed', text: refusalText(lang, e) })); };

  const busy = phase.kind === 'running';
  const box = cropBox(crop, size);
  const name = `${asset.name} · ${frameTimecode(asset, frame)}`;
  return (
    <Dialog open onClose={onClose} title={t('save')} size="lg" closeLabel={closeLabel} testId={ID.dialog} className="cover-dialog"
      footer={<button type="button" className="ghost" data-testid={ID.close} onClick={onClose}>{closeLabel}</button>}>
      <div className="cover-dlg">
        <p className="muted"><bdi dir="auto">{name}</bdi> · <bdi dir="auto">{t('wholeSize', { w: size.width, h: size.height })}</bdi></p>
        <div className="cover-pic" ref={pic} dir="ltr" data-testid={ID.picture} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          <StillCanvas asset={asset} frame={frame} label={name} />
          {sel.paper !== null && (
            <div className="cover-crop" role="group" tabIndex={0} aria-label={t('cropLabel')} aria-describedby="cover-crop-hint" aria-roledescription={t('cropLabel')} data-testid={ID.crop}
              data-x={crop.x} data-y={crop.y} data-w={crop.w} data-h={crop.h}
              style={{ insetInlineStart: `${box.left}%`, insetBlockStart: `${box.top}%`, inlineSize: `${box.width}%`, blockSize: `${box.height}%` }}
              onKeyDown={onCropKey} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          )}
        </div>
        {sel.paper !== null && (
          <>
            <p className="muted" id="cover-crop-hint">{t('cropHint')}</p>
            <p role="status" aria-live="polite"><bdi dir="auto">{t('cropValues', { w: crop.w, h: crop.h, x: crop.x, y: crop.y })}</bdi></p>
            <div className="row">
              <button type="button" className="ghost" aria-label={t('cropShrink')} onClick={() => setCrop((c) => guard(() => resizedCrop(c, -1, size, sel), c))}>−</button>
              <button type="button" className="ghost" aria-label={t('cropGrow')} onClick={() => setCrop((c) => guard(() => resizedCrop(c, 1, size, sel), c))}>+</button>
            </div>
          </>
        )}
        {cropErr && <p className="muted danger" role="alert">{cropErr}</p>}
        <fieldset className="cover-set"><legend>{t('paper')}</legend>
          <label><input type="radio" name="cover-paper" data-testid={ID.paperWhole} checked={sel.paper === null} onChange={() => choose({ ...sel, paper: null })} /> {t('whole')}</label>
          {PAPER_IDS.map((p: PaperId) => (
            <label key={p}><input type="radio" name="cover-paper" data-testid={p === '10x15' ? ID.paper10x15 : p === '13x18' ? ID.paper13x18 : ID.paperA4} checked={sel.paper === p} onChange={() => choose({ ...sel, paper: p })} /> {t(`paper.${p}`)}</label>
          ))}
        </fieldset>
        <fieldset className="cover-set" disabled={sel.paper === null}><legend>{t('orientation')}</legend>
          {ORIENTATIONS.map((o: Orientation) => (
            <label key={o}><input type="radio" name="cover-orient" data-testid={o === 'portrait' ? ID.portrait : ID.landscape} checked={sel.orientation === o} onChange={() => choose({ ...sel, orientation: o })} /> {t(o)}</label>
          ))}
        </fieldset>
        <div className="cover-ppi"><strong>{t('ppiHead')}</strong>
          {rows.error ? <p className="muted">{rows.error}</p> : (
            <ul>{rows.rows.map((r) => (
              <li key={r.paper} data-testid={ID.ppi} data-paper={r.paper} data-ppi={r.ppi} data-tier={r.tier}>
                <bdi dir="auto">{t('ppi', { ppi: r.ppi, paper: PAPERS[r.paper][lang === 'he' ? 'he' : 'en'] })}</bdi> · {t(`tier.${r.tier}`)}
              </li>))}
            </ul>
          )}
          <p className="muted" data-testid={ID.rule}>{t('rule')}</p>
        </div>
        <fieldset className="cover-set"><legend>{t('format')}</legend>
          <label><input type="radio" name="cover-format" data-testid={ID.png} checked={format === 'png'} onChange={() => setFormat('png')} /> {t('png')}</label>
          <label><input type="radio" name="cover-format" data-testid={ID.jpeg} checked={format === 'jpeg'} onChange={() => setFormat('jpeg')} /> {t('jpeg')}</label>
        </fieldset>
        <ul className="cover-notes">
          {notes.map((n) => (
            <li key={n.key} className="muted" data-testid={ID.note} data-note={n.key}>
              {n.key === 'conformed' ? t('conformed', { reasons: String(n.vars!.reasons).split('|').map((r) => t(`reason.${r}`)).join(', ') }) : t(n.key, n.vars)}
            </li>))}
        </ul>
        {tooLarge && <p className="muted danger" role="alert">{translateRefusal(lang, tooLarge) ?? tooLarge}</p>}
        <div className="row">
          <button type="button" className="primary" data-testid={ID.run} disabled={busy || !!tooLarge || !!cropErr || !!rows.error} onClick={() => void run()}>{t('saveRun')}</button>
          {busy && <button type="button" className="ghost danger" disabled={!phase.jobId || (phase.kind === 'running' && phase.cancelling)} onClick={stop}>{t('stop')}</button>}
        </div>
        <p className={`cover-job${phase.kind === 'failed' ? ' danger' : ''}`} role={phase.kind === 'failed' ? 'alert' : 'status'} aria-live="polite" data-testid={ID.job} data-state={phase.kind}>
          {phase.kind === 'running' ? <>{t('saving')} <bdi>{jobStageLabel(phase.stage, lang)}</bdi></> : phase.kind === 'done' ? (phase.out ? t('saved', { w: phase.out.width, h: phase.out.height }) : t('saved', { w: crop.w, h: crop.h })) : phase.kind === 'failed' ? phase.text : ''}
        </p>
        {phase.kind === 'done' && (
          <a className="primary cover-download" data-testid={ID.download} href={`/api/v1/jobs/${phase.jobId}/output`} download={phase.out ? downloadName(phase.out) : ''}>{t('download')}</a>
        )}
      </div>
    </Dialog>
  );
}
