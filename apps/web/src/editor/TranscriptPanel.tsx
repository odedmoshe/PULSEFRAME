import { useEffect, useMemo, useState } from 'react';
import { decodeTextFile, type DecodedText } from '../textDecode.ts';
import * as T from '@pulseframe/time';
import type { Clip, ProjectDocument } from '@pulseframe/core';
import { sourceAt, sourceEnd, timelineAt, CAPTION_PRESETS, FONT_CATALOG } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { api, type SilenceResult } from '../api.ts';
import { useEditorState, type Editor } from './store.ts';

type MediaClip = Extract<Clip, { type: 'media' }>;
type Transcript = ProjectDocument['transcripts'][string];
type Segment = Transcript['segments'][number];

const mainTracks = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]?.tracks ?? [];
const mediaClipsOf = (doc: ProjectDocument, assetId: string): MediaClip[] =>
  mainTracks(doc).flatMap((tr) => (tr.kind === 'video' || tr.kind === 'audio' ? tr.clips : [])).filter((c): c is MediaClip => c.type === 'media' && c.assetId === assetId && !c.reverse);
const half = (d: T.RationalTime) => T.rt(BigInt(d.value), d.timescale * 2);
/** Timeline time of a source time, or null when no clip of the asset shows it. */
function sourceToTimeline(clips: MediaClip[], s: T.RationalTime): T.RationalTime | null {
  for (const c of clips) if (T.lte(c.sourceIn, s) && T.lt(s, sourceEnd(c))) return timelineAt(c, s);
  return null;
}
/** Subtitle and transcript files do not declare their encoding; older Hebrew files are often Windows-1255 or UTF-16. */
const readText = async (file: File) => decodeTextFile(new Uint8Array(await file.arrayBuffer()));
/** Says so when the encoding of an imported text file had to be guessed, so a wrong guess is not silent. */
function EncodingNote({ info }: { info: DecodedText | null }) {
  const { t } = useEditorState();
  if (!info?.guessed) return null;
  return <p className="muted" role="status" data-testid="encoding-note" data-encoding={info.encoding}>{t('import.encodingGuessed')} <bdi>{info.encoding}</bdi></p>;
}

export function TranscriptPanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const sel = editor.selected;
  const selAsset = sel?.clip.type === 'media' ? sel.clip.assetId : null;
  const assetId = selAsset ?? (doc ? Object.keys(doc.transcripts)[0] ?? null : null);
  const transcript = doc && assetId ? doc.transcripts[assetId] : undefined;
  const [lang, setLang] = useState<'he' | 'en'>('he');
  const [decoded, setDecoded] = useState<DecodedText | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; approx: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { setAnchor(null); setFocus(null); setFailure(null); setEditing(null); }, [assetId]);

  const clips = useMemo(() => (doc && assetId ? mediaClipsOf(doc, assetId) : []), [doc, assetId]);
  const flat = useMemo(() => (transcript ? transcript.segments.flatMap((s) => s.words.map((w) => ({ w, s }))) : []), [transcript]);
  const rate = editor.rate;

  if (!doc) return null;
  const viewed = state.viewVariantId ? doc.variants[state.viewVariantId] : undefined;
  if (!transcript) {
    return (
      <div className="transcript" data-testid="transcript-panel" data-state="empty">
        <p className="muted" data-testid="transcript-empty">{t('transcript.empty')}</p>
        <div className="fields">
          <label>{t('transcript.language')}
            <select value={lang} onChange={(e) => setLang(e.target.value === 'en' ? 'en' : 'he')} data-testid="transcript-language">
              <option value="he">{t('lang.he')}</option><option value="en">{t('lang.en')}</option>
            </select>
          </label>
          <label className="ghost file">
            {t('transcript.import')}
            <input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" disabled={!selAsset} data-testid="transcript-import"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && selAsset) void readText(f).then((d) => { setDecoded(d); return editor.commit([{ op: 'import_transcript', args: { assetId: selAsset, language: lang, content: d.text } }], 'Import transcript'); }).catch(editor.fail); }} />
          </label>
          <EncodingNote info={decoded} />
          {!selAsset && <p className="muted">{t('transcript.selectClip')}</p>}
        </div>
      </div>
    );
  }

  // Playhead → source time of this asset.
  const ph = editor.playhead;
  const playing = clips.find((c) => T.lte(c.start, ph) && T.lt(ph, T.add(c.start, c.duration)));
  const srcNow = playing ? sourceAt(playing, ph) : null;
  const idx = (id: string | null) => (id ? flat.findIndex((x) => x.w.id === id) : -1);
  const a = idx(anchor), f = idx(focus);
  const lo = a < 0 || f < 0 ? -1 : Math.min(a, f), hi = a < 0 || f < 0 ? -1 : Math.max(a, f);
  const pickedApprox = lo >= 0 && flat.slice(lo, hi + 1).some((x) => x.s.timing !== 'word');

  const cut = async (allowApproximate: boolean) => {
    if (lo < 0 || !assetId) return;
    setFailure(null);
    const r = await editor.commit([{ op: 'delete_transcript_range', args: { assetId, fromWordId: flat[lo]!.w.id, toWordId: flat[hi]!.w.id, ...(allowApproximate ? { allowApproximate: true } : {}) } }], 'Delete words');
    if (r) { setAnchor(null); setFocus(null); return; }
    // Editor.commit reports failures as text only; the server refuses estimated timing exactly when a picked word's phrase is not word-timed.
    setFailure({ message: editor.getState().error ?? t('transcript.cutFailed'), approx: pickedApprox && !allowApproximate });
  };

  const clickWord = (id: string, start: T.RationalTime, shift: boolean) => {
    if (shift && anchor) setFocus(id);
    else { setAnchor(id); setFocus(id); }
    const at = sourceToTimeline(clips, start);
    if (at) editor.seek(T.nearestFrameIndex(at, rate));
  };

  return (
    <div className="transcript" data-testid="transcript-panel" data-state="ready" data-asset-id={assetId ?? undefined}>
      <div className="row">
        <button className="ghost danger" disabled={lo < 0} onClick={() => void cut(false)} data-testid="transcript-delete">{t('transcript.delete')}</button>
        {failure?.approx && <button className="ghost" onClick={() => void cut(true)} data-testid="transcript-cut-anyway">{t('transcript.cutAnyway')}</button>}
      </div>
      {failure && <p className="muted danger" role="alert" data-testid="transcript-error">{failure.message}</p>}
      <ol className="phrases">
        {transcript.segments.map((s) => (
          <Phrase key={s.id} seg={s} editing={editing === s.id} onEdit={(on) => setEditing(on ? s.id : null)}
            formatName={viewed?.name} formatText={viewed?.phraseText?.[s.id]}
            onResetFormat={() => void editor.commit([{ op: 'set_variant_phrase_text', args: { variantId: viewed!.id, assetId: assetId!, segmentId: s.id, text: null } }], 'Phrase wording (format)')}
            onSave={async (text) => {
              // While a format is viewed, a wording change belongs to that format only; the transcript itself is corrected in the master view.
              const r = await editor.commit(viewed ? [{ op: 'set_variant_phrase_text', args: { variantId: viewed.id, assetId: assetId!, segmentId: s.id, text } }] : [{ op: 'correct_transcript', args: { assetId: assetId!, segmentId: s.id, text } }], viewed ? 'Phrase wording (format)' : 'Correct transcript');
              if (r) setEditing(null);
            }}
            renderWord={(w) => {
              const mid = T.add(w.start, half(w.duration));
              const onTimeline = sourceToTimeline(clips, mid) !== null;
              const now = srcNow !== null && T.lte(w.start, srcNow) && T.lt(srcNow, T.add(w.start, w.duration));
              const i = flat.findIndex((x) => x.w.id === w.id);
              const selected = lo >= 0 && i >= lo && i <= hi;
              return (
                <button key={w.id} type="button" className={`word${onTimeline ? '' : ' cut'}${now ? ' now' : ''}${selected ? ' sel' : ''}`} data-testid="transcript-word" data-word-id={w.id}
                  aria-pressed={selected} aria-current={now ? 'true' : undefined} onClick={(e) => clickWord(w.id, w.start, e.shiftKey)}>{w.text}</button>
              );
            }} />
        ))}
      </ol>
    </div>
  );
}

function Phrase({ seg, editing, onEdit, onSave, renderWord, formatName, formatText, onResetFormat }: { seg: Segment; editing: boolean; onEdit: (on: boolean) => void; onSave: (text: string) => Promise<void>; renderWord: (w: Segment['words'][number]) => React.ReactNode; formatName?: string; formatText?: string; onResetFormat: () => void }) {
  const { t } = useEditorState();
  const shown = formatText ?? seg.text; // what this view shows: the format's wording when it has one
  const [text, setText] = useState(shown);
  useEffect(() => { if (editing) setText(shown); }, [editing, shown]);
  return (
    <li className="phrase" data-segment-id={seg.id} data-format-worded={formatText !== undefined ? 'true' : undefined} onDoubleClick={() => !editing && onEdit(true)}>
      {editing ? (
        <div className="fields">
          {formatName && <p className="muted" data-testid="transcript-format-note">{t('transcript.formatOnly')} <bdi>{formatName}</bdi></p>}
          <textarea dir="auto" rows={3} value={text} autoFocus aria-label={t('transcript.edit')} data-testid="transcript-textarea" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onEdit(false); }} />
          <div className="row">
            <button className="primary" disabled={!text.trim() || text === shown} onClick={() => void onSave(text.trim())} data-testid="transcript-save">{t('transcript.save')}</button>
            <button className="ghost" onClick={() => onEdit(false)}>{t('transcript.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="phrase-text" dir="auto">
            {formatText !== undefined ? <span className="block" data-testid="transcript-format-text">{formatText}</span> : seg.words.length === 0 ? <span className="block">{seg.text}</span> : seg.words.flatMap((w, i) => [i > 0 ? ' ' : null, renderWord(w)])}
          </div>
          {formatText !== undefined && (
            <span className="transform-scope" data-testid="transcript-format-scope" data-scope="format">
              <span className="badge">{t('transcript.formatWorded')}</span>
              <button type="button" className="ghost small" data-testid="transcript-format-reset" onClick={onResetFormat} aria-label={`${t('transcript.formatReset')}: ${seg.text.slice(0, 30)}`}>{t('transcript.formatReset')}</button>
            </span>
          )}
          {formatText === undefined && seg.timing !== 'word' && <span className="badge" data-testid="transcript-timing" data-timing={seg.timing}>{t(seg.timing === 'approximate' ? 'transcript.approx' : 'transcript.segmentOnly')}</span>}
          <button type="button" className="ghost small" onClick={() => onEdit(true)} data-testid="transcript-edit" aria-label={`${t('transcript.edit')}: ${shown.slice(0, 30)}`}>✎</button>
        </>
      )}
    </li>
  );
}

export function SilencePanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const sel = editor.selected;
  const selAsset = sel?.clip.type === 'media' ? sel.clip.assetId : null;
  const assetId = selAsset ?? (doc ? mainTracks(doc).flatMap((tr) => (tr.kind === 'video' || tr.kind === 'audio' ? tr.clips : []))
    .find((c): c is MediaClip => c.type === 'media' && !!doc.assets[c.assetId]?.audio)?.assetId ?? null : null);
  const [minS, setMinS] = useState('0.5');
  const [keepS, setKeepS] = useState('0.1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [res, setRes] = useState<SilenceResult | null>(null);
  useEffect(() => { setRes(null); setErr(null); setStale(false); }, [assetId]);
  if (!doc || !assetId) return null;
  const rate = editor.rate;
  const find = async () => {
    setBusy(true); setErr(null); setStale(false); setRes(null);
    try { setRes(await api.findSilences(doc.id, { assetId, minSeconds: Number(minS), keepSeconds: Number(keepS) })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!res || res.candidates.length === 0) return;
    if (editor.getState().revision !== res.revision) { setRes(null); setStale(true); return; }
    const r = await editor.commit(res.ops, 'Remove silences');
    if (r) setRes(null);
  };
  const valid = Number(minS) > 0 && minS !== '' && Number(keepS) >= 0 && keepS !== '';
  return (
    <div className="fields silences" data-testid="silence-panel" data-asset-id={assetId}>
      <p className="muted">{t('silence.hint')}</p>
      <label>{t('silence.min')}
        <input type="number" min={0.05} step={0.05} value={minS} onChange={(e) => setMinS(e.target.value)} data-testid="silence-min" />
      </label>
      <label>{t('silence.keep')}
        <input type="number" min={0} step={0.05} value={keepS} onChange={(e) => setKeepS(e.target.value)} data-testid="silence-keep" />
      </label>
      <button className="ghost" disabled={busy || !valid} onClick={() => void find()} data-testid="silence-find">{busy ? t('silence.finding') : t('silence.find')}</button>
      {err && <p className="muted danger" role="alert" data-testid="silence-error">{err}</p>}
      {stale && <p className="muted danger" role="alert" data-testid="silence-stale">{t('silence.stale')}</p>}
      {res && (
        <>
          <p role="status" data-testid="silence-summary" data-count={res.candidates.length}>
            {res.candidates.length === 0 ? t('silence.none') : `${t('silence.count')}: `}
            {res.candidates.length > 0 && <bdi>{res.candidates.length} · {res.removableSeconds.toFixed(2)}s</bdi>}
          </p>
          <ol className="silence-list">
            {res.candidates.map((c, i) => {
              const fr = Math.max(0, Math.round((c.startSeconds * rate.num) / rate.den));
              const tc = T.toTimecode(T.frameTime(fr, rate), rate);
              return (
                <li key={i}>
                  <button type="button" className="ghost small" dir="ltr" onClick={() => editor.seek(fr)} data-testid="silence-item">{tc} · {c.seconds.toFixed(2)}s</button>
                </li>
              );
            })}
          </ol>
          <button className="primary" disabled={res.candidates.length === 0} onClick={() => void apply()} data-testid="silence-apply">{t('silence.apply')}</button>
        </>
      )}
    </div>
  );
}

function ColorField({ label, value, onCommit, testid }: { label: string; value: string; onCommit: (v: string) => void; testid: string }) {
  const [v, setV] = useState(value.slice(0, 7));
  useEffect(() => setV(value.slice(0, 7)), [value]);
  return (
    <label>{label}
      <input type="color" value={v} data-testid={testid} onChange={(e) => setV(e.target.value.toUpperCase())} onBlur={() => v.toUpperCase() !== value.slice(0, 7).toUpperCase() && onCommit(v)} />
    </label>
  );
}

export function CaptionControls({ editor }: { editor: Editor }) {
  const { state, t } = useEditorState();
  const { doc } = state;
  const [decoded, setDecoded] = useState<DecodedText | null>(null);
  if (!doc) return null;
  const track = mainTracks(doc).find((x) => x.kind === 'caption' && x.caption);
  const hasTranscript = Object.keys(doc.transcripts).length > 0;
  const master = track?.caption?.style;
  // While a format is viewed, size and position are edited for that format only; everything else stays a master setting.
  const variantId = state.viewVariantId;
  const formatStyle = variantId ? doc.variants[variantId]?.captionStyle : undefined;
  const style = master && formatStyle ? { ...master, ...formatStyle } : master;
  const setStyle = (patch: Record<string, unknown>) => track && void editor.commit([{ op: 'set_caption_style', args: { trackId: track.id, style: patch } }], 'Caption style');
  const setScoped = (patch: Record<string, unknown>) => (variantId ? void editor.commit([{ op: 'update_variant', args: { variantId, captionStyle: patch } }], 'Caption style (format)') : setStyle(patch));
  const base = `/api/v1/projects/${doc.id}/captions`;
  return (
    <div className="fields" data-testid="caption-controls">
      {!track || !style ? (
        <button className="ghost" onClick={() => void editor.commit([{ op: 'add_caption_track', args: { mode: hasTranscript ? 'transcript' : 'manual' } }], 'Add caption track')} data-testid="caption-add">{t('caption.add')}</button>
      ) : (
        <>
          {track.caption?.mode === 'manual' && (
            <button type="button" className="ghost" data-testid="cue-add" onClick={() => void (async () => {
              // a two-second cue at the playhead (shorter if another cue follows sooner); it is selected so its text can be typed in the Inspector
              const rate = editor.rate, at = editor.frame;
              const next = track.clips.map((c) => T.frameIndexAt(c.start, rate)).filter((x) => x > at).sort((a, b) => a - b)[0];
              const frames = Math.max(1, Math.min(Math.round((2 * rate.num) / rate.den), next === undefined ? Infinity : next - at));
              const r = await editor.commit([{ op: 'add_cue', args: { trackId: track.id, start: T.frameTime(at, rate), duration: T.frameTime(frames, rate), text: t('cue.new') } }], 'Add caption');
              const id = r?.results[0]?.output?.clipId;
              if (typeof id === 'string') editor.select(id);
            })()}>{t('cue.add')}</button>
          )}
          <label>{t('caption.preset')}
            <select value={style.preset} onChange={(e) => setStyle({ preset: e.target.value })} data-testid="caption-preset">
              {CAPTION_PRESETS.map((p) => <option key={p} value={p}>{t(`caption.preset.${p}` as Key)}</option>)}
            </select>
          </label>
          <label>{t('font.family')}
            <select value={style.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })} data-testid="caption-font">
              {FONT_CATALOG.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}
            </select>
          </label>
          <label>{t('caption.position')}
            <select value={style.position} onChange={(e) => setScoped({ position: e.target.value })} data-testid="caption-position">
              {(['bottom', 'center', 'top'] as const).map((p) => <option key={p} value={p}>{t(`caption.pos.${p}` as Key)}</option>)}
            </select>
          </label>
          <label>{t('caption.size')}
            <input key={`${track.id}:${style.sizeFrac}`} type="range" min={0.02} max={0.12} step={0.005} defaultValue={Math.min(0.12, Math.max(0.02, style.sizeFrac))} data-testid="caption-size"
              onPointerUp={(e) => setScoped({ sizeFrac: Number(e.currentTarget.value) })} onKeyUp={(e) => setScoped({ sizeFrac: Number(e.currentTarget.value) })} />
          </label>
          {variantId && (
            <div className="transform-scope" data-testid="caption-scope" data-scope="format">
              <span className="muted">{t('caption.scopeFormat')}</span>
              <button className="ghost" disabled={!formatStyle} data-testid="caption-reset-format" onClick={() => void editor.commit([{ op: 'update_variant', args: { variantId, captionStyle: null } }], 'Reset format captions')}>{t('caption.resetFormat')}</button>
            </div>
          )}
          <ColorField label={t('caption.color')} value={style.color} testid="caption-color" onCommit={(v) => setStyle({ color: v })} />
          <ColorField label={t('caption.highlight')} value={style.highlightColor} testid="caption-highlight" onCommit={(v) => setStyle({ highlightColor: v })} />
          <div className="row">
            <a className="ghost" href={`${base}?format=srt&trackId=${encodeURIComponent(track.id)}`} download data-testid="captions-export-srt">{t('captions.export.srt')}</a>
            <a className="ghost" href={`${base}?format=vtt&trackId=${encodeURIComponent(track.id)}`} download data-testid="captions-export-vtt">{t('captions.export.vtt')}</a>
          </div>
        </>
      )}
      <label className="ghost file">
        {t('captions.import')}
        <input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" data-testid="captions-import"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readText(f).then((d) => { setDecoded(d); return editor.commit([{ op: 'import_captions', args: { content: d.text, ...(track?.caption?.mode === 'manual' ? { trackId: track.id } : {}) } }], 'Import captions'); }).catch(editor.fail); }} />
      </label>
      <EncodingNote info={decoded} />
    </div>
  );
}
