import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { captionPages, evaluate, visualOrder, wrapWords, type CaptionLayer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `e${n++}_`, actor: 'test', allowInternal });
const cap = (doc: ProjectDocument, frame: number) => evaluate(doc, f(frame)).layers.find((l) => l.kind === 'caption') as CaptionLayer | undefined;
const shown = (l?: CaptionLayer) => l?.words.map((w) => `${w.text}:${w.state === 'plain' ? '-' : w.state[0]}`).join(' ') ?? null;

function talk() {
  const asset = {
    kind: 'video' as const, name: 'talk.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1),
    video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
    provenance: { origin: 'fixture' as const, importedAt: '2026-11-14T00:00:00Z', importedBy: 'test' },
  };
  let r = tx(createProject({ id: 'prj_e', name: 'E' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  const words = Array.from({ length: 10 }, (_, i) => ({ text: `w${i}`, start: T.rt(i * 1000 + 200, 1000), duration: T.rt(500, 1000) }));
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId, start: f(0) } },
    { op: 'set_transcript', args: { assetId, language: 'en', segments: [{ start: T.rt(0, 1), duration: T.rt(5, 1), text: 'w0 w1 w2 w3 w4', words: words.slice(0, 5) }, { start: T.rt(5, 1), duration: T.rt(5, 1), text: 'w5 w6 w7 w8 w9', words: words.slice(5) }] } },
    { op: 'add_caption_track', args: { mode: 'transcript' } },
  ]);
  return { doc: r.doc, assetId, wordIds: (r.results[1]!.output!.wordIds as string[][]).flat() };
}

describe('caption layout', () => {
  it('pages never split a word and respect capacity', () => {
    expect(captionPages(['aa', 'bb', 'cc', 'dddddddddd', 'e'], 5)).toEqual([[0, 1], [2], [3], [4]]);
    expect(captionPages([], 10)).toEqual([]);
  });
  it('wraps greedily in logical order', () => {
    expect(wrapWords([10, 10, 10, 50, 10], 2, 25)).toEqual([[0, 1], [2], [3], [4]]);
  });
  it('visual order: RTL base runs right-to-left, embedded Latin/number runs stay left-to-right', () => {
    // logical: שלום Hello World עולם  -> screen (left to right): עולם Hello World שלום
    expect(visualOrder(['שלום', 'Hello', 'World', 'עולם'], 'rtl')).toEqual([3, 1, 2, 0]);
    // a number between Latin words joins the Latin run; a lone number follows the base direction
    expect(visualOrder(['א', 'iPhone', '15', 'Pro', 'ב'], 'rtl')).toEqual([4, 1, 2, 3, 0]);
    expect(visualOrder(['א', '2026', 'ב'], 'rtl')).toEqual([2, 1, 0]);
    // LTR base with an embedded Hebrew run
    expect(visualOrder(['say', 'שלום', 'עולם', 'now'], 'ltr')).toEqual([0, 2, 1, 3]);
    expect(visualOrder(['a', 'b'], 'ltr')).toEqual([0, 1]);
  });
});

describe('transcript captions follow the edit', () => {
  it('word states come from source time', () => {
    const { doc } = talk();
    expect(shown(cap(doc, 0))).toBe('w0:f w1:f w2:f w3:f w4:f'); // 0.0 s: before w0
    expect(shown(cap(doc, 6))).toBe('w0:c w1:f w2:f w3:f w4:f'); // 0.2 s: w0 starts (half-open)
    expect(shown(cap(doc, 21))).toBe('w0:p w1:f w2:f w3:f w4:f'); // 0.7 s: w0 ended
    expect(shown(cap(doc, 150))).toBe('w5:f w6:f w7:f w8:f w9:f'); // phrase 2 starts at 5 s
    expect(cap(doc, 300)).toBeUndefined();
  });
  it('after deleting words, captions show only what is heard, at the new times, with no re-timing op', () => {
    const { doc, assetId, wordIds } = talk();
    const cut = tx(doc, [{ op: 'delete_transcript_range', args: { assetId, fromWordId: wordIds[2], toWordId: wordIds[3] } }]).doc;
    // removed timeline frames 66..111 (45 frames). w4 (source 4.2 s = frame 126) now plays at frame 81.
    expect(shown(cap(cut, 60))).toBe('w0:p w1:p w4:f');
    expect(shown(cap(cut, 81))).toBe('w0:p w1:p w4:c');
    // audio at the same instant is the same source time the caption used
    const g = evaluate(cut, f(81));
    expect(T.toSeconds(g.audio[0]!.sourceTime)).toBeCloseTo(4.2, 9);
    // moving the clip later moves captions with it
    const vid = cut.sequences[cut.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips[1]!;
    const moved = tx(cut, [{ op: 'move_clip', args: { clipId: vid.id, start: f(100) } }]).doc;
    expect(shown(cap(moved, 115))).toBe('w0:p w1:p w4:c');
    expect(cap(moved, 90)).toBeUndefined(); // gap: nothing playing, nothing captioned
  });
  it('phrase-only and estimated timing never claim a current word', () => {
    const { doc, assetId } = talk();
    const seg = doc.transcripts[assetId]!.segments[0]!;
    const approx = tx(doc, [{ op: 'correct_transcript', args: { assetId, segmentId: seg.id, text: 'one two three' } }]).doc;
    expect(shown(cap(approx, 30))).toBe('one:- two:- three:-');
    const phrase = tx(doc, [{ op: 'import_transcript', args: { assetId, language: 'he', content: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nשלום לכולם וברוכים הבאים\n' } }]).doc;
    expect(cap(phrase, 30)!.words.every((w) => w.state === 'plain')).toBe(true);
    expect(cap(phrase, 125)).toBeUndefined();
  });
  it('manual cues show on their own track and hidden tracks show nothing', () => {
    const { doc } = talk();
    const r = tx(doc, [{ op: 'add_cue', args: { start: f(10), duration: f(20), text: 'שלום Hello' } }]);
    const layers = evaluate(r.doc, f(15)).layers.filter((l) => l.kind === 'caption') as CaptionLayer[];
    expect(layers.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['w0 w1 w2 w3 w4', 'שלום Hello']);
    expect(evaluate(r.doc, f(15)).layers.at(-1)!.kind).toBe('caption'); // captions draw last
  });
});
