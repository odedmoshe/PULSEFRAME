/**
 * pnpm proof:craft, part ops (W1): checks R1–R7, P1–P3, P5–P8, F1–F6, F9, F11 of craft-proof.ts. Runs in Node through the server's
 * Store (commit, undo, redo, replay: the path every edit takes) on synthetic documents typed here: a video, a sound and a still
 * described by their probe facts (no media is read: the ops and the evaluator need only those facts), typed Hebrew texts and a
 * typed transcript. Never the owner's media.
 *
 * WHAT "THE SAME STILL" MEANS HERE (P1, R1, R2, P7). Pixels are not drawn in this part: two documents give the same still when
 * the engine's evaluate() gives the same render graph for the frame (the compositor's whole input; ADR-0005: preview, still and
 * export draw that graph with one compositor). Effect and clip ids are left out of the comparison (a paste makes new effect ids).
 * The flash check of P7 compares the strobe schedule the export check and the preview read (strobeSchedule.ts flashSchedule)
 * and every frame's graph of the range; the rendered-frame photosensitivity analysis (server flashCheck.ts) needs a renderer
 * and is not run here.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import {
  ASSISTANT_EXCLUDED_OPS, assistantOps, creativeProjection, durationOps, editEnd, findClip, findText, HEBREW_MARKS, parseFields, parseTimeEntry, planPasteAttributes, planReplace,
  ProjectSchema, RIPPLE_TRIM_WORDS, validateProject, type Clip, type FindQuery, type OpCall, type PasteAttributesOutput, type ProjectDocument, type ReplaceTextOutput,
} from '@pulseframe/core';
import { evaluate, flashSchedule } from '@pulseframe/engine';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { checkModelAnswer } from '../../../apps/server/src/assistant/validate.ts';
import { dictionaries, translateRefusal } from '../../i18n/src/index.ts';
import { createFuzz } from './ops-fuzz.gen.ts';
import type { CraftProofPart } from './craft-proof.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof' };
const VIDEO = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const MUSIC = { kind: 'audio' as const, name: 'beep.wav', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };
const STILL = { kind: 'image' as const, name: 'bars.png', contentHash: `sha256:${'3'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 800, height: 600, codec: 'png', hasAlpha: false }, provenance: prov };

/** How a fixture is built: through the store here, through applyTransaction in a unit test (craft-wording.test.ts). */
export type Apply = (ops: OpCall[], internal?: boolean) => { doc: ProjectDocument; outputs: (Record<string, unknown> | undefined)[] };
export interface Film { doc: ProjectDocument; vid: string; mus: string; still: string; A: string; B: string; C: string; As: string; Bs: string; Cs: string; title: string; music: string; v1: string }
/**
 * The film: on V1 three shots A [0,30) B [30,60) C [60,90) of one video, each with its linked sound on A1, a title «שלום נעה»
 * [40,70) on its own track, music [0,90) on A2, a marker at 70, ripple delete on.
 */
export function buildFilm(apply: Apply): Film {
  apply([{ op: 'import_asset', args: { asset: VIDEO } }, { op: 'import_asset', args: { asset: MUSIC } }, { op: 'import_asset', args: { asset: STILL } }], true);
  let doc = apply([{ op: 'set_timeline_behaviour', args: { rippleDelete: true } }]).doc;
  const byName = (n: string) => Object.values(doc.assets).find((a) => a.name === n)!.id;
  const [vid, mus, still] = [byName('v.mp4'), byName('beep.wav'), byName('bars.png')];
  const shots: { clipId: string; trackId: string; audioClipId: string }[] = [];
  for (const [i, at] of [0, 30, 60].entries()) {
    const first = shots[0];
    const r = apply([{ op: 'add_clip', args: { assetId: vid, start: f(at), sourceIn: f(i * 40), duration: f(30), ...(first ? { trackId: first.trackId, audioTrackId: findClip(doc, first.audioClipId)!.track.id } : {}) } }]);
    doc = r.doc; shots.push(r.outputs[0] as never);
  }
  let r = apply([{ op: 'add_text', args: { text: 'שלום נעה', start: f(40), duration: f(30) } }]);
  const title = (r.outputs[0] as { clipId: string }).clipId;
  r = apply([{ op: 'add_clip', args: { assetId: mus, start: f(0), duration: f(90) } }]);
  const music = (r.outputs[0] as { clipId: string }).clipId;
  doc = apply([{ op: 'add_marker', args: { time: f(70), label: 'סימן' } }]).doc;
  const [A, B, C] = shots.map((s) => s.clipId) as [string, string, string];
  const [As, Bs, Cs] = shots.map((s) => s.audioClipId) as [string, string, string];
  return { doc, vid, mus, still, A, B, C, As, Bs, Cs, title, music, v1: shots[0]!.trackId };
}

// ---------------------------------------------------------------- the store
const dirs: string[] = [];
class Proj {
  s: Store; pid: string; film: Film;
  constructor(rate = R) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-craftproof-'));
    dirs.push(dir);
    this.s = new Store(dir);
    this.pid = this.s.createProject({ name: 'craft-proof', width: 640, height: 360, frameRate: rate }).doc.id;
    this.film = rate === R ? buildFilm((ops, internal) => this.apply(ops, internal)) : (null as never);
  }
  apply(ops: OpCall[], internal = false) {
    const r = this.commit(ops, internal);
    return { doc: this.doc(), outputs: r.results.map((x) => x.output) };
  }
  commit(ops: OpCall[], internal = false) { return this.s.commit({ projectId: this.pid, actor: internal ? 'system' : 'user:owner', ops, ...(internal ? { allowInternal: true } : {}) }); }
  /** The refusal of a commit, and that the stored document did not change. */
  refused(ops: OpCall[]): ApiError | string {
    const before = this.hash();
    try { this.commit(ops); } catch (e) { if (!(e instanceof ApiError)) throw e; return this.hash() === before ? e : 'a refused commit changed the document'; }
    return 'not refused';
  }
  doc() { return this.s.getProject(this.pid).doc; }
  revision() { return this.s.getProject(this.pid).revision; }
  hash() { return createHash('sha256').update(JSON.stringify(this.doc())).digest('hex'); }
  undo() { this.s.undo(this.pid, 'user:owner', 'undo'); }
  close() { this.s.close(); }
}
function closeAll() { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }

const fr = (t: T.RationalTime) => T.frameIndexAt(t, R);
const clipOf = (doc: ProjectDocument, id: string) => findClip(doc, id)!.clip;
const startOf = (doc: ProjectDocument, id: string) => fr(clipOf(doc, id).start);
const endOf = (doc: ProjectDocument, id: string) => fr(T.add(clipOf(doc, id).start, clipOf(doc, id).duration));
const layerOf = (doc: ProjectDocument, frame: number, clipId: string) => evaluate(doc, f(frame)).layers.find((l) => 'clipId' in l && l.clipId === clipId) as { sourceFrameIndex?: number } | undefined;
/** Deep copy without ids (`id` and every `…Id` value): two graphs compared as the compositor sees them, whatever ids a paste or another project made. */
const noIds = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' || /Id$/.test(k) ? undefined : v)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (what: string, got: unknown) => `${what}: ${JSON.stringify(got).slice(0, 400)}`;
/** Run one check, closing its stores and turning a throw into a failure sentence. */
const check = (run: () => true | string | Promise<true | string>) => async (): Promise<true | string> => {
  try { return await run(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 500)}`; } finally { closeAll(); }
};
const flagsAll = { wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false };
const q = (text: string, o: Partial<FindQuery> = {}): FindQuery => ({ text, ...flagsAll, scope: 'project', formats: 'all', ...o });
const paste = (fromClipId: string, toClipIds: string[], groups: string[]): OpCall => ({ op: 'paste_attributes', args: { fromClipId, toClipIds, groups } });
const lastOutput = <O>(r: { results: { output?: Record<string, unknown> }[] }) => r.results.at(-1)!.output as unknown as O;

// ---------------------------------------------------------------- R: ripple and time
const R1 = check(() => {
  const p = new Proj(); const { B, C, Cs, title, music } = p.film;
  const before = p.doc(), k = 12;
  const shown = layerOf(before, 30 + k, B)?.sourceFrameIndex;
  p.commit([{ op: 'ripple_trim', args: { clipId: B, edge: 'start', to: f(30 + k) } }]);
  const after = p.doc();
  const first = layerOf(after, 30, B)?.sourceFrameIndex;
  if (shown === undefined || first !== shown) return fail('the first frame of the trimmed clip does not show the frame that was under the playhead', { shown, first });
  if (fr(T.sub(editEnd(before), editEnd(after))) !== k) return fail('the edit is not exactly k frames shorter', { before: fr(editEnd(before)), after: fr(editEnd(after)) });
  if (startOf(after, C) !== 60 - k || startOf(after, Cs) !== 60 - k) return fail('a later main-track clip or its sound did not move by −k', [startOf(after, C), startOf(after, Cs)]);
  if (startOf(after, title) !== 40 || startOf(after, music) !== 0 || fr(Object.values(after.markers)[0]!.time) !== 70) return 'music, the title or the marker moved';
  return true;
});
const R2 = check(() => {
  const p = new Proj(); const { B, C, Cs, title, music } = p.film;
  const before = p.doc(), k = 50;
  const last = layerOf(before, k - 1, B)?.sourceFrameIndex;
  p.commit([{ op: 'ripple_trim', args: { clipId: B, edge: 'end', to: f(k) } }]);
  const after = p.doc();
  if (endOf(after, B) !== k || layerOf(after, k - 1, B)?.sourceFrameIndex !== last) return fail('the tail is not cut at the playhead', [endOf(after, B), layerOf(after, k - 1, B)]);
  if (fr(T.sub(editEnd(before), editEnd(after))) !== 60 - k) return 'the edit is not exactly the cut length shorter';
  if (startOf(after, C) !== k || startOf(after, Cs) !== k) return fail('the later clip and its sound did not close up', [startOf(after, C), startOf(after, Cs)]);
  if (startOf(after, title) !== 40 || startOf(after, music) !== 0 || fr(Object.values(after.markers)[0]!.time) !== 70) return 'music, the title or the marker moved';
  return true;
});
const R3 = check(() => {
  const p = new Proj(); const { B } = p.film;
  for (const [edge, at] of [['start', 41], ['end', 52]] as const) {
    const h = p.hash();
    p.commit([{ op: 'ripple_trim', args: { clipId: B, edge, to: f(at) } }]);
    if (p.hash() === h) return `${edge}: nothing changed`;
    p.undo();
    if (p.hash() !== h) return `${edge}: Ctrl+Z does not give the exact document hash back`;
  }
  return true;
});
const R4 = check(() => {
  const p = new Proj(); const { A, As, Bs } = p.film;
  p.commit([{ op: 'delete_clip', args: { clipId: As, includeLinked: false } }, { op: 'move_clip', args: { clipId: Bs, start: f(2), includeLinked: false } }]);
  const e = p.refused([{ op: 'ripple_trim', args: { clipId: A, edge: 'start', to: f(10) } }]);
  if (typeof e === 'string') return e;
  if (e.message !== RIPPLE_TRIM_WORDS.beforeZero(Bs) || e.hint !== RIPPLE_TRIM_WORDS.beforeZeroHint) return fail('not the trim wording', [e.message, e.hint]);
  const he = translateRefusal('he', e.message) ?? '';
  if (!/[֐-׿]/.test(he) || /Shift\+Delete|למחוק/.test(he) || /delete/i.test(e.hint ?? '')) return fail('the words give Delete\'s advice or are not Hebrew', [he, e.hint]);
  return true;
});
const R5 = check(() => {
  const ntsc = { num: 30000, den: 1001 };
  const p = new Proj(ntsc);
  p.commit([{ op: 'import_asset', args: { asset: STILL } }], true);
  p.commit([{ op: 'set_timeline_behaviour', args: { rippleDelete: true } }]);
  const still = Object.keys(p.doc().assets)[0]!;
  const ids = [0, 1, 2, 3, 4, 5].map((i) => (lastOutput<{ clipId: string }>(p.commit([{ op: 'add_clip', args: { assetId: still, start: T.frameTime(i * 60, ntsc), duration: T.frameTime(60, ntsc) } }]))).clipId);
  const typed = parseTimeEntry('5s', ntsc);
  if (!typed.ok) return 'the time 5s was refused';
  const h = p.hash(), rev = p.revision();
  p.commit(durationOps(p.doc(), ids, typed.frame)!);
  const d = p.doc();
  const rows = ids.map((id) => [T.frameIndexAt(clipOf(d, id).start, ntsc), T.frameIndexAt(clipOf(d, id).duration, ntsc)]);
  if (!same(rows, [0, 1, 2, 3, 4, 5].map((i) => [i * 150, 150]))) return fail('not six contiguous clips of 150 frames', rows);
  if (p.revision() !== rev + 1) return 'more than one transaction';
  p.undo();
  return p.hash() === h ? true : 'one undo does not give the document back';
});
const R6 = check(() => {
  const ntsc = { num: 30000, den: 1001 };
  const want: [string, number | undefined, unknown][] = [
    ['00:00:10:00', undefined, { ok: true, frame: 300, relative: false, rounded: false }], ['1:10', undefined, { ok: true, frame: 2098, relative: false, rounded: true }],
    ['+12', 100, { ok: true, frame: 112, relative: true, rounded: false }], ['-1:00', 3000, { ok: true, frame: 3000 - 1798, relative: true, rounded: true }],
    ['90', undefined, { ok: true, frame: 90, relative: false, rounded: false }], ['0.5f', undefined, { ok: false, reason: 'not_whole_frames' }], ['abc', undefined, { ok: false, reason: 'unreadable' }],
  ];
  for (const [text, base, exp] of want) { const got = parseTimeEntry(text, ntsc, base); if (!same(got, exp)) return fail(`«${text}»`, got); }
  // a refused entry is said in words (both languages) and builds no op, so nothing moves
  for (const reason of ['not_whole_frames', 'unreadable'] as const) for (const lang of ['he', 'en'] as const) if (!(dictionaries[lang] as Record<string, string>)[`craft.time.${reason}`]) return `no ${lang} words for ${reason}`;
  return true;
});
const R7 = check(() => {
  const r = spawnSync('pnpm', ['exec', 'vitest', 'run', 'packages/evals/src/ripple-delete-golden.test.ts'], { encoding: 'utf8', timeout: 600_000 });
  return r.status === 0 ? true : fail('ripple-delete.golden.json does not replay', (r.stdout + r.stderr).slice(-600));
});

// ---------------------------------------------------------------- P: paste attributes
/** Five targets: B, C and three stills on V2. */
function fiveTargets(p: Proj): string[] {
  p.commit([{ op: 'add_track', args: { kind: 'video' } }]);
  const v2 = p.doc().sequences[p.doc().mainSequenceId]!.tracks.filter((t) => t.kind === 'video')[1]!.id;
  const stills = [0, 30, 60].map((at) => lastOutput<{ clipId: string }>(p.commit([{ op: 'add_clip', args: { assetId: p.film.still, start: f(at), duration: f(30), trackId: v2 } }])).clipId);
  return [p.film.B, p.film.C, ...stills];
}
const P1 = check(() => {
  const p = new Proj(); const { A } = p.film;
  const targets = fiveTargets(p);
  const grade = [{ type: 'color.grade', params: { exposure: 0.3, temperature: 0.2 } }, { type: 'color.sepia', params: { amount: 0.4 } }];
  p.commit(grade.map((g) => ({ op: 'add_effect', args: { clipId: A, ...g } })));
  const base = p.doc();
  // by hand, on a copy of the same document: the same effects added to each target
  const hand = new Proj(); const handTargets = fiveTargets(hand);
  hand.commit(grade.map((g) => ({ op: 'add_effect', args: { clipId: hand.film.A, ...g } })));
  hand.commit(handTargets.flatMap((id) => grade.map((g) => ({ op: 'add_effect', args: { clipId: id, ...g } }))));
  p.commit([paste(A, targets, ['colour'])]);
  const d = p.doc();
  const src = noIds(clipOf(base, A).effects);
  for (const id of targets) if (!same(noIds(clipOf(d, id).effects), src)) return fail(`clip ${id}: effects differ from the source's`, clipOf(d, id).effects);
  for (const [i, id] of targets.entries()) {
    const at = startOf(d, id) + 5;
    if (!same(noIds(evaluate(d, f(at))), noIds(evaluate(hand.doc(), f(at))))) return `target ${i}: the still differs from the still with the effect added by hand`;
  }
  return true;
});
const P2 = check(() => {
  const p = new Proj(); const { A, B, Bs, title } = p.film;
  const cue = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_cue', args: { start: f(0), duration: f(30), text: 'שלום' } }])).clipId;
  p.commit([{ op: 'add_track', args: { kind: 'video' } }]);
  const v2 = p.doc().sequences[p.doc().mainSequenceId]!.tracks.filter((t) => t.kind === 'video')[1]!.id;
  const locked = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_clip', args: { assetId: p.film.still, start: f(0), duration: f(30), trackId: v2 } }])).clipId;
  p.commit([{ op: 'update_track', args: { trackId: v2, locked: true } }, { op: 'add_effect', args: { clipId: A, type: 'color.sepia', params: {} } }, { op: 'set_clip_gain', args: { clipId: A, gain: 0.5 } }]);
  const args = { fromClipId: A, toClipIds: [B, title, Bs, cue, locked], groups: ['colour', 'transform', 'sound'] as ('colour' | 'transform' | 'sound')[] };
  const plan = planPasteAttributes(p.doc(), args);
  const h = p.hash(), rev = p.revision();
  const o = lastOutput<PasteAttributesOutput>(p.commit([paste(A, args.toClipIds, args.groups)]));
  if (!same([plan.applied, plan.skipped, plan.keysLeftOut], [o.applied, o.skipped, o.keysLeftOut])) return fail('the dialog rows differ from the commit', { plan, o });
  const codes = new Set(['source_empty', 'target_animated', 'unknown_op', 'invalid_args', 'not_found', 'track_locked', 'overlap', 'out_of_bounds', 'incompatible', 'forbidden_op', 'invalid_result', 'not_time_preserving', 'range_not_covered', 'untimed_copy']);
  if (!o.skipped.length || o.skipped.some((s) => !codes.has(s.code) || !s.message)) return fail('a skipped row without its op\'s code', o.skipped);
  if (!o.skipped.some((s) => s.clipId === locked && s.code === 'track_locked')) return 'the clip on the locked track is not listed as track_locked';
  if (p.revision() !== rev + 1) return 'more than one transaction';
  p.undo();
  return p.hash() === h ? true : 'undo does not give the exact hash back';
});
const P3 = check(() => {
  const p = new Proj();
  p.commit([{ op: 'add_track', args: { kind: 'video' } }]);
  const v2 = p.doc().sequences[p.doc().mainSequenceId]!.tracks.filter((t) => t.kind === 'video')[1]!.id;
  const src = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_clip', args: { assetId: p.film.still, start: f(0), duration: f(60), trackId: v2 } }])).clipId;
  const keys = [{ time: f(0), value: 1, easing: 'ease-in' }, { time: f(20), value: 1.3, easing: 'bezier', bezier: [0.3, 0.1, 0.2, 0.9] }, { time: f(55), value: 1.1, easing: 'linear' }];
  p.commit([{ op: 'replace_clip_keyframes', args: { clipId: src, property: 'scale', keys } }]);
  const o = lastOutput<PasteAttributesOutput>(p.commit([paste(src, [p.film.A, p.film.B], ['animation'])]));
  if (o.keysLeftOut !== 2) return fail('the keys past the 30-frame targets are not counted', o.keysLeftOut);
  const want = JSON.stringify(clipOf(p.doc(), src).keyframes!.scale!.slice(0, 2));
  for (const id of [p.film.A, p.film.B]) if (JSON.stringify(clipOf(p.doc(), id).keyframes!.scale) !== want) return fail('the pasted curve is not bit-equal', clipOf(p.doc(), id).keyframes);
  const r = spawnSync('pnpm', ['baseline:keys', '--check'], { encoding: 'utf8', timeout: 600_000 });
  return r.status === 0 ? true : fail('baseline:keys --check reports differences', (r.stdout + r.stderr).slice(-400));
});
const P5 = check(() => {
  const p = new Proj(); const { B, C } = p.film;
  p.commit([{ op: 'add_effect', args: { clipId: B, type: 'color.sepia', params: {} } }, { op: 'add_effect', args: { clipId: B, type: 'stylize.grain', params: {} } }]);
  const h = p.hash(), had = JSON.stringify(clipOf(p.doc(), B).effects);
  const e = p.refused([paste(C, [B], ['colour', 'effects'])]);
  if (typeof e === 'string') return e;
  const plan = planPasteAttributes(p.doc(), { fromClipId: C, toClipIds: [B], groups: ['colour', 'effects'] });
  if (!plan.skipped.every((s) => s.code === 'source_empty')) return fail('not source_empty', plan.skipped);
  return p.hash() === h && JSON.stringify(clipOf(p.doc(), B).effects) === had ? true : 'the target lost effects';
});
const P6 = check(() => {
  const unit = spawnSync('pnpm', ['exec', 'vitest', 'run', 'packages/evals/src/craft-fuzz.test.ts'], { encoding: 'utf8', timeout: 600_000 });
  if (unit.status !== 0) return fail('craft-fuzz fails', (unit.stdout + unit.stderr).slice(-600));
  // through the store: random craft calls among others, then undo all, redo all, replay from revision 0
  for (const seed of [1, 2, 3]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-craftfuzz-')); dirs.push(dir);
    const s = new Store(dir);
    try {
      const fz = createFuzz(seed + 7100);
      const pid = s.createProject({ name: 'cf', width: 640, height: 360, frameRate: fz.rate }).doc.id;
      s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
      s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
      const proj = () => creativeProjection(s.getProject(pid).doc);
      const states = [proj()];
      for (let step = 0; step < 50; step++) {
        const doc = s.getProject(pid).doc;
        const call = step % 2 === 0 ? fz.genCraft(doc) : fz.genFocused(doc, ['add_text', 'add_clip', 'trim_clip', 'add_effect', 'set_clip_transform', 'set_keyframe']);
        try {
          const r = s.commit({ projectId: pid, actor: 'u', ops: [call] });
          if (!r.committed) continue;
          const next = s.getProject(pid).doc;
          if (validateProject(next).length || !ProjectSchema.safeParse(next).success) return `seed ${seed} step ${step}: an accepted step left an invalid document`;
          states.push(proj());
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          if (proj() !== states.at(-1)) return `seed ${seed} step ${step}: a refused step changed the project`;
        }
      }
      for (let i = states.length - 2; i >= 0; i--) { s.undo(pid, 'u', 'undo'); if (proj() !== states[i]) return `seed ${seed}: undo ${i + 1} is not exact`; }
      for (let i = 1; i < states.length; i++) { s.undo(pid, 'u', 'redo'); if (proj() !== states[i]) return `seed ${seed}: redo ${i} is not exact`; }
      if (JSON.stringify(s.replay(pid).doc) !== JSON.stringify(s.getProject(pid).doc)) return `seed ${seed}: replay does not reproduce the document`;
    } finally { s.close(); }
  }
  return true;
});
const P7 = check(() => {
  const build = () => { const p = new Proj(); return { p, targets: fiveTargets(p) }; };
  const { p, targets } = build();
  const strobe = { type: 'light.strobe', params: { rate: 2, amount: 0.5 } };
  p.commit([{ op: 'add_effect', args: { clipId: p.film.A, ...strobe } }, { op: 'add_effect', args: { clipId: p.film.A, type: 'color.adjust', params: {} } }]);
  // A turning-back curve on brightness: no op makes one and validateProject refuses any document that holds one, so it is
  // planted in a copy that is never committed (as an old or hand-edited file could hold it) and the paste is PLANNED on it:
  // the colour pair is left out with the light rule's own code. The strobe is then pasted for real, on the valid document.
  const planted = structuredClone(p.doc());
  const adj = clipOf(planted, p.film.A).effects!.find((e) => e.type === 'color.adjust')!;
  adj.keyframes = { brightness: [{ time: f(0), value: 1, easing: 'overshoot' }, { time: f(20), value: 1.3, easing: 'linear' }] };
  const plan = planPasteAttributes(planted, { fromClipId: p.film.A, toClipIds: targets, groups: ['colour', 'effects'] });
  const colourSkips = plan.skipped.filter((s) => s.group === 'colour');
  if (colourSkips.length !== targets.length || colourSkips.some((s) => s.code !== 'invalid_args' || !/turns back/.test(s.message))) return fail('the turning-back curve was not skipped with its op\'s code', plan.skipped);
  if (plan.applied.filter((r) => r.group === 'effects').length !== targets.length) return fail('the strobe was not planned onto every target', plan.applied);
  p.commit([paste(p.film.A, targets, ['effects'])]);
  const src = clipOf(p.doc(), p.film.A).effects!.find((e) => e.type === 'light.strobe')!;
  for (const id of targets) {
    const s = clipOf(p.doc(), id).effects?.find((e) => e.type === 'light.strobe');
    if (!s || !same(s.params, src.params)) return fail(`clip ${id}: the strobe's parameters differ`, s);
  }
  // the same strobe added by hand to the same five clips of an identical project; the source's own effects set aside in both
  const hand = build();
  hand.p.commit(hand.targets.map((id) => ({ op: 'add_effect', args: { clipId: id, ...strobe } })));
  const strip = (d: ProjectDocument, a: string) => { const c = structuredClone(d); clipOf(c, a).effects = []; return c; };
  const pd = strip(p.doc(), p.film.A), hd = strip(hand.p.doc(), hand.p.film.A);
  if (!same(noIds(flashSchedule(pd)), noIds(flashSchedule(hd)))) return 'the flash schedule of the range differs from the one with the strobes added by hand';
  for (let k = 0; k < 90; k++) if (!same(noIds(evaluate(pd, f(k))), noIds(evaluate(hd, f(k))))) return `frame ${k} differs from the hand-added strobe`;
  return true;
});
const P8 = check(() => {
  const p = new Proj(); const { A, B } = p.film;
  p.commit([{ op: 'set_clip_transform', args: { clipId: A, transform: { x: 0.25 } } }, { op: 'set_keyframe', args: { clipId: A, property: 'scale', time: f(0), value: 1.1 } }, { op: 'set_keyframe', args: { clipId: B, property: 'x', time: f(0), value: -0.2 } }]);
  const plan = planPasteAttributes(p.doc(), { fromClipId: A, toClipIds: [B], groups: ['transform'] });
  if (!same(plan.skipped.map((s) => s.code), ['target_animated'])) return fail('not skipped as target_animated', plan.skipped);
  p.commit([paste(A, [B], ['transform', 'animation'])]);
  const b = clipOf(p.doc(), B), a = clipOf(p.doc(), A);
  return !b.keyframes?.x && same(b.keyframes?.scale, a.keyframes?.scale) && same(b.transform, a.transform) ? true : fail('with both ticked the keys were not replaced', b);
});

// ---------------------------------------------------------------- F: find and replace
/** «נעה» planted: the title, two cues, a phrase, and one format's wording; one more title that stays unticked. */
function planted(p: Proj) {
  const { title, vid } = p.film;
  const cue1 = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_cue', args: { start: f(0), duration: f(30), text: 'נעה כאן' } }])).clipId;
  const cue2 = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_cue', args: { start: f(30), duration: f(30), text: 'שוב נעה, נעה!' } }])).clipId;
  p.commit([{ op: 'set_transcript', args: { assetId: vid, language: 'he', segments: [{ start: T.rt(1, 2), duration: T.rt(1, 1), text: 'נעה הולכת', words: [{ start: T.rt(1, 2), duration: T.rt(1, 2), text: 'נעה' }, { start: T.rt(1, 1), duration: T.rt(1, 2), text: 'הולכת' }] }] } }]);
  const variantId = lastOutput<{ variantId: string }>(p.commit([{ op: 'add_variant', args: { width: 360, height: 640, name: 'אנכי' } }])).variantId;
  p.commit([{ op: 'set_variant_override', args: { variantId, clipId: title, text: 'היי נעה' } }]);
  const other = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_text', args: { text: 'נעה לא', start: f(75), duration: f(10) } }])).clipId;
  return { cue1, cue2, variantId, other, count: 1 + 1 + 2 + 1 + 1 + 1 };
}
const count = (doc: ProjectDocument, text: string, o: Partial<FindQuery> = {}) => findText(doc, q(text, { wholeWord: true, ...o })).reduce((n, m) => n + m.ranges.length, 0);
const F1 = check(() => {
  const p = new Proj();
  const pl = planted(p);
  const doc = p.doc();
  const matches = findText(doc, q('נעה', { wholeWord: true }));
  if (count(doc, 'נעה') !== pl.count) return fail('the count is not the planted count', count(doc, 'נעה'));
  const untick = matches.findIndex((m) => m.at.kind === 'title' && 'clipId' in m.at && m.at.clipId === pl.other);
  const plan = planReplace(doc, q('נעה', { wholeWord: true }), 'נועה', matches.map((_, i) => i).filter((i) => i !== untick));
  const h = p.hash(), rev = p.revision();
  const o = lastOutput<ReplaceTextOutput>(p.commit([{ op: 'replace_text', args: { edits: plan.edits } }]));
  const d = p.doc();
  if (o.changed !== matches.length - 1 || count(d, 'נעה') !== 1 || count(d, 'נועה') !== pl.count - 1) return fail('replaced count', { o, left: count(d, 'נעה') });
  if ((clipOf(d, pl.other) as { text: string }).text !== 'נעה לא') return 'the unticked match changed';
  if (p.revision() !== rev + 1) return 'more than one transaction';
  p.undo();
  return p.hash() === h ? true : 'undo does not give the exact hash back';
});
const textOf = (doc: ProjectDocument, id: string) => (clipOf(doc, id) as { text: string }).text;
const titleWith = (p: Proj, text: string, extra: object = {}) => lastOutput<{ clipId: string }>(p.commit([{ op: 'add_text', args: { text, start: f(75), duration: f(10), ...extra } }])).clipId;
const F2 = check(() => {
  const p = new Proj();
  const id = titleWith(p, 'אמר שָׁלוֹם לכולם');
  const only = { scope: 'clips' as const, clipIds: [id] };
  if (count(p.doc(), 'שלום', { ignoreMarks: false, ...only }) !== 0) return 'found with marks not ignored';
  if (count(p.doc(), 'שלום', only) !== 1) return 'not found with marks ignored';
  p.commit([{ op: 'replace_text', args: { edits: planReplace(p.doc(), q('שלום', { wholeWord: true, ...only }), 'היי').edits } }]);
  const t = textOf(p.doc(), id);
  const orphan = [...t].some((c, i, all) => new RegExp(`^${HEBREW_MARKS.source}$`).test(c) && (i === 0 || /\s/.test(all[i - 1]!)));
  return t === 'אמר היי לכולם' && !orphan ? true : fail('marks left behind', t);
});
const F3 = check(() => {
  const p = new Proj();
  titleWith(p, 'מלך');
  return count(p.doc(), 'מלכ', { wholeWord: false }) === 1 && count(p.doc(), 'מלכ', { wholeWord: false, finalsEqual: false }) === 0 ? true : 'final letters';
});
const F4 = check(() => {
  const p = new Proj();
  titleWith(p, 'ילדים הילד');
  return count(p.doc(), 'ילד') === 0 && count(p.doc(), 'ילד', { wholeWord: false }) === 2 ? true : 'whole word found inside another word';
});
const F5 = check(() => {
  const p = new Proj();
  const person = lastOutput<{ personId: string }>(p.commit([{ op: 'add_person', args: { name: 'נעה' } }])).personId;
  const id = titleWith(p, `name {name:${person}} name`, { fields: true });
  const m = findText(p.doc(), q('name', { wholeWord: true }));
  if (!same(m.find((x) => 'clipId' in x.at && x.at.clipId === id)?.ranges, [[0, 4], [`name {name:${person}} `.length, `name {name:${person}} name`.length]])) return fail('found inside the field', m);
  p.commit([{ op: 'replace_text', args: { edits: planReplace(p.doc(), q('name', { wholeWord: true }), 'שם').edits } }]);
  const parts = parseFields(textOf(p.doc(), id));
  return parts.some((x) => 'token' in x && x.token.name === 'name') && !parts.some((x) => 'bad' in x) ? true : fail('the field does not resolve', textOf(p.doc(), id));
});
const F6 = check(() => {
  const p = new Proj();
  const keep = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_cue', args: { start: f(0), duration: f(30), text: 'שלום נעה' } }])).clipId;
  const lose = lastOutput<{ clipId: string }>(p.commit([{ op: 'add_cue', args: { start: f(30), duration: f(30), text: 'היי נעה' } }])).clipId;
  // word timing typed in: the cues as a recognised caption would carry it
  const d = structuredClone(p.doc());
  for (const id of [keep, lose]) { const c = clipOf(d, id) as Extract<Clip, { type: 'caption' }>; c.words = c.text.split(' ').map((w, i) => ({ text: w, start: f(i * 15), duration: f(15) })); }
  for (const id of [keep, lose]) { const f2 = findClip(d, id)!; p.commit([{ op: 'restore_entities', args: { targets: [{ id, state: { kind: 'clip', sequenceId: f2.seq.id, trackId: f2.track.id, clip: f2.clip } }] } }], true); }
  const o = lastOutput<ReplaceTextOutput>(p.commit([{ op: 'replace_text', args: { edits: [{ at: { kind: 'cue', clipId: keep }, was: 'שלום נעה', text: 'שלום נועה' }, { at: { kind: 'cue', clipId: lose }, was: 'היי נעה', text: 'היי לך נועה' }] } }]));
  const k = clipOf(p.doc(), keep) as Extract<Clip, { type: 'caption' }>, l = clipOf(p.doc(), lose) as Extract<Clip, { type: 'caption' }>;
  return k.words?.length === 2 && k.words[1]!.text === 'נועה' && !l.words && same(o.lostWordTiming, [lose]) ? true : fail('word timing', { k: k.words, l: l.words, o });
});
const F9 = check(() => {
  const p = new Proj();
  const pl = planted(p);
  const d = structuredClone(p.doc());
  const v = d.variants[pl.variantId]!;
  v.language = 'en';
  v.translation = { from: 'he', to: 'en', engine: 'typed', model: 'none', createdAt: '2026-11-25T00:00:00Z', createdBy: 'proof', review: 'reviewed', reviewedBy: 'owner', reviewedAt: '2026-11-25T00:00:00Z', sources: {} };
  p.commit([{ op: 'restore_entities', args: { targets: [{ id: v.id, state: { kind: 'variant', variant: v } }] } }], true);
  const plan = planReplace(p.doc(), q('נעה', { wholeWord: true }), 'נועה');
  if (!same(plan.reviewAgain, [pl.variantId])) return fail('the reviewed format is not listed before the commit', plan.reviewAgain);
  p.commit([{ op: 'replace_text', args: { edits: plan.edits } }]);
  return p.doc().variants[pl.variantId]!.translation!.review === 'needed' ? true : 'the reworded translation did not return to needs-review';
});
const F11 = check(() => {
  if (!ASSISTANT_EXCLUDED_OPS.includes('replace_text' as never) || assistantOps().includes('replace_text')) return 'the assistant may propose replace_text';
  const r = checkModelAnswer({ toolInput: { ops: [{ op: 'replace_text', args: { edits: [{ at: { kind: 'title', clipId: 'clp_a' }, was: 'נעה', text: 'נועה' }] } }] }, text: null, finish: 'tool', usage: null, providerRequestId: null });
  return !r.ok && r.category === 'op_not_allowed' ? true : fail('a proposal holding replace_text was not refused', r);
});

export const CRAFT_PROOF_OPS: CraftProofPart = {
  built: true,
  checks: { R1, R2, R3, R4, R5, R6, R7, P1, P2, P3, P5, P6, P7, P8, F1, F2, F3, F4, F5, F6, F9, F11 },
};
