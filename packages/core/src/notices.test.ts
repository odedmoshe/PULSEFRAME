import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { assetNotices, type Asset } from './index.ts';

const R = { num: 30, den: 1 };
const base = (over: Partial<Asset> = {}): Asset => ({
  id: 'ast_n', kind: 'video', name: 'a.mp4', contentHash: `sha256:${'f'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture', importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' }, ...over,
} as Asset);

describe('asset notices', () => {
  it('an ordinary file has none; offsets of about a frame are not worth a notice', () => {
    expect(assetNotices(base())).toEqual([]);
    expect(assetNotices(base({ video: { ...base().video!, startTime: T.fromSeconds('0.021') }, audio: { ...base().audio!, startTime: T.fromSeconds('0.02') } }))).toEqual([]);
  });
  it('says what was converted, when picture or sound is offset enough to notice, and when colours are a guess', () => {
    const conform = { originalContentHash: `sha256:${'e'.repeat(64)}`, originalByteSize: 1, reasons: ['rotation', 'pixel-aspect'], original: { codec: 'h264', width: 480, height: 360, avgFrameRate: '30/1', rFrameRate: '30/1', rotation: 90, frameCount: 120, durationSeconds: 4 }, frameMapping: 'identity', method: 'x' } as unknown as NonNullable<Asset['conform']>;
    expect(assetNotices(base({ conform }))).toEqual([{ code: 'converted', reasons: ['rotation', 'pixel-aspect'] }]);
    expect(assetNotices(base({ video: { ...base().video!, startTime: T.fromSeconds('0.5') } }))).toEqual([{ code: 'picture-starts-late', frames: 15 }]);
    expect(assetNotices(base({ audio: { ...base().audio!, startTime: T.fromSeconds('0.478') } }))).toEqual([{ code: 'sound-offset', seconds: 0.478 }]);
    expect(assetNotices(base({ audio: { ...base().audio!, startTime: T.fromSeconds('-0.121') } }))).toEqual([{ code: 'sound-offset', seconds: -0.121 }]);
    expect(assetNotices(base({ video: { ...base().video!, untaggedColour: true } }))).toEqual([{ code: 'colour-untagged', readAs: 'auto' }]);
    expect(assetNotices(base({ video: { ...base().video!, untaggedColour: true, readColourAs: 'bt601' } }))).toEqual([{ code: 'colour-untagged', readAs: 'bt601' }]);
    // a converted copy is tagged by the conversion; the notice then is "converted", not "untagged"
    expect(assetNotices(base({ conform, video: { ...base().video!, untaggedColour: true } })).map((n) => n.code)).toEqual(['converted']);
  });
});
