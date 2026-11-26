/**
 * The export retry plans its snapshot as it is (wave 8 audiences, verifier C1; lead pre-pass). A retry re-runs the job's immutable
 * snapshot, which is ALREADY the projected document of the linked format; before this change `plan` projected it a second time through
 * the variant entry the snapshot still carries. Every override of today's formats happens to give the same document twice, but a
 * version for an audience scales sizes (×4/3) and levels, which must apply exactly once — and no marker in the data says "applied".
 * Here the snapshot's own variant entry is changed after the snapshot was made (it stands in for a rule that is not idempotent): a
 * retry that re-projects would render 720×720; the planned and rendered frame is 360×360.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { Exporter, renderDocFor } from './export.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
let dir: string, store: Store, exporter: Exporter;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-export-retry-'));
  store = new Store(dir);
  // a stand-in web bundle holding only a font file of the default family, so a title plans without renderer_unavailable (nothing renders here)
  fs.mkdirSync(path.join(dir, 'web', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web', 'assets', 'heebo-hebrew-700-normal.woff2'), 'stand-in');
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'web'));
});
afterAll(async () => {
  await (exporter as unknown as { queue: Promise<void> }).queue; // the retried job fails at once (no render host); let it settle
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('export retry (C1)', () => {
  it('a retry of a format export plans the snapshot as resolved: the format is not projected a second time', () => {
    const pid = store.createProject({ name: 'retry', width: 640, height: 360, frameRate: R }).doc.id;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(30, R) } }] });
    const added = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_variant', args: { width: 360, height: 360, name: 'sq' } }] });
    const variantId = added.results[0]!.output!.variantId as string;
    const p = store.getProject(pid);
    const first = exporter.plan(p.doc, p.revision, { variantId });
    expect(first.blockers).toEqual([]);
    expect(first.manifest.output).toMatchObject({ width: 360, height: 360 });
    const snapshot = renderDocFor(p.doc, first.manifest.options) as ProjectDocument;
    expect(snapshot.settings).toMatchObject({ width: 360, height: 360 });
    // what a second projection would do: the variant entry inside the snapshot now asks for 720×720
    snapshot.variants[variantId] = { ...snapshot.variants[variantId]!, width: 720, height: 720 };
    const job = store.createJob(pid, 'export', 'user:owner', { revision: p.revision, snapshot, sidecar: null, manifest: first.manifest, warnings: first.warnings, retryOf: null });
    store.updateJob(job.id, { status: 'failed', error: { code: 'export_failed', message: 'test', retryable: true } });
    const again = exporter.retry(job.id, 'user:owner');
    expect(again.input.manifest.output).toMatchObject({ width: 360, height: 360 });
    expect(again.input.snapshot.settings).toMatchObject({ width: 360, height: 360 });
    expect(again.input.retryOf).toBe(job.id);
  });
  it('plan with resolved leaves the document as it is; without it the named format is projected', () => {
    const pid = store.createProject({ name: 'resolved', width: 640, height: 360, frameRate: R }).doc.id;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(30, R) } }] });
    const variantId = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_variant', args: { width: 360, height: 640, name: 'v' } }] }).results[0]!.output!.variantId as string;
    const p = store.getProject(pid);
    expect(exporter.plan(p.doc, p.revision, { variantId }).manifest.output).toMatchObject({ width: 360, height: 640 });
    expect(exporter.plan(p.doc, p.revision, { variantId }, { resolved: true }).manifest.output).toMatchObject({ width: 640, height: 360 });
  });
  it.todo('W2: a retry of a grandparents export renders titles ×4/3 once (the same frame hashes as the first run), once W1 has built the scale');
});
