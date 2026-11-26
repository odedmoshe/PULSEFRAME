/**
 * The sound-effects block (AudioFxBlock.tsx) decides two things without a browser, checked here: where the arrow keys move in a
 * chip row (visual order, also right to left), and which operations a chip or toggle commits. Those operations are run through
 * the real operation registry, so a chip never sends something the server refuses for a clip it offers the chip on. Also how a
 * slider shows (and announces, aria-valuetext) its number, and what the voice cleanup block «ניקוי קול» commits (ADR-0013).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, AUDIO_PRESETS, audioEffectParams, createProject, decodeNoiseProfile, describeAudioCatalog, encodeNoiseProfile, findClip, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioFxParamUnit } from '@pulseframe/i18n';
import { chipKeyTarget, roomOps, settingsParams, showValue, toggleOps, voiceOps, type ParamSchema } from './AudioFxBlock.tsx';
import { beforeOps, cleanupStrengthOf, listenLabels, measuredOps, noiseLevelDb, removeCleanupOps, reportTokens, strengthOps, tokensText } from './VoiceCleanBlock.tsx';
import { VOICE_CLEAN_STRINGS, type VoiceCleanLang } from './voiceClean.strings.ts';
import type { VoiceCheck } from '../api.ts';

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

describe('voice cleanup «ניקוי קול» (VoiceCleanBlock, ADR-0013): the operations it commits', () => {
  /** A VoiceCheck as measure_voice returns it (the measurement itself is the server's and W1's; only its shape matters here). */
  const check = (clipId: string, assetId: string, mainsHz: '50' | '60' | null, profile = encodeNoiseProfile(Array(24).fill(-55))): VoiceCheck => ({
    revision: 3, assetId, clipIds: [clipId], method: 'test', recommendedStrength: 0.6, note: 'Candidates only.',
    report: { analysedSeconds: 20, noise: { mode: 'auto', bandsDb: decodeNoiseProfile(profile), profile, quietSeconds: 6, confidence: 1, ranges: [{ start: 2.1, end: 3 }], warning: null }, hum: mainsHz ? { hz: Number(mainsHz) as 50 | 60, levelDb: -40, harmonics: 4 } : null, speech: { levelDb: -22, peakDb: -8, snrDb: 17.5 } },
    ops: [{ op: 'clean_voice', args: { clipId, includeLinked: false, strength: 0.6, profile, source: assetId, mainsHz } }],
  });
  const fxOf = (d: ProjectDocument, id: string, type: string) => clipOf(d, id).audioFx?.find((x) => x.type === type);
  it('the measured ops put the three effects on the clip with the measured profile, the recording as source and the mains frequency; the strength reads back; the clip\'s other effects stay', () => {
    const p = project();
    const assetId = clipOf(p.doc, p.id).assetId, profile = encodeNoiseProfile(Array.from({ length: 24 }, (_, j) => -60 + j / 2));
    const withEcho = tx(p.doc, toggleOps(clipOf(p.doc, p.id), 'space.echo')).doc;
    const c = check(p.id, assetId, '50', profile);
    expect(measuredOps({ ...c, ops: [...c.ops, { op: 'remove_clip', args: { clipId: p.id } }] })).toEqual(c.ops); // only clean_voice candidates are committed
    const d = tx(withEcho, measuredOps(c)).doc;
    expect(clipOf(d, p.id).audioFx!.map((x) => x.type)).toEqual(['cleanup.dehum', 'cleanup.denoise', 'cleanup.speech', 'space.echo']);
    expect(fxOf(d, p.id, 'cleanup.denoise')!.params).toMatchObject({ profile, source: assetId });
    expect(fxOf(d, p.id, 'cleanup.dehum')!.params.mainsHz).toBe('50');
    expect(cleanupStrengthOf(clipOf(d, p.id))).toBe(0.6);
    expect(cleanupStrengthOf(clipOf(withEcho, p.id))).toBeNull();
    expect(strengthOps(clipOf(withEcho, p.id), 0.5)).toEqual([]); // nothing to re-commit without a cleanup
  });
  it('the strength slider re-commits clean_voice keeping the profile, the source and the mains frequency (and only the parts the clip carries); «הסר ניקוי» removes the cleanup and keeps the rest', () => {
    const p = project();
    const assetId = clipOf(p.doc, p.id).assetId, profile = encodeNoiseProfile(Array(24).fill(-48));
    let d = tx(p.doc, toggleOps(clipOf(p.doc, p.id), 'tone.bassboost')).doc;
    d = tx(d, measuredOps(check(p.id, assetId, '60', profile))).doc;
    const ids = clipOf(d, p.id).audioFx!.filter((x) => x.type.startsWith('cleanup.')).map((x) => x.id);
    const ops = strengthOps(clipOf(d, p.id), 0.9);
    expect(ops).toEqual([{ op: 'clean_voice', args: { clipId: p.id, includeLinked: false, strength: 0.9, mainsHz: '60', denoise: true, speech: true, profile, source: assetId } }]);
    const up = tx(d, ops).doc;
    expect(clipOf(up, p.id).audioFx!.filter((x) => x.type.startsWith('cleanup.')).map((x) => x.id)).toEqual(ids); // replaced in place, same ids
    expect(fxOf(up, p.id, 'cleanup.denoise')!.params).toMatchObject({ profile, source: assetId, reductionDb: 18.6 });
    expect(fxOf(up, p.id, 'cleanup.dehum')!.params).toMatchObject({ mainsHz: '60', harmonics: 6 });
    expect(cleanupStrengthOf(clipOf(up, p.id))).toBe(0.9);
    // the user took the speech enhancer out: the strength keeps it out; no hum: no hum removal comes back
    const noSpeech = tx(up, [{ op: 'remove_audio_effect', args: { clipId: p.id, effectId: fxOf(up, p.id, 'cleanup.speech')!.id } }]).doc;
    expect(clipOf(tx(noSpeech, strengthOps(clipOf(noSpeech, p.id), 0.3)).doc, p.id).audioFx!.map((x) => x.type)).toEqual(['cleanup.dehum', 'cleanup.denoise', 'tone.bassboost']);
    const humless = tx(tx(p.doc, []).doc, measuredOps(check(p.id, assetId, null))).doc;
    expect(strengthOps(clipOf(humless, p.id), 0.4)[0]!.args).toMatchObject({ mainsHz: null });
    expect(clipOf(tx(humless, strengthOps(clipOf(humless, p.id), 0.4)).doc, p.id).audioFx!.map((x) => x.type)).toEqual(['cleanup.denoise', 'cleanup.speech']);
    // remove
    expect(clipOf(tx(up, removeCleanupOps(clipOf(up, p.id))).doc, p.id).audioFx!.map((x) => x.type)).toEqual(['tone.bassboost']);
  });
  it('«לפני» plays a scratch copy with the cleanup switched off (nothing else changes); «אחרי» the clip as it is', () => {
    const p = project();
    const d = tx(tx(p.doc, toggleOps(clipOf(p.doc, p.id), 'space.echo')).doc, measuredOps(check(p.id, clipOf(p.doc, p.id).assetId, '50'))).doc;
    const draft = tx(d, beforeOps(clipOf(d, p.id))).doc;
    expect(clipOf(draft, p.id).audioFx!.map((x) => [x.type, x.enabled])).toEqual([['cleanup.dehum', false], ['cleanup.denoise', false], ['cleanup.speech', false], ['space.echo', true]]);
    expect(beforeOps(clipOf(draft, p.id))).toEqual([]);
  });
  it('the noise profile and the recording it was measured on are never shown as controls; every other parameter is', () => {
    for (const e of describeAudioCatalog().audioEffects) {
      const props = (e.paramsSchema as { properties: Record<string, ParamSchema> }).properties, shown = settingsParams(e.id, null).map(([p]) => p);
      for (const [p, s] of Object.entries(props)) expect(shown.includes(p), `${e.id}.${p}`).toBe(!(s.type === 'string' && !s.enum));
    }
    expect(settingsParams('cleanup.denoise', 'amount').map(([p]) => p)).toEqual(['reductionDb', 'sensitivityDb']);
    expect(settingsParams('cleanup.dehum', 'amount').map(([p]) => p)).toEqual(['mainsHz', 'harmonics', 'width']);
  });
  it('the status line says what was measured, in Hebrew, with the numbers apart (noise over the bands, hum, speech, signal to noise, confidence, warnings in words)', () => {
    const c = check('c', 'a', '50', encodeNoiseProfile(Array(24).fill(-50)));
    expect(noiseLevelDb(Array(24).fill(-50))).toBeCloseTo(-50 + 10 * Math.log10(19950 / 24000), 9);
    const he = reportTokens(c.report, 'he'), text = tokensText(he);
    expect(he.filter((x) => 'n' in x).map((x) => (x as { n: string }).n)).toEqual(['-50.8', '50', '-40.0', '-22.0', '17.5', '100%']);
    expect(text).toMatch(/^נמדד: רעש רקע -50\.8 דציבל ביחס לשיא · זמזום חשמל 50 הרץ/);
    for (const x of he) if ('t' in x) expect(/[0-9]/.test(x.t), x.t).toBe(false); // every number is its own token (shown in a left-to-right isolate)
    const quiet = { ...c.report, hum: null, speech: { levelDb: null, peakDb: -60, snrDb: null }, noise: { ...c.report.noise, warning: 'no_pause_found' as const, confidence: 0.02 } };
    expect(tokensText(reportTokens(quiet, 'he'))).toMatch(/לא נמצא זמזום חשמל · דיבור לא ידוע · יחס אות לרעש לא ידוע · ביטחון במדידת הרעש 2%\. לא נמצאה הפסקה שקטה/);
    expect(tokensText(reportTokens(c.report, 'en'))).toMatch(/^Measured: background noise -50\.8 dBFS · mains hum 50 Hz/);
  });
});

describe('▶ «לפני» / ▶ «אחרי»: the accessible name contains the visible label (WCAG 2.5.3 Label in Name)', () => {
  it('in every language the name begins with the visible word, so saying «לפני» or «אחרי» reaches the button; the name still says nothing is saved', () => {
    for (const lang of Object.keys(VOICE_CLEAN_STRINGS) as VoiceCleanLang[]) for (const which of ['before', 'after'] as const) {
      const { text, name } = listenLabels(which, lang);
      const word = text.replace(/^▶\s*/, '');
      expect(word, `${lang} ${which}: a visible word`).toBe(VOICE_CLEAN_STRINGS[lang][which]);
      expect(name.startsWith(word), `${lang} ${which}: «${name}» begins with «${word}»`).toBe(true);
      expect(name.length, `${lang} ${which}: the name says more than the word`).toBeGreaterThan(word.length + 5);
    }
  });
});
