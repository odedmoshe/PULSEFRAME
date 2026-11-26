/**
 * pnpm proof:search, part integration (wave 7 integration): the two halves only the merged tree can run.
 *
 * S3 (server half): footageProofDoc() is put into a real Store (importProject) behind the real app with the real picture runtime
 *   (search/testdata/harness.ts, requests through app.fetch), and each of the 40 baseline queries is asked through POST …/search as the
 *   owner; the `exact` section's JSON must be byte-identical to core searchFootage in Node (footageBaselineJson), which the UI part
 *   compares with window.__pfFootageSearch in Chromium. So the server, Node and Chromium give the same bytes.
 * S9 (server half): a real scan of colours.mp4 (red, blue, green, yellow, 3 s each) and a red file with the labelled test double, then
 *   «כחול» as the owner's picture query through the route: colours.mp4 first with exactly [2 s, 6 s], the red file not shown.
 * S8 (real export): a real server (startServer, the web bundle, the headless Chromium renderer and FFmpeg) with the LABELLED
 *   TEST-DOUBLE-embedder/1 (slowed per batch so the scan is still running when the export starts); the owner starts a scan of a 160 s
 *   video (5 batches) and, once its first batch has started, a real server export of a 1 s timeline. The export's running window is
 *   read from the job events (status running → succeeded, emitted synchronously beside the lane's export flag in export.ts); no batch
 *   may start inside it, the scan must have batches before and after it, and both jobs must succeed.
 * SYNTHETIC fixtures only (ffmpeg colour videos); a folder in the temp directory, removed at the end.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOTAGE_EMBEDDERS, sampleFrameTargets } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { createTestEmbedder } from '../../../apps/server/src/search/testEmbedder.ts';
import { createHarness, makeColourVideo } from '../../../apps/server/src/search/testdata/harness.ts';
import { FOOTAGE_BASELINE_QUERIES, footageBaselineDigest, footageBaselineJson, footageProofDoc, type FootageProofPart } from './footage-search-proof.core.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WEB = path.join(ROOT, 'apps/web/dist');
const evidence: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const temps: string[] = [];

const checks: Record<string, () => Promise<true | string>> = {
  /** S3, server half: the owner's exact section through the real route equals core in Node, byte for byte, for the 40 baseline queries. */
  async S3() {
    const h = createHarness({ embedder: null });
    try {
      const pid = h.store.importProject(footageProofDoc()).doc.id;
      const node = footageBaselineJson();
      const server: string[] = [];
      for (const q of FOOTAGE_BASELINE_QUERIES) {
        const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search`, { query: q });
        if (r.status !== 200) return `«${q}»: the route answered ${r.status} ${r.text.slice(0, 200)}`;
        server.push(JSON.stringify(r.body.exact));
      }
      const different = server.map((j, i) => (j === node[i] ? -1 : i)).filter((i) => i >= 0);
      evidence.S3 = { side: 'server (owner, POST …/search through the real app)', queries: server.length, nodeDigest: footageBaselineDigest(node), serverDigest: footageBaselineDigest(server), different: different.map((i) => FOOTAGE_BASELINE_QUERIES[i]) };
      if (different.length) return `${different.length} of ${node.length} queries differ between the server and Node; first: «${FOOTAGE_BASELINE_QUERIES[different[0]!]}»\nNode:   ${node[different[0]!]!.slice(0, 300)}\nServer: ${server[different[0]!]!.slice(0, 300)}`;
      return true;
    } finally { await h.close(); }
  },

  /** S9, through the server: a real scan with the labelled test double, then «כחול» as the owner's picture query. */
  async S9() {
    const h = createHarness();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-s9x-'));
    temps.push(base);
    try {
      const colours = makeColourVideo(path.join(base, 'colours.mp4'), ['red', 'blue', 'green', 'yellow'], 3, 10); // blue 3–6 s
      const other = makeColourVideo(path.join(base, 'colours2.mp4'), ['red'], 4, 10);
      const pid = h.store.createProject({ name: 's9', frameRate: { num: 30, den: 1 } }).doc.id;
      const a = h.importVideo(pid, colours, 'colours.mp4');
      h.importVideo(pid, other, 'colours2.mp4');
      const sc = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
      if (sc.status !== 202) return `the scan did not start: ${sc.status} ${sc.text.slice(0, 200)}`;
      await h.runtime.scans.settled(sc.body.jobId);
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search`, { query: 'כחול', picture: true });
      const pic = (r.body?.picture ?? []) as { assetId: string; start: { value: string; timescale: number } | null; end: { value: string; timescale: number } | null; sources: string[] }[];
      evidence.S9 = { side: 'server (real scan, labelled TEST-DOUBLE-embedder/1, POST …/search as the owner)', status: r.status, pictureState: r.body?.pictureState, picture: pic.map((m) => ({ assetId: m.assetId === a.assetId ? 'colours.mp4' : m.assetId, start: m.start, end: m.end, sources: m.sources })) };
      if (r.status !== 200) return `the picture query answered ${r.status}: ${r.text.slice(0, 200)}`;
      const first = pic[0];
      if (!first || first.assetId !== a.assetId) return `«כחול» did not rank colours.mp4 first: ${JSON.stringify(evidence.S9)}`;
      if (!first.start || !first.end || !T.eq(first.start, T.rt(2, 1)) || !T.eq(first.end, T.rt(6, 1))) return `the span of colours.mp4 is not exactly [2 s, 6 s]: ${JSON.stringify(first)}`;
      if (pic.some((m) => m.assetId !== a.assetId)) return `a red-only file was shown for «כחול»: ${JSON.stringify(evidence.S9)}`;
      if (/score|relevance|cos/i.test(r.text)) return 'the answer holds a score';
      return true;
    } finally { await h.close(); }
  },

  /** S8, real export: a server export run during a real scan; no batch starts while it runs. */
  async S8() {
    if (!fs.existsSync(path.join(WEB, 'render.html'))) return 'BLOCKED: the web bundle is missing (`pnpm build`), so no real export can run';
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-s8x-'));
    temps.push(base);
    fs.mkdirSync(path.join(base, 'fx'));
    const long = makeColourVideo(path.join(base, 'fx', 'long.mp4'), ['red', 'blue'], 80, 1); // 160 samples: batches of 32 → 5
    const short = makeColourVideo(path.join(base, 'fx', 'short.mp4'), ['green'], 1, 10);
    // the labelled test double, slowed per batch, recording when each batch starts
    const inner = createTestEmbedder({ delayMs: 1500 });
    const starts: number[] = [];
    const embedder = Object.assign(Object.create(null), inner) as typeof inner;
    embedder.embedImages = (rgb, count, signal) => { starts.push(Date.now()); return inner.embedImages(rgb, count, signal); };
    const s = await startServer({ port: 18600 + Math.floor(Math.random() * 90), dataDir: path.join(base, 'data'), webDist: WEB, speechPython: null, voicePython: null, backupDir: null }, { searchEmbedder: embedder });
    try {
      const origin = s.url;
      const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
      const headers = { origin, cookie, connection: 'close' };
      const call = async (method: string, p: string, body?: unknown) => {
        const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await r.text();
        return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text } as { status: number; body: any };
      };
      const R = { num: 10, den: 1 };
      const pid = (await call('POST', '/projects', { name: 'S8 real export', width: 320, height: 180, frameRate: R })).body.project.id as string;
      const upload = async (file: string) => {
        const r = await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...headers, 'x-filename': path.basename(file) }, body: new Uint8Array(fs.readFileSync(file)) });
        const b = (await r.json()) as { assetId?: string };
        if (!b.assetId) throw new Error(`upload of ${path.basename(file)} failed: ${JSON.stringify(b).slice(0, 300)}`);
        return b.assetId;
      };
      await upload(long.file);
      const shortId = await upload(short.file);
      const placed = await call('POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: shortId, start: T.frameTime(0, R) } }] });
      if (placed.status !== 200) return `the 1 s clip was not placed: ${placed.status} ${JSON.stringify(placed.body).slice(0, 300)}`;
      // the export's running window, from the job events (emitted synchronously where export.ts sets and clears the lane's export flag)
      let exportId = '';
      const win: { running?: number; done?: number; status?: string } = {};
      const onJob = (j: { id: string; status: string }) => {
        if (j.id !== exportId) return;
        if (j.status === 'running' && win.running === undefined) win.running = Date.now();
        if (['succeeded', 'failed', 'canceled'].includes(j.status) && win.done === undefined) { win.done = Date.now(); win.status = j.status; }
      };
      s.store.events.on('job', onJob);
      try {
        const scan = await call('POST', `/projects/${pid}/search/index`, {});
        if (scan.status !== 202) return `the scan did not start: ${scan.status} ${JSON.stringify(scan.body).slice(0, 300)}`;
        for (let t0 = Date.now(); starts.length < 1; await sleep(20)) if (Date.now() - t0 > 120_000) return 'the scan\'s first batch never started';
        const ex = await call('POST', `/projects/${pid}/exports`, {});
        if (ex.status !== 202 || !ex.body?.jobId) return `the export did not start: ${ex.status} ${JSON.stringify(ex.body).slice(0, 300)}`;
        exportId = ex.body.jobId;
        const current = s.store.getJob(exportId);
        if (current.status === 'running' && win.running === undefined) win.running = Date.now(); // already running before the listener knew its id
        for (let t0 = Date.now(); win.done === undefined; await sleep(50)) if (Date.now() - t0 > 600_000) return 'the export did not end within 10 minutes';
        const scanAtExport = starts.filter((t) => t <= (win.running ?? 0)).length;
        for (let t0 = Date.now(); !['succeeded', 'failed', 'canceled'].includes(s.store.getJob(scan.body.jobId).status); await sleep(50)) if (Date.now() - t0 > 300_000) return 'the scan did not end within 5 minutes';
        const scanJob = s.store.getJob(scan.body.jobId);
        const exportJob = s.store.getJob(exportId);
        const during = starts.filter((t) => win.running !== undefined && t > win.running + 50 && t < win.done!);
        const after = starts.filter((t) => t >= win.done!);
        evidence.S8 = {
          route: exportJob.output?.route ?? null, exportSeconds: win.running !== undefined ? (win.done! - win.running) / 1000 : null, exportStatus: exportJob.status, exportBytes: exportJob.output?.bytes ?? null,
          batches: starts.length, batchesBeforeExport: scanAtExport, batchesDuringExport: during.length, batchesAfterExport: after.length, scanStatus: scanJob.status,
          longSamples: sampleFrameTargets({ num: long.fps, den: 1 }, long.frames).length, embedder: FOOTAGE_EMBEDDERS.testDouble,
          note: 'one sample on a shared machine; the export is real (server route, Chromium renderer, FFmpeg), the picture model the labelled test double',
        };
        if (win.running === undefined) return 'the export never reported running';
        if (exportJob.status !== 'succeeded') return `the real export ${exportJob.status}: ${JSON.stringify(exportJob.error).slice(0, 300)}`;
        if (scanJob.status !== 'succeeded') return `the scan ${scanJob.status}: ${JSON.stringify(scanJob.error).slice(0, 300)}`;
        if (scanAtExport < 1) return 'the export started before the scan had a batch (the check would prove nothing)';
        if (!after.length) return `no batch started after the export ended (the scan ended before the export: ${starts.length} batches, export ${((win.done! - win.running) / 1000).toFixed(1)} s); the check proves nothing`;
        if (during.length) return `${during.length} batch(es) started while the real export ran`;
        return true;
      } finally { s.store.events.off('job', onJob); }
    } finally {
      await s.close();
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
};

export const FOOTAGE_PROOF_INTEGRATION: FootageProofPart = { built: true, checks, evidence };

/** Removes what the checks left in the temp directory (each check closes its own server). */
export async function closeFootageProofIntegration(): Promise<void> {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}
