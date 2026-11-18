/**
 * The angle viewer in a right-to-left interface (ADR-0020 U8; found by proof:multicam-ui's panel screenshot): the tile buttons put
 * tile 1 top right in Hebrew, so the never-saved multiview document must put angle 1's cell top right too, without mirroring pictures.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { multiviewDocument, validateProject, type MediaClip } from './index.ts';
import { podcast } from './multicam.testFixture.ts';

describe('multiviewDocument rtl', () => {
  it('mirrors every cell and label about the centre line, keeps everything else, and stays valid', () => {
    const p = podcast();
    const base = { liveAngleIds: [p.camA, p.camB], g0: T.rt(30, 1), duration: T.rt(20, 1), width: 640, height: 360 };
    const ltr = multiviewDocument(p.doc, p.groupId, base), rtl = multiviewDocument(p.doc, p.groupId, { ...base, rtl: true });
    expect(validateProject(rtl)).toEqual([]);
    const tl = ltr.sequences[ltr.mainSequenceId]!.tracks, tr = rtl.sequences[rtl.mainSequenceId]!.tracks;
    expect(tr.map((t) => t.id)).toEqual(tl.map((t) => t.id));
    tl.forEach((t, i) => t.clips.forEach((c, j) => {
      const r = tr[i]!.clips[j]!;
      expect(r.transform.x).toBeCloseTo(-c.transform.x, 12);
      expect({ ...r.transform, x: 0 }).toEqual({ ...c.transform, x: 0 });
      if (c.type === 'media') { expect((r as MediaClip).mask).toEqual(c.mask); expect((r as MediaClip).sourceIn).toEqual(c.sourceIn); }
    }));
    const first = tr[0]!.clips[0] as MediaClip;
    expect(first.transform.x).toBeGreaterThan(0); // angle 1 is the right cell
    expect(multiviewDocument(p.doc, p.groupId, { ...base, rtl: false })).toEqual(ltr);
  });
});
