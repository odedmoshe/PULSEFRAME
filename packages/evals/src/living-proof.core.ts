/**
 * proof:living, part «core» (W1: checks 11, 13 and 20 of living-proof.ts LIVING_CHECKS). The lead's entry point starts the server
 * (and the Chromium the render worker uses), then calls `runLivingCore(ctx)` with the same kind of context as the engine part
 * (living-proof.engine.ts); it deletes `ctx.art` at the end. Every request goes over HTTP with the AGENT token: hand depth is ordinary
 * document data (LD4), so an agent draws it and makes the living picture like any edit. Each check is a measurement against core's
 * own numbers (livingMaxAmount, livingComfort); nothing here says how anything looks.
 *
 * Fixture: a synthetic 640×360 PNG made here with ffmpeg from raw bytes (a bright disc on a dark ground, so "the disc moved" is a
 * pixel measurement), deleted with `ctx.art`. Until LIVING_BUILT every check is reported not run (blocked), never as a pass.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { LIVING_BUILT, LIVING_EFFECT, LIVING_PREFLIGHT, livingMaxAmount, type ClipDepth } from '@pulseframe/core';

export interface LivingCoreCtx {
  /** The running server (startServer) and an agent's bearer token (edit + observe). */
  url: string; agentToken: string;
  /** A folder for this part's fixture; the entry point deletes it. */
  art: string;
  check(id: number, name: string, ok: boolean, detail?: unknown): void;
  /** Check 20's imported project (an enabled living picture with no depth), for the entry point's preview-notice part. */
  noDepthProject?(pid: string, clipId: string): void;
}
export const LIVING_PROOF_CORE = { built: true as boolean, checks: [11, 13, 20] as const };

const W = 640, H = 360, FPS = { num: 30, den: 1 };
const DISC: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 300, pts: [500, 500] }] };
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 28, ...(input ? { input } : {}) });
const pngToRgb = (png: Buffer): Buffer => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);

/** A bright disc (radius 60 px, centre of the frame) on a dark ground, raw rgb24 → PNG. */
function discPhoto(file: string) {
  const raw = Buffer.alloc(W * H * 3, 20);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - W / 2) ** 2 + (y - H / 2) ** 2 <= 60 * 60) raw.fill(230, (y * W + x) * 3, (y * W + x) * 3 + 3);
  ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', file], raw);
}
/** Pixels whose red channel differs between two rgb24 stills by more than 8. */
const changed = (a: Buffer, b: Buffer) => { let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]! - b[i]!) > 8) n++; return n; };

export async function runLivingCore(ctx: LivingCoreCtx): Promise<void> {
  if (!LIVING_BUILT) { for (const id of LIVING_PROOF_CORE.checks) ctx.check(id, 'not run: set_living_picture and depthGrid are not built in this build (W1)', false, { blocked: true }); return; }
  const h = { authorization: `Bearer ${ctx.agentToken}`, connection: 'close' };
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${ctx.url}/api/v1${p}`, { method, headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = (pid: string, ops: unknown[]) => call('POST', `/projects/${pid}/transactions`, { ops });
  const ok = async (pid: string, ops: unknown[]) => { const r = await tx(pid, ops); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body.results as { output?: any }[]; };
  const why = (r: { body: any }) => r.body?.error?.details?.why as string | undefined;
  const photoFile = path.join(ctx.art, 'disc.png');
  discPhoto(photoFile);
  const project = async (name: string, frames: number) => {
    const pid = (await call('POST', '/projects', { name, width: W, height: H, frameRate: FPS })).body.project.id as string;
    const assetId = ((await (await fetch(`${ctx.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'disc.png' }, body: fs.readFileSync(photoFile) })).json()) as any).assetId as string;
    const clipId = (await ok(pid, [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.frameTime(frames, FPS) } }]))[0]!.output.clipId as string;
    return { pid, clipId };
  };

  // 11. an agent token: depth and living picture as ordinary edits; render_frame shows the moved disc; add_effect refused living_use_op
  try {
    const { pid, clipId } = await project('living proof 11', 90);
    const depth = await tx(pid, [{ op: 'set_clip_depth', args: { clipId, depth: DISC } }]);
    const before = await call('GET', `/projects/${pid}/frame?index=89`);
    const live = await tx(pid, [{ op: 'set_living_picture', args: { clipId, move: 'push', amount: 0.5 } }]);
    const after = await call('GET', `/projects/${pid}/frame?index=89`);
    const first = await call('GET', `/projects/${pid}/frame?index=0`);
    const add = await tx(pid, [{ op: 'add_effect', args: { clipId, type: LIVING_EFFECT } }]);
    const moved = before.status === 200 && after.status === 200 ? changed(pngToRgb(before.body), pngToRgb(after.body)) : -1;
    const atStart = before.status === 200 && first.status === 200 ? changed(pngToRgb(before.body), pngToRgb(first.body)) : -1;
    ctx.check(11, 'agent token: set_clip_depth and set_living_picture commit; the still at frame 89 differs from the photo without the effect (the disc moved) and frame 0 does not; add_effect depth.living refused living_use_op',
      depth.status === 200 && live.status === 200 && moved > 0 && atStart === 0 && add.status !== 200 && why(add) === 'living_use_op',
      { setClipDepth: depth.status, setLiving: live.status, pixelsChangedAt89: moved, pixelsChangedAt0: atStart, stills: [before.status, after.status, first.status], addEffect: [add.status, why(add)] });
  } catch (e) { ctx.check(11, 'agent token edits and render_frame', false, { error: String(e).slice(0, 300) }); }

  // 13. a 2-second clip at amount 1 → living_too_fast with max = livingMaxAmount; update_effect raising past it refused; keys made
  // faster by replace_effect_keyframes → preflight living_too_fast with the clip id
  try {
    const { pid, clipId } = await project('living proof 13', 60);
    const max = livingMaxAmount(60, FPS, 'push', 'ease-in-out');
    const fast = await tx(pid, [{ op: 'set_living_picture', args: { clipId, depth: DISC, amount: 1 } }]);
    const made = await ok(pid, [{ op: 'set_living_picture', args: { clipId, depth: DISC, amount: max } }]);
    const effectId = made[0]!.output.effectId as string;
    const raise = await tx(pid, [{ op: 'update_effect', args: { clipId, effectId, params: { amount: 1 } } }]);
    const quiet = await call('GET', `/projects/${pid}/preflight`);
    await ok(pid, [{ op: 'replace_effect_keyframes', args: { clipId, effectId, param: 'travel', keys: [{ time: T.frameTime(0, FPS), value: 0, easing: 'linear' }, { time: T.frameTime(10, FPS), value: 1, easing: 'linear' }] } }]);
    const pf = await call('GET', `/projects/${pid}/preflight`);
    const warn = (pf.body?.issues ?? []).filter((i: any) => i.code === LIVING_PREFLIGHT.tooFast);
    const quietWarn = (quiet.body?.issues ?? []).filter((i: any) => i.code === LIVING_PREFLIGHT.tooFast);
    ctx.check(13, `a 2-second clip at amount 1 is refused living_too_fast with max ${max} (livingMaxAmount); update_effect raising it is refused; faster hand keys give preflight living_too_fast naming the clip`,
      fast.status !== 200 && why(fast) === 'living_too_fast' && fast.body?.error?.details?.max === max && raise.status !== 200 && why(raise) === 'living_too_fast'
        && quietWarn.length === 0 && warn.length === 1 && warn[0].severity === 'warning' && warn[0].ids?.includes(clipId),
      { refused: [fast.status, why(fast), fast.body?.error?.details?.max], max, raise: [raise.status, why(raise)], before: quietWarn.length, warning: warn[0] ? { ids: warn[0].ids, range: warn[0].range, measured: warn[0].measured } : null });
  } catch (e) { ctx.check(13, 'comfort refusals and the preflight warning', false, { error: String(e).slice(0, 300) }); }

  // 20. set_clip_depth null under a living picture refused; a document holding an enabled living picture and no depth (no op makes
  // it: it arrives in an archive, the way a split of older data or another build could leave it): the still is refused naming the
  // clip, the export plan is blocked, preflight warns living_no_depth. The editor's preview notice is the UI part's (W3) check.
  try {
    const { pid, clipId } = await project('living proof 20', 90);
    await ok(pid, [{ op: 'set_living_picture', args: { clipId, depth: DISC } }]);
    const nulled = await tx(pid, [{ op: 'set_clip_depth', args: { clipId, depth: null } }]);
    const tar = (await call('GET', `/projects/${pid}/archive`)).body as Buffer;
    const edited = rewriteProjectJson(tar, (doc) => { for (const sq of Object.values<any>(doc.sequences)) for (const t of sq.tracks) for (const c of t.clips) if (c.id === clipId) delete c.depth; });
    const imp = await fetch(`${ctx.url}/api/v1/projects/import`, { method: 'POST', headers: { ...h, 'content-type': 'application/x-tar' }, body: new Uint8Array(edited) });
    const pid2 = ((await imp.json()) as any)?.project?.id as string | undefined;
    if (pid2) ctx.noDepthProject?.(pid2, clipId);
    const still = pid2 ? await call('GET', `/projects/${pid2}/frame?index=45`) : { status: 0, body: null };
    const text = JSON.stringify(still.body ?? '').slice(0, 600);
    const plan = pid2 ? await call('POST', `/projects/${pid2}/exports/plan`, {}) : { status: 0, body: null };
    const pf = pid2 ? await call('GET', `/projects/${pid2}/preflight`) : { status: 0, body: null };
    const noDepth = (pf.body?.issues ?? []).filter((i: any) => i.code === LIVING_PREFLIGHT.noDepth && i.ids?.includes(clipId));
    ctx.check(20, 'set_clip_depth null under a living picture is refused living_needs_depth; an archived document with an enabled living picture and no depth: the still is refused naming the clip, the export plan is blocked, preflight warns living_no_depth',
      nulled.status !== 200 && why(nulled) === 'living_needs_depth' && imp.status === 201 && still.status !== 200 && text.includes(clipId) && (plan.body?.blockers ?? []).length > 0 && noDepth.length === 1,
      { nulled: [nulled.status, why(nulled)], imported: imp.status, still: [still.status, text.slice(0, 300)], planBlockers: plan.body?.blockers, preflight: noDepth.length });
  } catch (e) { ctx.check(20, 'living picture without a depth', false, { error: String(e).slice(0, 300) }); }
}

/** The same uncompressed tar with project.json replaced by `edit`ed JSON (headers rebuilt as archive.ts writes them). */
function rewriteProjectJson(tar: Buffer, edit: (doc: any) => void): Buffer {
  const parts: Buffer[] = [];
  for (let pos = 0; pos + 512 <= tar.length; ) {
    const head = tar.subarray(pos, pos + 512);
    if (head.every((x) => x === 0)) break;
    const name = head.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(head.subarray(124, 136).toString('ascii').replace(/[\0 ]/g, ''), 8);
    let body = tar.subarray(pos + 512, pos + 512 + size);
    const h = Buffer.from(head);
    if (name === 'project.json') {
      const doc = JSON.parse(body.toString('utf8'));
      edit(doc);
      body = Buffer.from(JSON.stringify(doc), 'utf8');
      h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
      h.write('        ', 148);
      let sum = 0;
      for (const x of h) sum += x;
      h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    }
    parts.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
    pos += 512 + size + ((512 - (size % 512)) % 512);
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
