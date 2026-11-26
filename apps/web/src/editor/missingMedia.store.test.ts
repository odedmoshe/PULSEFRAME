/**
 * A stored file missing on disk, in the real Editor (store.ts checkMedia / previewFailed): preview frames that failed before the
 * missing-media list arrived are not errors once another check brought the list (and drew the frame again without the file); a frame
 * drawn with the list that still fails is said in the error bar, as before. Seen in a browser (2026-11-26): two frames stepped through
 * while the list was slow left «asset …: HTTP 404» in the error bar under a clip already shown as missing (the a11y audit's state
 * missing-media requires no error alert). The server answers, the media pool and the player are stand-ins (labelled); the Editor is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@pulseframe/core';
import { api } from '../api.ts';
import type { MediaPool } from '../media.ts';
import type { Player } from '../player.ts';

// ---- labelled stand-ins (test only) ----
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { Editor } = await import('./store.ts');
// ---- end of stand-ins ----

afterEach(() => { vi.restoreAllMocks(); });

const setup = () => {
  const ed = new Editor();
  const doc = createProject({ id: 'prj_mm', name: 'MM', width: 640, height: 360 });
  ed.set({ doc, rawDoc: doc, revision: 1 });
  let missing = new Set<string>();
  ed.pool = { setMissing: (ids: readonly string[]) => { const next = new Set(ids); const same = next.size === missing.size && [...next].every((x) => missing.has(x)); missing = next; return !same; } } as unknown as MediaPool;
  const seeks: number[] = [];
  ed.player = { playing: false, frame: 3, seek: (f: number) => { seeks.push(f); } } as unknown as Player;
  // each request for the list waits until the test answers it, in the order the test chooses
  const answers: ((v: { missing: string[] }) => void)[] = [];
  vi.spyOn(api, 'missingMedia').mockImplementation(() => new Promise((r) => { answers.push(r); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failed = (e: unknown) => (ed as unknown as { previewFailed(pid: string, e: unknown): Promise<void> }).previewFailed(doc.id, e);
  return { ed, doc, seeks, answers, failed };
};
const err = new Error('asset ast_gone: HTTP 404');

describe('preview frames and the missing-media list', () => {
  it('two frames that failed before the slow list arrived: no error once the load\'s check brings the list; the frame is drawn again', async () => {
    const { ed, doc, seeks, answers, failed } = setup();
    const load = ed.checkMedia(doc.id); // asked for on load
    const f1 = failed(err), f2 = failed(err); // two frames stepped through, each failing on the missing file, each asking again
    expect(answers).toHaveLength(3);
    answers[0]!({ missing: ['ast_gone'] });
    expect(await load).toBe(true);
    answers[1]!({ missing: ['ast_gone'] });
    answers[2]!({ missing: ['ast_gone'] });
    await Promise.all([f1, f2]);
    expect(ed.getState().missingMedia).toEqual(['ast_gone']);
    expect(ed.getState().error).toBeNull();
    expect(seeks).toEqual([3]); // drawn again once, by the check that brought the list
  });
  it('the same when a failed frame\'s own check brings the list first', async () => {
    const { ed, doc, answers, failed } = setup();
    const load = ed.checkMedia(doc.id);
    const f1 = failed(err), f2 = failed(err);
    answers[1]!({ missing: ['ast_gone'] });
    await f1;
    answers[2]!({ missing: ['ast_gone'] });
    answers[0]!({ missing: ['ast_gone'] });
    await Promise.all([load, f2]);
    expect(ed.getState().error).toBeNull();
  });
  it('a frame drawn with the list that fails is still said: retried once per list, then the error bar', async () => {
    const { ed, doc, answers, failed } = setup();
    const load = ed.checkMedia(doc.id);
    answers[0]!({ missing: ['ast_gone'] });
    await load;
    const f1 = failed(new Error('decode failed'));
    answers[1]!({ missing: ['ast_gone'] });
    await f1;
    expect(ed.getState().error).toBeNull(); // the once-per-list retry
    const f2 = failed(new Error('decode failed'));
    answers[2]!({ missing: ['ast_gone'] });
    await f2;
    expect(ed.getState().error).toBe('decode failed');
  });
});
