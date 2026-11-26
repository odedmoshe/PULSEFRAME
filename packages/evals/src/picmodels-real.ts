/**
 * pnpm proof:picmodels-real — the laptop checks PM3 and PM5 of «הציעו עיניים» (wave 8 picmodels; picmodels-adr-draft.md gates; W2 owns
 * this file). It runs the REAL server code path (startServer on port 0 with a NEW EMPTY data folder in the system temp folder, deleted
 * at the end) against the owner's tools Python (PF_TOOLS_PYTHON) and the owner's content library (PF_LIBRARY_DIR, or the library
 * folder set in Settings of the owner's own data folder, read only), as the owner's own session.
 *   -- --setup            PM3: one line per picture model, `<id> <code>` (`yunet ready (232589 B verified)` when ready), with the
 *                         module the probe could not import or the missing bytes; never a path or a file name.
 *   -- --eyes <picture>   PM5: imports that ONE picture (a consented picture of an adult) into the temp data folder, waits until the
 *                         folder is still, asks for eye suggestions once, and prints `faces: N` (or the too-many / none outcome), each
 *                         pair in SHOWN pixels, the seconds of the request (one sample), and whether the data folder is unchanged
 *                         by the request (every file compared by SHA-256 before and after). [--frame n] for a video.
 * Nothing is written outside that temp folder: no evidence file (an eye position of a person is never stored, ADR-0007 amendment),
 * no log. Exits 2 (blocked, nothing measured) where PF_TOOLS_PYTHON or the library is missing or the eyes server part is not built in
 * this build; exits 1 when a check fails; 0 otherwise. Whether the rings sit on the eyes is for the owner to look at; nobody here can.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EyesAnswerSchema, PICTURE_MODELS, pictureModelBytes, type PictureModelStatus } from '@pulseframe/core';
import { loadConfig, type Config } from '../../../apps/server/src/config.ts';
import { startServer } from '../../../apps/server/src/index.ts';
import { LIBRARY_CONFIG_FILE } from '../../../apps/server/src/library/contract.ts';
import { PICMODELS_SERVER_BUILT } from '../../../apps/server/src/picmodels/contract.ts';

export const PICMODELS_REAL_CHECKS: Readonly<Record<string, string>> = {
  PM3: 'one line per picture model with its setup code; yunet ready with its verified bytes; never a path',
  PM5: 'one eyes request on one consented picture: faces and pairs in shown pixels, the seconds (one sample), the data folder unchanged by the request',
};

/** The library root as the owner's own server would read it (env first, else <data dir>/library.json), read only; null when unset. */
export function libraryRootOf(cfg: Config): string | null {
  if (cfg.libraryDir) return cfg.libraryDir;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, LIBRARY_CONFIG_FILE), 'utf8')) as { root?: unknown };
    return typeof j.root === 'string' && j.root ? j.root : null;
  } catch { return null; }
}

/** One setup line: never a path, a file name or the detail sentence (only codes, a module name and numbers). */
export function setupLine(r: Pick<PictureModelStatus, 'id' | 'code' | 'module' | 'missingBytes' | 'device'>): string {
  const m = PICTURE_MODELS.find((x) => x.id === r.id);
  if (r.code === 'ready') return `${r.id} ready (${m ? pictureModelBytes(m) : 0} B verified${r.device ? `, ${r.device}` : ''})`;
  const extra = [r.module ? `module ${r.module}` : null, r.missingBytes ? `missing ${r.missingBytes} B` : null].filter(Boolean).join(', ');
  return `${r.id} ${r.code}${extra ? ` (${extra})` : ''}`;
}

/** Relative file name → SHA-256 of every file under dir (the data folder's own names only, never an absolute path). */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { out.set(path.relative(dir, p).split(path.sep).join('/'), createHash('sha256').update(fs.readFileSync(p)).digest('hex')); } catch { out.set(path.relative(dir, p), 'unreadable'); } }
    }
  };
  walk(dir);
  return out;
}
/** The relative names that differ between two snapshots (added, removed or changed), sorted. */
export function changed(a: Map<string, string>, b: Map<string, string>): string[] {
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names].filter((n) => a.get(n) !== b.get(n)).sort();
}
/** Shown pixels of one (u, v) point, one decimal. */
export const shownPx = (u: number, v: number, w: number, h: number): string => `(${(u * w).toFixed(1)}, ${(v * h).toFixed(1)})`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const argOf = (argv: string[], name: string): string | null => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null; };

async function main(argv: string[]): Promise<number> {
  const setup = argv.includes('--setup'), eyesFile = argOf(argv, '--eyes');
  if (!setup && !eyesFile) { console.error('picmodels-real: say --setup (PM3) or --eyes <a consented picture of an adult> (PM5) [--frame n]'); return 2; }
  const cfg = loadConfig();
  if (!PICMODELS_SERVER_BUILT) { console.error('picmodels-real: BLOCKED: the eyes server part is not built in this build (contract.ts PICMODELS_SERVER_BUILT); nothing was measured'); return 2; }
  if (!cfg.toolsPython) { console.error('picmodels-real: BLOCKED: PF_TOOLS_PYTHON is not set (no tools environment); nothing was measured'); return 2; }
  const library = libraryRootOf(cfg);
  if (!library) { console.error('picmodels-real: BLOCKED: no library folder (PF_LIBRARY_DIR, or the folder set in Settings); nothing was measured'); return 2; }
  if (eyesFile && !fs.existsSync(eyesFile)) { console.error('picmodels-real: the picture given to --eyes does not exist (its name is not printed)'); return 2; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-picmodels-real-'));
  const dataDir = path.join(tmp, 'data');
  const server = await startServer({ port: 0, dataDir, libraryDir: library, backupDir: null, backupEveryHours: 0 });
  try {
    const base = server.url;
    const cookie = (await fetch(`${base}/api/v1/session`, { headers: { origin: base, 'x-pf-owner-key': server.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')?.split(';')[0];
    if (!cookie) { console.error('picmodels-real: FAIL: no owner session'); return 1; }
    const owner = { origin: base, cookie, connection: 'close' };
    const rest = (p: string, init: RequestInit = {}) => fetch(`${base}/api/v1${p}`, { ...init, headers: { ...owner, ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } });

    const models = (await (await rest('/picture-models')).json()) as { models: PictureModelStatus[] };
    for (const r of models.models) console.log(setupLine(r));
    const yunet = models.models.find((r) => r.id === 'yunet');
    if (setup) {
      if (!yunet) { console.log('FAIL PM3: the owner\'s answer has no yunet row'); return 1; }
      if (yunet.code === 'not_built') { console.log('BLOCKED PM3: yunet is not built in this build (core PICTURE_MODELS built: false); nothing was measured'); return 2; }
      if (yunet.code === 'engine_not_configured' ||(yunet.code === 'model_missing' && !fs.existsSync(library))) { console.log('BLOCKED PM3: the tools Python or the library is missing'); return 2; }
      console.log(`${yunet.code === 'ready' ? 'PASS' : 'FAIL'} PM3: yunet ${yunet.code}`);
      return yunet.code === 'ready' ? 0 : 1;
    }
    if (!yunet || yunet.code !== 'ready') { console.log(`BLOCKED PM5: yunet is ${yunet?.code ?? 'absent'}; run --setup first; nothing was measured`); return 2; }

    const project = (await (await rest('/projects', { method: 'POST', body: JSON.stringify({ name: 'picmodels-real' }) })).json()) as { project: { id: string } };
    const projectId = project.project.id;
    const up = await rest(`/projects/${projectId}/assets`, { method: 'POST', body: fs.readFileSync(eyesFile!), headers: { 'x-filename': `picture${path.extname(eyesFile!).toLowerCase().replace(/[^.a-z0-9]/g, '')}`, 'content-type': 'application/octet-stream' } });
    if (up.status !== 201) { console.log(`FAIL PM5: the import answered ${up.status} ${((await up.json().catch(() => ({}))) as { code?: string }).code ?? ''}`); return 1; }
    const asset = ((await up.json()) as { assetId: string; asset: { image?: { width: number; height: number }; video?: { width: number; height: number } } });
    const shown = asset.asset.image ?? asset.asset.video;
    if (!shown) { console.log('FAIL PM5: the file has no picture'); return 1; }
    const frameArg = argOf(argv, '--frame');
    const frame = asset.asset.image ? null : Number(frameArg ?? 0);

    // wait until the folder is still (thumbnails, proxies and the library index are made in the background): two equal snapshots 2 s apart
    let before = snapshot(dataDir), still = false;
    for (let k = 0; k < 90 && !still; k++) { await wait(2000); const again = snapshot(dataDir); still = changed(before, again).length === 0; before = again; }
    if (!still) { console.log('FAIL PM5: the data folder kept changing for 3 minutes before the request (background work); "unchanged" cannot be measured'); return 1; }

    const t0 = performance.now();
    const res = await rest(`/projects/${projectId}/eyes/propose`, { method: 'POST', body: JSON.stringify({ assetId: asset.assetId, frame }) });
    const seconds = (performance.now() - t0) / 1000;
    const body = await res.json().catch(() => null) as unknown;
    const noStore = res.headers.get('cache-control') === 'no-store';
    await wait(500);
    const diff = changed(before, snapshot(dataDir));
    if (res.status !== 200) { console.log(`FAIL PM5: the request answered ${res.status} ${(body as { code?: string } | null)?.code ?? ''} in ${seconds.toFixed(2)} s (one sample)`); }
    else {
      const parsed = EyesAnswerSchema.safeParse(body);
      if (!parsed.success) { console.log('FAIL PM5: the answer failed core EyesAnswerSchema'); return 1; }
      const a = parsed.data;
      console.log(a.outcome === 'faces' ? `faces: ${a.faces.length}` : a.outcome === 'none' ? 'faces: 0 (none found)' : `faces: none proposed (more than 8: too_many)`);
      a.faces.forEach((f, i) => console.log(`  face ${i + 1}: ${shownPx(f.eyes[0].u, f.eyes[0].v, shown.width, shown.height)} ${shownPx(f.eyes[1].u, f.eyes[1].v, shown.width, shown.height)} shown px of ${shown.width}x${shown.height}`));
      console.log(`method: ${a.method}`);
      console.log(`seconds of the request: ${seconds.toFixed(2)} (one sample, including the worker's start and the model's load)`);
      console.log(`cache-control no-store: ${noStore ? 'yes' : 'NO'}`);
    }
    console.log(diff.length ? `data dir CHANGED by the request: ${diff.join(', ')}` : 'data dir unchanged');
    const pass = res.status === 200 && noStore && diff.length === 0;
    console.log(`${pass ? 'PASS' : 'FAIL'} PM5 (the owner still looks whether the rings sit on the eyes; nobody here can)`);
    return pass ? 0 : 1;
  } finally {
    await server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
