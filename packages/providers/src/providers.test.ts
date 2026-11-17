import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_CAPABILITIES, CapabilityError, ComfyUIAdapter, graphDigest, importComfyWorkflow, ImportError, ProviderError, publicationBlockers, resolveGraph, SMOKE_SOLID_IMAGE, IMAGE_UPSCALE, IMAGE_UPSCALE_4X, VIDEO_SMOOTH_SLOWMO, type CapabilityDescriptor } from './index.ts';

const tmpDirs: string[] = [];
afterAll(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const codes = (d: CapabilityDescriptor, profile: 'commercial' | 'research' = 'commercial') => publicationBlockers(d, profile).map((b) => b.code);
const thrown = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e.code as string; } return 'ok'; };
const withFlags = <D extends CapabilityDescriptor>(d: D): D => ({ ...d, qualification: Object.fromEntries(Object.keys(d.qualification).map((k) => [k, { status: 'pass' }])) as any });

// A graph shaped like a typical model workflow, including a custom node and a URL.
const modelGraph = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'some_model.safetensors' } },
  '5': { class_type: 'LoraLoader', inputs: { lora_name: 'cameraman_v2.safetensors', strength_model: 0.8, model: ['4', 0], clip: ['4', 1] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a prompt', clip: ['5', 1] } },
  '7': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7.5, model: ['5', 0], positive: ['6', 0] } },
  '8': { class_type: 'LoadImage', inputs: { image: 'input.png' } },
  '9': { class_type: 'SomeCustomDownloader', inputs: { url: 'https://example.com/weights.bin' } },
  '10': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'out' } },
};

describe('workflow import (FF-03)', () => {
  it('always yields a draft; unknown models, unreviewed controls, unknown nodes and URLs block publication', () => {
    const { draft, blockers, findings } = importComfyWorkflow(modelGraph, { id: 'imported.test-flow', title: 'Test' });
    expect(draft.state).toBe('draft');
    expect(draft.models.map((m) => m.path)).toEqual(['some_model.safetensors', 'cameraman_v2.safetensors', 'https://example.com/weights.bin']);
    expect(draft.models.every((m) => m.sha256 === null && m.commercialUse === 'unknown')).toBe(true);
    expect(draft.inputs.find((i) => i.binding?.input === 'seed')?.type).toBe('seed');
    expect(draft.inputs.find((i) => i.binding?.nodeId === '8')?.type).toBe('image');
    expect(draft.outputs.map((o) => o.nodeId)).toEqual(['10']);
    expect(draft.egress).toBe('graph-defined');
    const c = new Set(blockers.map((b) => b.code));
    for (const need of ['unresolved_model', 'model_license_unknown', 'model_not_commercially_eligible', 'unreviewed_control', 'unbounded_control', 'unreviewed_output', 'unknown_node_pack', 'graph_defined_egress', 'not_executed', 'not_licenseReviewed', 'not_qualityReviewed', 'not_hardwareQualified'])
      expect(c.has(need), need).toBe(true);
    expect(blockers.every((b) => b.message.length > 10)).toBe(true); // actionable text, not just codes
    expect(findings.some((f) => /URL/.test(f))).toBe(true);
    expect(draft.qualification.schemaValid.status).toBe('pass'); // parsing proves only this one dimension
  });
  it('import is pure: no network access, even for a graph full of URLs', () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error('network used during import'); }) as any;
    try { importComfyWorkflow(modelGraph, { id: 'imported.pure', title: 'x' }); } finally { globalThis.fetch = real; }
    expect(calls).toBe(0);
  });
  it('rejects non-graphs, UI-format exports and dangling links with actionable errors', () => {
    expect(thrown(() => importComfyWorkflow({ nodes: [], links: [] }, { id: 'a.b', title: 't' }))).toBe('ui_format_not_supported');
    expect(thrown(() => importComfyWorkflow('nope', { id: 'a.b', title: 't' }))).toBe('not_a_comfy_graph');
    expect(thrown(() => importComfyWorkflow({ '1': { class_type: 'SaveImage', inputs: { images: ['99', 0] } } }, { id: 'a.b', title: 't' }))).toBe('dangling_link');
    expect(new ImportError('x', 'y')).toBeInstanceOf(Error);
  });
});

describe('qualification and licensing (FF-04, §8 of the addendum)', () => {
  it('the built-in smoke capability is blocked only by evidence that needs a real run', () => {
    expect(codes(SMOKE_SOLID_IMAGE).sort()).toEqual(['not_executed', 'not_hardwareQualified']);
  });
  it('a research-only model excludes the workflow from the commercial profile even when everything else passes', () => {
    const d = withFlags({ ...SMOKE_SOLID_IMAGE, id: 'test.camera-copy', models: [{ role: 'lora', path: 'cameraman_v2.safetensors', publisher: 'Cseti', revision: 'abc', sha256: 'a'.repeat(64), bytes: 1000, license: 'research-only', licenseEvidence: 'publisher model card', commercialUse: 'prohibited', gated: false, source: null, attribution: null }] });
    expect(codes(d, 'commercial')).toEqual(['model_not_commercially_eligible']);
    expect(codes(d, 'research')).toEqual([]);
  });
  it('a size or a file name is not integrity: a model without a digest stays unresolved', () => {
    const d = withFlags({ ...SMOKE_SOLID_IMAGE, models: [{ role: 'ckpt', path: 'm.safetensors', publisher: 'p', revision: 'r', sha256: null, bytes: 123, license: 'x', licenseEvidence: 'y', commercialUse: 'allowed', gated: false, source: null, attribution: null }] });
    expect(codes(d)).toEqual(['unresolved_model']);
  });
  it('editing a reviewed graph invalidates its digest', () => {
    const d = withFlags(structuredClone(SMOKE_SOLID_IMAGE));
    d.graph['1']!.inputs.batch_size = 64;
    expect(codes(d)).toContain('graph_digest_mismatch');
    expect(graphDigest({ a: { class_type: 'X', inputs: { p: 1, q: 2 } } })).toBe(graphDigest({ a: { inputs: { q: 2, p: 1 }, class_type: 'X' } }));
  });
});

describe('parameter resolution', () => {
  it('writes only reviewed, bounded parameters into a private copy of the graph', () => {
    const { graph, resolved } = resolveGraph(SMOKE_SOLID_IMAGE, { width: 320, color: 255 });
    expect(graph['1']!.inputs).toMatchObject({ width: 320, height: 256, color: 255, batch_size: 1 });
    expect(resolved).toEqual({ width: 320, height: 256, color: 255 });
    expect(SMOKE_SOLID_IMAGE.graph['1']!.inputs.width).toBe(256);
  });
  it('rejects out-of-range, wrong-type and unknown parameters', () => {
    for (const [p, code] of [[{ width: 99999 }, 'invalid_parameter'], [{ width: 1.5 }, 'invalid_parameter'], [{ width: '64' }, 'invalid_parameter'], [{ batch_size: 64 }, 'unknown_parameter'], [{ class_type: 'Evil' }, 'unknown_parameter']] as const)
      expect(thrown(() => resolveGraph(SMOKE_SOLID_IMAGE, p as any))).toBe(code);
    expect(new CapabilityError('a', 'b')).toBeInstanceOf(Error);
  });
});

describe('ComfyUI adapter policy', () => {
  it('refuses non-loopback hosts unless remote execution is explicitly enabled', () => {
    expect(thrown(() => new ComfyUIAdapter('http://gpu.example.com:8188'))).toBe('remote_provider_not_allowed');
    expect(thrown(() => new ComfyUIAdapter('file:///etc/passwd'))).toBe('bad_provider_url');
    expect(thrown(() => new ComfyUIAdapter('http://127.0.0.1:8188'))).toBe('ok');
    expect(thrown(() => new ComfyUIAdapter('https://gpu.example.com', { allowRemote: true }))).toBe('ok');
  });
  it('a transport failure on submit is flagged ambiguous; an unreachable provider probes as not ready without throwing', async () => {
    const a = new ComfyUIAdapter('http://127.0.0.1:8188', { fetch: (async () => { throw new Error('ECONNRESET'); }) as any });
    const e = await a.submit({}, 'req1').catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.ambiguous).toBe(true);
    const r = await a.probe(SMOKE_SOLID_IMAGE);
    expect(r).toMatchObject({ reachable: false, wokeWorker: false });
    expect(r.problems.length).toBe(1);
  });
});

describe('comfy.image.upscale-4x is replaced by comfy.image.upscale 0.2.0', () => {
  it('the registry lists the new descriptor once and not the old id; the old export name is an alias of the new descriptor', () => {
    expect(BUILTIN_CAPABILITIES.map((d) => d.id)).not.toContain('comfy.image.upscale-4x');
    expect(BUILTIN_CAPABILITIES.filter((d) => d.id === 'comfy.image.upscale')).toEqual([IMAGE_UPSCALE]);
    expect(IMAGE_UPSCALE_4X).toBe(IMAGE_UPSCALE);
  });
});

/**
 * The ComfyUI adapter's transfer path (ADR-0017). The provider is a LABELLED FAKE `fetch` in this process: it answers the few ComfyUI
 * routes the adapter calls (/history, /view, /queue) from memory. No ComfyUI runs and no network is used.
 */
describe('ComfyUI adapter transfers (labelled fake fetch, no ComfyUI)', () => {
  const frames = [Buffer.alloc(300_000, 7), Buffer.from('second frame'), Buffer.alloc(64, 1)];
  const history = { p1: { status: { completed: true }, outputs: { '5': { images: frames.map((_, i) => ({ filename: `ComfyUI_temp_${i}.png`, subfolder: '', type: 'temp' })), animated: [false] } } } };
  const fakeFetch = (opts: { stall?: boolean; lie?: boolean } = {}) => (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/history/')) return Response.json(history);
    if (u.pathname === '/queue') return Response.json({ queue_running: [[1, 'p9', {}, { pulseframe_request: 'base:0' }, []], [2, 'p8', {}, { client_id: 'someone' }, []]], queue_pending: [] });
    if (u.pathname === '/view') {
      const i = Number(/_(\d+)\.png$/.exec(u.searchParams.get('filename')!)![1]);
      const body = frames[i]!;
      if (opts.stall) {
        // sends the first bytes, then nothing: the allowance (base + bytes / rate) must end the transfer
        const stream = new ReadableStream({ start(c) { c.enqueue(body.subarray(0, 10)); init?.signal?.addEventListener('abort', () => c.error(new Error('aborted'))); } });
        return new Response(stream, { headers: { 'content-length': String(body.length) } });
      }
      return new Response(body, { headers: { 'content-length': String(opts.lie ? body.length + 5 : body.length) } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  const outDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-comfy-collect-')); tmpDirs.push(d); return d; };
  it('collect streams every file of the declared output into destDir, in the provider\'s order, with exact bytes and sha256', async () => {
    const a = new ComfyUIAdapter('http://127.0.0.1:8188', { fetch: fakeFetch() });
    const dir = outDir();
    const out = await a.collect(VIDEO_SMOOTH_SLOWMO, 'p1', dir);
    expect(out.map((o) => o.fileName)).toEqual(['ComfyUI_temp_0.png', 'ComfyUI_temp_1.png', 'ComfyUI_temp_2.png']);
    for (const [i, o] of out.entries()) {
      expect(path.dirname(o.path)).toBe(dir);
      expect(o.bytes).toBe(frames[i]!.length);
      expect(o.sha256).toBe(createHash('sha256').update(frames[i]!).digest('hex'));
      expect(fs.readFileSync(o.path).equals(frames[i]!)).toBe(true);
      expect(o).toMatchObject({ name: 'video', role: 'primary', mediaType: 'video' });
    }
  });
  it('a transfer that stalls ends within base + bytes / rate as output_missing and leaves no partial file', async () => {
    const a = new ComfyUIAdapter('http://127.0.0.1:8188', { fetch: fakeFetch({ stall: true }), timeouts: { baseMs: 150, bytesPerSecond: 10_000_000 } });
    expect(a.transferTimeoutMs(300_000)).toBe(180);
    const dir = outDir();
    const t0 = Date.now();
    const e = await a.collect(VIDEO_SMOOTH_SLOWMO, 'p1', dir).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('output_missing');
    expect(e.message).toMatch(/time allowance/);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it('a body shorter than its stated length is output_missing, never a silently truncated file', async () => {
    const a = new ComfyUIAdapter('http://127.0.0.1:8188', { fetch: fakeFetch({ lie: true }) });
    const e = await a.collect(VIDEO_SMOOTH_SLOWMO, 'p1', outDir()).catch((x) => x);
    expect(e).toMatchObject({ code: 'output_missing' });
  });
  it('the default allowance is 15 s plus 1 s per 20 MB, for stage and /view alike', () => {
    const a = new ComfyUIAdapter('http://127.0.0.1:8188');
    expect(a.transferTimeoutMs(0)).toBe(15_000);
    expect(a.transferTimeoutMs(200_000_000)).toBe(25_000);
  });
  it('running() lists the running prompts with the request id we stored (null for prompts that are not ours)', async () => {
    const a = new ComfyUIAdapter('http://127.0.0.1:8188', { fetch: fakeFetch() });
    expect(await a.running()).toEqual([{ promptId: 'p9', clientRequestId: 'base:0' }, { promptId: 'p8', clientRequestId: null }]);
  });
});
