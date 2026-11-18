/**
 * Perform mode's browser preferences (ADR-0025; contract.ts PerformPrefs, key PERFORM_PREFS_KEY): tap calibration, snap
 * settings, the «בלי הבזקים» switch, the bank in use with the pads a person edited, and the camera dials. Per browser, never
 * project state. Parsing never throws: a corrupt value, a value of another shape or a blocked storage gives the defaults, field
 * by field (a good snap setting survives a broken bank).
 */
import { DEFAULT_CAMERA, DEFAULT_QUANTISE, PadBankSchema, QuantiseSettingsSchema } from '@pulseframe/core';
import { CALIBRATION_LATENCY_DRIFT_MS, PERFORM_PREFS_KEY, type PerformPrefs } from './contract.ts';

export const defaultPrefs = (): PerformPrefs => ({
  tap: null, settings: { ...DEFAULT_QUANTISE }, noFlashes: false, bankId: 'canvas', bank: null,
  camera: { settleSeconds: DEFAULT_CAMERA.settleSeconds, leadSeconds: DEFAULT_CAMERA.leadSeconds, sway: DEFAULT_CAMERA.sway },
});

const num = (v: unknown, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads a stored value of any shape; every field that is not valid falls back to its default. */
export function parsePrefs(raw: unknown): PerformPrefs {
  const out = defaultPrefs();
  if (!isObj(raw)) return out;
  const tap = raw.tap;
  if (isObj(tap) && typeof tap.calibratedAt === 'string' && Number.isFinite(Date.parse(tap.calibratedAt))) {
    const offsetMs = num(tap.offsetMs, -500, 500, NaN), outputLatencyMs = num(tap.outputLatencyMs, 0, 5000, NaN);
    if (!Number.isNaN(offsetMs) && !Number.isNaN(outputLatencyMs)) out.tap = { offsetMs, outputLatencyMs, calibratedAt: tap.calibratedAt };
  }
  const s = QuantiseSettingsSchema.safeParse(raw.settings);
  if (s.success) out.settings = s.data;
  if (typeof raw.noFlashes === 'boolean') out.noFlashes = raw.noFlashes;
  if (raw.bankId === 'canvas' || raw.bankId === 'gpu') out.bankId = raw.bankId;
  if (raw.bank !== null && raw.bank !== undefined) { const b = PadBankSchema.safeParse(raw.bank); if (b.success) out.bank = b.data; }
  if (isObj(raw.camera)) {
    out.camera = {
      settleSeconds: num(raw.camera.settleSeconds, 0.1, 3, out.camera.settleSeconds),
      leadSeconds: num(raw.camera.leadSeconds, 0, 0.5, out.camera.leadSeconds),
      sway: num(raw.camera.sway, 0, 1, out.camera.sway),
    };
  }
  return out;
}

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem'>;
const defaultStore = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadPrefs(storage: ReadStore | null = defaultStore()): PerformPrefs {
  try {
    const text = storage?.getItem(PERFORM_PREFS_KEY);
    return text ? parsePrefs(JSON.parse(text)) : defaultPrefs();
  } catch { return defaultPrefs(); }
}
/** false when the browser refuses (private window, blocked site data): the view then works for this visit and says nothing is remembered. */
export function savePrefs(p: PerformPrefs, storage: WriteStore | null = defaultStore()): boolean {
  try { if (!storage) return false; storage.setItem(PERFORM_PREFS_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

export type CalibrationState =
  | { state: 'none' }
  | { state: 'stale'; offsetMs: number; calibratedAt: string }
  | { state: 'ok'; offsetMs: number; calibratedAt: string };
/**
 * «לא כויל» until a calibration is stored, and again when the output latency moved more than CALIBRATION_LATENCY_DRIFT_MS from
 * the one it was measured with. `ok` only says the stored offset is current: nothing is ever called "in sync" (latency is not checked).
 * `currentLatencyMs` null (no audio device yet) keeps the stored value.
 */
export function calibrationState(p: PerformPrefs, currentLatencyMs: number | null): CalibrationState {
  if (!p.tap) return { state: 'none' };
  const { offsetMs, outputLatencyMs, calibratedAt } = p.tap;
  if (currentLatencyMs !== null && Math.abs(currentLatencyMs - outputLatencyMs) > CALIBRATION_LATENCY_DRIFT_MS) return { state: 'stale', offsetMs, calibratedAt };
  return { state: 'ok', offsetMs, calibratedAt };
}
/** The offset the capture subtracts, in seconds: 0 until calibrated (and when stale: the stale value is not trusted). */
export const offsetSeconds = (c: CalibrationState): number => (c.state === 'ok' ? c.offsetMs / 1000 : 0);
