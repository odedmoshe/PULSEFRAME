/**
 * Perform mode's capture (ADR-0025): the state machine over keydown, keyup, pointer and blur events that turns presses into taps
 * (pad, down, up in timeline seconds, the tap calibration already subtracted), and the pure helpers around it: which pad is
 * usable, which library asset a pad resolves to, the live picture document of a take and the planned take after stop.
 *
 * Nothing here commits. A tap is taken from the event's own timeStamp mapped through the player's audio clock
 * (PerformPlayerPort.timelineSecondsAt), not from the time the handler runs. Keys: padOfKey / padKeysLive (performKeys.ts): the
 * unmodified number row and keypad 1–8 by KeyboardEvent.code, never on auto-repeat, never while typing or under a modal, and
 * never while multicam owns the digits. A key-up (or a lost focus) closes the hit; a hit still open at the end of the take is
 * closed at the stop. The planner functions (performGrid, quantiseTaps, planPerformance) are injected so tests run without the
 * worker's moves.ts; the defaults are the real ones.
 */
import {
  applyTransaction, GPU_EFFECT_IDS, flashClassOf, MAX_TAKE_HITS, MAX_TAKE_TAPS, PAD_COUNT, performGrid as realGrid, planPerformance as realPlan, quantiseTaps as realQuantise, sequenceDuration,
  type Chip, type Hit, type MoveSpec, type PadBank, type PlannedTake, type PlanInput, type ProjectDocument, type QuantiseSettings, type Tap,
} from '@pulseframe/core';
import { flashSchedule as realSchedule, type FlashSchedule } from '@pulseframe/engine';
import * as T from '@pulseframe/time';
import { padKeysLive, padOfKey, type PadKeyContext, type PadKeyEvent } from './performKeys.ts';

// ---------------------------------------------------------------- capture
export interface KeyLike extends PadKeyEvent { timeStamp: number }
export interface CaptureEnv {
  /** PerformPlayerPort.timelineSecondsAt: heard timeline seconds of a performance time, null when nothing plays. */
  timelineSecondsAt(perfMs: number): number | null;
  /** The stored calibration offset, seconds (0 until calibrated). */
  offsetSeconds(): number;
  /** The context of a number key (performKeys.ts padKeysLive). */
  keyContext(): PadKeyContext;
  /** The hits changed (the view re-plans the live picture at most once per animation frame). */
  onChange(): void;
  /** A pad went down (the view plays a sound pad's monitor sound). */
  onPadDown?(pad: number, tapIndex: number): void;
}
interface OpenHit { pad: number; index: number }

export class TapCapture {
  /** Whether a take is recorded: events are ignored otherwise. */
  recording = false;
  private list: { pad: number; down: number; up: number }[] = [];
  private open = new Map<string, OpenHit>();
  /** Presses past MAX_TAKE_TAPS (never stored), and presses that came while nothing played. */
  dropped = 0;
  ignoredNotPlaying = 0;
  constructor(private env: CaptureEnv) {}

  get count(): number { return this.list.length; }
  /** The 201st tap and later are held `take_full` by the planner; the view marks them as they are made. */
  isOver(index: number): boolean { return index >= MAX_TAKE_HITS; }
  get overCount(): number { return Math.max(0, this.list.length - MAX_TAKE_HITS); }
  heldPads(): ReadonlySet<number> { return new Set([...this.open.values()].map((o) => o.pad)); }
  reset(): void { this.list = []; this.open.clear(); this.dropped = 0; this.ignoredNotPlaying = 0; }

  /** Closed taps, plus the hits still open closed provisionally at `nowSec` (the live picture); sorted as made. */
  snapshot(nowSec?: number): Tap[] {
    const openIdx = new Set([...this.open.values()].map((o) => o.index));
    return this.list.map((t, i) => ({ pad: t.pad, down: t.down, up: openIdx.has(i) ? Math.max(t.down, nowSec ?? t.down) : t.up }));
  }

  private secondsOf(perfMs: number): number | null {
    const s = this.env.timelineSecondsAt(perfMs);
    return s === null || !Number.isFinite(s) ? null : Math.max(0, s - this.env.offsetSeconds());
  }
  private press(source: string, pad: number, perfMs: number): boolean {
    if (!this.recording || this.open.has(source)) return false;
    for (const o of this.open.values()) if (o.pad === pad) return false; // the pad is already held (by another key or finger)
    const t = this.secondsOf(perfMs);
    if (t === null) { this.ignoredNotPlaying++; return false; }
    if (this.list.length >= MAX_TAKE_TAPS) { this.dropped++; return false; }
    const index = this.list.length;
    this.list.push({ pad, down: t, up: t });
    this.open.set(source, { pad, index });
    this.env.onPadDown?.(pad, index);
    this.env.onChange();
    return true;
  }
  private release(source: string, perfMs: number): boolean {
    const o = this.open.get(source);
    if (!o) return false;
    const t = this.secondsOf(perfMs);
    const tap = this.list[o.index]!;
    tap.up = Math.max(tap.down, t ?? tap.down);
    this.open.delete(source);
    this.env.onChange();
    return true;
  }

  /** A key went down: true when it pressed a pad. Ignored: with a modifier, on repeat, while typing or under a modal, while multicam owns the digits. */
  keyDown(e: KeyLike): boolean {
    const pad = padOfKey(e);
    if (pad === null || !padKeysLive(this.env.keyContext())) return false;
    return this.press(`k:${e.code}`, pad, e.timeStamp);
  }
  /** A key went up: closes the hit it opened, whatever modifier is down now and wherever the focus is. */
  keyUp(e: Pick<KeyLike, 'code' | 'timeStamp'>): boolean { return this.release(`k:${e.code}`, e.timeStamp); }
  pointerDown(pad: number, pointerId: number, timeStamp: number): boolean { return pad >= 0 && pad < PAD_COUNT && this.press(`p:${pointerId}`, pad, timeStamp); }
  pointerUp(pointerId: number, timeStamp: number): boolean { return this.release(`p:${pointerId}`, timeStamp); }
  /** The window or the page lost focus: no key-up will come, so every open hit closes now. */
  blur(timeStamp: number): number {
    let n = 0;
    for (const source of [...this.open.keys()]) if (this.release(source, timeStamp)) n++;
    return n;
  }
  /** Close whatever is still open at the stop (a held pad when the take ends). */
  closeAll(nowSec: number): void {
    for (const [source, o] of [...this.open.entries()]) { const tap = this.list[o.index]!; tap.up = Math.max(tap.down, nowSec); this.open.delete(source); }
  }
  /** Test hook (window.__pfPerform.injectTaps in the proof): taps as if performed; `time` is already timeline seconds. Returns how many were kept. */
  inject(taps: readonly Tap[]): number {
    let kept = 0;
    for (const t of taps) {
      if (this.list.length >= MAX_TAKE_TAPS) { this.dropped++; continue; }
      if (!(t.pad >= 0 && t.pad < PAD_COUNT) || !(t.down >= 0) || !(t.up >= t.down)) continue;
      this.list.push({ pad: t.pad, down: t.down, up: t.up });
      this.env.onPadDown?.(t.pad, this.list.length - 1);
      kept++;
    }
    if (kept) this.env.onChange();
    return kept;
  }
}

// ---------------------------------------------------------------- pads
export type PadStateName = 'ready' | 'disabled' | 'empty' | 'hidden';
export type PadReason = 'needs_gpu' | 'no_music' | 'missing_asset';
export interface PadStatus { state: PadStateName; reason?: PadReason }
export interface PadContext { gpu: boolean; hasBeats: boolean; noFlashes: boolean; asset: string | null }

export const moveNeedsGpu = (m: MoveSpec): boolean => m.kind === 'adjust' && m.effects.some((e) => GPU_EFFECT_IDS.includes(e.type));
export const isBeatStrobe = (m: MoveSpec): boolean => m.kind === 'adjust' && m.effects.some((e) => e.type === 'light.strobe');
/** Does the move change light (the «בלי הבזקים» switch hides these pads). Same classifier as the planner and the op (performFlash.ts). */
export const moveChangesLight = (m: MoveSpec): boolean => m.kind === 'adjust' && flashClassOf(m.effects.map((e) => ({ type: e.type }))) !== 'none';

export function padStatus(m: MoveSpec | null, c: PadContext): PadStatus {
  if (!m) return { state: 'empty' };
  if (c.noFlashes && moveChangesLight(m)) return { state: 'hidden' };
  if (moveNeedsGpu(m) && !c.gpu) return { state: 'disabled', reason: 'needs_gpu' };
  if (isBeatStrobe(m) && !c.hasBeats) return { state: 'disabled', reason: 'no_music' };
  if ((m.kind === 'sound' || m.kind === 'sticker') && !c.asset) return { state: 'disabled', reason: 'missing_asset' };
  return { state: 'ready' };
}

/**
 * The project asset each pad resolves to (PlanInput.assets, length PAD_COUNT): a built-in sound or element that was added to the
 * library is an asset whose provenance names it. A pad holds a catalogue id, never an asset id; an element's colours are not
 * recorded in provenance, so any asset of that element matches.
 */
export function resolvePadAssets(doc: ProjectDocument, bank: PadBank): (string | null)[] {
  const byProc = new Map<string, string>();
  for (const a of Object.values(doc.assets)) { const id = a.provenance?.procedural?.id; if (id && !byProc.has(`${a.kind}:${id}`)) byProc.set(`${a.kind}:${id}`, a.id); }
  return Array.from({ length: PAD_COUNT }, (_, i) => {
    const m = bank[i];
    if (!m) return null;
    if (m.kind === 'sound') return byProc.get(`audio:${m.source.sfxId}`) ?? null;
    if (m.kind === 'sticker') return byProc.get(`image:${m.source.elementId}`) ?? null;
    return null;
  });
}

// ---------------------------------------------------------------- planning
export interface Planner {
  performGrid: typeof realGrid; quantiseTaps: typeof realQuantise; planPerformance: typeof realPlan;
  flashSchedule: (doc: ProjectDocument, sequenceId?: string) => FlashSchedule;
}
export const realPlanner: Planner = { performGrid: realGrid, quantiseTaps: realQuantise, planPerformance: realPlan, flashSchedule: realSchedule };

export interface TakeContext { bank: PadBank; assets: readonly (string | null)[]; settings: QuantiseSettings; gpu: boolean; sequenceId?: string }
export type PlanFailure = { kind: 'not_built' } | { kind: 'refused'; message: string };
const failure = (e: unknown): PlanFailure => (e instanceof Error && /is not built yet/.test(e.message) ? { kind: 'not_built' } : { kind: 'refused', message: e instanceof Error ? e.message : String(e) });

const COMMIT = { idSeed: 'perform_', actor: 'perform-preview', allowInternal: true } as const;
const sameLength = (a: ProjectDocument, b: ProjectDocument) => T.eq(sequenceDuration(a), sequenceDuration(b));

export interface LiveResult { doc: ProjectDocument | null; failure?: PlanFailure }
/**
 * The picture of a take in progress: the RAW taps (no snap; an open hit closed at `nowSec`), planned and applied to an
 * in-memory document, WITHOUT sound pads (so the player's sound plan is unchanged and setPictureDoc keeps the music playing) and
 * with the same length as the base. Never committed; null when nothing is drawable yet.
 */
export function liveDocument(base: ProjectDocument, taps: readonly Tap[], c: TakeContext, planner: Planner = realPlanner): LiveResult {
  try {
    const bank: PadBank = c.bank.map((m) => (m && m.kind === 'sound' ? null : m));
    const usable = taps.filter((t) => bank[t.pad]);
    if (!usable.length) return { doc: null };
    const settings: QuantiseSettings = { ...c.settings, snap: 'off', strength: 0 };
    const hits = planner.quantiseTaps(usable, [], settings, base.settings.frameRate, bank);
    const planned = planner.planPerformance(base, { ...(c.sequenceId ? { sequenceId: c.sequenceId } : {}), hits, bank, assets: c.assets, settings, gpu: c.gpu });
    if (!planned.args) return { doc: null };
    const doc = applyTransaction(base, [{ op: 'apply_take', args: planned.args }], COMMIT).doc;
    return sameLength(base, doc) ? { doc } : { doc: null };
  } catch (e) { return { doc: null, failure: failure(e) }; }
}

export interface TakePlan { hits: Hit[]; planned: PlannedTake; ghost: ProjectDocument | null; chips: Chip[]; grid: number }
/**
 * After the stop: the beat grid, the snapped hits, the plan, and the ghost (the plan applied in memory, WITH its sound, shown for
 * review while the revision does not move). Chips of strobe hits the flash schedule did not keep on the ghost are marked held.
 */
export function planTake(base: ProjectDocument, taps: readonly Tap[], c: TakeContext, planner: Planner = realPlanner): TakePlan | PlanFailure {
  try {
    const grid = c.settings.snap === 'off' ? [] : planner.performGrid(base, c.settings, c.sequenceId);
    const hits = planner.quantiseTaps(taps, grid, c.settings, base.settings.frameRate, c.bank);
    const input: PlanInput = { ...(c.sequenceId ? { sequenceId: c.sequenceId } : {}), hits, bank: c.bank, assets: c.assets, settings: c.settings, gpu: c.gpu };
    const planned = planner.planPerformance(base, input);
    const ghost = planned.args ? applyTransaction(base, [{ op: 'apply_take', args: planned.args }], COMMIT).doc : null;
    const chips = ghost ? markStrobeHolds(base, ghost, planned.chips, c.bank, planner, c.sequenceId) : planned.chips;
    return { hits, planned, ghost, chips, grid: grid.length };
  } catch (e) { return failure(e); }
}

/**
 * A strobe the plan kept is still drawn only on the frames the document's flash schedule keeps (the strobe walks the timeline's
 * own beat grid and the gap rule): a kept strobe chip whose clip shows no flash inside its range is held `flash_limit`.
 */
export function markStrobeHolds(base: ProjectDocument, ghost: ProjectDocument, chips: readonly Chip[], bank: PadBank, planner: Planner, sequenceId?: string): Chip[] {
  const seqId = sequenceId ?? ghost.mainSequenceId;
  const strobePads = new Set(bank.flatMap((m, i) => (m && isBeatStrobe(m) ? [i] : [])));
  if (!strobePads.size || !chips.some((c) => c.state !== 'held' && strobePads.has(c.pad))) return [...chips];
  const sched = planner.flashSchedule(ghost, seqId);
  const before = new Set((base.sequences[seqId]?.tracks ?? []).flatMap((t) => t.clips.map((c) => c.id)));
  const rate = ghost.settings.frameRate;
  const made: { from: number; to: number; shown: Float64Array | undefined }[] = [];
  for (const t of ghost.sequences[seqId]?.tracks ?? []) for (const c of t.clips) {
    if (c.type !== 'adjustment' || before.has(c.id)) continue;
    for (const e of c.effects ?? []) {
      if (e.type !== 'light.strobe') continue;
      const from = T.frameIndexAt(c.start, rate);
      made.push({ from, to: from + Math.max(1, T.frameIndexAt(c.duration, rate)), shown: sched.shown.get(`${c.id}\n${e.id}`) });
    }
  }
  return chips.map((chip) => {
    if (chip.state === 'held' || !strobePads.has(chip.pad)) return chip;
    const m = made.find((x) => x.from === chip.frame);
    if (!m || (m.shown && Array.from(m.shown).some((f) => f >= m.from && f < m.to))) return chip;
    return { ...chip, state: 'held' as const, reason: 'flash_limit' as const };
  });
}

export interface ChipCounts { kept: number; merged: number; held: number; byReason: Partial<Record<NonNullable<Chip['reason']>, number>> }
export function countChips(chips: readonly Chip[]): ChipCounts {
  const r: ChipCounts = { kept: 0, merged: 0, held: 0, byReason: {} };
  for (const c of chips) { r[c.state]++; if (c.state === 'held' && c.reason) r.byReason[c.reason] = (r.byReason[c.reason] ?? 0) + 1; }
  return r;
}
