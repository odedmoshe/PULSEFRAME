/**
 * Perform mode works on the master only (ADR-0025; plan corrected notes, variant_view): entering the workspace leaves a viewed
 * linked format, and while it is chosen a format cannot be chosen (the format prism in the stage header calls setViewVariant);
 * the refused format is remembered for the view's note (perform.masterOnly). The Editor is real; localStorage is a stand-in.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyTransaction, createProject } from '@pulseframe/core';

// ---- labelled stand-ins (test only) ----
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { Editor } = await import('../store.ts');
// ---- end of stand-ins ----

const doc = applyTransaction(createProject({ id: 'prj_pv', name: 'PV', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } }), [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }], { idSeed: 'pv_', actor: 't' }).doc;
const variant = Object.keys(doc.variants)[0]!;

describe('perform mode shows the master only', () => {
  it('entering perform leaves the viewed format; choosing one inside perform is refused and noted; after leaving it works again', () => {
    const ed = new Editor();
    ed.set({ doc, rawDoc: doc, revision: 1, lang: 'en', workspace: 'pro' });
    ed.setViewVariant(variant);
    expect(ed.getState().viewVariantId).toBe(variant);
    ed.setWorkspace('perform');
    expect(ed.getState().viewVariantId).toBeNull();
    expect(ed.getState().performLeftVariant).toBe(variant);
    ed.set({ performLeftVariant: null });
    ed.setViewVariant(variant); // the format prism, inside perform
    expect(ed.getState().viewVariantId).toBeNull();
    expect(ed.getState().performLeftVariant).toBe(variant);
    ed.setViewVariant(null); // back to the master is always allowed
    expect(ed.getState().viewVariantId).toBeNull();
    ed.setWorkspace('pro');
    ed.setViewVariant(variant);
    expect(ed.getState().viewVariantId).toBe(variant);
  });
});

describe('a take is committed on the sequence it was performed on', () => {
  const two = applyTransaction(createProject({ id: 'prj_seq', name: 'S', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } }), [{ op: 'add_sequence', args: { name: 'Short', tracks: 'empty' } }], { idSeed: 'sq_', actor: 't' }).doc;
  const other = Object.keys(two.sequences).find((k) => k !== two.mainSequenceId)!;
  const run = async (active: string) => {
    const { api } = await import('../../api.ts');
    const seen: unknown[] = [];
    const spy = vi.spyOn(api, 'performTake').mockImplementation(async (_id: string, body: unknown) => { seen.push(body); throw new Error('stop'); });
    const ed = new Editor();
    ed.set({ doc: two, rawDoc: two, activeSequenceId: active, revision: 3, lang: 'en', workspace: 'perform' });
    await ed.commitTake({ taps: [], bank: [], assets: [], settings: {}, gpu: false } as never);
    spy.mockRestore();
    return seen[0] as { sequenceId?: string; expectedRevision: number };
  };
  it('names the active sequence when it is not the main one, and leaves it out for the main sequence', async () => {
    expect((await run(other)).sequenceId).toBe(other);
    expect((await run(two.mainSequenceId)).sequenceId).toBeUndefined();
  });
});
