/**
 * Build identity (wave 8 booth; verify C4): the commit from .git files read without exec, else 'unknown'; the bundle digest; the
 * machine facts carry no user, host or folder name.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boothBuild, boothMachine, gitCommit, REPO_ROOT } from './build.ts';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-build-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const A = '3f9c2a1b4d5e6f708192a3b4c5d6e7f8091a2b3c', B = 'aaaaaaaaaaaabbbbbbbbbbbbccccccccccccdddd';
const w = (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

describe('gitCommit', () => {
  it('reads HEAD → ref file, packed-refs, a detached HEAD and a worktree\'s .git file; anything else is unknown', () => {
    const r1 = tmp(); w(path.join(r1, '.git/HEAD'), 'ref: refs/heads/main\n'); w(path.join(r1, '.git/refs/heads/main'), `${A}\n`);
    expect(gitCommit(r1)).toBe(A.slice(0, 12));
    const r2 = tmp(); w(path.join(r2, '.git/HEAD'), 'ref: refs/heads/x\n'); w(path.join(r2, '.git/packed-refs'), `# pack-refs\n${B} refs/heads/x\n`);
    expect(gitCommit(r2)).toBe(B.slice(0, 12));
    const r3 = tmp(); w(path.join(r3, '.git/HEAD'), `${A}\n`);
    expect(gitCommit(r3)).toBe(A.slice(0, 12));
    const main = tmp(), wt = tmp();
    w(path.join(main, '.git/worktrees/w/HEAD'), 'ref: refs/heads/wt/b\n'); w(path.join(main, '.git/worktrees/w/commondir'), '../..\n'); w(path.join(main, '.git/refs/heads/wt/b'), `${B}\n`);
    w(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git/worktrees/w')}\n`);
    expect(gitCommit(wt)).toBe(B.slice(0, 12));
    expect(gitCommit(tmp())).toBe('unknown');
    const r4 = tmp(); w(path.join(r4, '.git/HEAD'), 'ref: refs/heads/../../etc\n');
    expect(gitCommit(r4)).toBe('unknown');
    const r5 = tmp(); w(path.join(r5, '.git/HEAD'), 'ref: refs/heads/gone\n');
    expect(gitCommit(r5)).toBe('unknown');
  });
  it('this checkout answers a commit (it is a git worktree)', () => {
    expect(gitCommit(REPO_ROOT)).toMatch(/^[0-9a-f]{12}$/);
  });
});
describe('boothBuild and boothMachine', () => {
  it('bundle: sha256 of the built bundle, unknown without one', () => {
    const none = tmp();
    expect(boothBuild(none, none)).toEqual({ commit: 'unknown', bundle: 'unknown' });
    const dist = tmp(); w(path.join(dist, 'render.html'), '<!doctype html>'); w(path.join(dist, 'assets/a.js'), 'x');
    expect(boothBuild(dist, none).bundle).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('machine: os, cpus, memory only; never the user, host or home folder', () => {
    const m = boothMachine();
    expect(Object.keys(m).sort()).toEqual(['cpus', 'memGiB', 'os']);
    const text = JSON.stringify(m).toLowerCase();
    for (const bit of [os.userInfo().username, os.hostname(), os.homedir()]) if (bit.length >= 3) expect(text).not.toContain(bit.toLowerCase());
  });
});
