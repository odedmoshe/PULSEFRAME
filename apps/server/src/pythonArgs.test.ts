/**
 * Python workers print Hebrew (transcripts, titles). On Windows a piped stdout is the system code page unless the interpreter runs in
 * UTF-8 mode, and `-I` ignores PYTHONUTF8 / PYTHONIOENCODING, so the mode is given on the command line (pythonArgs.ts).
 * What this file can show on Linux: the flags, their effect on a real interpreter, and the failure they prevent, provoked with the
 * one switch that makes a Linux interpreter behave like the Windows default (a cp1252 stdout). The Windows run itself is the owner's.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PYTHON_WORKER_FLAGS } from './pythonArgs.ts';

const PY = (() => { for (const p of ['python3', 'python']) { try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p; } catch { /* next */ } } return null; })();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pyargs-'));
const script = path.join(dir, 'he.py');
fs.writeFileSync(script, 'import json, sys\nsys.stdout.write(json.dumps({"text": "\\u05e9\\u05dc\\u05d5\\u05dd \\u05e2\\u05d5\\u05dc\\u05dd", "enc": sys.stdout.encoding, "utf8": sys.flags.utf8_mode, "isolated": sys.flags.isolated}, ensure_ascii=False) + "\\n")\n');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('how Python workers are started', () => {
  it('isolated and in UTF-8 mode, in that order before the script', () => {
    expect([...PYTHON_WORKER_FLAGS]).toEqual(['-I', '-X', 'utf8']);
  });
  it('every worker spawn in the server uses the shared flags (no bare -I left)', () => {
    const src = path.join(import.meta.dirname, '.');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path.join(d, e.name)] : []);
    const bare = walk(src).filter((f) => !f.endsWith('pythonArgs.ts') && /\[\s*'-I'\s*,/.test(fs.readFileSync(f, 'utf8')));
    expect(bare.map((f) => path.relative(src, f))).toEqual([]);
  });
  it.skipIf(!PY)('a real interpreter started with the flags prints Hebrew as UTF-8 whatever the environment says', () => {
    const out = execFileSync(PY!, [...PYTHON_WORKER_FLAGS, script], { env: { ...process.env, PYTHONIOENCODING: 'cp1252', LC_ALL: 'C' } });
    const o = JSON.parse(out.toString('utf8'));
    expect(o).toEqual({ text: 'שלום עולם', enc: 'utf-8', utf8: 1, isolated: 1 });
  });
  it.skipIf(!PY)('the failure the flag prevents: the same line on a cp1252 stdout is the owner\'s error', () => {
    const r = spawnSync(PY!, [script], { env: { ...process.env, PYTHONIOENCODING: 'cp1252' } });
    expect(r.status).not.toBe(0);
    expect(r.stderr.toString('utf8')).toMatch(/UnicodeEncodeError: 'charmap' codec can't encode characters/);
  });
});
