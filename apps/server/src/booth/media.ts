/**
 * What the booth plays and shows (wave 8 booth): the audio of an audio item through the product's OWN functions — music through
 * musicPreviewAnswer(styleId, 8, 1) (the bytes music.golden.json pins), SFX through sfxPreview (the bytes GET /api/v1/sfx/:id/audio
 * gives) — and the export strip's still through Exporter.renderStill on the booth's scene document, so the export's own worker draws it.
 * Headers carry ASCII only: x-pf-content-sha256, x-pf-expected-match (music), x-pf-adapter, x-pf-software.
 */
import { createHash } from 'node:crypto';
import { boothScene, type BoothItem } from '@pulseframe/core';
import { musicPreviewAnswer } from '../music.ts';
import { sfxPreview } from '../sfx.ts';
import { asStrip, boothBusy, safeText } from './checks.ts';
import { boothError, type BoothRouteDeps } from './contract.ts';
import { putBoothPictures } from './testPicture.ts';

/** sha256 of the bytes this process last served per audio item (the item reads 'changed' when it differs from the row's `played`). */
const served = new Map<string, string>();
export const servedSha = (item: BoothItem): string | null => served.get(item.id) ?? null;

export interface BoothAudio { bytes: Buffer; headers: Record<string, string> }
export async function boothAudio(item: BoothItem, deps: Pick<BoothRouteDeps, 'cfg' | 'store' | 'musicKits'>, signal?: AbortSignal): Promise<BoothAudio> {
  let bytes: Buffer;
  const headers: Record<string, string> = {};
  if (item.make.route === 'music') {
    bytes = (await musicPreviewAnswer(item.make.styleId, item.make.bars, item.make.seed, { cfg: deps.cfg, ...(deps.musicKits ? { kits: deps.musicKits } : {}), ...(signal ? { signal } : {}) })).bytes;
  } else if (item.make.route === 'sfx') {
    bytes = await sfxPreview(deps.store.tmpDir, item.make.sfxId);
  } else throw boothError('unknownItem');
  const sha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  served.set(item.id, sha);
  headers['x-pf-content-sha256'] = sha;
  if (item.expected) headers['x-pf-expected-match'] = sha === item.expected ? '1' : '0';
  return { bytes, headers };
}

/** The mid-transition still of an export-strip item, drawn by the export's worker. Heavy: 409 booth_busy while other work runs. */
export async function boothExportStill(item: BoothItem, deps: Pick<BoothRouteDeps, 'store' | 'exporter' | 'renderHost'>): Promise<BoothAudio> {
  if (!item.exportStrip || item.make.route !== 'scene') throw boothError('unknownItem');
  if (boothBusy(deps.store)) throw boothError('busy');
  const make = item.make;
  return asStrip(async () => {
    // again before every still: the storage cleaner removes unreferenced blobs older than ten minutes
    const pics = putBoothPictures(deps.store);
    const scene = boothScene(make, { a: pics.a, b: pics.b });
    const bytes = await deps.exporter.renderStill(scene.doc, 0, scene.still);
    const id = deps.renderHost ? await deps.renderHost.identity(true).catch(() => null) : null;
    return {
      bytes,
      headers: { 'x-pf-adapter': id?.adapter ? safeText(id.adapter) || 'unknown' : 'none', 'x-pf-software': id?.softwareAdapter ? '1' : '0', 'x-pf-content-sha256': `sha256:${createHash('sha256').update(bytes).digest('hex')}` },
    };
  });
}
