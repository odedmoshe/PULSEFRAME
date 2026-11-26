import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { focusIn } from '../ds/focus.ts';
import { takeSilenceFocus } from './silenceFocus.ts';
import { decodeTextFile, type DecodedText } from '../textDecode.ts';
import * as T from '@pulseframe/time';
import type { Clip, ProjectDocument } from '@pulseframe/core';
import { CAPTION_LOOKS, CAPTION_PRESETS, FONT_CATALOG } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { api, ApiFailure, type SilenceResult, type SpeechStatus } from '../api.ts';
import { IconRename } from './icons.tsx';
import { CaptionLooks } from './CaptionLooks.tsx';
import { EngineInstall } from './EngineInstall.tsx';
import { CAP_STRINGS } from './captions.strings.ts';
import { captionSource, showTranscriptOps, transcriptNotShown } from './captionSource.logic.ts';
import './captionsPanel.css';
import { useEditorState, type Editor } from './store.ts';
import { openItems, readingLimitFor, readReadingLimits, reviewRows, writeReadingLimit, type ReviewRow } from './aiTools.recheck.ts';
import { recordingAt, recordingToTimeline, skippedNotes, speechClipsOf, transcriptOfSelection } from './transcriptLineage.logic.ts';
import { PEARLS_UI_BUILT } from './pearls/PearlsList.tsx';
import { SavePearlFromWords } from './pearls/SavePearlFromWords.tsx';

type MediaClip = Extract<Clip, { type: 'media' }>;
type Transcript = ProjectDocument['transcripts'][string];
type Segment = Transcript['segments'][number];

const mainTracks = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]?.tracks ?? [];
const half = (d: T.RationalTime) => T.rt(BigInt(d.value), d.timescale * 2);
/** Subtitle and transcript files do not declare their encoding; older Hebrew files are often Windows-1255 or UTF-16. */
const readText = async (file: File) => decodeTextFile(new Uint8Array(await file.arrayBuffer()));
/** Says so when the encoding of an imported text file had to be guessed, so a wrong guess is not silent. */
function EncodingNote({ info }: { info: DecodedText | null }) {
  const { t } = useEditorState();
  if (!info?.guessed) return null;
  return <p className="muted" role="status" data-testid="encoding-note" data-encoding={info.encoding}>{t('import.encodingGuessed')} <bdi>{info.encoding}</bdi></p>;
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;
/**
 * Automatic recognition for one asset: the setup state as the server reports it, the owner's model download for the exact size
 * shown, and the recognition job with its stage and a cancel button. The transcript itself arrives as a normal project change.
 */
function AutoTranscribe({ assetId, language, overwrite, align }: { assetId: string; language: string; overwrite?: boolean; align?: boolean }) {
  const { editor, state, t } = useEditorState();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [job, setJob] = useState<{ id: string; kind: 'asr' | 'download'; stage: string | null } | null>(null);
  const [note, setNote] = useState<{ kind: 'done' | 'noSpeech' | 'failed'; detail?: string; code?: string } | null>(null);
  const refresh = () => api.speech().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { setNote(null); }, [assetId]);
  useEffect(() => {
    if (!job) return;
    let live = true;
    const tick = async () => {
      try {
        const j = (await api.job(job.id)) as { status: string; stage?: string | null; output?: { attached?: boolean }; error?: { message?: string } };
        if (!live) return;
        if (['succeeded', 'failed', 'canceled'].includes(j.status)) {
          setJob(null);
          if (job.kind === 'download') void refresh();
          if (j.status === 'failed') setNote({ kind: 'failed', detail: j.error?.message, code: (j.error as { code?: string } | undefined)?.code });
          else if (j.status === 'succeeded' && job.kind === 'asr') setNote({ kind: j.output?.attached ? 'done' : 'noSpeech' });
          return;
        }
        setJob((cur) => (cur && cur.id === job.id ? { ...cur, stage: j.stage ?? null } : cur));
      } catch { /* the next tick tries again */ }
      if (live) timer = window.setTimeout(tick, 1000);
    };
    let timer = window.setTimeout(tick, 500);
    return () => { live = false; window.clearTimeout(timer); };
  }, [job?.id]);
  if (!status || !state.doc) return null;
  const pid = state.doc.id;
  // a refusal when starting is worded here, by its code, like a failed job; anything else goes to the error bar as before
  const start = (kind: 'asr' | 'download', p: Promise<{ jobId: string }>) => { setNote(null); p.then((r) => setJob({ id: r.jobId, kind, stage: null })).catch((e) => (e instanceof ApiFailure ? setNote({ kind: 'failed', detail: e.message, code: e.code }) : editor.fail(e))); };
  const tr = status.transcription;
  const model = status.models.find((m) => m.kind === 'asr');
  const C = CAP_STRINGS[state.lang];
  const pill = job ? 'running' : tr.ready ? 'ready' : tr.reason === 'model_missing' && model ? 'prep' : 'off';
  return (
    <div className="asr pf-ds pf-asr" data-testid="asr" data-state={job ? job.kind : tr.ready ? 'ready' : tr.reason ?? 'unknown'}>
      <div className="pf-asr-head">
        <b>{C.engine}</b>
        <span className={`pf-asr-pill is-${pill}`}>{job ? t(job.kind === 'asr' ? 'asr.working' : 'asr.downloading') : pill === 'ready' ? C.ready : pill === 'prep' ? C.prep(gb(model!.missingDownloadBytes)) : C.off}</span>
      </div>
      {job ? (
        <p role="status" data-testid="asr-progress">
          <bdi className="muted">{job.stage ?? ''}</bdi>{' '}
          <button className="ghost" onClick={() => void api.cancelJob(job.id).catch(editor.fail)} data-testid="asr-cancel">{t('asr.cancel')}</button>
        </p>
      ) : tr.ready ? (
        <p>
          <button onClick={() => start('asr', api.transcribe(pid, assetId, { language, ...(align ? { mode: 'align' as const } : overwrite ? { overwrite: true } : {}) }))} data-testid={align ? 'asr-align' : 'asr-run'}>{t(align ? 'asr.align' : overwrite ? 'asr.again' : 'asr.run')}</button>{' '}
          <span className="muted">{tr.device === 'cuda' ? C.gpu : C.cpu}</span>
        </p>
      ) : tr.reason === 'model_missing' && model ? (
        <div data-testid="asr-model-missing">
          <p className="muted">{C.prepNote} <bdi className="muted">{model.title[state.lang === 'en' ? 'en' : 'he']}</bdi></p>
          <button onClick={() => start('download', api.downloadSpeechModel(pid, model.id, model.missingDownloadBytes))} data-testid="asr-download">{t('asr.download')} (<bdi>{gb(model.missingDownloadBytes)}</bdi>)</button>
        </div>
      ) : tr.reason === 'engine_not_working' ? (
        <div className="muted" data-testid="asr-unavailable">
          <p>{C.broken}</p>
          <details><summary>{C.brokenDetail}</summary><bdi>{tr.detail}</bdi></details>
          {status.engine.source === 'installed' && <EngineInstall broken onChanged={() => void refresh()} />}
        </div>
      ) : !overwrite && !align ? (
        <div className="muted" data-testid="asr-unavailable">
          <p>{C.notConfigured}</p>
          <EngineInstall onChanged={() => void refresh()} />
          <details><summary>{C.howTo}</summary><ol>{C.notConfiguredHow.map((x) => <li key={x}>{x}</li>)}</ol></details>
        </div>
      ) : null}
      {note && note.kind !== 'failed' && <p role="status" data-testid="asr-note" data-kind={note.kind}>{t(note.kind === 'done' ? (align ? 'asr.aligned' : 'asr.done') : 'asr.noSpeech')}</p>}
      {/* the server's raw error text is English and technical: the owner reads the sentence for its code, the raw text waits under «פרטים טכניים» */}
      {note?.kind === 'failed' && (
        <div role="status" data-testid="asr-note" data-kind="failed" data-code={note.code}>
          <p>{t('asr.failed')} {C.errors[note.code ?? ''] ?? C.errorOther}</p>
          {(note.detail || note.code) && <details data-testid="asr-error-details"><summary>{C.techDetails}</summary><bdi dir="ltr">{[note.code, note.detail].filter(Boolean).join(': ')}</bdi></details>}
        </div>
      )}
    </div>
  );
}

export function TranscriptPanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const sel = editor.selected;
  const selAsset = sel?.clip.type === 'media' ? sel.clip.assetId : null;
  // the selected clip's file's transcript, or that of the recording a time-preserving copy was made from (core transcriptFor)
  const owner = doc ? transcriptOfSelection(doc, selAsset) : null;
  const assetId = owner?.assetId ?? null;
  const transcript = owner?.transcript;
  const [notes, setNotes] = useState<string[]>([]);
  const [lang, setLang] = useState<'he' | 'en'>('he');
  const [decoded, setDecoded] = useState<DecodedText | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; approx: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { setAnchor(null); setFocus(null); setFailure(null); setEditing(null); setNotes([]); }, [assetId]);

  const clips = useMemo(() => (doc && assetId ? speechClipsOf(doc, assetId) : []), [doc, assetId]);
  const flat = useMemo(() => (transcript ? transcript.segments.flatMap((s) => s.words.map((w) => ({ w, s }))) : []), [transcript]);
  const rate = editor.rate;

  if (!doc) return null;
  const viewed = state.viewVariantId ? doc.variants[state.viewVariantId] : undefined;
  if (!transcript) {
    return (
      <div className="transcript" data-testid="transcript-panel" data-state="empty">
        <TranslationReview />
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
          {selAsset && doc.assets[selAsset]?.audio && <AutoTranscribe assetId={selAsset} language={lang} />}
        </div>
      </div>
    );
  }

  // Playhead → time of the transcribed recording.
  const srcNow = recordingAt(clips, editor.playhead);
  const idx = (id: string | null) => (id ? flat.findIndex((x) => x.w.id === id) : -1);
  const a = idx(anchor), f = idx(focus);
  const lo = a < 0 || f < 0 ? -1 : Math.min(a, f), hi = a < 0 || f < 0 ? -1 : Math.max(a, f);
  const pickedApprox = lo >= 0 && flat.slice(lo, hi + 1).some((x) => x.s.timing !== 'word');

  const cut = async (allowApproximate: boolean) => {
    if (lo < 0 || !assetId) return;
    setFailure(null); setNotes([]);
    const r = await editor.commit([{ op: 'delete_transcript_range', args: { assetId, fromWordId: flat[lo]!.w.id, toWordId: flat[hi]!.w.id, ...(allowApproximate ? { allowApproximate: true } : {}) } }], 'Delete words');
    // clips of a copy that does not keep the recording's timing were left alone: say which
    if (r) { setAnchor(null); setFocus(null); setNotes(skippedNotes(doc, r.results[0]?.output?.skippedClips, t('transcript.untimedSkipped'))); return; }
    // Editor.commit reports failures as text only; the server refuses estimated timing exactly when a picked word's phrase is not word-timed.
    setFailure({ message: editor.getState().error ?? t('transcript.cutFailed'), approx: pickedApprox && !allowApproximate });
  };

  const clickWord = (id: string, start: T.RationalTime, shift: boolean) => {
    if (shift && anchor) setFocus(id);
    else { setAnchor(id); setFocus(id); }
    const at = recordingToTimeline(clips, start);
    if (at) editor.seek(T.nearestFrameIndex(at, rate));
  };

  return (
    <div className="transcript pf-ds pf-cap" data-testid="transcript-panel" data-state="ready" data-asset-id={assetId ?? undefined}>
      {/* one heading on this page: the inspector's «תמלול»; here the count and the one-line hint (design review D6) */}
      <header className="pf-cap-head"><span className="pf-cap-count" data-testid="transcript-count">{CAP_STRINGS[state.lang].phrasesCount(transcript.segments.length)}</span><span className="pf-cap-hint"><span>{CAP_STRINGS[state.lang].wordsHintGo}</span> <span><kbd>Shift</kbd> {CAP_STRINGS[state.lang].wordsHintPick}</span></span></header>
      <ShowAsCaptions where="speech" />
      <TranslationReview />
      <div className="row">
        <span className="pf-cap-reason" title={lo < 0 ? CAP_STRINGS[state.lang].pickWordsFirst : undefined}><button className="ghost danger" disabled={lo < 0} onClick={() => void cut(false)} data-testid="transcript-delete">{t('transcript.delete')}</button></span>
        {failure?.approx && <button className="ghost" onClick={() => void cut(true)} data-testid="transcript-cut-anyway">{t('transcript.cutAnyway')}</button>}
        {/* «שמור כפנינה» on the selected words (wave 7 pearls); once builder C has built it */}
        {PEARLS_UI_BUILT && <span className="pf-cap-reason" title={lo < 0 ? CAP_STRINGS[state.lang].pickWordsFirst : undefined}><SavePearlFromWords assetId={assetId} words={lo >= 0 ? flat.slice(lo, hi + 1).map((x) => x.w) : []} /></span>}
      </div>
      {failure && <p className="muted danger" role="alert" data-testid="transcript-error">{failure.message}</p>}
      {notes.map((n) => <p key={n} className="muted" role="status" data-testid="transcript-skipped-note">{n}</p>)}
      {assetId && doc.assets[assetId]?.audio && transcript.segments.some((s) => s.timing !== 'word' && s.text.trim()) && <AutoTranscribe assetId={assetId} language={transcript.language.slice(0, 2)} align />}
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
              const onTimeline = recordingToTimeline(clips, mid) !== null;
              const now = srcNow !== null && T.lte(w.start, srcNow) && T.lt(srcNow, T.add(w.start, w.duration));
              const i = flat.findIndex((x) => x.w.id === w.id);
              const selected = lo >= 0 && i >= lo && i <= hi;
              return (
                <button key={w.id} type="button" className={`word${onTimeline ? '' : ' cut'}${now ? ' now' : ''}${selected ? ' sel' : ''}${w.confidence !== null && w.confidence < 0.5 ? ' unsure' : ''}`} data-testid="transcript-word" data-word-id={w.id} title={w.confidence !== null && w.confidence < 0.5 ? t('asr.unsure') : undefined}
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
          <button type="button" className="ghost small pf-cap-pencil" onClick={() => onEdit(true)} data-testid="transcript-edit" title={t('transcript.edit')} aria-label={`${t('transcript.edit')}: ${shown.slice(0, 30)}`}><IconRename size={14} /></button>
        </>
      )}
    </li>
  );
}

/** Reading direction of a language tag (the scripts this editor meets that are written right to left). */
const langDir = (tag: string) => (/^(he|iw|ar|fa|ur|yi)(-|$)/i.test(tag) ? 'rtl' : 'ltr');
/**
 * Review of a machine translation (ADR-0017): the master and the translation side by side, each in its own direction, with the
 * phrases whose master changed after translating (stale) and those above the reading-speed limit of the language flagged; wording is
 * edited in place (set_variant_phrase_text, or the cue's text override); «סמן כנבדק» is offered to the owner only, and the server
 * refuses it for anyone else. A preflight-style list says what is still open before exporting this language.
 */
function TranslationReview() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const [picked, setPicked] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>(readReadingLimits);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const variants = doc ? Object.values(doc.variants).filter((v) => !!v.translation) : [];
  const viewed = state.viewVariantId && doc?.variants[state.viewVariantId]?.translation ? state.viewVariantId : null;
  const v = variants.find((x) => x.id === (viewed ?? picked)) ?? variants[0];
  useEffect(() => { setEditing(null); setNote(null); }, [v?.id]);
  if (!doc || !v?.translation) return null;
  const tl = v.translation;
  const to = v.language ?? tl.to, from = tl.from;
  const limit = readingLimitFor(limits, to);
  const rows = reviewRows(doc, v.id, { [to]: limit });
  const open = openItems(doc, v.id, rows);
  const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
  const mark = async () => {
    const next = tl.review === 'reviewed' ? 'needed' : 'reviewed';
    const ok = await editor.reviewTranslation(v.id, next);
    setNote(ok ? { ok: true, text: t(next === 'reviewed' ? 'ai.review.marked' : 'ai.review.unmarked') } : { ok: false, text: `${t('ai.review.markFailed')}: ${editor.getState().error ?? ''}` });
  };
  const save = async (r: ReviewRow, text: string) => {
    const ops = r.kind === 'phrase'
      ? [{ op: 'set_variant_phrase_text', args: { variantId: v.id, assetId: r.assetId!, segmentId: r.id, text } }]
      : [{ op: 'set_variant_override', args: { variantId: v.id, clipId: r.id, text } }];
    const res = await editor.commit(ops, 'Translation wording');
    if (res) setEditing(null);
  };
  const goTo = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-testid=translation-row][data-id="${CSS.escape(id)}"] [data-testid=translation-edit]`);
    el?.scrollIntoView({ block: 'nearest' });
    el?.focus();
  };
  const reviewedAt = tl.reviewedAt ? new Date(tl.reviewedAt).toLocaleString(state.lang === 'he' ? 'he-IL' : 'en-GB') : '';
  return (
    <section className="translation-review" data-testid="translation-review" data-variant={v.id} data-review={tl.review} aria-labelledby={`tr-review-${v.id}`}>
      <h3 id={`tr-review-${v.id}`}>{t('ai.review.title')}: <bdi>{v.name}</bdi></h3>
      {variants.length > 1 && (
        <label>{t('ai.review.variant')}
          <select value={v.id} onChange={(e) => { setPicked(e.target.value); if (viewed) editor.set({ viewVariantId: e.target.value }); }} data-testid="translation-variant">
            {variants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      <p data-testid="translation-status">
        {tl.review === 'reviewed'
          ? <span className="badge" data-testid="translation-reviewed">{t('ai.review.reviewed')} · {t('ai.review.reviewedBy')} <bdi>{tl.reviewedBy}</bdi>{reviewedAt ? <> · <bdi>{reviewedAt}</bdi></> : null}</span>
          : <span className="badge warn" data-testid="translation-unreviewed">{t('ai.review.machine')}</span>}
        {' '}<span className="muted">{t('ai.review.engine')} <bdi dir="ltr">{tl.engine} · {tl.model}</bdi></span>
      </p>
      {editor.isOwner
        ? <button type="button" className={tl.review === 'reviewed' ? 'ghost' : 'primary'} onClick={() => void mark()} data-testid="translation-mark">{t(tl.review === 'reviewed' ? 'ai.review.unmark' : 'ai.review.mark')}</button>
        : <p className="muted" data-testid="translation-owner-only">{t('ai.review.ownerOnly')}</p>}
      {note && <p className={note.ok ? 'muted' : 'danger'} role={note.ok ? 'status' : 'alert'} data-testid="translation-mark-note">{note.text}</p>}
      <label className="translation-limit">{t('ai.review.limit')} (<bdi>{to}</bdi>)
        <input type="number" min={5} max={60} step={1} value={limit} onChange={(e) => { const n = Number(e.target.value); if (n >= 5 && n <= 60) { writeReadingLimit(to, n); setLimits(readReadingLimits()); } }} data-testid="translation-limit" />
      </label>
      <p className="muted small-text">{t('ai.review.limitHint')}</p>
      <table className="translation-table" data-testid="translation-table">
        <thead>
          <tr>
            <th scope="col">{t('ai.review.source')} (<bdi>{from}</bdi>)</th>
            <th scope="col">{t('ai.review.translation')} (<bdi>{to}</bdi>)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="translation-row" data-id={r.id} data-kind={r.kind} data-stale={r.stale ? 'true' : undefined} data-fast={r.cps !== null ? 'true' : undefined}>
              <td lang={from} dir={langDir(from)} data-testid="translation-master">{r.master}</td>
              <td lang={to} dir={langDir(to)}>
                {editing === r.id
                  ? <TranslationEditor initial={r.translated ?? ''} dir={langDir(to)} lang={to} onSave={(text) => void save(r, text)} onCancel={() => setEditing(null)} />
                  : (
                    <>
                      <span data-testid="translation-text">{r.translated ?? t('ai.review.missing')}</span>{' '}
                      <button type="button" className="ghost small" onClick={() => setEditing(r.id)} data-testid="translation-edit" aria-label={`${t('ai.review.edit')}: ${short(r.translated ?? r.master)}`}>✎</button>
                    </>
                  )}
                <span className="translation-flags">
                  {r.stale && <span className="badge warn" data-testid="translation-stale">{t('ai.review.stale')}</span>}
                  {r.cps !== null && <span className="badge warn" data-testid="translation-fast">{t('ai.review.fast')} · <bdi>{r.cps}</bdi> {t('ai.review.cps')}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small-text">{t('ai.review.editNote')}</p>
      <section className="translation-open" data-testid="translation-open" data-count={open.length} aria-label={t('ai.review.before')}>
        <h4>{t('ai.review.before')}</h4>
        {open.length === 0 ? <p className="muted">{t('ai.review.beforeNone')}</p> : (
          <ul>
            {open.map((o, i) => {
              const r = o.id ? rows.find((x) => x.id === o.id) : undefined;
              const what = o.kind === 'unreviewed' ? t('ai.review.unreviewed') : o.kind === 'stale' ? t('ai.review.stale') : o.kind === 'fast' ? t('ai.review.fast') : t('ai.review.missing');
              return (
                <li key={`${o.kind}:${o.id ?? i}`} data-kind={o.kind}>
                  {what}{r ? <>: <bdi lang={from} dir={langDir(from)}>{short(r.master)}</bdi>{o.kind === 'fast' && r.cps !== null ? <> (<bdi>{r.cps}</bdi> {t('ai.review.cps')})</> : null}</> : null}
                  {r && <> <button type="button" className="ghost small" onClick={() => goTo(r.id)} data-testid="translation-goto">{t('ai.review.show')}</button></>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
function TranslationEditor({ initial, dir, lang, onSave, onCancel }: { initial: string; dir: 'rtl' | 'ltr'; lang: string; onSave: (text: string) => void; onCancel: () => void }) {
  const { t } = useEditorState();
  const [text, setText] = useState(initial);
  return (
    <div className="fields">
      <textarea dir={dir} lang={lang} rows={2} value={text} autoFocus aria-label={t('ai.review.edit')} data-testid="translation-textarea" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} />
      <div className="row">
        <button type="button" className="primary" disabled={!text.trim() || text === initial} onClick={() => onSave(text.trim())} data-testid="translation-save">{t('ai.review.save')}</button>
        <button type="button" className="ghost" onClick={onCancel}>{t('ai.review.cancel')}</button>
      </div>
    </div>
  );
}

/** One button for the common case: recognise every file with sound that has no transcript yet. The transcripts arrive as normal project changes. */
export function TranscribeAll() {
  const { editor, state, t } = useEditorState();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  // only once a project is open: before that the owner session may not exist yet
  const docId = state.doc?.id;
  useEffect(() => { if (docId) api.speech().then(setStatus).catch(() => setStatus(null)); }, [docId]);
  const doc = state.doc;
  if (!doc || !status?.transcription.ready) return null;
  const waiting = Object.values(doc.assets).filter((a) => a.audio && !doc.transcripts[a.id] && a.provenance?.origin !== 'generated').length;
  if (waiting < 2 && started === null) return null;
  return (
    <p className="asr-all" data-testid="asr-all" data-waiting={waiting}>
      {waiting > 0 && <button className="ghost" onClick={() => void api.transcribeAll(doc.id, 'he').then((r) => setStarted(r.jobs.length)).catch(editor.fail)} data-testid="asr-all-run">{t('asr.all')} (<bdi>{waiting}</bdi>)</button>}
      {started !== null && <span className="muted" role="status" data-testid="asr-all-note"> {t('asr.all.started')} <bdi>{started}</bdi></span>}
    </p>
  );
}

/** Filler candidates from the transcript of the selected clip's media: found by rule, listed for review, removed as one undoable edit. */
export function FillerPanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const sel = editor.selected;
  const selAsset = sel?.clip.type === 'media' ? sel.clip.assetId : null;
  // the transcribed recording of the selected clip's file (its own, or the one a time-preserving copy was made from)
  const assetId = doc ? transcriptOfSelection(doc, selAsset)?.assetId ?? null : null;
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.findFillers>> | null>(null);
  useEffect(() => { setRes(null); setErr(null); setStale(false); }, [assetId]);
  // «הסרת שתיקות» on the timeline toolbar asked for the focus here (silenceFocus.ts): given in the commit that draws the finder
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (box.current && box.current.offsetParent && takeSilenceFocus()) { box.current.scrollIntoView({ block: 'nearest' }); focusIn(box.current, 'button:not(:disabled)', 'input', 'select'); } });
  if (!doc || !assetId) return null;
  const find = async () => {
    setBusy(true); setErr(null); setStale(false); setRes(null);
    const words = extra.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean).slice(0, 50);
    try { setRes(await api.findFillers(doc.id, { assetId, ...(words.length ? { words } : {}) })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!res || res.candidates.length === 0) return;
    if (editor.getState().revision !== res.revision) { setRes(null); setStale(true); return; }
    const r = await editor.commit(res.ops, 'Remove filler words');
    if (r) setRes(null);
  };
  return (
    <div className="fields fillers" data-testid="filler-panel" data-asset-id={assetId}>
      <p className="muted">{t('filler.hint')}</p>
      <label>{t('filler.extra')}
        <input type="text" dir="auto" value={extra} onChange={(e) => setExtra(e.target.value)} data-testid="filler-extra" />
      </label>
      <button className="ghost" disabled={busy} onClick={() => void find()} data-testid="filler-find">{t('filler.find')}</button>
      {err && <p className="muted danger" role="alert" data-testid="filler-error">{err}</p>}
      {stale && <p className="muted danger" role="alert" data-testid="filler-stale">{t('silence.stale')}</p>}
      {res && (
        <>
          <p role="status" data-testid="filler-summary" data-count={res.words.length} data-cuts={res.candidates.length}>
            {res.words.length === 0 ? t('filler.none') : `${t('filler.count')}: `}
            {res.words.length > 0 && <bdi>{res.words.length} · {res.removableSeconds.toFixed(2)}s</bdi>}
          </p>
          {skippedNotes(doc, res.skippedClips, t('transcript.untimedSkipped')).map((n) => <p key={n} className="muted" role="status" data-testid="filler-skipped-note">{n}</p>)}
          {res.words.length > 0 && (
            <ul className="filler-list" data-testid="filler-list">
              {res.words.slice(0, 200).map((w, i) => (
                <li key={i} data-kind={w.kind}>
                  <button className="ghost" disabled={!w.onTimeline.length} onClick={() => { const at = w.onTimeline[0]; if (at) editor.seek(Math.round((at.startSeconds * editor.rate.num) / editor.rate.den)); }}>
                    <bdi>{w.text}</bdi> <span className="muted">{t(w.kind === 'hesitation' ? 'filler.kind.hesitation' : w.kind === 'repeat' ? 'filler.kind.repeat' : 'filler.kind.listed')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {res.candidates.length > 0 && <button className="ghost danger" onClick={() => void apply()} data-testid="filler-apply">{t('filler.apply')}</button>}
        </>
      )}
    </div>
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
    <div ref={box} className="fields silences" data-testid="silence-panel" data-asset-id={assetId}>
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
          {skippedNotes(doc, res.skippedClips, t('transcript.untimedSkipped')).map((n) => <p key={n} className="muted" role="status" data-testid="silence-skipped-note">{n}</p>)}
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

/** The words of the first caption the project shows, so the caption looks are drawn on real text (null: a sample line is used). */
function firstCueText(doc: NonNullable<ReturnType<typeof useEditorState>['state']['doc']>, track: { clips: { type: string }[] }): string | undefined {
  const cue = track.clips.find((c): c is { type: 'caption'; text: string } => c.type === 'caption' && typeof (c as { text?: string }).text === 'string' && !!(c as { text?: string }).text);
  if (cue) return cue.text;
  const tr = Object.values(doc.transcripts)[0];
  return tr?.segments[0]?.text;
}

/**
 * The one press that makes the captions show the transcript (owner report 2026-11-26), in ONE commit: no caption track yet,
 * an empty manual track made before the transcript existed (replaced, its name and look kept), or a hidden transcript track.
 * «תמלול» tab: offered while the transcript is not on the picture. «כתוביות» tab: the notice says why nothing is shown.
 */
function ShowAsCaptions({ where }: { where: 'speech' | 'captions' }) {
  const { editor, state } = useEditorState();
  const { doc } = state;
  if (!doc || !transcriptNotShown(doc)) return null;
  const C = CAP_STRINGS[state.lang];
  const src = captionSource(doc);
  const ops = showTranscriptOps(doc);
  const show = () => { if (ops) void editor.commit(ops, 'Show transcript as captions'); };
  if (where === 'speech') {
    return ops
      ? <p className="pf-cap-show"><button type="button" className="primary" onClick={show} data-testid="transcript-show-captions">{C.showOnVideo}</button></p>
      : <p className="muted" role="note" data-testid="transcript-captions-locked">{C.locked}</p>;
  }
  if (src.kind === 'none') return null; // the «כתוביות» tab offers «הוספת רצועת כתוביות», which shows the transcript
  return (
    <div className="pf-cap-notice" role="note" data-testid="caption-unlinked" data-kind={src.kind === 'transcript' ? 'hidden' : src.kind === 'unlinked' && src.locked ? 'locked' : 'unlinked'}>
      <p>{src.kind === 'transcript' ? C.hidden : C.unlinked}</p>
      {src.kind === 'unlinked' && src.locked && <p className="muted">{C.locked}</p>}
      {ops && <button type="button" className="primary" onClick={show} data-testid="caption-show-transcript">{src.kind === 'transcript' ? C.showHidden : C.showTranscript}</button>}
    </div>
  );
}

/** One line: what the captions currently come from (the notice of ShowAsCaptions says it when they show nothing). */
function CaptionSourceLine() {
  const { state } = useEditorState();
  const { doc } = state;
  if (!doc) return null;
  const src = captionSource(doc);
  if (src.kind === 'none' || src.kind === 'unlinked') return null;
  const C = CAP_STRINGS[state.lang];
  return <p className="muted pf-cap-source" data-testid="caption-source" data-kind={src.kind}>{src.kind === 'transcript' ? C.sourceTranscript : C.sourceManual(src.cues)}</p>;
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
  // the look the track currently wears, if its style still matches one exactly
  const currentLook = master ? CAPTION_LOOKS.find((l) => Object.entries(l.style).every(([k, v]) => (master as Record<string, unknown>)[k] === v)) : undefined;
  const hasWordTiming = Object.values(doc.transcripts).some((tr) => tr.segments.some((sg) => sg.timing === 'word'));
  const base = `/api/v1/projects/${doc.id}/captions`;
  return (
    <div className="fields" data-testid="caption-controls">
      {!track || !style ? (
        <button className="ghost" onClick={() => void editor.commit([{ op: 'add_caption_track', args: { mode: hasTranscript ? 'transcript' : 'manual' } }], 'Add caption track')} data-testid="caption-add">{t('caption.add')}</button>
      ) : (
        <>
          <CaptionSourceLine />
          <ShowAsCaptions where="captions" />
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
          {!variantId && (
            <div className="caption-look-block">
              <h3>{t('caption.look')}</h3>
              <CaptionLooks trackId={track.id} currentLookId={currentLook?.id ?? null} sampleText={firstCueText(doc, track)} />
            </div>
          )}
          {currentLook?.needsWordTiming && !hasWordTiming && <p className="muted" data-testid="caption-look-note">{t('caption.look.needsWords')}</p>}
          <label>{t('caption.preset')}
            <select value={style.preset} onChange={(e) => setStyle({ preset: e.target.value })} data-testid="caption-preset">
              {CAPTION_PRESETS.map((p) => <option key={p} value={p}>{t(`caption.preset.${p}` as Key)}</option>)}
            </select>
          </label>
          <label>{t('caption.entrance')}
            <select value={style.wordEntrance ?? 'none'} onChange={(e) => setStyle({ wordEntrance: e.target.value })} data-testid="caption-entrance">
              {(['none', 'fade', 'pop'] as const).map((p) => <option key={p} value={p}>{t(`caption.entrance.${p}` as Key)}</option>)}
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
