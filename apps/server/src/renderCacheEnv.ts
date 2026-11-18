/**
 * The parts of a segment key that describe the machine and the build rather than the document (ADR-0024, verifier B5):
 * the render bundle's digest, the identity of the browser that renders THIS job, and the encoder id. Lead-owned; computed per
 * job and per plan, never once at server start (the render page is read from disk per request, so a rebuild while the server
 * runs changes the bundle).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { findEffect, type EngineFingerprint, type ProjectDocument } from '@pulseframe/core';
import { frameKey } from '@pulseframe/engine';
import type { RenderHost, WorkerIdentity } from '@pulseframe/renderer';
import { usesGpuEffects, type Manifest } from './export.ts';
import { segmentEncodeArgs, type FrameKeyFn, type SegmentEnv } from './exportSegments.ts';
import { ApiError } from './store.ts';

export const sha256Hex = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

const fileHashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
/** sha256 of a file, cached by (path, size, mtime): hashing the 3 MB bundle once per job is cheap, re-reading unchanged files is not needed. */
function fileSha256(file: string): string {
  const st = fs.statSync(file);
  const hit = fileHashes.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha256;
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fileHashes.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256 });
  return sha256;
}
/**
 * sha256 over the sorted (name, sha256) pairs of render.html and every file under webDist/assets (recursively, names relative
 * to webDist with '/' separators). Any change to compositor code, a font or a stylesheet changes it; every stored segment is
 * then a miss (the safe default the plan accepted: a product update empties the cache). Null when the bundle is not built.
 */
export function bundleDigest(webDist: string): string | null {
  const page = path.join(webDist, 'render.html');
  if (!fs.existsSync(page)) return null;
  const files: string[] = ['render.html'];
  const walk = (rel: string) => {
    const dir = path.join(webDist, rel);
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) files.push(r);
    }
  };
  walk('assets');
  files.sort();
  return sha256Hex(files.map((f) => `${f}\0${fileSha256(path.join(webDist, f))}\n`).join(''));
}
/** The fingerprint's `browser`: `${version}|launch=${mode}` of the browser that renders this job. */
export const browserFingerprint = (id: Pick<WorkerIdentity, 'version' | 'launch'>): string => `${id.version}|launch=${id.launch}`;
export function engineFingerprint(bundle: string, id: Pick<WorkerIdentity, 'version' | 'launch'>, schemaVersion: number): EngineFingerprint {
  return { bundle, browser: browserFingerprint(id), schemaVersion };
}
/**
 * The encoder id: sha256 of `ffmpeg -version` output and the exact segment encode argument list (thread count included; the
 * output size and path replaced by fixed placeholders by the caller). Measured: -threads 2 and -threads 4 give different bytes.
 */
export const encoderIdOf = (ffmpegVersion: string, encodeArgs: readonly string[]): string => sha256Hex(`${ffmpegVersion}\n${JSON.stringify(encodeArgs)}`);

// ---------------------------------------------------------------------------------------------------------------------------
// The SegmentEnv of one job or plan (lead wiring): what the frame and segment keys read besides the document.
// ---------------------------------------------------------------------------------------------------------------------------

const execFileP = promisify(execFile);
let ffmpegVersion: Promise<string> | null = null;
/** `ffmpeg -version` of the ffmpeg this process runs (detected once per process, never assumed). */
export function ffmpegVersionText(): Promise<string> {
  ffmpegVersion ??= execFileP('ffmpeg', ['-version'], { timeout: 30_000 }).then((r) => r.stdout, (e) => { ffmpegVersion = null; throw new ApiError(503, 'incremental_unavailable', `ffmpeg could not be started to identify the segment encoder: ${String(e?.message ?? e).slice(0, 200)}`); });
  return ffmpegVersion;
}
/**
 * The encoder id of a job: `ffmpeg -version` and the segment encode arguments with THIS job's quality and the configured threads,
 * the output size, the segment length and the output path replaced by fixed placeholders (the key covers the size through its
 * output parameters and the length through the number of frame keys). Draft and high exports therefore never share segments.
 */
export function encoderIdFor(versionText: string, manifest: Pick<Manifest, 'options' | 'output'>, threads: number): string {
  return encoderIdOf(versionText, segmentEncodeArgs({ width: 0, height: 0, frameRate: manifest.output.frameRate, quality: manifest.options.quality, segFrames: 0, threads, outFile: '<out>' }));
}
export interface SegmentEnvSource {
  host: Pick<RenderHost, 'identity'>;
  webDist: string;
  threads: number;
  /** Exporter.fontHash: the hash of a bundled family's font files, null when it is not bundled. */
  fontHash(family: string): string | null;
}
/** The env of `doc` (the job's render document) for this manifest. Names are looked up with Object.hasOwn, never `table[name]`. */
export async function segmentEnvFor(src: SegmentEnvSource, doc: ProjectDocument, manifest: Manifest): Promise<SegmentEnv> {
  const bundle = bundleDigest(src.webDist);
  if (!bundle) throw new ApiError(503, 'renderer_unavailable', 'the web bundle containing the render page has not been built', {}, 'Run `pnpm build` and retry.');
  const id = await src.host.identity(usesGpuEffects(doc));
  const version = await ffmpegVersionText();
  return {
    digest: sha256Hex,
    engine: engineFingerprint(bundle, id, doc.schemaVersion),
    encoderId: encoderIdFor(version, manifest, src.threads),
    threads: src.threads,
    gpu: id.adapter ? { adapter: id.adapter, software: id.softwareAdapter } : null,
    assetHash: (assetId) => (Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]!.contentHash : null),
    fontHash: (family) => src.fontHash(family),
    effectVersion: (type) => findEffect(type)?.version ?? 0,
  };
}
/** The engine frame key of each programme frame of `doc` at the manifest's output size. Throws engine UnkeyableError. */
export const frameKeyFor = (doc: ProjectDocument, manifest: Pick<Manifest, 'output'>, env: SegmentEnv): FrameKeyFn => (frame) =>
  frameKey(doc, frame, { digest: env.digest, output: { width: manifest.output.width, height: manifest.output.height }, assetHash: env.assetHash, fontHash: env.fontHash, effectVersion: env.effectVersion, gpu: env.gpu });
