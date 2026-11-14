/**
 * Amendment A1, milestone G0 (first half): optional ComfyUI provider, model-free smoke path.
 * Runs against a REAL ComfyUI process (CPU is enough; no models). Fault-injection cases wrap the
 * real adapter and are labelled as such. If ComfyUI is not reachable this exits 2 = BLOCKED, never "passed".
 *
 *   PF_COMFYUI_URL=http://127.0.0.1:8188 pnpm proof:g0
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ComfyUIAdapter, ProviderError, type ProviderAdapter } from '@pulseframe/providers';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/g0');
const COMFY = process.env.PF_COMFYUI_URL ?? 'http://127.0.0.1:8188';
const PORT = Number(process.env.PF_PROOF_PORT ?? 8798);
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const comfy = async (p: string) => (await fetch(`${COMFY}${p}`)).json() as Promise<any>;
const historyCount = async () => Object.keys(await comfy('/history?max_items=10000')).length;
const queueLen = async () => { const q = await comfy('/queue'); return q.queue_running.length + q.queue_pending.length; };
const waitIdle = async () => { while (await queueLen()) await sleep(150); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const real = new ComfyUIAdapter(COMFY);
  const ready = await real.probe();
  if (!ready.reachable) {
    console.error(`BLOCKED: ComfyUI is not reachable at ${COMFY} (${ready.problems.join('; ')}). Start it (docs/INTEGRATIONS.md) and rerun.`);
    process.exit(2);
  }
  await waitIdle();
  let n = 0;
  const boot = async (cfg: Record<string, unknown>, adapter?: ProviderAdapter) => startServer({ port: PORT, dataDir: path.join(art, `data${n++}`), ...cfg }, { providerAdapter: adapter });
  const api = (s: { url: string; auth: any }, token = s.auth.tokens.agent) => async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() } as { status: number; body: any };
  };
  const waitJob = async (call: ReturnType<typeof api>, jobId: string, until = ['succeeded', 'failed', 'canceled', 'submission-unknown']) => {
    for (let i = 0; i < 600; i++) { const j = (await call(`/jobs/${jobId}`)).body; if (until.includes(j.status)) return j; await sleep(100); }
    throw new Error(`job ${jobId} did not settle`);
  };
  const SMOKE = 'comfy.smoke.solid-image';

  console.log('\n# provider absent: honest setup state, editor unaffected');
  let s = await boot({ comfyuiUrl: null });
  let call = api(s);
  let pid = (await call('/projects', { name: 'g0' })).body.project.id;
  const absent = (await call('/capabilities')).body;
  check('unconfigured provider is reported as not configured (not simulated)', absent.provider.configured === false && absent.capabilities[0].runnable === false, absent.provider.reason);
  const noProv = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params: {} });
  check('running a capability without a provider -> 503 provider_not_configured with a setup hint', noProv.status === 503 && noProv.body.error.code === 'provider_not_configured' && !!noProv.body.error.hint);
  check('core editing still works with no provider', (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'שלום', start: { value: '0', timescale: 1 }, duration: { value: '1', timescale: 1 } } }] })).body.committed === true);
  await s.close();

  console.log('\n# real ComfyUI, model-free smoke graph');
  s = await boot({ comfyuiUrl: COMFY });
  call = api(s);
  pid = (await call('/projects', { name: 'g0' })).body.project.id;
  const h0 = await historyCount();
  let list: any;
  for (let i = 0; i < 5; i++) list = (await call('/capabilities')).body;
  const cap = list.capabilities[0];
  check('listing/polling capabilities and provider status submits nothing to the worker', (await historyCount()) === h0 && (await queueLen()) === 0 && list.provider.readiness.wokeWorker === false);
  check('provider readiness reports the actual runtime and device', list.provider.readiness.reachable && !!list.provider.readiness.runtimeVersion, { comfyui: list.provider.readiness.runtimeVersion, device: list.provider.readiness.device, hostRamGiB: +(list.provider.readiness.hostRamBytes / 2 ** 30).toFixed(1) });
  check('before any run, the capability shows the two run-earned dimensions as not assessed', cap.blockers.map((b: any) => b.code).sort().join() === 'not_executed,not_hardwareQualified' && cap.runnable === true);
  check('resource fields are separate quantities (download bytes, estimated residency, measured profiles)', 'downloadBytes' in cap.resources && 'estimatedResidencyBytes' in cap.resources && Array.isArray(cap.resources.measuredProfiles));

  const graph = { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } }, '9': { class_type: 'CustomFetch', inputs: { url: 'https://example.com/a' } }, '10': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'o' } } };
  const imp = await call('/capabilities/import', { id: 'imported.demo', title: 'Demo', graph });
  const impCodes = new Set<string>(imp.body.blockers.map((b: any) => b.code));
  check('import returns a draft whose unknown model, unknown node and URL block publication', imp.status === 200 && imp.body.state === 'draft' && ['unresolved_model', 'unknown_node_pack', 'graph_defined_egress', 'not_executed'].every((c) => impCodes.has(c)), [...impCodes]);
  check('import executed nothing on the provider', (await historyCount()) === h0 && (await queueLen()) === 0);

  // REST
  const params = { width: 320, height: 192, color: 0x3de0c8 };
  const r1 = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params, idempotencyKey: 'k-rest-1' });
  const jRest = await waitJob(call, r1.body.jobId);
  const out = jRest.output?.bundle?.[0];
  check('REST run: durable job succeeded only after output was downloaded, digested and probed', jRest.status === 'succeeded' && out?.width === 320 && out?.height === 192 && /^sha256:[0-9a-f]{64}$/.test(out.contentHash) && out.codec === 'png', { stageSeconds: jRest.output?.stageSeconds, bytes: out?.bytes });
  const png = Buffer.from((await call(`/jobs/${jRest.id}/outputs/0`)).body);
  fs.writeFileSync(path.join(art, 'smoke.png'), png);
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(art, 'smoke.png'), '-vf', 'crop=1:1:160:96', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  check('output pixels match the requested colour (decoded, not assumed)', px[0] === 0x3d && px[1] === 0xe0 && px[2] === 0xc8, [...px]);
  check('recipe is recorded: capability version, graph digest, resolved params, runtime and device', jRest.output.recipe.graphDigest === cap.graphDigest && jRest.output.recipe.params.width === 320 && !!jRest.output.recipe.provider.runtimeVersion);
  const lib = (await call(`/projects/${pid}`)).body.project.assets[jRest.output.attachment.assetId];
  check('result enters the project as a derived asset with lineage (job, capability version, graph digest, params, provider)', jRest.output.attachment.status === 'imported' && lib?.kind === 'image' && lib.provenance.origin === 'derived' && lib.provenance.derived.jobId === jRest.id && lib.provenance.derived.graphDigest === cap.graphDigest && lib.image.width === 320, lib?.provenance?.derived && { capability: lib.provenance.derived.capabilityId, version: lib.provenance.derived.capabilityVersion });
  check('no placement was requested, so nothing was put on the timeline', (await call(`/projects/${pid}/timeline`)).body.tracks.every((t: any) => t.clips.length === 0));
  const again = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params, idempotencyKey: 'k-rest-1' });
  check('idempotency key: second request returns the same job; provider ran once', again.body.jobId === r1.body.jobId && (await historyCount()) === h0 + 1);

  // MCP
  const mcp = new Client({ name: 'g0-agent', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } } }));
  const tool = async (name: string, args: Record<string, unknown>) => { const r = await mcp.callTool({ name, arguments: args }); return { isError: !!r.isError, data: JSON.parse((r.content as any[])[0].text) }; };
  const m1 = await tool('run_capability', { projectId: pid, capabilityId: SMOKE, params });
  let jMcp: any;
  for (;;) { jMcp = (await tool('get_job', { jobId: m1.data.jobId })).data; if (['succeeded', 'failed'].includes(jMcp.status)) break; await sleep(100); }
  const shape = (j: any) => JSON.stringify({ keys: Object.keys(j).sort(), type: j.type, out: Object.keys(j.output).sort(), bundle: Object.keys(j.output.bundle[0]).sort(), recipe: Object.keys(j.output.recipe).sort(), cap: j.capabilityId, digest: j.graphDigest, params: j.params });
  check('MCP run_capability creates the same authoritative job shape as REST, with the agent as actor', jMcp.status === 'succeeded' && shape(jMcp) === shape(jRest) && jMcp.actor === 'agent:local' && jMcp.output.bundle[0].contentHash === out.contentHash);
  const smuggle = await tool('run_capability', { projectId: pid, capabilityId: SMOKE, params: { graph: graph, batch_size: 4096 } });
  check('agents cannot smuggle a raw graph or unexposed fields through parameters', smuggle.isError && smuggle.data.error.code === 'unknown_parameter');
  const oob = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params: { width: 99999 } });
  check('out-of-range parameter is rejected before any job or submission exists', oob.status === 422 && oob.body.error.code === 'invalid_parameter');
  const obs = await api(s, s.auth.tokens.observer)(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params: {} });
  check('observe-only credential cannot start a provider job', obs.status === 403);
  check('rejected requests reached the provider zero times', (await historyCount()) === h0 + 2);
  await mcp.close();

  // UI
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${s.url}/?project=${pid}`);
  await page.locator('[data-testid=provider-status][data-state=ready]').waitFor();
  await page.getByTestId('provider-smoke').click();
  await page.locator('[data-testid=provider-result][data-job]').waitFor({ timeout: 60_000 });
  const uiJob = (await call(`/jobs/${await page.getByTestId('provider-result').getAttribute('data-job')}`)).body;
  check('UI button creates the same job shape through the same route, with the user as actor', uiJob.status === 'succeeded' && uiJob.actor === 'user:local' && shape({ ...uiJob, params }) === shape({ ...jRest, params }) && uiJob.graphDigest === jRest.graphDigest);
  await page.screenshot({ path: path.join(root, 'docs/evidence/g0-provider-panel-he.png') });
  await browser.close();
  const after = (await call('/capabilities')).body.capabilities[0];
  check('run-earned evidence now cites the recorded job and names the profile it applies to', after.qualification.executed.status === 'pass' && /job_/.test(after.qualification.executed.evidence) && /only for this profile/.test(after.qualification.hardwareQualified.evidence), after.qualification.executed.evidence);

  console.log('\n# media-input workflow: a project still is staged to the provider (model-free blur)');
  const BLUR = 'comfy.image.soft-blur';
  const srcPng = path.join(art, 'edge.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=white:s=320x180', '-vf', 'drawbox=x=0:y=0:w=160:h=180:color=black:t=fill', '-frames:v', '1', srcPng]);
  const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'x-filename': 'edge.png', connection: 'close' }, body: fs.readFileSync(srcPng) });
  const upBody: any = await up.json();
  check('still image upload: probed as an image asset with exact dimensions', up.status === 201 && upBody.asset.kind === 'image' && upBody.asset.image.width === 320 && upBody.asset.image.height === 180 && upBody.asset.image.hasAlpha === false, upBody.asset?.image);
  const hBlur = await historyCount();
  const bl = await call(`/projects/${pid}/capabilities/${BLUR}/runs`, { params: { image: upBody.assetId, radius: 12, sigma: 6 } });
  const jBl = await waitJob(call, bl.body.jobId);
  const blOut = jBl.output?.bundle?.[0];
  const blPng = path.join(art, 'blurred.png');
  fs.writeFileSync(blPng, Buffer.from((await call(`/jobs/${jBl.id}/outputs/0`)).body));
  const row = execFileSync('ffmpeg', ['-v', 'error', '-i', blPng, '-vf', 'crop=320:1:0:90', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  check('media workflow ran on the staged source: output keeps the source size and the hard edge became a gradient', jBl.status === 'succeeded' && blOut.width === 320 && blOut.height === 180 && row[20]! < 8 && row[300]! > 247 && row[160]! > 60 && row[160]! < 195 && row[152]! < row[168]!, { stageSeconds: jBl.output?.stageSeconds, edgeProfile: [row[20], row[150], row[160], row[170], row[300]] });
  const blAsset = (await call(`/projects/${pid}`)).body.project.assets[jBl.output.attachment.assetId];
  check('lineage: the derived asset records its source asset, and the job records the source content hash that was staged', blAsset.provenance.derived.sourceAssetIds[0] === upBody.assetId && jBl.output.recipe.sources[0].contentHash === upBody.asset.contentHash && jBl.output.recipe.sources[0].bytes === upBody.asset.byteSize);
  const badAsset = await call(`/projects/${pid}/capabilities/${BLUR}/runs`, { params: { image: 'ast_doesnotexist' } });
  const pathParam = await call(`/projects/${pid}/capabilities/${BLUR}/runs`, { params: { image: '../../../etc/passwd' } });
  const urlParam = await call(`/projects/${pid}/capabilities/${BLUR}/runs`, { params: { image: 'https://example.com/x.png' } });
  check('media parameters accept only project asset ids: unknown asset 404, file path and URL rejected, nothing submitted', badAsset.status === 404 && pathParam.status === 422 && urlParam.status === 422 && (await historyCount()) === hBlur + 1, [badAsset.body.error.code, pathParam.body.error.code, urlParam.body.error.code]);

  console.log('\n# attachment through operations, and stale-result protection');
  const T30 = (n: number) => ({ value: String(n), timescale: 30 });
  const at = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params: { width: 256, height: 256, color: 0xff8800 }, attach: { start: T30(0), duration: T30(60) } });
  const jAt = await waitJob(call, at.body.jobId);
  const tlA = (await call(`/projects/${pid}/timeline`)).body;
  const placed = tlA.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === jAt.output.attachment.clipId);
  check('requested placement: output is attached as a normal clip via add_clip, in its own revision, by the requesting actor', jAt.output.attachment.status === 'attached' && placed?.assetId === jAt.output.attachment.assetId && placed.endSeconds === 2, { revision: jAt.output.attachment.revision });
  const fr = await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=10`, { headers: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } });
  fs.writeFileSync(path.join(art, 'attached-frame.png'), Buffer.from(await fr.arrayBuffer()));
  const cpx = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(art, 'attached-frame.png'), '-vf', 'crop=1:1:540:960', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  check('the attached provider image renders through the shared compositor (pixel read from render_frame)', fr.status === 200 && cpx[0] === 0xff && cpx[1] === 0x88 && cpx[2] === 0x00, [...cpx]);
  const undoAttach = await call(`/projects/${pid}/undo`, {});
  check('the placement is an ordinary transaction: undo removes the clip and keeps the derived asset', undoAttach.body.committed === true && !(await call(`/projects/${pid}/timeline`)).body.tracks.flatMap((t: any) => t.clips).some((c: any) => c.id === placed.id) && !!(await call(`/projects/${pid}`)).body.project.assets[jAt.output.attachment.assetId]);
  // Stale result: the placement depends on a clip that is edited while the job waits in the provider queue.
  const dep = (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'כותרת', start: T30(0), duration: T30(60) } }] })).body.results[0].output.clipId;
  const hold = await (async () => { const g: Record<string, any> = { '1': { class_type: 'EmptyImage', inputs: { width: 1024, height: 1024, batch_size: 4, color: Date.now() % 0xffffff } } }; for (let i = 2; i < 6; i++) g[i] = { class_type: 'ImageBlur', inputs: { image: [String(i - 1), 0], blur_radius: 31, sigma: 10 } }; g['9'] = { class_type: 'PreviewImage', inputs: { images: ['5', 0] } }; return real.submit(g, `hold-${Date.now()}`); })();
  const st = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params: { width: 128, height: 128, color: 0x0000ff }, attach: { start: T30(90), duration: T30(30) }, dependsOn: [dep] });
  for (let i = 0; i < 100 && !/queued \(position/.test((await call(`/jobs/${st.body.jobId}`)).body.stage ?? ''); i++) await sleep(50);
  const edit = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: dep, text: 'כותרת חדשה' } }] });
  await real.cancel(hold.providerJobId);
  const jSt = await waitJob(call, st.body.jobId);
  const tlS = (await call(`/projects/${pid}/timeline`)).body;
  const docS = (await call(`/projects/${pid}`)).body;
  check('stale result: the job finished but its dependency was edited meanwhile -> nothing placed, newer edit intact', jSt.status === 'succeeded' && jSt.output.attachment.status === 'proposed' && jSt.output.attachment.conflicts[0].entityId === dep && jSt.output.attachment.conflicts[0].currentVersion === edit.body.revision && tlS.tracks.flatMap((t: any) => t.clips).length === 1 && tlS.tracks.flatMap((t: any) => t.clips)[0].text === 'כותרת חדשה', jSt.output.attachment.conflicts);
  check('stale result: the output is kept as a derived asset the user can still place manually', !!docS.project.assets[jSt.output.attachment.assetId] && jSt.output.attachment.proposal.start.value === '90');
  const manual = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: jSt.output.attachment.assetId, start: T30(90), duration: T30(30) } }] });
  check('the proposed asset can be placed with the normal add_clip operation', manual.body.committed === true);
  await waitIdle();

  console.log('\n# cancellation and restart recovery (provider queue held busy by a harness-only blocker job)');
  // Harness-only: the proof talks to ComfyUI directly to occupy its single worker. Studio clients have no such route.
  // ~15 s of CPU work in ~100 MB (measured). The colour varies so ComfyUI's node cache cannot make it instant.
  const blocker = () => {
    const g: Record<string, any> = { '1': { class_type: 'EmptyImage', inputs: { width: 1024, height: 1024, batch_size: 4, color: Date.now() % 0xffffff } } };
    for (let i = 2; i < 8; i++) g[i] = { class_type: 'ImageBlur', inputs: { image: [String(i - 1), 0], blur_radius: 31, sigma: 10 } };
    g['9'] = { class_type: 'PreviewImage', inputs: { images: ['7', 0] } };
    return real.submit(g, `blocker-${Date.now()}`);
  };
  let b = await blocker();
  const hc = await historyCount();
  const c1 = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params });
  let cj: any;
  for (let i = 0; i < 100; i++) { cj = (await call(`/jobs/${c1.body.jobId}`)).body; if (/queued \(position/.test(cj.stage ?? '')) break; await sleep(50); }
  const sawQueued = /queued \(position/.test(cj.stage ?? '');
  const cancel = await call(`/jobs/${c1.body.jobId}/cancel`, {});
  cj = await waitJob(call, c1.body.jobId);
  check('cancel of a provider-queued job removes it from the queue and reports exactly that', sawQueued && cancel.body.outcome === 'removed-from-queue' && cj.status === 'canceled', { stageBefore: sawQueued ? 'queued' : cj.stage, outcome: cancel.body.outcome });
  check('cancelling our queued job did not interrupt the job that owned the worker', (await real.status(b.providerJobId)).state === 'running');
  const c2 = await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params });
  for (let i = 0; i < 100 && !(await call(`/jobs/${c2.body.jobId}`)).body.output?.providerJobId; i++) await sleep(50);
  const dataDir = s.cfg.dataDir;
  await s.close(); // server dies while its job is queued at the provider
  await real.cancel(b.providerJobId);
  s = await startServer({ port: PORT, dataDir, comfyuiUrl: COMFY });
  call = api(s);
  const rec = await waitJob(call, c2.body.jobId);
  await waitIdle();
  const ours = Object.values<any>(await comfy('/history?max_items=10000')).filter((v) => String(v.prompt?.[3]?.pulseframe_request ?? '').length === 36).length;
  check('restart: the known job is resumed from its stored provider id and completes, without a second submission', rec.status === 'succeeded' && rec.attempt === 1, { status: rec.status, attempt: rec.attempt, providerRunsOfOurs: ours, historyDelta: (await historyCount()) - hc });
  await s.close();

  console.log('\n# fault injection around the real provider (labelled: injected faults, real execution)');
  const wrap = (over: Partial<ProviderAdapter>): ProviderAdapter => Object.assign(Object.create(real), over);
  s = await boot({}, wrap({ collect: async (d, id) => (await real.collect(d, id)).map((o) => ({ ...o, bytes: o.bytes.subarray(0, 40) })) }));
  call = api(s);
  pid = (await call('/projects', { name: 'f' })).body.project.id;
  let fj = await waitJob(call, (await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params })).body.jobId);
  check('truncated output: job fails output_invalid, nothing is listed as a usable asset', fj.status === 'failed' && fj.error.code === 'output_invalid' && !fj.output?.bundle, fj.error);
  await s.close();
  s = await boot({}, wrap({ collect: async () => { throw new ProviderError('output_missing', 'declared output "image" produced no file'); } }));
  call = api(s);
  pid = (await call('/projects', { name: 'f' })).body.project.id;
  fj = await waitJob(call, (await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params })).body.jobId);
  check('missing output after a "successful" provider run: job fails, not succeeds', fj.status === 'failed' && fj.error.code === 'output_missing');
  await s.close();

  const hA = await historyCount();
  s = await boot({}, wrap({ submit: async (g, id) => { await real.submit(g, id); throw new ProviderError('provider_unreachable', 'response lost after the provider accepted the job (injected)', true); } }));
  call = api(s);
  pid = (await call('/projects', { name: 'f' })).body.project.id;
  fj = await waitJob(call, (await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params })).body.jobId);
  await waitIdle();
  check('ambiguous submission (accepted, response lost): reconciled by our request id, executed exactly once', fj.status === 'succeeded' && (await historyCount()) === hA + 1, { status: fj.status, providerRuns: (await historyCount()) - hA });
  await s.close();
  const hB = await historyCount();
  s = await boot({}, wrap({ submit: async () => { throw new ProviderError('provider_unreachable', 'connection reset before any response (injected)', true); } }));
  call = api(s);
  pid = (await call('/projects', { name: 'f' })).body.project.id;
  fj = await waitJob(call, (await call(`/projects/${pid}/capabilities/${SMOKE}/runs`, { params })).body.jobId);
  await sleep(500);
  check('ambiguous submission with no provider record: left visibly as submission-unknown, never blindly retried', fj.status === 'submission-unknown' && fj.attempt === 1 && (await historyCount()) === hB, fj.error);
  await s.close();

  const failed = checks.filter((c) => !c.ok);
  const report = {
    ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
    scope: 'Amendment A1 G0 on the model-free smoke workflow: provider path, attachment through operations and stale-result protection. No model, no GPU, no media-input workflow.',
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none' },
    provider: { url: COMFY, comfyui: ready.runtimeVersion, device: ready.device },
    measuredProfile: { capability: SMOKE, workload: '320x192 solid image, batch 1', stageSeconds: jRest.output.stageSeconds, peakDeviceMemoryBytes: null, note: 'CPU device: no device-memory measurement available' },
    checks,
  };
  fs.writeFileSync(path.join(root, 'docs/evidence/g0-smoke-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/g0-smoke-proof.json`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
