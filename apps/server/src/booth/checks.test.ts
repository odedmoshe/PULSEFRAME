/**
 * The server rows of «בדיקת המחשב» (wave 8 booth; verify C3). The services are LABELLED STAND-INS (test only) that answer with the
 * worst real strings a Windows laptop gives — a python path under C:\Users\<name>, a models folder, spawn errors, an IP address, a
 * software adapter whose description holds a path — and no row may carry any of it. ffmpeg, svg, library, kit and disk run for real.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_JOB_TYPE, BOOTH_CHECKS, BoothCheckRowSchema, MOMENTS_JOB_TYPE, STABILISE_JOB_TYPE, TRACKING_JOB_TYPE, type BoothCheckRow } from '@pulseframe/core';
import { loadConfig, type Config } from '../config.ts';
import type { Principal } from '../governance.ts';
import { IMPORT_JOB_TYPE } from '../importContracts.ts';
import { SEARCH_INDEX_JOB_TYPE } from '../search/contract.ts';
import { Store } from '../store.ts';
import { BOOTH_BUSY_ALSO, BOOTH_BUSY_JOB_TYPES, BOOTH_SERVER_CHECK_IDS, boothBusy, parseEncoders, rowText, runBoothCheck, safeText, type BoothCheckDeps } from './checks.ts';
import { BOOTH_BUSY_JOB_KINDS } from './contract.ts';

const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const PLANTED = ['dana', 'Users', 'C:', 'python', 'models', '192.168', 'ENOENT', 'OneDrive', 'sk-ant', 'example.com', '\\', '/'];
let dir: string, cfg: Config, store: Store;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-checks-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: null };
  store = new Store(dir);
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { vi.useRealTimers(); for (const j of store.db.prepare("SELECT id FROM jobs WHERE status = 'queued'").all() as { id: string }[]) store.updateJob(j.id, { status: 'canceled' }); });

/** LABELLED STAND-INS (test only), answering with the strings verify C3/C4 names. */
const standIns = (over: Partial<BoothCheckDeps> = {}): BoothCheckDeps => ({
  cfg, store, owner: OWNER, musicKits: undefined,
  renderHost: { identity: async () => ({ version: '131.0.6778.33', launch: 'window', adapter: 'google|swiftshader|0x0000|SwiftShader at C:\\Users\\dana\\AppData', softwareAdapter: true }) } as never,
  speech: { status: async () => ({
    transcription: { ready: false, reason: 'engine_not_configured', detail: 'spawn C:\\Users\\dana\\PULSEFRAME\\.venv\\Scripts\\python.exe ENOENT', device: null, qualification: 'x' },
    narration: { ready: false, reason: 'engine_not_configured', detail: 'C:/Users/dana/OneDrive - Cohen/models', device: null, qualification: 'x' },
    engine: { python: 'C:\\Users\\dana\\python.exe' }, modelsDir: 'C:\\Users\\dana\\models',
  }) } as never,
  assistant: { status: () => ({ setup: 'provider_not_configured', detail: 'C:\\Users\\dana', host: 'api.example.com', model: 'x', keySet: true, key: 'sk-ant-xxx', spentCents: 120, monthlyLimitCents: 500 }) },
  search: { setup: async () => ({ code: 'engine_not_configured', detail: 'spawn C:\\Users\\dana\\python.exe ENOENT', versions: { python: 'C:\\Users\\dana' } }) } as never,
  door: { addresses: () => [{ address: '192.168.1.23', netmask: '255.255.255.0', interfaceName: 'Wi-Fi dana', preferred: true }] } as never,
  probes: { ffmpegVersion: async () => 'ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024 the FFmpeg developers\nconfiguration: --prefix=/home/dana', encoders: async () => ' V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)\n A....D aac                  AAC (Advanced Audio Coding)\n', freeDisk: () => 40 * 2 ** 30 },
  ...over,
});

describe('every server row', () => {
  it('answers a BoothCheckRowSchema row with no planted path, user, host, address, key or money', async () => {
    const rows: BoothCheckRow[] = [];
    for (const id of BOOTH_SERVER_CHECK_IDS) rows.push(await runBoothCheck(id, standIns()));
    expect(rows.map((r) => r.id)).toEqual(BOOTH_CHECKS.filter((c) => c.side === 'server').map((c) => c.id));
    for (const r of rows) expect(BoothCheckRowSchema.safeParse(r).success).toBe(true);
    const text = JSON.stringify(rows);
    expect(PLANTED.filter((p) => text.toLowerCase().includes(p.toLowerCase()) && !(p === '/' && false))).toEqual([]);
    expect(text).not.toMatch(/spent|limit|cents|key/i);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    // here: a software adapter is never ok
    expect(by['export-gpu']).toMatchObject({ state: 'fail', code: 'software_adapter', data: { vendor: 'google', software: true, launch: 'window' } });
    expect(by.ffmpeg).toMatchObject({ state: 'ok', code: 'encoder_present', data: { version: 'ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024 the FFmpeg developers', h264_nvenc: true, hevc_nvenc: false, libx264: true, encoders: 3 } });
    expect(by.library).toMatchObject({ state: 'setup', code: 'not_configured', data: { state: 'not_configured', items: 0 } });
    expect(by.speech).toMatchObject({ state: 'setup', code: 'not_installed', data: { transcriptionReady: false, transcription: 'engine_not_configured' } });
    expect(by.assistant).toEqual({ id: 'assistant', state: 'setup', code: 'not_installed', data: { setup: 'provider_not_configured' } });
    expect(by.search).toMatchObject({ state: 'setup', code: 'not_installed', data: { setup: 'engine_not_configured' } });
    expect(by.disk).toMatchObject({ state: 'ok', code: null, data: { freeGiB: 40 } });
    expect(by.drop).toEqual({ id: 'drop', state: 'ok', code: 'can_open', data: { addresses: 1 } });
    expect(['setup', 'off', 'ok']).toContain(by.kit!.state);
  });
  it('the real ffmpeg, svg and disk of this container answer too (one sample each)', async () => {
    const d = standIns({ probes: {} });
    const f = await runBoothCheck('ffmpeg', d);
    expect(f.data.version).toMatch(/^ffmpeg version /);
    expect(typeof f.data.h264_nvenc).toBe('boolean'); // presence in the build only; never tried
    expect(['ok', 'off']).toContain((await runBoothCheck('svg', d)).state);
    expect(['ok', 'setup']).toContain((await runBoothCheck('disk', d)).state);
  });
  it('export-gpu: no render host is off; a hardware adapter is ok; no device is fail; a search past 160 s is unknown «searching»', async () => {
    expect(await runBoothCheck('export-gpu', standIns({ renderHost: null }))).toMatchObject({ state: 'off', code: 'no_render_host' });
    expect(await runBoothCheck('export-gpu', standIns({ renderHost: { identity: async () => ({ version: '131', launch: 'window', adapter: 'nvidia|ampere|0x25a2|NVIDIA GeForce RTX 3050 Laptop GPU', softwareAdapter: false }) } as never })))
      .toMatchObject({ state: 'ok', data: { vendor: 'nvidia', architecture: 'ampere', adapter: 'nvidia|ampere|0x25a2|NVIDIA GeForce RTX 3050 Laptop GPU' } });
    expect(await runBoothCheck('export-gpu', standIns({ renderHost: { identity: async () => ({ version: '131', launch: 'auto', adapter: null, softwareAdapter: false }) } as never }))).toMatchObject({ state: 'fail', code: 'no_gpu_device' });
    vi.useFakeTimers();
    const p = runBoothCheck('export-gpu', standIns({ renderHost: { identity: () => new Promise(() => {}) } as never }));
    await vi.advanceTimersByTimeAsync(160_001);
    expect(await p).toMatchObject({ state: 'unknown', code: 'searching' });
  });
  it('a throwing service is fail with code error, never its message; low disk is setup «low»; no door is cannot_open', async () => {
    const r = await runBoothCheck('speech', standIns({ speech: { status: async () => { throw new Error('C:\\Users\\dana\\x ENOENT'); } } as never }));
    expect(r).toEqual({ id: 'speech', state: 'fail', code: 'error', data: {} });
    expect(await runBoothCheck('disk', standIns({ probes: { freeDisk: () => 2 ** 30 } }))).toMatchObject({ state: 'setup', code: 'low' });
    expect(await runBoothCheck('disk', standIns({ probes: { freeDisk: () => null } }))).toMatchObject({ state: 'unknown', code: 'not_measured' });
    expect(await runBoothCheck('drop', standIns({ door: null }))).toMatchObject({ state: 'off', code: 'cannot_open' });
    expect(await runBoothCheck('ffmpeg', standIns({ probes: { ffmpegVersion: async () => { throw new Error('x'); } } }))).toMatchObject({ state: 'off', code: 'not_installed' });
  });
});

describe('the heavy rule (verify C3)', () => {
  it('export-gpu, speech and search answer skipped while an export (or another busy job) is queued; light rows still run', async () => {
    let called = 0;
    const d = standIns({ renderHost: { identity: async () => { called++; return { version: '1', launch: 'auto', adapter: null, softwareAdapter: false }; } } as never });
    expect(boothBusy(store)).toBe(false);
    const job = store.createJob('prj_x', 'export', 'user:local', {});
    expect(boothBusy(store)).toBe(true);
    for (const id of ['export-gpu', 'speech', 'search'] as const) expect(await runBoothCheck(id, d)).toEqual({ id, state: 'skipped', code: 'busy', data: {} });
    expect(called).toBe(0); // the GPU search was not started
    expect((await runBoothCheck('disk', d)).state).toBe('ok');
    store.updateJob(job.id, { status: 'running' });
    expect(boothBusy(store)).toBe(true);
    store.updateJob(job.id, { status: 'succeeded' });
    expect(boothBusy(store)).toBe(false);
    for (const type of [...Object.values(BOOTH_BUSY_JOB_TYPES).flat(), ...BOOTH_BUSY_ALSO]) {
      const j = store.createJob('prj_x', type, 'user:local', {});
      expect({ type, busy: boothBusy(store) }).toEqual({ type, busy: true });
      store.updateJob(j.id, { status: 'canceled' });
    }
    expect(boothBusy(store)).toBe(false);
  });
  it('BOOTH_BUSY_JOB_TYPES covers every kind and names the type strings the code really writes', () => {
    expect(Object.keys(BOOTH_BUSY_JOB_TYPES).sort()).toEqual([...BOOTH_BUSY_JOB_KINDS].sort());
    const src = (f: string) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    expect(src('export.ts')).toContain("createJob(projectId, 'export',");
    expect(src('browser-export.ts')).toContain("createJob(projectId, 'export',");
    expect(src('http.ts')).toContain("createJob(projectId, 'analysis',");
    expect(src('speech.ts')).toContain("const DOWNLOAD = 'speech-model-download', TRANSCRIBE = 'transcribe', NARRATE = 'narration';");
    expect([SEARCH_INDEX_JOB_TYPE, MOMENTS_JOB_TYPE, IMPORT_JOB_TYPE]).toEqual(BOOTH_BUSY_JOB_TYPES.scan);
    expect(BOOTH_BUSY_ALSO).toEqual(['capability', ASSISTANT_JOB_TYPE, TRACKING_JOB_TYPE, STABILISE_JOB_TYPE]);
    expect(src('capabilities.ts')).toContain("const TYPE = 'capability';");
    expect(BOOTH_BUSY_JOB_TYPES['music-fit']).toEqual([]); // not a job: a running music render counts instead (musicQueue)
  });
});

describe('helpers', () => {
  it('safeText removes paths, e-mail and this machine\'s names whole; keeps a version line', () => {
    expect(safeText('SwiftShader at C:\\Users\\dana\\AppData and //nas/x on DANA-PC by dana@x.y', ['dana', 'DANA-PC'])).toBe('SwiftShader at and on by');
    expect(safeText('ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024', [])).toBe('ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024');
  });
  it('rowText keeps the allowed characters only; parseEncoders reads the -encoders table', () => {
    expect(rowText('spawn C:\\Users\\dana\\x.exe: ENOENT')).toBe('spawn C Users dana x.exe ENOENT');
    expect(rowText('a@b.c ~x /y')).toBe('a b.c x y');
    expect([...parseEncoders('Encoders:\n V..... = Video\n ------\n V....D libx264  x\n A....D aac  y\n')]).toEqual(['libx264', 'aac']);
  });
});
