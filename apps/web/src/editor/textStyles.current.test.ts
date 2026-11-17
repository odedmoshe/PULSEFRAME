import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, TEXT_PRESETS, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { currentTextPresetId } from './textStyles.current.ts';

describe('currentTextPresetId', () => {
  let n = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `s${n++}_`, actor: 'test' });
  const make = (presetId: string | null, tweak?: Record<string, unknown>) => {
    const r = tx(createProject({ id: 'prj_t', name: 'T', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } }), [{ op: 'add_text', args: { text: 'x', start: { value: '0', timescale: 30 }, duration: { value: '90', timescale: 30 } } }]);
    const clipId = String((r.results[0] as { output?: Record<string, unknown> }).output?.clipId);
    let doc = r.doc;
    if (presetId) doc = tx(doc, [{ op: 'apply_text_preset', args: { clipId, presetId } }]).doc;
    const clip = Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === clipId)!;
    return tweak ? { ...clip, style: { ...(clip as { style: object }).style, ...tweak } } : clip;
  };
  it('recognises each style the op applied', () => {
    for (const p of TEXT_PRESETS.slice(0, 12)) {
      const id = currentTextPresetId(make(p.id) as never, TEXT_PRESETS);
      const got = TEXT_PRESETS.find((x) => x.id === id)!;
      // a style may share its fields with an earlier one; it must at least be indistinguishable from the one applied
      expect(got.style).toEqual(p.style);
    }
  });
  it('a hand-edited title has no current style', () => {
    expect(currentTextPresetId(make('classic-outline', { color: '#123456' }) as never, TEXT_PRESETS)).toBeNull();
  });
});
