/**
 * Perform mode in the editor (ADR-0025; the workspace `perform`, «הופעה»): the web contract. LEAD file — W3 implements the
 * player side (two methods in one marked block at the end of Player, apps/web/src/player.ts) and the view
 * (apps/web/src/editor/perform/*); the lead owns the editor side (PerformHost, built into Editor in store.ts), the mount
 * (Transport.tsx), the mode entry (Header.tsx, Shift+7) and the shortcut rule (shortcutGate.ts, performKeys.ts).
 *
 * One render path: the live take and the ghost are ordinary documents shown through the player's evaluate + compositor
 * (Player.setPictureDoc for the live picture, ADR-0020 — it does not stop the sound when the sound plan is unchanged, so the
 * live document is built WITHOUT sound steps; Editor.showGhost for review). Nothing is committed while playing; accept is ONE
 * POST /takes (one transaction, one undo). The view works on the master only (entering it leaves a viewed format).
 */
import type { CameraSettings, OpCall, PadBank, ProjectDocument, QuantiseSettings, TakeRequest, TakeResult } from '@pulseframe/core';

/** Additions to Player (apps/web/src/player.ts), W3, in ONE marked block at the end of the class. The live picture uses the existing Player.setPictureDoc. */
export interface PerformPlayerPort {
  /**
   * Timeline seconds HEARD at a `performance` time (KeyboardEvent.timeStamp / PointerEvent.timeStamp), through
   * AudioContext.getOutputTimestamp on the audio clock playback follows; null when not playing. The tap calibration is
   * subtracted by the caller, not here.
   */
  timelineSecondsAt(perfMs: number): number | null;
  /** Play a library sound once, now, for monitoring during a take. Not part of the mix and never exported. */
  monitorSound(assetId: string, gain: number): void;
}

/** Additions to Editor (apps/web/src/editor/store.ts), lead-built. */
export interface PerformHost {
  /** The workspace is `perform`. */
  readonly performActive: boolean;
  /** Whether the graphics adapter passed its check in this browser (gpuProbe.ts via EditorState.gpu). */
  readonly gpuReady: boolean;
  /** Multicam live switching owns the digits here (its program is on the video target track): pads then take no number keys. */
  readonly multicamDigitsLive: boolean;
  /** A take is being recorded: only pad keys, Space and Escape act (shortcutGate.ts), and an edit arriving meanwhile is drawn without stopping the sound when it can be. */
  setPerformRecording(on: boolean): void;
  /** Show a planned take for review without committing (the player restarts with its sound); null returns to the committed document. Session state only. */
  showGhost(doc: ProjectDocument | null): void;
  /** POST /takes with the editor's revision as expectedRevision, then reload. Resolves to the result, or null when refused (the refusal is shown). */
  commitTake(req: Omit<TakeRequest, 'expectedRevision' | 'dryRun'>): Promise<TakeResult | null>;
  /** One transaction of a camera plan's ops (three replace_clip_keyframes with the take range), labelled «צלם». Resolves to the new revision, or null. */
  commitCamera(ops: OpCall[]): Promise<number | null>;
}

/** Browser preference (never project state; per browser, not per project: pads hold catalogue ids, never asset ids). */
export const PERFORM_PREFS_KEY = 'pf.perform.v1';
export interface PerformPrefs {
  /** Tap calibration: the median offset, the context's outputLatency when it was measured, and the date. null = «לא כויל». */
  tap: { offsetMs: number; outputLatencyMs: number; calibratedAt: string } | null;
  settings: QuantiseSettings;
  /** Hide pads whose moves change light (and the strobe). */
  noFlashes: boolean;
  /** Which named bank is in use; a pad the person edited replaces that pad of the bank (PadBank, parsed with core PadBankSchema). */
  bankId: 'canvas' | 'gpu';
  bank: PadBank | null;
  camera: Pick<CameraSettings, 'settleSeconds' | 'leadSeconds' | 'sway'>;
}
/** The calibration is «לא כויל» again when the output latency moved more than this from the one it was measured with. */
export const CALIBRATION_LATENCY_DRIFT_MS = 20;
/** Calibration run: clicks, tempo, taps dropped at the start, the largest median absolute deviation accepted. */
export const CALIBRATION = { clicks: 16, bpm: 100, dropFirst: 4, maxMadMs: 40 } as const;
/** The live preview re-plans at most once per animation frame, and only when the hits changed (verifier). */
export const LIVE_REPLAN = 'once-per-animation-frame' as const;
