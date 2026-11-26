/**
 * «ניקוי קול»: voice cleanup of one sound clip (ADR-0013), at the top of the sound-effects block (AudioFxBlock.tsx). Hebrew first,
 * right to left.
 *  - «נקה את הקול» measures the recording (measure_voice: read-only, model-free), says what it measured in a polite status line,
 *    and commits the candidate clean_voice operations it returned as ONE commit (one revision, one undo, labelled «ניקוי קול»).
 *  - One strength slider re-commits clean_voice with the clip's own noise profile, source and mains frequency, without measuring
 *    again; «הסר ניקוי» commits strength 0.
 *  - ▶ «לפני» and ▶ «אחרי» play the clip from a scratch copy of the document (before: the cleanup switched off in the copy), the
 *    same audition the effect chips use: nothing is stored and the revision does not change.
 *  - The profile and source parameters are never shown as controls (they are data from the measurement, not settings).
 * This is the DSP effect; the model-based «ניקוי קול בבינה מלאכותית» is a separate AI tool, only mentioned here. Nobody has listened
 * to the cleanup yet, and the block says so with a steady badge. Nothing here moves or blinks; numbers sit in left-to-right isolates.
 */
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { applyTransaction, isCleanupType, NOISE_BAND_EDGES_HZ, type AudioFxInstance, type Clip, type OpCall } from '@pulseframe/core';
import type { VoiceMeasurement } from '@pulseframe/engine';
import { api, type VoiceCheck } from '../api.ts';
import { CommitSlider } from './AudioFxBlock.tsx';
import { useEditorState } from './store.ts';
import { VOICE_CLEAN_STRINGS, VOICE_CLEAN_TESTIDS as ID, type VoiceCleanKey, type VoiceCleanLang } from './voiceClean.strings.ts';

type SoundClip = Extract<Clip, { type: 'media' }>;
/** The strength clean_voice uses when none is given (core clean_voice default). */
export const CLEANUP_DEFAULT_STRENGTH = 0.6;

/** The clip's cleanup instances, by type. */
export function cleanupOf(clip: SoundClip): { dehum?: AudioFxInstance; denoise?: AudioFxInstance; speech?: AudioFxInstance; any: boolean } {
  const list = (clip.audioFx ?? []).filter((f) => isCleanupType(f.type));
  const by = (t: string) => list.find((f) => f.type === t);
  return { dehum: by('cleanup.dehum'), denoise: by('cleanup.denoise'), speech: by('cleanup.speech'), any: list.length > 0 };
}
/**
 * The strength the clip's cleanup was set with, read back through the strength table of core cleanVoiceEffects (noise reduction
 * 6 + 14·s dB, else leveller 3 + 9·s dB), to the nearest 0.05; null when it has no cleanup.
 */
export function cleanupStrengthOf(clip: SoundClip): number | null {
  const c = cleanupOf(clip);
  const r = c.denoise ? (Number(c.denoise.params.reductionDb) - 6) / 14 : c.speech ? (Number(c.speech.params.levelDb) - 3) / 9 : c.dehum ? CLEANUP_DEFAULT_STRENGTH : null;
  if (r === null || !Number.isFinite(r)) return null;
  return Math.min(1, Math.max(0, Math.round(r * 20) / 20));
}
/**
 * clean_voice at `strength` for this clip with what it already has: its noise profile and the recording it was measured on, its
 * mains frequency (no hum removal when it has none), and only the parts it carries. Strength 0 removes the cleanup.
 */
export function strengthOps(clip: SoundClip, strength: number): OpCall[] {
  const c = cleanupOf(clip);
  if (!c.any) return [];
  const args: Record<string, unknown> = { clipId: clip.id, includeLinked: false, strength, mainsHz: c.dehum ? String(c.dehum.params.mainsHz) : null, denoise: !!c.denoise, speech: !!c.speech };
  if (c.denoise) { args.profile = String(c.denoise.params.profile); args.source = String(c.denoise.params.source ?? ''); }
  return [{ op: 'clean_voice', args }];
}
/** «הסר ניקוי»: clean_voice at strength 0 (the cleanup effects go, the clip's other effects stay). */
export const removeCleanupOps = (clip: SoundClip): OpCall[] => strengthOps(clip, 0);
/** The ops measure_voice returned, as they will be committed: only clean_voice candidates, unchanged (profile, source and mains frequency as measured). */
export const measuredOps = (check: VoiceCheck): OpCall[] => check.ops.filter((o) => o.op === 'clean_voice');
/** «לפני»: the scratch copy plays the clip with its cleanup switched off. */
export const beforeOps = (clip: SoundClip): OpCall[] => (clip.audioFx ?? []).filter((f) => isCleanupType(f.type) && f.enabled).map((f) => ({ op: 'update_audio_effect', args: { clipId: clip.id, effectId: f.id, enabled: false } }));
/** Overall background noise, dBFS RMS per channel over 50 Hz–20 kHz, from the 24 band levels (core voiceClean.ts: 10^(b/10)·width/24000 per band). */
export function noiseLevelDb(bandsDb: readonly number[]): number {
  let p = 0;
  bandsDb.forEach((b, j) => { p += (10 ** (b / 10) * (NOISE_BAND_EDGES_HZ[j + 1]! - NOISE_BAND_EDGES_HZ[j]!)) / 24000; });
  return 10 * Math.log10(p);
}
/** What the status line says about a measurement: words and numbers (numbers go in left-to-right isolates). */
export type ReportToken = { t: string } | { n: string };
export function reportTokens(r: VoiceMeasurement, lang: VoiceCleanLang): ReportToken[] {
  const s = VOICE_CLEAN_STRINGS[lang], f1 = (x: number) => x.toFixed(1), out: ReportToken[] = [{ t: `${s.measured} ${s.noise} ` }, { n: f1(noiseLevelDb(r.noise.bandsDb)) }, { t: ` ${s.dbfs}` }];
  if (r.hum) out.push({ t: ` · ${s.hum} ` }, { n: String(r.hum.hz) }, { t: ` ${s.hz} (` }, { n: f1(r.hum.levelDb) }, { t: ` ${s.dbfs})` });
  else out.push({ t: ` · ${s.humNone}` });
  out.push({ t: ` · ${s.speech} ` }, ...(r.speech.levelDb === null ? [{ t: s.unknown }] : [{ n: f1(r.speech.levelDb) }, { t: ` ${s.dbfs}` }]));
  out.push({ t: ` · ${s.snr} ` }, ...(r.speech.snrDb === null ? [{ t: s.unknown }] : [{ n: f1(r.speech.snrDb) }, { t: ` ${s.db}` }]));
  out.push({ t: ` · ${s.confidence} ` }, { n: `${Math.round(r.noise.confidence * 100)}%` });
  if (r.noise.warning === 'no_pause_found') out.push({ t: `. ${s.noPause}` });
  if (r.noise.warning === 'ranges_too_short') out.push({ t: `. ${s.rangesShort}` });
  return out;
}
/**
 * ▶ «לפני» / ▶ «אחרי»: the visible text and the accessible name. The name BEGINS with the visible word (WCAG 2.5.3 Label in Name),
 * so a speech-input user who says «לפני» reaches the button; the rest says it is a sample that is not saved.
 */
export function listenLabels(which: 'before' | 'after', lang: VoiceCleanLang): { text: string; name: string } {
  const s = VOICE_CLEAN_STRINGS[lang], word = s[which];
  return { text: `▶ ${word}`, name: `${word}: ${which === 'before' ? s.listenBefore : s.listenAfter}` };
}
export const tokensText = (tokens: readonly ReportToken[]): string => tokens.map((x) => ('t' in x ? x.t : x.n)).join('');

/** Space and Enter on a button of this block press it; they do not reach the editor's play and step shortcuts. */
const keepButtonKeys = (e: React.KeyboardEvent) => { if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement).tagName === 'BUTTON') e.stopPropagation(); };

type Status = { kind: 'idle' } | { kind: 'measuring' } | { kind: 'report'; tokens: ReportToken[]; after: string } | { kind: 'text'; text: string };

export function VoiceCleanBlock({ clip, locked, blocked }: { clip: SoundClip; locked: boolean; blocked: boolean }) {
  const { editor, state } = useEditorState();
  const doc = state.doc!;
  const lang: VoiceCleanLang = state.lang === 'en' ? 'en' : 'he';
  const s = (k: VoiceCleanKey) => VOICE_CLEAN_STRINGS[lang][k];
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [scopeAsset, setScopeAsset] = useState(false);
  const [playing, setPlaying] = useState<'before' | 'after' | null>(null);
  const headingId = useId(), whyId = useId(), noteId = useId();
  const shown = useRef(clip.id); // the clip this block shows now: a measurement that ends after the user moved on reports nothing here
  shown.current = clip.id;
  useEffect(() => { setStatus({ kind: 'idle' }); setPlaying(null); }, [clip.id]);
  const c = cleanupOf(clip);
  const strength = cleanupStrengthOf(clip);
  const measuring = status.kind === 'measuring';
  const off = locked || blocked;
  const player = editor.player;
  const why = locked ? s('disabledLocked') : blocked ? s('disabledTimeMap') : null;
  const source = c.denoise ? String(c.denoise.params.source ?? '') : null;
  const sourceName = source ? doc.assets[source]?.name ?? source : '';

  const run = async () => {
    if (off || measuring) return;
    const id = clip.id, say = (st: Status) => { if (shown.current === id) setStatus(st); };
    player?.stopAudition();
    setPlaying(null);
    setStatus({ kind: 'measuring' });
    let check: VoiceCheck;
    try {
      check = await api.measureVoice(doc.id, { clipId: id, ...(scopeAsset ? { scope: 'asset' as const } : {}) });
    } catch (e) {
      say({ kind: 'text', text: `${s('failed')} ${e instanceof Error ? e.message : String(e)}` });
      editor.fail(e);
      return;
    }
    const ops = measuredOps(check);
    const tokens = reportTokens(check.report, lang);
    if (!ops.length) { say({ kind: 'report', tokens, after: s('nothingApplied') }); return; }
    // the candidates go in as measured, as ONE commit: one revision, one undo «ניקוי קול»
    const r = await editor.commit(ops, s('undoLabel'));
    say({ kind: 'report', tokens, after: r ? (ops.length === 1 ? s('appliedOne') : s('applied').replace('{n}', String(ops.length))) : '' });
  };
  const recommit = (ops: OpCall[], text?: string) => { if (!ops.length) return; void editor.commit(ops, s('undoLabel')).then((r) => { if (r && text) setStatus({ kind: 'text', text }); }); };
  const listen = async (which: 'before' | 'after') => {
    if (!player) return;
    if (playing === which) { player.stopAudition(); setPlaying(null); return; }
    let draft = doc;
    const ops = which === 'before' ? beforeOps(clip) : [];
    if (ops.length) { try { draft = applyTransaction(doc, ops, { idSeed: 'listen_', actor: 'preview' }).doc; } catch (e) { editor.fail(e); return; } }
    player.stopAudition();
    setPlaying(which);
    try { await player.audition(draft, clip.id, 4); } catch (e) { editor.fail(e); } finally { setPlaying((cur) => (cur === which ? null : cur)); }
  };
  const describedBy = [why ? whyId : '', !c.any ? noteId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className="vclean" role="group" aria-labelledby={headingId} data-testid={ID.block} data-clip-id={clip.id} onKeyDown={keepButtonKeys}>
      <div className="vclean-head">
        <h4 id={headingId}>{s('title')}</h4>
        <span className="vclean-badge" data-testid={ID.unlistened}>{s('unlistened')}</span>
      </div>
      <p className="muted afx-note pf-help">{s('what')}</p>
      {why && <p className="afx-note" role="note" id={whyId} data-testid={ID.disabled}>{why}</p>}
      <div className="row vclean-actions">
        <button type="button" className="primary" data-testid={ID.run} disabled={off || measuring} aria-describedby={why ? whyId : undefined} onClick={() => void run()}>{measuring ? s('measuring') : s('run')}</button>
        <label className="check">
          <input type="checkbox" checked={scopeAsset} disabled={off || measuring} data-testid={ID.scopeAsset} onChange={(e) => setScopeAsset(e.target.checked)} /> {s('scopeAsset')}
        </label>
      </div>
      <p className="afx-note vclean-status" role="status" aria-live="polite" data-testid={ID.status}>
        {status.kind === 'measuring' ? s('measuring') : status.kind === 'text' ? status.text : status.kind === 'report' ? (
          <>{status.tokens.map((x, i) => <Fragment key={i}>{'t' in x ? x.t : <bdi dir="ltr">{x.n}</bdi>}</Fragment>)}{status.after ? `. ${status.after}` : ''}</>
        ) : ''}
      </p>
      <CommitSlider label={s('strength')} value={strength ?? CLEANUP_DEFAULT_STRENGTH} min={0} max={1} step={0.05} display={(v) => `${Math.round(v * 100)}%`} testid={ID.strength}
        ariaLabel={s('strength')} disabled={off || !c.any || measuring} onCommit={(v) => recommit(strengthOps(clip, v), v === 0 ? s('removed') : undefined)} />
      {!c.any && !why && <p className="muted afx-note" id={noteId}>{s('noCleanup')}</p>}
      {c.any && source !== null && source !== clip.assetId && (
        <p className="afx-note" role="note" data-testid={ID.sourceWarning}>{source === '' ? s('sourceGeneric') : <>{s('sourceOther')} <bdi>{sourceName}</bdi></>}</p>
      )}
      <div className="row vclean-actions">
        <button type="button" className="afx-listen" aria-pressed={playing === 'before'} data-testid={ID.before} disabled={!player || !c.any || measuring} aria-describedby={describedBy}
          aria-label={listenLabels('before', lang).name} title={listenLabels('before', lang).name} onClick={() => void listen('before')}>{listenLabels('before', lang).text}</button>
        <button type="button" className="afx-listen" aria-pressed={playing === 'after'} data-testid={ID.after} disabled={!player || !c.any || measuring} aria-describedby={describedBy}
          aria-label={listenLabels('after', lang).name} title={listenLabels('after', lang).name} onClick={() => void listen('after')}>{listenLabels('after', lang).text}</button>
        <button type="button" className="danger" data-testid={ID.remove} disabled={off || !c.any || measuring} aria-describedby={describedBy} onClick={() => recommit(removeCleanupOps(clip), s('removed'))}>{s('remove')}</button>
      </div>
      {!player && <p className="muted afx-note">{s('noPlayer')}</p>}
      <p className="muted afx-note pf-help">{s('ai')}</p>
    </div>
  );
}
