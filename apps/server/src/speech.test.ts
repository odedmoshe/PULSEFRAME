import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Asset } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import type { ComputeLane } from './aiContracts.ts';
import { loadConfig } from './config.ts';
import { describeMedia } from './ingest.ts';
import { sanitizeRecognition, Speech, SPEECH_MODELS } from './speech.ts';
import { Store } from './store.ts';

const w = (text: string, start: number, end: number, probability = 0.9) => ({ text, start, end, probability });
const s = (x: T.RationalTime) => T.toSeconds(x);

describe('sanitizeRecognition', () => {
  it('keeps the recogniser\'s words and times, as exact milliseconds', () => {
    const r = sanitizeRecognition([{ start: 0.5, end: 2, text: ' שלום עולם', words: [w(' שלום', 0.5, 1.1), w(' עולם', 1.1, 2, 0.4)] }], 10);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.text).toBe('שלום עולם');
    expect(r.segments[0]!.words.map((x) => [x.text, s(x.start), s(x.duration), x.confidence])).toEqual([['שלום', 0.5, 0.6, 0.9], ['עולם', 1.1, 0.9, 0.4]]);
    expect(r.stats).toMatchObject({ phrases: 1, words: 2, lowConfidenceWords: 1, adjustedTimes: 0, droppedPhrases: 0, degeneratePhrases: 0 });
  });
  it('makes phrases and words obey the transcript rules by moving times only onto a neighbour or the end of the media', () => {
    const r = sanitizeRecognition([
      { start: 0, end: 3, text: 'a b', words: [w('a', 0, 2), w('b', 1.5, 3)] }, // second word starts inside the first
      { start: 2.5, end: 12, text: 'c', words: [w('c', 2.5, 12)] }, // overlaps the previous phrase and runs past the media
    ], 10);
    const [p1, p2] = r.segments;
    expect(s(p1!.words[1]!.start)).toBe(2);
    expect(s(p2!.start)).toBe(3);
    expect(s(p2!.start) + s(p2!.duration)).toBe(10);
    expect(s(p2!.words[0]!.start)).toBe(3);
    expect(r.stats.adjustedTimes).toBeGreaterThan(0);
    // phrases in order without overlap; words inside their phrase
    let end = 0;
    for (const p of r.segments) { expect(s(p.start)).toBeGreaterThanOrEqual(end); end = s(p.start) + s(p.duration); for (const x of p.words) expect(s(x.start) + s(x.duration)).toBeLessThanOrEqual(end); }
  });
  it('drops phrases without length or text, and words without text', () => {
    const r = sanitizeRecognition([{ start: 4, end: 4, text: 'x', words: [] }, { start: 5, end: 6, text: '  ', words: [w('  ', 5, 6)] }, { start: 7, end: 8, text: 'ok', words: [w('', 7, 7.5), w('ok', 7.5, 8)] }], 10);
    expect(r.segments.map((p) => p.text)).toEqual(['ok']);
    expect(r.segments[0]!.words).toHaveLength(1);
    expect(r.stats.droppedPhrases).toBe(2);
  });
  it('leaves out phrases where the recogniser fell into repetition, and counts them', () => {
    const r = sanitizeRecognition([
      { start: 0, end: 3, text: `טא${'ו'.repeat(120)}`, words: [w(`טא${'ו'.repeat(120)}`, 0, 3)] },
      { start: 3, end: 5, text: 'תודה '.repeat(12), words: [] },
      { start: 5, end: 6, text: 'fine', compressionRatio: 3.1, words: [w('fine', 5, 6)] },
      { start: 6, end: 7, text: 'אני מאוד מתרגשת', compressionRatio: 0.9, words: [w('אני', 6, 6.3), w('מאוד', 6.3, 6.6), w('מתרגשת', 6.6, 7)] },
    ], 10);
    expect(r.segments.map((p) => p.text)).toEqual(['אני מאוד מתרגשת']);
    expect(r.stats.degeneratePhrases).toBe(3);
  });
  it('ordinary emphasis is not treated as repetition', () => {
    const r = sanitizeRecognition([{ start: 0, end: 2, text: 'לאאאא! די די די', words: [] }], 10);
    expect(r.segments).toHaveLength(1);
  });
});

describe('reviewed speech models', () => {
  it('every file is pinned by revision, size, digest and an https source on the model host', () => {
    for (const m of SPEECH_MODELS) for (const f of m.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.source).toMatch(new RegExp(`^https://huggingface\\.co/.+/resolve/${f.revision}/`));
      expect(f.path.startsWith(`${m.kind}/`)).toBe(true);
      expect(f.license).toBeTruthy();
    }
  });
});

/** IN-TEST DOUBLE of ComputeLane (labelled): one holder at a time, FIFO, abortable waits. Not the product's lane.ts (ADR-0017). */
class TestLane implements ComputeLane {
  private holder: string | null = null;
  private queue: { label: string; grant: () => void }[] = [];
  acquire(label: string, signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const entry = { label, grant: () => { this.holder = label; resolve(() => { this.holder = null; this.pump(); }); } };
      signal?.addEventListener('abort', () => { const i = this.queue.indexOf(entry); if (i >= 0) { this.queue.splice(i, 1); reject(new Error('aborted')); } });
      this.queue.push(entry);
      this.pump();
    });
  }
  private pump() { if (!this.holder && this.queue.length) this.queue.shift()!.grant(); }
  onBeforeHeavy() {}
  busy() { return { holder: this.holder, waiting: this.queue.length }; }
  setExportActive() {}
  exportActive() { return false; }
}

describe('Speech and the compute lane (ADR-0017)', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim();
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-speech-lane-'));
    dirs.push(dir);
    const store = new Store(path.join(dir, 'data'));
    const cfg = { ...loadConfig({}), dataDir: path.join(dir, 'data'), speechModelsDir: path.join(dir, 'models'), speechPython: python, speechKeepSeconds: 60 };
    return { dir, store, cfg };
  };

  it('recognition waits while the lane is held, says what it waits for, and runs once it is released', async () => {
    const { dir, store, cfg } = setup();
    const lane = new TestLane();
    const speech = new Speech(store, cfg, lane);
    try {
      const pid = store.createProject({ name: 'lane' }).doc.id;
      const wav = path.join(dir, 'a.wav');
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=f=300:d=1:r=16000', '-y', wav]);
      const bytes = fs.readFileSync(wav), contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const meta = await describeMedia(wav);
      fs.copyFileSync(wav, path.join(store.tmpDir, 'a'));
      store.putBlob(contentHash, path.join(store.tmpDir, 'a'), bytes.length, meta.mimeType);
      const asset: Omit<Asset, 'id'> = { ...meta, name: 'a.wav', contentHash, byteSize: bytes.length, provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: 'user:owner' } };
      const assetId = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
      const release = await lane.acquire('test holder');
      // a queued recognition job, as startTranscription leaves it; recover() puts it on the speech queue
      const job = store.createJob(pid, 'transcribe', 'user:owner', { assetId, language: 'he', modelId: 'asr.ivrit-turbo', projectRevision: 1 });
      speech.recover();
      for (let i = 0; i < 400 && store.getJob(job.id).stage !== 'queued (waiting for compute: test holder)'; i++) await sleep(25);
      expect(store.getJob(job.id).stage).toBe('queued (waiting for compute: test holder)');
      await sleep(200);
      expect(store.getJob(job.id).status).toBe('queued');
      release();
      for (let i = 0; i < 400 && !['failed', 'succeeded'].includes(store.getJob(job.id).status); i++) await sleep(25);
      // it ran: with no model files it fails honestly at the model check (no engine was needed to prove the wait)
      expect(store.getJob(job.id)).toMatchObject({ status: 'failed', error: { code: 'speech_not_ready' } });
      expect(lane.busy()).toEqual({ holder: null, waiting: 0 });
    } finally { await speech.stop(); store.close(); }
  }, 60_000);

  it('releaseKept() stops an idle kept worker (the speech worker\'s serve mode imports no engine, so it runs without one)', async () => {
    const { store, cfg } = setup();
    const speech = new Speech(store, cfg);
    try {
      // white-box: one request through the kept worker, as a recognition would send it
      const lines: any[] = [];
      const r = await (speech as unknown as { request(p: string, a: string[], on: (o: unknown) => void, j: string): Promise<{ code: number | null }> }).request(python, ['probe'], (o) => lines.push(o), 'job_test');
      expect(r.code).toBe(0);
      expect(lines.some((o) => o.event === 'result')).toBe(true);
      const kept = (speech as unknown as { kept: Map<string, { p: { pid: number } }> }).kept;
      expect(kept.size).toBe(1);
      const pid = [...kept.values()][0]!.p.pid;
      const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      expect(alive()).toBe(true);
      await speech.releaseKept();
      expect(kept.size).toBe(0);
      for (let i = 0; i < 200 && alive(); i++) await sleep(25);
      expect(alive()).toBe(false);
    } finally { await speech.stop(); store.close(); }
  }, 60_000);
});
