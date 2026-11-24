/**
 * The filler candidates route (POST /analysis/fillers, find_filler_words) follows a clip that shows a derived copy back to the
 * transcribed recording (core lineage.ts timingRelations), and refuses with 422 untimed_copy while a clip shows a copy made
 * without a recorded time mapping. The derived assets are hand-built fixtures standing in for provider results (no provider ran).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Asset } from '@pulseframe/core';
import { findFillerWords } from './http.ts';
import { ApiError, Store } from './store.ts';

let dir: string, store: Store;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' };
const talk: Omit<Asset, 'id'> = { kind: 'video', name: 'talk.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const derived = (src: string, extra: Record<string, unknown>, capabilityId: string) => ({ origin: 'derived' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, ...extra } });

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tlineage-')); store = new Store(dir); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('filler candidates follow a derived copy', () => {
  it('a clip of the cleaned voice gets the cuts of the recording\'s filler words; asked by the copy\'s id the recording\'s transcript is used; an untimed copy refuses', () => {
    const pid = store.createProject({ name: 'fl', width: 640, height: 360, frameRate: R }).doc.id;
    const vid = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: talk } }] }).results[0]!.output!.assetId as string;
    const voice = { kind: 'audio', name: 'clean.wav', contentHash: hash('2'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(7, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: derived(vid, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }, 'local.audio.voice-clean') };
    const reversed = { ...talk, name: 'reversed.mp4', contentHash: hash('3'), provenance: derived(vid, {}, 'comfy.video.reverse') };
    const imp = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: voice } }, { op: 'import_asset', args: { asset: reversed } }] });
    const [clean, rev] = imp.results.map((r) => r.output!.assetId as string) as [string, string];
    const words = [[1, 'שלום'], [2, 'אממ'], [3, 'עולם']] as const;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [
      { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [{ start: T.rt(1, 1), duration: T.rt(3, 1), text: 'שלום אממ עולם', words: words.map(([s, text]) => ({ start: T.rt(s, 1), duration: T.rt(1, 2), text })) }] } },
      { op: 'add_clip', args: { assetId: clean, start: f(0), duration: f(150) } }, // 0.5..5.5 s of the recording
    ] });
    // "אממ" 2.0–2.5 s of the recording = 1.5–2.0 s of the copy = frames 45–60
    const byRecording = findFillerWords(store, pid, { assetId: vid });
    expect(byRecording.candidates.map((c) => [T.frameIndexAt(c.start, R), T.frameIndexAt(c.end, R)])).toEqual([[45, 60]]);
    expect(byRecording.ops).toEqual([{ op: 'cut_range', args: { start: f(45), end: f(60) } }]);
    const byCopy = findFillerWords(store, pid, { assetId: clean });
    expect(byCopy.candidates).toEqual(byRecording.candidates);
    expect(byCopy).toMatchObject({ assetId: clean, transcriptAssetId: vid });
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: rev, start: f(150), duration: f(30), withLinkedAudio: false } }] });
    let err: unknown;
    try { findFillerWords(store, pid, { assetId: vid }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'untimed_copy' });
    expect((err as ApiError).hint).toMatch(/replace_clip_media/);
  });
});
