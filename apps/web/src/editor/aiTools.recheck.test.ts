import { describe, expect, it } from 'vitest';
import { ApiFailure, type JobEvent } from '../api.ts';
import { cardJob, failureOf, providerAfter, recheckProvider, rememberJob } from './aiTools.recheck.ts';

const notConfigured = { provider: { configured: false, reason: 'PF_COMFYUI_URL is not set', readiness: null }, capabilities: [] };
const unreachable = { provider: { configured: true, reason: null, readiness: { reachable: false } }, capabilities: [] };
const ready = { provider: { configured: true, reason: null, readiness: { reachable: true } }, capabilities: [{ id: 'x' }] };

describe('check again in the AI tools panel', () => {
  it('a failed check keeps what the panel shows: the provider state is not cleared', async () => {
    const boom = new Error('Failed to fetch');
    const r = await recheckProvider<typeof notConfigured>(() => Promise.reject(boom));
    expect(r).toEqual({ ok: false, error: boom });
    expect(providerAfter(notConfigured, r)).toBe(notConfigured); // the same object: setup steps, message and button stay
    expect(providerAfter(notConfigured, r)).not.toBeNull();
  });
  it('a check that throws before any request is also a failed check, not a crash', async () => {
    const r = await recheckProvider<typeof notConfigured>(async () => { throw new Error('authentication required'); });
    expect(r.ok).toBe(false);
  });
  it('an answered check replaces the provider state and says whether the provider is connected', async () => {
    const still = await recheckProvider(async () => unreachable);
    expect(still).toEqual({ ok: true, provider: unreachable, connected: false });
    expect(providerAfter(notConfigured as typeof unreachable | typeof notConfigured, still)).toBe(unreachable);
    const none = await recheckProvider(async () => notConfigured);
    expect(none.ok && none.connected).toBe(false);
    const ok = await recheckProvider(async () => ready);
    expect(ok).toEqual({ ok: true, provider: ready, connected: true });
  });
});

const ev = (id: string, status: string, stage: string | null = null): JobEvent => ({ id, type: 'capability', status, stage, output: null, error: null });

describe('the job a tool card shows', () => {
  it('the connection test shows only the job its own button started: another tool\'s job, or an agent\'s, is not shown on it', () => {
    let jobs: Record<string, JobEvent> = {};
    const started: Record<string, string> = {};
    // an agent runs a picture tool: before, the connection-test card showed that job as its own
    jobs = rememberJob(jobs, ev('job_agent', 'running', 'sampling'));
    expect(cardJob('comfy.smoke.solid-image', started, jobs)).toBeNull();
    // the connection test is started here, then the agent's job moves on: each card keeps its own job
    started['comfy.smoke.solid-image'] = 'job_smoke';
    jobs = rememberJob(jobs, ev('job_smoke', 'queued'));
    jobs = rememberJob(jobs, ev('job_agent', 'succeeded'));
    expect(cardJob('comfy.smoke.solid-image', started, jobs)).toEqual(ev('job_smoke', 'queued'));
    expect(cardJob('comfy.upscale', started, jobs)).toBeNull();
    // the end of the connection test arrives together with another job's event: neither is lost
    jobs = rememberJob(rememberJob(jobs, ev('job_smoke', 'succeeded')), ev('job_other', 'running'));
    expect(cardJob('comfy.smoke.solid-image', started, jobs)?.status).toBe('succeeded');
    // a tool started here, whose job event has not come in yet, shows nothing invented
    started['comfy.upscale'] = 'job_up';
    expect(cardJob('comfy.upscale', started, jobs)).toBeNull();
  });

  it('keeps the latest event per job and only the newest jobs', () => {
    let jobs: Record<string, JobEvent> = {};
    for (let i = 0; i < 40; i++) jobs = rememberJob(jobs, ev(`j${i}`, 'queued'));
    jobs = rememberJob(jobs, ev('j15', 'running'));
    expect(Object.keys(jobs).length).toBe(30);
    expect(jobs.j15?.status).toBe('running');
    expect(Object.keys(jobs).at(-1)).toBe('j15'); // the newest event is the newest entry
    expect(jobs.j0).toBeUndefined();
  });
});

describe('the first request for the AI tools fails', () => {
  it('what failed is kept as the server said it, or as no answer', () => {
    expect(failureOf(new ApiFailure(401, 'unauthenticated', 'authentication required'))).toEqual({ code: 'unauthenticated', message: 'authentication required' });
    expect(failureOf(new TypeError('Failed to fetch'))).toEqual({ code: null, message: 'Failed to fetch' });
    expect(failureOf('down')).toEqual({ code: null, message: 'down' });
  });
});
