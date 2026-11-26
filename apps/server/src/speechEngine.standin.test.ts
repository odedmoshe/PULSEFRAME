/**
 * «התקנת מנוע הדיבור» end to end on this machine, with a LABELLED STAND-IN for the engine's wheels.
 *
 * Why a stand-in: the real Linux closure is 133 MB of wheels and 478 MB once installed (measured on the environment that ran
 * `pnpm proof:speech`), over the 400 MB this shared machine may spend on one test. Everything else is real: the Python found on
 * PATH, `python -I -m venv` under the data folder, `pip install --require-hashes --only-binary=:all:` from a hash-locked file, the
 * real worker's probe (apps/server/speech/pf_speech.py), the marker, Speech.status() using the installed interpreter without any
 * environment variable, and the removal. The two wheels are made here, at test time: `faster-whisper` 1.2.1 and `ctranslate2` 4.9.0
 * that contain nothing but their version (their code says PULSEFRAME TEST STAND-IN). They are installed from a local folder
 * (`--no-index --find-links`, the installer's test-only `localWheels` option), never from pypi.org, and deleted afterwards.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { Speech } from './speech.ts';
import { dataDirBytes } from './storage.ts';
import { Store } from './store.ts';

const MAKE_WHEEL = `
import base64, hashlib, sys, zipfile
out, name, dist, version, requires = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
files = {
  f"{name}/__init__.py": f'"""PULSEFRAME TEST STAND-IN: not the real {dist}. Made by speechEngine.standin.test.ts; contains only a version."""\\n__version__ = "{version}"\\ndef get_cuda_device_count():\\n    return 0\\n',
  f"{name}-{version}.dist-info/METADATA": "Metadata-Version: 2.1\\nName: " + dist + "\\nVersion: " + version + "\\n" + "".join("Requires-Dist: " + r + "\\n" for r in requires),
  f"{name}-{version}.dist-info/WHEEL": "Wheel-Version: 1.0\\nGenerator: pulseframe-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",
}
record = []
for p, text in files.items():
    data = text.encode()
    record.append(f"{p},sha256={base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b'=').decode()},{len(data)}")
record.append(f"{name}-{version}.dist-info/RECORD,,")
files[f"{name}-{version}.dist-info/RECORD"] = "\\n".join(record) + "\\n"
with zipfile.ZipFile(out, "w") as z:
    for p, text in files.items():
        z.writestr(p, text)
`;

function systemPython(): string | null {
  for (const c of ['python', 'python3']) {
    try {
      const v = execFileSync(c, ['-I', '-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' }).trim();
      const minor = Number(v.split('.')[1]);
      if (v.startsWith('3.') && minor >= 12 && minor <= 14) return c;
    } catch { /* not there */ }
  }
  return null;
}
const runnable = process.platform === 'linux' && process.arch === 'x64' && !!systemPython();

describe('engine install end to end, with a labelled stand-in wheel index (no pypi.org)', () => {
  it.skipIf(!runnable)('real venv + real pip --require-hashes + real probe; then the editor uses it with no environment variable; then it is deleted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-engine-standin-'));
    try {
      const wheels = path.join(dir, 'stand-in-wheels'), reqDir = path.join(dir, 'stand-in-requirements'), data = path.join(dir, 'data');
      fs.mkdirSync(wheels); fs.mkdirSync(reqDir); fs.mkdirSync(data);
      const script = path.join(dir, 'make_wheel.py');
      fs.writeFileSync(script, MAKE_WHEEL);
      const py = systemPython()!;
      const fw = path.join(wheels, 'faster_whisper-1.2.1-py3-none-any.whl'), ct = path.join(wheels, 'ctranslate2-4.9.0-py3-none-any.whl');
      execFileSync(py, ['-I', script, fw, 'faster_whisper', 'faster-whisper', '1.2.1', 'ctranslate2==4.9.0']);
      execFileSync(py, ['-I', script, ct, 'ctranslate2', 'ctranslate2', '4.9.0']);
      const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
      const bytes = fs.statSync(fw).size + fs.statSync(ct).size;
      fs.writeFileSync(path.join(reqDir, 'requirements-speech-linux-x86_64.txt'), [
        '# PULSEFRAME TEST STAND-IN requirements (speechEngine.standin.test.ts): two wheels made at test time, not the speech engine.',
        '# SUPPORTED-PYTHON: 3.12 3.14', ...['3.12', '3.13', '3.14'].map((v) => `# DOWNLOAD-BYTES ${v}: ${bytes}`),
        `ctranslate2==4.9.0 --hash=sha256:${sha(ct)}`, `faster-whisper==1.2.1 --hash=sha256:${sha(fw)}`, '',
      ].join('\n'));

      const store = new Store(data);
      const project = store.createProject({ name: 'p' }).doc.id;
      const cfg = { ...loadConfig({}), dataDir: data, speechModelsDir: path.join(data, 'speech-models'), speechPython: null, voicePython: null };
      const speech = new Speech(store, cfg, null, { requirementsDir: reqDir, localWheels: wheels });
      const OWNER = { actor: 'user:local', kind: 'user' as const, scopes: ['observe' as const, 'edit' as const] };
      try {
        const before = await speech.status();
        expect({ reason: before.transcription.reason, source: before.engine.source }).toEqual({ reason: 'engine_not_configured', source: null });
        const plan = await speech.engineInstall.plan();
        expect(plan).toMatchObject({ supported: true, python: { found: true, fits: true }, downloadBytes: bytes, files: 2 });
        const started = Date.now();
        const job = await speech.engineInstall.start(OWNER, project, plan.downloadBytes!);
        await speech.engineInstall.idle();
        const j = store.getJob(job.id);
        expect({ status: j.status, error: j.error }).toEqual({ status: 'succeeded', error: null });
        expect(j.output).toMatchObject({ fasterWhisper: '1.2.1', ctranslate2: '4.9.0', files: 2 });
        const venvBytes = dataDirBytes(speech.engineInstall.venv);
        console.log(`[stand-in] install took ${((Date.now() - started) / 1000).toFixed(1)} s (one sample, loaded machine); venv ${venvBytes} bytes on disk; Python ${j.output.python}`);
        // nothing was written outside the data folder's engines/speech: the venv, the marker, no tmp left
        expect(fs.readdirSync(speech.engineInstall.root).sort()).toEqual(['installed.json', 'venv']);
        expect(speech.asrPython()).toBe(speech.engineInstall.venvPython());
        const after = await speech.status();
        expect({ ok: after.engine.ok, source: after.engine.source, version: after.engine.version, reason: after.transcription.reason }).toEqual({ ok: true, source: 'installed', version: '1.2.1', reason: 'model_missing' });
      } finally {
        await speech.stop();
        store.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      expect(fs.existsSync(dir)).toBe(false);
    }
  }, 300_000);
});
