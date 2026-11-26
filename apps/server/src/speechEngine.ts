/**
 * «התקנת מנוע הדיבור»: the owner installs the speech recognition engine from the editor, with no terminal and no environment
 * variable (SPEC §16, B-7). Lead decisions for this track (wave 8, engines):
 * - The owner's own session only (isOwnerSession; 403 owner_required for agents, observers, propose grants and the phone drop). No
 *   MCP tool. The plan says what will happen (bytes, from pypi.org, into the editor's data folder) before the one confirming press.
 * - Into a virtual environment under the data folder (<dataDir>/engines/speech/venv), created with the Python found on this computer
 *   (`py -3` on Windows, else `python`, else `python3`; the found version must be inside the range the pinned wheels support).
 *   Nothing global is installed or changed: no PATH or registry change, pip's cache off, pip's temporary files inside the folder.
 *   Every process is `spawn` with an argument array (no shell); our own scripts run with `python -I`.
 * - Pinned and hash-checked: `pip install --require-hashes --only-binary=:all: -r apps/server/speech/requirements-speech-<platform>.txt`
 *   (made by apps/server/speech/lock_speech.py; see the file's header).
 * - A durable job (type speech-engine-install): progress in words and numbers, cancellable (a cancel removes the folder), restart-safe
 *   (an install interrupted by a restart is failed and its folder removed at start), never two at once, never while a transcription
 *   or narration is queued or running. Each failure has its own code and next step.
 * - After success the marker file installed.json is written LAST; `installedPython()` answers only when it exists. PF_SPEECH_PYTHON,
 *   when set, still wins (speech.ts asrPython).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOTH_SCRUB_MARK } from '@pulseframe/core';
import type { ComputeLane } from './aiContracts.ts';
import { isOwnerSession } from './assistant/contract.ts';
import type { Principal } from './auth.ts';
import { assertStorageRoom, freeDiskBytes } from './storage.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

export const SPEECH_ENGINE_JOB_TYPE = 'speech-engine-install';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPEECH_REQUIREMENTS_DIR = path.resolve(HERE, '../speech');
const WORKER = path.resolve(HERE, '../speech/pf_speech.py');
/** The versions the post-install probe must report (the root pin of the requirements files and the CTranslate2 it was locked with). */
export const ENGINE_EXPECTED = { fasterWhisper: '1.2.1', ctranslate2: '4.9.0' } as const;
/**
 * Free space asked for before anything is written: the download times this factor. Measured here: the Linux environment of this set
 * is 478 MB on disk for 133 MB of wheels (3.6×); 5× leaves room for the wheels themselves while they are unpacked. Windows not measured.
 */
export const DISK_FACTOR = 5;
export const ENGINE_HOST = 'pypi.org';
const INDEX_URL = 'https://pypi.org/simple';

/** The fixed English stage lines of the job (apps/web/src/editor/engineInstall.logic.ts turns them into words; keep both in step). */
export const ENGINE_STAGES = {
  python: 'finding Python',
  venv: 'creating the environment',
  download: (done: number, total: number) => `downloading ${done} of ${total} files`,
  install: 'installing',
  check: 'checking the engine',
  removing: 'removing the unfinished environment',
} as const;

export type EngineRefusal = 'owner_required' | 'engine_configured_elsewhere' | 'engine_already_installed' | 'engine_install_running' | 'speech_busy' | 'platform_unsupported' | 'download_size_mismatch';
/** The codes a failed install job carries in error.code. Every one has words and a next step in engineInstall.strings.ts. */
export const ENGINE_FAILURES = ['python_not_found', 'python_unsupported', 'python_not_64bit', 'python_no_venv', 'not_enough_disk', 'network_unavailable', 'proxy_refused', 'pip_failed', 'probe_failed', 'interrupted', 'internal_error'] as const;
export type EngineFailure = (typeof ENGINE_FAILURES)[number];

class EngineError extends Error {
  constructor(readonly code: EngineFailure, message: string, readonly details: Record<string, unknown> = {}, readonly hint = '') { super(message); }
}

// ------------------------------------------------------------------------------------------------------ requirements files
export interface Lock { file: string; platformKey: string; minPython: string; maxPython: string; packages: { name: string; version: string; hashes: string[] }[]; downloadBytes: Record<string, number> }
/** Which committed file serves this computer, or null: only Windows x86-64 and Linux x86-64 have one. */
export function lockFileFor(platform: NodeJS.Platform, arch: string): string | null {
  if (arch !== 'x64') return null;
  if (platform === 'win32') return 'requirements-speech-win-amd64.txt';
  if (platform === 'linux') return 'requirements-speech-linux-x86_64.txt';
  return null;
}
export function parseLock(text: string, file: string): Lock {
  const range = /^# SUPPORTED-PYTHON: (\d+\.\d+) (\d+\.\d+)$/m.exec(text);
  if (!range) throw new Error(`${file}: no SUPPORTED-PYTHON line`);
  const downloadBytes: Record<string, number> = {};
  for (const m of text.matchAll(/^# DOWNLOAD-BYTES (\d+\.\d+): (\d+)$/gm)) downloadBytes[m[1]!] = Number(m[2]);
  const packages: Lock['packages'] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)((?: --hash=sha256:[0-9a-f]{64})+)$/.exec(line.trim());
    if (!m) throw new Error(`${file}: not a pinned, hashed line: ${line.slice(0, 80)}`);
    packages.push({ name: m[1]!, version: m[2]!, hashes: [...m[3]!.matchAll(/[0-9a-f]{64}/g)].map((x) => x[0]) });
  }
  return { file, platformKey: file.replace(/^requirements-speech-|\.txt$/g, ''), minPython: range[1]!, maxPython: range[2]!, packages, downloadBytes };
}
const minorOf = (v: string) => v.split('.').slice(0, 2).join('.');
const cmpMinor = (a: string, b: string) => { const [a1, a2] = a.split('.').map(Number), [b1, b2] = b.split('.').map(Number); return a1! - b1! || a2! - b2!; };

// ------------------------------------------------------------------------------------------------------ scrubbing
/**
 * The booth's note rule (packages/core/src/booth/scrub.ts, verify C4b), applied here to pip's and the probe's last lines because
 * scrubNote's body is not in this base yet. INTEGRATOR: once scrubNote is built, call it here instead and keep this file's test.
 * 1. the user name, home folder and host name, literally and case-insensitive (both slash directions for the folder);
 * 2. Windows paths to the end of the segment (spaces included), UNC paths, POSIX absolute paths, ~/ paths, e-mail, URLs, IPv4 and
 *    IPv6 addresses, runs of 7 or more digits.
 */
export function scrubText(text: string, literals: readonly string[] = defaultLiterals()): string {
  let s = text;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lits = [...new Set(literals.filter((x) => x && x.length >= 2).flatMap((x) => [x, x.replaceAll('\\', '/'), x.replaceAll('/', '\\')]))].sort((a, b) => b.length - a.length);
  for (const l of lits) s = s.replace(new RegExp(esc(l), 'gi'), BOOTH_SCRUB_MARK);
  const M = BOOTH_SCRUB_MARK;
  s = s.replace(/[A-Za-z]:[\\/][^\n"'<>|)]*/g, M)
    .replace(/\\\\[^\s\\]+\\[^\n"'<>|)]*/g, M)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, M)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, M)
    .replace(/(^|[\s('"=:])~\/[^\s"'<>)]*/g, `$1${M}`)
    .replace(/(^|[\s('"=])\/(?:[^\s/"'<>)]+\/)*[^\s/"'<>)]+/g, `$1${M}`)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, M)
    .replace(/(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi, (x) => (/[0-9a-f]/i.test(x) && x.includes('::') || x.split(':').length >= 6 ? M : x))
    .replace(/\d{7,}/g, M);
  return s;
}
function defaultLiterals(): string[] {
  const out: string[] = [];
  try { out.push(os.userInfo().username); } catch { /* no user name here */ }
  out.push(os.homedir(), os.hostname());
  return out;
}
const tail = (text: string, lines = 8) => scrubText(text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean).slice(-lines).join('\n')).slice(-1500);

// ------------------------------------------------------------------------------------------------------ processes
export interface RunResult { code: number | null; spawnError: string | null; out: string; err: string }
export interface RunOptions { env?: NodeJS.ProcessEnv; onLine?: (line: string) => void; onKill?: (kill: () => void) => void; timeoutMs?: number }
/** Starts one program with an argument array (never a shell) and collects its output; `spawnError` is the errno code when it could not start. */
export type Runner = (cmd: string, args: string[], o?: RunOptions) => Promise<RunResult>;
export const runProcess: Runner = (cmd, args, o = {}) => new Promise((resolve) => {
  let p: ReturnType<typeof nodeSpawn>;
  try { p = nodeSpawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: o.env ?? process.env, timeout: o.timeoutMs ?? 0, killSignal: 'SIGKILL' }); }
  catch (e: any) { resolve({ code: null, spawnError: String(e?.code ?? 'EUNKNOWN'), out: '', err: '' }); return; }
  let out = '', err = '', buf = '', done = false;
  o.onKill?.(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } });
  const feed = (d: string) => {
    buf += d;
    for (let i = buf.search(/\r?\n/); i >= 0; i = buf.search(/\r?\n/)) { const line = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1)); o.onLine?.(line); }
  };
  p.stdout!.setEncoding('utf8'); p.stderr!.setEncoding('utf8');
  p.stdout!.on('data', (d: string) => { out = (out + d).slice(-20000); feed(d); });
  p.stderr!.on('data', (d: string) => { err = (err + d).slice(-20000); });
  p.on('error', (e: any) => { if (done) return; done = true; resolve({ code: null, spawnError: String(e?.code ?? 'EUNKNOWN'), out, err }); });
  p.on('close', (code) => { if (done) return; done = true; if (buf) o.onLine?.(buf); resolve({ code, spawnError: null, out, err }); });
});

// ------------------------------------------------------------------------------------------------------ the installer
export interface EngineFs { existsSync(p: string): boolean; readFileSync(p: string, enc: 'utf8'): string; writeFileSync(p: string, data: string): void; renameSync(a: string, b: string): void; mkdirSync(p: string, o: { recursive: true }): void; rmSync(p: string, o: { recursive: true; force: true; maxRetries?: number; retryDelay?: number }): void }
export interface EngineDeps {
  run: Runner;
  fs: EngineFs;
  /** Free bytes on the volume of the data folder, or null when it cannot be measured. */
  freeBytes: (dir: string) => number | null;
  platform: NodeJS.Platform;
  arch: string;
  /** Where the requirements files are read from (tests point it at a labelled stand-in). */
  requirementsDir: string;
  /** TEST ONLY: install from this local folder of wheels instead of pypi.org (`--no-index --find-links`). Never set by the server. */
  localWheels?: string;
}
export interface PythonFound { command: string[]; executable: string; version: string; bits: number; venv: boolean; ensurepip: boolean }
export interface EnginePlan {
  supported: boolean;
  /** pypi.org; the editor downloads from nowhere else. */
  host: string;
  python: { found: false; tried: string[] } | { found: true; version: string; fits: boolean; min: string; max: string; bits: number };
  downloadBytes: number | null;
  files: number | null;
  /** Bytes of free space asked for (download × DISK_FACTOR) and what the volume has now. */
  diskNeededBytes: number | null;
  diskFreeBytes: number | null;
  minPython: string | null;
  maxPython: string | null;
}
export interface EngineInstallView {
  /** environment: PF_SPEECH_PYTHON names another environment (it wins); installed: the editor's own; installing; not_installed. */
  state: 'environment' | 'installed' | 'installing' | 'not_installed';
  job: { id: string; status: string; stage: string | null } | null;
  /** The last finished install job's failure (code and scrubbed words), when the latest one failed. */
  lastFailure: { jobId: string; code: string; message: string; details?: unknown } | null;
  plan: EnginePlan;
}
interface Marker { format: 1; requirements: string; requirementsSha256: string; python: string; fasterWhisper: string; ctranslate2: string; finishedAt: string }
export interface EngineHooks {
  /** PF_SPEECH_PYTHON (wins over the installed engine). */
  envPython: () => string | null;
  /** True while a transcription or narration job is queued or running. */
  speechBusy: () => boolean;
  /** Called after an install succeeds or a folder is removed: speech.ts forgets its probe and stops kept workers of this interpreter. */
  changed: () => Promise<void> | void;
}

export class SpeechEngineInstaller {
  readonly root: string;
  readonly venv: string;
  private readonly deps: EngineDeps;
  private kills = new Map<string, () => void>();
  private canceled = new Set<string>();
  private stopped = false;
  private running: Promise<void> | null = null;
  constructor(private store: Store, dataDir: string, private hooks: EngineHooks, private lane: ComputeLane | null = null, deps: Partial<EngineDeps> = {}) {
    this.root = path.join(dataDir, 'engines', 'speech');
    this.venv = path.join(this.root, 'venv');
    this.deps = { run: runProcess, fs: nodeFs, freeBytes: freeDiskBytes, platform: process.platform, arch: process.arch, requirementsDir: SPEECH_REQUIREMENTS_DIR, ...deps };
  }
  private get marker() { return path.join(this.root, 'installed.json'); }
  private get tmp() { return path.join(this.root, 'tmp'); }
  venvPython(): string { return this.deps.platform === 'win32' ? path.join(this.venv, 'Scripts', 'python.exe') : path.join(this.venv, 'bin', 'python'); }
  /** The installed engine's interpreter when the install finished (marker written last) and the interpreter is there; else null. */
  installedPython(): string | null {
    const { fs } = this.deps;
    try {
      const m = JSON.parse(fs.readFileSync(this.marker, 'utf8')) as Partial<Marker>;
      if (m.format !== 1) return null;
    } catch { return null; }
    const py = this.venvPython();
    return fs.existsSync(py) ? py : null;
  }
  private lock(): Lock | null {
    const file = lockFileFor(this.deps.platform, this.deps.arch);
    if (!file) return null;
    return parseLock(this.deps.fs.readFileSync(path.join(this.deps.requirementsDir, file), 'utf8'), file);
  }
  private openJob(): JobRow | null { return this.store.openJobs(SPEECH_ENGINE_JOB_TYPE)[0] ?? null; }

  /** The Python interpreters tried, in order: the Windows launcher first, then python, then python3. */
  private candidates(lock: Lock | null): string[][] {
    const list: string[][] = [];
    if (this.deps.platform === 'win32') {
      list.push(['py', '-3']);
      // the launcher picks the newest Python; when that one is outside the range, a fitting one beside it is asked for by number
      if (lock) for (let m = Number(lock.maxPython.split('.')[1]); m >= Number(lock.minPython.split('.')[1]); m--) list.push(['py', `-3.${m}`]);
    }
    list.push(['python'], ['python3']);
    return list;
  }
  /** Finds the interpreters on this computer: the first one inside the range wins; otherwise the first one found is reported. */
  async findPython(lock: Lock | null): Promise<{ fit: PythonFound | null; first: PythonFound | null; tried: string[] }> {
    const code = 'import sys,json,struct,importlib.util as u;print(json.dumps({"executable":sys.executable,"version":"%d.%d.%d"%sys.version_info[:3],"bits":struct.calcsize("P")*8,"venv":u.find_spec("venv") is not None,"ensurepip":u.find_spec("ensurepip") is not None}))';
    let first: PythonFound | null = null;
    const tried: string[] = [];
    for (const c of this.candidates(lock)) {
      tried.push(c.join(' '));
      const r = await this.deps.run(c[0]!, [...c.slice(1), '-I', '-c', code], { timeoutMs: 30_000 });
      if (r.code !== 0) continue; // not there, or the Microsoft Store's stand-in that only offers to install Python
      let o: any;
      try { o = JSON.parse(r.out.trim().split(/\r?\n/).at(-1) ?? ''); } catch { continue; }
      if (typeof o?.executable !== 'string' || !/^\d+\.\d+\.\d+$/.test(String(o.version))) continue;
      const found: PythonFound = { command: c, executable: o.executable, version: o.version, bits: Number(o.bits), venv: !!o.venv, ensurepip: !!o.ensurepip };
      first ??= found;
      if (lock && this.fits(found, lock)) return { fit: found, first, tried };
    }
    return { fit: null, first, tried };
  }
  private fits(p: PythonFound, lock: Lock) { return cmpMinor(p.version, lock.minPython) >= 0 && cmpMinor(p.version, lock.maxPython) <= 0 && p.bits === 64; }

  async plan(): Promise<EnginePlan> {
    const lock = this.lock();
    const found = await this.findPython(lock);
    const py = found.fit ?? found.first;
    const download = lock ? (py && lock.downloadBytes[minorOf(py.version)]) || Math.max(...Object.values(lock.downloadBytes)) : null;
    return {
      supported: !!lock, host: ENGINE_HOST,
      python: py && lock ? { found: true, version: py.version, fits: this.fits(py, lock), min: lock.minPython, max: lock.maxPython, bits: py.bits } : py ? { found: true, version: py.version, fits: false, min: '', max: '', bits: py.bits } : { found: false, tried: found.tried },
      downloadBytes: download, files: lock ? lock.packages.length : null,
      diskNeededBytes: download ? download * DISK_FACTOR : null, diskFreeBytes: this.deps.freeBytes(this.existingParent(this.root)),
      minPython: lock?.minPython ?? null, maxPython: lock?.maxPython ?? null,
    };
  }
  private existingParent(p: string): string { let d = p; while (!this.deps.fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d); return d; }

  /** What the speech panel shows (owner's own session only). */
  async view(p: Principal): Promise<EngineInstallView> {
    this.assertOwner(p);
    const open = this.openJob();
    const last = (this.store.db.prepare('SELECT id FROM jobs WHERE type = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(SPEECH_ENGINE_JOB_TYPE) as { id: string } | undefined);
    const lastJob = last ? this.store.getJob(last.id) : null;
    const state = this.hooks.envPython() ? 'environment' : open ? 'installing' : this.installedPython() ? 'installed' : 'not_installed';
    return {
      state, job: open ? { id: open.id, status: open.status, stage: open.stage } : null,
      lastFailure: lastJob?.status === 'failed' ? { jobId: lastJob.id, code: lastJob.error?.code ?? 'internal_error', message: lastJob.error?.message ?? '', ...(lastJob.error?.details ? { details: lastJob.error.details } : {}) } : null,
      plan: await this.plan(),
    };
  }
  assertOwner(p: Principal) {
    if (!isOwnerSession(p)) throw new ApiError(403, 'owner_required', 'the speech engine is installed only from the owner\'s own editor window: it runs software on this computer', {}, 'Open the editor from the owner link (start-pulseframe.cmd prints it) and install it in the speech panel there.');
  }

  /** The one confirming press: starts the install job for the exact download size the plan showed. */
  async start(p: Principal, projectId: string, confirmBytes: number, replace = false): Promise<JobRow> {
    this.assertOwner(p);
    this.store.getProject(projectId);
    if (this.hooks.envPython()) throw new ApiError(409, 'engine_configured_elsewhere', 'PF_SPEECH_PYTHON names another speech environment, and it is the one used', {}, 'Start the editor without PF_SPEECH_PYTHON to use an engine installed from here.');
    if (this.openJob()) throw new ApiError(409, 'engine_install_running', 'the speech engine is being installed already', {}, 'Wait for it to finish, or cancel it.');
    // replace: the owner installs again over an installed engine that does not answer (the folder is removed first)
    if (this.installedPython() && !replace) throw new ApiError(409, 'engine_already_installed', 'the speech engine is installed already', {}, 'Nothing to do; if it does not work, the speech panel offers to install it again.');
    if (this.hooks.speechBusy()) throw new ApiError(409, 'speech_busy', 'a transcription or narration is waiting or running, and it uses the speech engine', {}, 'Wait until it finishes, or cancel it, then install.');
    const lock = this.lock();
    if (!lock) throw new ApiError(409, 'platform_unsupported', `the speech engine can be installed from here on Windows and Linux on 64-bit Intel/AMD processors only (this computer: ${this.deps.platform} ${this.deps.arch})`, { platform: this.deps.platform, arch: this.deps.arch }, 'Set it up by hand as docs/INTEGRATIONS.md describes, or type or import a transcript.');
    const plan = await this.plan();
    if (confirmBytes !== plan.downloadBytes) throw new ApiError(409, 'download_size_mismatch', `this install downloads ${plan.downloadBytes} bytes; confirmBytes was ${confirmBytes}`, { downloadBytes: plan.downloadBytes }, 'Read the plan again and confirm the size shown.');
    assertStorageRoom(this.store, plan.downloadBytes! * DISK_FACTOR, 'install the speech engine');
    const job = this.store.createJob(projectId, SPEECH_ENGINE_JOB_TYPE, p.actor, { requirements: lock.file, approvedBytes: plan.downloadBytes, host: ENGINE_HOST, ...(replace ? { replace: true } : {}) });
    if (replace) { this.deps.fs.rmSync(this.marker, { recursive: true, force: true }); await this.hooks.changed(); }
    this.running = this.drive(job.id).finally(() => { this.running = null; });
    return job;
  }
  /** Settles when the current install (if any) has finished: for tests and for stop(). */
  async idle() { await this.running; }

  private stage(jobId: string, stage: string) { if (!this.canceled.has(jobId)) this.store.updateJob(jobId, { stage }); }
  private check(jobId: string) { if (this.canceled.has(jobId) || this.stopped) throw new Canceled(); }
  private async drive(jobId: string) {
    const { fs } = this.deps;
    let release: (() => void) | null = null;
    try {
      this.store.updateJob(jobId, { status: 'running', stage: ENGINE_STAGES.python, attempt: 1 });
      if (this.lane) {
        const ctl = new AbortController();
        this.kills.set(jobId, () => ctl.abort());
        const holder = this.lane.busy().holder;
        if (holder) this.stage(jobId, `queued (waiting for compute: ${holder})`);
        try { release = await this.lane.acquire(`speech engine install (${jobId})`, ctl.signal); } catch (e) { if (ctl.signal.aborted) throw new Canceled(); throw e; }
        this.check(jobId);
        this.stage(jobId, ENGINE_STAGES.python);
      }
      const lock = this.lock()!;
      const found = await this.findPython(lock);
      this.check(jobId);
      const py = found.fit;
      if (!py) {
        const f = found.first;
        if (!f) throw new EngineError('python_not_found', 'no Python was found on this computer', { tried: found.tried, min: lock.minPython, max: lock.maxPython });
        if (f.bits !== 64) throw new EngineError('python_not_64bit', `the Python found (${f.version}) is a ${f.bits}-bit build; the engine needs a 64-bit one`, { found: f.version, bits: f.bits, min: lock.minPython, max: lock.maxPython });
        throw new EngineError('python_unsupported', `the Python found is ${f.version}; the pinned engine has packages for Python ${lock.minPython} to ${lock.maxPython} only`, { found: f.version, min: lock.minPython, max: lock.maxPython, direction: cmpMinor(f.version, lock.minPython) < 0 ? 'too_old' : 'too_new' });
      }
      if (!py.venv || !py.ensurepip) throw new EngineError('python_no_venv', `Python ${py.version} has no venv/ensurepip module, so it cannot make a separate environment`, { found: py.version });
      const bytes = lock.downloadBytes[minorOf(py.version)] ?? Math.max(...Object.values(lock.downloadBytes));
      const free = this.deps.freeBytes(this.existingParent(this.root));
      if (free !== null && free < bytes * DISK_FACTOR) throw new EngineError('not_enough_disk', `the install needs about ${bytes * DISK_FACTOR} bytes free on the data folder's drive; ${free} are free`, { neededBytes: bytes * DISK_FACTOR, freeBytes: free });

      // a clean start: whatever an earlier try left is removed first
      this.removeFolder();
      fs.mkdirSync(this.tmp, { recursive: true });
      this.stage(jobId, ENGINE_STAGES.venv);
      const env = this.childEnv();
      const venv = await this.deps.run(py.executable, ['-I', '-m', 'venv', this.venv], { env, onKill: (k) => this.kills.set(jobId, k), timeoutMs: 10 * 60_000 });
      this.check(jobId);
      if (venv.code !== 0 || !fs.existsSync(this.venvPython())) throw new EngineError('python_no_venv', `Python ${py.version} could not make the environment (exit ${venv.code ?? venv.spawnError})`, { found: py.version, tail: tail(venv.err || venv.out) });

      const total = lock.packages.length;
      let done = 0;
      this.stage(jobId, ENGINE_STAGES.download(0, total));
      const req = path.join(this.deps.requirementsDir, lock.file);
      const source = this.deps.localWheels ? ['--no-index', '--find-links', this.deps.localWheels] : ['--index-url', INDEX_URL];
      const pip = await this.deps.run(this.venvPython(), ['-I', '-m', 'pip', 'install', '--require-hashes', '--only-binary=:all:', '--no-input', '--disable-pip-version-check', '--no-cache-dir', '--progress-bar', 'off', ...source, '-r', req], {
        env, timeoutMs: 2 * 3600_000, onKill: (k) => this.kills.set(jobId, k),
        onLine: (line) => {
          if (/^Collecting /.test(line)) { done = Math.min(total, done + 1); this.stage(jobId, ENGINE_STAGES.download(done, total)); }
          else if (/^Installing collected packages/.test(line)) this.stage(jobId, ENGINE_STAGES.install);
        },
      });
      this.check(jobId);
      if (pip.code !== 0) throw pipFailure(pip);

      this.stage(jobId, ENGINE_STAGES.check);
      const probe = await this.deps.run(this.venvPython(), ['-I', WORKER, 'probe'], { env, timeoutMs: 5 * 60_000, onKill: (k) => this.kills.set(jobId, k) });
      this.check(jobId);
      let result: any = null;
      for (const l of probe.out.split(/\r?\n/)) { try { const o = JSON.parse(l); if (o?.event === 'result') result = o; } catch { /* not a protocol line */ } }
      const asr = result?.asr;
      if (!asr || asr.version !== ENGINE_EXPECTED.fasterWhisper || asr.ctranslate2 !== ENGINE_EXPECTED.ctranslate2)
        throw new EngineError('probe_failed', asr ? `the installed engine reports faster-whisper ${asr.version} / CTranslate2 ${asr.ctranslate2}, not the pinned ${ENGINE_EXPECTED.fasterWhisper} / ${ENGINE_EXPECTED.ctranslate2}` : 'the engine was installed but does not load', { tail: tail(result?.asrError ? String(result.asrError) : probe.err || probe.out) });

      const text = fs.readFileSync(req, 'utf8');
      const marker: Marker = { format: 1, requirements: lock.file, requirementsSha256: createHash('sha256').update(text).digest('hex'), python: py.version, fasterWhisper: asr.version, ctranslate2: asr.ctranslate2, finishedAt: new Date().toISOString() };
      fs.rmSync(this.tmp, { recursive: true, force: true });
      fs.writeFileSync(`${this.marker}.part`, JSON.stringify(marker, null, 2));
      fs.renameSync(`${this.marker}.part`, this.marker);
      await this.hooks.changed();
      this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { python: py.version, fasterWhisper: asr.version, ctranslate2: asr.ctranslate2, files: total, requirements: lock.file, note: 'The speech engine is installed. The recognition model is a separate download.' } });
    } catch (e: any) {
      if (this.stopped && !(e instanceof EngineError)) return; // shutting down: the row stays 'running'; the next start fails it and removes the folder
      this.stage(jobId, ENGINE_STAGES.removing);
      this.removeFolder();
      await this.hooks.changed();
      if (e instanceof Canceled || this.canceled.has(jobId)) this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'the install was canceled; the unfinished environment was removed' } });
      else if (e instanceof EngineError) this.store.updateJob(jobId, { status: 'failed', stage: null, error: { code: e.code, message: e.message, details: e.details } });
      else { console.error(e); this.store.updateJob(jobId, { status: 'failed', stage: null, error: { code: 'internal_error', message: 'the install failed unexpectedly; the unfinished environment was removed' } }); }
    } finally {
      release?.();
      this.kills.delete(jobId); this.canceled.delete(jobId);
    }
  }
  /** pip and Python get the server's environment without the variables that would send them elsewhere; temporary files stay in the folder. */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(PYTHON|PIP_(INDEX_URL|EXTRA_INDEX_URL|FIND_LINKS|NO_INDEX|TARGET|PREFIX|USER|ROOT|SRC|REQUIRE_VIRTUALENV|NO_BINARY|ONLY_BINARY|NO_DEPS|CONSTRAINT|REQUIREMENT))/i.test(k)) env[k] = v;
    env.TMP = env.TEMP = env.TMPDIR = this.tmp;
    env.PIP_NO_COLOR = '1';
    return env;
  }
  private removeFolder() {
    const { fs } = this.deps;
    fs.rmSync(this.marker, { recursive: true, force: true });
    fs.rmSync(this.venv, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(this.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  /**
   * Cheap state for the booth's self-check row `speech` (no process is started). INTEGRATOR: the row's server body is not in this
   * base (booth/routes.ts answers 501); when it lands, report `source` and `installing` from here as allow-listed scalars.
   */
  rowState(): { source: 'environment' | 'installed' | 'none'; installing: boolean } {
    return { source: this.hooks.envPython() ? 'environment' : this.installedPython() ? 'installed' : 'none', installing: !!this.openJob() };
  }
  handles(j: JobRow) { return j.type === SPEECH_ENGINE_JOB_TYPE; }
  cancel(jobId: string) {
    const j = this.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    this.canceled.add(jobId);
    const kill = this.kills.get(jobId);
    if (!this.running) { this.removeFolder(); this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'the install was canceled; the unfinished environment was removed' } }); return { jobId, status: 'canceled', outcome: 'removed' }; }
    this.store.updateJob(jobId, { status: 'cancel-requested' });
    kill?.();
    return { jobId, status: 'cancel-requested', outcome: 'stopping', note: 'the install is being stopped; the unfinished environment is removed' };
  }
  /** At start: an install a restart interrupted is failed and its folder removed; a folder without the marker is removed too. */
  recover(): number {
    const open = this.store.openJobs(SPEECH_ENGINE_JOB_TYPE);
    if (open.length || (!this.installedPython() && (this.deps.fs.existsSync(this.venv) || this.deps.fs.existsSync(this.tmp)))) this.removeFolder();
    for (const j of open) this.store.updateJob(j.id, { status: 'failed', stage: null, error: { code: 'interrupted', message: 'the editor stopped while the speech engine was being installed; the unfinished environment was removed', details: {} } });
    return open.length;
  }
  async stop() {
    this.stopped = true;
    for (const k of this.kills.values()) k();
    await this.running?.catch(() => {});
  }
}
class Canceled extends Error {}

/** Which failure pip's output shows: the network, a proxy, a full disk, or pip's own error (its last lines, scrubbed). */
export function pipFailure(r: RunResult): EngineError {
  const all = `${r.out}\n${r.err}`;
  const t = tail(r.err || r.out);
  if (/No space left on device|\[Errno 28\]|ENOSPC|There is not enough space on the disk/i.test(all)) return new EngineError('not_enough_disk', 'the drive of the data folder filled up during the install', { tail: t });
  if (/ProxyError|Tunnel connection failed|407 Proxy|Proxy Authentication Required/i.test(all)) return new EngineError('proxy_refused', `a proxy refused the connection to ${ENGINE_HOST}`, { tail: t });
  if (/NewConnectionError|getaddrinfo failed|Name or service not known|Temporary failure in name resolution|nodename nor servname|ConnectTimeout|Read timed out|Connection (?:reset|refused|aborted)|Network is unreachable|CERTIFICATE_VERIFY_FAILED|SSLError/i.test(all)) return new EngineError('network_unavailable', `${ENGINE_HOST} could not be reached`, { tail: t, certificate: /CERTIFICATE_VERIFY_FAILED|SSLError/i.test(all) });
  return new EngineError('pip_failed', `pip stopped with exit ${r.code ?? r.spawnError}`, { tail: t, hashMismatch: /DO NOT MATCH THE HASHES/i.test(all) });
}
