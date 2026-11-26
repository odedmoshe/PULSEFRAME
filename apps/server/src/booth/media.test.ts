/**
 * The booth's audio and export still (wave 8 booth; plan checks 3 and 4): the bytes come from the product's own functions; the scene
 * document of every export-strip item passes Exporter.plan with no blocker (verify "not checked": a synthetic prj_ document without a
 * stored project). The still itself needs the built bundle and a browser: proof:booth, not a unit test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boothScene } from '@pulseframe/core';
import { loadConfig, type Config } from '../config.ts';
import { Exporter } from '../export.ts';
import { musicPreviewAnswer } from '../music.ts';
import { sfxPreview } from '../sfx.ts';
import { Store } from '../store.ts';
import { boothAudio, boothExportStill, servedSha } from './media.ts';
import { boothRegistry } from './registry.ts';
import { boothPictures, putBoothPictures } from './testPicture.ts';

let dir: string, cfg: Config, store: Store;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-media-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: null };
  store = new Store(dir);
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('booth audio', () => {
  it('music: the golden bytes at 8 bars seed 1, equal to the music preview, x-pf-expected-match 1', async () => {
    const item = (await boothRegistry()).find((i) => i.id === 'music:music.calm')!;
    const a = await boothAudio(item, { cfg, store });
    const ref = (await musicPreviewAnswer('music.calm', 8, 1, { cfg })).bytes;
    expect(a.bytes.equals(ref)).toBe(true);
    expect(a.headers['x-pf-content-sha256']).toBe(item.expected);
    expect(a.headers['x-pf-expected-match']).toBe('1');
    expect(servedSha(item)).toBe(item.expected);
  }, 60_000);
  it('sfx: equal to sfxPreview (GET /api/v1/sfx/:id/audio), no expected-match header', async () => {
    const item = (await boothRegistry()).find((i) => i.id === 'sfx:sfx.pop')!;
    const a = await boothAudio(item, { cfg, store });
    expect(a.bytes.equals(await sfxPreview(store.tmpDir, 'sfx.pop'))).toBe(true);
    expect(a.headers['x-pf-expected-match']).toBeUndefined();
    for (const v of Object.values(a.headers)) expect(v).toMatch(/^[\x20-\x7e]+$/);
  }, 60_000);
});

describe('the export strip', () => {
  it('every strip item\'s scene document passes Exporter.plan as a PNG still with no blocker; the pictures are stored blobs', async () => {
    const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
    const pics = putBoothPictures(store);
    const strip = (await boothRegistry()).filter((i) => i.exportStrip);
    expect(strip.length).toBe(7);
    for (const item of strip) {
      if (item.make.route !== 'scene') throw new Error('strip item without a scene');
      const scene = boothScene(item.make, { a: pics.a, b: pics.b });
      const { blockers, manifest } = exporter.plan(scene.doc, 0, { format: 'png', frame: scene.still, scale: 1 });
      expect({ id: item.id, blockers: blockers.filter((b) => b.code !== 'empty_sequence').map((b) => b.code) }).toEqual({ id: item.id, blockers: [] });
      expect([manifest.output.width, manifest.output.height]).toEqual([640, 360]);
    }
    expect(fs.existsSync(store.blobPath(boothPictures().a.contentHash))).toBe(true);
  });
  it('refuses an item outside the strip (404) and answers 409 booth_busy while an export job is queued', async () => {
    const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
    const items = await boothRegistry();
    await expect(boothExportStill(items.find((i) => i.id === 'gpu-transition:swirl-cw')!, { store, exporter, renderHost: null })).rejects.toMatchObject({ status: 404, code: 'booth_unknown_item' });
    const job = store.createJob('prj_x', 'export', 'user:local', {});
    try {
      await expect(boothExportStill(items.find((i) => i.id === 'gpu-transition:film-burn')!, { store, exporter, renderHost: null })).rejects.toMatchObject({ status: 409, code: 'booth_busy' });
    } finally { store.updateJob(job.id, { status: 'canceled' }); }
  });
});
