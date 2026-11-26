/** Builder W2: the browser rows (verify C3 rows 1, 2, 7). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BOOTH_CHECKS, BoothCheckRowSchema, BOOTH_LIMITS, BOOTH_ASCII } from '@pulseframe/core';
import { adapterString, asciiText, codecsRow, gpuRow, micRow, runBrowserCheckWith, timeoutOf, type BrowserCheckEnv } from './browserChecks.ts';
import { adapterReport, type AdapterLike, type GpuLike } from '../../../gpuProbe.logic.ts';

const info = (o: Partial<NonNullable<AdapterLike['info']>>): AdapterLike => ({ info: { vendor: '', architecture: '', device: '', description: '', ...o }, features: ['b', 'a'], limits: { maxTextureDimension2D: 8192, maxBufferSize: 1, maxColorAttachments: 8 } });
const gpuOf = (a: AdapterLike | null | Error): GpuLike => ({ requestAdapter: async () => { if (a instanceof Error) throw a; return a; }, getPreferredCanvasFormat: () => 'bgra8unorm' });
const never = new AbortController().signal;

describe('browser rows (builder W2)', () => {
  it('browser-gpu: a hardware adapter is ok with data.adapter ASCII and data.discrete true only for a discrete vendor; a fallback adapter is setup with code software_adapter; Intel integrated is ok with code integrated (L1 order "other")', async () => {
    const nv = await gpuRow({ gpu: gpuOf(info({ vendor: 'nvidia', architecture: 'ampere', device: '', description: 'NVIDIA GeForce RTX 3050 Laptop GPU' })) });
    expect(nv).toMatchObject({ state: 'ok', code: null, data: { software: false, discrete: true, vendor: 'nvidia', architecture: 'ampere' } });
    expect(nv.data.adapter).toBe('nvidia|ampere||NVIDIA GeForce RTX 3050 Laptop GPU');
    const intel = await gpuRow({ gpu: gpuOf(info({ vendor: 'intel', architecture: 'gen-12lp', description: 'Intel(R) UHD Graphics' })) });
    expect(intel).toMatchObject({ state: 'ok', code: 'integrated', data: { discrete: false, software: false } });
    const soft = await gpuRow({ gpu: gpuOf({ ...info({ vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader driver' }), isFallbackAdapter: true }) });
    expect(soft).toMatchObject({ state: 'setup', code: 'software_adapter', data: { software: true, discrete: false } });
    // an NVIDIA-named software path is still software, never discrete
    expect((await gpuRow({ gpu: gpuOf({ ...info({ vendor: 'nvidia' }), isFallbackAdapter: true }) })).data.discrete).toBe(false);
    // no API, no adapter, a throwing browser: honest states, not fabricated ones
    expect((await gpuRow({})).state).toBe('off');
    expect((await gpuRow({ gpu: gpuOf(null) })).state).toBe('off');
    expect((await gpuRow({ gpu: gpuOf(new Error('boom')) })).state).toBe('fail');
  });
  it('browser-gpu: the adapter string is printable ASCII within the row and answer limits, whatever the driver reports', async () => {
    const odd = info({ vendor: 'מוזר\u202e', architecture: 'a\nb', device: 'x'.repeat(500), description: 'C:\\Users\\someone\\gpu' });
    const row = await runBrowserCheckWith({ gpu: gpuOf(odd) }, 'browser-gpu', never);
    expect(BoothCheckRowSchema.safeParse(row).success).toBe(true);
    const adapter = String(row.data.adapter);
    expect(BOOTH_ASCII.test(adapter)).toBe(true);
    expect(adapter.length).toBeLessThanOrEqual(120);
    expect(adapter.length).toBeLessThanOrEqual(BOOTH_LIMITS.adapterChars);
    expect(asciiText('שלום')).toBe('____');
    expect(adapterString({ vendor: null, architecture: null, device: null, description: null })).toBe('|||');
  });
  it('browser-gpu: no timing sample runs and gpu.html still shows what it showed (gpuProbe.ts reduced to the page, gpuProbe.logic.ts shared)', async () => {
    // the shared part has the keys and the order gpu.html's webgpu object always began with, and takes no timing
    const rep = await adapterReport(gpuOf(info({ vendor: 'intel' })));
    expect(Object.keys(rep)).toEqual(['api', 'preferredCanvasFormat', 'highPerformance', 'lowPower']);
    expect(rep.preferredCanvasFormat).toBe('bgra8unorm');
    expect(Object.keys(rep.highPerformance as object)).toEqual(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter', 'features', 'limits']);
    expect((rep.highPerformance as { features: string[] }).features).toEqual(['a', 'b']);
    expect(await adapterReport(undefined)).toEqual({ api: false });
    // the row's source has no timing sample, no device and no DOM; the page still has its sample and its own side effects
    const logic = readFileSync(new URL('../../../gpuProbe.logic.ts', import.meta.url), 'utf8');
    const rows = readFileSync(new URL('./browserChecks.ts', import.meta.url), 'utf8');
    for (const src of [logic, rows]) { expect(src).not.toMatch(/requestDevice|oneTimingSample|performance\.now|document\.|getUserMedia\(/); }
    const page = readFileSync(new URL('../../../gpuProbe.ts', import.meta.url), 'utf8');
    expect(page).toMatch(/oneTimingSample/);
    expect(page).toMatch(/from '\.\/gpuProbe\.logic\.ts'/);
    expect(page).not.toMatch(/const describe = async/);
  });
  it('browser-codecs: states only for H.264/HEVC/AV1 encode and decode and AAC encode; no speed claim', async () => {
    const ok = (hw: boolean, plain: boolean) => ({ isConfigSupported: async (c: Record<string, unknown>) => ({ supported: c.hardwareAcceleration === 'prefer-hardware' ? hw : plain }) });
    const env: BrowserCheckEnv = { VideoEncoder: ok(true, true), VideoDecoder: ok(false, true), AudioEncoder: ok(false, true) };
    const row = await codecsRow(env);
    expect(row.state).toBe('ok');
    expect(Object.keys(row.data).sort()).toEqual(['aacEncode', 'av1Decode', 'av1Encode', 'h264Decode', 'h264Encode', 'hevcDecode', 'hevcEncode', 'webcodecs']);
    expect(row.data.h264Encode).toBe('hardware');
    expect(row.data.h264Decode).toBe('software');
    expect(row.data.aacEncode).toBe('yes');
    expect(Object.keys(row.data).some((k) => /ms|fps|speed|time/i.test(k))).toBe(false);
    expect((await codecsRow({ VideoEncoder: ok(false, false), VideoDecoder: ok(false, false) })).data.av1Encode).toBe('none');
    expect(await codecsRow({})).toMatchObject({ state: 'off', data: { webcodecs: false } });
    // a browser that throws on a configuration says "none" for it, never throws out of the row
    const throws = { isConfigSupported: async () => { throw new Error('x'); } };
    expect((await codecsRow({ VideoEncoder: throws, VideoDecoder: throws })).data.h264Encode).toBe('none');
  });
  it('mic: permissions.query state granted/prompt/denied → ok/setup/off; never calls getUserMedia; an unsupported query is unknown', async () => {
    let asked = 0;
    const perm = (state: string) => ({ query: async (d: { name: string }) => { expect(d.name).toBe('microphone'); asked++; return { state }; } });
    expect(await micRow({ permissions: perm('granted') })).toMatchObject({ state: 'ok', code: 'granted' });
    expect(await micRow({ permissions: perm('prompt') })).toMatchObject({ state: 'setup', code: 'prompt' });
    expect(await micRow({ permissions: perm('denied') })).toMatchObject({ state: 'off', code: 'denied' });
    expect(asked).toBe(3);
    expect((await micRow({})).state).toBe('unknown');
    expect((await micRow({ permissions: { query: async () => { throw new TypeError('microphone is not a valid name'); } } })).state).toBe('unknown');
    expect((await micRow({ permissions: perm('weird') })).state).toBe('unknown');
    // the file never reaches for the microphone itself (comments aside)
    const src = readFileSync(new URL('./browserChecks.ts', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/getUserMedia|mediaDevices/);
  });
  it('every row parses with core BoothCheckRowSchema and a row that exceeds its timeout is unknown', async () => {
    const env: BrowserCheckEnv = { gpu: gpuOf(info({ vendor: 'amd', description: 'AMD Radeon' })), permissions: { query: async () => ({ state: 'granted' }) }, VideoEncoder: { isConfigSupported: async () => ({ supported: true }) }, VideoDecoder: { isConfigSupported: async () => ({ supported: true }) } };
    for (const id of ['browser-gpu', 'browser-codecs', 'mic'] as const) {
      const row = await runBrowserCheckWith(env, id, never);
      expect(row.id).toBe(id);
      expect(BoothCheckRowSchema.safeParse(row).success).toBe(true);
    }
    // the timeouts are the registry's
    for (const id of ['browser-gpu', 'browser-codecs', 'mic'] as const) expect(timeoutOf(id)).toBe(BOOTH_CHECKS.find((c) => c.id === id)!.timeoutMs);
    // a browser that never answers: unknown after the timeout, and the same for an abort
    const hang: BrowserCheckEnv = { permissions: { query: () => new Promise(() => undefined) }, gpu: { requestAdapter: () => new Promise(() => undefined) } };
    expect(await runBrowserCheckWith(hang, 'mic', never, 20)).toEqual({ id: 'mic', state: 'unknown', code: null, data: {} });
    expect((await runBrowserCheckWith(hang, 'browser-gpu', never, 20)).state).toBe('unknown');
    const ac = new AbortController(); const p = runBrowserCheckWith(hang, 'mic', ac.signal, 60_000); ac.abort();
    expect((await p).state).toBe('unknown');
    ac.abort();
    expect((await runBrowserCheckWith(hang, 'mic', ac.signal, 60_000)).state).toBe('unknown');
    // a row that throws is a failure row, never an exception
    const boom: BrowserCheckEnv = { get gpu(): GpuLike { throw new Error('x'); } };
    expect((await runBrowserCheckWith(boom, 'browser-gpu', never)).state).toBe('fail');
  });
});
