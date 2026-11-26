/**
 * «התקנת מנוע הדיבור» (speechEngine.ts). The state machine runs here with an INJECTED spawner (labelled fake: no Python, pip or
 * network is started by these tests) and the real file system in a temporary folder; every failure state is provoked. The real
 * end-to-end run (a real venv, real pip, the real probe) is speechEngine.standin.test.ts, with a labelled local stand-in wheel index.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOTH_SCRUB_MARK } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { DISK_FACTOR, ENGINE_STAGES, lockFileFor, parseLock, scrubText, SPEECH_ENGINE_JOB_TYPE, SPEECH_REQUIREMENTS_DIR, SpeechEngineInstaller, type EngineDeps, type RunOptions, type RunResult } from './speechEngine.ts';
import { Store } from './store.ts';

const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const AGENT: Principal = { actor: 'agent:x', kind: 'agent', scopes: ['observe', 'edit'] };
const LINUX = parseLock(fs.readFileSync(path.join(SPEECH_REQUIREMENTS_DIR, 'requirements-speech-linux-x86_64.txt'), 'utf8'), 'requirements-speech-linux-x86_64.txt');
const ok = (out = ''): RunResult => ({ code: 0, spawnError: null, out, err: '' });
const missing: RunResult = { code: null, spawnError: 'ENOENT', out: '', err: '' };

interface Script {
  /** what each Python command answers (key: the command joined by spaces); absent = not found */
  pythons?: Record<string, { version: string; bits?: number; venv?: boolean; ensurepip?: boolean } | 'store-stub'>;
  venv?: 'ok' | 'fail';
  pip?: RunResult | 'hang';
  probe?: unknown;
}
/** FAKE spawner (test double): answers like Python, venv, pip and the probe would, and records every call. */
function fakeRun(s: Script, venvPython: () => string) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run = async (cmd: string, args: string[], o: RunOptions = {}): Promise<RunResult> => {
    calls.push({ cmd, args });
    if (args.includes('-c')) {
      const key = [cmd, ...args.slice(0, args.indexOf('-I'))].join(' ');
      const p = s.pythons?.[key];
      if (!p) return missing;
      if (p === 'store-stub') return { code: 9009, spawnError: null, out: 'Python was not found; run without arguments to install from the Microsoft Store', err: '' };
      return ok(JSON.stringify({ executable: `/fake/${key.replace(/\W+/g, '_')}`, version: p.version, bits: p.bits ?? 64, venv: p.venv ?? true, ensurepip: p.ensurepip ?? true }));
    }
    if (args.includes('venv')) {
      if (s.venv === 'fail') return { code: 1, spawnError: null, out: '', err: 'Error: Command returned non-zero exit status 1.' };
      fs.mkdirSync(path.dirname(venvPython()), { recursive: true });
      fs.writeFileSync(venvPython(), '');
      return ok();
    }
    if (args.includes('pip')) {
      expect(args).toEqual(expect.arrayContaining(['--require-hashes', '--only-binary=:all:', '--no-cache-dir']));
      if (s.pip === 'hang') return new Promise((resolve) => { o.onLine?.('Collecting anyio==4.16.0 (from -r x (line 1))'); o.onKill?.(() => resolve({ code: null, spawnError: null, out: '', err: 'killed' })); });
      if (s.pip && s.pip.code !== 0) return s.pip;
      for (const p of LINUX.packages) o.onLine?.(`Collecting ${p.name}==${p.version} (from -r requirements (line 1))`);
      o.onLine?.('Installing collected packages: ' + LINUX.packages.map((p) => p.name).join(', '));
      return ok('Successfully installed ...');
    }
    if (args.includes('probe')) return ok(JSON.stringify(s.probe ?? { event: 'result', python: '3.13.1', asr: { engine: 'faster-whisper', version: '1.2.1', ctranslate2: '4.9.0' }, tts: null, cudaDevices: 0 }));
    throw new Error(`unexpected call ${cmd} ${args.join(' ')}`);
  };
  return { run, calls };
}

let root: string;
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-engine-')); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function setup(s: Script, extra: Partial<EngineDeps> & { env?: string | null; busy?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'case-'));
  const store = new Store(dir);
  const project = store.createProject({ name: 'p' }).doc.id;
  let inst!: SpeechEngineInstaller;
  const fake = fakeRun(s, () => inst.venvPython());
  let changed = 0;
  inst = new SpeechEngineInstaller(store, dir, { envPython: () => extra.env ?? null, speechBusy: () => !!extra.busy, changed: () => { changed++; } }, null,
    { run: fake.run, freeBytes: () => 50e9, platform: 'linux', arch: 'x64', ...extra });
  const stages: string[] = [];
  store.events.on('job', (j: { type: string; stage: string | null }) => { if (j.type === SPEECH_ENGINE_JOB_TYPE && j.stage && stages.at(-1) !== j.stage) stages.push(j.stage); });
  return { dir, store, project, inst, calls: fake.calls, stages, changes: () => changed };
}
const GOOD: Script = { pythons: { python: { version: '3.13.1' } } };
async function install(c: ReturnType<typeof setup>) {
  const plan = await c.inst.plan();
  const job = await c.inst.start(OWNER, c.project, plan.downloadBytes!);
  await c.inst.idle();
  return c.store.getJob(job.id);
}

describe('the requirements files', () => {
  for (const file of ['requirements-speech-win-amd64.txt', 'requirements-speech-linux-x86_64.txt']) {
    it(`${file}: every line pinned with sha256 hashes, no direct URL or index option, wheels only, the generator named`, () => {
      const text = fs.readFileSync(path.join(SPEECH_REQUIREMENTS_DIR, file), 'utf8');
      const lock = parseLock(text, file); // throws on any non-comment line that is not name==version --hash=sha256:...
      expect(lock.packages.length).toBeGreaterThan(15);
      for (const p of lock.packages) expect(p.hashes.length).toBeGreaterThanOrEqual(1);
      const body = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      expect(body.filter((l) => /:\/\/|@|^-|--index|--extra|--find-links|--trusted|\.tar\.gz|\.zip/.test(l))).toEqual([]);
      const named = text.split('\n').filter((l) => /^#\s+\S+\.(whl|tar\.gz|zip|tar\.bz2)\b/.test(l));
      expect(named.length).toBeGreaterThanOrEqual(lock.packages.length);
      expect(named.filter((l) => !/\.whl \(\d+ bytes\)$/.test(l))).toEqual([]);
      expect(text).toMatch(/lock_speech\.py/);
      const pins = Object.fromEntries(lock.packages.map((p) => [p.name, p.version]));
      expect({ fw: pins['faster-whisper'], ct2: pins.ctranslate2 }).toEqual({ fw: '1.2.1', ct2: '4.9.0' });
      expect({ min: lock.minPython, max: lock.maxPython }).toEqual({ min: '3.12', max: '3.14' });
      expect(Object.keys(lock.downloadBytes).sort()).toEqual(['3.12', '3.13', '3.14']);
      const sizes = named.reduce((n, l) => n + Number(/\((\d+) bytes\)/.exec(l)![1]), 0);
      for (const b of Object.values(lock.downloadBytes)) { expect(b).toBeGreaterThan(50e6); expect(b).toBeLessThanOrEqual(sizes); }
    });
  }
  it('the Windows file carries what only Windows needs (colorama, from tqdm and click markers) and the same versions as Linux otherwise', () => {
    const win = parseLock(fs.readFileSync(path.join(SPEECH_REQUIREMENTS_DIR, 'requirements-speech-win-amd64.txt'), 'utf8'), 'w');
    const w = Object.fromEntries(win.packages.map((p) => [p.name, p.version])), l = Object.fromEntries(LINUX.packages.map((p) => [p.name, p.version]));
    expect(w.colorama).toBe('0.4.6');
    delete w.colorama;
    expect(w).toEqual(l);
  });
  it('which file serves which computer', () => {
    expect([lockFileFor('win32', 'x64'), lockFileFor('linux', 'x64'), lockFileFor('darwin', 'arm64'), lockFileFor('win32', 'arm64'), lockFileFor('win32', 'ia32')])
      .toEqual(['requirements-speech-win-amd64.txt', 'requirements-speech-linux-x86_64.txt', null, null, null]);
  });
});

describe('the install, step by step (injected spawner)', () => {
  it('success: finds Python, makes the venv inside the data folder, pip with hashes, the probe, then the marker last', async () => {
    const c = setup(GOOD);
    const j = await install(c);
    expect(j.status).toBe('succeeded');
    expect(j.output).toMatchObject({ python: '3.13.1', fasterWhisper: '1.2.1', ctranslate2: '4.9.0', files: LINUX.packages.length });
    expect(c.stages).toEqual([ENGINE_STAGES.python, ENGINE_STAGES.venv, ...Array.from({ length: LINUX.packages.length + 1 }, (_, i) => ENGINE_STAGES.download(i, LINUX.packages.length)), ENGINE_STAGES.install, ENGINE_STAGES.check]);
    expect(c.inst.installedPython()).toBe(path.join(c.dir, 'engines', 'speech', 'venv', 'bin', 'python'));
    expect(fs.existsSync(path.join(c.dir, 'engines', 'speech', 'tmp'))).toBe(false);
    expect(c.changes()).toBe(1);
    const venvCall = c.calls.find((x) => x.args.includes('venv'))!;
    expect(venvCall).toEqual({ cmd: '/fake/python', args: ['-I', '-X', 'utf8', '-m', 'venv', path.join(c.dir, 'engines', 'speech', 'venv')] });
    const pip = c.calls.find((x) => x.args.includes('pip'))!;
    expect(pip.args).toEqual(['-I', '-X', 'utf8', '-m', 'pip', 'install', '--require-hashes', '--only-binary=:all:', '--no-input', '--disable-pip-version-check', '--no-cache-dir', '--progress-bar', 'off', '--index-url', 'https://pypi.org/simple', '-r', path.join(SPEECH_REQUIREMENTS_DIR, 'requirements-speech-linux-x86_64.txt')]);
    expect(c.calls.find((x) => x.args.includes('probe'))!.args[0]).toBe('-I');
  });
  it('Windows: `py -3` first; when it is too new, a fitting Python beside it is asked for by number; python.exe under Scripts', async () => {
    const c = setup({ pythons: { 'py -3': { version: '3.15.0' }, 'py -3.14': { version: '3.14.2' } } }, { platform: 'win32' });
    const j = await install(c);
    expect(j.status).toBe('succeeded');
    expect([...new Set(c.calls.filter((x) => x.args.includes('-c')).map((x) => `${x.cmd} ${x.args[0]}`))]).toEqual(['py -3', 'py -3.14']);
    expect(c.inst.venvPython()).toBe(path.join(c.dir, 'engines', 'speech', 'venv', 'Scripts', 'python.exe'));
    expect(c.calls.find((x) => x.args.includes('pip'))!.args.at(-1)).toMatch(/requirements-speech-win-amd64\.txt$/);
  });
  const failures: [string, Script, Partial<EngineDeps>, string, Record<string, unknown>?][] = [
    ['no Python at all (and the Microsoft Store stand-in)', { pythons: { python3: 'store-stub' } }, {}, 'python_not_found', { tried: ['python', 'python3'] }],
    ['Python too new', { pythons: { python: { version: '3.15.0' } } }, {}, 'python_unsupported', { found: '3.15.0', direction: 'too_new', min: '3.12', max: '3.14' }],
    ['Python too old', { pythons: { python: { version: '3.11.9' } } }, {}, 'python_unsupported', { found: '3.11.9', direction: 'too_old' }],
    ['a 32-bit Python', { pythons: { python: { version: '3.13.1', bits: 32 } } }, {}, 'python_not_64bit', { bits: 32 }],
    ['no venv module (Debian without python3-venv)', { pythons: { python: { version: '3.13.1', ensurepip: false } } }, {}, 'python_no_venv'],
    ['venv itself fails', { ...GOOD, venv: 'fail' }, {}, 'python_no_venv'],
    ['not enough disk', GOOD, { freeBytes: () => LINUX.downloadBytes['3.13']! * DISK_FACTOR - 1 }, 'not_enough_disk', { neededBytes: LINUX.downloadBytes['3.13']! * DISK_FACTOR }],
    ['no network', { ...GOOD, pip: { code: 1, spawnError: null, out: '', err: "WARNING: Retrying (Retry(total=4)) after connection broken by 'NewConnectionError(': Failed to establish a new connection: [Errno 11001] getaddrinfo failed')'\nERROR: No matching distribution found for anyio==4.16.0" } }, {}, 'network_unavailable'],
    ['a proxy refuses', { ...GOOD, pip: { code: 1, spawnError: null, out: '', err: "WARNING: Retrying after connection broken by 'ProxyError('Cannot connect to proxy.', OSError('Tunnel connection failed: 407 Proxy Authentication Required'))'" } }, {}, 'proxy_refused'],
    ['the disk fills during pip', { ...GOOD, pip: { code: 1, spawnError: null, out: '', err: 'ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device' } }, {}, 'not_enough_disk'],
    ['pip\'s own error (a hash mismatch)', { ...GOOD, pip: { code: 1, spawnError: null, out: '', err: 'ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE.\n    av==19.0.2 from https://files.pythonhosted.org/x/av.whl:\n        Expected sha256 3ce5\n             Got        0000' } }, {}, 'pip_failed', { hashMismatch: true }],
    ['the probe fails after install', { ...GOOD, probe: { event: 'result', python: '3.13.1', asr: null, asrError: 'ImportError: DLL load failed while importing _ext: The specified module could not be found.' } }, {}, 'probe_failed'],
    ['the probe reports other versions', { ...GOOD, probe: { event: 'result', python: '3.13.1', asr: { engine: 'faster-whisper', version: '1.2.0', ctranslate2: '4.9.0' } } }, {}, 'probe_failed'],
  ];
  for (const [what, script, deps, code, details] of failures) {
    it(`fails in words: ${what} → ${code}; no folder is left`, async () => {
      const c = setup(script, deps);
      const j = await install(c);
      expect({ status: j.status, code: j.error?.code }).toEqual({ status: 'failed', code });
      if (details) expect(j.error.details).toMatchObject(details);
      expect(fs.existsSync(path.join(c.dir, 'engines', 'speech', 'venv'))).toBe(false);
      expect(fs.existsSync(path.join(c.dir, 'engines', 'speech', 'installed.json'))).toBe(false);
      expect(c.inst.installedPython()).toBeNull();
    });
  }
  it('pip\'s last lines are shown with the user name, the home folder and paths scrubbed', async () => {
    const user = os.userInfo().username;
    const err = `ERROR: Could not install packages due to an OSError: [WinError 5] Access is denied: 'C:\\Users\\Dana Cohen\\OneDrive - Cohen\\PULSEFRAME\\.data\\engines\\speech\\venv\\Lib\\x.pyd'\n${os.homedir()}/x is ${user}'s\nsee https://pip.pypa.io/x and mail ${user}@example.com`;
    const c = setup({ ...GOOD, pip: { code: 1, spawnError: null, out: '', err } });
    const j = await install(c);
    expect(j.error.code).toBe('pip_failed');
    const t = j.error.details.tail as string;
    expect(t).toContain('Access is denied');
    for (const secret of ['Dana', 'Cohen', 'OneDrive', os.homedir(), `${user}@`, 'pip.pypa.io']) expect(t).not.toContain(secret);
    expect(t).toContain(BOOTH_SCRUB_MARK);
  });
  it('cancel while pip runs: the process is stopped, the job ends canceled and the folder is removed', async () => {
    const c = setup({ ...GOOD, pip: 'hang' });
    const plan = await c.inst.plan();
    const job = await c.inst.start(OWNER, c.project, plan.downloadBytes!);
    for (let i = 0; i < 100 && !c.stages.some((s) => s.startsWith('downloading 1 of')); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fs.existsSync(c.inst.venvPython())).toBe(true);
    expect(c.inst.cancel(job.id)).toMatchObject({ status: 'cancel-requested' });
    await c.inst.idle();
    const j = c.store.getJob(job.id);
    expect({ status: j.status, code: j.error?.code }).toEqual({ status: 'canceled', code: 'canceled' });
    expect(fs.existsSync(path.join(c.dir, 'engines', 'speech', 'venv'))).toBe(false);
  });
  it('restart: an install the restart interrupted is failed (interrupted) and its half folder removed; a finished one is kept', () => {
    const c = setup(GOOD);
    const job = c.store.createJob(c.project, SPEECH_ENGINE_JOB_TYPE, OWNER.actor, {});
    c.store.updateJob(job.id, { status: 'running', stage: ENGINE_STAGES.install });
    fs.mkdirSync(path.dirname(c.inst.venvPython()), { recursive: true }); fs.writeFileSync(c.inst.venvPython(), '');
    expect(c.inst.recover()).toBe(1);
    expect(c.store.getJob(job.id)).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
    expect(fs.existsSync(c.inst.venv)).toBe(false);
    // a venv without the marker and no job (a crash between steps) is removed too
    fs.mkdirSync(c.inst.venv, { recursive: true });
    c.inst.recover();
    expect(fs.existsSync(c.inst.venv)).toBe(false);
    // a finished install stays
    fs.mkdirSync(path.dirname(c.inst.venvPython()), { recursive: true }); fs.writeFileSync(c.inst.venvPython(), '');
    fs.writeFileSync(path.join(c.inst.root, 'installed.json'), JSON.stringify({ format: 1 }));
    c.inst.recover();
    expect(c.inst.installedPython()).toBe(c.inst.venvPython());
  });
});

describe('refusals before a job exists', () => {
  it('an agent credential: owner_required on the plan and the start', async () => {
    const c = setup(GOOD);
    await expect(c.inst.view(AGENT)).rejects.toMatchObject({ status: 403, code: 'owner_required' });
    await expect(c.inst.start(AGENT, c.project, 1)).rejects.toMatchObject({ status: 403, code: 'owner_required' });
    await expect(c.inst.start({ ...OWNER, actor: 'user:someone-else' }, c.project, 1)).rejects.toMatchObject({ code: 'owner_required' });
  });
  it('PF_SPEECH_PYTHON set, already installed, already running, speech busy, another computer, a stale size', async () => {
    const e = setup(GOOD, { env: '/x/python' });
    await expect(e.inst.start(OWNER, e.project, 1)).rejects.toMatchObject({ status: 409, code: 'engine_configured_elsewhere' });
    expect((await e.inst.view(OWNER)).state).toBe('environment');
    const b = setup(GOOD, { busy: true });
    await expect(b.inst.start(OWNER, b.project, 1)).rejects.toMatchObject({ status: 409, code: 'speech_busy' });
    const m = setup(GOOD, { platform: 'darwin', arch: 'arm64' });
    await expect(m.inst.start(OWNER, m.project, 1)).rejects.toMatchObject({ status: 409, code: 'platform_unsupported' });
    expect((await m.inst.plan()).supported).toBe(false);
    const s = setup(GOOD);
    await expect(s.inst.start(OWNER, s.project, 123)).rejects.toMatchObject({ status: 409, code: 'download_size_mismatch', details: { downloadBytes: LINUX.downloadBytes['3.13'] } });
    const r = setup({ ...GOOD, pip: 'hang' });
    const bytes = (await r.inst.plan()).downloadBytes!;
    const job = await r.inst.start(OWNER, r.project, bytes);
    await expect(r.inst.start(OWNER, r.project, bytes)).rejects.toMatchObject({ status: 409, code: 'engine_install_running' });
    expect((await r.inst.view(OWNER)).state).toBe('installing');
    r.inst.cancel(job.id); await r.inst.idle();
    const d = setup(GOOD);
    await install(d);
    await expect(d.inst.start(OWNER, d.project, bytes)).rejects.toMatchObject({ status: 409, code: 'engine_already_installed' });
    expect((await d.inst.view(OWNER)).state).toBe('installed');
  });
  it('the plan says what will happen: pypi.org, the bytes for the Python found, the files, the disk asked for', async () => {
    const p = await setup(GOOD).inst.plan();
    expect(p).toMatchObject({ supported: true, host: 'pypi.org', python: { found: true, version: '3.13.1', fits: true, min: '3.12', max: '3.14' }, downloadBytes: LINUX.downloadBytes['3.13'], files: LINUX.packages.length, diskNeededBytes: LINUX.downloadBytes['3.13']! * DISK_FACTOR });
    expect((await setup({}).inst.plan()).python).toEqual({ found: false, tried: ['python', 'python3'] });
    expect((await setup({ pythons: { python: { version: '3.15.1' } } }).inst.plan()).python).toMatchObject({ found: true, fits: false, version: '3.15.1' });
  });
  it('installing again over an installed engine that does not answer (replace): the marker goes first, the folder is made anew', async () => {
    const c = setup(GOOD);
    await install(c);
    const bytes = (await c.inst.plan()).downloadBytes!;
    const job = await c.inst.start(OWNER, c.project, bytes, true);
    expect(c.inst.installedPython()).toBeNull(); // not used while it is replaced
    await c.inst.idle();
    expect(c.store.getJob(job.id).status).toBe('succeeded');
    expect(c.inst.installedPython()).not.toBeNull();
  });
  it('a failed install is the panel\'s lastFailure', async () => {
    const c = setup({});
    await install(c);
    expect((await c.inst.view(OWNER)).lastFailure).toMatchObject({ code: 'python_not_found' });
  });
});

describe('which interpreter speech uses (precedence)', () => {
  const cfgFor = (dir: string, speechPython: string | null): Config => ({ ...loadConfig({}), dataDir: dir, speechModelsDir: path.join(dir, 'models'), speechPython, voicePython: null });
  it('PF_SPEECH_PYTHON wins; else the installed engine once its marker exists; a venv without the marker is not used', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'prec-'));
    const store = new Store(dir);
    const plain = new Speech(store, cfgFor(dir, null));
    expect(plain.asrPython()).toBeNull();
    const st0 = await plain.status();
    expect({ reason: st0.transcription.reason, source: st0.engine.source }).toEqual({ reason: 'engine_not_configured', source: null });
    // a venv whose interpreter is the system Python (no engine in it): without the marker it is not used
    const py = plain.engineInstall.venvPython();
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.symlinkSync(fs.realpathSync(process.env.PF_TEST_PYTHON ?? '/usr/local/bin/python3'), py);
    expect(plain.asrPython()).toBeNull();
    fs.writeFileSync(path.join(plain.engineInstall.root, 'installed.json'), JSON.stringify({ format: 1 }));
    expect(plain.asrPython()).toBe(py);
    // the probe decides: the system Python has no engine, so the state is "installed but not working", never "ready"
    const st1 = await plain.status();
    expect({ reason: st1.transcription.reason, source: st1.engine.source, ok: st1.engine.ok }).toEqual({ reason: 'engine_not_working', source: 'installed', ok: false });
    const env = new Speech(store, cfgFor(dir, '/elsewhere/python'));
    expect(env.asrPython()).toBe('/elsewhere/python');
    expect((await env.status()).engine.source).toBe('environment');
    await plain.stop(); await env.stop();
    store.close();
  }, 60_000);
});

describe('the routes: owner\'s own session only, documented, no MCP tool', () => {
  let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities, derivatives: Derivatives;
  let ownerCookie = '', proposeGrant = '', project = '';
  const base = () => `http://127.0.0.1:${cfg.port}`;
  type Who = () => Record<string, string>;
  const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
  const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
  const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), proposer = bearer(() => proposeGrant);
  const rest = async (who: Who, method: string, p: string, body?: string) => {
    const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body }) }));
    return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
  };
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(root, 'http-'));
    cfg = { ...loadConfig({}), dataDir: dir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: null };
    store = new Store(dir);
    auth = new Auth(cfg);
    const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
    capabilities = new Capabilities(store, cfg);
    gov = new Governance(store);
    auth.resolveGrant = (token) => gov.principalForToken(token);
    let sp!: Speech;
    const fake = fakeRun({ ...GOOD, pip: 'hang' }, () => sp.engineInstall.venvPython());
    sp = speech = new Speech(store, cfg, null, { run: fake.run, freeBytes: () => 50e9, platform: 'linux', arch: 'x64' });
    mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech);
    derivatives = new Derivatives(store);
    app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
    ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
    proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
    project = store.createProject({ name: 'p' }).doc.id;
  });
  afterAll(async () => { await derivatives.stop(); await mcp.close(); await speech.stop(); await capabilities.stop(); store.close(); });
  const ROUTES = ['GET /api/v1/speech/engine', 'POST /api/v1/projects/:id/speech/engine/install'];
  it('registered, in OpenAPI with x-owner-session-only, owner-only in the people-surface table', () => {
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, registered: registered.has(route), ownerOnly: op?.['x-owner-session-only'], classes: PEOPLE_REST_SURFACES[route] }).toEqual({ route, registered: true, ownerOnly: true, classes: ['owner-only'] });
    }
  });
  it('agent, observer and propose credentials get 403 owner_required on both routes (guarded mode), also with a bad body; the two MCP tools exist', async () => {
    for (const who of [agent, observer, proposer]) {
      for (const [m, p, b] of [['GET', '/api/v1/speech/engine'], ['POST', `/api/v1/projects/${project}/speech/engine/install`, '{"confirmBytes":1}'], ['POST', `/api/v1/projects/${project}/speech/engine/install`, '{"bogus":']] as const) {
        const r = await rest(who, m, p, b);
        expect({ p, status: r.status, code: r.body?.error?.code }).toEqual({ p, status: 403, code: 'owner_required' });
      }
    }
    const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agent(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    const text = await r.text();
    const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    // ADR-0036 added the two MCP tools; each calls the route's own server function, so in guarded mode (this test's mode) it refuses like the route
    expect(msg.result.tools.map((t: { name: string }) => t.name).filter((n: string) => /engine|install/i.test(n)).sort()).toEqual(['get_speech_engine', 'install_speech_engine']);
  });
  it('the owner sees the plan, starts with the exact size, and is the only one who can cancel (REST)', async () => {
    const v = await rest(owner, 'GET', '/api/v1/speech/engine');
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ state: 'not_installed', plan: { host: 'pypi.org', python: { found: true, fits: true } } });
    const s = await rest(owner, 'POST', `/api/v1/projects/${project}/speech/engine/install`, JSON.stringify({ confirmBytes: v.body.plan.downloadBytes }));
    expect(s.status).toBe(202);
    for (const who of [agent, observer, proposer]) {
      const c = await rest(who, 'POST', `/api/v1/jobs/${s.body.jobId}/cancel`);
      expect({ status: c.status, code: c.body?.error?.code }).toEqual({ status: 403, code: 'owner_required' });
    }
    const viaMcp = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agent(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cancel_job', arguments: { jobId: s.body.jobId } } }) }));
    expect(await viaMcp.text()).toMatch(/owner_required/);
    expect(speech.engineInstall.rowState()).toEqual({ source: 'none', installing: true });
    const c = await rest(owner, 'POST', `/api/v1/jobs/${s.body.jobId}/cancel`);
    expect(c.status).toBe(200);
    await speech.engineInstall.idle();
    expect(store.getJob(s.body.jobId).status).toBe('canceled');
    expect(fs.existsSync(speech.engineInstall.venv)).toBe(false);
  });
});

describe('the stage lines and codes the web turns into words (apps/web/src/editor/engineInstall.logic.test.ts pins the same literals)', () => {
  it('stages and failure codes', async () => {
    const { ENGINE_FAILURES } = await import('./speechEngine.ts');
    expect([ENGINE_STAGES.python, ENGINE_STAGES.venv, ENGINE_STAGES.download(0, 24), ENGINE_STAGES.download(7, 24), ENGINE_STAGES.install, ENGINE_STAGES.check, ENGINE_STAGES.removing])
      .toEqual(['finding Python', 'creating the environment', 'downloading 0 of 24 files', 'downloading 7 of 24 files', 'installing', 'checking the engine', 'removing the unfinished environment']);
    expect([...ENGINE_FAILURES].sort()).toEqual(['python_not_found', 'python_unsupported', 'python_not_64bit', 'python_no_venv', 'not_enough_disk', 'network_unavailable', 'proxy_refused', 'pip_failed', 'probe_failed', 'interrupted', 'internal_error'].sort());
  });
});

describe('scrubText (the booth note rule)', () => {
  it('removes the user name, home folder, host, Windows/UNC/POSIX paths, e-mail, URLs, addresses and long digit runs', () => {
    const t = scrubText('dana at C:\\Users\\dana\\OneDrive - Levi\\a b.whl\n\\\\nas\\share\\x y\n/home/dana/v and /opt/x/y ~/w 10.0.0.7 fe80::1:2:3 x@y.zz https://h/x 12345678 on laptop\nkeep me', ['dana', '/home/dana', 'laptop']);
    expect(t.split('\n')[0]).toBe(`${BOOTH_SCRUB_MARK} at ${BOOTH_SCRUB_MARK}`);
    expect(t).toContain('keep me');
    for (const s of ['dana', 'Levi', 'nas', '/home', '~/w', '10.0.0.7', 'fe80', 'x@y', 'https', '12345678']) expect(t).not.toContain(s);
  });
});
