/**
 * The server rows of «בדיקת המחשב» (wave 8 booth; verify C3, row by row). Every row is core BoothCheckRow: a state, a reason code and
 * allow-listed scalars, parsed with BoothCheckRowSchema before it is answered. No `detail`, `message`, error text, path, user, host,
 * address or money field from any service ever reaches a row: each runner picks the fields it names and nothing else. The words are the
 * web's, from packages/i18n/src/booth.ts by (row id, state, code).
 *
 * Heavy rows (export-gpu, speech, search) and the export strip answer 'skipped' (code 'busy') / 409 booth_busy while a job of
 * BOOTH_BUSY_JOB_TYPES is queued or running, a built-in music render is running (music fit renders there, not as a job), or the strip
 * itself runs. A timeout is 'unknown' (code 'timeout'; export-gpu: 'searching', since the render host's GPU search cannot be
 * cancelled and goes on in the background — its result appears in the command window).
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { BOOTH_CHECKS, BoothCheckRowSchema, BOOTH_CHECK_TEXT, MUSIC_KITS, type BoothCheckRow, type BoothServerCheckId } from '@pulseframe/core';
import { canRasteriseSvg } from '../elements.ts';
import type { Principal } from '../governance.ts';
import { listMusicKits } from '../instruments/routes.ts';
import { libraryServiceFor } from '../library/index.ts';
import { musicQueue } from '../music.ts';
import { ffmpegVersionText } from '../renderCacheEnv.ts';
import { freeDiskBytes } from '../storage.ts';
import type { Store } from '../store.ts';
import { BOOTH_BUSY_JOB_KINDS, type BoothRouteDeps } from './contract.ts';

/**
 * The job type strings of the store's jobs table behind each of BOOTH_BUSY_JOB_KINDS (pinned in checks.test.ts against the code that
 * creates them). 'still': a still is not a job (Exporter.renderStill runs in the request); colour match renders its stills inside
 * 'analysis' jobs, so every analysis job counts. 'music-fit': not a job either; a running music render counts (musicQueue.stats()).
 */
export const BOOTH_BUSY_JOB_TYPES: Readonly<Record<(typeof BOOTH_BUSY_JOB_KINDS)[number], readonly string[]>> = {
  export: ['export'],
  still: ['analysis'],
  transcription: ['transcribe', 'speech-model-download'],
  narration: ['narration'],
  scan: ['search-index', 'moments', 'import'],
  'music-fit': [],
};
/** Also counted: jobs that hold the graphics card or start Python the same way (ComfyUI capabilities, the local assistant, tracking). */
export const BOOTH_BUSY_ALSO: readonly string[] = ['capability', 'assistant.propose', 'tracking', 'stabilise'];
const BUSY_TYPES = [...new Set([...Object.values(BOOTH_BUSY_JOB_TYPES).flat(), ...BOOTH_BUSY_ALSO])];

let stripRuns = 0;
/** The export strip marks itself as running work (a second strip or a heavy row waits for it). */
export async function asStrip<T>(fn: () => Promise<T>): Promise<T> {
  stripRuns++;
  try { return await fn(); } finally { stripRuns--; }
}
/** Is other work running now? Answers which kinds only as a count (nothing about whose project). */
export function boothBusy(store: Store): boolean {
  const q = `SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','cancel-requested') AND type IN (${BUSY_TYPES.map(() => '?').join(',')})`;
  const n = (store.db.prepare(q).get(...BUSY_TYPES) as { n: number }).n;
  return n > 0 || musicQueue.stats().running === true || stripRuns > 0;
}

/** This machine's user name, home folder and host name (scrubNote's literals; each read may fail, then it is left out). */
export function machineLiterals(): string[] {
  const out: string[] = [];
  for (const f of [() => os.userInfo().username, () => os.homedir(), () => os.hostname()]) { try { const v = f(); if (v) out.push(v); } catch { /* not readable here */ } }
  return out;
}
/** Paths (C:\…, C:/…, \\host\…, //host/…, ~/…, /abs/…, anything with a backslash) and e-mail addresses inside a service's text. */
const PATHISH = /(?:[A-Za-z]:[\\/]|\\\\|\/\/)\S*|(?<=^|\s)[~/]\S*|\S*\\\S*|[^\s@]+@[^\s@]+/g;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A service's text (a version line, an adapter description, a launch mode) as a row may carry it: this machine's user, home and host
 * names removed (case-insensitive), every path-like or e-mail-like token removed whole, then the allowed characters only (everything
 * else becomes a space), at most 120. Milder than scrubNote on purpose: a version line keeps «www.gyan.dev» and «2000-2024».
 */
export function safeText(t: string, literals: readonly string[] = machineLiterals()): string {
  let s = t.replace(PATHISH, ' ');
  for (const l of [...literals].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(`(?<![A-Za-z0-9])${esc(l)}(?![A-Za-z0-9])`, 'gi'), ' ');
  return rowText(s);
}
/** The allowed characters only (everything else becomes a space), at most 120. */
export function rowText(t: string): string {
  const s = t.replace(/[^A-Za-z0-9 ._+|()=,-]/g, ' ').replace(/ +/g, ' ').trim().slice(0, 120);
  return BOOTH_CHECK_TEXT.test(s) ? s : '';
}
const row = (id: BoothServerCheckId, state: BoothCheckRow['state'], code: string | null, data: BoothCheckRow['data'] = {}): BoothCheckRow => BoothCheckRowSchema.parse({ id, state, code, data });

const execText = (cmd: string, args: string[], ms: number) => new Promise<string>((resolve, reject) => {
  execFile(cmd, args, { timeout: ms, killSignal: 'SIGKILL', maxBuffer: 4 << 20, windowsHide: true }, (err, stdout) => (err ? reject(new Error('spawn failed')) : resolve(String(stdout))));
});
let encodersText: Promise<string> | null = null;
/** `ffmpeg -hide_banner -encoders`, once per process (one spawn). */
const ffmpegEncoders = () => { encodersText ??= execText('ffmpeg', ['-hide_banner', '-encoders'], 15_000); encodersText.catch(() => { encodersText = null; }); return encodersText; };
/** The encoders the row reports as present in the installation (never tried: presence is not use). */
export const BOOTH_ENCODERS = ['libx264', 'aac', 'libopus', 'h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'h264_amf'] as const;
const HW = ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'h264_amf'] as const;
/** Encoder names from `-encoders` output (lines like " V....D libx264  libx264 H.264 …"). */
export function parseEncoders(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) { const m = /^\s*[VAS][A-Z.]{5}\s+([A-Za-z0-9_-]+)\s/.exec(line); if (m) out.add(m[1]!); }
  return out;
}

/** What the runners may call (index/http pass the real services; a test passes labelled stand-ins). */
export interface BoothCheckDeps extends Pick<BoothRouteDeps, 'cfg' | 'store' | 'renderHost' | 'speech' | 'assistant' | 'search' | 'door' | 'musicKits'> {
  owner: Principal;
  /** TEST seams; absent = the product's own functions */
  probes?: Partial<{ ffmpegVersion: () => Promise<string>; encoders: () => Promise<string>; svg: () => Promise<boolean>; freeDisk: (dir: string) => number | null; now: () => number }>;
}
/** The export worker's adapter as last found by row export-gpu (an answer on another adapter then reads 'changed'). */
let lastExportAdapter: string | null = null;
export const lastExportGpuAdapter = () => lastExportAdapter;
/** Free space below this is `setup` with code 'low' (a rule of thumb: an export of a family film and its cache need a few GB). */
export const BOOTH_DISK_LOW_BYTES = 5 * 2 ** 30;

const timeout = <T>(p: Promise<T>, ms: number) => new Promise<T | typeof TIMEOUT>((resolve, reject) => {
  const t = setTimeout(() => resolve(TIMEOUT), ms);
  t.unref?.();
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
const TIMEOUT = Symbol('timeout');

type Runner = (d: BoothCheckDeps) => Promise<BoothCheckRow>;
const RUNNERS: Record<BoothServerCheckId, Runner> = {
  'export-gpu': async (d) => {
    if (!d.renderHost) return row('export-gpu', 'off', 'no_render_host');
    const id = await timeout(d.renderHost.identity(true), timeoutOf('export-gpu'));
    if (id === TIMEOUT) return row('export-gpu', 'unknown', 'searching');
    const parts = (id.adapter ?? '').split('|');
    const data = { launch: safeText(id.launch), version: safeText(id.version), vendor: safeText(parts[0] ?? ''), architecture: safeText(parts[1] ?? ''), adapter: safeText(id.adapter ?? ''), software: id.softwareAdapter };
    if (!id.adapter) return row('export-gpu', 'fail', 'no_gpu_device', data);
    lastExportAdapter = data.adapter || null;
    // never ok on a software rasteriser: it is not a check of the graphics card
    if (id.softwareAdapter) return row('export-gpu', 'fail', 'software_adapter', data);
    return row('export-gpu', 'ok', null, data);
  },
  ffmpeg: async (d) => {
    let version: string;
    try { version = safeText((await (d.probes?.ffmpegVersion ?? ffmpegVersionText)()).split(/\r?\n/)[0] ?? ''); } catch { return row('ffmpeg', 'off', 'not_installed'); }
    let encoders: Set<string>;
    try { encoders = parseEncoders(await (d.probes?.encoders ?? ffmpegEncoders)()); } catch { return row('ffmpeg', 'fail', 'encoders_unreadable', { version }); }
    const data: BoothCheckRow['data'] = { version, encoders: encoders.size };
    for (const e of BOOTH_ENCODERS) data[e] = encoders.has(e);
    return row('ffmpeg', 'ok', HW.some((e) => encoders.has(e)) ? 'encoder_present' : 'encoder_absent', data);
  },
  svg: async (d) => ((await (d.probes?.svg ?? canRasteriseSvg)()) ? row('svg', 'ok', null, { rasterise: true }) : row('svg', 'off', 'no_svg_rasteriser', { rasterise: false })),
  library: async (d) => {
    // status(false): the non-owner shape, which carries no root; only the state and counts are taken from it
    const s = await libraryServiceFor(d.cfg).status(false);
    const items = Object.values(s.counts).reduce((n, x) => n + (x ?? 0), 0);
    const data = { state: s.state, items, kinds: Object.keys(s.counts).length };
    if (s.state === 'ready') return row('library', 'ok', null, data);
    if (s.state === 'indexing') return row('library', 'ok', 'indexing', data);
    if (s.state === 'not_configured') return row('library', 'setup', 'not_configured', data);
    return row('library', 'fail', s.state, data);
  },
  kit: async (d) => {
    const { kits } = await listMusicKits(d.cfg, d.musicKits ?? MUSIC_KITS);
    const ready = kits.filter((k) => k.state === 'ready').length;
    const first = kits.find((k) => k.state !== 'ready');
    const reason = first?.reason && /^[a-z][a-z0-9_]{0,47}$/.test(first.reason) ? first.reason : '';
    const data = { kits: kits.length, ready, ...(first ? { state: first.state } : {}), ...(reason ? { reason } : {}) };
    if (!kits.length) return row('kit', 'off', 'no_kit', data);
    return ready === kits.length ? row('kit', 'ok', null, data) : row('kit', 'setup', first!.state, data);
  },
  speech: async (d) => {
    const s = await timeout(d.speech.status(), timeoutOf('speech'));
    if (s === TIMEOUT) return row('speech', 'unknown', 'timeout');
    const enumOf = (r: string | null) => (r && /^[a-z_]{1,40}$/.test(r) ? r : 'ready');
    const t = s.transcription, n = s.narration;
    const data = { transcriptionReady: t.ready, transcription: enumOf(t.reason), narrationReady: n.ready, narration: enumOf(n.reason), ...(t.device === 'cuda' || t.device === 'cpu' ? { device: t.device } : {}) };
    if (t.ready && n.ready) return row('speech', 'ok', null, data);
    const reasons = [t.reason, n.reason];
    if (reasons.includes('engine_not_working')) return row('speech', 'fail', 'engine_not_working', data);
    if (reasons.includes('engine_not_configured')) return row('speech', 'setup', 'not_installed', data);
    return row('speech', 'setup', 'model_missing', data);
  },
  assistant: async (d) => {
    const s = d.assistant.status(d.owner) as { setup?: unknown };
    const setup = typeof s?.setup === 'string' && /^[a-z_]{1,40}$/.test(s.setup) ? s.setup : 'unknown';
    // the setup word only: never the adapter, host, model, prices, limits, spending or the key
    return setup === 'ready' ? row('assistant', 'ok', null, { setup }) : row('assistant', 'setup', setup === 'provider_not_configured' ? 'not_installed' : setup, { setup });
  },
  search: async (d) => {
    const s = await timeout(d.search.setup(), timeoutOf('search'));
    if (s === TIMEOUT) return row('search', 'unknown', 'timeout');
    const data = { setup: s.code, ...(s.device ? { device: s.device } : {}) };
    if (s.code === 'ready') return row('search', 'ok', null, data);
    if (s.code === 'not_built') return row('search', 'off', 'not_built', data);
    if (s.code === 'engine_not_configured') return row('search', 'setup', 'not_installed', data);
    if (s.code === 'engine_not_working') return row('search', 'fail', 'engine_not_working', data);
    return row('search', 'setup', s.code, data);
  },
  disk: async (d) => {
    const free = (d.probes?.freeDisk ?? freeDiskBytes)(d.cfg.dataDir);
    if (free === null || !Number.isSafeInteger(Math.floor(free))) return row('disk', 'unknown', 'not_measured');
    const data = { freeBytes: Math.floor(free), freeGiB: Math.floor(free / 2 ** 30) };
    return free < BOOTH_DISK_LOW_BYTES ? row('disk', 'setup', 'low', data) : row('disk', 'ok', null, data);
  },
  drop: async (d) => {
    // the count of addresses only: never an address, and the door is never opened here
    if (!d.door) return row('drop', 'off', 'cannot_open', { addresses: 0 });
    const n = d.door.addresses().length;
    return n > 0 ? row('drop', 'ok', 'can_open', { addresses: n }) : row('drop', 'off', 'cannot_open', { addresses: 0 });
  },
};
const timeoutOf = (id: BoothServerCheckId) => BOOTH_CHECKS.find((c) => c.id === id)!.timeoutMs;
export const BOOTH_SERVER_CHECK_IDS = BOOTH_CHECKS.filter((c) => c.side === 'server').map((c) => c.id) as BoothServerCheckId[];
export const isServerCheck = (id: string): id is BoothServerCheckId => (BOOTH_SERVER_CHECK_IDS as string[]).includes(id);

/** One server row: busy → skipped for a heavy row; its own timeout; a throw is 'fail' with code 'error' (never its message). */
export async function runBoothCheck(id: BoothServerCheckId, d: BoothCheckDeps): Promise<BoothCheckRow> {
  const def = BOOTH_CHECKS.find((c) => c.id === id)!;
  if (def.heavy && boothBusy(d.store)) return row(id, 'skipped', 'busy');
  try {
    const r = await timeout(RUNNERS[id](d), def.timeoutMs + 1_000);
    return r === TIMEOUT ? row(id, 'unknown', id === 'export-gpu' ? 'searching' : 'timeout') : BoothCheckRowSchema.parse(r);
  } catch {
    return row(id, 'fail', 'error');
  }
}
