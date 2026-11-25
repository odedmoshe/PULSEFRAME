/**
 * pnpm proof:search, part server (builder B): checks S1, S4–S8, S11–S16 of footage-search-proof.ts FOOTAGE_CHECKS.
 *
 * WHAT RUNS: the real Store, Auth, Governance, the real app (createApp) and MCP handler with the real picture search runtime
 * (apps/server/src/search/runtime.ts), composed in this process the way index.ts composes them (apps/server/src/search/testdata/harness.ts),
 * so a restart is a new Store and runtime on the same data directory and the export wait is the compute lane's export flag, the very call
 * export.ts makes around a server export (FifoComputeLane.setExportActive). The picture model is the LABELLED TEST-DOUBLE-embedder/1
 * (testEmbedder.ts): it proves plumbing, never quality. No network, no download, no real model (that is footage-search-real.ts).
 * FIXTURES: synthetic only, made here by ffmpeg from raw frames: colours.mp4 (12 s at 10 fps: red, blue, green, yellow, 3 s each, a
 * white disc), colours2.mp4 (4 s red with a white square), VID_20241226_183000.mp4 (4 s grey), long.mp4 (40 s at 2 fps, red then blue:
 * two batches); every frame carries its decode index as the fixture generator's 16-bit barcode (packages/fixtures BARCODE), read back
 * from the 256×256 frames the scan decoded. Invented people «אלף» and "Gimel", a pearl named «תוויתסוד». Never an owner's clip.
 *
 * Each check returns true or a sentence. A sentence that begins with "BLOCKED" means it could not run here. Anything else is a failure.
 * The core functions are builder A's real ones (the labelled stand-ins B used before A was merged were deleted at integration).
 * Stand-alone: `tsx packages/evals/src/footage-search-proof.server.ts` (exit 0 all pass, 1 a failure, 2 only blocked besides passes).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOTAGE_EMBEDDERS, FOOTAGE_SEARCH_BUILT, FootageSearchNotBuilt, sampleFrameTargets } from '@pulseframe/core';
import { BARCODE, readBarcode } from '@pulseframe/fixtures';
import { planArchive, writeArchive } from '../../../apps/server/src/archive.ts';
import { backupDataDir } from '../../../apps/server/src/backup.ts';
import { collectGarbage, deleteProject } from '../../../apps/server/src/storage.ts';
import { CORE, type FootageCore } from '../../../apps/server/src/search/answer.ts';
import { SEARCH_INDEX_JOB_TYPE, SEARCH_LANE_PREFIX, SEARCH_PICTURE, SEARCH_WORKER_SHA256, type Embedder } from '../../../apps/server/src/search/contract.ts';
import { SearchIndexDb } from '../../../apps/server/src/search/indexDb.ts';
import { createSearchRuntime, SEARCH_WORKER } from '../../../apps/server/src/search/runtime.ts';
import { createTestEmbedder, type TestEmbedder } from '../../../apps/server/src/search/testEmbedder.ts';
import { createHarness, OWNER, until, type Harness } from '../../../apps/server/src/search/testdata/harness.ts';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { FifoComputeLane } from '../../../apps/server/src/lane.ts';
import { Store } from '../../../apps/server/src/store.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const core: FootageCore = CORE;
const aBuilt = FOOTAGE_SEARCH_BUILT;
const WAIT_A = 'BLOCKED: builder A\'s core functions (searchFootage, sampleFrameTargets, quantiseInt8, int8Dot, mergePictureHits) are not merged in this build';
const evidence: Record<string, unknown> = { core: 'builder A (real)', embedder: FOOTAGE_EMBEDDERS.testDouble };
const logs: string[] = [];
const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const consoleWas = Object.fromEntries(METHODS.map((m) => [m, console[m]]));
const capture = () => { for (const m of METHODS) console[m] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }; };
const release = () => { for (const m of METHODS) console[m] = consoleWas[m]!; };
const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

// ---------- fixtures ----------
const W = 160, H = 96;
const COLOURS: Record<string, [number, number, number]> = { red: [220, 30, 30], blue: [30, 50, 220], green: [30, 190, 40], yellow: [230, 220, 30], grey: [128, 128, 128] };
function frame(index: number, rgb: [number, number, number], shape: 'disc' | 'square' | null): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  const strip = Math.round(H * BARCODE.stripFrac), cell = W / BARCODE.bits;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      let c: [number, number, number] = rgb;
      if (y < strip) { const bit = (index >> (BARCODE.bits - 1 - Math.floor(x / cell))) & 1; c = bit ? [235, 235, 235] : [16, 16, 16]; }
      else if (shape === 'disc' && (x - W / 2) ** 2 + (y - 56) ** 2 < 14 ** 2) c = [240, 240, 240];
      else if (shape === 'square' && Math.abs(x - W / 2) < 12 && Math.abs(y - 56) < 12) c = [240, 240, 240];
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
    }
  return buf;
}
function video(file: string, fps: number, segments: [string, number][], shape: 'disc' | 'square' | null) {
  const frames: Buffer[] = [];
  for (const [c, s] of segments) for (let i = 0; i < s * fps; i++) frames.push(frame(frames.length, COLOURS[c]!, shape));
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${W}x${H}`, '-framerate', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-fflags', '+bitexact', '-flags:v', '+bitexact', file], { input: Buffer.concat(frames), maxBuffer: 1 << 28 });
  return { file, frames: frames.length, fps };
}
type Vid = ReturnType<typeof video>;

/** The test double, recording the barcode of every frame it is given (in order) and when each batch started. */
function recording(delayMs = 0): TestEmbedder & { barcodes: number[]; starts: number[] } {
  const inner = createTestEmbedder({ delayMs });
  const rec = Object.assign(Object.create(null), inner, { barcodes: [] as number[], starts: [] as number[] }) as TestEmbedder & { barcodes: number[]; starts: number[] };
  rec.embedImages = async (rgb, count, signal) => {
    rec.starts.push(Date.now());
    for (let k = 0; k < count; k++) rec.barcodes.push(readBarcode(rgb.subarray(k * 256 * 256 * 3, (k + 1) * 256 * 256 * 3), 256, 3, { x: 0, y: 0, w: 256, h: 256 }));
    return inner.embedImages(rgb, count, signal);
  };
  Object.defineProperty(rec, 'calls', { get: () => inner.calls });
  Object.defineProperty(rec, 'options', { get: () => inner.options });
  return rec;
}

// ---------- the world ----------
interface World { base: string; fx: { colours: Vid; colours2: Vid; vid: Vid; long: Vid } }
let worldP: Promise<World> | null = null;
const harnesses: Harness[] = [];
const world = () => (worldP ??= (async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-proof-'));
  const d = path.join(base, 'fx');
  fs.mkdirSync(d);
  capture();
  return {
    base, fx: {
      colours: video(path.join(d, 'colours.mp4'), 10, [['red', 3], ['blue', 3], ['green', 3], ['yellow', 3]], 'disc'),
      colours2: video(path.join(d, 'colours2.mp4'), 10, [['red', 4]], 'square'),
      vid: video(path.join(d, 'VID_20241226_183000.mp4'), 10, [['grey', 4]], null),
      long: video(path.join(d, 'long.mp4'), 2, [['red', 20], ['blue', 20]], null),
    },
  };
})());
function harness(embedder?: Embedder | null): Harness {
  const h = createHarness({ embedder: embedder === null ? null : {}, runtime: { core, ...(embedder ? { embedder } : {}) } });
  harnesses.push(h);
  return h;
}
const targets = (v: Vid) => sampleFrameTargets({ num: v.fps, den: 1 }, v.frames);
async function scan(h: Harness, pid: string, body: unknown = {}) {
  const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, body);
  if (r.status !== 202) throw new Error(`scan refused ${r.status} ${r.text.slice(0, 300)}`);
  await h.runtime.scans.settled(r.body.jobId);
  return h.store.getJob(r.body.jobId);
}
const search = (h: Harness, who: Harness['owner'], pid: string, query: string, extra: Record<string, unknown> = {}) => h.rest(who, 'POST', `/api/v1/projects/${pid}/search`, { query, ...extra });
const guard = async (fn: () => Promise<true | string>): Promise<true | string> => {
  try { return await fn(); } catch (e) { if (e instanceof FootageSearchNotBuilt || (e instanceof Error && /footage search is not built/.test(e.message))) return WAIT_A; throw e; }
};
const sig = (h: Harness, hash: string) => { const s = h.runtime.index()!.vectors([hash], FOOTAGE_EMBEDDERS.testDouble)[0]!; return Buffer.from(s.q.slice(600, 632).buffer); };
const indexBytes = (h: Harness) => { const f = path.join(h.dir, 'search', 'index.sqlite'); return Buffer.concat([f, `${f}-wal`].filter((x) => fs.existsSync(x)).map((x) => fs.readFileSync(x))); };

// ---------- checks ----------
const checks: Record<string, () => Promise<true | string>> = {
  async S1() {
    const w = await world();
    if (!aBuilt) {
      // without A the server must say so honestly (501), never a 500 or a made-up section
      const h = harness(null);
      const pid = h.store.createProject({ name: 's1-not-built' }).doc.id;
      const r = await search(h, h.owner, pid, 'colours');
      if (r.status !== 501 || r.body?.error?.code !== 'footage_search_not_built') return `without builder A the search answers ${r.status} ${r.body?.error?.code}, not 501 footage_search_not_built`;
      return WAIT_A;
    }
    return guard(async () => {
      const h = harness(null);
      const pid = h.store.createProject({ name: 's1' }).doc.id;
      h.importVideo(pid, w.fx.colours, 'colours.mp4');
      const r = await search(h, h.owner, pid, 'colours');
      evidence.S1 = { status: r.status, pictureState: r.body?.pictureState, setup: r.body?.setup?.code, exact: r.body?.exact?.length };
      if (r.status !== 200) return `status ${r.status}: ${r.text.slice(0, 200)}`;
      if (r.body.pictureState !== 'not_installed' || !r.body.setup?.code || r.body.picture.length) return `picture part not honest: ${JSON.stringify({ s: r.body.pictureState, p: r.body.picture.length })}`;
      if (!r.body.exact.length) return 'the exact section found nothing for the file name';
      return true;
    });
  },
  async S4() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const h = harness();
      const pid = h.store.createProject({ name: 's4' }).doc.id;
      const v = h.importVideo(pid, w.fx.colours, 'colours.mp4');
      const alef = h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_person', args: { name: 'אלף' } }] }).results[0]!.output!.personId as string;
      h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_person', args: { name: 'Gimel' } }] });
      h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_source_range', args: { assetId: v.assetId, label: 'תוויתסוד', people: [alef] } }] });
      const ownerFinds = (await search(h, h.owner, pid, 'תוויתסוד')).body.exact.length > 0 && (await search(h, h.owner, pid, 'אלף')).body.exact.length > 0;
      if (!ownerFinds) return 'the owner does not find the pearl by its name and tagged person';
      const full = h.bearer(h.gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token);
      for (const [name, who] of [['agent', h.agent], ['people-full grant', full], ['observer', h.observer]] as const)
        for (const q of ['תוויתסוד', 'אלף', 'colours', 'זקכשאילתה']) {
          const r = await search(h, who, pid, q);
          if (r.status !== 200) return `${name}: ${r.status}`;
          if (Object.keys(r.body).sort().join() !== 'exact,heuristic,note,picture,pictureState' || r.body.pictureState !== 'owner_only' || r.body.picture.length) return `${name}: answer shape ${Object.keys(r.body)}`;
          for (const m of r.body.exact) if (Object.keys(m).sort().join() !== 'assetId,end,sources,start' || m.sources.some((s: string) => !['name', 'date', 'event', 'transcript'].includes(s))) return `${name}: moment ${JSON.stringify(m)}`;
          if (/תוויתסוד|אלף|זקכשאילתה/.test(r.text)) return `${name}: the label, the person or the query is in the answer`;
          if (q !== 'colours' && r.body.exact.length) return `${name} found something for «${q === 'זקכשאילתה' ? 'the planted query' : q}»`;
        }
      const restricted = h.bearer(h.gov.createGrant({ name: 'r', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token);
      const ref = await search(h, restricted, pid, 'זקכשאילתה תוויתסוד');
      if (/תוויתסוד|זקכשאילתה/.test(ref.text)) return 'a refusal holds the label or the query';
      evidence.S4 = { agents: 3, queries: 4 };
      return true;
    });
  },
  async S5() {
    const w = await world();
    const h = harness();
    const a = h.store.createProject({ name: 's5a' }).doc.id, b = h.store.createProject({ name: 's5b' }).doc.id;
    h.importVideo(b, w.fx.colours2, 'colours2.mp4');
    const restricted = h.bearer(h.gov.createGrant({ name: 'range', mode: 'edit', range: { start: { value: '0', timescale: 1 }, end: { value: '1', timescale: 1 } } }, OWNER).token);
    const rr = await search(h, restricted, b, 'colours2');
    if (rr.status !== 403 || rr.body.error.code !== 'out_of_scope') return `range grant: ${rr.status} ${rr.body?.error?.code}`;
    const onlyA = h.bearer(h.gov.createGrant({ name: 'onlyA', mode: 'edit', projectIds: [a] }, OWNER).token);
    const ab = await search(h, onlyA, b, 'colours2');
    if (ab.status !== 403 || ab.text.includes('colours2')) return `grant for A searching B: ${ab.status}`;
    const full = h.bearer(h.gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token);
    for (const who of [h.agent, h.observer, full]) // (onlyA is refused by the project rule first: 403 out_of_scope, checked above)
      for (const [m, p] of [['GET', `/api/v1/projects/${b}/search/index`], ['POST', `/api/v1/projects/${b}/search/index`], ['DELETE', `/api/v1/projects/${b}/search/index`], ['DELETE', '/api/v1/search/index']] as const) {
        const r = await h.rest(who, m, p, m === 'POST' ? {} : undefined);
        if (r.status !== 403 || r.body.error.code !== 'owner_required') return `${m} ${p}: ${r.status} ${r.body?.error?.code}`;
      }
    const tools: { name: string }[] = (await h.rpc(h.owner, 'tools/list', {})).result.tools;
    const searchy = tools.map((t) => t.name).filter((n) => /footage|search_index|scan|similar|like_this/.test(n));
    if (searchy.join() !== 'find_in_footage') return `MCP search tools: ${searchy}`;
    evidence.S5 = { ownerRoutesRefused: 12, mcpSearchTools: searchy };
    return true;
  },
  async S6() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const e = recording();
      const h = harness(e);
      const pid = h.store.createProject({ name: 's6' }).doc.id;
      const files = [w.fx.colours, w.fx.colours2, w.fx.vid].map((v) => ({ v, ...h.importVideo(pid, v, path.basename(v.file)) }));
      const order = files.slice().sort((x, y) => (x.assetId < y.assetId ? -1 : 1));
      const job = await scan(h, pid);
      if (job.type !== SEARCH_INDEX_JOB_TYPE || job.status !== 'succeeded') return `job ${job.type} ${job.status} ${JSON.stringify(job.error)}`;
      const ix = h.runtime.index()!;
      const expected: number[] = [];
      for (const f of order) {
        const t = targets(f.v);
        expected.push(...t);
        const stored = ix.framesOf(f.contentHash, FOOTAGE_EMBEDDERS.testDouble);
        if (stored.join() !== t.join()) return `${path.basename(f.v.file)}: stored frames ${stored} ≠ targets ${t}`;
      }
      if (e.barcodes.join() !== expected.join()) return `barcodes read from the decoded frames ${e.barcodes} ≠ targets ${expected}`;
      evidence.S6 = { files: order.map((f) => ({ file: path.basename(f.v.file), samples: targets(f.v).length })), barcodesRead: e.barcodes.length, job: { status: job.status, progress: job.output.progress } };
      return true;
    });
  },
  async S7() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const h = harness();
      const pid = h.store.createProject({ name: 's7' }).doc.id;
      const fs7 = [w.fx.colours, w.fx.long, w.fx.colours2].map((v) => ({ v, ...h.importVideo(pid, v, path.basename(v.file)) }));
      await h.runtime.stop(); // the harness's own runtime steps aside: the two below play the server before and after a restart
      const e1 = recording(300);
      const r1 = h.newRuntime({ embedder: e1 });
      const { jobId } = await r1.startScan(OWNER, pid, { assetIds: fs7.map((f) => f.assetId) });
      await until(() => !!r1.index()?.hasFile(fs7[0]!.contentHash, FOOTAGE_EMBEDDERS.testDouble), 60_000, 'the first file');
      await r1.stop();
      const mid = SearchIndexDb.open(h.dir);
      const partial = fs7.filter((f) => { const n = mid.sampleCount(f.contentHash); return n !== 0 && n !== targets(f.v).length; }).map((f) => path.basename(f.v.file));
      mid.close();
      if (partial.length) return `partial rows after the stop: ${partial}`;
      if (h.store.getJob(jobId).status !== 'running') return `after the stop the row is ${h.store.getJob(jobId).status}, not running`;
      // the restart: a new store connection and runtime on the same data directory
      const store2 = new Store(h.dir);
      const e2 = recording();
      const r2 = createSearchRuntime({ cfg: h.cfg, store: store2, lane: new FifoComputeLane(), core, embedder: e2 });
      try {
        if (r2.recover() !== 1) return 'recover did not resume one scan';
        await r2.scans.settled(jobId);
        const job = store2.getJob(jobId);
        if (job.status !== 'succeeded') return `resumed job ${job.status} ${JSON.stringify(job.error)}`;
        const rest = [...targets(fs7[1]!.v), ...targets(fs7[2]!.v)];
        if (e2.barcodes.join() !== rest.join()) return `after the restart the frames embedded were ${e2.barcodes.length}, expected exactly the ${rest.length} of the two unfinished files (the complete file not again)`;
        for (const f of fs7) if (r2.index()!.framesOf(f.contentHash, FOOTAGE_EMBEDDERS.testDouble).join() !== targets(f.v).join()) return `${path.basename(f.v.file)}: totals differ from a whole scan`;
        evidence.S7 = { framesBeforeStop: e1.barcodes.length, framesAfterRestart: e2.barcodes.length, files: job.output.files };
        return true;
      } finally { await r2.stop(); store2.close(); }
    });
  },
  async S8() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const e = recording(400);
      const h = harness(e);
      const pid = h.store.createProject({ name: 's8' }).doc.id;
      const v = h.importVideo(pid, w.fx.long, 'long.mp4');
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
      await until(() => e.starts.length >= 1, 60_000, 'the first batch');
      const c = await h.rest(h.owner, 'POST', `/api/v1/jobs/${r.body.jobId}/cancel`, {});
      const at = e.starts.length;
      await h.runtime.scans.settled(r.body.jobId);
      const status = h.store.getJob(r.body.jobId).status;
      if (c.status !== 200 || status !== 'canceled') return `cancel ${c.status}, job ${status}`;
      if (e.starts.length > at) return 'a batch started after the cancel';
      if ((h.runtime.index()?.sampleCount(v.contentHash) ?? 0) !== 0) return 'the unfinished file has rows';
      // an export started during the scan: the next batch waits for its end (the lane's export flag, as export.ts sets it)
      const r2 = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
      await until(() => e.starts.length > at, 60_000, 'a batch of the second scan');
      h.lane.setExportActive(true);
      const exportStart = Date.now();
      await new Promise((res) => setTimeout(res, 1500));
      const exportEnd = Date.now();
      h.lane.setExportActive(false);
      await h.runtime.scans.settled(r2.body.jobId);
      const job = h.store.getJob(r2.body.jobId);
      const during = e.starts.filter((t) => t > exportStart + 50 && t < exportEnd);
      if (job.status !== 'succeeded') return `second scan ${job.status}`;
      if (during.length) return `${during.length} batch(es) started while the export ran`;
      evidence.S8 = { canceledAfterBatches: at, exportMs: exportEnd - exportStart, batchesAfterExport: e.starts.filter((t) => t >= exportEnd).length };
      return true;
    });
  },
  async S11() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const e = recording();
      const h = harness(e);
      const pid = h.store.createProject({ name: 's11' }).doc.id;
      const v = h.importVideo(pid, w.fx.colours, 'colours.mp4');
      await scan(h, pid);
      const planted = sig(h, v.contentHash);
      if (!indexBytes(h).includes(planted)) return 'the planted bytes are not found in the index before removal (check is blind)';
      h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: v.assetId } }] });
      if (h.runtime.index()!.sampleCount(v.contentHash) || indexBytes(h).includes(planted)) return 'remove_asset left rows or bytes';
      h.store.undo(pid, 'user:local', 'undo');
      const st = await h.rest(h.owner, 'GET', `/api/v1/projects/${pid}/search/index`);
      if (st.body.files.scanned !== 0 || st.body.files.of !== 1) return `after undo: ${JSON.stringify(st.body.files)} (expected not scanned)`;
      // project delete
      const p2 = h.store.createProject({ name: 's11 delete' }).doc.id;
      const v2 = h.importVideo(p2, w.fx.colours2, 'colours2.mp4');
      await scan(h, p2);
      const s2 = sig(h, v2.contentHash);
      deleteProject(h.store, OWNER, p2, 's11 delete');
      if (h.runtime.index()!.sampleCount(v2.contentHash) || indexBytes(h).includes(s2)) return 'project delete left rows or bytes';
      // storage clean-up: a stored file no project or history mentions, with rows left behind
      const p3 = h.store.createProject({ name: 's11 gc' }).doc.id;
      const v3 = h.importVideo(p3, w.fx.vid, 'VID_20241226_183000.mp4');
      await scan(h, p3);
      const rows = h.runtime.index()!.vectors([v3.contentHash], FOOTAGE_EMBEDDERS.testDouble).map((s) => ({ frame: s.frame, scale: s.scale, q: s.q.slice() }));
      deleteProject(h.store, OWNER, p3, 's11 gc');
      const other = SearchIndexDb.open(h.dir);
      other.replaceFile({ contentHash: v3.contentHash, embedder: FOOTAGE_EMBEDDERS.testDouble, source: 'original', frameCount: w.fx.vid.frames, rate: { num: 10, den: 1 } }, rows, () => true);
      other.close();
      collectGarbage(h.store, OWNER, true, Date.now() + 3600_000);
      if (h.runtime.index()!.sampleCount(v3.contentHash)) return 'storage clean-up left rows';
      // a removal during that file's scan
      const p4 = h.store.createProject({ name: 's11 race' }).doc.id;
      const v4 = h.importVideo(p4, w.fx.long, 'long.mp4');
      e.options.delayMs = 400;
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${p4}/search/index`, {});
      const n0 = e.starts.length;
      await until(() => e.starts.length > n0, 60_000, 'the first batch');
      h.store.commit({ projectId: p4, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: v4.assetId } }] });
      await h.runtime.scans.settled(r.body.jobId);
      e.options.delayMs = 0;
      if (h.runtime.index()!.sampleCount(v4.contentHash)) return 'a removal during the scan left rows';
      evidence.S11 = { removeAsset: 'rows and bytes gone', undo: st.body.files, projectDelete: 'gone', storageCleanUp: 'gone', removalDuringScan: h.store.getJob(r.body.jobId).output?.files?.skipped };
      return true;
    });
  },
  async S12() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const h = harness();
      const pid = h.store.createProject({ name: 's12' }).doc.id;
      const v = h.importVideo(pid, w.fx.colours, 'colours.mp4');
      await scan(h, pid);
      const planted = sig(h, v.contentHash);
      const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-proof-bk-'));
      try {
        await backupDataDir(h.dir, dest);
        if (fs.existsSync(path.join(dest, 'search'))) return 'the backup holds a search/ folder';
        const hit = walk(dest).find((f) => fs.readFileSync(f).includes(planted));
        if (hit) return `index bytes in the backup: ${path.relative(dest, hit)}`;
      } finally { fs.rmSync(dest, { recursive: true, force: true }); }
      const chunks: Buffer[] = [];
      for await (const c of writeArchive(planArchive(h.store, pid))) chunks.push(c);
      const tar = Buffer.concat(chunks);
      if (tar.includes(planted) || tar.includes(Buffer.from('index.sqlite'))) return 'the project archive holds index bytes';
      evidence.S12 = { backup: 'no search/ and no index bytes', archiveBytes: tar.length };
      return true;
    });
  },
  async S13() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const h = harness();
      const pid = h.store.createProject({ name: 's13' }).doc.id;
      h.importVideo(pid, w.fx.colours, 'colours.mp4');
      const Q = 'zqxplantedfootagequery', QHE = 'שאילתהמסומנתזקכ';
      const before = logs.length;
      await scan(h, pid);
      const restricted = h.bearer(h.gov.createGrant({ name: 'r', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token);
      const answers = [await search(h, h.owner, pid, `${Q} כחול`), await search(h, h.agent, pid, `${QHE} ${Q}`), await search(h, restricted, pid, Q), await search(h, h.owner, pid, `${Q} `.repeat(30)), await search(h, h.owner, pid, Q, { image: Q })];
      await h.rpc(h.agent, 'tools/call', { name: 'find_in_footage', arguments: { projectId: pid, query: QHE } });
      if (answers.some((a) => a.text.includes(Q) || a.text.includes(QHE))) return 'an answer or refusal echoes the query';
      const inLogs = logs.slice(before).filter((l) => l.includes(Q) || l.includes(QHE));
      if (inLogs.length) return `${inLogs.length} log line(s) hold the query`;
      const files = walk(h.dir);
      const hit = files.find((f) => { const b = fs.readFileSync(f); return b.includes(Buffer.from(Q)) || b.includes(Buffer.from(QHE)); });
      if (hit) return `the query is in ${path.relative(h.dir, hit)}`;
      evidence.S13 = { filesSearched: files.length, logLinesSearched: logs.length - before };
      return true;
    });
  },
  async S14() {
    await world();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-proof-setup-'));
    const store = new Store(path.join(dir, 'data'));
    const reviewed = SEARCH_WORKER_SHA256;
    const digestOfThisCheckout = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(SEARCH_WORKER)).digest('hex');
    const fake = path.join(ROOT, 'apps/server/src/search/testdata/fake_pf_search.py');
    const rt = (o: { python?: string | null; modelDir?: string | null; worker?: string; sha?: string | null }) => createSearchRuntime({
      cfg: { ...loadConfig({}), dataDir: store.dataDir, toolsPython: o.python ?? null, searchModelDir: o.modelDir ?? null, libraryDir: null }, store, lane: new FifoComputeLane(), core,
      ...(o.worker ? { worker: o.worker, workerSha256: o.sha ?? null } : {}),
    });
    const states: Record<string, unknown> = {};
    try {
      // the reviewed worker as shipped: engine_unverified until integration sets SEARCH_WORKER_SHA256
      const shipped = await rt({}).setup();
      states.shipped = shipped.code;
      if (!reviewed && shipped.code !== 'engine_unverified') return `without a reviewed digest the state is ${shipped.code}, not engine_unverified`;
      if (reviewed && reviewed !== digestOfThisCheckout) return `the shipped pf_search.py (${digestOfThisCheckout.slice(0, 12)}…) is not the reviewed file (${reviewed.slice(0, 12)}…)`;
      if (reviewed && shipped.code !== 'engine_not_configured') return `the reviewed worker as shipped with no Python configured → ${shipped.code}, not engine_not_configured`;
      const sha = reviewed ?? digestOfThisCheckout;
      const real = (o: { python?: string | null; modelDir?: string | null }) => rt({ ...o, worker: SEARCH_WORKER, sha });
      const unset = await real({}).setup();
      states.unset = unset.code;
      if (unset.code !== 'engine_not_configured') return `PF_TOOLS_PYTHON unset → ${unset.code}`;
      const prev = process.env.PF_FAKE_SEARCH_MODE;
      process.env.PF_FAKE_SEARCH_MODE = 'probe-missing';
      const noTransformers = await rt({ python: 'python3', worker: fake, sha: (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(fake)).digest('hex') }).setup();
      if (prev === undefined) delete process.env.PF_FAKE_SEARCH_MODE; else process.env.PF_FAKE_SEARCH_MODE = prev;
      states.noTransformers = noTransformers;
      if (noTransformers.code !== 'engine_not_working' || !noTransformers.detail.includes('transformers')) return `Python without transformers (labelled fake probe) → ${JSON.stringify(noTransformers)}`;
      const noTorch = await real({ python: 'python3' }).setup();
      states.thisMachinesPython = noTorch;
      if (noTorch.code === 'ready') return 'ready without the verified model';
      if (noTorch.code === 'engine_not_working') {
        if (!/cannot import/.test(noTorch.detail)) return `engine_not_working without naming the module: ${noTorch.detail}`;
        // the model checks below need a Python that passes the probe: the labelled fake (it has no model either)
      }
      const fakeSha = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(fake)).digest('hex');
      const absent = await rt({ python: 'python3', worker: fake, sha: fakeSha, modelDir: path.join(dir, 'nomodel') }).setup();
      states.absent = absent;
      if (absent.code !== 'model_missing' || absent.missingBytes !== SEARCH_PICTURE.totalBytes || SEARCH_PICTURE.totalBytes !== 1_539_637_736) return `model absent → ${JSON.stringify(absent)}`;
      const m = path.join(dir, 'model');
      fs.mkdirSync(m);
      for (const pin of SEARCH_PICTURE.pins) {
        const f = path.join(m, pin.path);
        if (pin.path === 'model.safetensors') { fs.writeFileSync(f, ''); fs.truncateSync(f, pin.bytes); } // sparse: exact size, other bytes
        else fs.writeFileSync(f, Buffer.alloc(pin.bytes, 1));
      }
      const changed = await rt({ python: 'python3', worker: fake, sha: fakeSha, modelDir: m }).setup();
      states.changedBytes = changed;
      if (changed.code !== 'model_missing') return `every pin at its size with other bytes → ${changed.code}`;
      evidence.S14 = { ...states, reviewedDigest: reviewed, note: reviewed ? 'reviewed digest set and equal to the shipped pf_search.py; the model states used the labelled fake worker, whose probe passes (no torch here)' : 'SEARCH_WORKER_SHA256 not set: the digest of this checkout\'s pf_search.py stood in for the later states' };
      return true;
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  },
  async S15() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const e = recording(250);
      const h = harness(e);
      const labels: string[] = [];
      h.lane.onBeforeHeavy((l) => { labels.push(l); });
      const pid = h.store.createProject({ name: 's15' }).doc.id;
      const v = h.importVideo(pid, w.fx.long, 'long.mp4');
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
      await until(() => e.starts.length >= 1, 60_000, 'the first batch');
      // a local tool job takes the lane between batches and completes
      const t0 = Date.now();
      const rel = await h.lane.acquire('local.translate he-en');
      await new Promise((res) => setTimeout(res, 100));
      rel();
      const toolMs = Date.now() - t0;
      const q = await search(h, h.owner, pid, 'אדום');
      if (q.status !== 200) return `a query during the scan: ${q.status}`;
      await h.runtime.scans.settled(r.body.jobId);
      const job = h.store.getJob(r.body.jobId);
      if (job.status !== 'succeeded') return `scan ${job.status}`;
      if (h.runtime.index()!.framesOf(v.contentHash, FOOTAGE_EMBEDDERS.testDouble).join() !== targets(w.fx.long).join()) return 'scan totals changed';
      const foreign = labels.filter((l) => l !== 'local.translate he-en' && !l.startsWith(SEARCH_LANE_PREFIX));
      if (foreign.length) return `the scan held the lane under ${foreign}`;
      evidence.S15 = { scanLabels: [...new Set(labels.filter((l) => l.startsWith(SEARCH_LANE_PREFIX)))], toolMs, queryDuringScan: q.body.pictureState };
      return true;
    });
  },
  async S16() {
    const w = await world();
    if (!aBuilt) return WAIT_A;
    return guard(async () => {
      const e = createTestEmbedder();
      const h = harness(e);
      const pid = h.store.createProject({ name: 's16' }).doc.id;
      const v = h.importVideo(pid, w.fx.colours2, 'colours2.mp4');
      for (const kind of ['wrongLength', 'nan', 'notUnit'] as const) {
        e.options.fault = { on: 'images', kind };
        const job = await scan(h, pid);
        if (job.status !== 'failed' || job.error?.code !== 'search_engine_failed') return `images ${kind}: job ${job.status} ${job.error?.code}`;
        if (h.runtime.index()?.sampleCount(v.contentHash)) return `images ${kind}: rows written`;
      }
      e.options.fault = null;
      await scan(h, pid);
      for (const kind of ['wrongLength', 'nan', 'notUnit'] as const) {
        e.options.fault = { on: 'text', kind };
        const r = await search(h, h.owner, pid, 'אדום');
        if (r.status !== 502 || r.body.error?.code !== 'search_engine_failed' || r.body.picture) return `text ${kind}: ${r.status}`;
      }
      e.options.fault = null;
      evidence.S16 = { faults: 6, all: 'refused, nothing shown' };
      return true;
    });
  },
};

export const FOOTAGE_PROOF_SERVER = { built: true, checks, evidence } as const;

/** Closes every store and runtime and removes the temp folders (the runner calls it; the stand-alone run does). */
export async function closeFootageProofServer(): Promise<void> {
  for (const h of harnesses.splice(0)) { try { await h.close(); } catch { /* already closed */ } }
  release();
  if (worldP) { const w = await worldP; fs.rmSync(w.base, { recursive: true, force: true }); }
  try {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'footage-search-proof.server.json'), JSON.stringify({ when: new Date().toISOString(), aBuilt, evidence }, null, 1) + '\n');
  } catch { /* evidence is best effort */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0, blocked = 0;
  const lines: string[] = [];
  try {
    for (const [n, check] of Object.entries(checks)) {
      const t0 = Date.now();
      let r: true | string;
      try { r = await check(); } catch (e) { r = `threw: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; }
      const b = r !== true && r.startsWith('BLOCKED');
      lines.push(`${r === true ? 'PASS' : b ? 'BLOCKED' : 'FAIL'} ${n} (server, ${Math.round((Date.now() - t0) / 100) / 10} s)${r === true ? '' : `: ${r}`}`);
      consoleWas.log!(lines.at(-1));
      if (r !== true) { if (b) blocked++; else failed++; }
    }
  } finally { await closeFootageProofServer(); }
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
