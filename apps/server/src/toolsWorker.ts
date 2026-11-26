/**
 * The generic tools-Python launcher of the picture-model runtime (wave 8 picmodels; verify C17: a NEW file used by picmodels only —
 * search/workers.ts keeps its own KeptWorker, untouched; the two are joined in a later wave). Built to the contracts in
 * picmodels/contract.ts (RunToolsOnce, ProbePicturePython):
 * - `python -I -X utf8 script …` (PYTHON_WORKER_FLAGS), search's OFFLINE_ENV, working directory the store's tmp folder;
 * - ONE process, ONE request line on stdin, the first stdout line that is JSON and carries the request's id is the answer (resolved
 *   unparsed: the caller parses it strictly); any other line is dropped, except an id-less `{"event":"error","code"}` (the worker
 *   refusing before it read the request, e.g. model_mismatch), which rejects with that code;
 * - SIGKILL on abort, on the timeout and as soon as the answer arrived: no kept worker;
 * - nothing written, nothing logged; an error is picmodelsError('engineFailed', { reason, exit?, code? }) with codes and integers only:
 *   never stderr, never a message of the worker or of the operating system. stderr's last 2,000 characters go only to `onStderrTail`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { PYTHON_WORKER_FLAGS } from './pythonArgs.ts';
import { OFFLINE_ENV } from './search/workers.ts';
import { picmodelsError, type PicturePythonProbe, type ProbePicturePython, type RunToolsOnce, type ToolsProcessSpec } from './picmodels/contract.ts';

const STDERR_TAIL = 2000;
const WORKER_ERROR_CODES = new Set(['bad_request', 'engine_failed', 'model_mismatch', 'not_built']);
/** A module or package name as the probe may report it (never a path). */
const MODULE_NAME = /^[A-Za-z0-9_.]{1,60}$/;

function spawnTools(spec: ToolsProcessSpec, args: readonly string[], stdin: boolean): ChildProcess {
  return spawn(spec.python, [...PYTHON_WORKER_FLAGS, spec.script, ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], cwd: spec.tmpDir, env: { ...process.env, ...OFFLINE_ENV } });
}
const killHard = (p: ChildProcess) => { try { p.kill('SIGKILL'); } catch { /* already gone */ } };
/** Calls `onLine` with every stdout line that parses as JSON; other lines are dropped. */
function jsonLines(p: ChildProcess, onLine: (o: unknown) => void): void {
  let buf = '';
  p.stdout!.setEncoding('utf8');
  p.stdout!.on('data', (d: string) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let o: unknown;
      try { o = JSON.parse(line); } catch { continue; }
      onLine(o);
    }
    if (buf.length > 64 << 20) { buf = ''; killHard(p); } // a line this long is no answer
  });
}
const exitCode = (code: number | null): number => (typeof code === 'number' ? code : -1);

export const runToolsOnce: RunToolsOnce = (spec, args, request, signal, timeoutMs, onStderrTail) => new Promise<unknown>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason ?? new Error('aborted')); return; }
  let p: ChildProcess;
  try { p = spawnTools(spec, args, true); } catch { reject(picmodelsError('engineFailed', { reason: 'spawn' })); return; }
  let settled = false, err = '';
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    killHard(p);
    fn();
  };
  const onAbort = () => finish(() => reject(signal.reason ?? new Error('aborted')));
  const timer = setTimeout(() => finish(() => reject(picmodelsError('engineFailed', { reason: 'timeout' }))), timeoutMs);
  timer.unref();
  signal.addEventListener('abort', onAbort, { once: true });
  jsonLines(p, (o) => {
    const line = o as { id?: unknown; event?: unknown; code?: unknown } | null;
    if (!line || typeof line !== 'object' || Array.isArray(line)) return;
    if (line.id === request.id) { finish(() => resolve(o)); return; }
    if (line.id === undefined && line.event === 'error') {
      const code = typeof line.code === 'string' && WORKER_ERROR_CODES.has(line.code) ? line.code : 'unknown';
      finish(() => reject(picmodelsError('engineFailed', { reason: 'worker', code })));
    }
  });
  p.stderr!.setEncoding('utf8');
  p.stderr!.on('data', (d: string) => { err = (err + d).slice(-STDERR_TAIL); });
  p.stdin!.on('error', () => { /* the process went away; 'close' reports it */ });
  p.on('error', () => finish(() => reject(picmodelsError('engineFailed', { reason: 'spawn' }))));
  p.on('close', (code) => {
    if (err && onStderrTail) { try { onStderrTail(err); } catch { /* the owner's detail only */ } }
    finish(() => reject(picmodelsError('engineFailed', { reason: 'exited', exit: exitCode(code) })));
  });
  p.stdin!.end(`${JSON.stringify(request)}\n`);
});

export const probePicturePython: ProbePicturePython = (spec, timeoutMs = 120_000) => new Promise<PicturePythonProbe>((resolve) => {
  const failed: PicturePythonProbe = { ok: false, python: null, versions: {}, missing: null, cudaDevices: 0 };
  let p: ChildProcess;
  try { p = spawnTools(spec, ['probe'], false); } catch { resolve(failed); return; }
  let result: Record<string, unknown> | null = null, done = false;
  const end = (v: PicturePythonProbe) => { if (done) return; done = true; clearTimeout(timer); killHard(p); resolve(v); };
  const timer = setTimeout(() => end(failed), timeoutMs);
  timer.unref();
  jsonLines(p, (o) => { if (!result && o && typeof o === 'object' && (o as { event?: unknown }).event === 'result') result = o as Record<string, unknown>; });
  p.stderr!.resume(); // never kept: the probe's answer is its line
  p.on('error', () => end(failed));
  p.on('close', (code) => {
    const r = result;
    if (!r) { end(failed); return; }
    const versions: Record<string, string> = {};
    if (r.versions && typeof r.versions === 'object') for (const [k, v] of Object.entries(r.versions as Record<string, unknown>)) if (MODULE_NAME.test(k) && typeof v === 'string') versions[k] = v.slice(0, 40);
    const missing = typeof r.missing === 'string' && MODULE_NAME.test(r.missing) ? r.missing : null;
    const python = typeof r.python === 'string' && /^[0-9][0-9A-Za-z.+]{0,19}$/.test(r.python) ? r.python : null;
    const cudaDevices = Number.isInteger(r.cudaDevices) && (r.cudaDevices as number) >= 0 ? (r.cudaDevices as number) : 0;
    end({ ok: code === 0 && r.ok === true && missing === null, python, versions, missing, cudaDevices });
  });
});
