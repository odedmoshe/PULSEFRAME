/**
 * The run sheet of an AI tool (ADR-0017): what it reads (the selected clip, or a library file with an in/out frame range), its
 * settings, the server's estimate with its basis (frames, chunks, scratch, download, a measured time or «זמן: לא נמדד עדיין»),
 * where the result goes (library, in the clip, a new track) and the long-run confirmation when the estimate asks for one.
 * Nothing is guessed here: the estimate is the server's, and the run is refused or admitted by the server.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { findClip } from '@pulseframe/core';
import { dictionaries, translateRefusal } from '@pulseframe/i18n';
import { ApiFailure } from '../api.ts';
import { aiApi, type ApplyMode, type CapabilityEstimate, type CapInfo, type CapInput, type RunSource } from './api.ts';
import { assetsFor, clipFor, framesOfAsset, rateOfAsset, runSourceOf, type AiTab, type SourceChoice } from './aiTools.recheck.ts';
import type { AI_STRINGS } from './aiTools.strings.ts';
import { useEditorState } from './store.ts';

type S = (typeof AI_STRINGS)['he' | 'en'];
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'mask', 'transcript']);
/** Inputs the sheet sets itself (the source, the caption track, the base format) rather than as plain settings. */
const SHEET_OWNED = new Set(['captionTrackId', 'baseVariantId', 'variantId', 'name']);
const bytesText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`);

export function AiRunSheet({ cap, tab, S, onStarted, onRefused }: { cap: CapInfo; tab: AiTab; S: S; onStarted: (jobId: string, read: { sourceAssetId: string | null; clipId: string | null }) => void; onRefused: (message: string) => void }) {
  const { editor, state } = useEditorState();
  const { doc, lang } = state;
  const uid = useId();
  const selected = doc ? clipFor(doc, state.selection[0], tab) : null;
  const files = useMemo(() => (doc ? assetsFor(doc, tab) : []), [doc, tab]);
  const captionTracks = useMemo(() => (doc && tab === 'captions' ? (doc.sequences[doc.mainSequenceId]?.tracks ?? []).filter((t) => t.kind === 'caption' && t.caption?.mode === 'manual' && t.clips.length > 0) : []), [doc, tab]);
  const [mode, setMode] = useState<'clip' | 'asset' | 'track'>(selected ? 'clip' : 'asset');
  const [assetId, setAssetId] = useState('');
  const [trackId, setTrackId] = useState('');
  const [inFrame, setIn] = useState('');
  const [outFrame, setOut] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>(() => Object.fromEntries((cap.inputs ?? []).filter((i) => !MEDIA_TYPES.has(i.type) && !SHEET_OWNED.has(i.name) && i.default !== undefined).map((i) => [i.name, i.default])));
  const [base, setBase] = useState('');
  const [apply, setApply] = useState<ApplyMode>('library');
  const [confirm, setConfirm] = useState(false);
  const [est, setEst] = useState<{ value: CapabilityEstimate | null; failed: string | null; busy: boolean }>({ value: null, failed: null, busy: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!selected && mode === 'clip') setMode('asset'); }, [selected?.id]);

  const asset = doc && assetId && Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : null;
  const total = doc && asset ? framesOfAsset(doc, asset) : 0;
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const choice: SourceChoice | null = mode === 'clip' && selected ? { kind: 'clip', clipId: selected.id } : mode === 'asset' && asset ? { kind: 'asset', assetId: asset.id, inFrame: num(inFrame), outFrame: num(outFrame) } : null;
  const source: RunSource | null = doc && choice ? runSourceOf(doc, choice) : null;
  const badRange = mode === 'asset' && !!asset && (inFrame !== '' || outFrame !== '') && !source;
  const isImage = tab === 'image';
  const imageInput = cap.inputs?.find((i) => i.type === 'image');
  const translating = cap.task === 'translate';
  const modes: ApplyMode[] = translating ? ['library'] : tab === 'sound' ? ['library', 'replace-clip'] : ['library', 'replace-clip', 'new-track'];
  const clipSource = !!source && 'clipId' in source;
  useEffect(() => { if (!clipSource && apply !== 'library') setApply('library'); }, [clipSource]);

  /** The request as the server gets it: a library picture also goes as the tool's picture parameter (the form every server version reads). */
  const request = (): { params: Record<string, unknown>; source?: RunSource } | null => {
    const p: Record<string, unknown> = { ...params };
    if (translating) {
      if (base) p.baseVariantId = base;
      if (mode === 'track') return trackId ? { params: { ...p, captionTrackId: trackId } } : null;
    }
    if (!source) return null;
    if (isImage && imageInput && 'assetId' in source && apply === 'library') return { params: { ...p, [imageInput.name]: source.assetId } };
    return { params: p, source };
  };
  const req = request();
  const key = JSON.stringify(req);
  useEffect(() => {
    if (!doc || !req) { setEst({ value: null, failed: null, busy: false }); return; }
    let live = true;
    setEst((e) => ({ ...e, busy: true }));
    const t = window.setTimeout(() => {
      aiApi.estimate(doc.id, cap.id, req).then((value) => { if (live) setEst({ value, failed: null, busy: false }); })
        .catch((e) => { if (live) setEst({ value: null, failed: e instanceof ApiFailure ? why(e) : String(e instanceof Error ? e.message : e), busy: false }); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [key, doc?.id, cap.id]);

  const why = (e: ApiFailure) => {
    const head = (dictionaries[lang] as Record<string, string>)[`error.code.${e.code}`];
    const detail = translateRefusal(lang, e.message) ?? e.message;
    return head ? `${head}: ${detail}` : detail;
  };
  const needsConfirm = !!est.value?.needsConfirm;
  const confirmMinutes = est.value?.seconds ? Math.max(1, Math.floor(est.value.seconds / 60)) : 10;
  const canRun = !!req && !badRange && (!needsConfirm || confirm) && !busy;
  const run = async () => {
    if (!req) return;
    setBusy(true);
    try {
      const jobId = await editor.runCapability(cap.id, req.params, { ...(req.source ? { source: req.source } : {}), ...(req.source ? { apply } : {}), ...(confirm && needsConfirm ? { confirmLongRun: true } : {}) });
      if (jobId) {
        const src = req.source;
        const clipAsset = src && 'clipId' in src ? (doc && findClip(doc, src.clipId)?.clip as { assetId?: string } | undefined)?.assetId ?? null : null;
        const imageParam = imageInput ? req.params[imageInput.name] : undefined;
        onStarted(jobId, { clipId: src && 'clipId' in src ? src.clipId : null, sourceAssetId: src ? ('assetId' in src ? src.assetId : clipAsset) : typeof imageParam === 'string' ? imageParam : null });
      }
    } catch (e) {
      onRefused(e instanceof ApiFailure ? why(e) : e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  if (!doc) return null;
  const rate = asset ? rateOfAsset(doc, asset) : doc.settings.frameRate;
  const rateText = `${Math.round((rate.num / rate.den) * 1000) / 1000} fps`;
  const settings = (cap.inputs ?? []).filter((i) => !MEDIA_TYPES.has(i.type) && !SHEET_OWNED.has(i.name));
  return (
    <section className="pf-ai-sheet" data-testid="ai-run-sheet" data-capability={cap.id} aria-labelledby={`${uid}-t`}>
      <h4 id={`${uid}-t`}>{S.runTitle(cap.title[lang])}</h4>
      <fieldset>
        <legend>{S.sourceLegend}</legend>
        <label className="pf-ai-choice">
          <input type="radio" name={`${uid}-src`} checked={mode === 'clip'} disabled={!selected} onChange={() => setMode('clip')} data-testid="ai-source-clip" />
          <span>{S.sourceClip}{selected && doc.assets[selected.assetId] ? <> · <bdi>{doc.assets[selected.assetId]!.name}</bdi></> : null}</span>
        </label>
        {!selected && <p className="muted" data-testid="ai-source-clip-none">{S.sourceClipNone}</p>}
        <label className="pf-ai-choice">
          <input type="radio" name={`${uid}-src`} checked={mode === 'asset'} onChange={() => setMode('asset')} data-testid="ai-source-library" />
          <span>{S.sourceLibrary}</span>
        </label>
        {mode === 'asset' && (files.length === 0 ? <p className="muted">{S.noFiles}</p> : (
          <div className="pf-ai-fields">
            <label>{S.sourceLibrary}
              <select value={assetId} onChange={(e) => { setAssetId(e.target.value); setIn(''); setOut(''); }} data-testid={isImage ? 'ai-input' : 'ai-source-asset'}>
                <option value="">{S.chooseFile}</option>
                {files.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {asset && asset.kind !== 'image' && !translating && (
              <>
                <p className="muted" data-testid="ai-source-frames">{S.framesOfFile(String(total), rateText)}</p>
                <div className="pf-ai-row">
                  <label>{S.inFrame}<input type="number" min={0} max={Math.max(0, total - 1)} step={1} inputMode="numeric" value={inFrame} placeholder="0" onChange={(e) => setIn(e.target.value)} data-testid="ai-source-in" /></label>
                  <label>{S.outFrame}<input type="number" min={1} max={total} step={1} inputMode="numeric" value={outFrame} placeholder={String(total)} onChange={(e) => setOut(e.target.value)} data-testid="ai-source-out" /></label>
                </div>
                {badRange && <p className="danger" role="alert" data-testid="ai-source-bad-range">{S.badRange}</p>}
              </>
            )}
          </div>
        ))}
        {translating && captionTracks.length > 0 && (
          <>
            <label className="pf-ai-choice">
              <input type="radio" name={`${uid}-src`} checked={mode === 'track'} onChange={() => setMode('track')} data-testid="ai-source-track" />
              <span>{(cap.inputs?.find((i) => i.name === 'captionTrackId')?.label ?? { he: 'רצועת כתוביות ידנית', en: 'Manual caption track' })[lang]}</span>
            </label>
            {mode === 'track' && (
              <select value={trackId} onChange={(e) => setTrackId(e.target.value)} aria-label={S.sourceLegend} data-testid="ai-source-track-select">
                <option value="">{S.chooseFile}</option>
                {captionTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </>
        )}
      </fieldset>
      {(settings.length > 0 || translating) && (
        <fieldset>
          <legend>{S.paramsLegend}</legend>
          {settings.map((i) => <Setting key={i.name} input={i} lang={lang} value={params[i.name]} onChange={(v) => setParams((p) => ({ ...p, [i.name]: v }))} />)}
          {translating && Object.keys(doc.variants).length > 0 && (
            <label>{(cap.inputs?.find((i) => i.name === 'baseVariantId')?.label ?? { he: 'פורמט בסיס', en: 'Base format' })[lang]}
              <select value={base} onChange={(e) => setBase(e.target.value)} data-testid="ai-base-variant">
                <option value="">—</option>
                {Object.values(doc.variants).filter((v) => !v.translation).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
        </fieldset>
      )}
      <div className="pf-ai-estimate" data-testid="ai-estimate" data-basis={est.value?.basis ?? 'none'} aria-live="polite">
        <h5>{S.estimateTitle}</h5>
        {est.busy && <p className="muted">{S.estimating}</p>}
        {est.failed && <p className="muted" data-testid="ai-estimate-failed">{S.estimateFailed} <bdi>{est.failed}</bdi></p>}
        {est.value && (
          <ul className="pf-ai-facts">
            {est.value.frames !== null && <li>{S.estFrames}: <bdi data-testid="ai-est-frames">{est.value.frames}</bdi>{est.value.chunks !== null ? <> · {S.estChunks}: <bdi>{est.value.chunks}</bdi></> : null}</li>}
            {est.value.scratchBytes > 0 && <li>{S.estScratch}: <bdi>{bytesText(est.value.scratchBytes)}</bdi></li>}
            {est.value.missingDownloadBytes > 0 && <li>{S.estDownload}: <bdi>{bytesText(est.value.missingDownloadBytes)}</bdi></li>}
          </ul>
        )}
        <p data-testid="ai-est-time">{est.value?.seconds !== null && est.value?.seconds !== undefined && est.value.basis === 'measured-profile' ? S.timeMeasured(S.seconds(est.value.seconds)) : S.timeNotMeasured}</p>
        {!!est.value?.blockers.length && (
          <div role="note" data-testid="ai-est-blockers">
            <p className="danger">{S.estBlockers}</p>
            <ul className="pf-ai-why">{est.value.blockers.map((b, i) => <li key={`${b.code}:${i}`}><bdi>{translateRefusal(lang, b.message) ?? b.message}</bdi></li>)}</ul>
          </div>
        )}
      </div>
      {modes.length > 1 && (
        <fieldset data-testid="ai-apply">
          <legend>{S.applyLegend}</legend>
          {modes.map((m) => (
            <label key={m} className="pf-ai-choice">
              <input type="radio" name={`${uid}-apply`} value={m} checked={apply === m} disabled={m !== 'library' && !clipSource} onChange={() => setApply(m)} data-testid={`ai-apply-${m}`} />
              <span>{m === 'library' ? S.applyLibrary : m === 'replace-clip' ? S.applyReplace : S.applyNewTrack}</span>
            </label>
          ))}
          <p className="muted">{clipSource ? (apply === 'replace-clip' ? S.applyReplaceHint : '') : S.applyNeedsClip}</p>
        </fieldset>
      )}
      {needsConfirm && (
        <label className="pf-ai-choice" data-testid="ai-confirm-long">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>{S.confirmLong(confirmMinutes)}</span>
        </label>
      )}
      <div className="pf-ai-row">
        <button type="button" className="primary" disabled={!canRun} onClick={() => void run()} data-testid="ai-run">{busy ? S.running : S.run2}</button>
      </div>
    </section>
  );
}

function Setting({ input: i, lang, value, onChange }: { input: CapInput; lang: 'he' | 'en'; value: unknown; onChange: (v: unknown) => void }) {
  const label = i.label?.[lang] ?? i.name;
  if (i.type === 'boolean') return <label className="pf-ai-choice"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} data-testid={`ai-param-${i.name}`} /><span>{label}</span></label>;
  if (i.allowed?.length) return <label>{label}<select value={String(value ?? i.default ?? i.allowed[0])} onChange={(e) => onChange(Number(e.target.value))} data-testid={`ai-param-${i.name}`}>{i.allowed.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>;
  if (i.type === 'enum' && i.options?.length) return <label>{label}<select value={String(value ?? i.default ?? i.options[0])} onChange={(e) => onChange(e.target.value)} data-testid={`ai-param-${i.name}`}>{i.options.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>;
  if (i.type === 'int' || i.type === 'float' || i.type === 'seed') return <label>{label}<input type="number" min={i.min} max={i.max} step={i.type === 'float' ? 'any' : 1} value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} data-testid={`ai-param-${i.name}`} /></label>;
  return <label>{label}<input type="text" dir="auto" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} data-testid={`ai-param-${i.name}`} /></label>;
}
