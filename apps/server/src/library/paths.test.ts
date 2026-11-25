import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyChecked, entrySegments, isInside, openInside, readChecked, resolveInside, safeSegments } from './paths.ts';

let base: string, root: string, outside: string;
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-libpaths-')));
  root = path.join(base, 'lib'); outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'music', 'tree', 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'music', 'one.mp3'), 'one');
  fs.writeFileSync(path.join(root, 'music', 'tree', 'a.wav'), 'aaaa');
  fs.writeFileSync(path.join(root, 'music', 'tree', 'sub', 'b.wav'), 'bbbb');
  fs.writeFileSync(path.join(outside, 'secret.wav'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.wav'), path.join(root, 'music', 'tree', 'out.wav')); // a link out
  fs.symlinkSync(path.join(root, 'music', 'tree', 'a.wav'), path.join(root, 'music', 'tree', 'in.wav')); // a link that stays inside
  fs.symlinkSync(outside, path.join(root, 'music', 'tree', 'outdir')); // a folder link out
  fs.symlinkSync(outside, path.join(root, 'music', 'linked-item')); // an item folder that is a link out
  fs.symlinkSync(path.join(outside, 'secret.wav'), path.join(root, 'music', 'linked.mp3')); // a file item that is a link out
  fs.symlinkSync(path.join(base, 'nowhere'), path.join(root, 'music', 'dangling.mp3'));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('paths as text', () => {
  it('accepts plain relative forward-slash paths and refuses everything else', () => {
    expect(safeSegments('music/a b/c.wav')).toEqual(['music', 'a b', 'c.wav']);
    for (const bad of ['', '/abs', 'a/../b', '..', 'a/./b', 'a//b', 'a\\b', 'C:/x', 'c:x', 'a/b:stream', 'a\u0000b', 'a\nb', 'a/'])
      expect({ bad, ok: safeSegments(bad) }).toEqual({ bad, ok: null });
    expect(safeSegments('', true)).toEqual([]);
    expect(entrySegments('models/x')).toEqual(['models', 'x']);
    expect(entrySegments('elsewhere/x')).toBeNull();
    expect(entrySegments('music/../../x')).toBeNull();
  });
  it('isInside', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
  });
});

describe('containment by realpath', () => {
  it('resolves files inside, and links that stay inside', async () => {
    expect((await resolveInside(root, 'music/tree', 'sub/b.wav'))?.real).toBe(path.join(root, 'music', 'tree', 'sub', 'b.wav'));
    expect((await resolveInside(root, 'music/tree', 'in.wav'))?.real).toBe(path.join(root, 'music', 'tree', 'a.wav'));
    expect((await resolveInside(root, 'music/one.mp3', ''))?.real).toBe(path.join(root, 'music', 'one.mp3'));
    expect(await resolveInside(root, 'music/tree', 'missing.wav')).toBeNull();
  });
  it('refuses links out, `..`, item folders that are links out, file items that are links, dangling links', async () => {
    expect(await code(resolveInside(root, 'music/tree', 'out.wav'))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/tree', 'outdir/secret.wav'))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/tree', '../one.mp3'))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/../../outside/secret.wav', ''))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/linked-item', 'secret.wav'))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/linked.mp3', ''))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/dangling.mp3', ''))).toBe('library_path_escape');
    expect(await code(resolveInside(root, 'music/tree', 'a\\..\\..\\x'))).toBe('library_path_escape');
  });
  it('never opens the outside file', async () => {
    const spy = vi.spyOn(fs.promises, 'open');
    try {
      for (const [e, r] of [['music/tree', 'out.wav'], ['music/tree', 'outdir/secret.wav'], ['music/linked.mp3', ''], ['music/linked-item', 'secret.wav']] as const)
        expect(await code(openInside(root, e, r))).toBe('library_path_escape');
      expect(spy.mock.calls.filter((c) => String(c[0]).includes('secret')).length).toBe(0);
      // the spy does see opens (a control): a file inside is opened through it
      const f = await openInside(root, 'music/tree', 'a.wav');
      await f.fd.close();
      expect(spy.mock.calls.some((c) => String(c[0]).endsWith('a.wav'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('integrity at use', () => {
  it('a file item must have its ledger size and sha256; a tree file its indexed size and mtime', async () => {
    const one = path.join(root, 'music', 'one.mp3');
    const fileItem = { entry: { item: 'x/one', path: 'music/one.mp3', kind: 'file', sha256: sha('one'), bytes: 3 }, rel: '', bytes: 3, mtimeMs: null };
    expect((await readChecked(root, fileItem, 100)).bytes.toString()).toBe('one');
    expect(await code(readChecked(root, { ...fileItem, entry: { ...fileItem.entry, sha256: sha('two') } }, 100))).toBe('library_hash_mismatch');
    expect(await code(readChecked(root, { ...fileItem, entry: { ...fileItem.entry, bytes: 4 } }, 100))).toBe('library_hash_mismatch');
    const st = fs.statSync(path.join(root, 'music', 'tree', 'a.wav'));
    const tree = { entry: { item: 'x/tree', path: 'music/tree', kind: 'archive', bytes: 8 }, rel: 'a.wav', bytes: st.size, mtimeMs: st.mtimeMs };
    const dest = path.join(base, 'copy.bin');
    expect(await copyChecked(root, tree, dest, 100)).toEqual({ sha256: sha('aaaa'), bytes: 4 });
    fs.rmSync(dest);
    expect(await code(copyChecked(root, { ...tree, mtimeMs: st.mtimeMs - 1000 }, dest, 100))).toBe('library_changed_since_index');
    expect(fs.existsSync(dest)).toBe(false);
    expect(await code(copyChecked(root, { ...tree, bytes: 5 }, dest, 100))).toBe('library_changed_since_index');
    expect(await code(copyChecked(root, tree, dest, 2))).toBe('upload_too_large');
    expect(fs.existsSync(dest)).toBe(false);
    void one;
  });
});
