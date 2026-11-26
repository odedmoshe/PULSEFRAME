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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * LABELLED STAND-IN (test only) until W1's audience rules are merged: audience.ts says it is built (so add_audience_version runs), and
 * projectVariant applies ONE grandparents rule at its end — every title's size × 4/3, capped at 0.5 — the rule that must apply exactly
 * once (it is not idempotent). Once core's AUDIENCE_PROJECTION_BUILT is true, both modules are the real ones and this test runs W1's code.
 */
const realRules = vi.hoisted(() => ({ built: false }));
vi.mock('../../../packages/core/src/audience.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../packages/core/src/audience.ts')>();
  realRules.built = real.AUDIENCE_PROJECTION_BUILT;
  return real.AUDIENCE_PROJECTION_BUILT ? real : { ...real, AUDIENCE_PROJECTION_BUILT: true };
});
vi.mock('../../../packages/core/src/variants.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../packages/core/src/variants.ts')>();
  const projectVariant: typeof real.projectVariant = (...args) => {
    const out = real.projectVariant(...args);
    const [doc, variantId] = args;
    if (!realRules.built && doc.variants[variantId]?.audience?.profile === 'grandparents')
      for (const seq of Object.values(out.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.type === 'text') c.style = { ...c.style, sizeFrac: Math.min(0.5, (c.style.sizeFrac * 4) / 3) };
    return out;
  };
  return { ...real, projectVariant };
});

import * as T from '@pulseframe/time';
import type { ProjectDocument, TextClip } from '@pulseframe/core';
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
  it('a retry of a grandparents export plans its snapshot as it is: titles ×4/3 once, the same snapshot and manifest as the first run', () => {
    const pid = store.createProject({ name: 'retry-gp', width: 640, height: 360, frameRate: R }).doc.id;
    const added = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(30, R) } }] });
    const clipId = added.results[0]!.output!.clipId as string;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'update_text', args: { clipId, style: { sizeFrac: 0.09 } } }] });
    const variantId = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_audience_version', args: { profile: 'grandparents' } }] }).results[0]!.output!.variantId as string;
    const p = store.getProject(pid);
    const sizeIn = (d: ProjectDocument) => (d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) as TextClip).style.sizeFrac;
    expect(sizeIn(p.doc)).toBe(0.09);
    const first = exporter.plan(p.doc, p.revision, { variantId });
    expect(first.blockers).toEqual([]);
    const snapshot = renderDocFor(p.doc, first.manifest.options) as ProjectDocument;
    const once = Math.min(0.5, (0.09 * 4) / 3); // by hand: the inherited size × 4/3 under the cap
    expect(sizeIn(snapshot)).toBe(once);
    const job = store.createJob(pid, 'export', 'user:owner', { revision: p.revision, snapshot, sidecar: null, manifest: first.manifest, warnings: first.warnings, retryOf: null });
    store.updateJob(job.id, { status: 'failed', error: { code: 'export_failed', message: 'test', retryable: true } });
    const again = exporter.retry(job.id, 'user:owner');
    expect(sizeIn(again.input.snapshot as ProjectDocument)).toBe(once); // not × 16/9
    expect(again.input.snapshot).toEqual(snapshot);
    expect(again.input.manifest).toEqual(first.manifest);
    // the control: planning the snapshot as unresolved WOULD scale again (what C1 prevents)
    expect(sizeIn(renderDocFor(snapshot, first.manifest.options) as ProjectDocument)).toBe(Math.min(0.5, (once * 4) / 3));
  });
});
