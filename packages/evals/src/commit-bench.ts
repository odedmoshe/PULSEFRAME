/**
 * Per-phase cost of the authoritative edit path (Store.commit, apps/server/src/store.ts), on documents of growing size.
 *
 *   pnpm bench:commit [--label before|after] [--quick]
 *
 * Scenarios: 10, 100 and 1000 clips (set_clip_transform on one clip); a clip with 2000 keys (set_keyframe of one key, and
 * replace_clip_keyframes with 2000 keys as proof:keyframes does); a 200-tap take on the canvas bank (apply_take, allowInternal),
 * plus perform mode's live path (quantise + plan + applyTransaction in memory, as apps/web capture.ts liveDocument does).
 *
 * Phases are timed on an instrumented copy of Store.commit's steps, in its order, against a real Store's SQLite database:
 *   load (SELECT + JSON.parse + migrateProject) · clone (structuredClone in applyTransaction) · parse (zod args; for apply_take
 *   the outer schema and every step's) · apply (the op bodies, step parses excluded) · validate (validateProject) ·
 *   diff (diffEntities + privacyChanged) · serialise (JSON.stringify of document, ops, result, changes, event) ·
 *   write (the SQLite statements) · emit (drainOutbox).
 * `commit` is the real Store.commit, end to end, timed separately on the same edit (it is the number that matters; the phases
 * explain it). Every run starts from a fresh copy of the scenario's document, so all runs do the same work.
 * Results are written beside each other in docs/evidence/commit-bench.json under the label. One machine, one sample of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, defaultBank, diffEntities, getOp, listOps, makeIdSource, migrateProject, OpError, planPerformance, quantiseTaps, refuseInheritedIds, validateProject,
  type OpCall, type PadBank, type ProjectDocument, type QuantiseSettings, type Tap,
} from '@pulseframe/core';
import { Store } from '../../../apps/server/src/store.ts';
import { privacyChanged } from '../../../apps/server/src/privacyPurge.ts';

const args = process.argv.slice(2);
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1]! : 'before';
const QUICK = args.includes('--quick');
const OUT = new URL('../../../docs/evidence/commit-bench.json', import.meta.url);

const R30 = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R30);
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'bench' };
const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;
const VIDEO = { kind: 'video' as const, name: 'v.mp4', contentHash: hash('a'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(7200, 1), video: { width: 1920, height: 1080, frameRate: R30, codec: 'h264', rotation: 0, frameCount: 216000 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance };
let seedN = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `b${seedN++}_`, actor: 'bench', allowInternal: true });

/** A project with `clips` clips: media clips with their linked sound (2 clips each) and titles, about half and half. */
function clipsDoc(clips: number): { doc: ProjectDocument; target: string } {
  let doc = createProject({ id: 'prj_bench', name: 'bench', width: 1920, height: 1080, frameRate: R30 });
  let r = tx(doc, [{ op: 'import_asset', args: { asset: VIDEO } }]);
  doc = r.doc;
  const assetId = (r.results[0]!.output as { assetId: string }).assetId;
  const ops: OpCall[] = [];
  let made = 0, i = 0;
  while (made < clips) {
    if (i % 2 === 0 && made + 2 <= clips) { ops.push({ op: 'add_clip', args: { assetId, start: f(i * 30), sourceIn: f(i * 30), duration: f(30) } }); made += 2; }
    else { ops.push({ op: 'add_text', args: { text: `כותרת ${i}`, start: f(i * 30), duration: f(30) } }); made += 1; }
    i++;
  }
  for (let k = 0; k < ops.length; k += 200) doc = tx(doc, ops.slice(k, k + 200)).doc;
  const all = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips);
  if (all.length !== clips) throw new Error(`built ${all.length} clips, wanted ${clips}`);
  return { doc, target: all[Math.floor(all.length / 2)]!.id };
}
const keys2000 = (salt: number) => Array.from({ length: 2000 }, (_, k) => ({ time: f(k), value: Number((((k * 37 + salt * 11) % 200) / 1000 - 0.1).toFixed(4)), easing: (k % 3 === 0 ? 'smooth' : k % 3 === 1 ? 'overshoot' : 'linear') as 'smooth' }));
function keysDoc(): { doc: ProjectDocument; target: string } {
  let { doc } = clipsDoc(10);
  const r = tx(doc, [{ op: 'add_text', args: { text: 'keys', start: f(600), duration: f(2100) } }]);
  doc = r.doc;
  const target = (r.results[0]!.output as { clipId: string }).clipId;
  doc = tx(doc, [{ op: 'replace_clip_keyframes', args: { clipId: target, property: 'x', keys: keys2000(0) } }]).doc;
  return { doc, target };
}
/** The perform proof's 200 taps (pads 0..5 of the canvas bank, one every 0.16 s) over a 60 s picture, planned as the live path plans them. */
function takeDoc() {
  let doc = createProject({ id: 'prj_bench', name: 'bench', width: 1920, height: 1080, frameRate: R30 });
  const r = tx(doc, [{ op: 'import_asset', args: { asset: VIDEO } }]);
  doc = r.doc;
  doc = tx(doc, [{ op: 'add_clip', args: { assetId: (r.results[0]!.output as { assetId: string }).assetId, start: T.ZERO, duration: f(1800) } }]).doc;
  const taps: Tap[] = Array.from({ length: 200 }, (_, i) => ({ pad: [0, 1, 2, 3, 4, 5][i % 6]!, down: 1 + i * 0.16, up: 1.05 + i * 0.16 }));
  const bank: PadBank = defaultBank('canvas').map((m) => (m && m.kind === 'sound' ? null : m));
  const settings: QuantiseSettings = { snap: 'off', tempo: 'normal', strength: 0, parity: 0 };
  const plan = (base: ProjectDocument) => {
    const hits = quantiseTaps(taps, [], settings, base.settings.frameRate, bank);
    return planPerformance(base, { hits, bank, assets: Array(bank.length).fill(null), settings, gpu: false });
  };
  const planned = plan(doc);
  if (!planned.args) throw new Error('the take planned nothing');
  return { doc, plan, call: { op: 'apply_take', args: planned.args } as OpCall, hits: planned.args.take.hits, steps: planned.args.steps.length };
}

// ---- timing of zod parses inside op bodies (apply_take parses every step itself)
let innerParse = 0, counting = false;
for (const def of listOps()) {
  const schema = def.args as unknown as { safeParse: (v: unknown) => unknown };
  const orig = schema.safeParse.bind(schema);
  schema.safeParse = (v: unknown) => { if (!counting) return orig(v); const t0 = performance.now(); try { return orig(v); } finally { innerParse += performance.now() - t0; } };
}

const PHASES = ['load', 'clone', 'parse', 'apply', 'validate', 'diff', 'serialise', 'write', 'emit'] as const;
type Phase = (typeof PHASES)[number];

/** Store.commit's steps, in its order, each timed (the guard, idempotency and rebase branches are not taken by these edits). */
function phasedCommit(store: Store, projectId: string, ops: OpCall[], allowInternal: boolean): Record<Phase, number> {
  const t: Record<Phase, number> = { load: 0, clone: 0, parse: 0, apply: 0, validate: 0, diff: 0, serialise: 0, write: 0, emit: 0 };
  let c = performance.now();
  const lap = (p: Phase) => { const n = performance.now(); t[p] += n - c; c = n; };
  const db = store.db;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT doc, revision FROM projects WHERE id = ?').get(projectId) as { doc: string; revision: number };
    const doc = migrateProject(JSON.parse(row.doc));
    lap('load');
    const idSeed = randomBytes(5).toString('hex');
    const draft = structuredClone(doc);
    lap('clone');
    const ctx = { newId: makeIdSource(idSeed), actor: 'bench' };
    const results: { op: string; summary: string; affectedIds: string[]; output?: Record<string, unknown> }[] = [];
    for (const call of ops) {
      const def = getOp(call.op)!;
      const parsed = def.args.safeParse(call.args);
      if (!parsed.success) throw new Error(`bench op ${call.op} does not parse`);
      refuseInheritedIds(parsed.data, call.op, '', def.checksOwnIds);
      lap('parse');
      innerParse = 0; counting = true;
      try { results.push({ op: call.op, ...def.apply(draft, parsed.data, ctx) }); } finally { counting = false; }
      lap('apply');
      t.apply -= innerParse; t.parse += innerParse;
    }
    const issues = validateProject(draft);
    if (issues.length) throw new OpError('invalid_result', issues[0]!.message);
    lap('validate');
    const changes = diffEntities(doc, draft);
    privacyChanged(changes, doc, draft);
    lap('diff');
    const affectedIds = [...new Set([...results.flatMap((r) => r.affectedIds), ...changes.map((x) => x.id)])];
    const summary = results.map((r) => r.summary).join('; ');
    const base = { affectedIds, summary, results, warnings: [] as string[] };
    const at = new Date().toISOString();
    const next = row.revision + 1;
    const txId = `tx_${randomBytes(8).toString('hex')}`;
    const docJson = JSON.stringify(draft), opsJson = JSON.stringify(ops), baseJson = JSON.stringify(base), changesJson = JSON.stringify(changes);
    const eventJson = JSON.stringify({ projectId, revision: next, transactionId: txId, actor: 'bench', label: null, summary, affectedIds, at, kind: 'edit', ops: [...new Set(ops.map((o) => o.op))], undoes: null, undoneBy: null });
    lap('serialise');
    db.prepare('UPDATE projects SET doc = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?').run(docJson, next, at, projectId, row.revision);
    db.prepare('INSERT INTO transactions (project_id, revision, id, actor, label, idempotency_key, request_id, id_seed, allow_internal, ops, result, created_at, kind, undoes, changes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(projectId, next, txId, 'bench', null, null, null, idSeed, allowInternal ? 1 : 0, opsJson, baseJson, at, 'edit', null, changesJson);
    const setVersion = db.prepare('INSERT INTO entity_versions (project_id, entity_id, revision, deleted, actor) VALUES (?,?,?,?,?) ON CONFLICT(project_id, entity_id) DO UPDATE SET revision = excluded.revision, deleted = excluded.deleted, actor = excluded.actor');
    for (const ch of changes) setVersion.run(projectId, ch.id, next, ch.after ? 0 : 1, 'bench');
    db.prepare('INSERT INTO outbox (project_id, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(projectId, 'revision', eventJson, at);
    db.exec('COMMIT');
    lap('write');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  store.drainOutbox();
  lap('emit');
  return t;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!; };
const r2 = (x: number) => Math.round(x * 1000) / 1000;
interface Row { scenario: string; runs: number; documentBytes: number; median: Record<string, number>; p95: Record<string, number> }

function bench(name: string, base: ProjectDocument, edit: (i: number) => OpCall, runs: number, allowInternal = false): Row {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-commitbench-'));
  const store = new Store(dir);
  store.events.on('revision', () => {}); // a listener, as the server has
  try {
    const samples: Record<string, number[]> = Object.fromEntries([...PHASES, 'sum', 'commit'].map((p) => [p, []]));
    const warm = Math.min(5, runs);
    for (let i = 0; i < warm + runs; i++) {
      const a = store.importProject(base).doc.id;
      const ph = phasedCommit(store, a, [edit(i)], allowInternal);
      const b = store.importProject(base).doc.id;
      const t0 = performance.now();
      const res = store.commit({ projectId: b, actor: 'bench', ops: [edit(i)], allowInternal });
      const commit = performance.now() - t0;
      if (!res.committed) throw new Error(`${name}: the edit did not commit`);
      if (i < warm) continue;
      let sum = 0;
      for (const p of PHASES) { samples[p]!.push(ph[p]); sum += ph[p]; }
      samples.sum!.push(sum); samples.commit!.push(commit);
    }
    const median = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, r2(pct(v, 50))]));
    const p95 = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, r2(pct(v, 95))]));
    return { scenario: name, runs, documentBytes: JSON.stringify(base).length, median, p95 };
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function benchLive(t: ReturnType<typeof takeDoc>, runs: number) {
  const plan: number[] = [], apply: number[] = [], total: number[] = [];
  for (let i = 0; i < 5 + runs; i++) {
    const t0 = performance.now();
    const planned = t.plan(t.doc);
    const t1 = performance.now();
    applyTransaction(t.doc, [{ op: 'apply_take', args: planned.args }], { idSeed: 'live', actor: 'view', allowInternal: true });
    const t2 = performance.now();
    if (i < 5) continue;
    plan.push(t1 - t0); apply.push(t2 - t1); total.push(t2 - t0);
  }
  const s = (xs: number[]) => ({ median: r2(pct(xs, 50)), p95: r2(pct(xs, 95)), max: r2(Math.max(...xs)) });
  return { scenario: 'perform live path: 200 taps, plan + applyTransaction in memory (Node)', runs, plan: s(plan), applyTransaction: s(apply), total: s(total) };
}

const n = (full: number) => (QUICK ? Math.max(10, Math.round(full / 5)) : full);
const rows: Row[] = [];
const log = (r: Row) => { rows.push(r); console.log(`${r.scenario.padEnd(58)} ${String(r.documentBytes).padStart(8)} B  commit p50 ${r.median.commit!.toFixed(2)} p95 ${r.p95.commit!.toFixed(2)} | ${PHASES.map((p) => `${p} ${r.median[p]!.toFixed(2)}`).join(' ')}`); };

for (const clips of [10, 100, 1000]) {
  const { doc, target } = clipsDoc(clips);
  log(bench(`${clips} clips: set_clip_transform on one clip`, doc, (i) => ({ op: 'set_clip_transform', args: { clipId: target, transform: { x: ((i % 97) + 1) / 1000 } } }), n(clips === 1000 ? 60 : 200)));
}
{
  const { doc, target } = keysDoc();
  log(bench('2000 keys: set_keyframe (one key)', doc, (i) => ({ op: 'set_keyframe', args: { clipId: target, property: 'x', time: f(1000), value: ((i % 97) + 1) / 1000 } }), n(60)));
  log(bench('2000 keys: replace_clip_keyframes (2000 keys)', doc, (i) => ({ op: 'replace_clip_keyframes', args: { clipId: target, property: 'x', keys: keys2000(i + 1) } }), n(60)));
}
const take = takeDoc();
console.log(`take: ${take.hits} hits kept, ${take.steps} steps`);
log(bench(`take: apply_take of ${take.hits} hits (${take.steps} steps)`, take.doc, () => take.call, n(40), true));
const live = benchLive(take, n(40));
console.log(`${live.scenario}: plan p50 ${live.plan.median} · applyTransaction p50 ${live.applyTransaction.median} · total p50 ${live.total.median} p95 ${live.total.p95} max ${live.total.max}`);

let out: Record<string, unknown> = {};
try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }
out.about = 'pnpm bench:commit (packages/evals/src/commit-bench.ts). Milliseconds per commit: median and p95 per phase, over `runs` runs after 5 warm-ups. `sum` adds the phases of the instrumented copy of Store.commit; `commit` is the real Store.commit on the same edit. One machine, one sample of it, under whatever else ran.';
out[LABEL] = { ranAt: new Date().toISOString(), machine: `${os.cpus()[0]?.model} ×${os.cpus().length}, node ${process.version}`, quick: QUICK, rows, live };
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), OUT.pathname)} (${LABEL})`);
