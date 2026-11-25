/**
 * Integration seam (wave 7 story): pressing «מהטלפון» in the story dialog opens the phone dialog; the picture order and the options
 * chosen so far are kept, and the story dialog reopens as it was when the phone dialog is put away (the draft lives only in this
 * tab's editor state, never stored or sent). localStorage and window are stand-ins (labelled); the Editor is real.
 */
import { describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { createProject, type Asset, type ProjectDocument } from '@pulseframe/core';

// ---- labelled stand-ins (test only) ----
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('window', globalThis);
const { Editor } = await import('../store.ts');
const { defaultChoices, initialChoices } = await import('./story.logic.ts');
// ---- end of stand-ins ----

const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
function doc(): ProjectDocument {
  const d = createProject({ id: 'prj_phone', name: 'S', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
  d.assets.nar = { id: 'nar', kind: 'audio', name: 'nar.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(24, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov } as Asset;
  for (const id of ['i1', 'i2', 'i3']) d.assets[id] = { id, kind: 'image', name: `${id}.png`, contentHash: `sha256:${id.padEnd(64, '0')}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } as Asset;
  return d;
}

describe('the story dialog keeps its draft across the phone dialog', () => {
  it('«מהטלפון» closes the story dialog, opens the phone dialog, and putting the phone dialog away reopens the story with the same choices', () => {
    const e = new Editor();
    e.openStory({ assetIds: ['i1', 'i2', 'i3'], event: null });
    const chosen = { ...defaultChoices(e.getState().storySource!, doc(), 'he'), assetIds: ['i3', 'i1', 'i2'], narrationAssetId: 'nar', ownSound: 'mute' as const };
    e.storyToPhone(chosen);
    expect([e.getState().storyOpen, e.getState().phoneDropOpen]).toEqual([false, true]);
    e.hidePhoneDrop();
    expect([e.getState().storyOpen, e.getState().phoneDropOpen]).toEqual([true, false]);
    expect(initialChoices(e.getState().storySource!, doc(), 'he', e.getState().storyKept)).toEqual(chosen);
  });
  it('the kept draft drops files that left the library, and a fresh open or an ordinary close forgets it', () => {
    const e = new Editor();
    e.openStory({ assetIds: ['i1', 'i2'], event: null });
    const chosen = { ...defaultChoices(e.getState().storySource!, doc(), 'he'), assetIds: ['i2', 'i1'], narrationAssetId: 'nar', musicAssetId: 'gone' };
    e.storyToPhone(chosen);
    e.hidePhoneDrop();
    const d = doc(); delete d.assets.i1; delete d.assets.nar;
    expect(initialChoices(e.getState().storySource!, d, 'he', e.getState().storyKept)).toMatchObject({ assetIds: ['i2'], narrationAssetId: null, musicAssetId: null });
    e.closeStory();
    expect(e.getState().storyKept).toBeNull();
    e.storyToPhone(chosen); e.openStory({ assetIds: ['i3'], event: null });
    expect(e.getState().storyKept).toBeNull();
    expect(initialChoices(e.getState().storySource!, doc(), 'he', e.getState().storyKept).assetIds).toEqual(['i3']);
    // the phone dialog opened from elsewhere does not open the story when it is put away
    const f = new Editor();
    f.openPhoneDrop(); f.hidePhoneDrop();
    expect(f.getState().storyOpen).toBe(false);
  });
});
