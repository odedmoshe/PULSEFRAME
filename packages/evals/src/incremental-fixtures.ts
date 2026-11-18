/**
 * Fixtures of the incremental export proof (ADR-0024; plan §10 with the verifier's corrections), built through the REST API with
 * operations only (no direct store access), so they are what an agent or the editor could make.
 *
 * Fixture A, the project of the edits: 640×360 at 30 fps, 1801 frames (a 1-frame tail; the variant has 1802), one barcode video
 * (B-frames, 1-second GOP) cut into pieces so that effects sit on their own pieces, a transition, an echo with a keyframed move,
 * grain, a snow overlay, two titles, a manual caption track and one followed privacy region. Every number of the layout is typed
 * here as a constant: the proof's expectations are computed from these frames and the 60-frame grid, never from the code under
 * test. Fixture B: a flashing stretch (black and white stills, a change every 3 frames = 5 flashes a second) that crosses the joins
 * at 4 s and 6 s. Fixture C: a strobe and a snow overlay (Infinity before the first flash and in the overlay's speed limit: they must
 * stay cacheable). The ten-minute keying project: the same barcode video ten times.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';

export const FPS = { num: 30, den: 1 } as const;
export const f = (n: number) => T.frameTime(n, FPS);
/** The segment grid at 30 fps: 2 seconds, anchored at programme frame 0 (core SEGMENT_SECONDS, typed here on purpose). */
export const SEG_FRAMES = 60;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CallResult { status: number; body: any }
export interface Api {
  url: string;
  call(p: string, body?: unknown, method?: string): Promise<CallResult>;
  /** Commits ops in one transaction; throws unless committed. Returns the parsed response. */
  tx(pid: string, ops: unknown[]): Promise<any>;
  upload(pid: string, file: string, name?: string): Promise<{ assetId: string; asset: any }>;
  waitJob(id: string, timeoutMs?: number): Promise<any>;
  /** Downloads a succeeded job's output to `file`. */
  download(jobId: string, file: string): Promise<string>;
}
export function makeApi(url: string, token: string): Api {
  const h = { authorization: `Bearer ${token}`, connection: 'close' };
  const call: Api['call'] = async (p, body, method) => {
    const r = await fetch(`${url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = r.headers.get('content-type')?.includes('json');
    return { status: r.status, body: json ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return {
    url, call,
    async tx(pid, ops) {
      const r = await call(`/projects/${pid}/transactions`, { ops });
      if (r.status >= 300 || r.body?.committed === false) throw new Error(`transaction refused (${r.status}): ${JSON.stringify(r.body).slice(0, 600)}`);
      return r.body;
    },
    async upload(pid, file, name) {
      const r = await fetch(`${url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': name ?? path.basename(file) }, body: fs.readFileSync(file) });
      const j: any = await r.json();
      if (!j.assetId) throw new Error(`upload failed: ${JSON.stringify(j).slice(0, 400)}`);
      return { assetId: j.assetId as string, asset: j.asset };
    },
    async waitJob(id, timeoutMs = 30 * 60_000) {
      const t0 = Date.now();
      for (;;) {
        const j = (await call(`/jobs/${id}`)).body;
        if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j;
        if (Date.now() - t0 > timeoutMs) throw new Error(`job ${id} still ${j.status} after ${timeoutMs} ms`);
        await sleep(200);
      }
    },
    async download(jobId, file) {
      const r = await call(`/jobs/${jobId}/output`);
      if (r.status !== 200) throw new Error(`output of ${jobId}: ${r.status}`);
      fs.writeFileSync(file, r.body);
      return file;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fixture A. Programme frames; each piece plays its own source frames 1:1 (sourceIn = start), so the barcode of a clean frame is
// its programme frame number.
// ---------------------------------------------------------------------------------------------------------------------------
export const A_LAYOUT = {
  /** privacy region + motion track; the source frames of the track are the clip's own */
  p1: { start: 0, frames: 300 },
  /** grain on its own piece */
  p2: { start: 300, frames: 150 },
  /** the piece the transition reaches back into (the proof gives it grain in e4) */
  p3: { start: 450, frames: 150 },
  /** dissolve of 15 frames at its start: frames 600..614 show p3 playing on under it */
  p4: { start: 600, frames: 300 },
  p5: { start: 900, frames: 60 },
  /** echo: count 4, delay 12 frames = 3 pictures behind the current one = reach of 36 frames; keyframed x at clip-local 45, 48, 51 */
  pe: { start: 960, frames: 120 },
  p6: { start: 1080, frames: 420 },
  /** snow overlay */
  ps: { start: 1500, frames: 150 },
  p7: { start: 1650 },
  /** title 1 at 20–24 s: cells 10 and 11; title 2 at 40–41 s: inside cell 20 */
  t1: { start: 600, frames: 120 },
  t2: { start: 1200, frames: 30 },
  transitionFrames: 15,
  echo: { count: 4, delay: 12, keyframeLocal: [45, 48, 51] as const, x: [0, 0.04, 0.08] as const },
  cues: [{ start: 60, frames: 90, text: 'שלום' }, { start: 450, frames: 90, text: 'ממשיכים' }, { start: 1650, frames: 90, text: 'להתראות' }],
} as const;

/** The grid cells (0-based segment numbers of a full export at 30 fps, 60 frames each) that hold any frame of [a, b). */
export function cellsOf(a: number, b: number): number[] {
  const out: number[] = [];
  for (let c = Math.floor(a / SEG_FRAMES); c <= Math.floor((b - 1) / SEG_FRAMES); c++) out.push(c);
  return out;
}
/** Number of segments of a full export of `frames` frames: whole cells, with a 1–2 frame tail joined to the last cell (MIN_SEGMENT_FRAMES = 3). */
export function segmentCount(frames: number): number {
  const cells = Math.ceil(frames / SEG_FRAMES);
  return frames % SEG_FRAMES > 0 && frames % SEG_FRAMES < 3 && cells > 1 ? cells - 1 : cells;
}

export interface FixtureA {
  pid: string; assetId: string; file: string; frames: number; segments: number;
  clips: { p1: string; p2: string; p3: string; p4: string; p5: string; pe: string; p6: string; ps: string; p7: string };
  /** linked sound clips, by piece */
  audio: { p1: string; p2: string; p3: string; p4: string; p5: string; pe: string; p6: string; ps: string; p7: string };
  titles: { t1: string; t2: string };
  motionTrackId: string; regionId: string; captionTrackId: string;
}

export async function makeSource(file: string, frames: number): Promise<string> {
  if (!fs.existsSync(file)) await generateBarcodeFixture({ out: file, frames, width: 640, height: 360, fps: FPS, bframes: 2, gop: 30 });
  return file;
}

export async function buildFixtureA(api: Api, art: string, o: { frames: 1801 | 1802; name: string }): Promise<FixtureA> {
  const L = A_LAYOUT;
  const file = await makeSource(path.join(art, `barcode-${o.frames}.mp4`), o.frames);
  const pid = (await api.call('/projects', { name: o.name, width: 640, height: 360 })).body.project.id as string;
  const { assetId } = await api.upload(pid, file);
  const pieces: [string, number, number][] = [
    ['p1', L.p1.start, L.p1.frames], ['p2', L.p2.start, L.p2.frames], ['p3', L.p3.start, L.p3.frames], ['p4', L.p4.start, L.p4.frames], ['p5', L.p5.start, L.p5.frames],
    ['pe', L.pe.start, L.pe.frames], ['p6', L.p6.start, L.p6.frames], ['ps', L.ps.start, L.ps.frames], ['p7', L.p7.start, o.frames - L.p7.start],
  ];
  const added = await api.tx(pid, pieces.map(([, start, n]) => ({ op: 'add_clip', args: { assetId, start: f(start), sourceIn: f(start), duration: f(n) } })));
  const clips: Record<string, string> = {}, audio: Record<string, string> = {};
  pieces.forEach(([k], i) => { clips[k] = added.results[i].output.clipId; audio[k] = added.results[i].output.audioClipId; });
  const titles = await api.tx(pid, [
    { op: 'add_text', args: { text: 'כותרת ראשונה', start: f(L.t1.start), duration: f(L.t1.frames), transform: { y: 0 } } },
    { op: 'add_text', args: { text: 'כותרת שנייה', start: f(L.t2.start), duration: f(L.t2.frames), transform: { y: 0 } } },
  ]);
  await api.tx(pid, [
    { op: 'add_effect', args: { clipId: clips.p2, type: 'stylize.grain', params: {} } },
    { op: 'set_transition', args: { clipId: clips.p4, type: 'dissolve', frames: L.transitionFrames } },
    { op: 'add_effect', args: { clipId: clips.pe, type: 'time.echo', params: { count: L.echo.count, delay: L.echo.delay } } },
    ...L.echo.keyframeLocal.map((local, i) => ({ op: 'set_keyframe', args: { clipId: clips.pe, property: 'x', time: f(local), value: L.echo.x[i] } })),
    { op: 'add_effect', args: { clipId: clips.ps, type: 'overlay.snow', params: {} } },
  ]);
  const cap = await api.tx(pid, [{ op: 'add_caption_track', args: { mode: 'manual' } }]);
  const captionTrackId = cap.results[0].output.trackId as string;
  await api.tx(pid, L.cues.map((c) => ({ op: 'add_cue', args: { trackId: captionTrackId, start: f(c.start), duration: f(c.frames), text: c.text } })));
  // one followed privacy region on the first piece: a region track with hand-placed samples at the ends, interpolated between them
  const mt = await api.tx(pid, [{ op: 'create_motion_track', args: { assetId, name: 'אזור מוסתר', kind: 'region', frame: 0, x: 5000, y: 4000, w: 2000, h: 2000 } }]);
  const motionTrackId = mt.results[0].output.motionTrackId as string;
  await api.tx(pid, [{ op: 'edit_motion_track', args: { motionTrackId, set: [{ frame: L.p1.frames - 1, x: 6000, y: 4000 }], interpolate: { from: 0, to: L.p1.frames - 1 } } }]);
  const red = await api.tx(pid, [{ op: 'set_redact_region', args: { clipId: clips.p1, region: { motionTrackId, style: 'pixelate', strength: 0.8 } } }]);
  return {
    pid, assetId, file, frames: o.frames, segments: segmentCount(o.frames), clips: clips as FixtureA['clips'], audio: audio as FixtureA['audio'],
    titles: { t1: titles.results[0].output.clipId, t2: titles.results[1].output.clipId }, motionTrackId, regionId: red.results[0].output.regionId as string, captionTrackId,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fixture B: 10 s; black, then 30 stills of 3 frames alternating white and black over frames [105, 195) (5 flashes a second, whole
// picture: a failing photosensitivity stretch that crosses the joins at 120 and 180), then black.
// ---------------------------------------------------------------------------------------------------------------------------
export const B_LAYOUT = { frames: 300, flashFrom: 105, flashTo: 195, period: 3, joins: [120, 180] as const } as const;
export interface FixtureB { pid: string; frames: number }
export async function buildFixtureB(api: Api, art: string, name: string): Promise<FixtureB> {
  const L = B_LAYOUT;
  const pid = (await api.call('/projects', { name, width: 320, height: 180 })).body.project.id as string;
  const still = (n: string, colour: string) => { const file = path.join(art, `${n}.png`); execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=320x180`, '-frames:v', '1', file]); return file; };
  const black = (await api.upload(pid, still('b-black', 'black'))).assetId, white = (await api.upload(pid, still('b-white', 'white'))).assetId;
  const ops: unknown[] = [{ op: 'add_clip', args: { assetId: black, start: f(0), duration: f(L.flashFrom) } }];
  for (let k = 0; k * L.period < L.flashTo - L.flashFrom; k++) ops.push({ op: 'add_clip', args: { assetId: k % 2 ? black : white, start: f(L.flashFrom + k * L.period), duration: f(L.period) } });
  ops.push({ op: 'add_clip', args: { assetId: black, start: f(L.flashTo), duration: f(L.frames - L.flashTo) } });
  await api.tx(pid, ops);
  return { pid, frames: L.frames };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fixture C: a strobe piece and a snow piece, 240 frames. Both hold Infinity in the graph before their first flash / as the
// overlay's speed limit; neither may be unkeyable (unkeyable_value); the strobe may be uncacheable for another stated reason.
// ---------------------------------------------------------------------------------------------------------------------------
export const C_LAYOUT = { frames: 240, strobe: { start: 0, frames: 120 }, snow: { start: 120, frames: 120 } } as const;
export interface FixtureC { pid: string; frames: number; strobeClip: string; snowClip: string }
export async function buildFixtureC(api: Api, art: string, name: string, o: { strobe: boolean } = { strobe: true }): Promise<FixtureC> {
  const file = await makeSource(path.join(art, 'barcode-240.mp4'), 240);
  const pid = (await api.call('/projects', { name, width: 640, height: 360 })).body.project.id as string;
  const { assetId } = await api.upload(pid, file);
  const added = await api.tx(pid, [C_LAYOUT.strobe, C_LAYOUT.snow].map((p) => ({ op: 'add_clip', args: { assetId, start: f(p.start), sourceIn: f(p.start), duration: f(p.frames) } })));
  const strobeClip = added.results[0].output.clipId as string, snowClip = added.results[1].output.clipId as string;
  await api.tx(pid, [...(o.strobe ? [{ op: 'add_effect', args: { clipId: strobeClip, type: 'light.strobe', params: { rate: 2, amount: 0.8 } } }] : []), { op: 'add_effect', args: { clipId: snowClip, type: 'overlay.snow', params: {} } }]);
  return { pid, frames: C_LAYOUT.frames, strobeClip, snowClip };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The ten-minute project for keying (I14): the 1801-frame barcode video, ten pieces of 1800 frames, one title per piece.
// ---------------------------------------------------------------------------------------------------------------------------
export const LONG_PIECES = 10;
export async function buildLongProject(api: Api, art: string, name: string): Promise<{ pid: string; frames: number }> {
  const file = await makeSource(path.join(art, 'barcode-1801.mp4'), 1801);
  const pid = (await api.call('/projects', { name, width: 640, height: 360 })).body.project.id as string;
  const { assetId } = await api.upload(pid, file);
  await api.tx(pid, Array.from({ length: LONG_PIECES }, (_, k) => ({ op: 'add_clip', args: { assetId, start: f(k * 1800), sourceIn: f(0), duration: f(1800) } })));
  await api.tx(pid, Array.from({ length: LONG_PIECES }, (_, k) => ({ op: 'add_text', args: { text: `קטע ${k + 1}`, start: f(k * 1800 + 300), duration: f(150), transform: { y: 0 } } })));
  return { pid, frames: LONG_PIECES * 1800 };
}
