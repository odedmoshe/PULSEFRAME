/**
 * The stabilisation fixtures (steady.ts): the truth is consistent with the camera and with the pictures drawn. Truth comes from the
 * construction; these checks fail when the drawing and the stated path disagree. One H.264 write is checked with ffprobe.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySim, composeSim, FIXTURE_SST, inverseSim, STEADY_FIXTURE_VARIANTS, steadyFixture, writeSteadyFixture } from './steady.ts';

const mean = (a: Uint8Array) => a.reduce((s, v) => s + v, 0) / a.length;

describe('stabilisation fixtures', () => {
  it('similarities: inverse and compose are exact to 1e-12', () => {
    const a = { r: 0.01, l: 0.003, tx: 0.02, ty: -0.01 }, b = { r: -0.004, l: -0.001, tx: -0.005, ty: 0.007 };
    const p = applySim(composeSim(a, b), 0.3, -0.2), q = applySim(a, applySim(b, 0.3, -0.2).x, applySim(b, 0.3, -0.2).y);
    expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y)).toBeLessThan(1e-12);
    const id = composeSim(inverseSim(a), a);
    expect(Math.abs(id.r) + Math.abs(id.l) + Math.abs(id.tx) + Math.abs(id.ty)).toBeLessThan(1e-12);
  });

  it('the truth moves every disc from its place in frame k−1 to its place in frame k (within 1e-9 px)', () => {
    const fx = steadyFixture({ variant: 'F1', frames: 60 });
    let worst = 0;
    for (let k = 1; k < 60; k++)
      for (let i = 0; i < 5; i++) {
        const a = fx.discAt(k - 1, i)!, b = fx.discAt(k, i)!;
        const u = (a.x + 0.5) / fx.width - 0.5, v = (a.y + 0.5) / fx.width - fx.height / (2 * fx.width);
        const p = applySim(fx.truth[k]!, u, v);
        worst = Math.max(worst, Math.hypot((p.x + 0.5) * fx.width - 0.5 - b.x, (p.y + fx.height / (2 * fx.width)) * fx.width - 0.5 - b.y));
      }
    expect(worst).toBeLessThan(1e-9);
  });

  it('the drawn picture shows a disc where discAt says: the centre pixel of a disc is its bright core in every frame', () => {
    const fx = steadyFixture({ variant: 'F1', frames: 30 });
    for (const k of [0, 13, 29]) {
      const img = fx.render(k, 640, 360);
      for (let i = 0; i < 5; i++) {
        const c = fx.discAt(k, i, 640)!;
        // the core is bright (128 + 100·cos(2π·d/16), d ≤ 1.5 source px from rounding); 8 source px out is the dark ring
        expect(img[Math.round(c.y) * 640 + Math.round(c.x)]!).toBeGreaterThanOrEqual(200);
        expect(img[Math.round(c.y) * 640 + Math.round(c.x + 4)]!).toBeLessThanOrEqual(90);
      }
    }
  });

  it('a camera that shakes: the per-frame truth reaches several source px and the rotation tenths of a degree; F7 has a constant truth', () => {
    const fx = steadyFixture({ variant: 'F1' });
    const tx = fx.truth.slice(1).map((d) => Math.abs(d.tx * 1280));
    expect(Math.max(...tx)).toBeGreaterThan(5);
    expect(Math.max(...tx)).toBeLessThan(20);
    expect(Math.max(...fx.camera.map((c) => Math.abs(c.r) * 180 / Math.PI))).toBeGreaterThan(0.2);
    const f7 = steadyFixture({ variant: 'F7' }).columns();
    expect(new Set(f7.dx.slice(1))).toEqual(new Set([-156])); // −2 px per frame = −156.25 units, rounded once
    expect(new Set(f7.dr.slice(1))).toEqual(new Set([0]));
  });

  it('columns: sample 0 and the cut are start, the rest ok; F5 cuts at frame 90 to a world ≥ 40 grey levels darker', () => {
    const f5 = steadyFixture({ variant: 'F5' });
    const c = f5.columns();
    expect(c.st[0]).toBe(FIXTURE_SST.start);
    expect(c.st[90]).toBe(FIXTURE_SST.start);
    expect(c.st.filter((s) => s === FIXTURE_SST.start)).toHaveLength(2);
    expect(f5.discAt(90, 0)).toBeNull();
    expect(mean(f5.render(89, 320, 180)) - mean(f5.render(90, 320, 180))).toBeGreaterThanOrEqual(40);
    expect(steadyFixture({ variant: 'F1' }).columns(30, 60).st[0]).toBe(FIXTURE_SST.start);
  });

  it('F2 and F3: the block covers 25 % and 65 % of the picture; F4 is flat grey; F8 is portrait', () => {
    expect(steadyFixture({ variant: 'F2', frames: 2 }).block!.area).toBeCloseTo(0.25, 3);
    expect(steadyFixture({ variant: 'F3', frames: 2 }).block!.area).toBeCloseTo(0.65, 2);
    const f4 = steadyFixture({ variant: 'F4', frames: 3 }).render(1, 320, 180);
    expect(Math.max(...f4) - Math.min(...f4)).toBeLessThanOrEqual(6);
    const f8 = steadyFixture({ variant: 'F8', frames: 2 });
    expect([f8.width, f8.height]).toEqual([720, 1280]);
    expect(f8.render(1, 90, 160)).toHaveLength(90 * 160);
    expect(STEADY_FIXTURE_VARIANTS).toHaveLength(8);
  });

  it('deterministic: the same frame twice is the same bytes', () => {
    const a = steadyFixture({ variant: 'F2', frames: 10 }).render(7, 160, 90), b = steadyFixture({ variant: 'F2', frames: 10 }).render(7, 160, 90);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('writes H.264 with exactly the frames asked for', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-steady-fx-'));
    try {
      const fx = steadyFixture({ variant: 'F1', frames: 24 });
      const out = await writeSteadyFixture(fx, path.join(dir, 'f1.mp4'), { width: 320, height: 180 });
      const probe = await new Promise<any>((res, rej) => execFile('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', out.file], (e, o) => (e ? rej(e) : res(JSON.parse(String(o))))));
      expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', width: 320, height: 180, nb_read_frames: '24' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
