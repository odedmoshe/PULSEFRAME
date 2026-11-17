/**
 * ADR-0017 contracts in core: replace_clip_asset (a derived copy in place of a clip's file), time lineage, machine-translated language
 * variants (attach_translation, review_translation, staleness, reading speed) and the pure SHA-256 they rely on.
 * The derived assets here are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, findClip, OpError, readingLength, readingSpeedIssues, restoreEntities, sha256Hex, staleTranslations, timeLineage, transcriptFor, validateProject, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false, actor = 'test') => applyTransaction(doc, ops, { idSeed: `ai${n++}_`, actor, allowInternal });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message }; throw e; } return { code: 'accepted', message: '' }; };
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: hash('1'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const other = { ...video, name: 'b.mp4', contentHash: hash('2') };
const still = { kind: 'image' as const, name: 'p.png', contentHash: hash('3'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
/** A provider result made from `src` (fixture). */
const derivedProv = (src: string, extra: Record<string, unknown> = {}) => ({
  origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.enhance', capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const enhanced = (src: string, startSeconds: number, seconds: number, c = '4') => ({
  ...video, name: 'enhanced.mp4', contentHash: hash(c), duration: T.rt(Math.round(seconds * 10), 10), video: { ...video.video, width: 1280, height: 720, frameCount: seconds * 30 },
  provenance: derivedProv(src, { sourceRangeStart: T.rt(startSeconds, 1), audio: 'source-copied', frames: { sourceStartFrame: startSeconds * 30, sourceFrameCount: seconds * 30, sourceRate: R, outputRate: R, mapping: 'identity', heldFrames: [] } }),
});

/** A project with the video, its picture and sound clips (1.5 s..3.5 s of the source at frames 0..60), and a derived copy of 1 s..5 s. */
function setup() {
  let r = tx(createProject({ id: 'prj_ai', name: 'AI' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: other } }, { op: 'import_asset', args: { asset: still } }], true);
  const [vid, oth, pic] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = tx(r.doc, [{ op: 'import_asset', args: { asset: enhanced(vid, 1, 4) } }], true);
  const enh = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: vid, start: f(0), sourceIn: f(45), duration: f(60) } }]);
  const clip = r.results[0]!.output!.clipId as string, sound = r.results[0]!.output!.audioClipId as string;
  return { doc: r.doc, vid, oth, pic, enh, clip, sound };
}
const media = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const undoes = (before: ProjectDocument, after: ProjectDocument) => {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return creativeProjection(back) === creativeProjection(before);
};

describe('sha256Hex (pure, for staleness checks in the browser)', () => {
  it('equals node:crypto over the UTF-8 bytes, across block boundaries and scripts', () => {
    for (const s of ['', 'abc', 'שלום עולם', 'בְּרֵאשִׁית בָּרָא', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000), 'emoji 🎬 and \u0000 nul'])
      expect(sha256Hex(s), JSON.stringify(s.slice(0, 20))).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

describe('replace_clip_asset', () => {
  it('gives the picture clip the derived copy at the same moments; the linked sound keeps its file; undo restores exactly', () => {
    const s = setup();
    const r = tx(s.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: s.enh } }]);
    const c = media(r.doc, s.clip);
    expect(c.assetId).toBe(s.enh);
    expect(T.eq(c.sourceIn, T.rt(1, 2))).toBe(true); // 1.5 s of the original = 0.5 s of the copy that starts at 1 s
    expect(T.eq(c.duration, f(60)) && T.eq(c.start, f(0))).toBe(true);
    expect(media(r.doc, s.sound).assetId).toBe(s.vid);
    expect(r.results[0]!.affectedIds).toEqual([s.clip]);
    expect(r.results[0]!.output).toMatchObject({ previousAssetId: s.vid });
    expect(validateProject(r.doc)).toEqual([]);
    expect(undoes(s.doc, r.doc)).toBe(true);
  });
  it('gives a sound clip a processed sound made from its file', () => {
    const s = setup();
    const voice = { kind: 'audio' as const, name: 'clean.wav', contentHash: hash('5'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(3, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: derivedProv(s.vid, { sourceRangeStart: T.rt(3, 2), audio: 'processed' }) };
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: voice } }], true);
    const clean = r.results[0]!.output!.assetId as string;
    expect(refusal(() => tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: clean } }]))).toEqual({ code: 'incompatible', message: 'the new file has no picture' });
    r = tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.sound, assetId: clean } }]);
    expect(media(r.doc, s.sound).assetId).toBe(clean);
    expect(T.isZero(media(r.doc, s.sound).sourceIn)).toBe(true);
  });
  it('smooth slow motion: the interpolated copy plus set_clip_speed(1/4) in one transaction makes the clip exactly four times longer', () => {
    const s = setup();
    const slow = { ...video, name: 'slow.mp4', contentHash: hash('6'), duration: T.rt(2, 1), video: { ...video.video, frameRate: { num: 120, den: 1 }, frameCount: 240 }, provenance: derivedProv(s.vid, { sourceRangeStart: T.rt(3, 2), audio: 'source-copied', frames: { sourceStartFrame: 45, sourceFrameCount: 60, sourceRate: R, outputRate: { num: 120, den: 1 }, mapping: 'interpolated', multiplier: 4, heldFrames: [237, 238, 239] } }) };
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: slow } }], true);
    const sl = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: sl } }, { op: 'set_clip_speed', args: { clipId: s.clip, speed: 0.25 } }]);
    expect(T.eq(media(r.doc, s.clip).duration, f(240))).toBe(true);
    expect(T.eq(media(r.doc, s.sound).duration, f(240))).toBe(true); // the linked sound follows the speed, as set_clip_speed does on the original
    expect(T.isZero(media(r.doc, s.clip).sourceIn)).toBe(true);
  });
  it('a still takes a still made from it (no timing to keep); a still and a video cannot stand in for each other', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.pic, start: f(100), duration: f(30) } }]);
    const picClip = r.results[0]!.output!.clipId as string;
    const big = { ...still, name: 'p4x.png', contentHash: hash('7'), image: { ...still.image, width: 2560, height: 1440 }, provenance: derivedProv(s.pic, { capabilityId: 'comfy.image.upscale' }) };
    const grab = { ...still, name: 'grab.png', contentHash: hash('8'), provenance: derivedProv(s.vid) };
    r = tx(r.doc, [{ op: 'import_asset', args: { asset: big } }, { op: 'import_asset', args: { asset: grab } }], true);
    const [bigId, grabId] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    expect(media(tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: picClip, assetId: bigId } }]).doc, picClip).assetId).toBe(bigId);
    expect(refusal(() => tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: grabId } }])).code).toBe('not_time_preserving');
  });
  it('refuses: another file, a copy without timing, a copy that does not cover the clip, freeze, reverse, ramp, unknown asset, same file', () => {
    const s = setup();
    const cut = tx(s.doc, [{ op: 'import_asset', args: { asset: { ...enhanced(s.vid, 2, 4, '9') } } }, { op: 'import_asset', args: { asset: { ...enhanced(s.vid, 1, 4, 'b'), provenance: derivedProv(s.vid) } } }, { op: 'import_asset', args: { asset: { ...enhanced(s.oth, 1, 4, 'c') } } }], true);
    const [late, untimed, ofOther] = cut.results.map((x) => x.output!.assetId as string) as [string, string, string];
    const d = cut.doc;
    const ramped = tx(d, [{ op: 'set_clip_speed_ramp', args: { clipId: s.clip, from: 1, to: 2 } }]).doc;
    const reversed = tx(d, [{ op: 'set_clip_reverse', args: { clipId: s.clip, reverse: true } }]).doc;
    const frozen = structuredClone(d); media(frozen, s.clip).freeze = true;
    const cases: [ProjectDocument, OpCall, string, string | RegExp][] = [
      [d, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: ofOther } }, 'incompatible', 'the new file was not made from the file this clip shows'],
      [d, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: s.oth } }, 'incompatible', 'the new file was not made from the file this clip shows'],
      [d, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: untimed } }, 'not_time_preserving', 'the new file does not keep the timing of the file this clip shows'],
      [d, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: late } }, 'range_not_covered', 'the new file covers 2.000s–6.000s of the original; the clip needs 1.500s–3.500s'],
      [frozen, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: s.enh } }, 'incompatible', 'a freeze frame cannot be given another file'],
      [reversed, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: s.enh } }, 'incompatible', 'a clip that plays backwards cannot be given another file'],
      [ramped, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: s.enh } }, 'incompatible', 'this clip changes speed gradually over its length, so it cannot be given another file'],
      [d, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: 'ast_missing' } }, 'not_found', /not found/],
      [d, { op: 'replace_clip_asset', args: { clipId: s.clip, assetId: s.vid } }, 'incompatible', 'the clip already shows this file'],
    ];
    for (const [doc, op, code, message] of cases) {
      const got = refusal(() => tx(doc, [op]));
      expect(got.code, JSON.stringify(op)).toBe(code);
      if (typeof message === 'string') expect(got.message).toBe(message); else expect(got.message).toMatch(message);
    }
  });
  it('the copy must also cover the frames a transition into the next clip plays from this clip', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: enhanced(s.vid, 1, 2.5, 'd') } }], true);
    const short = r.results[0]!.output!.assetId as string; // covers 1 s..3.5 s: exactly the clip's stretch
    expect(refusal(() => tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: short } }])).code).toBe('accepted');
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: s.vid, start: f(60), sourceIn: f(150), duration: f(60), withLinkedAudio: false } }]);
    const next = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_transition', args: { clipId: next, type: 'dissolve', frames: 15 } }]);
    expect(refusal(() => tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId: s.clip, assetId: short } }]))).toEqual({ code: 'range_not_covered', message: 'the new file covers 1.000s–3.500s of the original; the clip needs 1.500s–4.000s' });
  });
});

describe('time lineage', () => {
  it('follows time-preserving copies to the root, adding their offsets; a copy without timing is a root of its own', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: { ...enhanced(s.enh, 1, 2, 'e'), name: 'twice.mp4' } } }, { op: 'import_asset', args: { asset: { ...enhanced(s.vid, 0, 8, 'f'), provenance: derivedProv(s.vid) } } }], true);
    const [twice, untimed] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    const l = timeLineage(r.doc, twice);
    expect(l.chain).toEqual([twice, s.enh, s.vid]);
    expect(l.rootAssetId).toBe(s.vid);
    expect(T.eq(l.offset, T.rt(2, 1))).toBe(true);
    expect(timeLineage(r.doc, s.vid)).toEqual({ rootAssetId: s.vid, offset: T.ZERO, chain: [s.vid] });
    expect(timeLineage(r.doc, untimed).chain).toEqual([untimed]);
    expect(transcriptFor(r.doc, twice)).toBeNull();
    r = tx(r.doc, [{ op: 'set_transcript', args: { assetId: s.vid, language: 'he', segments: [{ start: T.rt(2, 1), duration: T.rt(1, 1), text: 'שלום' }] } }]);
    const t = transcriptFor(r.doc, twice)!;
    expect(t.transcript.assetId).toBe(s.vid);
    expect(T.eq(t.offset, T.rt(2, 1))).toBe(true);
    expect(transcriptFor(r.doc, untimed)).toBeNull();
  });
});

describe('machine-translated language variants', () => {
  function withCaptions() {
    const s = setup();
    let r = tx(s.doc, [
      { op: 'set_transcript', args: { assetId: s.vid, language: 'he', segments: [{ start: T.rt(1, 1), duration: T.rt(1, 1), text: 'שלום עולם' }, { start: T.rt(2, 1), duration: T.rt(1, 1), text: 'מה שלומך' }] } },
      { op: 'add_cue', args: { start: f(90), duration: f(30), text: 'כתובית ידנית' } },
      { op: 'add_variant', args: { profileId: 'vertical-9x16' } },
    ]);
    const segs = r.doc.transcripts[s.vid]!.segments.map((x) => x.id);
    const cue = r.results[1]!.output!.clipId as string, vertical = r.results[2]!.output!.variantId as string;
    return { ...s, doc: r.doc, segs, cue, vertical };
  }
  const translation = (doc: ProjectDocument, ids: string[]) => ({ from: 'he', to: 'en', engine: 'transformers 5.23 MarianMT', model: 'Helsinki-NLP/opus-mt-tc-big-he-en@134c5a85', createdAt: '2026-11-17T10:00:00Z', createdBy: 'user:owner',
    sources: Object.fromEntries(ids.map((id) => [id, sha256Hex(doc.transcripts[Object.keys(doc.transcripts)[0]!]!.segments.find((x) => x.id === id)?.text ?? (findClip(doc, id)!.clip as { text: string }).text)])) });
  it('creates a variant with the base format\'s frame, phrase wording per segment and cue wording per cue; review is needed; undo is exact', () => {
    const s = withCaptions();
    const args = { baseVariantId: s.vertical, name: 'English', language: 'en', translation: translation(s.doc, [...s.segs, s.cue]), phraseText: { [s.segs[0]!]: 'Hello world', [s.segs[1]!]: 'How are you' }, cueText: { [s.cue]: 'A manual caption' } };
    expect(refusal(() => tx(s.doc, [{ op: 'attach_translation', args }])).code).toBe('forbidden_op'); // internal: trusted job only
    const r = tx(s.doc, [{ op: 'attach_translation', args }], true);
    const v = r.doc.variants[r.results[0]!.output!.variantId as string]!;
    expect(v).toMatchObject({ width: 1080, height: 1920, fit: 'cover', language: 'en', phraseText: args.phraseText, overrides: { [s.cue]: { text: 'A manual caption' } } });
    expect(v.translation).toMatchObject({ review: 'needed', from: 'he', to: 'en' });
    expect(v.translation!.reviewedBy).toBeUndefined();
    expect(validateProject(r.doc)).toEqual([]);
    expect(undoes(s.doc, r.doc)).toBe(true);
    expect(staleTranslations(r.doc, v.id)).toEqual([]);
    // the master changes: that phrase is stale
    const edited = tx(r.doc, [{ op: 'correct_transcript', args: { assetId: s.vid, segmentId: s.segs[0]!, text: 'שלום לכולם' } }]).doc;
    expect(staleTranslations(edited, v.id)).toEqual([s.segs[0]]);
    // master settings when there is no base format
    const m = tx(s.doc, [{ op: 'attach_translation', args: { ...args, baseVariantId: null } }], true);
    expect(m.doc.variants[m.results[0]!.output!.variantId as string]).toMatchObject({ width: 1080, height: 1920, fit: 'contain', safeArea: null });
  });
  it('updates an existing translation variant (its frame kept, cue wording replaced), and refuses inconsistent input', () => {
    const s = withCaptions();
    const base = { baseVariantId: null, name: 'English', language: 'en', translation: translation(s.doc, [...s.segs, s.cue]), phraseText: { [s.segs[0]!]: 'Hello world', [s.segs[1]!]: 'How are you' }, cueText: { [s.cue]: 'A manual caption' } };
    let r = tx(s.doc, [{ op: 'attach_translation', args: base }], true);
    const vid = r.results[0]!.output!.variantId as string;
    r = tx(r.doc, [{ op: 'update_variant', args: { variantId: vid, width: 720 } }]);
    r = tx(r.doc, [{ op: 'attach_translation', args: { ...base, variantId: vid, name: 'English 2', translation: translation(r.doc, [s.segs[0]!]), phraseText: { [s.segs[0]!]: 'Hi world' }, cueText: {} } }], true);
    expect(r.doc.variants[vid]).toMatchObject({ name: 'English 2', width: 720, phraseText: { [s.segs[0]!]: 'Hi world' }, overrides: {} });
    const bad = (over: Record<string, unknown>) => refusal(() => tx(s.doc, [{ op: 'attach_translation', args: { ...base, ...over } }], true));
    expect(bad({ phraseText: {}, cueText: {} }).code).toBe('invalid_args');
    expect(bad({ language: 'fr' }).code).toBe('invalid_args');
    expect(bad({ phraseText: { [s.segs[0]!]: 'Hello world' } }).message).toBe('the translation must record the master text of every translated phrase and cue, and of nothing else');
    expect(bad({ phraseText: { seg_gone: 'x' }, cueText: {}, translation: { ...base.translation, sources: { seg_gone: 'a'.repeat(64) } } }).message).toBe('phrase seg_gone not found in any transcript');
    expect(bad({ variantId: s.vertical }).message).toBe('this format is not a translation');
  });
  it('only the owner route marks it reviewed (internal op); editing a reviewed translation makes it need review again', () => {
    const s = withCaptions();
    let r = tx(s.doc, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: translation(s.doc, [s.segs[0]!]), phraseText: { [s.segs[0]!]: 'Hello world' }, cueText: {} } }], true);
    const vid = r.results[0]!.output!.variantId as string;
    expect(refusal(() => tx(r.doc, [{ op: 'review_translation', args: { variantId: vid, review: 'reviewed' } }])).code).toBe('forbidden_op');
    const before = r.doc;
    r = tx(r.doc, [{ op: 'review_translation', args: { variantId: vid, review: 'reviewed', at: '2026-11-17T11:00:00Z' } }], true, 'user:owner');
    expect(r.doc.variants[vid]!.translation).toMatchObject({ review: 'reviewed', reviewedBy: 'user:owner', reviewedAt: '2026-11-17T11:00:00Z' });
    expect(undoes(before, r.doc)).toBe(true);
    expect(refusal(() => tx(r.doc, [{ op: 'review_translation', args: { variantId: vid, review: 'reviewed' } }], true)).message).toBe('the translation is already marked as reviewed');
    const edited = tx(r.doc, [{ op: 'set_variant_phrase_text', args: { variantId: vid, assetId: s.vid, segmentId: s.segs[0]!, text: 'Hello, world' } }], false, 'agent:a').doc;
    expect(edited.variants[vid]!.translation).toMatchObject({ review: 'needed' });
    expect(edited.variants[vid]!.translation!.reviewedBy).toBeUndefined();
    expect(validateProject(edited)).toEqual([]);
    // an edit of an untranslated format is unaffected
    expect(tx(s.doc, [{ op: 'set_variant_phrase_text', args: { variantId: s.vertical, assetId: s.vid, segmentId: s.segs[0]!, text: 'קצר' } }]).doc.variants[s.vertical]!.translation).toBeUndefined();
  });
  it('reading speed is checked against the language\'s own limit, never a universal one', () => {
    const s = withCaptions();
    const r = tx(s.doc, [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: translation(s.doc, [s.segs[0]!, s.cue]), phraseText: { [s.segs[0]!]: 'This translated phrase is far too long to read in one second' }, cueText: { [s.cue]: 'Short' } } }], true);
    const vid = r.results[0]!.output!.variantId as string;
    expect(readingSpeedIssues(r.doc, vid, { he: 15 })).toEqual([]); // no limit for English given
    expect(readingSpeedIssues(r.doc, vid, { en: 17 })).toEqual([{ id: s.segs[0], cps: 60, limit: 17 }]); // 60 characters in one second
    expect(readingLength('  בְּרֵאשִׁית   בָּרָא ')).toBe(10); // six and three letters and one space: marks not counted, one space between words
  });
});
