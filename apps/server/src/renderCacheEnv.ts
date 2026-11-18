/**
 * The parts of a segment key that describe the machine and the build rather than the document (ADR-0024, verifier B5):
 * the render bundle's digest, the identity of the browser that renders THIS job, and the encoder id. Lead-owned; computed per
 * job and per plan, never once at server start (the render page is read from disk per request, so a rebuild while the server
 * runs changes the bundle).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EngineFingerprint } from '@pulseframe/core';
import type { WorkerIdentity } from '@pulseframe/renderer';

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
