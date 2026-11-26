/**
 * TEST DOUBLE — NOT THE PRODUCT. A labelled stand-in for W1's planGrowing and eyesFromTransform (core growing.ts), used ONLY by
 * growing.test.ts through vi.mock('@pulseframe/core') while core GROWING_BUILT is false. Once W1's planner is merged
 * (GROWING_BUILT true), withGrowingDouble returns core untouched and the server tests run against the real planner.
 * It follows the contract (growingContract.ts) closely enough for the server's own behaviour to be tested: the request is parsed
 * with GrowingParamsSchema; picks are laid in the GIVEN order (no capture sort), hold = holdFrames or round(fps), cut_i = at + i·hold
 * over the whole list (a pick kept or deleted by hand keeps its index); kept_by_hand / removed_by_hand exclusions come before the
 * eyes are required; the solve is the similarity transform of plan §4.1 (left eye on the left target); a held frame is
 * add_clip { freeze: true }; a short dissolve (⌊hold/3⌋) on each pick after the first; no captions, no coverage, no warnings but
 * moved_back / kept_by_hand / removed_by_hand. Nothing here is imported by the server.
 * It takes the real core module as an argument (type-only imports), so it never imports the module it stands in for.
 */
import type * as Core from '@pulseframe/core';
import type { EyePoint, GrowingFrame, GrowingTarget, GrowingTransform, ShownSize } from '@pulseframe/core';
import * as T from '@pulseframe/time';

type CoreModule = typeof Core;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const targets = (frame: GrowingFrame, t: GrowingTarget) => {
  const y = frame.height / 2 + t.eyeLine * frame.height, half = (t.faceSize * frame.width) / 2;
  return { L: { x: frame.width / 2 - half, y }, R: { x: frame.width / 2 + half, y } };
};

export function makeGrowingDouble(core: CoreModule) {
  const solve = (eyes: readonly [EyePoint, EyePoint], shown: ShownSize, frame: GrowingFrame, target: GrowingTarget) => {
    const k = core.fitScale(frame.width, frame.height, shown.width, shown.height, frame.fit);
    const pw = shown.width * k, ph = shown.height * k;
    const A = eyes.map((e) => ({ x: (e.u - 0.5) * pw, y: (e.v - 0.5) * ph }));
    const { L, R } = targets(frame, target);
    const Dx = A[1]!.x - A[0]!.x, Dy = A[1]!.y - A[0]!.y, len = Math.hypot(Dx, Dy);
    const scale = (R.x - L.x) / len;
    const c = Dx / len, s = -Dy / len; // rotate D onto +x (clockwise rotation by −atan2(Dy, Dx))
    const rx = c * A[0]!.x - s * A[0]!.y, ry = s * A[0]!.x + c * A[0]!.y;
    const cx = L.x - scale * rx, cy = L.y - scale * ry;
    const transform: GrowingTransform = { x: r6((cx - frame.width / 2) / frame.width), y: r6((cy - frame.height / 2) / frame.height), scale: r6(scale), rotation: r6((Math.atan2(-Dy, Dx) * 180) / Math.PI) };
    const inBounds = transform.scale >= 0.01 && transform.scale <= 20 && Math.abs(transform.x) <= 4 && Math.abs(transform.y) <= 4;
    return { transform, magnification: transform.scale * k, inBounds };
  };
  const eyesFromTransform: CoreModule['eyesFromTransform'] = (t, shown, frame, target) => {
    const pl = core.placed(frame.width, frame.height, frame.fit, shown.width, shown.height, t);
    const { L, R } = targets(frame, target);
    return [L, R].map((p) => { const q = core.frameToSource(pl, p.x, p.y); return { u: q.u, v: q.v }; }) as [EyePoint, EyePoint];
  };
  const planGrowing: CoreModule['planGrowing'] = (doc, raw, ctx) => {
    const parsed = core.GrowingParamsSchema.safeParse(raw);
    if (!parsed.success) { const i = parsed.error.issues[0]!; throw core.growingRefusal('badParams', {}, `${i.path.join('.')}: ${i.message}`); }
    const P = parsed.data;
    const rate = doc.settings.frameRate, fps = rate.num / rate.den;
    const holdFrames = P.holdFrames ?? Math.round(fps);
    const min = core.flashGapFrames(fps);
    if (holdFrames < min) throw core.growingRefusal('holdTooShort', {}, min);
    const at = P.at ?? T.ZERO;
    const atF = T.nearestFrameIndex(at, rate);
    const resolved: Core.ResolvedGrowingParams = { picks: P.picks, sort: P.sort ?? 'capture', holdFrames, dissolve: P.dissolve ?? 'short', faceSize: P.faceSize ?? core.GROWING.faceSize.default, eyeLine: P.eyeLine ?? core.GROWING.eyeLine.default, fill: 'colour', caption: P.caption ?? null, personId: P.personId ?? null, at };
    const frame = { width: doc.settings.width, height: doc.settings.height, fit: doc.settings.fit ?? 'contain' } as GrowingFrame;
    const kept = new Set(ctx.keptKeys ?? []), removed = new Set(ctx.removedKeys ?? []);
    const ops: Core.TemplateStep[] = [], slots: Core.PlannedSlot[] = [], picks: Core.GrowingPick[] = [], excluded: Core.GrowingExclusion[] = [], picked: Core.GrowingPicked[] = [];
    const warnings: Core.GrowingWarning[] = [];
    const D = P.dissolve === 'none' ? 0 : Math.max(1, Math.floor(holdFrames / 3));
    let track: string | { $ref: string; out: string } | null = ctx.reuseTracks?.pictures ?? null;
    let first = true;
    for (const [i, p] of P.picks.entries()) {
      const key = core.growingPickKey(p.assetId, p.frame);
      if (kept.has(key)) { excluded.push({ key, assetId: p.assetId, frame: p.frame, code: 'kept_by_hand', details: {} }); continue; }
      if (removed.has(key)) { excluded.push({ key, assetId: p.assetId, frame: p.frame, code: 'removed_by_hand', details: {} }); continue; }
      const asset = Object.hasOwn(doc.assets, p.assetId) ? doc.assets[p.assetId] : undefined;
      if (!asset) throw core.growingRefusal('assetMissing', {});
      if (!p.eyes) throw core.growingRefusal('needsMarks', { key });
      const shown = asset.image ?? asset.video;
      if (!shown) throw core.growingRefusal('noPicture', {});
      const sol = solve(p.eyes, shown, frame, { faceSize: resolved.faceSize, eyeLine: resolved.eyeLine });
      if (!sol.inBounds) { excluded.push({ key, assetId: p.assetId, frame: p.frame, code: 'outside_transform_range', details: {} }); continue; }
      if (track === null) { ops.push({ op: 'add_track', args: { kind: 'video' }, bind: 'pictures-track' }); track = { $ref: 'pictures-track', out: 'trackId' }; }
      const startFrame = atF + i * holdFrames;
      const timing = { trackId: track, start: T.frameTime(startFrame, rate), duration: T.frameTime(holdFrames, rate) };
      ops.push(p.frame === null ? { op: 'add_clip', args: { assetId: p.assetId, ...timing, withLinkedAudio: false }, bind: key } : { op: 'add_clip', args: { assetId: p.assetId, ...timing, freeze: true, sourceIn: core.sourceTimeOfFrame(asset, p.frame) }, bind: key });
      ops.push({ op: 'set_clip_transform', args: { clipId: { $ref: key }, transform: sol.transform } });
      const dissolve = first ? 0 : D;
      if (dissolve) ops.push({ op: 'set_transition', args: { clipId: { $ref: key }, type: 'dissolve', frames: dissolve } });
      first = false;
      slots.push({ key, kind: 'picture', clipId: { $ref: key }, accept: p.frame === null ? 'image' : 'video' });
      picked.push({ key, assetId: p.assetId, frame: p.frame });
      picks.push({ key, assetId: p.assetId, frame: p.frame, order: picks.length, capture: ctx.capture[p.assetId] ?? null, startFrame, frames: holdFrames, dissolveFrames: dissolve, transform: sol.transform, magnification: sol.magnification, uncoveredShare: 0, caption: null, reasons: [] });
    }
    if (ctx.movedKeys?.length) warnings.push({ code: 'moved_back', message: 'TEST DOUBLE: moved back', details: { keys: [...ctx.movedKeys] } });
    const endFrame = atF + P.picks.length * holdFrames;
    return {
      recipeId: core.GROWING_RECIPE_ID, templateId: core.GROWING_TEMPLATE_ID, version: core.GROWING_VERSION, params: resolved, record: core.growingRunRecordParams(resolved, picked),
      steps: [`TEST DOUBLE: place ${picks.length} picture(s)`], basis: [], warnings, picks, excluded, ops, slots, suggestedFaceSize: null,
      predicted: { startFrame: atF, endFrame, holdFrames, dissolveFrames: D, seconds: (endFrame - atF) / fps }, method: core.GROWING_METHOD,
    };
  };
  return { planGrowing, eyesFromTransform, solve };
}

/** The core module with the double in place of the planner while W1's is not built; core itself once it is. */
export function withGrowingDouble(core: CoreModule): CoreModule {
  if (core.GROWING_BUILT) return core;
  const d = makeGrowingDouble(core);
  return { ...core, planGrowing: d.planGrowing, eyesFromTransform: d.eyesFromTransform };
}
