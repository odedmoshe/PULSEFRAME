/**
 * The made.render job end to end in the server (wave 8 motioncode, W1): a real made browser, the one-pass encode, the file check and
 * the job row. Small synthetic pages on a 96×54 project at 10 fps, so a render is a handful of frames. The frame budget is widened
 * (this machine is shared and loaded); the budget itself is tested in apps/renderer/src/made.test.ts. Internet files come from a
 * labelled stand-in fetch (no network in a unit test).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssetSchema, MADE_BUILT, MADE_WARNINGS, MADE_JOB_TYPE, MadeRecordSchema, type MadeRenderRequest } from '@pulseframe/core';
import { MadeHost } from '@pulseframe/renderer';
import type { Principal } from '../governance.ts';
import { FifoComputeLane } from '../lane.ts';
import { Store } from '../store.ts';
import { jobPins } from '../storage.ts';
import { MadeJobs, typedValues } from './job.ts';
import { createMadeRunner } from './runner.ts';
import { namedAddresses, rewriteAddresses, servedLibraries } from './libs.ts';
import { MADE_TEMPLATES } from './templates/index.ts';

let dir: string; let store: Store; let host: MadeHost; let projectId: string;
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const agent: Principal = { actor: 'agent:a1', kind: 'agent', scopes: ['observe', 'edit'] };
/** LABELLED STAND-IN for the internet: answers one address, fails every other. */
const fakeFetch = (async (url: string) => (url === 'https://pictures.example/dot.svg'
  ? new Response('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#0f0"/></svg>', { headers: { 'content-type': 'image/svg+xml' } })
  : new Response('no', { status: 404 }))) as unknown as typeof fetch;
let jobs: MadeJobs;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-job-'));
  store = new Store(dir, 0);
  host = new MadeHost();
  jobs = new MadeJobs({ store, lane: new FifoComputeLane(), host, fetch: fakeFetch, lookup: async () => ['93.184.216.34'] /* stand-in resolver */, frameMs: 30_000, jobMs: 600_000 });
  projectId = store.createProject({ name: 'made', width: 96, height: 54, frameRate: { num: 10, den: 1 } }).doc.id;
});
afterAll(async () => { await jobs.stop(); await host.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const sha = (t: string) => `sha256:${createHash('sha256').update(t, 'utf8').digest('hex')}`;
const page = (body: string) => `<!doctype html><meta charset=utf-8><canvas id=c width=96 height=54></canvas><script>const c=document.getElementById('c').getContext('2d');${body}</script>`;
const fields = [{ key: 'title', kind: 'text' as const, label: { he: 'כותרת', en: 'Title' }, default: 'טיול לגליל 2026' }, { key: 'colour', kind: 'colour' as const, label: { he: 'צבע', en: 'Colour' }, default: '#ffffff' }];
async function render(p: Principal, text: string, req: Partial<MadeRenderRequest> = {}) {
  const r: MadeRenderRequest = { page: text, seconds: 0.5, name: 'test clip', fields, ...req };
  const { jobId } = jobs.start(p, projectId, r, { text, sha256: sha(text) });
  for (let i = 0; i < 2400; i++) {
    const j = store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('render did not finish');
}

describe('made job — pure parts', () => {
  it('types values by their fields and drops values no field names', () => {
    expect(typedValues([...fields, { key: 'n', kind: 'number', label: { he: 'מ', en: 'n' }, default: '5' }], { title: 'Hi', n: '12', stray: 'x' })).toEqual({ typed: { title: 'Hi', colour: '#ffffff', n: 12 }, kept: { title: 'Hi', colour: '#ffffff', n: '12' } });
  });
  it('finds the internet addresses a page names (not made.invalid, not XML namespaces) and rewrites them to local copies', () => {
    const t = '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://a.example/x.png"/></svg><img src="https://made.invalid/assets/a1"> https://a.example/x.png.big';
    expect(namedAddresses(t)).toEqual(['https://a.example/x.png', 'https://a.example/x.png.big']);
    expect(rewriteAddresses(t, ['https://a.example/x.png', 'https://a.example/x.png.big'])).toContain('href="https://made.invalid/fetched/0"');
    expect(rewriteAddresses(t, ['https://a.example/x.png', 'https://a.example/x.png.big'])).toContain('https://made.invalid/fetched/1');
  });
  it('serves the pinned libraries that are installed at their exact version with a licence read', () => {
    const names = servedLibraries().map((l) => `${l.name}@${l.version}`);
    expect(names).toEqual(expect.arrayContaining(['gsap@3.15.1', 'three@0.187.0']));
    expect(names.some((n) => n.startsWith('hyperframes'))).toBe(false);
  });
});

describe('made job (made browser, ffmpeg)', () => {
  it('renders a Hebrew title page: succeeded, record and asset valid, blobs kept, codes on the wire', async () => {
    const j = await render(owner, page(`PF.render = (f) => { c.clearRect(0,0,96,54); c.direction='rtl'; c.font='700 14px Heebo'; c.fillStyle=PF.fields.colour; c.fillText(PF.fields.title, 90, 20 + f); };`), { values: { title: 'שלום עולם', colour: '#ffcc00' } });
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    const rec = MadeRecordSchema.parse(j.output.record);
    expect(rec).toMatchObject({ frames: 5, width: 96, height: 54, values: { title: 'שלום עולם', colour: '#ffcc00' }, checks: { alpha: true } });
    expect(rec.checks.determinism.frames.length).toBeGreaterThanOrEqual(3);
    for (const h of [j.output.fileSha256, ...j.output.stills, j.output.pageSha256]) expect(fs.existsSync(store.blobPath(h))).toBe(true);
    expect(j.output.report.fontsChecked['700 40px "Heebo"']).toBe(true);
    for (const w of j.output.report.warnings) expect(Object.keys(MADE_WARNINGS)).toContain(w.why); // the wire carries table keys
    const report = jobs.report(j);
    expect(report).toMatchObject({ status: 'succeeded', stage: 'done', submittedBy: 'user:local', fileSha256: j.output.fileSha256 });
    const asset = await jobs.assetFor(j, owner.actor);
    const parsed = AssetSchema.omit({ id: true }).parse(asset);
    expect(parsed.video).toMatchObject({ frameCount: 5, hasAlpha: true, frameRate: { num: 10, den: 1 } });
    expect(parsed.video?.untaggedColour).toBeUndefined();
    expect(parsed.duration).toEqual({ value: '1', timescale: 2 });
    expect(jobPins({ type: MADE_JOB_TYPE, status: 'succeeded', output: JSON.stringify(j.output), error: null, updated_at: j.updatedAt }, Date.now())).toBe(true);
    // apply_made_clip is W2's op; until it is built the commit is refused and nothing is recorded on the job
    const runner = createMadeRunner(store, jobs);
    if (!MADE_BUILT.op) {
      await expect(runner.apply(owner, projectId, j.id, {})).rejects.toBeTruthy();
      expect(store.getJob(j.id).output.appliedAssetId).toBeUndefined();
    } else {
      const a = await runner.apply(agent, projectId, j.id, {});
      expect(store.getJob(j.id).output.appliedAssetId).toBe(a.output.assetId);
    }
    expect(() => runner.report(agent, projectId, j.id)).toThrow(/not_your_job|belong/);
    expect(() => runner.report(owner, 'prj_other', j.id)).toThrow();
    runner.dismiss(owner, projectId, j.id);
    expect(jobPins({ type: MADE_JOB_TYPE, status: 'succeeded', output: JSON.stringify(store.getJob(j.id).output), error: null, updated_at: j.updatedAt }, Date.now())).toBe(false);
  }, 600_000);

  it('flashing is a warning with its numbers, the job succeeds; a full-frame plate is kept without alpha', async () => {
    const j = await render(owner, page(`PF.render = (f) => { c.clearRect(0,0,96,54); if (f % 2 === 0) { c.fillStyle='#fff'; c.fillRect(0,0,96,54); } };`), { seconds: 3 });
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.report.warnings.filter((w: any) => w.why === 'flash').length).toBeGreaterThan(0);
    expect(j.output.record.checks.flash.black.general).toBeGreaterThan(3);
    const plate = await render(owner, page(`PF.render = () => { c.fillStyle='#1d2a44'; c.fillRect(0,0,96,54); }; document.body.style.margin='0'; document.body.style.background='#1d2a44';`));
    expect(plate.status, JSON.stringify(plate.error)).toBe('succeeded');
    expect(plate.output.record.checks.alpha).toBe(false);
  }, 600_000);

  it('facts fail the job: empty, a counter between frames, an internet file that cannot be fetched', async () => {
    expect((await render(owner, page(`PF.render = () => {};`))).error).toMatchObject({ code: 'made_empty', why: 'empty' });
    expect((await render(owner, page(`let k=0; PF.render = () => { k++; c.clearRect(0,0,96,54); c.fillStyle='#fff'; c.fillRect(k*7,0,7,54); };`))).error).toMatchObject({ why: 'notDeterministic' });
    const bad = await render(owner, page(`PF.render = () => { c.fillRect(0,0,9,9); }; // https://pictures.example/missing.png`));
    expect(bad.error).toMatchObject({ why: 'fetchFailed' });
    expect(bad.error.message).toContain('https://pictures.example/missing.png');
  }, 600_000);

  it('a page error thrown while drawing ends the job crashed with the error as its detail, and the report carries the detail (integration decision 3)', async () => {
    const j = await render(owner, page(`PF.render = (f) => { if (f === 2) throw new Error('boom-at-two'); c.fillRect(0,0,9,9); };`));
    expect(j.error).toMatchObject({ code: 'made_crashed', why: 'crashed' });
    expect(j.error.detail).toContain('boom-at-two');
    expect(jobs.report(j).failure).toMatchObject({ why: 'crashed', detail: expect.stringContaining('boom-at-two') });
    expect(jobs.report(j).failure!.message).toMatch(/error/);
  }, 600_000);
  it('an internet file is fetched once before drawing, served locally and recorded by hash', async () => {
    const j = await render(owner, `<!doctype html><img src="https://pictures.example/dot.svg" width=96 height=54 style="display:block">`);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.record.fetched).toEqual([{ url: 'https://pictures.example/dot.svg', sha256: expect.stringMatching(/^sha256:/), bytes: expect.any(Number) }]);
  }, 600_000);

  it('G-webgl: a three.js page (three@0.187.0 served locally) renders with alpha on the software renderer; differing pixels between passes are counted, never a failure', async () => {
    const t0 = Date.now();
    const j = await render(owner, `<!doctype html><meta charset=utf-8><canvas id=c width=96 height=54></canvas><script type=module>
import * as THREE from 'https://made.invalid/lib/three@0.187.0/build/three.module.js';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), alpha: true, preserveDrawingBuffer: true, antialias: false });
r.setClearColor(0x000000, 0);
const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(50, 96 / 54, 0.1, 10); cam.position.z = 3;
const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial()); scene.add(m);
PF.render = (f, t) => { m.rotation.y = t * 2; m.rotation.x = t; r.render(scene, cam); };
</script>`, { seconds: 1, capabilities: { webgl: true } });
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.report.warnings.map((w: any) => w.why)).not.toContain('fontMissing'); // the browser's default face is not the page's
    expect(j.output.record).toMatchObject({ webgl: true, libraries: ['three@0.187.0'], checks: { alpha: true, determinism: { differingPixels: expect.any(Number) } } });
    console.log(`G-webgl (one sample on this loaded machine, not a fact about the product): 10 frames 96x54 in ${((Date.now() - t0) / 1000).toFixed(1)} s for the whole job; differing pixels ${j.output.record.checks.determinism.differingPixels}; warnings ${JSON.stringify(j.output.report.warnings.map((w: any) => w.why))}`);
  }, 600_000);

  it('a GSAP page (gsap@3.15.1 served locally) seeked by PF.render draws the tween at the frame\'s time', async () => {
    const j = await render(owner, `<!doctype html><meta charset=utf-8><style>body{margin:0}#b{width:10px;height:10px;background:#fff}</style><div id=b></div>
<script src="https://made.invalid/lib/gsap@3.15.1/dist/gsap.min.js"></script><script>
const tl = gsap.timeline({ paused: true }); tl.to('#b', { x: 80, duration: 0.5, ease: 'none' });
PF.render = (f, t) => { tl.seek(t, false); };
</script>`);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output.record.libraries).toEqual(['gsap@3.15.1']);
  }, 600_000);

  it('the five built-in pages render with Hebrew and with English values and pass every check (two passes alike; functional only, nobody has looked)', async () => {
    for (const t of MADE_TEMPLATES) for (const lang of ['he', 'en'] as const) {
      const { jobId } = jobs.start(owner, projectId, { page: { templateId: t.id }, seconds: 1, name: t.name.en, values: t.samples[lang] }, { text: t.page, sha256: t.pageSha256, templateId: t.id, templateVersion: t.version, fields: t.fields });
      let j = store.getJob(jobId);
      for (let i = 0; i < 2400 && !['succeeded', 'failed', 'canceled'].includes(j.status); i++) { await new Promise((r) => setTimeout(r, 250)); j = store.getJob(jobId); }
      expect(j.status, `${t.id} ${lang}: ${JSON.stringify(j.error)}`).toBe('succeeded');
      expect(j.output.record).toMatchObject({ templateId: t.id, templateVersion: t.version, frames: 10 });
      expect(j.output.report.warnings.map((w: any) => w.why)).not.toContain('fontMissing');
    }
  }, 900_000);

  it('capacity: one active render per credential (429 made_busy); cancel while queued; a restart fails what was running', async () => {
    const lane = new FifoComputeLane();
    const hold = await lane.acquire('someone else'); // the lane is busy, so renders stay queued
    const q = new MadeJobs({ store, lane, host, frameMs: 30_000 });
    const text = page(`PF.render = () => { c.fillRect(0,0,9,9); };`);
    const { jobId } = q.start(agent, projectId, { page: text, seconds: 0.3, name: 'q' }, { text, sha256: sha(text) });
    expect(() => q.start(agent, projectId, { page: text, seconds: 0.3, name: 'q2' }, { text, sha256: sha(text) })).toThrow(expect.objectContaining({ status: 429, code: 'made_busy' }));
    const c = q.cancel(jobId, agent.actor);
    expect(c.outcome).toBe('interrupt-requested');
    for (let i = 0; i < 100 && store.getJob(jobId).status !== 'canceled'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(store.getJob(jobId)).toMatchObject({ status: 'canceled', error: { why: 'canceled' } });
    hold();
    const stale = store.createJob(projectId, MADE_JOB_TYPE, 'user:local', { pageSha256: sha(text) });
    store.updateJob(stale.id, { status: 'running' });
    expect(q.recover()).toBeGreaterThanOrEqual(1);
    expect(store.getJob(stale.id)).toMatchObject({ status: 'failed', error: { why: 'restarted' } });
  }, 120_000);
});
