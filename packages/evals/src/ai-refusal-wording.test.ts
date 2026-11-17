/**
 * Keeps the Hebrew wording of the AI-model wave's refusals (packages/i18n/src/refusals.ts, AI_REFUSAL_PATTERNS; ADR-0017) in step
 * with the operations' own messages: each refusal is provoked for real, and every pattern must be provoked by one case.
 * The derived assets are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, OpError, sha256Hex, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { AI_REFUSAL_PATTERNS, dictionaries, translateRefusal } from '../../i18n/src/index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `aw${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const derived = (src: string, extra: Record<string, unknown> = {}) => ({ origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.enhance', capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: {}, ...extra } });

describe('Hebrew wording of the AI-model wave refusals', () => {
  it('every refusal is recognised and worded in Hebrew, and every pattern is provoked', () => {
    let r = tx(createProject({ id: 'prj_aw', name: 'W' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: { ...video, name: 'b.mp4', contentHash: hash('2') } } }], true);
    const [vid, oth] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    r = tx(r.doc, [
      { op: 'import_asset', args: { asset: { ...video, name: 'late.mp4', contentHash: hash('3'), duration: T.rt(2, 1), provenance: derived(vid, { sourceRangeStart: T.rt(5, 1) }) } } },
      { op: 'import_asset', args: { asset: { ...video, name: 'untimed.mp4', contentHash: hash('4'), provenance: derived(vid) } } },
      { op: 'import_asset', args: { asset: { ...video, name: 'still.png', kind: 'image', contentHash: hash('5'), duration: T.ZERO, video: undefined, audio: undefined, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: derived(vid) } } },
      { op: 'import_asset', args: { asset: { ...video, name: 'voice.wav', kind: 'audio', contentHash: hash('6'), video: undefined, provenance: derived(vid, { sourceRangeStart: T.ZERO }) } } },
      { op: 'import_asset', args: { asset: { ...video, name: 'mute.mp4', contentHash: hash('7'), audio: undefined, provenance: derived(vid, { sourceRangeStart: T.ZERO }) } } },
    ], true);
    const [late, untimed, grab, voice, mute] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string];
    r = tx(r.doc, [
      { op: 'add_clip', args: { assetId: vid, start: f(0), sourceIn: f(30), duration: f(60) } },
      { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } },
      { op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [{ start: T.rt(1, 1), duration: T.rt(1, 1), text: 'שלום' }] } },
      { op: 'add_variant', args: { profileId: 'square-1x1' } },
      { op: 'add_caption_track', args: { mode: 'transcript' } },
    ]);
    const clip = r.results[0]!.output!.clipId as string, sound = r.results[0]!.output!.audioClipId as string, title = r.results[1]!.output!.clipId as string, square = r.results[3]!.output!.variantId as string;
    const seg = r.doc.transcripts[vid]!.segments[0]!.id;
    const d = r.doc;
    const frozen = structuredClone(d); (findClip(frozen, clip)!.clip as MediaClip).freeze = true;
    const reversed = tx(d, [{ op: 'set_clip_reverse', args: { clipId: clip, reverse: true } }]).doc;
    const translation = (ids: string[]) => ({ from: 'he', to: 'en', engine: 'fixture', model: 'fixture', createdAt: '2026-11-17T00:00:00Z', createdBy: 'test', sources: Object.fromEntries(ids.map((id) => [id, sha256Hex('x')])) });
    const tr = tx(d, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'EN', language: 'en', translation: translation([seg]), phraseText: { [seg]: 'Hello' }, cueText: {} } }], true);
    const en = tr.results[0]!.output!.variantId as string;
    const reviewed = tx(tr.doc, [{ op: 'review_translation', args: { variantId: en, review: 'reviewed' } }], true).doc;
    // a cue on a transcript-mode caption track (which shows the transcript, so its cues are not translated as cues)
    const transcriptCue = structuredClone(d);
    const ct = transcriptCue.sequences[transcriptCue.mainSequenceId]!.tracks.find((t) => t.kind === 'caption')!;
    ct.clips.push({ id: 'clp_tcue', type: 'caption', start: f(0), duration: f(30), transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, text: 'x' });
    const cases: [string, ProjectDocument, OpCall[], boolean][] = [
      ['replace a title\'s file', d, [{ op: 'replace_clip_asset', args: { clipId: title, assetId: late } }], false],
      ['replace a freeze frame\'s file', frozen, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: late } }], false],
      ['replace the file of a reversed clip', reversed, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: late } }], false],
      ['the same file', d, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: vid } }], false],
      ['a file not made from the clip\'s file', d, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: oth } }], false],
      ['a sound file on a picture clip', d, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: voice } }], false],
      ['a silent file on a sound clip', d, [{ op: 'replace_clip_asset', args: { clipId: sound, assetId: mute } }], false],
      ['a still for a video clip', d, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: grab } }], false],
      ['a copy that does not keep the timing', d, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: untimed } }], false],
      ['a copy that does not cover the clip', d, [{ op: 'replace_clip_asset', args: { clipId: clip, assetId: late } }], false],
      ['reviewing a format that is not a translation', d, [{ op: 'review_translation', args: { variantId: square, review: 'reviewed' } }], true],
      ['reviewing twice', reviewed, [{ op: 'review_translation', args: { variantId: en, review: 'reviewed' } }], true],
      ['asking for review twice', tr.doc, [{ op: 'review_translation', args: { variantId: en, review: 'needed' } }], true],
      ['a translated phrase deleted meanwhile', d, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'EN', language: 'en', translation: translation(['seg_gone']), phraseText: { seg_gone: 'x' }, cueText: {} } }], true],
      ['a translated cue deleted meanwhile', d, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'EN', language: 'en', translation: translation(['clp_gone']), phraseText: {}, cueText: { clp_gone: 'x' } } }], true],
      ['a cue of a transcript caption track', transcriptCue, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'EN', language: 'en', translation: translation(['clp_tcue']), phraseText: {}, cueText: { clp_tcue: 'x' } } }], true],
    ];
    const matched = new Set<number>();
    const unrecognised: string[] = [];
    for (const [what, doc, ops, internal] of cases) {
      let message = '';
      try { tx(doc, ops, internal); message = '(not refused)'; } catch (e) { if (!(e instanceof OpError)) throw e; message = e.message; }
      const he = translateRefusal('he', message);
      if (!he || !/[֐-׿]/.test(he)) unrecognised.push(`${what}: ${message}`);
      AI_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(message)) matched.add(i); });
      expect(translateRefusal('en', message)).toBeUndefined();
    }
    expect(unrecognised).toEqual([]);
    expect(AI_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    // the numbers of the range refusal survive, isolated left to right inside the Hebrew sentence
    expect(translateRefusal('he', 'the new file covers 5.000s–7.000s of the original; the clip needs 1.000s–3.000s')).toBe('הקובץ החדש מכסה את השניות ⁦5.000–7.000⁩ של המקור, והקליפ צריך את השניות ⁦1.000–3.000⁩');
  });
  it('the new error codes have a headline in both languages', () => {
    for (const lang of ['he', 'en'] as const) for (const code of ['not_time_preserving', 'range_not_covered'])
      expect((dictionaries[lang] as Record<string, string>)[`error.code.${code}`], `${lang} ${code}`).toBeTruthy();
  });
});
