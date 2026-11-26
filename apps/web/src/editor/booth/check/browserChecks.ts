/**
 * The browser rows of «בדיקת המחשב» (wave 8 booth; core BOOTH_CHECKS side 'browser': browser-gpu, browser-codecs, mic). BUILDER W2.
 * browser-gpu uses ONLY the adapter part of apps/web/src/gpuProbe.ts (split into gpuProbe.logic.ts: no 120-pass timing sample, no DOM
 * side effects); data: vendor, architecture, adapter (`${vendor}|${architecture}|${device}|${description}`, ASCII), software, discrete.
 * browser-codecs: hardware/software encode and decode states for H.264/HEVC/AV1 and AAC encode, no speed claim. mic: permissions.query,
 * never a prompt (getUserMedia is not in this file). Rows are parsed with core BoothCheckRowSchema before they leave this file; a row
 * that does not answer within its timeout (core BOOTH_CHECKS) is 'unknown'. Results are kept in localStorage by the dialog (W3).
 *
 * `discrete` is decided by the adapter's VENDOR name only (NVIDIA, AMD, ATI): it is a heuristic, and an AMD chip inside the processor
 * reads as discrete. The row says what the browser reported; the Windows graphics setting is the owner's to read, not this file's to guess.
 */
import { BOOTH_CHECKS, BOOTH_LIMITS, BoothCheckRowSchema, type BoothBrowserCheckId, type BoothCheckRow } from '@pulseframe/core';
import type { BrowserCheckRunner } from '../booth.contract.ts';
import { describeAdapter, type AdapterDescription, type GpuLike } from '../../../gpuProbe.logic.ts';

/** What the rows read from the browser: injected so the tests need no browser. */
export interface BrowserCheckEnv {
  gpu?: GpuLike | undefined;
  permissions?: { query(d: { name: string }): Promise<{ state: string }> } | undefined;
  /** the WebCodecs classes, or undefined when the browser has none */
  VideoEncoder?: { isConfigSupported(c: Record<string, unknown>): Promise<{ supported?: boolean }> } | undefined;
  VideoDecoder?: { isConfigSupported(c: Record<string, unknown>): Promise<{ supported?: boolean }> } | undefined;
  AudioEncoder?: { isConfigSupported(c: Record<string, unknown>): Promise<{ supported?: boolean }> } | undefined;
}

export function browserEnv(): BrowserCheckEnv {
  const g = globalThis as Record<string, unknown>;
  const nav = (g.navigator ?? {}) as { gpu?: GpuLike; permissions?: BrowserCheckEnv['permissions'] };
  return { gpu: nav.gpu, permissions: nav.permissions, VideoEncoder: g.VideoEncoder as BrowserCheckEnv['VideoEncoder'], VideoDecoder: g.VideoDecoder as BrowserCheckEnv['VideoDecoder'], AudioEncoder: g.AudioEncoder as BrowserCheckEnv['AudioEncoder'] };
}

/** Printable ASCII the row schema allows (core BOOTH_CHECK_TEXT); anything else becomes `_`; at most `max` characters. */
export function asciiText(s: string | null | undefined, max = 120): string {
  return (s ?? '').replace(/[^A-Za-z0-9 ._+|(),=-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** `${vendor}|${architecture}|${device}|${description}`, ASCII, at most 120 characters (the row's own limit; the answer's is BOOTH_LIMITS.adapterChars). */
export function adapterString(a: Pick<AdapterDescription, 'vendor' | 'architecture' | 'device' | 'description'>): string {
  return asciiText([a.vendor, a.architecture, a.device, a.description].map((x) => asciiText(x, 60)).join('|'), Math.min(120, BOOTH_LIMITS.adapterChars));
}
const DISCRETE_VENDOR = /\b(nvidia|amd|ati|advanced micro devices)\b/i;
const SOFTWARE_WORDS = /swiftshader|llvmpipe|basic render|software|warp\b/i;
export const isDiscreteVendor = (vendor: string | null | undefined): boolean => DISCRETE_VENDOR.test(vendor ?? '');
export const isIntegratedVendor = (vendor: string | null | undefined): boolean => /\bintel\b/i.test(vendor ?? '');
/** The adapter is a fallback (software) one: the browser says so, or its names say so. */
export function isSoftwareAdapter(a: Pick<AdapterDescription, 'vendor' | 'architecture' | 'device' | 'description' | 'isFallbackAdapter'>): boolean {
  return a.isFallbackAdapter === true || SOFTWARE_WORDS.test([a.vendor, a.architecture, a.device, a.description].join(' '));
}

type Row = Omit<BoothCheckRow, 'id'>;

export async function gpuRow(env: BrowserCheckEnv): Promise<Row> {
  if (!env.gpu) return { state: 'off', code: null, data: { api: false } };
  const a = await describeAdapter(env.gpu, 'high-performance');
  if (!a) return { state: 'off', code: null, data: { api: true, adapterFound: false } };
  if ('error' in a) return { state: 'fail', code: null, data: { api: true, adapterFound: false } };
  const software = isSoftwareAdapter(a);
  const discrete = !software && isDiscreteVendor(a.vendor);
  const data = { api: true, adapterFound: true, vendor: asciiText(a.vendor, 40), architecture: asciiText(a.architecture, 40), adapter: adapterString(a), software, discrete };
  if (software) return { state: 'setup', code: 'software_adapter', data };
  if (!discrete && isIntegratedVendor(a.vendor)) return { state: 'ok', code: 'integrated', data };
  return { state: 'ok', code: null, data };
}

const CODECS = { h264: 'avc1.640028', hevc: 'hvc1.1.6.L93.B0', av1: 'av01.0.04M.08' } as const;
const yes = async (f: () => Promise<{ supported?: boolean }>) => { try { return !!(await f()).supported; } catch { return false; } };
/** 'hardware' (the browser accepts the hardware-preferring setting), 'software' (only the plain one), 'none'. A configuration is accepted or not: this says nothing about speed. */
async function level(plain: () => Promise<{ supported?: boolean }>, hardware: () => Promise<{ supported?: boolean }>): Promise<'hardware' | 'software' | 'none'> {
  if (await yes(hardware)) return 'hardware';
  return (await yes(plain)) ? 'software' : 'none';
}
export async function codecsRow(env: BrowserCheckEnv): Promise<Row> {
  const enc = env.VideoEncoder, dec = env.VideoDecoder;
  if (!enc || !dec) return { state: 'off', code: null, data: { webcodecs: false } };
  const data: Record<string, boolean | string> = { webcodecs: true };
  for (const [k, codec] of Object.entries(CODECS)) {
    const e = { codec, width: 1920, height: 1080, bitrate: 8e6, framerate: 30 }, d = { codec, codedWidth: 1920, codedHeight: 1080 };
    data[`${k}Encode`] = await level(() => enc.isConfigSupported(e), () => enc.isConfigSupported({ ...e, hardwareAcceleration: 'prefer-hardware' }));
    data[`${k}Decode`] = await level(() => dec.isConfigSupported(d), () => dec.isConfigSupported({ ...d, hardwareAcceleration: 'prefer-hardware' }));
  }
  data.aacEncode = env.AudioEncoder ? (await yes(() => env.AudioEncoder!.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })) ? 'yes' : 'no') : 'no';
  return { state: 'ok', code: null, data };
}

/** The permission only (granted / prompt / denied): never getUserMedia, so never a prompt. */
export async function micRow(env: BrowserCheckEnv): Promise<Row> {
  if (!env.permissions?.query) return { state: 'unknown', code: null, data: { permissionsApi: false } };
  try {
    const s = (await env.permissions.query({ name: 'microphone' })).state;
    if (s === 'granted') return { state: 'ok', code: 'granted', data: { permission: 'granted' } };
    if (s === 'prompt') return { state: 'setup', code: 'prompt', data: { permission: 'prompt' } };
    if (s === 'denied') return { state: 'off', code: 'denied', data: { permission: 'denied' } };
    return { state: 'unknown', code: null, data: { permissionsApi: true } };
  } catch { return { state: 'unknown', code: null, data: { permissionsApi: false } }; }
}

const ROWS: Record<BoothBrowserCheckId, (env: BrowserCheckEnv) => Promise<Row>> = { 'browser-gpu': gpuRow, 'browser-codecs': codecsRow, mic: micRow };
export const timeoutOf = (id: BoothBrowserCheckId): number => BOOTH_CHECKS.find((c) => c.id === id)!.timeoutMs;

/** Runs one row with its own timeout and abort signal; never throws; the answer is parsed with the core schema. */
export async function runBrowserCheckWith(env: BrowserCheckEnv, id: BoothBrowserCheckId, signal: AbortSignal, timeoutMs = timeoutOf(id)): Promise<BoothCheckRow> {
  const unknown: BoothCheckRow = { id, state: 'unknown', code: null, data: {} };
  if (signal.aborted) return unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const late = new Promise<BoothCheckRow>((resolve) => {
    timer = setTimeout(() => resolve(unknown), timeoutMs);
    onAbort = () => resolve(unknown);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const answer = ROWS[id](env).then((r): BoothCheckRow => {
      const parsed = BoothCheckRowSchema.safeParse({ id, ...r });
      return parsed.success ? parsed.data : { id, state: 'unknown', code: 'invalid_row', data: {} };
    }, (): BoothCheckRow => ({ id, state: 'fail', code: null, data: {} }));
    return await Promise.race([answer, late]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export const runBrowserCheck: BrowserCheckRunner = (id, signal) => runBrowserCheckWith(browserEnv(), id, signal);
