/**
 * Which build runs (wave 8 booth; verify C4): the commit from `.git/HEAD` and its ref file, READ, never exec'd (a worktree's `.git` file
 * and packed-refs too), else 'unknown'; plus bundleDigest(webDist), which says which web bundle actually runs. And the allow-listed
 * machine facts: os type/release/arch, cpu count, memory in whole GiB — never a user, host or folder name.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoothBuildSchema, BoothMachineSchema, type BoothBuild, type BoothMachine } from '@pulseframe/core';
import { bundleDigest } from '../renderCacheEnv.ts';

/** The repository root this server file sits in (apps/server/src/booth → four levels up). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HEX = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/** The commit HEAD names (first 12 hex digits), or 'unknown'. Pure file reads; anything unexpected is 'unknown'. */
export function gitCommit(root: string = REPO_ROOT): string {
  try {
    let gitDir = path.join(root, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(read(gitDir) ?? '');
      if (!m) return 'unknown';
      gitDir = path.resolve(root, m[1]!.trim());
    }
    const head = (read(path.join(gitDir, 'HEAD')) ?? '').trim();
    if (HEX.test(head)) return head.slice(0, 12);
    const ref = /^ref:\s*(refs\/[A-Za-z0-9._\/-]+)$/.exec(head)?.[1];
    if (!ref || ref.includes('..')) return 'unknown';
    // a worktree keeps HEAD in its own folder and the refs in the common one
    const common = (read(path.join(gitDir, 'commondir')) ?? '').trim();
    const dirs = [gitDir, ...(common ? [path.resolve(gitDir, common)] : [])];
    for (const d of dirs) {
      const v = (read(path.join(d, ...ref.split('/'))) ?? '').trim();
      if (HEX.test(v)) return v.slice(0, 12);
    }
    for (const d of dirs) {
      for (const line of (read(path.join(d, 'packed-refs')) ?? '').split(/\r?\n/)) {
        const [hash, name] = line.trim().split(' ');
        if (name === ref && hash && HEX.test(hash)) return hash.slice(0, 12);
      }
    }
    return 'unknown';
  } catch { return 'unknown'; }
}
export function boothBuild(webDist: string, root: string = REPO_ROOT): BoothBuild {
  let bundle = 'unknown';
  try { const d = bundleDigest(webDist); if (d && /^[0-9a-f]{64}$/.test(d)) bundle = `sha256:${d}`; } catch { /* unreadable bundle: unknown */ }
  return BoothBuildSchema.parse({ commit: gitCommit(root), bundle });
}
export function boothMachine(): BoothMachine {
  const ascii = (t: string) => t.replace(/[^\x20-\x7e]/g, '').slice(0, 80);
  return BoothMachineSchema.parse({ os: ascii(`${os.type()} ${os.release()} ${os.arch()}`), cpus: os.cpus().length, memGiB: Math.round(os.totalmem() / 2 ** 30) });
}
