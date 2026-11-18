/** Review fixes: key selection follows the clip selection, channel names are right and translated, blur commits only a change. */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall } from '@pulseframe/core';
import { createT } from '@pulseframe/i18n';
import { COMMANDS } from './commands.ts';
import { Editor } from './store.ts';
import { channelName } from './keyStrip.math.ts';
import { handlesDiffer } from './curvePicker.math.ts';

const rate = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, rate);

function setup() {
  let doc = createProject({ id: 'prj_r', name: 'R' });
  const a = applyTransaction(doc, [{ op: 'add_text', args: { text: 'א', start: f(0), duration: f(90) } }], { idSeed: 'a_', actor: 'test' });
  const clipId = a.results[0]!.affectedIds[0]!;
  const k = applyTransaction(a.doc, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(10), value: 0.1 } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: f(20), value: 0.2 } }], { idSeed: 'b_', actor: 'test' });
  doc = k.doc;
  return { doc, clipId };
}
function editor(doc: ReturnType<typeof setup>['doc'], selection: string[], clipId: string, lang: 'he' | 'en' = 'en') {
  const e = Object.create(Editor.prototype) as Editor;
  const sent: OpCall[][] = [];
  Object.assign(e, {
    state: { doc, viewVariantId: null, selection, lang, keySel: { clipId, keys: [{ channel: { property: 'x' }, frame: 10 }] }, keyClipboard: null },
    getState: () => (e as unknown as { state: object }).state,
    viewCache: null,
    player: { frame: 0, playing: false },
    commit: (ops: OpCall[] | (() => OpCall[] | null)) => { const l = typeof ops === 'function' ? ops() : ops; if (l) sent.push(l); return Promise.resolve(null); },
  });
  return { e, sent };
}

describe('key commands need the key clip to be the selected clip', () => {
  const { doc, clipId } = setup();
  it('are disabled and write nothing when another clip is selected', () => {
    const { e, sent } = editor(doc, ['other'], clipId);
    for (const id of ['keyframe.linear', 'keyframe.copy', 'keyframe.curve']) {
      const c = COMMANDS.find((x) => x.id === id)!;
      expect(c.enabled?.(e), id).toBeFalsy();
      void c.run(e);
    }
    expect(sent).toHaveLength(0);
  });
  it('work when the key clip is the one selected clip', () => {
    const { e, sent } = editor(doc, [clipId], clipId);
    const c = COMMANDS.find((x) => x.id === 'keyframe.linear')!;
    expect(c.enabled?.(e)).toBe(true);
    void c.run(e);
    expect(sent).toHaveLength(1);
  });
  it('select() lets the key selection go', () => {
    const { e } = editor(doc, [clipId], clipId);
    const sets: object[] = [];
    (e as unknown as { set: (p: object) => void }).set = (p) => sets.push(p);
    e.select('other');
    expect(sets[0]).toMatchObject({ selection: ['other'], keySel: null });
    sets.length = 0;
    e.select(clipId);
    expect(sets[0]).not.toHaveProperty('keySel');
  });
});

describe('channelName', () => {
  const { doc, clipId } = setup();
  const clip = Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === clipId)!;
  it('names y as the vertical position, in both languages', () => {
    expect(channelName(clip, { property: 'y' }, createT('en'), 'en')).toBe('Vertical position');
    expect(channelName(clip, { property: 'y' }, createT('he'), 'he')).toBe('מיקום אנכי');
    expect(channelName(clip, { property: 'x' }, createT('en'), 'en')).toBe('Horizontal position');
  });
  it('names an effect parameter by its label, not its schema id', () => {
    const withFx = applyTransaction(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }], { idSeed: 'c_', actor: 'test' });
    const c2 = Object.values(withFx.doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === clipId)!;
    const fx = (c2 as { effects?: { id: string }[] }).effects![0]!;
    const en = channelName(c2, { effectId: fx.id, param: 'radius' }, createT('en'), 'en');
    expect(en).toBe('Blur · Radius');
    expect(channelName(c2, { effectId: fx.id, param: 'radius' }, createT('he'), 'he')).toBe('טשטוש · רדיוס');
  });
});

describe('custom curve fields', () => {
  it('differ only when a handle changed', () => {
    expect(handlesDiffer([0.25, 0.1, 0.25, 1], [0.25, 0.1, 0.25, 1])).toBe(false);
    expect(handlesDiffer([0.25, 0.1, 0.25, 1], [0.3, 0.1, 0.25, 1])).toBe(true);
  });
});
