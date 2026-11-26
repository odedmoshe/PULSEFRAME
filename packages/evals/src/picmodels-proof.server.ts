/**
 * proof:picmodels, server part (W1 owns this file): a real server (startServer port 0, deps.picmodelsTest = the LABELLED fake worker
 * «TEST-ADAPTER-picture/1», its digest, a synthetic registry whose yunet pin names a tiny synthetic file, and a synthetic library root
 * with _manifests/ledger.json; apps/server/src/picmodels/testWorld.ts), the fixtures of picmodels-fixtures.ts plus EXIF stills
 * (makeExifStill → captureMeta.fixtures.ts withExif). Checks: E3, E5, E6, E7, E8, E10 (server side), E11, E12, R1, R2 of
 * PICMODELS_CHECKS. It proves the plumbing, never the model. The world is made on the first check and removed when the process exits.
 * `pnpm tsx packages/evals/src/picmodels-proof.server.ts --run` runs this part alone (the entry exits 2 until every part is built).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PICTURE_MODELS } from '@pulseframe/core';
import { startServer, type RunningServer } from '../../../apps/server/src/index.ts';
import { PEOPLE_REST_SURFACES } from '../../../apps/server/src/peopleSurfaces.ts';
import { PICTURE_TEST_ADAPTER_LABEL } from '../../../apps/server/src/picmodels/contract.ts';
import { createPictureModelsRuntime } from '../../../apps/server/src/picmodels/runtime.ts';
import { ledgerEntry, makePicWorld, pidsRunning, SYNTHETIC_MODEL_PATH, type PicWorld } from '../../../apps/server/src/picmodels/testWorld.ts';
import { EXIF_FACE, makeExifStill, makePicmodelsFixtures, type PicmodelsFixtures } from './picmodels-fixtures.ts';
import type { PicmodelsProofPart } from './picmodels-proof.ts';

interface World { w: PicWorld; s: RunningServer; fx: PicmodelsFixtures; ids: Record<string, string>; cookie: string; pid: string; answers: string[]; printed: string[] }
let world: Promise<World> | null = null;
const printed: string[] = [];

async function make(): Promise<World> {
  const w = makePicWorld('pf-picproof-');
  process.on('exit', () => { try { fs.rmSync(w.root, { recursive: true, force: true }); } catch { /* best effort */ } });
  if (!w.python) throw new Error('no python3 on PATH: the labelled fake cannot run');
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => { printed.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); orig(...a); };
  }
  const dir = path.join(w.root, 'fixtures');
  const fx = makePicmodelsFixtures(dir);
  const exif6 = makeExifStill(dir, 'exif6.jpg', 6, 640, 480, [EXIF_FACE]);
  const exif3 = makeExifStill(dir, 'exif3.jpg', 3, 640, 480, [EXIF_FACE]);
  const s = await startServer({ port: 0, dataDir: path.join(w.root, 'data'), toolsPython: w.python, libraryDir: null, backupDir: null, speechPython: null, voicePython: null }, { picmodelsTest: w.seams });
  process.on('exit', () => { for (const p of pidsRunning(w.worker)) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } });
  const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
  const h = { cookie, origin: s.url, 'content-type': 'application/json', connection: 'close' };
  const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'eyes proof', width: 640, height: 360 }) })).json()) as any).project.id as string;
  const ids: Record<string, string> = {};
  for (const [name, file] of [...Object.entries(fx.stills).map(([k, v]) => [k, v.file] as const), ['video', fx.video.file] as const, ['exif6', exif6.file] as const, ['exif3', exif3.file] as const]) {
    const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { cookie, origin: s.url, 'x-filename': path.basename(file), connection: 'close' }, body: new Uint8Array(fs.readFileSync(file)) });
    const j = (await r.json()) as any;
    if (r.status !== 201) throw new Error(`upload of ${name} answered ${r.status}`);
    ids[name] = j.assetId;
  }
  await s.derivatives.idle();
  return { w, s, fx, ids, cookie, pid, answers: [], printed };
}
const get = () => (world ??= make());
const ownerH = (x: World) => ({ cookie: x.cookie, origin: x.s.url, 'content-type': 'application/json', connection: 'close' });
async function propose(x: World, body: unknown, opts: { signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const r = await fetch(`${x.s.url}/api/v1/projects/${x.pid}/eyes/propose`, { method: 'POST', headers: opts.headers ?? ownerH(x), body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) });
  const text = await r.text();
  x.answers.push(text);
  return { status: r.status, body: JSON.parse(text) as any };
}
const ask = (x: World, name: string, frame: number | null = null) => propose(x, { assetId: x.ids[name], frame });
const dist = (p: { u: number; v: number }, q: { x: number; y: number }, W: number, H: number) => Math.hypot(p.u * W - q.x, p.v * H - q.y);
const waitFor = async (cond: () => boolean, ms: number) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); return cond(); };
const withMode = async <T>(mode: string | null, fn: () => Promise<T>): Promise<T> => {
  if (mode) process.env.PF_FAKE_PICTURE_MODE = mode; else delete process.env.PF_FAKE_PICTURE_MODE;
  try { return await fn(); } finally { delete process.env.PF_FAKE_PICTURE_MODE; }
};
/** Where `value` is recorded: every table, the events, every file under the data folder (tmp included, WAL folded), the printed lines, the answers. */
function whereIs(x: World, value: string, answers: string[]): string[] {
  const hits: string[] = [];
  x.s.store.db.pragma('wal_checkpoint(TRUNCATE)');
  for (const { name } of x.s.store.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]) if (JSON.stringify(x.s.store.db.prepare(`SELECT * FROM "${name}"`).all()).includes(value)) hits.push(`table ${name}`);
  if (JSON.stringify(x.s.store.eventsSince(x.pid, 0)).includes(value)) hits.push('events');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() ? [path.join(d, e.name)] : []));
  for (const f of walk(x.s.cfg.dataDir)) if (fs.readFileSync(f).includes(Buffer.from(value))) hits.push(`file ${path.relative(x.s.cfg.dataDir, f)}`);
  if (x.printed.some((l) => l.includes(value))) hits.push('server output');
  if (answers.some((a) => a.includes(value))) hits.push('an answer');
  return hits;
}
const fail = (why: string): string => why;

const checks: PicmodelsProofPart['checks'] = {
  E3: async () => {
    const x = await get();
    for (const name of ['exif6', 'exif3']) {
      const r = await ask(x, name);
      if (r.body.outcome !== 'faces') return fail(`${name}: outcome ${r.body.outcome ?? r.status}`);
      const d = [dist(r.body.faces[0].eyes[0], EXIF_FACE.a, 640, 480), dist(r.body.faces[0].eyes[1], EXIF_FACE.b, 640, 480)];
      if (d.some((v) => v >= 1.5)) return fail(`${name}: points ${d.map((v) => v.toFixed(2)).join(', ')} shown px from the drawn centres`);
      const a = x.s.store.getProject(x.pid).doc.assets[x.ids[name]!]!;
      if (a.image?.width !== 640 || a.image.height !== 480) return fail(`${name}: asset.image is ${a.image?.width}×${a.image?.height}`);
    }
    return true; // all 8 orientations: apps/server/src/picmodels/frames.test.ts (decoded size = asset.image, marker at its shown place)
  },
  E5: async () => {
    const x = await get();
    for (const name of ['none', 'decoy']) {
      const r = await ask(x, name);
      if (JSON.stringify(r.body) !== JSON.stringify({ outcome: 'none', faces: [], method: PICTURE_TEST_ADAPTER_LABEL })) return fail(`${name}: ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    const one = await ask(x, 'one');
    const f = x.fx.stills.one.faces[0]!;
    if (one.body.outcome !== 'faces' || one.body.faces.length !== 1 || dist(one.body.faces[0].eyes[0], f.a, 640, 480) >= 1.5 || dist(one.body.faces[0].eyes[1], f.b, 640, 480) >= 1.5) return fail(`one.png: ${JSON.stringify(one.body).slice(0, 160)}`);
    return true;
  },
  E6: async () => {
    const x = await get();
    const r = await ask(x, 'video', 12);
    if (r.body.outcome !== 'faces') return fail(`frame 12: ${r.status}`);
    const e = x.fx.video.eyesAt(12), z = x.fx.video.eyesAt(0);
    const d = [dist(r.body.faces[0].eyes[0], e.a, 640, 360), dist(r.body.faces[0].eyes[1], e.b, 640, 360)];
    if (d.some((v) => v >= 1.5)) return fail(`frame 12 points ${d.map((v) => v.toFixed(2)).join(', ')} px off`);
    if (dist(r.body.faces[0].eyes[0], z.a, 640, 360) < 60) return fail('frame 12 answered frame 0\'s place');
    return true;
  },
  E7: async () => {
    const x = await get();
    await x.s.derivatives.idle();
    const count = () => JSON.stringify(['jobs', 'transactions', 'outbox', 'derivatives'].map((t) => (x.s.store.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n));
    const sizes = () => { x.s.store.db.pragma('wal_checkpoint(TRUNCATE)'); const o: Record<string, number> = {}; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) o[f] = fs.statSync(f).size; } }; walk(x.s.cfg.dataDir); return o; };
    const rows0 = count(), files0 = sizes(), printed0 = x.printed.length, ans0 = x.answers.length;
    const said = new Set<string>();
    await withMode('planted', async () => { for (let k = 0; k < 20; k++) { const r = await ask(x, k % 2 ? 'one' : 'two'); for (const f of r.body.faces ?? []) for (const p of f.eyes) said.add(String(p.u)); } });
    if (said.size < 3) return fail(`only ${said.size} distinct planted values answered`);
    const mine = x.answers.slice(ans0);
    for (const u of said) { const at = whereIs({ ...x, printed: x.printed.slice(printed0) }, u, mine); if (at.join() !== 'an answer') return fail(`a planted answer value is in: ${at.join(', ') || 'nowhere (not even the answer)'}`); }
    const raw = whereIs(x, '1234567', []);
    if (raw.length) return fail(`the worker's raw planted value is in: ${raw.join(', ')}`);
    if (count() !== rows0) return fail(`row counts changed: ${rows0} → ${count()}`);
    for (const [f, n] of Object.entries(sizes())) if (!(f in files0) || n > files0[f]!) return fail(`a file was created or grew under the data folder: ${path.relative(x.s.cfg.dataDir, f)}`);
    return true;
  },
  E8: async () => {
    const x = await get();
    const full = x.s.governance.createGrant({ name: 'full', mode: 'edit', people: 'full' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
    const propose_ = x.s.governance.createGrant({ name: 'proposer', mode: 'propose' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
    for (const token of [x.s.auth.tokens.agent, full, propose_]) {
      const r = await propose(x, { nonsense: true, frame: -1 }, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' } });
      if (r.status !== 403 || r.body.error?.code !== 'owner_required') return fail(`an agent credential got ${r.status} ${r.body.error?.code}`);
      const m = (await (await fetch(`${x.s.url}/api/v1/picture-models`, { headers: { authorization: `Bearer ${token}`, connection: 'close' } })).json()) as any;
      if (/yunet|eyes|face/i.test(JSON.stringify(m))) return fail('an agent\'s /picture-models names the yunet row');
      if (m.models.some((r: object) => Object.keys(r).sort().join() !== 'code,device,id,missingBytes,output')) return fail('an agent\'s row holds more than codes and numbers');
      const tools = await fetch(`${x.s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
      if (/"name":"[^"]*(eye|face|picture_model)/i.test(await tools.text())) return fail('MCP tools/list names an eyes tool');
    }
    if (JSON.stringify(PEOPLE_REST_SURFACES['POST /api/v1/projects/:id/eyes/propose']) !== '["owner-only"]') return fail('peopleSurfaces does not classify the eyes route owner-only');
    return true;
  },
  E10: async () => {
    const x = await get();
    const ac = new AbortController();
    const first = withMode('slow', async () => { const p = propose(x, { assetId: x.ids.one, frame: null }, { signal: ac.signal }).then(() => 'answered', () => 'aborted'); if (!(await waitFor(() => pidsRunning(x.w.worker).length === 1, 10_000))) return 'no process'; ac.abort(); return p; });
    const how = await first;
    if (how !== 'aborted') return fail(`the aborted request ended ${how}`);
    if (!(await waitFor(() => pidsRunning(x.w.worker).length === 0, 1000))) return fail('the worker process was still alive 1 s after the abort');
    const next = await ask(x, 'one');
    if (next.body.outcome !== 'faces') return fail(`the next request answered ${next.status}`);
    if (!(await waitFor(() => pidsRunning(x.w.worker).length === 0, 1000))) return fail('the worker process stayed after its answer');
    return true;
  },
  E11: async () => {
    const x = await get();
    const p0 = x.printed.length;
    for (const mode of ['box', 'score', 'landmark', 'count', 'third', 'outside', 'nan', 'garbage', 'crash', 'exit-early']) {
      const r = await withMode(mode, () => ask(x, 'one'));
      if (r.status !== 502 || r.body.error?.code !== 'eyes_engine_failed') return fail(`${mode}: ${r.status} ${r.body.error?.code}`);
      if (Object.values(r.body.error.details ?? {}).some((v) => !['string', 'number'].includes(typeof v) || /\s/.test(String(v)))) return fail(`${mode}: details hold more than codes and integers`);
      if (/Traceback|fake crash|not json|ZodError|SyntaxError/.test(JSON.stringify(r.body))) return fail(`${mode}: worker or parser text in the answer`);
    }
    if (x.printed.length !== p0) return fail(`the server printed ${x.printed.length - p0} lines`);
    return true;
  },
  E12: async () => {
    const x = await get();
    const r = await ask(x, 'nine');
    return JSON.stringify(r.body) === JSON.stringify({ outcome: 'too_many', faces: [], method: PICTURE_TEST_ADAPTER_LABEL }) ? true : fail(`nine.png: ${JSON.stringify(r.body).slice(0, 160)}`);
  },
  R1: async () => {
    const x = await get();
    const rt = (over: Record<string, unknown> = {}, seams: Record<string, unknown> = {}) => createPictureModelsRuntime({ cfg: { ...x.s.cfg, ...over } as never, store: x.s.store, ...x.w.seams, ...seams });
    const code = async (r: ReturnType<typeof rt>) => { const v = await r.setup('yunet'); await r.stop(); return v; };
    const want: [string, () => Promise<{ code: string; module?: string | null; missingBytes?: number }>, string, Record<string, unknown>?][] = [
      ['ready', () => code(rt()), 'ready', { device: 'cpu' }],
      ['licence', () => code(rt({}, { registry: x.w.registry.map((m) => (m.id === 'yunet' ? { ...m, licence: { ...m.licence, spdx: 'GPL-3.0' } } : m)) })), 'licence_blocked'],
      ['no digest', () => code(rt({}, { workerSha256: null })), 'engine_unverified'],
      ['no python', () => code(rt({ toolsPython: null })), 'engine_not_configured'],
      ['probe', () => withMode('missing:onnxruntime', () => code(rt())), 'engine_not_working', { module: 'onnxruntime' }],
      ['library unset', () => code(rt({}, { libraryRoot: undefined })), 'model_missing', { missingBytes: x.w.model.bytes }],
    ];
    for (const [name, run, c, more] of want) {
      const v = await run() as Record<string, unknown>;
      if (v.code !== c) return fail(`${name}: ${String(v.code)} (wanted ${c})`);
      for (const [k, val] of Object.entries(more ?? {})) if (v[k] !== val) return fail(`${name}: ${k} ${String(v[k])}`);
      if (/[\\/]|\.onnx|\.py/.test(String(v.detail))) return fail(`${name}: the detail names a path or a file`);
    }
    const keep = fs.readFileSync(x.w.worker);
    try { fs.appendFileSync(x.w.worker, '#'); const v = await code(rt()); if (v.code !== 'engine_unverified') return fail(`changed worker byte: ${v.code}`); } finally { fs.writeFileSync(x.w.worker, keep); }
    const pin = PICTURE_MODELS[0]!.pins[0]!;
    try {
      for (const [name, entries] of [['item absent', []], ['other sha', [ledgerEntry({ item: pin.item, path: SYNTHETIC_MODEL_PATH, sha256: 'e'.repeat(64), bytes: x.w.model.bytes })]]] as const) {
        x.w.writeLedger([...entries]);
        const v = await code(rt());
        if (v.code !== 'model_missing' || v.missingBytes !== x.w.model.bytes) return fail(`${name}: ${v.code} ${v.missingBytes}`);
      }
      x.w.goodLedger();
      const bytes = fs.readFileSync(x.w.model.file);
      try { fs.writeFileSync(x.w.model.file, Buffer.concat([bytes, Buffer.from('x')])); const v = await code(rt()); if (v.code !== 'model_missing' || v.missingBytes !== x.w.model.bytes) return fail(`size off by one: ${v.code}`); } finally { fs.writeFileSync(x.w.model.file, bytes); }
    } finally { x.w.goodLedger(); }
    const rows = (await (await fetch(`${x.s.url}/api/v1/picture-models`, { headers: ownerH(x) })).json()) as any;
    if (rows.models.slice(1).some((m: { code: string }) => m.code !== 'not_built')) return fail('a depth or matte row is not not_built');
    return true;
  },
  R2: async () => {
    const x = await get();
    const rt = () => createPictureModelsRuntime({ cfg: x.s.cfg, store: x.s.store, ...x.w.seams });
    const pin = PICTURE_MODELS[0]!.pins[0]!;
    const outside = path.join(x.w.root, 'outside.onnx'), link = path.join(x.w.library, 'models', 'linked.onnx');
    try {
      x.w.writeLedger([ledgerEntry({ item: 'another/item', path: 'models/another', sha256: x.w.model.sha256, bytes: x.w.model.bytes })]);
      let r = rt(); let v = await r.setup('yunet'); await r.stop();
      if (v.code !== 'model_missing') return fail(`absent from the ledger: ${v.code}`);
      fs.copyFileSync(x.w.model.file, outside);
      fs.symlinkSync(outside, link);
      x.w.writeLedger([ledgerEntry({ item: pin.item, path: 'models/linked.onnx', sha256: x.w.model.sha256, bytes: x.w.model.bytes })]);
      r = rt(); v = await r.setup('yunet'); await r.stop();
      if (v.code !== 'model_missing') return fail(`a link out of the library (whose target would verify): ${v.code}`);
    } finally { fs.rmSync(link, { force: true }); fs.rmSync(outside, { force: true }); x.w.goodLedger(); }
    return true;
  },
};

export const PICMODELS_PROOF_SERVER: PicmodelsProofPart = { built: true, checks };

// run this part alone (the entry point exits 2 while the interface part is not built)
if (process.argv.includes('--run') && /picmodels-proof\.server\.ts$/.test(process.argv[1] ?? '')) {
  let failed = 0;
  for (const [id, check] of Object.entries(checks)) {
    const r = await check().catch((e: unknown) => `threw: ${(e as Error).message}`);
    console.log(`${r === true ? 'PASS' : 'FAIL'} ${id} (server)${r === true ? '' : `: ${r}`}`);
    if (r !== true) failed++;
  }
  console.log(failed ? `picmodels-proof server part: ${failed} failed` : 'picmodels-proof server part: all checks passed (labelled test adapter; not a model)');
  process.exit(failed ? 1 : 0);
}
