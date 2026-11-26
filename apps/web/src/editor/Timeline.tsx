import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  AudioLines, Captions, ChevronsUpDown, Clapperboard, Film, Layers, Mic, Music, Pencil, Plus, Rewind, Shapes, Snowflake, Sparkles, TrendingUp, Type, Zap,
} from 'lucide-react';
import * as T from '@pulseframe/time';
import {
  toSourceSpan, clipEnd, drawnName, fieldsToDisplay, keyTimes, findAudioEffect, findEffect, getOp, sortAudioFx, sourceEnd, speedValue, timelineAt, timelineMarkers, transcriptFor, velocityLimit, MARKER_COLORS,
  opOnlyEffect, type Clip, type Marker, type ProjectDocument, type Track,
} from '@pulseframe/core';
import { duckEnvelope, flashSchedule, speechRanges } from '@pulseframe/engine';
import type { Key, Lang } from '@pulseframe/i18n';
import { api, readSnapBeats } from '../api.ts';
import { ClipVisuals } from '../ClipVisuals.tsx';
import { focusNow } from '../ds/focus.ts';
import { VolumeLine } from './VolumeLine.tsx';
import { KeyStrip } from './KeyStrip.tsx';
import { ASSET_DRAG_TYPE, useEditor, useEditorState, type Editor, type EditorState } from './store.ts';
import { useTimelineDrag, type TimelineGhost } from './TimelineDrag.tsx';
import { COMMANDS, chordLabel } from './commands.ts';
import { useMarquee } from './TimelineMarquee.tsx';
import { TimelineZoom, useWheelZoom } from './TimelineZoom.tsx';
import { BAR_ICON_COMPONENTS, IconBeatLock, IconHide, IconLock, IconMainMagnet, IconMute, IconShow, IconSound, IconTarget, IconUnlock } from './icons.tsx';
import { soundTailsFor } from './AudioFxBlock.tsx';
import { CutChip, cutSelection, useSelectedCut } from './CutChip.tsx';
import { PulseStrip, TempoHead, type PulseModel } from './PulseStrip.tsx';
import { RideBar } from './RideBar.tsx';
import { SnapSwitch, ToolbarActions, ToolbarMoreMenu } from './TimelineToolbar.tsx';
import { barGrid, capPlacement, catalogDragFrom, COLLAPSED_LANE_PX, cutRoom, cutsOf, FIT_ON_OPEN_MAX_S, labelsUnder, laneCollapsed, laneOrder, lastAtOrBefore, pickSpoken, rulerLabel, rulerStep, signedTimecode, type SpokenChip, type BarGrid, type CatalogDragItem, type Lane, type LaneRole } from './interactions.math.ts';
import { fitPps } from './zoom.math.ts';
import { TL_STRINGS, type TlStrings } from './timeline.strings.ts';
import { assetHasBeats, timelineTempo } from './pulse.logic.ts';
import { assetDisplayName } from './assetLabel.ts';
import { RenderCacheLane } from './RenderCacheLane.tsx';
import { laneCues } from './captionSource.logic.ts';
import { FilmBar } from './FilmBar.tsx';
import { StoryBar } from './story/StoryBar.tsx';
import { GrowingBar } from './growing/GrowingBar.tsx';
import { dictionaries } from '@pulseframe/i18n';
import type { ExportChecks } from '@pulseframe/core';
import { findingRows } from './send/send.logic.ts';
import './send/send.css';
import './templates.css';
import './timeline.css';
import { MUSICFIT_UI_BUILT } from './musicfit/MusicFitBlock.tsx';
import { ImpactTick } from './musicfit/ImpactTick.tsx';
import { PlayheadGrab } from './scrub/PlayheadGrab.tsx';
import { useScrub } from './scrub/useScrub.ts';
import { RangeFlags, RangeTint } from './range/RangeMarks.tsx';
import { ClipSound } from './clipwave/ClipSound.tsx';

const MAX_MARKERS = 3000;
type MediaClip = Extract<Clip, { type: 'media' }>;

/** «N · label» of a multicam tag: N is the angle's place among the group's picture angles (a sound angle has the mark ♪). */
/** Whether the clip's badge strip renders at all: the multicam «N · label» badge is one of its reasons (a plain switched segment has no other). */
export function hasClipBadges(b: { mcBadge: string | null; fxCount: number; speed: number; ai: unknown; onBeatFx: unknown; media: boolean }): boolean {
  return !!b.mcBadge || b.fxCount > 0 || b.speed !== 1 || !!b.ai || !!b.onBeatFx || b.media;
}
export function mcBadgeText(doc: ProjectDocument, tag: { groupId: string; angleId: string }, lang: 'he' | 'en'): string | null {
  const g = doc.multicam?.[tag.groupId];
  const a = g?.angles.find((x) => x.id === tag.angleId);
  if (!g || !a) return null;
  const n = a.kind === 'picture' ? String(g.angles.filter((x) => x.kind === 'picture').indexOf(a) + 1) : '♪';
  return MULTICAM_STRINGS[lang].badge(n, a.label);
}
export const clipLabel = (doc: ProjectDocument, c: Clip, lang: 'he' | 'en' = 'he') => (c.type === 'media' ? assetDisplayName(doc.assets[c.assetId], lang) ?? c.assetId : c.type === 'adjustment' ? c.label ?? '' : c.type === 'drawn' ? drawnName(c.drawn)[lang] : c.type === 'text' && c.fields ? fieldsToDisplay(lang, c.text, doc) : c.text); // a title with live fields shows the readable form, `{תאריך}`, never the stored `{date}`
/** A file name as the timeline shows it: without its extension. */
const bare = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '');

// ---------- lanes ----------
/** Sizes the timeline is drawn with: the design tokens of ds/tokens.css as they are at this window size. */
interface Metrics { head: number; lane: Record<LaneRole, number> }
const TOKENS: Record<LaneRole, string> = { t: '--pf-lane-t', c: '--pf-lane-c', fx: '--pf-lane-v2', v2: '--pf-lane-v2', v1: '--pf-lane-v1', a1: '--pf-lane-a1', a2: '--pf-lane-a2', a3: '--pf-lane-a3' };
const DEFAULT_METRICS: Metrics = { head: 156, lane: { t: 30, c: 28, fx: 30, v2: 30, v1: 64, a1: 40, a2: 40, a3: 26 } };
function readMetrics(el: Element): Metrics {
  const cs = getComputedStyle(el);
  const px = (name: string, fallback: number) => { const v = parseFloat(cs.getPropertyValue(name)); return Number.isFinite(v) && v > 0 ? v : fallback; };
  const lane = { ...DEFAULT_METRICS.lane };
  for (const r of Object.keys(TOKENS) as LaneRole[]) lane[r] = px(TOKENS[r], DEFAULT_METRICS.lane[r]);
  return { head: px('--pf-track-head', DEFAULT_METRICS.head), lane };
}
const sameMetrics = (a: Metrics, b: Metrics) => a.head === b.head && (Object.keys(a.lane) as LaneRole[]).every((k) => a.lane[k] === b.lane[k]);
/** The mode of the editor as the timeline shows it: taller sound lanes in Sound, taller caption and voice lanes in Captions; the playhead cap takes the mode's tint. */
type Mode = 'edit' | 'look' | 'sound' | 'captions' | 'deliver';
const modeOf = (ws: EditorState['workspace']): Mode => (ws === 'color' ? 'look' : ws === 'sound' ? 'sound' : ws === 'captions' ? 'captions' : ws === 'deliver' ? 'deliver' : 'edit');
function laneHeight(m: Metrics, role: LaneRole, mode: Mode): number {
  const h = m.lane[role];
  if (mode === 'sound' && (role === 'a1' || role === 'a2')) return Math.round(h * 1.9);
  if (mode === 'sound' && role === 'a3') return Math.round(h * 1.6);
  // the caption lane is taller in Captions mode; the voice lane keeps its height (DESIGN_REVIEW §6.4: it was 31 px of the picture's room)
  if (mode === 'captions' && role === 'c') return Math.round(h * 1.6);
  return h;
}
const CLIP_PAD = 3; // space above and below a clip inside its lane

/** What a sound clip is, from what is known about its file: music has an analysed beat, a voice has a transcript or was spoken by a voice engine, a built-in sound is an effect. */
type Flavour = 'voice' | 'music' | 'sfx' | 'sound';
function flavourOf(doc: ProjectDocument, assetId: string): Flavour {
  const a = doc.assets[assetId];
  if (assetHasBeats(doc, assetId)) return 'music'; // its own beats, or those of the measured music it is a time-preserving copy of
  if (a?.provenance?.voice || transcriptFor(doc, assetId)) return 'voice';
  if (a?.provenance?.procedural) return 'sfx';
  return 'sound';
}
function trackFlavour(doc: ProjectDocument, tr: Track): Flavour {
  const counts: Record<Flavour, number> = { voice: 0, music: 0, sfx: 0, sound: 0 };
  for (const c of tr.clips) if (c.type === 'media') counts[flavourOf(doc, c.assetId)]++;
  return (['music', 'voice', 'sfx'] as const).find((f) => counts[f] > 0 && counts[f] >= counts.sound) ?? 'sound';
}
const DEFAULT_NAME = /^(V|A|T|C|FX)\d+$/;
function trackTitle(s: TlStrings, lane: Lane<Track>, flavour: Flavour): string {
  const tr = lane.track;
  if (!DEFAULT_NAME.test(tr.name)) return tr.name;
  if (tr.kind === 'video') return lane.role === 'v1' ? s.trackMain : s.trackOverlay;
  if (tr.kind === 'text') return s.trackTitles;
  if (tr.kind === 'caption') return s.trackCaptions;
  if (tr.kind === 'adjustment') return s.trackAdjust;
  return flavour === 'voice' ? s.trackVoice : flavour === 'music' ? s.trackMusic : flavour === 'sfx' ? s.trackSfx : s.trackSound;
}
const kindOf = (doc: ProjectDocument, lane: Lane<Track>, c: Clip): string => c.type === 'caption' ? 'caption' : c.type === 'adjustment' ? 'adjust' : c.type === 'text' ? 'text' : c.type === 'drawn' ? 'drawn'
  : lane.track.kind === 'audio' ? flavourOf(doc, c.assetId) : lane.role === 'v1' ? 'video' : 'overlay';
const KIND_ICON: Record<string, typeof Film> = { video: Film, overlay: Clapperboard, text: Type, drawn: Shapes, caption: Captions, adjust: Layers, voice: Mic, music: Music, sfx: Zap, sound: AudioLines };
const TRACK_ICON = (lane: Lane<Track>, flavour: Flavour) => KIND_ICON[lane.track.kind === 'audio' ? flavour : lane.track.kind === 'video' ? (lane.role === 'v1' ? 'video' : 'overlay') : lane.track.kind === 'adjustment' ? 'adjust' : lane.track.kind]!;

/** The editor state, unchanged by player ticks: the heavy parts of the timeline render from it, so playback does not redraw them. */
function useCalmState(editor: Editor): EditorState {
  const cache = useRef<EditorState | null>(null);
  const get = useCallback(() => {
    const now = editor.getState(), was = cache.current;
    if (was && was !== now) {
      let same = true;
      for (const k of Object.keys(now) as (keyof EditorState)[]) if (k !== 'tick' && now[k] !== was[k]) { same = false; break; }
      if (same) return was;
    }
    cache.current = now;
    return now;
  }, [editor]);
  return useSyncExternalStore(editor.subscribe, get);
}

const shortTimecode = (frame: number, rate: T.Rate) => signedTimecode(frame, rate).slice(1);

/**
 * How wide a spoken chip's text is, in the chip's font (--pf-fs-xs in --pf-font, the tokens timeline.css gives .word-chip).
 * Measured on a canvas once per text; 1 px is added for the difference between the canvas and the page's text layout.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;
const textWidths = new Map<string, number>();
function chipTextWidth(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      const cs = getComputedStyle(document.documentElement);
      measureCtx.font = `${cs.getPropertyValue('--pf-fs-xs').trim() || '13px'} ${cs.getPropertyValue('--pf-font').trim() || 'sans-serif'}`;
      // the interface font may still be loading: what was measured with the fallback font is measured again once it is in
      void document.fonts?.ready.then(() => textWidths.clear());
    }
  }
  let w = textWidths.get(text);
  if (w === undefined) { w = measureCtx ? Math.ceil(measureCtx.measureText(text).width) + 1 : text.length * 8; textWidths.set(text, w); }
  return w;
}

/**
 * What is said in a sound clip, placed on the clip where it is said: each word when the words are timed and most fit whole at
 * this zoom (interactions.math pickSpoken), otherwise each phrase, shortened with an ellipsis. From the transcript of the
 * clip's file (or of the file it was made from).
 */
function spokenChips(doc: ProjectDocument, c: MediaClip, pps: number): { mode: 'word' | 'phrase'; chips: SpokenChip[] } {
  const none = { mode: 'word' as const, chips: [] };
  if (c.reverse || c.freeze) return none;
  const spoken = transcriptFor(doc, c.assetId);
  if (!spoken) return none;
  const srcIn = T.add(c.sourceIn, spoken.offset), srcEnd = T.add(sourceEnd(c), spoken.offset);
  const x = (t: T.RationalTime) => T.toSeconds(T.sub(timelineAt(c, T.sub(t, spoken.offset)), c.start)) * pps;
  const words: SpokenChip[] = [], phrases: SpokenChip[] = [];
  for (const seg of spoken.transcript.segments) {
    const a = T.max(seg.start, srcIn), b = T.min(T.add(seg.start, seg.duration), srcEnd);
    if (!T.lt(a, b)) continue;
    phrases.push({ key: seg.id, left: x(a), width: x(b) - x(a), text: seg.text });
    if (seg.timing === 'word') for (const w of seg.words) {
      if (T.lt(w.start, srcIn) || !T.lt(w.start, srcEnd)) continue;
      words.push({ key: w.id, left: x(w.start), width: x(T.min(T.add(w.start, w.duration), srcEnd)) - x(w.start), text: w.text });
    }
  }
  return pickSpoken(words, phrases, chipTextWidth);
}

// ---------- markers ----------
/** Shown while the playhead rests on a user marker: name, colour and removal, each an ordinary committed edit. */
function MarkerBar({ marker, left }: { marker: Marker; left: number }) {
  const { editor, t } = useEditorState();
  const update = (args: Record<string, unknown>) => void editor.commit([{ op: 'update_marker', args: { markerId: marker.id, ...args } }], 'Update marker');
  return (
    <div className="marker-bar" data-testid="marker-bar" role="group" aria-label={t('marker.edit')} dir={editor.getState().lang === 'he' ? 'rtl' : 'ltr'} style={{ left }} onPointerDown={(e) => e.stopPropagation()}>
      <i className={`marker-dot ${marker.color}`} aria-hidden="true" />
      <input key={`${marker.id}:${marker.label}`} type="text" dir="auto" maxLength={200} defaultValue={marker.label} placeholder={t('marker.label')} aria-label={t('marker.label')} data-testid="marker-label"
        onBlur={(e) => { if (e.currentTarget.value !== marker.label) update({ label: e.currentTarget.value }); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <select value={marker.color} aria-label={t('marker.color')} data-testid="marker-color" onChange={(e) => update({ color: e.target.value })}>
        {MARKER_COLORS.map((c) => <option key={c} value={c}>{t(`marker.color.${c}` as Key)}</option>)}
      </select>
      <button type="button" className="marker-remove" data-testid="marker-remove" onClick={() => void editor.commit([{ op: 'remove_marker', args: { markerId: marker.id } }], 'Remove marker')}>{t('marker.remove')}</button>
    </div>
  );
}
/** The marker editor follows the playhead, so it listens to the player on its own. */
function MarkerSlot({ markers, pps, head }: { markers: Marker[]; pps: number; head: number }) {
  const { editor, state } = useEditorState();
  void state.tick;
  const here = markers.find((m) => T.frameIndexAt(m.time, editor.rate) === editor.frame);
  return here ? <MarkerBar marker={here} left={head + T.toSeconds(here.time) * pps} /> : null;
}

// ---------- playhead ----------
/** The line through the lanes. Only this and the cap below move while the film plays. */
function PlayheadLine({ pps, head }: { pps: number; head: number }) {
  const { editor, state } = useEditorState();
  void state.tick;
  return <div className="playhead" data-testid="playhead" data-frame={editor.frame} style={{ left: head + T.toSeconds(editor.playhead) * pps }} />;
}
/**
 * The cap on the ruler with the timecode, the part of the line over the top rows, and the lit beat on the Pulse Strip.
 * The timecode is centred on the line (interactions.math capPlacement); it ends at the line when a marker is there, so the
 * marker's flag stays readable; the ruler labels it or a marker's flag covers are hidden while covered, so no stray digit shows.
 */
function PlayheadCap({ pps, beatSeconds, markerFrames }: { pps: number; beatSeconds: number[]; markerFrames: ReadonlySet<number> }) {
  const { editor, state } = useEditorState();
  void state.tick;
  const at = T.toSeconds(editor.playhead);
  const i = lastAtOrBefore(beatSeconds, at + 1e-6);
  const next = i >= 0 ? beatSeconds[i + 1] : undefined;
  // lit while the playhead is inside the beat that starts here (never past the analysed grid)
  const lit = i >= 0 && (next !== undefined ? at < next : at - beatSeconds[i]! < (i > 0 ? beatSeconds[i]! - beatSeconds[i - 1]! : 0));
  const code = useRef<HTMLElement>(null);
  const onMarker = markerFrames.has(editor.frame);
  const text = shortTimecode(editor.frame, editor.rate);
  useLayoutEffect(() => {
    const el = code.current, ruler = el?.closest('.tl-top-lanes')?.querySelector<HTMLElement>(':scope > .ruler');
    if (!el || !ruler) return;
    const x = at * pps, w = el.offsetWidth;
    const place = capPlacement(x, w, onMarker);
    if (el.dataset.place !== place) el.dataset.place = place;
    const from = place === 'centre' ? x - w / 2 : place === 'start' ? x : x - w;
    const spans = [...ruler.querySelectorAll<HTMLElement>(':scope > span')];
    // a label's text starts after its tick and padding (timeline.css: 5 px)
    const boxes = spans.map((sp) => ({ left: sp.offsetLeft + 5, width: Math.max(0, sp.offsetWidth - 5) }));
    const under = new Set(labelsUnder(boxes, from - 2, from + w + 2));
    // a marker's flag hides the labels it lies over too
    for (const m of ruler.querySelectorAll<HTMLElement>(':scope > .user-marker')) for (const k of labelsUnder(boxes, m.offsetLeft - 2, m.offsetLeft + m.offsetWidth + 2)) under.add(k);
    // a covered label is hidden from sight (timeline.css) and from assistive technology alike: the cap above it says the time
    spans.forEach((sp, k) => { const u = under.has(k); sp.classList.toggle('under-cap', u); if (u) sp.setAttribute('aria-hidden', 'true'); else sp.removeAttribute('aria-hidden'); });
  });
  return (
    <>
      {lit && <i className={`pulse-now${editor.player?.playing ? ' playing' : ''}`} key={i} data-testid="pulse-now" style={{ left: beatSeconds[i]! * pps }} aria-hidden="true" />}
      <div className="playhead-cap" style={{ left: at * pps }} aria-hidden="true"><bdi ref={code} className="num">{text}</bdi><PlayheadGrab where="cap" /></div>
    </>
  );
}
/** Says where the playhead is in bars and beats while the user steps through the film; silent during playback. */
function BeatAnnouncer({ grid, s }: { grid: BarGrid | null; s: TlStrings }) {
  const { editor, state } = useEditorState();
  void state.tick;
  const playing = !!editor.player?.playing;
  const pos = !playing && grid ? grid.at(editor.frame) : null;
  const last = useRef<{ frame: number; text: string }>({ frame: -1, text: '' });
  if (!playing && last.current.frame !== editor.frame) last.current = { frame: editor.frame, text: pos ? s.atBarBeat(pos.bar, pos.beat) : '' };
  return <span className="pf-sr" role="status" aria-live="polite" data-testid="tl-live">{playing ? '' : last.current.text}</span>;
}

// ---------- track header ----------
function TrackRename({ value, label, onCommit }: { value: string; label: string; onCommit: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editing) { setText(value); input.current?.focus(); input.current?.select(); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  // The button is drawn by the commit that ends the edit: the focus goes to it in that commit's layout effect (not a later task, where the
  // focus sat on the page body and a late focus could pull it from a field the person moved to). Only Enter and Escape ask for it: a
  // blur means the focus has already gone somewhere the person chose.
  const backToButton = useRef(false);
  useLayoutEffect(() => { if (!editing && backToButton.current) { backToButton.current = false; focusNow(button.current); } }, [editing]);
  const done = (commit: boolean, refocus = false) => {
    if (refocus) backToButton.current = true;
    setEditing(false);
    const next = text.trim();
    if (commit && next && next !== value) onCommit(next);
  };
  if (editing) {
    return <input ref={input} className="track-rename-input" dir="auto" value={text} aria-label={label} data-testid="track-rename-input" maxLength={120}
      onChange={(e) => setText(e.target.value)} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true, true); } else if (e.key === 'Escape') { e.preventDefault(); done(false, true); } }}
      onBlur={() => { if (editing) done(true); }} />;
  }
  return <button ref={button} type="button" className="track-btn" aria-label={label} title={label} data-testid="track-rename" onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing(true)}><Pencil size={14} strokeWidth={1.75} aria-hidden="true" /></button>;
}

const TrackHead = memo(function TrackHead({ lane, flavour, lang, target, tempo }: { lane: Lane<Track>; flavour: Flavour; lang: Lang; target: boolean; tempo: number | null }) {
  const editor = useEditor();
  const t = editor.t, s = TL_STRINGS[lang];
  const tr = lane.track;
  const Icon = TRACK_ICON(lane, flavour);
  const auto = tr.kind === 'caption' && tr.caption?.mode === 'transcript';
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div className="track-head" data-flavour={tr.kind === 'audio' ? flavour : undefined}>
      <i className="track-bar" aria-hidden="true" />
      <Icon className="track-ico" size={15} strokeWidth={1.75} aria-hidden="true" />
      <bdi className="track-code num">{lane.code}</bdi>
      <span className="track-name" dir="auto" title={tr.name}>{tr.kind === 'adjustment' && !DEFAULT_NAME.test(tr.name) ? <><span className="track-kind">{t('track.adjustment')}</span> <bdi>{tr.name}</bdi></> : trackTitle(s, lane, flavour)}</span>
      <span className="track-state" aria-hidden="true">
        {auto && <span title={s.trackAutoCaptions}><Sparkles size={12} strokeWidth={1.75} /></span>}
        {lane.role === 'v1' && <span className="track-magnet" title={s.mainTrack}><IconMainMagnet size={14} /></span>}
        {tempo !== null && <bdi className="track-tempo num">♩ {Math.round(tempo)}</bdi>}
        {target && <IconTarget size={12} />}
        {tr.locked && <IconLock size={12} />}
        {tr.kind === 'audio' ? tr.muted && <IconMute size={12} /> : tr.hidden && <IconHide size={12} />}
      </span>
      <span className="track-buttons" dir="ltr">
        {tr.kind !== 'caption' && <TrackRename value={tr.name} label={`${t('track.rename')}: ${tr.name}`} onCommit={(name) => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, name } }], 'Rename track')} />}
        {(tr.kind === 'video' || tr.kind === 'audio') && (
          <button type="button" className="track-btn" aria-pressed={target} disabled={tr.locked} data-testid="track-target" aria-label={`${t('track.target')}: ${tr.name}`} title={t('track.target.help')}
            onPointerDown={stop} onClick={() => editor.toggleTarget(tr.kind as 'video' | 'audio', tr.id)}><IconTarget /></button>
        )}
        <button type="button" className="track-btn" aria-pressed={tr.locked} data-testid="track-lock" aria-label={`${t(tr.locked ? 'track.unlock' : 'track.lock')}: ${tr.name}`} title={t(tr.locked ? 'track.unlock' : 'track.lock')}
          onPointerDown={stop} onClick={() => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, locked: !tr.locked } }], 'Lock track')}>{tr.locked ? <IconLock /> : <IconUnlock />}</button>
        {tr.kind === 'audio' ? (
          <button type="button" className="track-btn" aria-pressed={tr.muted} data-testid="track-mute" aria-label={`${t(tr.muted ? 'track.unmute' : 'track.mute')}: ${tr.name}`} title={t(tr.muted ? 'track.unmute' : 'track.mute')}
            onPointerDown={stop} onClick={() => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, muted: !tr.muted } }], 'Mute track')}>{tr.muted ? <IconMute /> : <IconSound />}</button>
        ) : (
          <button type="button" className="track-btn" aria-pressed={tr.hidden} data-testid="track-hide" aria-label={`${t(tr.hidden ? 'track.show' : 'track.hide')}: ${tr.name}`} title={t(tr.hidden ? 'track.show' : 'track.hide')}
            onPointerDown={stop} onClick={() => void editor.commit([{ op: 'update_track', args: { trackId: tr.id, hidden: !tr.hidden } }], 'Hide track')}>{tr.hidden ? <IconHide /> : <IconShow />}</button>
        )}
      </span>
    </div>
  );
});

// ---------- a lane and its clips ----------
interface DuckShape { points: string; db: string; labelX: number; low: number }
interface LaneProps {
  lane: Lane<Track>; doc: ProjectDocument; lang: Lang; pps: number; height: number; flavour: Flavour; target: boolean; tempo: number | null;
  selection: string[]; ghostSel: ReadonlySet<string>; cutPending: string[]; ghost: TimelineGhost | null; tails: ReadonlyMap<string, { seconds: number; cut: boolean }>;
  grid: BarGrid | null; heldLights: ReadonlySet<string>; selectedCut: string | null; dropClip: string | null; dropCut: string | null; anchorClip: string | null;
  blade: boolean; empty: boolean; onMenu: (clipId: string, x: number, y: number) => void;
  /** An empty lane drawn as a thin strip (view state only): a click opens it. */
  collapsed: boolean; onOpen: (trackId: string) => void;
  /** Assets whose stored file is missing on disk (state.missingMedia): their clips get the missing-file look, as a clip whose asset is gone. */
  missingMedia: readonly string[];
}
const TrackRow = memo(function TrackRow(p: LaneProps) {
  const editor = useEditor();
  const { lane, doc, lang, pps, height, selection, ghost } = p;
  const s = TL_STRINGS[lang], t = editor.t, rate = editor.rate;
  const tr = lane.track;
  const clipH = height - 2 * CLIP_PAD;
  const isVideo = tr.kind === 'video';
  const cuts = useMemo(() => (isVideo ? cutsOf(tr.clips) : []), [isVideo, tr.clips]);
  const beforeOf = useMemo(() => new Map(cuts.map((c) => [c.after.id, c.before])), [cuts]);
  // captions that come from the transcript are drawn where they play (they are not clips: they follow every cut). The engine's own
  // cues (laneCues → engine captionCues: the linked track, or every sound and picture track when none is linked, as the picture is drawn)
  const autoCues = useMemo(() => laneCues(doc, doc.sequences[doc.mainSequenceId]!, tr, rate), [doc, tr, rate]);
  // the level a ducked track is lowered to while there is speech, as the mixers compute it (drawn, not editable: it follows the speech)
  const duck = useMemo((): DuckShape | null => {
    const d = tr.kind === 'audio' ? tr.audio?.duck : null;
    if (!d || !tr.clips.length) return null;
    const env = duckEnvelope(speechRanges(doc, doc.sequences[doc.mainSequenceId]!, d.sourceTrackIds, 1000), d.reductionDb, d.attackMs, d.releaseMs);
    if (env.length < 2) return null;
    const low = 10 ** (-d.reductionDb / 20);
    const y = (g: number) => CLIP_PAD + 4 + (1 - (g - low) / (1 - low)) * Math.max(6, clipH * 0.42);
    const first = env.find((q) => q.g < 1);
    return { points: env.map((q) => `${((q.s / 1000) * pps).toFixed(1)},${y(q.g).toFixed(1)}`).join(' '), db: `−${d.reductionDb} dB`, labelX: ((first?.s ?? 0) / 1000) * pps + 8, low: y(low) };
  }, [doc, tr, pps, clipH]);

  return (
    <div className={`track ${tr.kind} lane-${lane.role}${tr.locked ? ' locked' : ''}${tr.hidden || tr.muted ? ' off' : ''}${p.collapsed ? ' is-collapsed' : ''}`} style={{ height }} data-lane={lane.role} data-locked={tr.locked ? 'true' : undefined} data-off={tr.hidden || tr.muted ? 'true' : undefined}
      data-collapsed={p.collapsed ? 'true' : undefined} title={p.collapsed ? s.laneCollapsed(`${lane.code} · ${trackTitle(s, lane, p.flavour)}`) : undefined}
      onClick={p.collapsed ? () => p.onOpen(tr.id) : undefined}
      role="list" aria-label={`${t(`track.${tr.kind}` as Key)} ${tr.name}`} data-track-id={tr.id}>
      <TrackHead lane={lane} flavour={p.flavour} lang={lang} target={p.target} tempo={p.tempo} />
      <div className="track-lane">
        {p.empty && lane.role === 'v1' && (
          <div className="tl-empty" data-testid="tl-empty" dir={lang === 'he' ? 'rtl' : 'ltr'}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" /><strong>{s.dropFirst}</strong><span>{s.dropFirstOr}</span>
          </div>
        )}
        {ghost && ghost.trackId === tr.id && (
          <div className={`clip-ghost${ghost.invalid ? ' invalid' : ''}${ghost.snappedTo ? ' snapped' : ''}`} data-testid="clip-ghost" data-mode={ghost.mode} data-track-id={ghost.trackId} style={{ left: ghost.leftPx, width: ghost.widthPx, top: CLIP_PAD, height: clipH }}>
            <span className={`trim-chip at-${ghost.mode === 'trim-start' || ghost.mode === 'move' ? 'start' : 'end'}${ghost.refusal ? ' is-refused' : ''}`} data-testid="trim-chip" dir={lang === 'he' ? 'rtl' : 'ltr'} role={ghost.refusal ? 'status' : undefined}>
              {ghost.refusal
                ? <span data-testid="clip-ghost-refusal">{ghost.refusal}</span>
                : <><bdi className="num">{signedTimecode(ghost.deltaFrames, rate)}</bdi><span aria-hidden="true">·</span><span>{s.frames(Math.abs(ghost.deltaFrames))}</span></>}
            </span>
          </div>
        )}
        {duck && (
          <div className="duck-env" data-testid="duck-envelope" aria-hidden="true">
            <svg height={height} width="100%" focusable="false"><polyline points={duck.points} /></svg>
            <span className="duck-label" style={{ left: duck.labelX, top: Math.min(height - 20, duck.low + 2) }} dir={lang === 'he' ? 'rtl' : 'ltr'}><Mic size={11} strokeWidth={1.75} /><bdi className="num">{duck.db}</bdi><span>· {s.duckUnder}</span></span>
          </div>
        )}
        {autoCues.map((q) => (
          <span key={q.key} className="cue-auto" data-testid="cue-auto" data-frame={q.frame} style={{ left: q.start * pps, width: Math.max(4, (q.end - q.start) * pps - 1), top: CLIP_PAD, height: clipH }} title={q.text}>
            <Captions size={12} strokeWidth={1.75} aria-hidden="true" /><span dir="auto">{q.text}</span>
          </span>
        ))}
        {tr.clips.map((c) => {
          const left = T.toSeconds(c.start) * pps;
          const width = Math.max(4, T.toSeconds(c.duration) * pps - 1);
          const asset = c.type === 'media' ? doc.assets[c.assetId] : undefined;
          const missing = c.type === 'media' && (!asset || p.missingMedia.includes(c.assetId));
          const selected = selection.includes(c.id);
          const only = selection.length === 1 && selected;
          const volLine = c.type === 'media' && tr.kind === 'audio' && asset?.kind !== 'image' && ((c.volume?.length ?? 0) > 0 || only);
          // sound effects of a sound clip: named in the clip's accessible name, with the tail drawn after the clip
          const fxNames = c.type === 'media' && tr.kind === 'audio' ? sortAudioFx(c.audioFx ?? []).filter((x) => x.enabled).map((x) => findAudioEffect(x.type)?.name[lang] ?? x.type) : [];
          const tail = p.tails.get(c.id);
          // an adjustment clip (ADR-0016) is named by its label, else by the track kind and its effects
          const adjFx = c.type === 'adjustment' ? (c.effects ?? []).filter((x) => x.enabled).map((x) => findEffect(x.type)?.name[lang] ?? x.type) : [];
          const label = c.type === 'adjustment' && !c.label ? `${t('track.adjustment')}${adjFx.length ? `: ${adjFx.join(', ')}` : ''}` : c.type === 'media' ? bare(clipLabel(doc, c, lang)) : clipLabel(doc, c, lang);
          // multicam (ADR-0020): a tagged segment says which angle it shows, in words: «2 · רחב»
          const mcBadge = c.type === 'media' && c.multicam ? mcBadgeText(doc, c.multicam, lang) : null;
          const tailS = tail && tail.seconds >= 0.05 ? tail.seconds : 0;
          const fxLabel = `${fxNames.length ? `; ${t('timeline.fx')}: ${fxNames.join(', ')}` : ''}${tailS ? `; ${t('timeline.fx.tail')} ${tailS.toFixed(1)} ${t('sound.fx.seconds')}` : ''}`;
          const kind = kindOf(doc, lane, c);
          const KindIcon = KIND_ICON[kind]!;
          const fxCount = c.type === 'caption' ? 0 : (c.effects ?? []).filter((x) => x.enabled).length;
          const speed = c.type === 'media' && !c.freeze && !c.speedEnd ? speedValue(c) : 1;
          const ai = c.type === 'media' && !!asset?.provenance?.derived;
          const onBeatFx = c.type !== 'caption' && (c.effects ?? []).some((x) => x.enabled && x.modulate && Object.keys(x.modulate).length > 0);
          const before = beforeOf.get(c.id) ?? null;
          const hasCut = isVideo && c.type === 'media' && (!!c.transition || !!before);
          const room = cutRoom(before ? T.toSeconds(before.duration) * pps : null, T.toSeconds(c.duration) * pps);
          // keyframe diamonds (ADR-0019): one per exact frame, effect keys included; the selected clip shows the keyframe strip instead
          const stripOn = only && c.type !== 'caption' && tr.kind !== 'audio';
          const kfs = stripOn ? [] : keyTimes(c, tr, rate).filter((k) => k.frame >= 0 && k.frame <= T.frameIndexAt(c.duration, rate)).map((k) => k.frame);
          const startFrame = T.frameIndexAt(c.start, rate);
          const said = tr.kind === 'audio' && c.type === 'media' && clipH >= 30 ? spokenChips(doc, c, pps) : null;
          return (
            <Fragment key={c.id}>
              <button role="listitem" type="button" tabIndex={p.anchorClip === c.id ? 0 : -1}
                className={`clip k-${kind}${c.type === 'caption' ? ' caption-cue' : ''}${c.type === 'adjustment' ? ' adjust-clip' : ''}${selected ? ' selected' : ''}${p.selectedCut === c.id ? ' via-cut' : ''}${p.ghostSel.has(c.id) ? ' ghost-selected' : ''}${p.cutPending.includes(c.id) ? ' cut-pending' : ''}${missing ? ' missing' : ''}${width < 36 ? ' tiny' : ''}${left < 4 ? ' at-origin' : ''}${p.dropClip === c.id ? ' drop-target' : ''}`}
                data-testid={`clip-${c.id}`} data-clip-id={c.id} data-freeze={c.type === 'media' && c.freeze ? 'true' : undefined} data-reverse={c.type === 'media' && c.reverse ? 'true' : undefined} data-ramp={c.type === 'media' && c.speedEnd ? 'true' : undefined} data-clip-type={c.type} data-track-kind={tr.kind}
                style={{ left, width, top: CLIP_PAD, height: clipH }} aria-pressed={selected}
                onClick={(e) => {
                  if (p.blade && !tr.locked) {
                    const frame = startFrame + Math.round((((e.clientX - e.currentTarget.getBoundingClientRect().left) / pps) * rate.num) / rate.den);
                    if (frame > startFrame && frame < T.frameIndexAt(clipEnd(c), rate)) void editor.commit([{ op: 'split_clip', args: { clipId: c.id, at: T.frameTime(frame, rate) } }], 'Split');
                    return;
                  }
                  cutSelection.set(null);
                  editor.select(c.id, e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
                }}
                onContextMenu={(e) => { e.preventDefault(); p.onMenu(c.id, e.clientX, e.clientY); }}
                aria-label={`${label} ${T.toTimecode(c.start, rate)}–${T.toTimecode(clipEnd(c), rate)}${fxLabel}${mcBadge ? `; ${mcBadge}` : ''}${missing ? `; ${s.clipMissing}` : ''}${c.type === 'media' && c.impact ? `; ${dictionaries[lang]['musicfit.clipMarked']}` : ''}`} data-fx={fxNames.length ? 'true' : undefined}>
                {asset?.kind === 'image' && tr.kind === 'video' && !missing && <span className="clip-still" aria-hidden="true" style={{ backgroundImage: `url("/api/v1/projects/${encodeURIComponent(doc.id)}/assets/${encodeURIComponent(asset.id)}/content")` }} />}
                {asset && asset.kind !== 'image' && (tr.kind === 'video' || tr.kind === 'audio') && (
                  <ClipVisuals projectId={doc.id} asset={asset} kind={tr.kind} sourceIn={(c as MediaClip).sourceIn} duration={c.type === 'media' && c.freeze ? T.frameTime(1, rate) : toSourceSpan(c, c.duration) /* the stretch of SOURCE shown, so thumbnails and waveform follow the clip speed; a freeze frame shows one picture */} widthPx={width} heightPx={clipH} reverse={c.type === 'media' && !!c.reverse} tintKey={kind} />
                )}
                <ClipSound projectId={doc.id} clip={c} asset={asset} trackKind={tr.kind} laneHeight={height} clipHeight={clipH} widthPx={width} missing={missing} />
                {/* the marked moment and the join of a shortened song (wave 7 musicfit): once builder C has built it */}
                {MUSICFIT_UI_BUILT && <ImpactTick doc={doc} clip={c} pps={pps} />}
                <span className="clip-plate">
                  {kind !== 'video' && <KindIcon className="clip-kind" size={12} strokeWidth={1.75} aria-hidden="true" />}
                  {fxNames.length ? <span className="clip-fx-badge" aria-hidden="true" data-testid="clip-fx-badge">∿</span> : null}
                  <span dir="auto" className="clip-label">{missing ? (label ? `${label} · ${s.clipMissing}` : s.clipMissing) : label}</span>
                </span>
                {hasClipBadges({ mcBadge, fxCount, speed, ai, onBeatFx, media: c.type === 'media' && !!(c.freeze || c.reverse || c.speedEnd) }) && (
                  <span className="clip-badges" aria-hidden="true">
                    {mcBadge && <span className="clip-badge mc-clip-badge" data-testid="multicam-badge" data-angle-id={c.type === 'media' ? c.multicam?.angleId : undefined}>{mcBadge}</span>}
                    {c.type === 'media' && c.freeze && <span className="clip-badge" title={s.clipFreeze}><Snowflake size={11} strokeWidth={1.75} /></span>}
                    {c.type === 'media' && c.reverse && <span className="clip-badge" title={s.clipReverse}><Rewind size={11} strokeWidth={1.75} /></span>}
                    {c.type === 'media' && c.speedEnd && <span className="clip-badge" title={s.clipRamp}><TrendingUp size={11} strokeWidth={1.75} /></span>}
                    {speed !== 1 && <span className="clip-badge num" title={s.clipSpeed}>{Number(speed.toFixed(2))}×</span>}
                    {fxCount > 0 && <span className="clip-badge num" title={s.clipEffects(fxCount)}><Sparkles size={11} strokeWidth={1.75} />{fxCount}</span>}
                    {onBeatFx && <span className="clip-badge is-beat" title={s.clipOnBeat}><IconBeatLock size={11} /></span>}
                    {ai && <span className="clip-badge is-ai num" title={s.clipAi}>AI</span>}
                  </span>
                )}
                {said?.chips.map((w) => <span key={w.key} className={`word-chip is-${said.mode}`} dir="auto" style={{ left: w.left + 1, maxWidth: Math.max(0, w.width - 2) }}>{w.text}</span>)}
                {kfs.map((f) => <i key={f} className={`kf${p.grid?.at(startFrame + f)?.onBeat ? ' on-beat' : ''}`} style={{ left: T.toSeconds(T.frameTime(f, rate)) * pps }} aria-hidden="true" />)}
                {selected && p.selectedCut !== c.id && !tr.locked && width >= 16 && <><i className="clip-grip start" data-grip="start" aria-hidden="true" /><i className="clip-grip end" data-grip="end" aria-hidden="true" /></>}
              </button>
              {stripOn && <KeyStrip clip={c} track={tr} selected={only} editable={!tr.locked} pps={pps} left={left} width={width} clipHeight={clipH} clipTop={CLIP_PAD} />}
              {volLine && <VolumeLine clip={c as MediaClip} selected={only} editable={!tr.locked} pps={pps} left={left} width={width} clipHeight={clipH} clipTop={CLIP_PAD} />}
              {tailS > 0 && <div className="clip-tail" aria-hidden="true" data-testid="clip-tail" data-tail-of={c.id} data-cut={tail!.cut ? 'true' : undefined} style={{ left: T.toSeconds(clipEnd(c)) * pps, width: Math.max(2, tailS * pps), top: CLIP_PAD + clipH * 0.25, height: clipH * 0.5 }} />}
              {hasCut && (
                <CutChip editor={editor} lang={lang} clip={c as MediaClip} before={before} beforeName={before ? bare(clipLabel(doc, before, lang)) : ''} afterName={label} x={left} pps={pps} rate={rate} locked={tr.locked}
                  onBeat={!!before && !!p.grid?.at(startFrame)?.onBeat} held={p.heldLights.has(c.id)} spare={(c as MediaClip).transition || before ? velocityLimit(doc, c.id).haveOutFrames : null}
                  selected={p.selectedCut === c.id} dropping={p.dropCut === c.id} nearSelected={selected || (!!before && selection.includes(before.id))}
                  roomAdd={room.add} roomChip={room.chip} />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
});

// ---------- the timeline ----------
type Drop =
  | { kind: 'asset'; frame: number; trackId: string | null }
  | { kind: 'catalog'; item: CatalogDragItem; on: { type: 'clip' | 'cut'; clipId: string } | null; x: number; y: number };
const RULER_KEY = 'pf.tl.ruler.v1';
const readRuler = (): 'time' | 'bars' => { try { return localStorage.getItem(RULER_KEY) === 'bars' ? 'bars' : 'time'; } catch { return 'time'; } };
/** The op that will store the per-project editing behaviour (main-track magnet, ripple delete). Until it is registered both are off and say why. */
const BEHAVIOUR_OP = 'set_timeline_behaviour';

/**
 * DOM timeline: every clip is a real button, so the structure is directly accessible (SPEC §3).
 * Time always progresses left-to-right, also in the Hebrew interface; the track headers stay at the time origin, on the left.
 */
export function Timeline() {
  const editor = useEditor();
  const state = useCalmState(editor);
  const { doc, selection, pxPerSecond: pps, ghosts, lang } = state;
  const t = editor.t, s = TL_STRINGS[lang], rate = editor.rate;
  const uiDir = lang === 'he' ? 'rtl' : 'ltr';
  const mode = modeOf(state.workspace);
  const root = useRef<HTMLElement>(null);
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<'select' | 'blade'>('select');
  const { containerProps, ghost } = useTimelineDrag({ disabled: tool === 'blade' });
  const { marqueeProps, box } = useMarquee(editor);
  const wheelZoomRef = useWheelZoom();
  const scrub = useScrub();
  const [snapBeats, setSnapBeats] = useState(readSnapBeats);
  const [ruler, setRuler] = useState(readRuler);
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [view, setView] = useState({ left: 0, width: 0 });
  const [drop, setDrop] = useState<Drop | null>(null);
  // a drag that ends anywhere (dropped elsewhere, cancelled, left the window) takes its tip and its target lights with it
  useEffect(() => {
    const clear = () => setDrop(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, []);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const selectedCut = useSelectedCut();
  const kbdNav = useRef(false);

  // sizes: the tokens as they are at this window size
  useLayoutEffect(() => {
    const read = () => { if (root.current) { const next = readMetrics(root.current); setMetrics((was) => (sameMetrics(was, next) ? was : next)); } };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  const head = metrics.head;

  const tracks = doc?.sequences[doc.mainSequenceId]?.tracks;
  const lanes = useMemo(() => (tracks ? laneOrder(tracks) : []), [tracks]);
  const empty = !!tracks && tracks.every((tr) => tr.clips.length === 0);

  // Empty lanes are drawn as thin strips (DESIGN_REVIEW §6.1; view state, never stored): those the project had when it
  // opened. A lane added while it is open, a lane the viewer clicks and every lane while something is dragged over the
  // timeline are drawn whole.
  const [lanesSeen, setLanesSeen] = useState<{ docId: string | null; atOpen: ReadonlySet<string>; opened: ReadonlySet<string> }>({ docId: null, atOpen: new Set(), opened: new Set() });
  useEffect(() => {
    if (!doc || !tracks) return;
    setLanesSeen((was) => (was.docId === doc.id ? was : { docId: doc.id, atOpen: new Set(tracks.map((tr) => tr.id)), opened: new Set() }));
  }, [doc, tracks]);
  const openLane = useCallback((id: string) => setLanesSeen((was) => ({ ...was, opened: new Set([...was.opened, id]) })), []);
  const dragging = drop !== null || ghost !== null;
  const collapsed = useMemo(() => lanes.map((l) => laneCollapsed({
    role: l.role, clips: l.track.clips.length, followsTranscript: l.track.kind === 'caption' && l.track.caption?.mode === 'transcript',
    // a lane the project did not have when it opened was just added: it is shown whole
    opened: lanesSeen.docId !== doc?.id || !lanesSeen.atOpen.has(l.track.id) || lanesSeen.opened.has(l.track.id), dragging,
  })), [lanes, lanesSeen, doc?.id, dragging]);
  const collapsedIds = lanes.filter((_, i) => collapsed[i]).map((l) => l.track.id);
  const heights = useMemo(() => lanes.map((l, i) => (collapsed[i] ? COLLAPSED_LANE_PX : laneHeight(metrics, l.role, mode))), [lanes, collapsed, metrics, mode]);

  // a short film is shown whole on the ruler when it opens (DESIGN_REVIEW I5); the zoom the viewer chooses after that stays
  const fitted = useRef<string | null>(null);
  const filmS = doc ? T.toSeconds(editor.duration) : 0;
  useEffect(() => {
    const sc = scrollEl.current;
    if (!doc || fitted.current === doc.id || !sc || !(sc.clientWidth > 0)) return;
    fitted.current = doc.id;
    if (filmS > 0 && filmS < FIT_ON_OPEN_MAX_S) { editor.set({ pxPerSecond: fitPps(filmS, sc.clientWidth, editor.getState().pxPerSecond, head) }); sc.scrollLeft = 0; }
  }, [doc, filmS, editor, head, view.width]);

  // the height the lanes need, for the splitter's default (Splitter.tsx): the timeline is as tall as its lanes
  useLayoutEffect(() => {
    const app = root.current?.parentElement, sc = scrollEl.current, bar = root.current?.querySelector<HTMLElement>('.tl-bar'), top = root.current?.querySelector<HTMLElement>('.tl-top');
    if (!app || !sc || !bar || !top) return;
    const lanesH = heights.reduce((a, b) => a + b, 0);
    app.style.setProperty('--pf-tl-natural', `${Math.ceil(bar.offsetHeight + top.offsetHeight + lanesH + (sc.offsetHeight - sc.clientHeight) + 8)}px`);
    return () => { app.style.removeProperty('--pf-tl-natural'); };
  }, [heights]);

  // beats, bars and scene cuts as they fall on the timeline now
  const pulse = useMemo(() => {
    const none: PulseModel = { beats: [], scenes: [], truncated: false, beatSeconds: null, barSeconds: null };
    if (!doc) return { model: none, grid: null as BarGrid | null, beatSeconds: [] as number[], bpm: null as number | null, analysable: null as string | null };
    const m = timelineMarkers(doc);
    const scenes = m.sceneCuts.slice(0, MAX_MARKERS);
    const beats = m.beats.slice(0, MAX_MARKERS - scenes.length);
    const barFrames = m.downbeats.map((b) => T.nearestFrameIndex(b, rate));
    const bars = new Map(barFrames.map((f, i) => [f, i + 1]));
    const median = (xs: number[]) => { if (xs.length < 2) return null; const g = xs.slice(1).map((v, i) => v - xs[i]!).sort((a, b) => a - b); return g[g.length >> 1]!; };
    const beatS = beats.map((b) => T.toSeconds(b));
    const model: PulseModel = {
      beats: beats.map((b, i) => { const frame = T.nearestFrameIndex(b, rate); return { s: beatS[i]!, frame, bar: bars.has(frame), n: bars.get(frame) ?? null }; }),
      scenes: scenes.map((c) => ({ s: T.toSeconds(c), frame: T.nearestFrameIndex(c, rate) })),
      truncated: m.sceneCuts.length + m.beats.length > MAX_MARKERS, beatSeconds: median(beatS), barSeconds: median(m.downbeats.map((b) => T.toSeconds(b))),
    };
    const beatFrames = m.beats.map((b) => T.nearestFrameIndex(b, rate));
    // the tempo shown and what "analyse the beat" would measure, by the same lineage as the markers (pulse.logic.ts)
    const { bpm, analysable } = timelineTempo(doc);
    return { model, grid: beatFrames.length ? barGrid(beatFrames, barFrames) : null, beatSeconds: beatS, bpm, analysable };
  }, [doc, rate]);
  const hasBeats = pulse.model.beats.length > 0;
  const rulerMode = ruler === 'bars' && hasBeats ? 'bars' : 'time';

  // Echo and reverb ring on past a clip's end (ADR-0010): the planned tail of each sound clip, from the same audio plan as playback and export.
  const tails = useMemo(() => (doc ? soundTailsFor(doc) : new Map<string, { seconds: number; cut: boolean }>()), [doc]);
  const heldLights = useMemo(() => { const out = new Set<string>(); if (doc) for (const [id, plan] of flashSchedule(doc).lights) if (!plan.kept) out.add(id); return out; }, [doc]);
  const userMarkers = useMemo(() => (doc ? Object.values(doc.markers ?? {}).filter((m) => m.sequenceId === doc.mainSequenceId).sort((a, b) => T.cmp(a.time, b.time)) : []), [doc]);
  const markerFrames = useMemo(() => new Set(userMarkers.map((m) => T.frameIndexAt(m.time, rate))), [userMarkers, rate]);
  const ghostSel = useMemo(() => new Set(ghosts.flatMap((g) => g.selection)), [ghosts]);
  const flavours = useMemo(() => new Map(lanes.map((l) => [l.track.id, doc && l.track.kind === 'audio' ? trackFlavour(doc, l.track) : 'sound' as Flavour])), [lanes, doc]);
  const lastMarkerS = userMarkers.length ? T.toSeconds(userMarkers[userMarkers.length - 1]!.time) : 0;
  const totalSeconds = Math.max(T.toSeconds(editor.duration) + 2, lastMarkerS + 2, 8);
  const anchorClip = selection[0] ?? lanes.find((l) => l.track.clips.length)?.track.clips[0]?.id ?? null;
  // the result of the last export's flash check, drawn where it found a risk
  const flashRanges = useMemo(() => {
    const r = (state.exportJob?.output as { photosensitivity?: { verdict: string; ranges: { from: T.RationalTime; to: T.RationalTime; flashesPerSecond: number }[] } } | null | undefined)?.photosensitivity;
    return r && r.verdict !== 'pass' ? r.ranges.map((x) => ({ from: T.toSeconds(x.from), to: T.toSeconds(x.to), perSecond: x.flashesPerSecond })) : [];
  }, [state.exportJob]);

  // the findings of the last export's file checks (wave 7 send), marked on the same lane; report only
  const checkMarks = useMemo(() => {
    const c = (state.exportJob?.output as { checks?: ExportChecks } | null | undefined)?.checks;
    return c && state.doc ? findingRows(c, state.doc.settings.frameRate).map((r) => ({ key: r.key, kind: r.kind, from: T.toSeconds(r.from), to: T.toSeconds(r.to), fromText: r.fromText, toText: r.toText })) : [];
  }, [state.exportJob, state.doc]);

  // a cut stays selected only while its clip is the selection
  useEffect(() => { if (selectedCut && !(selection.length === 1 && selection[0] === selectedCut)) cutSelection.set(null); }, [selection, selectedCut]);

  // V and C choose the tool (physical keys, so a Hebrew layout works); never while typing, with a modifier or behind a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || (e.code !== 'KeyV' && e.code !== 'KeyC')) return;
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || document.querySelector('[aria-modal="true"]') || editor.getState().paletteOpen) return;
      setTool(e.code === 'KeyC' ? 'blade' : 'select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  // the scroll position and width of the lanes: the ride bar rides over the selection
  const setScroller = useCallback((el: HTMLDivElement | null) => { scrollEl.current = el; wheelZoomRef(el); }, [wheelZoomRef]);
  useEffect(() => {
    const el = scrollEl.current;
    if (!el) return;
    let raf = 0;
    const read = () => { raf = 0; setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth })); };
    const later = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    el.addEventListener('scroll', later, { passive: true });
    const ro = new ResizeObserver(later);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', later); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const anchor = useMemo(() => {
    if (!doc || !selection.length || !view.width) return null;
    let from = Infinity, to = -Infinity;
    for (const tr of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of tr.clips) if (selection.includes(c.id)) { from = Math.min(from, T.toSeconds(c.start)); to = Math.max(to, T.toSeconds(clipEnd(c))); }
    if (!Number.isFinite(from)) return null;
    const x = selectedCut ? from : (from + to) / 2;
    return Math.min(view.width, Math.max(head, head + x * pps - view.left));
  }, [doc, selection, selectedCut, view, pps, head]);

  // ---- drops: a library file, a file from the computer, or a catalogue item (a transition onto a cut, an effect or a look onto a clip) ----
  const pointAt = (e: { clientX: number; target: EventTarget; currentTarget: Element }) => {
    const rb = e.currentTarget.querySelector('[data-testid=ruler]')!.getBoundingClientRect();
    const frame = Math.max(0, Math.round((((e.clientX - rb.left) / pps) * rate.num) / rate.den));
    return { frame, trackId: (e.target as Element).closest?.('.track')?.getAttribute('data-track-id') ?? null };
  };
  const catalogTarget = (e: ReactDragEvent<HTMLElement>, item: CatalogDragItem): { type: 'clip' | 'cut'; clipId: string } | null => {
    const el = e.target as Element;
    const clipEl = el.closest?.('[data-clip-id]'), cutEl = el.closest?.('[data-cut-of]');
    const trackEl = el.closest?.('.track');
    const track = doc?.sequences[doc.mainSequenceId]!.tracks.find((tr) => tr.id === trackEl?.getAttribute('data-track-id'));
    if (!doc || !track || track.locked) return null;
    if (item.kind === 'transition') {
      if (track.kind !== 'video') return null;
      if (cutEl) return { type: 'cut', clipId: cutEl.getAttribute('data-cut-of')! };
      // the nearest cut on this track within reach of the pointer; otherwise the start of the clip under it
      const at = (e.clientX - e.currentTarget.querySelector('[data-testid=ruler]')!.getBoundingClientRect().left) / pps;
      const near = cutsOf(track.clips).filter((c) => c.after.type === 'media').map((c) => ({ id: c.after.id, d: Math.abs(T.toSeconds(c.at) - at) * pps })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d <= 28) return { type: 'cut', clipId: near.id };
      const id = clipEl?.getAttribute('data-clip-id');
      const c = track.clips.find((x) => x.id === id);
      return c && c.type === 'media' ? { type: 'cut', clipId: c.id } : null;
    }
    const id = clipEl?.getAttribute('data-clip-id');
    const c = track.clips.find((x) => x.id === id);
    if (!c || c.type === 'caption' || track.kind === 'audio') return null;
    return { type: 'clip', clipId: c.id };
  };
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    const types = [...e.dataTransfer.types];
    const item = catalogDragFrom(types);
    if (item) {
      e.preventDefault();
      const on = catalogTarget(e, item);
      e.dataTransfer.dropEffect = on ? 'copy' : 'none';
      const r = e.currentTarget.getBoundingClientRect();
      const next: Drop = { kind: 'catalog', item, on, x: e.clientX - r.left, y: e.clientY - r.top };
      setDrop((was) => (was?.kind === 'catalog' && was.on?.clipId === on?.clipId && was.on?.type === on?.type && Math.abs(was.x - next.x) < 6 && Math.abs(was.y - next.y) < 6 ? was : next));
      return;
    }
    if (!types.includes(ASSET_DRAG_TYPE) && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const at = pointAt(e);
    setDrop((was) => (was?.kind === 'asset' && was.frame === at.frame && was.trackId === at.trackId ? was : { kind: 'asset', ...at }));
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const item = catalogDragFrom([...e.dataTransfer.types]);
    if (item) {
      e.preventDefault();
      const on = catalogTarget(e, item);
      setDrop(null);
      if (!on || !doc) return;
      if (item.kind === 'effect' && opOnlyEffect(item.id)) return; // a living picture: the Motion tab (verifier C4)
      const clip = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((tr) => tr.clips).find((c) => c.id === on.clipId);
      if (item.kind === 'transition') {
        const frames = clip?.type === 'media' && clip.transition ? { frames: clip.transition.frames } : {};
        void editor.commit([{ op: 'set_transition', args: { clipId: on.clipId, type: item.id, ...frames } }], 'Transition').then((r) => { if (r) { editor.select(on.clipId); cutSelection.set(on.clipId); } });
      } else {
        void editor.commit([item.kind === 'effect' ? { op: 'add_effect', args: { clipId: on.clipId, type: item.id } } : { op: 'apply_look', args: { clipId: on.clipId, lookId: item.id } }], item.kind === 'effect' ? 'Add effect' : 'Apply look').then((r) => { if (r) editor.select(on.clipId); });
      }
      return;
    }
    const id = e.dataTransfer.getData(ASSET_DRAG_TYPE), files = [...(e.dataTransfer.files ?? [])], file = files[0];
    if (!id && !file) return;
    e.preventDefault();
    const at = pointAt(e);
    setDrop(null);
    // a library file is placed; a file from the computer is imported first and then placed (the first file only)
    if (id) void editor.dropAsset(id, at.frame, at.trackId); else if (file) void editor.importFiles(files, at);
  };
  const dropTip = (() => {
    if (drop?.kind !== 'catalog' || !doc) return null;
    const name = drop.item.name || s.unnamedItem;
    if (!drop.on) return { ok: false, text: s.dropNotHere };
    const clip = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((tr) => tr.clips).find((c) => c.id === drop.on!.clipId);
    if (!clip) return { ok: false, text: s.dropNotHere };
    if (drop.on.type === 'clip') return { ok: true, text: s.dropOnClip(name, clip.type === 'media' ? bare(clipLabel(doc, clip, lang)) : clipLabel(doc, clip, lang) || t('track.adjustment')) };
    const tr = clip.type === 'media' ? clip.transition : undefined;
    const frames = tr?.frames ?? Math.max(1, Math.round(rate.num / rate.den / 2));
    const len = s.seconds((Math.round(((frames * rate.den) / rate.num) * 10) / 10).toFixed(1));
    return { ok: true, text: `${s.dropOnCut(name, rulerLabel(T.toSeconds(clip.start), 1), len)}${tr?.sync === 'beat' ? ` · ${s.cutBeatLocked}` : ''}` };
  })();

  // ---- clips with the keyboard: arrows along a track, Alt+arrows between tracks, the menu key for the menu ----
  const onMenu = useCallback((clipId: string, x: number, y: number) => { if (!editor.getState().selection.includes(clipId)) editor.select(clipId); setMenu({ x, y }); }, [editor]);
  const onLanesKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.clip');
    if (!el || e.target !== el) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); const r = el.getBoundingClientRect(); onMenu(el.dataset.clipId!, r.left + Math.min(24, r.width / 2), r.bottom); return; }
    if (!kbdNav.current || e.ctrlKey || e.metaKey) return; // after a click the arrows keep stepping the playhead
    const lane = el.closest('.track-lane')!;
    const inLane = [...lane.querySelectorAll<HTMLElement>(':scope > .clip')].sort((a, b) => a.offsetLeft - b.offsetLeft);
    let to: HTMLElement | undefined;
    if (!e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) to = inLane[inLane.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
    else if (!e.altKey && (e.key === 'Home' || e.key === 'End')) to = e.key === 'Home' ? inLane[0] : inLane[inLane.length - 1];
    else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.track')].filter((r) => r.querySelector('.clip'));
      const next = rows[rows.indexOf(el.closest<HTMLElement>('.track')!) + (e.key === 'ArrowDown' ? 1 : -1)];
      to = next ? [...next.querySelectorAll<HTMLElement>('.clip')].sort((a, b) => Math.abs(a.offsetLeft - el.offsetLeft) - Math.abs(b.offsetLeft - el.offsetLeft))[0] : undefined;
    } else return;
    e.preventDefault(); e.stopPropagation(); // these keys move between clips here, not the playhead or the selection
    to?.focus();
  };

  const analyse = () => {
    if (!doc || !pulse.analysable) return;
    setAnalysing(true);
    void api.analyzeAssetJob(doc.id, pulse.analysable, { kind: 'beats' }).catch(editor.fail).finally(() => setAnalysing(false));
  };
  const behaviour = (doc?.settings as { timeline?: { mainMagnet?: boolean; rippleDelete?: boolean } } | undefined)?.timeline;
  const canBehave = !!getOp(BEHAVIOUR_OP);
  const setBehaviour = (patch: Record<string, boolean>) => void editor.commit([{ op: BEHAVIOUR_OP, args: patch }], 'Timeline behaviour');

  // ruler labels
  const step = rulerStep(pps);
  const labelsEvery = pulse.model.barSeconds ? Math.max(1, Math.ceil(44 / (pulse.model.barSeconds * pps))) : 1;
  const innerWidth = head + totalSeconds * pps + 80;
  const tetherX = ghost && ghost.snappedTo ? head + T.toSeconds(T.frameTime(ghost.edgeFrame, rate)) * pps : null;
  const tetherText = (() => {
    if (!ghost?.snappedTo) return '';
    const pos = pulse.grid?.at(ghost.edgeFrame);
    if (ghost.snappedTo === 'bar') return pos ? s.snapBar(pos.bar) : s.snapBeat(null, null);
    if (ghost.snappedTo === 'beat') return s.snapBeat(pos?.bar ?? null, pos?.beat ?? null);
    return s.snapTo[ghost.snappedTo] ?? '';
  })();

  return (
    <section ref={root} id="pf-timeline" className="timeline pf-ds" dir="ltr" aria-label={t('timeline')} data-mode={mode} data-tool={tool} style={pulse.bpm ? ({ '--pf-bpm': Math.round(pulse.bpm) } as React.CSSProperties) : undefined}>
      {/* The toolbar is one row of fixed height, so the lanes below it get exactly the height that is left (timeline.css). It mirrors with the interface; the lanes never do. */}
      <div className="tl-bar" dir={uiDir} role="group" aria-label={s.toolbar}>
        <div className="tl-tools">
          <ToolbarActions s={s} />
        </div>
        <div className="tl-ride-zone"><RideBar anchor={anchor} grid={pulse.grid} /></div>
        <div className="tl-view">
          {collapsedIds.length > 0 && (
            <button type="button" className="pf-btn pf-btn-ghost pf-btn-sm tl-act tl-empty-lanes" data-testid="tl-empty-lanes" title={s.emptyLanesShow} aria-label={`${s.emptyLanesShow}: ${s.emptyLanes(collapsedIds.length)}`}
              onClick={() => { for (const id of collapsedIds) openLane(id); }}>
              <ChevronsUpDown size={15} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{s.emptyLanes(collapsedIds.length)}</span>
            </button>
          )}
          {/* beat snapping stands on the row once beats exist; before that it is in «עוד» with the analysis */}
          {hasBeats && <SnapSwitch s={s} on={snapBeats} set={setSnapBeats} />}
          <ToolbarMoreMenu s={s} m={{
            tool, setTool, behaviour, canBehave, setBehaviour, snapBeats, setSnapBeats, hasBeats, rulerMode,
            setRuler: (v) => { setRuler(v); try { localStorage.setItem(RULER_KEY, v); } catch { /* the choice lasts for this visit */ } },
            analyse: !hasBeats ? <TempoHead lang={lang} bpm={pulse.bpm} hasBeats={false} canAnalyse={!!pulse.analysable} analysing={analysing} onAnalyse={analyse} /> : null,
          }} />
          <TimelineZoom pps={pps} lang={lang} />
        </div>
      </div>
      {/* the family film's bar (ADR-0026): only while the document holds a film run; it mirrors with the interface */}
      <div className="tl-film" dir={uiDir}><FilmBar lang={lang} /><StoryBar lang={lang} /><GrowingBar lang={lang} /></div>
      {menu && <ClipMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      <div className="tl-scroll" ref={setScroller} {...containerProps} onPointerDownCapture={() => { kbdNav.current = false; }} onFocusCapture={(e) => { if ((e.target as HTMLElement).classList?.contains('clip') && (e.target as HTMLElement).matches(':focus-visible')) kbdNav.current = true; }}>
        <div className="tl-inner" data-pps={pps} style={{ width: innerWidth, '--tl-head': `${head}px`, '--tl-step': `${step * pps}px` } as React.CSSProperties} {...marqueeProps} onKeyDown={onLanesKey}
          onDragOver={onDragOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }} onDrop={onDrop}>
          <div className="tl-top" data-beats={hasBeats ? 'true' : 'none'}>
            <div className="tl-corner">
              {/* the measured tempo heads the Pulse Strip; until the beat is analysed the strip has no row and the action is on the toolbar */}
              {hasBeats && <TempoHead lang={lang} bpm={pulse.bpm} hasBeats canAnalyse={!!pulse.analysable} analysing={analysing} onAnalyse={analyse} />}
              <span className="tl-add-track" role="group" aria-label={t('track.add')} dir={uiDir}>
                <Plus size={12} strokeWidth={2} aria-hidden="true" />
                {(['video', 'audio', 'text', 'adjustment'] as const).map((k) => {
                  const I = { video: Film, audio: AudioLines, text: Type, adjustment: Layers }[k];
                  return <button key={k} type="button" className="tl-add" disabled={!doc} data-testid={`add-track-${k}`} aria-label={s.addTrackKind[k]} title={s.addTrackKind[k]} onPointerDown={(e) => e.stopPropagation()} onClick={() => void editor.commit([{ op: 'add_track', args: { kind: k } }], 'Add track')}><I size={13} strokeWidth={1.75} aria-hidden="true" /></button>;
                })}
              </span>
            </div>
            <div className="tl-top-lanes">
              <PulseStrip model={pulse.model} pps={pps} lang={lang} onSeekFrame={(f) => editor.seek(f)} truncatedTitle={t('timeline.markers.truncated')} />
              <div className="ruler" data-testid="ruler" data-mode={rulerMode} onPointerDown={scrub.onRulerDown}>
                {rulerMode === 'time'
                  ? Array.from({ length: Math.floor(Math.max(totalSeconds + 80 / pps, (view.width - head) / pps) / step) + 1 }, (_, i) => <span key={i} className="num" style={{ left: i * step * pps }}>{rulerLabel(i * step, step)}</span>)
                  : pulse.model.beats.filter((b) => b.n !== null && (b.n - 1) % labelsEvery === 0).map((b) => <span key={b.frame} className="num" style={{ left: b.s * pps }}>{b.n}</span>)}
                {userMarkers.map((m) => (
                  <button key={m.id} type="button" className={`user-marker ${m.color}`} data-testid="user-marker" data-marker-id={m.id} data-frame={T.frameIndexAt(m.time, rate)} style={{ left: T.toSeconds(m.time) * pps }}
                    title={m.label || t('marker.unnamed')} aria-label={`${m.label || t('marker.unnamed')} ${T.toTimecode(m.time, rate)}`}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => editor.seek(T.frameIndexAt(m.time, rate))}>
                    {m.label && <bdi>{m.label}</bdi>}
                  </button>
                ))}
                <RangeFlags pps={pps} />
              </div>
              <div className="tl-flash" data-testid="flash-lane" role="img" aria-label={s.flashLane}>
                {flashRanges.map((r, i) => <i key={i} data-testid="flash-risk" style={{ left: r.from * pps, width: Math.max(3, (r.to - r.from) * pps) }} title={s.flashRisk(rulerLabel(r.from, 1), rulerLabel(r.to, 1), String(r.perSecond))} />)}
                {checkMarks.map((m) => <b key={m.key} className="tl-check-mark" data-testid="export-check-mark" data-kind={m.kind} style={{ left: m.from * pps, width: Math.max(3, (m.to - m.from) * pps) }} title={`${dictionaries[lang][`send.find.${m.kind}` as 'send.find.black']} ${m.fromText}–${m.toText}`} />)}
              </div>
              {/* the render cache's lane (ADR-0024): under the flash lane, only while the viewer's fast export is on */}
              <RenderCacheLane plan={state.segmentPlan} pxPerSecond={pps} frameRate={rate} lang={lang} onSeek={(f) => editor.seek(f)} onRefresh={() => editor.refreshPlan()} />
              <PlayheadCap pps={pps} beatSeconds={pulse.beatSeconds} markerFrames={markerFrames} />
            </div>
          </div>
          {doc && lanes.map((lane, i) => (
            <TrackRow key={lane.track.id} lane={lane} doc={doc} lang={lang} pps={pps} height={heights[i]!} flavour={flavours.get(lane.track.id) ?? 'sound'}
              target={(lane.track.kind === 'video' || lane.track.kind === 'audio') && state.targets[lane.track.kind] === lane.track.id}
              tempo={lane.track.kind === 'audio' && flavours.get(lane.track.id) === 'music' ? pulse.bpm : null}
              selection={selection} ghostSel={ghostSel} cutPending={state.cutPending} ghost={ghost} tails={tails} grid={pulse.grid} heldLights={heldLights} selectedCut={selectedCut}
              dropClip={drop?.kind === 'catalog' && drop.on?.type === 'clip' ? drop.on.clipId : null} dropCut={drop?.kind === 'catalog' && drop.on?.type === 'cut' ? drop.on.clipId : null}
              anchorClip={anchorClip} blade={tool === 'blade'} empty={empty} onMenu={onMenu} missingMedia={state.missingMedia} collapsed={collapsed[i]!} onOpen={openLane} />
          ))}
          {drop?.kind === 'asset' && <div className="drop-line" data-testid="drop-line" data-frame={drop.frame} style={{ left: head + T.toSeconds(T.frameTime(drop.frame, rate)) * pps }} aria-hidden="true"><span className="num">{shortTimecode(drop.frame, rate)}</span></div>}
          {dropTip && drop?.kind === 'catalog' && <div className={`drop-tip${dropTip.ok ? '' : ' no'}`} data-testid="drop-tip" role="status" dir={uiDir} style={{ left: Math.max(head + 8, drop.x + 14), top: drop.y + 18 }}>{dropTip.text}</div>}
          {box && <div className="marquee" data-testid="marquee" aria-hidden="true" style={box} />}
          {tetherX !== null && ghost && (
            <div className={`tether is-${ghost.snappedTo}`} data-testid="snap-tether" data-snap={ghost.snappedTo} style={{ left: tetherX }} aria-hidden="true">
              {tetherText && <span dir={uiDir}>{tetherText}</span>}
            </div>
          )}
          {/* Other participants: a labelled marker only. It never moves this user's playhead. */}
          {ghosts.filter((g) => g.frame !== null).map((g) => (
            <div key={`${g.actor}:${g.sessionId}`} className={`ghost-playhead ${g.kind}`} data-testid="ghost-playhead" data-actor={g.actor} data-frame={g.frame} style={{ left: head + T.toSeconds(T.frameTime(g.frame!, rate)) * pps }}>
              <span>{g.kind === 'agent' ? t('actor.agent') : g.actor}{g.label ? ` · ${g.label}` : ''}</span>
            </div>
          ))}
          <RangeTint pps={pps} head={head} />
          <MarkerSlot markers={userMarkers} pps={pps} head={head} />
          <PlayheadLine pps={pps} head={head} />
        </div>
      </div>
      <BeatAnnouncer grid={pulse.grid} s={s} />
    </section>
  );
}

/** Right-click menu of a clip: the same commands, where the pointer is. Escape or a click elsewhere closes it. */
function ClipMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { editor, t } = useEditorState();
  const items = ['edit.split', 'edit.duplicate', 'edit.copy', 'edit.cut', 'edit.delete'];
  const box = useRef<HTMLDivElement>(null);
  // the keyboard focus goes to the first action that can be used (the first one may be unavailable)
  useEffect(() => { box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, []);
  return (
    <>
      <div className="clip-menu-veil" onPointerDown={onClose} onContextMenu={(e: ReactMouseEvent) => { e.preventDefault(); onClose(); }} />
      <div ref={box} className="clip-menu pf-ds" role="menu" aria-label={t('timeline.actions')} data-testid="clip-menu" dir={editor.getState().lang === 'he' ? 'rtl' : 'ltr'} style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 250) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault(); e.stopPropagation();
          const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          all[(all.indexOf(document.activeElement as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
        }}>
        {items.map((id) => {
          const c = COMMANDS.find((k) => k.id === id)!;
          return (
            <button key={id} type="button" role="menuitem" className={id === 'edit.delete' ? 'danger' : ''} disabled={!!c.enabled && !c.enabled(editor)} data-testid={`menu-${id.slice(5)}`}
              onClick={() => { onClose(); void c.run(editor); }}>
              {(() => { const I = BAR_ICON_COMPONENTS[id]; return I ? <I /> : null; })()}<span>{t(`bar.${id.slice(5)}` as Key)}</span>{c.keys[0] && <kbd className="num">{chordLabel(c.keys[0])}</kbd>}
            </button>
          );
        })}
      </div>
    </>
  );
}
