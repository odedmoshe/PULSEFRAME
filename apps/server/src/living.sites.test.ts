/**
 * «תמונה חיה» (wave 8 living, verifier C11, LD4): the server's copiers keep the owner's drawn depth as ordinary document data, like a
 * mask — a named version (craft/versions.ts, the whole document) and both archive modes (archive.ts: the document as it is, or
 * peoplePrivacy.ts withoutFamily). The core copiers are packages/core/src/livingSites.test.ts. Fixtures are synthetic.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { findClip, type ClipDepth, type MediaClip, type OpCall } from '@pulseframe/core';
import { Governance, type Principal } from './governance.ts';
import { Store } from './store.ts';
import { saveVersion, versionDoc } from './craft/versions.ts';
import { withoutFamily } from './peoplePrivacy.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const PHOTO = { kind: 'image' as const, name: 'גן.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
const DEPTH: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 400 }, strokes: [{ layer: 'near', size: 120, pts: [500, 600, 520, 640] }] };

let dir: string, store: Store, gov: Governance, pid: string, clip: string;
const commit = (ops: OpCall[]) => store.commit({ projectId: pid, actor: 'user:local', ops, allowInternal: true });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-living-'));
  store = new Store(dir);
  gov = new Governance(store);
  pid = store.createProject({ name: 'תמונה חיה', width: 640, height: 360, frameRate: R }).doc.id;
  commit([{ op: 'import_asset', args: { asset: PHOTO } }]);
  const asset = Object.keys(store.wholeProject(pid).doc.assets)[0]!;
  const r = commit([{ op: 'add_clip', args: { assetId: asset, start: f(0), duration: f(150) } }]);
  clip = (r.results[0]!.output as { clipId: string }).clipId;
  commit([{ op: 'set_clip_depth', args: { clipId: clip, depth: DEPTH } }, { op: 'add_person', args: { name: 'נועה', birthDate: '2016-11-04', form: 'f' } }]);
});
afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const depthOf = (doc: Parameters<typeof findClip>[0]) => (findClip(doc, clip)!.clip as MediaClip).depth;
describe('server copiers of the drawn depth', () => {
  it('a named version keeps it (the whole document)', () => {
    const v = saveVersion(store, gov, OWNER, pid, 'לפני');
    commit([{ op: 'set_clip_depth', args: { clipId: clip, depth: null } }]);
    expect(depthOf(versionDoc(store, OWNER, pid, v.id))).toEqual(DEPTH);
    expect(depthOf(store.wholeProject(pid).doc)).toBeUndefined();
  });
  it('the archive keeps it with family details and without them (withoutFamily keeps masks and drawings)', () => {
    const doc = store.wholeProject(pid).doc;
    expect(depthOf(doc)).toEqual(DEPTH);
    const free = withoutFamily(doc).doc;
    expect(Object.keys(free.people ?? {})).toEqual([]);
    expect(depthOf(free)).toEqual(DEPTH);
  });
});
