/**
 * Builder B's runtime through the real app and MCP handler (search/runtime.ts, answer.ts, indexJob.ts, indexDb.ts, frames.ts), with the
 * LABELLED TEST-DOUBLE embedder (testEmbedder.ts: proves plumbing, never quality) and tiny synthetic colour videos made by ffmpeg. Builder
 * A's core functions are the real ones once FOOTAGE_SEARCH_BUILT is true, labelled doubles before (testdata/coreDoubles.ts).
 * These cover the it.todo rows of searchContracts.test.ts "builder B" and the four lines the lead reads:
 *   (1) deletion guarantee, (2) vectors and scores never leave, (3) every other credential gets only agentAnswerOf / 403s, query never
 *   echoed or logged, (4) no query by image, no network (workers.test.ts covers the worker side).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FOOTAGE_EMBEDDERS, FOOTAGE_REFUSALS } from '@pulseframe/core';
import { planArchive, writeArchive } from '../archive.ts';
import { backupDataDir } from '../backup.ts';
import { collectGarbage, deleteProject } from '../storage.ts';
import { SEARCH_INDEX_JOB_TYPE, SEARCH_LANE_PREFIX } from './contract.ts';
import { SearchIndexDb } from './indexDb.ts';
import { createTestEmbedder } from './testEmbedder.ts';
import { CORE_LABEL, testCore } from './testdata/coreDoubles.ts';
import { createHarness, makeColourVideo, OWNER, until, type Harness } from './testdata/harness.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
let fx: string;
let colours: ReturnType<typeof makeColourVideo>, long: ReturnType<typeof makeColourVideo>, blue: ReturnType<typeof makeColourVideo>;
const core = testCore();
const targets = (v: { frames: number; fps: number }) => core.sampleFrameTargets({ num: v.fps, den: 1 }, v.frames);
const logs: string[] = [];
const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
const orig = Object.fromEntries(methods.map((m) => [m, console[m]]));

beforeAll(() => {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-searchB-fx-'));
  colours = makeColourVideo(path.join(fx, 'colours.mp4'), ['red', 'blue', 'green', 'yellow'], 2, 5); // 40 frames, 8 samples, one batch
  long = makeColourVideo(path.join(fx, 'long.mp4'), ['red', 'blue'], 20, 1); // 40 frames at 1 fps, 40 samples, two batches (32 + 8)
  blue = makeColourVideo(path.join(fx, 'blue-sky.mp4'), ['blue'], 3, 5); // 15 frames, 3 samples
  for (const m of methods) console[m] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
});
afterAll(() => {
  for (const m of methods) console[m] = orig[m]!;
  fs.rmSync(fx, { recursive: true, force: true });
});

/** A scan through the route; resolves with the finished job row. */
async function scan(h: Harness, pid: string, body: unknown = {}) {
  const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, body);
  expect({ status: r.status, body: r.body }).toMatchObject({ status: 202 });
  await h.runtime.scans.settled(r.body.jobId);
  return h.store.getJob(r.body.jobId);
}
const search = (h: Harness, who: Harness['owner'], pid: string, query: string, extra: Record<string, unknown> = {}) => h.rest(who, 'POST', `/api/v1/projects/${pid}/search`, { query, ...extra });

/** Anything that looks like a vector or a score, anywhere in a JSON value. */
function vectorish(v: unknown, at = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) {
    if (v.length >= 16 && v.every((x) => typeof x === 'number')) out.push(`${at}: numeric array of ${v.length}`);
    v.forEach((x, i) => out.push(...vectorish(x, `${at}[${i}]`)));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (/score|relevance|vector|embedding|cosine|^cos$|logit|similar|distance|^q$|int8/i.test(k)) out.push(`${at}.${k}`);
      out.push(...vectorish(x, `${at}.${k}`));
    }
  } else if (typeof v === 'string' && v.length > 200 && /^[A-Za-z0-9+/=]+$/.test(v)) out.push(`${at}: base64-like string`);
  return out;
}

describe(`S1: no picture runtime (${CORE_LABEL})`, () => {
  let h: Harness;
  beforeAll(() => { h = createHarness({ embedder: null }); });
  afterAll(() => h.close());
  it('a query returns the exact section and pictureState not_installed with its setup code; no picture row; scanning is 409 picture_search_not_ready', async () => {
    const pid = h.store.createProject({ name: 's1' }).doc.id;
    const { assetId } = h.importVideo(pid, colours, 'colours.mp4');
    const r = await search(h, h.owner, pid, 'colours');
    expect(r.status).toBe(200);
    expect(r.body.exact.map((m: any) => m.assetId)).toEqual([assetId]);
    expect(r.body.picture).toEqual([]);
    expect(r.body.pictureState).toBe('not_installed');
    expect(r.body.setup.code).toMatch(/^(engine_unverified|engine_not_configured)$/); // engine_unverified until SEARCH_WORKER_SHA256 is set at integration
    const s = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
    expect({ status: s.status, code: s.body.error.code }).toEqual({ status: 409, code: 'picture_search_not_ready' });
    expect(s.body.error.message).toBe(FOOTAGE_REFUSALS.notReady.message(r.body.setup.code));
    expect(fs.existsSync(path.join(h.dir, 'search'))).toBe(false);
  });
});

describe(`the scan, the query and the agent answer (TEST-DOUBLE embedder; ${CORE_LABEL})`, () => {
  let h: Harness, pid: string;
  let ids: { colours: { assetId: string; contentHash: string }; blue: { assetId: string; contentHash: string } };
  beforeAll(() => {
    h = createHarness();
    pid = h.store.createProject({ name: 'main' }).doc.id;
    ids = { colours: h.importVideo(pid, colours, 'colours.mp4'), blue: h.importVideo(pid, blue, 'blue-sky.mp4') };
    const person = h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_person', args: { name: 'אלף' } }] }).results[0]!.output!.personId as string;
    h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_source_range', args: { assetId: ids.colours.assetId, label: 'תוויתסוד', people: [person] } }] });
  });
  afterAll(() => h.close());

  it('a scan of type search-index ends succeeded as a durable job; per file the stored frames equal sampleFrameTargets', async () => {
    const job = await scan(h, pid);
    expect(job.type).toBe(SEARCH_INDEX_JOB_TYPE);
    expect({ status: job.status, error: job.error }).toEqual({ status: 'succeeded', error: null });
    expect(job.input).toEqual({ assetIds: [ids.colours.assetId, ids.blue.assetId].sort(), embedderId: FOOTAGE_EMBEDDERS.testDouble });
    expect(job.output.progress).toEqual({ unit: 'frames', done: 11, total: 11 });
    expect(job.output.files).toEqual({ scanned: 2, alreadyScanned: 0, skipped: { removed: 0, decode_failed: 0, no_picture: 0 } });
    const ix = h.runtime.index()!;
    expect(ix.framesOf(ids.colours.contentHash, FOOTAGE_EMBEDDERS.testDouble)).toEqual(targets(colours));
    expect(ix.framesOf(ids.blue.contentHash, FOOTAGE_EMBEDDERS.testDouble)).toEqual(targets(blue));
    const st = await h.rest(h.owner, 'GET', `/api/v1/projects/${pid}/search/index`);
    expect(st.body).toMatchObject({ setup: { code: 'ready' }, embedder: FOOTAGE_EMBEDDERS.testDouble, files: { scanned: 2, stale: 0, of: 2 }, job: null });
    expect(st.body.bytes).toBeGreaterThan(0);
    expect((await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {})).body.error.code).toBe('nothing_to_scan');
  });
  it('the owner\'s query: picture rows carry embedder TEST-DOUBLE-embedder/1, sources [picture], and no score field', async () => {
    const r = await search(h, h.owner, pid, 'כחול');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pictureState: 'ready', embedder: FOOTAGE_EMBEDDERS.testDouble, scanned: { files: 2, of: 2 }, heuristic: true });
    expect(r.body.picture.length).toBeGreaterThan(0);
    expect(new Set(r.body.picture.map((m: any) => m.assetId))).toEqual(new Set([ids.colours.assetId, ids.blue.assetId]));
    for (const m of r.body.picture) { expect(m.sources).toEqual(['picture']); expect(Object.keys(m).sort()).toEqual(['assetId', 'end', 'frame', 'sources', 'start']); }
    expect(vectorish(r.body)).toEqual([]);
    // a word in no colour table matches nothing: an honest empty picture section
    expect((await search(h, h.owner, pid, 'zebra')).body.picture).toEqual([]);
    // picture false: the exact part only, no text embedded
    const before = h.embedder.calls.text;
    expect((await search(h, h.owner, pid, 'כחול', { picture: false })).body.picture).toEqual([]);
    expect(h.embedder.calls.text).toBe(before);
  });
  it('no query by image: the query takes text only (extra fields such as an image, a frame or an asset are refused 400)', async () => {
    for (const extra of [{ image: 'data:image/png;base64,AAAA' }, { frame: 3 }, { assetId: ids.colours.assetId }, { moment: { assetId: ids.colours.assetId } }, { vector: [0.1] }]) {
      const r = await search(h, h.owner, pid, 'כחול', extra);
      expect({ extra, status: r.status }).toEqual({ extra, status: 400 });
    }
  });
  it('agents (agent token, a people-full grant, the observer, MCP): only agentAnswerOf of the reader document; a pearl label and a tagged person never match and never appear', async () => {
    const owner = await search(h, h.owner, pid, 'תוויתסוד');
    expect(owner.body.exact.map((m: any) => m.sources)).toContainEqual(['pearl']);
    expect((await search(h, h.owner, pid, 'אלף')).body.exact.map((m: any) => m.sources)).toContainEqual(['person']);
    const full = h.bearer(h.gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token);
    for (const who of [h.agent, full, h.observer]) {
      for (const q of ['תוויתסוד', 'אלף', 'colours', 'כחול']) {
        const r = await search(h, who, pid, q);
        expect(r.status).toBe(200);
        expect(Object.keys(r.body).sort()).toEqual(['exact', 'heuristic', 'note', 'picture', 'pictureState']);
        expect(r.body.pictureState).toBe('owner_only');
        expect(r.body.picture).toEqual([]);
        for (const m of r.body.exact) {
          expect(Object.keys(m).sort()).toEqual(['assetId', 'end', 'sources', 'start']);
          for (const s of m.sources) expect(['name', 'date', 'event', 'transcript']).toContain(s);
        }
        expect(r.text).not.toContain('תוויתסוד');
        expect(r.text).not.toContain('אלף');
        if (q === 'colours') expect(r.body.exact.map((m: any) => m.assetId)).toEqual([ids.colours.assetId]);
        else expect(r.body.exact).toEqual([]);
      }
    }
    const m = await h.rpc(full, 'tools/call', { name: 'find_in_footage', arguments: { projectId: pid, query: 'תוויתסוד' } });
    expect(JSON.stringify(m)).not.toContain('תוויתסוד');
    const mo = JSON.parse(m.result.content[0].text);
    expect(mo).toEqual({ exact: [], picture: [], pictureState: 'owner_only', heuristic: true, note: expect.any(String) });
    // the owner through MCP: the exact part only (the tool never runs the picture part)
    const ow = JSON.parse((await h.rpc(h.owner, 'tools/call', { name: 'find_in_footage', arguments: { projectId: pid, query: 'כחול' } })).result.content[0].text);
    expect(ow.picture).toEqual([]);
  });
  it('index status, scan and forget refuse every other credential 403 owner_required before anything is read; a restricted grant is 403 out_of_scope', async () => {
    const full = h.bearer(h.gov.createGrant({ name: 'full2', mode: 'edit', people: 'full' }, OWNER).token);
    const calls = { ...h.embedder.calls };
    for (const who of [h.agent, h.observer, full])
      for (const [method, p] of [['GET', `/api/v1/projects/${pid}/search/index`], ['POST', `/api/v1/projects/${pid}/search/index`], ['DELETE', `/api/v1/projects/${pid}/search/index`], ['DELETE', '/api/v1/search/index'], ['GET', '/api/v1/projects/prj_none/search/index']] as const) {
        const r = await h.rest(who, method, p, method === 'POST' ? {} : undefined);
        expect({ p, status: r.status, code: r.body?.error?.code }).toEqual({ p, status: 403, code: 'owner_required' });
      }
    const restricted = h.bearer(h.gov.createGrant({ name: 'r', mode: 'edit', range: { start: { value: '0', timescale: 1 }, end: { value: '1', timescale: 1 } } }, OWNER).token);
    const rr = await search(h, restricted, pid, 'colours');
    expect({ status: rr.status, code: rr.body.error.code }).toEqual({ status: 403, code: 'out_of_scope' });
    expect(h.embedder.calls).toEqual(calls);
    expect(h.runtime.index()!.files([ids.colours.contentHash]).length).toBe(1); // nothing was forgotten by them
  });
  it('a grant for one project cannot search another (403 before anything is read)', async () => {
    const other = h.store.createProject({ name: 'other' }).doc.id;
    const only = h.bearer(h.gov.createGrant({ name: 'only-other', mode: 'edit', projectIds: [other] }, OWNER).token);
    expect((await search(h, only, other, 'colours')).status).toBe(200);
    const r = await search(h, only, pid, 'colours');
    expect(r.status).toBe(403);
    expect(r.text).not.toContain('colours.mp4');
  });
  it('vectors and scores never leave: no answer, MCP result, status, job record, job event or log line holds anything like a vector or a score', async () => {
    const events: unknown[] = [];
    const onJob = (j: unknown) => events.push(j);
    h.store.events.on('job', onJob);
    const before = logs.length;
    try {
      const pid2 = h.store.createProject({ name: 'walk' }).doc.id;
      h.importVideo(pid2, long, 'long.mp4');
      const job = await scan(h, pid2);
      const answers = [
        (await search(h, h.owner, pid2, 'אדום')).body, (await search(h, h.agent, pid2, 'אדום')).body,
        (await h.rest(h.owner, 'GET', `/api/v1/projects/${pid2}/search/index`)).body,
        (await h.rest(h.owner, 'GET', `/api/v1/jobs/${job.id}`)).body,
        JSON.parse((await h.rpc(h.owner, 'tools/call', { name: 'find_in_footage', arguments: { projectId: pid2, query: 'אדום' } })).result.content[0].text),
        h.store.getJob(job.id), ...events,
        (await h.rest(h.owner, 'DELETE', `/api/v1/projects/${pid2}/search/index`)).body,
      ];
      expect((answers[0] as any).picture.length).toBeGreaterThan(0);
      expect(answers.flatMap((a, i) => vectorish(a, `answer${i}`))).toEqual([]);
      expect(logs.slice(before).flatMap((l) => (/\d\.\d{4,}(, ?-?\d\.\d{4,}){8,}/.test(l) ? [l] : []))).toEqual([]);
    } finally { h.store.events.off('job', onJob); }
  });
  it('the query is never echoed back, stored, written to a file or logged (search, scan, refusals)', async () => {
    const Q = 'zqxplantedquery', QHE = 'שאילתהמסומנתזקכ';
    const before = logs.length;
    const restricted = h.bearer(h.gov.createGrant({ name: 'r2', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token);
    const answers = [
      await search(h, h.owner, pid, `${Q} כחול`), await search(h, h.agent, pid, `${QHE} ${Q}`), await search(h, restricted, pid, Q),
      await search(h, h.owner, pid, `${Q} `.repeat(30)), await search(h, h.owner, pid, Q, { image: Q }),
    ];
    for (const a of answers) { expect(a.text).not.toContain(Q); expect(a.text).not.toContain(QHE); }
    const m = await h.rpc(restricted, 'tools/call', { name: 'find_in_footage', arguments: { projectId: pid, query: Q } });
    expect(JSON.stringify(m)).not.toContain(Q);
    for (const l of logs.slice(before)) { expect(l).not.toContain(Q); expect(l).not.toContain(QHE); }
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(h.dir)) {
      const b = fs.readFileSync(f);
      expect({ f, q: b.includes(Buffer.from(Q)), qhe: b.includes(Buffer.from(QHE)) }).toEqual({ f, q: false, qhe: false });
    }
  });
  it('S16: picture vectors of wrong length, with NaN or not of unit length fail the scan (no rows) or the query (502), and nothing is shown', async () => {
    const pid3 = h.store.createProject({ name: 'faults' }).doc.id;
    const v = h.importVideo(pid3, makeColourVideo(path.join(fx, 'green.mp4'), ['green'], 2, 5), 'green.mp4');
    for (const kind of ['wrongLength', 'nan', 'notUnit'] as const) {
      h.embedder.options.fault = { on: 'images', kind };
      const job = await scan(h, pid3);
      expect({ kind, status: job.status, code: job.error?.code }).toEqual({ kind, status: 'failed', code: 'search_engine_failed' });
      expect(h.runtime.index()!.sampleCount(v.contentHash)).toBe(0);
    }
    h.embedder.options.fault = null;
    await scan(h, pid3);
    for (const kind of ['wrongLength', 'nan', 'notUnit'] as const) {
      h.embedder.options.fault = { on: 'text', kind };
      const r = await search(h, h.owner, pid3, 'ירוק');
      expect({ kind, status: r.status, code: r.body.error?.code }).toEqual({ kind, status: 502, code: 'search_engine_failed' });
      expect(r.body.picture).toBeUndefined();
    }
    h.embedder.options.fault = null;
    expect((await search(h, h.agent, pid3, 'green')).status).toBe(200);
  });
  it('the storage budget is enforced before the job (507, no job row); one open scan per project (409)', async () => {
    const pid4 = h.store.createProject({ name: 'budget' }).doc.id;
    h.importVideo(pid4, colours, 'colours.mp4');
    await h.runtime.forget(null);
    const was = h.store.maxStorageBytes;
    h.store.maxStorageBytes = 1;
    const jobs = h.store.openJobs(SEARCH_INDEX_JOB_TYPE).length;
    try {
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid4}/search/index`, {});
      expect({ status: r.status, code: r.body.error.code }).toEqual({ status: 507, code: 'storage_quota_exceeded' });
      expect(h.store.openJobs(SEARCH_INDEX_JOB_TYPE).length).toBe(jobs);
    } finally { h.store.maxStorageBytes = was; }
    h.embedder.options.delayMs = 300;
    try {
      const a = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid4}/search/index`, {});
      const b = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid4}/search/index`, {});
      expect({ status: b.status, code: b.body.error.code }).toEqual({ status: 409, code: 'search_scan_in_progress' });
      expect((await search(h, h.owner, pid4, 'כחול')).body.pictureState).toBe('busy');
      await h.runtime.scans.settled(a.body.jobId);
    } finally { h.embedder.options.delayMs = 0; }
  });
});

describe(`the deletion guarantee (TEST-DOUBLE embedder; ${CORE_LABEL})`, () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());
  const ix = () => h.runtime.index()!;
  const signature = (hash: string) => { const s = ix().vectors([hash], FOOTAGE_EMBEDDERS.testDouble)[0]!; return Buffer.from(s.q.slice(600, 632).buffer); };
  const indexBytes = () => Buffer.concat([ix().file, `${ix().file}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f)));

  it('remove_asset of a file no other project holds deletes its rows (planted bytes gone from index.sqlite and WAL); undo does not resurrect them', async () => {
    const pid = h.store.createProject({ name: 'del' }).doc.id;
    const v = h.importVideo(pid, colours, 'colours.mp4');
    await scan(h, pid);
    const sig = signature(v.contentHash);
    expect(indexBytes().includes(sig)).toBe(true);
    h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: v.assetId } }] });
    expect(ix().sampleCount(v.contentHash)).toBe(0);
    expect(indexBytes().includes(sig)).toBe(false);
    h.store.undo(pid, 'user:local', 'undo');
    expect(ix().sampleCount(v.contentHash)).toBe(0);
    const st = await h.rest(h.owner, 'GET', `/api/v1/projects/${pid}/search/index`);
    expect(st.body.files).toEqual({ scanned: 0, stale: 0, of: 1 }); // «צריך לסרוק»: simply not scanned again
    expect((await search(h, h.owner, pid, 'כחול')).body.pictureState).toBe('not_scanned');
    await scan(h, pid);
    h.store.undo(pid, 'user:local', 'redo'); // redo of the removal: gone again
    expect(ix().sampleCount(v.contentHash)).toBe(0);
  });
  it('a file another project still holds keeps its rows when one project removes it; they go when the last one does', async () => {
    const a = h.store.createProject({ name: 'a' }).doc.id, b = h.store.createProject({ name: 'b' }).doc.id;
    const va = h.importVideo(a, blue, 'blue-sky.mp4'), vb = h.importVideo(b, blue, 'blue-sky.mp4');
    await scan(h, a);
    h.store.commit({ projectId: a, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: va.assetId } }] });
    expect(ix().sampleCount(va.contentHash)).toBe(3);
    h.store.commit({ projectId: b, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: vb.assetId } }] });
    expect(ix().sampleCount(va.contentHash)).toBe(0);
  });
  it('deleting a project deletes its files\' rows', async () => {
    const pid = h.store.createProject({ name: 'gone project' }).doc.id;
    const v = h.importVideo(pid, long, 'long.mp4');
    await scan(h, pid);
    const sig = signature(v.contentHash);
    deleteProject(h.store, OWNER, pid, 'gone project');
    expect(ix().sampleCount(v.contentHash)).toBe(0);
    expect(indexBytes().includes(sig)).toBe(false);
  });
  it('storage clean-up (garbage collection) deletes the rows of the files it removes', async () => {
    // a file in the store that no project (nor any history) mentions, with rows left in the index (planted directly)
    const g = makeColourVideo(path.join(fx, 'gc.mp4'), ['purple'], 2, 5);
    const bytes = fs.readFileSync(g.file), hex = createHash('sha256').update(bytes).digest('hex');
    const tmp = path.join(h.store.tmpDir, 'gc-in');
    fs.copyFileSync(g.file, tmp);
    h.store.putBlob(`sha256:${hex}`, tmp, bytes.length, 'video/mp4');
    const other = SearchIndexDb.open(h.dir);
    const q = new Int8Array(768).fill(5);
    other.replaceFile({ contentHash: `sha256:${hex}`, embedder: FOOTAGE_EMBEDDERS.testDouble, source: 'original', frameCount: 10, rate: { num: 5, den: 1 } }, [{ frame: 0, scale: 0.01, q }, { frame: 5, scale: 0.01, q }], () => true);
    other.close();
    expect(ix().sampleCount(`sha256:${hex}`)).toBe(2);
    const r = collectGarbage(h.store, OWNER, true, Date.now() + 3600_000) as { applied: boolean; removed: { files: number } };
    expect(r.removed.files).toBeGreaterThan(0);
    expect(ix().sampleCount(`sha256:${hex}`)).toBe(0);
  });
  it('a removal during that file\'s scan leaves no rows (stillWanted inside the write transaction); the job says removed', async () => {
    const pid = h.store.createProject({ name: 'race' }).doc.id;
    const v = h.importVideo(pid, long, 'long.mp4');
    h.embedder.options.delayMs = 400;
    try {
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
      const start = h.embedder.calls.images;
      await until(() => h.embedder.calls.images > start, 20_000, 'the first batch');
      h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: v.assetId } }] });
      h.store.undo(pid, 'user:local', 'undo'); // back in the project before the scan ends: still wanted, written
      await h.runtime.scans.settled(r.body.jobId);
      expect(ix().sampleCount(v.contentHash)).toBe(40);
      h.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: v.assetId } }] });
      h.store.undo(pid, 'user:local', 'undo');
      const r2 = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, { assetIds: [v.assetId] });
      const s2 = h.embedder.calls.images;
      await until(() => h.embedder.calls.images > s2, 20_000, 'the first batch again');
      h.store.undo(pid, 'user:local', 'redo'); // removed while its frames are being embedded
      await h.runtime.scans.settled(r2.body.jobId);
      const job = h.store.getJob(r2.body.jobId);
      expect({ status: job.status, removed: job.output.files.skipped.removed }).toEqual({ status: 'succeeded', removed: 1 });
      expect(ix().sampleCount(v.contentHash)).toBe(0);
    } finally { h.embedder.options.delayMs = 0; }
  });
  it('«שכח»: forgetting a project removes everything of its files; forgetting all removes the index file', async () => {
    const pid = h.store.createProject({ name: 'forget' }).doc.id;
    const v = h.importVideo(pid, colours, 'colours.mp4'), w = h.importVideo(pid, blue, 'blue-sky.mp4');
    await scan(h, pid);
    const f = await h.rest(h.owner, 'DELETE', `/api/v1/projects/${pid}/search/index`);
    expect(f.status).toBe(200);
    expect(f.body.forgotten.files).toBe(2);
    expect(ix().sampleCount(v.contentHash) + ix().sampleCount(w.contentHash)).toBe(0);
    await scan(h, pid);
    const all = await h.rest(h.owner, 'DELETE', '/api/v1/search/index');
    expect(all.body.forgotten.files).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(h.dir, 'search', 'index.sqlite'))).toBe(false);
    expect((await h.rest(h.owner, 'GET', `/api/v1/projects/${pid}/search/index`)).body.files).toEqual({ scanned: 0, stale: 0, of: 2 });
  });
  it('the backup holds no search/ folder and a project archive holds no index bytes', async () => {
    const pid = h.store.createProject({ name: 'backup' }).doc.id;
    const v = h.importVideo(pid, colours, 'colours.mp4');
    await scan(h, pid);
    const sig = signature(v.contentHash);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-searchB-bk-'));
    try {
      await backupDataDir(h.dir, dest);
      expect(fs.existsSync(path.join(dest, 'search'))).toBe(false);
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      for (const f of walk(dest)) expect({ f, sig: fs.readFileSync(f).includes(sig) }).toEqual({ f, sig: false });
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
    const chunks: Buffer[] = [];
    for await (const c of writeArchive(planArchive(h.store, pid))) chunks.push(c);
    const tar = Buffer.concat(chunks);
    expect(tar.includes(sig)).toBe(false);
    expect(tar.includes(Buffer.from('index.sqlite'))).toBe(false);
  });
});

describe(`cancel, restart, export wait and the lane (TEST-DOUBLE embedder; ${CORE_LABEL})`, () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());
  it('cancel stops at a batch boundary: the batch in flight finishes, no other starts, the unfinished file has no rows', async () => {
    const pid = h.store.createProject({ name: 'cancel' }).doc.id;
    const v = h.importVideo(pid, long, 'long.mp4');
    h.embedder.options.delayMs = 500;
    try {
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, {});
      await until(() => h.store.getJob(r.body.jobId).status === 'running');
      await new Promise((res) => setTimeout(res, 100)); // inside the first batch's embedding
      const c = await h.rest(h.owner, 'POST', `/api/v1/jobs/${r.body.jobId}/cancel`, {});
      expect(c.status).toBe(200);
      const at = h.embedder.calls.images;
      await h.runtime.scans.settled(r.body.jobId);
      expect(h.store.getJob(r.body.jobId).status).toBe('canceled');
      expect(h.embedder.calls.images).toBeLessThanOrEqual(at + 1);
      expect(h.runtime.index()?.sampleCount(v.contentHash) ?? 0).toBe(0);
      const ag = await h.rest(h.agent, 'POST', `/api/v1/jobs/${r.body.jobId}/cancel`, {});
      expect(ag.status).toBe(403);
    } finally { h.embedder.options.delayMs = 0; }
  });
  it('a restart mid-scan resumes at the first file without a complete row; no file has partial rows; totals equal a whole scan', async () => {
    const pid = h.store.createProject({ name: 'restart' }).doc.id;
    const a = h.importVideo(pid, colours, 'colours.mp4'), b = h.importVideo(pid, long, 'long.mp4');
    const e1 = createTestEmbedder({ delayMs: 300 });
    const r1 = h.newRuntime({ embedder: e1 });
    const { jobId } = await r1.startScan(OWNER, pid, { assetIds: [a.assetId, b.assetId] });
    await until(() => !!r1.index()?.hasFile(a.contentHash, FOOTAGE_EMBEDDERS.testDouble), 20_000, 'the first file');
    await r1.stop(); // the server stops: the row stays running
    expect(h.store.getJob(jobId).status).toBe('running');
    const ix0 = SearchIndexDb.open(h.dir);
    expect(ix0.sampleCount(b.contentHash)).toBe(0); // nothing partial of the unfinished file
    ix0.close();
    const e2 = createTestEmbedder();
    const r2 = h.newRuntime({ embedder: e2 });
    try {
      expect(r2.recover()).toBe(1);
      await r2.scans.settled(jobId);
      const job = h.store.getJob(jobId);
      expect(job.status).toBe('succeeded');
      expect(e2.calls.frames).toBe(targets(long).length); // the complete file was not embedded again
      expect(job.output.files).toMatchObject({ scanned: 1, alreadyScanned: 1 });
      expect(job.output.progress).toEqual({ unit: 'frames', done: targets(colours).length + targets(long).length, total: targets(colours).length + targets(long).length });
      expect(r2.index()!.framesOf(a.contentHash, FOOTAGE_EMBEDDERS.testDouble)).toEqual(targets(colours));
      expect(r2.index()!.framesOf(b.contentHash, FOOTAGE_EMBEDDERS.testDouble)).toEqual(targets(long));
    } finally { await r2.stop(); }
  });
  it('the scan waits while an export runs and holds the lane only under local.search.picture …; a local tool and a query run meanwhile', async () => {
    const pid = h.store.createProject({ name: 'lane' }).doc.id;
    const v = h.importVideo(pid, long, 'long.mp4');
    const labels: string[] = [];
    h.lane.onBeforeHeavy((l) => { labels.push(l); });
    h.lane.setExportActive(true);
    h.embedder.options.delayMs = 200;
    try {
      await h.rest(h.owner, 'DELETE', `/api/v1/projects/${pid}/search/index`); // the restart test scanned the same file: forget it first
      const r = await h.rest(h.owner, 'POST', `/api/v1/projects/${pid}/search/index`, { assetIds: [v.assetId] });
      await new Promise((res) => setTimeout(res, 600));
      expect(r.status).toBe(202);
      const during = h.embedder.calls.images;
      await new Promise((res) => setTimeout(res, 300));
      expect(h.embedder.calls.images).toBe(during); // nothing embedded while the export runs
      h.lane.setExportActive(false);
      await until(() => h.embedder.calls.images > during, 20_000, 'a batch after the export');
      // a local tool takes the lane between batches and completes
      const release = await h.lane.acquire('local.translate he-en');
      release();
      const q = await search(h, h.owner, pid, 'אדום');
      expect(q.status).toBe(200);
      await h.runtime.scans.settled(r.body.jobId);
      const job = h.store.getJob(r.body.jobId);
      expect(job.status).toBe('succeeded');
      expect(job.output.progress.done).toBe(targets(long).length);
      const mine = labels.filter((l) => l !== 'local.translate he-en');
      expect(mine.length).toBeGreaterThan(0);
      for (const l of mine) expect(l).toBe(`${SEARCH_LANE_PREFIX}scan ${pid}`);
    } finally { h.embedder.options.delayMs = 0; h.lane.setExportActive(false); }
  });
});
