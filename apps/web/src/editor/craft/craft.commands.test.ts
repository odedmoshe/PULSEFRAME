import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type ProjectDocument } from '@pulseframe/core';
import { CRAFT_COMMANDS } from './craft.commands.ts';
import { craftSurface } from './craft.state.ts';
import type { Editor } from '../store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const doc0 = createProject({ id: 'p', name: 't' });
const made = applyTransaction(doc0, [{ op: 'add_text', args: { text: 'a', start: f(0), duration: f(30) } }], { idSeed: 't', actor: 'test' });
const doc: ProjectDocument = made.doc;
const id = Object.values(doc.sequences)[0]!.tracks.flatMap((t) => t.clips)[0]!.id;
const fake = (o: { frame: number; selection?: string[]; clipboard?: string[]; viewVariantId?: string | null; notes?: unknown[] }) => ({
  doc, rate: R, frame: o.frame, clipboardLive: o.clipboard ?? [], player: { frameCount: 120 },
  getState: () => ({ selection: o.selection ?? [], activeSequenceId: doc.mainSequenceId, viewVariantId: o.viewVariantId ?? null, lang: 'he' }),
  notify: (n: unknown) => { o.notes?.push(n); },
}) as unknown as Editor;
const cmd = (cid: string) => CRAFT_COMMANDS.find((c) => c.id === cid)!;

describe('the craft commands', () => {
  it('Q and W are enabled only with the playhead strictly inside the one selected clip', () => {
    for (const cid of ['edit.rippleTrimStart', 'edit.rippleTrimEnd']) {
      expect(cmd(cid).enabled!(fake({ frame: 15, selection: [id] }))).toBe(true);
      expect(cmd(cid).enabled!(fake({ frame: 0, selection: [id] }))).toBe(false);
      expect(cmd(cid).enabled!(fake({ frame: 30, selection: [id] }))).toBe(false);
      expect(cmd(cid).enabled!(fake({ frame: 15, selection: [] }))).toBe(false);
    }
  });
  it('the physical keys are the decided ones and no two craft commands share a chord', () => {
    expect(Object.fromEntries(CRAFT_COMMANDS.map((c) => [c.id, c.keys]))).toEqual({
      'edit.rippleTrimStart': ['KeyQ'], 'edit.rippleTrimEnd': ['KeyW'], 'transport.gotoTime': ['KeyG'], 'edit.setDuration': ['KeyD'],
      'edit.pasteAttributes': ['Mod+Alt+KeyV'], 'view.findReplace': ['Mod+KeyF'], 'file.saveVersion': ['Mod+KeyS'], 'view.versions': [],
    });
  });
  it('G, D, find, save and versions open their surface; paste with a format shown says why instead', () => {
    craftSurface.set(null);
    cmd('transport.gotoTime').run(fake({ frame: 0 }));
    expect(craftSurface.get()).toEqual({ kind: 'time', target: 'goto' });
    cmd('edit.setDuration').run(fake({ frame: 0, selection: [id] }));
    expect(craftSurface.get()).toEqual({ kind: 'time', target: 'duration' });
    cmd('view.findReplace').run(fake({ frame: 0 }));
    expect(craftSurface.get()).toEqual({ kind: 'find' });
    cmd('file.saveVersion').run(fake({ frame: 0 }));
    expect(craftSurface.get()).toEqual({ kind: 'saveVersion' });
    craftSurface.set(null);
    const notes: unknown[] = [];
    cmd('edit.pasteAttributes').run(fake({ frame: 0, selection: [id], viewVariantId: 'var_1', notes }));
    expect(craftSurface.get()).toBeNull();
    expect(JSON.stringify(notes)).toContain('כשמוצג פורמט אחר');
    cmd('edit.pasteAttributes').run(fake({ frame: 0, selection: [id] }));
    expect(craftSurface.get()).toEqual({ kind: 'paste' });
    craftSurface.set(null);
  });
  it('D with more than 200 clips selected says so and opens nothing', () => {
    craftSurface.set(null);
    const notes: unknown[] = [];
    cmd('edit.setDuration').run(fake({ frame: 0, selection: Array.from({ length: 201 }, (_, i) => `c${i}`), notes }));
    expect(craftSurface.get()).toBeNull();
    expect(JSON.stringify(notes)).toContain('עד 200 קליפים בבת אחת');
  });
});
