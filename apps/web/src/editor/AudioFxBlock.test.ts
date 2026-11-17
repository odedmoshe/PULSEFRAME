/**
 * The sound-effects block (AudioFxBlock.tsx) decides two things without a browser, checked here: where the arrow keys move in a
 * chip row (visual order, also right to left), and which operations a chip or toggle commits. Those operations are run through
 * the real operation registry, so a chip never sends something the server refuses for a clip it offers the chip on. Also how a
 * slider shows (and announces, aria-valuetext) its number.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, AUDIO_PRESETS, audioEffectParams, createProject, describeAudioCatalog, findClip, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioFxParamUnit } from '@pulseframe/i18n';
import { chipKeyTarget, roomOps, showValue, toggleOps, voiceOps, type ParamSchema } from './AudioFxBlock.tsx';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ui${n++}_`, actor: 'test', allowInternal });
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
function project() {
  let r = tx(createProject({ id: 'prj_ui', name: 'UI', frameRate: R }), [{ op: 'import_asset', args: { asset: song } }], true);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(0), duration: f(90) } }]);
  return { doc: r.doc, id: r.results[0]!.output!.clipId as string };
}
const clipOf = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;

describe('chip rows: arrow keys in the order the chips are seen', () => {
  it('right to left: ArrowLeft is the next chip, ArrowRight the previous; Up/Down, Home/End; wrapping; other keys do nothing', () => {
    expect(chipKeyTarget('ArrowLeft', 0, 5, true)).toBe(1);
    expect(chipKeyTarget('ArrowRight', 1, 5, true)).toBe(0);
    expect(chipKeyTarget('ArrowRight', 0, 5, true)).toBe(4);
    expect(chipKeyTarget('ArrowLeft', 4, 5, true)).toBe(0);
    expect(chipKeyTarget('ArrowDown', 2, 5, true)).toBe(3);
    expect(chipKeyTarget('ArrowUp', 0, 5, true)).toBe(4);
    expect(chipKeyTarget('Home', 3, 5, true)).toBe(0);
    expect(chipKeyTarget('End', 0, 5, true)).toBe(4);
    for (const key of [' ', 'Enter', 'Tab', 'a']) expect(chipKeyTarget(key, 2, 5, true)).toBeNull(); // Space and Enter are the button's own click
  });
  it('left to right (English): ArrowRight is the next chip', () => {
    expect(chipKeyTarget('ArrowRight', 0, 5, false)).toBe(1);
    expect(chipKeyTarget('ArrowLeft', 0, 5, false)).toBe(4);
  });
});

describe('what the chips commit', () => {
  it('a voice chip adds the voice; another voice replaces it in one transaction; none removes it; the chosen chip sends nothing', () => {
    const p = project();
    const a = tx(p.doc, voiceOps(clipOf(p.doc, p.id), 'voice.telephone'));
    expect(clipOf(a.doc, p.id).audioFx!.map((x) => x.type)).toEqual(['voice.telephone']);
    const swap = voiceOps(clipOf(a.doc, p.id), 'voice.robot');
    expect(swap.map((o) => o.op)).toEqual(['remove_audio_effect', 'add_audio_effect']);
    const b = tx(a.doc, swap); // one transaction: one revision, one undo
    expect(clipOf(b.doc, p.id).audioFx!.map((x) => x.type)).toEqual(['voice.robot']);
    expect(voiceOps(clipOf(b.doc, p.id), 'voice.robot')).toEqual([]);
    expect(clipOf(tx(b.doc, voiceOps(clipOf(b.doc, p.id), 'none')).doc, p.id).audioFx).toBeUndefined();
    expect(voiceOps(clipOf(p.doc, p.id), 'none')).toEqual([]);
  });
  it('a room chip sets the reverb to that room\'s preset settings (added, or updated in place), and none removes it', () => {
    const p = project();
    const hall = tx(p.doc, roomOps(clipOf(p.doc, p.id), 'hall')).doc;
    const preset = (id: string) => audioEffectParams('space.reverb', AUDIO_PRESETS.find((x) => x.id === id)!.effects[0]!.params);
    expect(clipOf(hall, p.id).audioFx![0]!.params).toEqual(preset('hall'));
    const id = clipOf(hall, p.id).audioFx![0]!.id;
    const cave = tx(hall, roomOps(clipOf(hall, p.id), 'cave')).doc;
    expect(clipOf(cave, p.id).audioFx!.map((x) => [x.id, x.params])).toEqual([[id, preset('cave')]]); // the same effect, its settings replaced
    expect(roomOps(clipOf(cave, p.id), 'cave')).toEqual([]);
    expect(clipOf(tx(cave, roomOps(clipOf(cave, p.id), 'none')).doc, p.id).audioFx).toBeUndefined();
  });
  it('the echo and tone toggles add an effect with its defaults and remove it again', () => {
    const p = project();
    let d = p.doc;
    for (const type of ['space.echo', 'tone.bassboost', 'texture.8bit', 'utility.width']) d = tx(d, toggleOps(clipOf(d, p.id), type)).doc;
    expect(clipOf(d, p.id).audioFx!.map((x) => x.type)).toEqual(['tone.bassboost', 'texture.8bit', 'space.echo', 'utility.width']);
    for (const type of ['space.echo', 'tone.bassboost', 'texture.8bit', 'utility.width']) d = tx(d, toggleOps(clipOf(d, p.id), type)).doc;
    expect(clipOf(d, p.id).audioFx).toBeUndefined();
  });
});

describe('how a slider shows its number (also its aria-valuetext)', () => {
  const schemas = describeAudioCatalog().audioEffects.map((e) => [e.id, (e.paramsSchema as { properties: Record<string, ParamSchema & { default?: unknown }> }).properties] as const);
  it('the echo\'s «מספר חזרות» shows 4 repeats as 4, not as a percentage', () => {
    const repeats = schemas.find(([id]) => id === 'space.echo')![1].repeats!;
    expect(showValue('repeats', repeats, 4)).toBe('4');
    expect(showValue('repeats', repeats, 8)).toBe('8');
  });
  it('every numeric parameter (but the seed, a typed field) shows its own number: a fraction as a percentage of it, anything else as the number; whole-number counts are never percentages', () => {
    const wrong: string[] = [];
    for (const [id, props] of schemas) for (const [p, s] of Object.entries(props)) {
      if (p === 'seed' || (s.type !== 'number' && s.type !== 'integer')) continue;
      for (const v of [s.minimum!, s.maximum!, Number(s.default)]) {
        const shown = showValue(p, s, v);
        const pct = shown.endsWith('%');
        const fraction = s.type === 'number' && s.minimum! >= 0 && s.maximum! <= 2;
        const back = pct ? Number(shown.slice(0, -1)) / 100 : Number(shown);
        if ((pct && (!fraction || !!audioFxParamUnit(p, 'en'))) || Math.abs(back - v) > 0.005) wrong.push(`${id}.${p}=${v} shown "${shown}"`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
