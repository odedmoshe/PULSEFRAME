import { describe, expect, it } from 'vitest';
import { ApiFailure, type JobEvent } from '../api.ts';
import { cardJob, failureOf, providerAfter, recheckProvider, rememberJob } from './aiTools.recheck.ts';
import fs from 'node:fs';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, sha256Hex, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { SETUP_CODES } from '../../../server/src/aiContracts.ts';
import { AI_STRINGS } from './aiTools.strings.ts';
import { cancelMeaning, compareStep, compareTimes, openItems, placeAnywayOps, progressOf, readingLimitFor, reviewRows, runSourceOf, runsOnCpu, setupOf, tabOf } from './aiTools.recheck.ts';

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

// ---------------------------------------------------------------------------------------------------------------------------------
// AI-model wave (ADR-0017): the pure parts of the panel, the run sheet, the compare slider and the translation review.
// ---------------------------------------------------------------------------------------------------------------------------------

describe('strings: every setup state and every publication blocker has Hebrew and English wording (ADR-0017)', () => {
  it('each SetupCode has a headline (i18n) and its steps (panel), in both languages', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const code of SETUP_CODES) {
        expect((dictionaries[lang] as Record<string, string>)[`ai.setup.${code}`], `${lang} ai.setup.${code}`).toBeTruthy();
        const steps = AI_STRINGS[lang].setupSteps[code]('PF_TOOLS_PYTHON');
        expect(Array.isArray(steps), `${lang} steps ${code}`).toBe(true);
        if (code !== 'ready') expect(steps.length, `${lang} steps ${code}`).toBeGreaterThan(0);
      }
      expect(Object.keys(AI_STRINGS[lang].setupSteps).sort()).toEqual([...SETUP_CODES].sort());
    }
    // the steps name what to set: the hosts that are missing, the engine variable
    expect(AI_STRINGS.he.setupSteps.host_not_allowed('raw.githubusercontent.com').join(' ')).toContain('raw.githubusercontent.com');
    expect(AI_STRINGS.en.setupSteps.engine_not_configured('PF_DENOISE_BIN').join(' ')).toContain('PF_DENOISE_BIN');
  });
  it('each code publicationBlockers can emit (read from descriptor.ts) has wording in both languages, and the two languages have the same keys', () => {
    const src = fs.readFileSync(new URL('../../../../packages/providers/src/descriptor.ts', import.meta.url), 'utf8');
    const codes = new Set([...src.matchAll(/add\('([a-z_]+)'/g)].map((m) => m[1]!));
    const dims = /QUALIFICATION_DIMENSIONS = \[([^\]]+)\]/.exec(src)![1]!.split(',').map((x) => x.trim().replace(/'/g, ''));
    for (const d of dims) codes.add(`not_${d}`);
    expect(codes.size).toBeGreaterThanOrEqual(25);
    for (const lang of ['he', 'en'] as const) {
      const missing = [...codes].filter((c) => !AI_STRINGS[lang].blockers[c]?.trim());
      expect(missing, lang).toEqual([]);
    }
    const shape = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? [k, ...shape(v).map((x) => `${k}.${x}`)] : [k])).sort();
    expect(shape(AI_STRINGS.en)).toEqual(shape(AI_STRINGS.he));
    for (const k of ['badgeCpu', 'badgeQuality', 'checkAgain', 'timeNotMeasured', 'placeAnyway', 'notTested'] as const) expect(/[֐-׿]/.test(AI_STRINGS.he[k])).toBe(true);
    expect(AI_STRINGS.he.progress.frames.replace('{done}', '120').replace('{total}', '300')).toBe('פריים 120 מתוך 300 (נמדד)');
    expect(AI_STRINGS.he.timeNotMeasured).toBe('זמן: לא נמדד עדיין');
    expect(AI_STRINGS.he.checkAgain).toBe('בדוק שוב');
    expect(AI_STRINGS.he.badgeCpu).toBe('רץ על המעבד');
    expect(AI_STRINGS.he.placeAnyway).toBe('מקם בכל זאת');
    expect(AI_STRINGS.he.notTested).toBe('מה לא נבדק');
    expect((dictionaries.he as Record<string, string>)['ai.review.machine']).toBe('תרגום מכונה · לא נבדק');
    expect((dictionaries.he as Record<string, string>)['ai.review.mark']).toBe('סמן כנבדק');
  });
});

describe('cards: tab, setup state and CPU badge', () => {
  it('groups the tools: translation in captions, voice and vocals in sound, frame jobs in video, stills in picture', () => {
    expect(tabOf({ provider: 'local', task: 'translate' })).toBe('captions');
    expect(tabOf({ provider: 'local', task: 'voice-clean' })).toBe('sound');
    expect(tabOf({ provider: 'local', task: 'vocals-classic' })).toBe('sound');
    expect(tabOf({ provider: 'comfyui', frames: { input: 'video', mode: 'pairwise', chunkFrames: 48 }, inputs: [{ name: 'video', type: 'video', required: true }] })).toBe('video');
    expect(tabOf({ provider: 'comfyui', inputs: [{ name: 'image', type: 'image', required: true }] })).toBe('image');
    expect(tabOf({ inputs: [], outputs: [{ name: 'image', role: 'primary', mediaType: 'image' }] })).toBe('image');
  });
  it('takes the server\'s setup state when it sends one; otherwise derives it honestly from the provider and the model files', () => {
    const own = { code: 'engine_not_configured' as const, detail: 'PF_DENOISE_BIN is not set' };
    expect(setupOf({ setup: own, provider: 'local' }, null)).toBe(own);
    expect(setupOf({ provider: 'comfyui' }, { configured: false }).code).toBe('provider_not_configured');
    expect(setupOf({}, { configured: true, readiness: { reachable: false } }).code).toBe('provider_unreachable');
    const missing = setupOf({ models: [{ path: 'background_removal/birefnet.safetensors', status: { state: 'missing', missingBytes: 444, expectedBytes: 444 } }], missingDownloadBytes: 444 }, { configured: true, readiness: { reachable: true } });
    expect([missing.code, missing.missingBytes]).toEqual(['model_missing', 444]);
    expect(setupOf({ models: [] }, { configured: true, readiness: { reachable: true } }).code).toBe('ready');
  });
  it('says «runs on the CPU» only when it is known: ffmpeg and deep-filter always, a model tool when its device is the processor', () => {
    const ready = { code: 'ready' as const, detail: '' };
    expect(runsOnCpu({ task: 'vocals-classic' }, ready, null)).toBe(true);
    expect(runsOnCpu({ task: 'translate' }, { ...ready, device: 'cpu' }, null)).toBe(true);
    expect(runsOnCpu({ task: 'translate' }, { ...ready, device: 'cuda:0' }, null)).toBe(false);
    expect(runsOnCpu({ task: 'translate' }, ready, 'cpu')).toBe(false); // the ComfyUI device says nothing about a local tool
    expect(runsOnCpu({}, ready, 'cpu')).toBe(true);
    expect(runsOnCpu({}, ready, null)).toBe(false);
  });
});

describe('jobs: progress, cancel, proposals', () => {
  it('reads only a measured, whole, positive progress count', () => {
    expect(progressOf({ progress: { unit: 'frames', done: 120, total: 300, basis: 'measured' } })).toEqual({ unit: 'frames', done: 120, total: 300, basis: 'measured' });
    expect(progressOf({ progress: { unit: 'frames', done: 400, total: 300, basis: 'measured' } })?.done).toBe(300);
    expect(progressOf({ progress: { unit: 'frames', done: 1, total: 3, basis: 'guessed' } })).toBeNull();
    expect(progressOf({ progress: { unit: 'frames', done: 0.5, total: 3, basis: 'measured' } })).toBeNull();
    expect(progressOf({ progress: { unit: 'frames', done: 0, total: 0, basis: 'measured' } })).toBeNull();
    expect(progressOf(null)).toBeNull();
  });
  it('says what a cancel actually did', () => {
    expect(cancelMeaning('removed-from-queue')).toBe('removed');
    expect(cancelMeaning('local')).toBe('stopped');
    expect(cancelMeaning('stopping')).toBe('requested');
    expect(cancelMeaning('interrupt-requested')).toBe('requested');
    expect(cancelMeaning('running-chunk-not-interrupted (another prompt shares the provider); stopping at the chunk boundary')).toBe('requested');
    expect(cancelMeaning('already-finished')).toBe('finished');
    expect(cancelMeaning('not-supported')).toBe('not-supported');
    expect(cancelMeaning('something new')).toBe('other');
  });
  it('«place anyway» is the ordinary ops of the placement that was kept back, and nothing for what a client cannot commit', () => {
    const start = T.rt(2, 1);
    expect(placeAnywayOps({ status: 'proposed', assetId: 'ast_r', proposal: { mode: 'replace-clip', clipId: 'clp_1', speed: 0.25 } })).toEqual([{ op: 'replace_clip_asset', args: { clipId: 'clp_1', assetId: 'ast_r' } }, { op: 'set_clip_speed', args: { clipId: 'clp_1', speed: 0.25 } }]);
    expect(placeAnywayOps({ status: 'proposed', assetId: 'ast_r', proposal: { mode: 'new-track', clipId: 'clp_1', start, duration: T.rt(1, 1) } })).toEqual([{ op: 'add_clip', args: { assetId: 'ast_r', start, duration: T.rt(1, 1), withLinkedAudio: false } }]);
    expect(placeAnywayOps({ status: 'proposed', proposal: { op: 'attach_translation', args: {} } })).toBeNull();
    expect(placeAnywayOps({ status: 'attached', assetId: 'ast_r', proposal: { mode: 'replace-clip', clipId: 'clp_1' } })).toBeNull();
  });
});

describe('compare slider keyboard', () => {
  it('Shift with an arrow moves 10 % (mirrored right to left), clamped; without Shift the native range input moves 1 %', () => {
    expect(compareStep('ArrowRight', true, 50)).toBe(60);
    expect(compareStep('ArrowLeft', true, 50)).toBe(40);
    expect(compareStep('ArrowLeft', true, 50, true)).toBe(60);
    expect(compareStep('ArrowUp', true, 95)).toBe(100);
    expect(compareStep('ArrowDown', true, 3)).toBe(0);
    expect(compareStep('ArrowRight', false, 50)).toBeNull();
    expect(compareStep('Home', true, 50)).toBeNull();
  });
});

describe('sources and the translation review (on a real document)', () => {
  const R = { num: 30, den: 1 };
  const f = (n: number) => T.frameTime(n, R);
  let n = 0;
  const tx = (d: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(d, ops, { idSeed: `w${n++}_`, actor: 'test', allowInternal });
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
  const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 320, height: 180, frameRate: { num: 25, den: 1 }, codec: 'h264', rotation: 0, frameCount: 100 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
  function setup() {
    let r = tx(createProject({ id: 'prj_ui', name: 'UI' }), [{ op: 'import_asset', args: { asset: video } }], true);
    const vid = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [
      { op: 'import_asset', args: { asset: { ...video, name: 'clean.wav', kind: 'audio', contentHash: `sha256:${'2'.repeat(64)}`, video: undefined, duration: T.rt(2, 1), provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId: 'local.voice.clean', capabilityVersion: '0.1.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [vid], outputName: 'voice', outputRole: 'primary', encoding: 'display', provider: {}, sourceRangeStart: T.rt(1, 1) } } } } },
    ], true);
    const clean = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [
      { op: 'add_clip', args: { assetId: vid, start: f(0), sourceIn: f(30), duration: f(45) } },
      { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }, { start: T.rt(1, 1), duration: T.rt(1, 2), text: 'תודה' }] } },
    ]);
    const sound = r.results[0]!.output!.audioClipId as string;
    const segs = r.doc.transcripts[vid]!.segments.map((s) => s.id);
    r = tx(r.doc, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'fixture', model: 'fixture', createdAt: prov.importedAt, createdBy: 'test', sources: { [segs[0]!]: sha256Hex('שלום לכולם'), [segs[1]!]: sha256Hex('תודה') } }, phraseText: { [segs[0]!]: 'Hello everyone', [segs[1]!]: 'Thank you very much indeed, all of you' }, cueText: {} } }], true);
    return { doc: r.doc, vid, clean, sound, segs, variant: r.results[0]!.output!.variantId as string };
  }
  it('a library range is frames on the file\'s own clock, given only when it is a strict part of the file; a bad range is no source', () => {
    const s = setup();
    expect(runSourceOf(s.doc, { kind: 'asset', assetId: s.vid })).toEqual({ assetId: s.vid });
    expect(runSourceOf(s.doc, { kind: 'asset', assetId: s.vid, inFrame: 0, outFrame: 100 })).toEqual({ assetId: s.vid });
    expect(runSourceOf(s.doc, { kind: 'asset', assetId: s.vid, inFrame: 10, outFrame: 40 })).toEqual({ assetId: s.vid, range: { firstFrame: 10, frameCount: 30 } });
    expect(runSourceOf(s.doc, { kind: 'asset', assetId: s.vid, inFrame: 40, outFrame: 40 })).toBeNull();
    expect(runSourceOf(s.doc, { kind: 'asset', assetId: s.vid, inFrame: 0, outFrame: 101 })).toBeNull();
    expect(runSourceOf(s.doc, { kind: 'asset', assetId: 'ast_gone' })).toBeNull();
    expect(runSourceOf(s.doc, { kind: 'clip', clipId: s.sound })).toEqual({ clipId: s.sound });
  });
  it('compare times: the playhead in the result and, through its start on the original\'s clock, in the original', () => {
    const s = setup();
    const swapped = tx(s.doc, [{ op: 'replace_clip_asset', args: { clipId: s.sound, assetId: s.clean } }]).doc;
    // the sound clip shows source 1 s..2.5 s of the original; the clean copy starts at 1 s of it
    expect(compareTimes(swapped, s.sound, f(15))).toEqual({ after: 0.5, before: 1.5 });
    expect(compareTimes(swapped, s.sound, f(60))).toBeNull();
  });
  it('the review rows put master and translation side by side, flag phrases too fast to read and phrases whose master changed', () => {
    const s = setup();
    const rows = reviewRows(s.doc, s.variant, { en: readingLimitFor({}, 'en') });
    expect(rows.map((r) => [r.kind, r.master, r.translated, r.stale])).toEqual([['phrase', 'שלום לכולם', 'Hello everyone', false], ['phrase', 'תודה', 'Thank you very much indeed, all of you', false]]);
    expect(rows[1]!.cps).toBeGreaterThan(20); // 38 characters in half a second
    expect(rows[0]!.cps).toBeNull();
    expect(openItems(s.doc, s.variant, rows).map((o) => o.kind)).toEqual(['unreviewed', 'fast']);
    const edited = tx(s.doc, [{ op: 'correct_transcript', args: { assetId: s.vid, segmentId: s.segs[0]!, text: 'שלום לכולן' } }]).doc;
    const after = reviewRows(edited, s.variant, { en: 100 });
    expect(after.map((r) => r.stale)).toEqual([true, false]);
    expect(openItems(edited, s.variant, after).map((o) => o.kind)).toEqual(['unreviewed', 'stale']);
    const reviewed = tx(s.doc, [{ op: 'review_translation', args: { variantId: s.variant, review: 'reviewed' } }], true).doc;
    expect(openItems(reviewed, s.variant, reviewRows(reviewed, s.variant, { en: 100 }))).toEqual([]);
    expect(readingLimitFor({ en: 15 }, 'en-GB')).toBe(15);
  });
});
