/**
 * Undo-all / redo-all (property, single actor) with the operations of templates and adjustment layers (ADR-0016):
 * add_adjustment, opacity, effects and masks on adjustments, replace_clip_media and apply_template (committed as the server
 * commits it, allowInternal, recording where it placed its clips), among the ordinary timing edits, ripple deletes included
 * (a new project closes the gap on Delete, which moves the later clips of a template). Every step's creative projection is restored exactly by undo
 * and by redo, and the log replays to the same document. PF_PROPERTY_RUNS sets the number of runs (default 60).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { creativeProjection, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const prov = { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' };
const video = (c: string, seconds: number) => ({ kind: 'video' as const, name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: seconds * 30 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };

describe('undo-all / redo-all with templates and adjustment layers (property, single actor)', () => {
  it('restores the exact creative projection at every step, including refused operations', () => {
    let mismatches = 0;
    const accepted: Record<string, number> = {};
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(14), fc.nat(200), fc.nat(200), fc.nat(40)), { minLength: 3, maxLength: 25 }), (steps) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-undotpl-'));
        dirs.push(dir);
        const s = new Store(dir);
        try {
          const pid = s.createProject({ name: 'p', width: 640, height: 360 }).doc.id;
          const assets = s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [video('a', 8), video('b', 4), still].map((asset) => ({ op: 'import_asset', args: { asset } })) }).results.map((r) => r.output!.assetId as string);
          const proj = () => creativeProjection(s.getProject(pid).doc);
          const states = [proj()];
          for (const [kind, a, b, pick] of steps) {
            const doc = s.getProject(pid).doc;
            const clips = Object.values(doc.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips));
            const clipId = clips.length ? clips[pick % clips.length]!.id : 'none';
            const adjusts = clips.filter((c) => c.type === 'adjustment');
            const adjId = adjusts.length ? adjusts[pick % adjusts.length]!.id : clipId;
            const template: OpCall = { op: 'apply_template', args: {
              templateId: 'tpl.prop', templateVersion: 1, params: {}, steps: ['p'], assets: [{ key: 'pic', asset: { ...still, contentHash: `sha256:${(b % 2 ? 'd' : 'e').repeat(64)}` } }],
              ops: [
                { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(a), duration: f(1 + (b % 60)) }, bind: 'shot' },
                { op: 'add_adjustment', args: { span: { start: f(a), duration: f(1 + (b % 60)) }, effects: [{ type: 'color.sepia' }] }, bind: 'look' },
                { op: 'set_keyframe', args: { clipId: { $ref: 'look' }, property: 'opacity', time: f(0), value: 0.5 } },
              ],
              slots: [{ key: 'shot', kind: 'picture', clipId: { $ref: 'shot' } }, { key: 'look', kind: 'look', clipId: { $ref: 'look' } }],
              ...(b % 3 ? { recordRanges: true } : {}),
            } };
            const op: OpCall = [
              { op: 'add_clip', args: { assetId: assets[0], start: f(a), sourceIn: f(b % 200), duration: f(1 + (pick % 39)) } },
              { op: 'add_text', args: { text: `שלום ${a}`, start: f(a), duration: f(1 + (b % 60)) } },
              { op: 'add_adjustment', args: { span: b % 2 ? 'edit' : { start: f(a), duration: f(1 + (b % 90)) }, effects: [{ type: pick % 2 ? 'color.grayscale' : 'blur.gaussian' }] } },
              { op: 'set_clip_transform', args: { clipId: adjId, transform: { opacity: (b % 100) / 100 } } },
              { op: 'add_effect', args: { clipId: adjId, type: pick % 3 ? 'light.vignette' : 'time.echo' } },
              { op: 'set_clip_mask', args: { clipId: adjId, mask: b % 4 ? { shape: 'ellipse', width: 0.5, invert: b % 3 === 0 } : null } },
              { op: 'replace_clip_media', args: { clipId, assetId: assets[pick % 3]!, ...(b % 3 === 0 ? { linked: 'detach' } : {}) } },
              { op: 'move_clip', args: { clipId, start: f(a) } },
              { op: 'trim_clip', args: { clipId, edge: b % 2 ? 'start' : 'end', to: f(a) } },
              { op: 'split_clip', args: { clipId, at: f(a) } },
              { op: 'delete_clip', args: { clipId } },
              template,
              { op: 'set_keyframe', args: { clipId: adjId, property: pick % 5 ? 'opacity' : 'scale', time: f(b % 30), value: (a % 100) / 100 } },
              { op: 'cut_range', args: { start: f(a), end: f(a + 1 + (b % 30)) } },
              { op: 'ripple_delete_clips', args: { clipIds: [clipId] } },
            ][kind]!;
            try {
              if (s.commit({ projectId: pid, actor: 'u', ops: [op], ...(op.op === 'apply_template' ? { allowInternal: true } : {}) }).committed) { states.push(proj()); accepted[op.op] = (accepted[op.op] ?? 0) + 1; }
            } catch (e) {
              if (!(e instanceof ApiError)) throw e;
              if (proj() !== states.at(-1)) throw new Error('rejected op changed state');
            }
          }
          for (let i = states.length - 2; i >= 0; i--) { s.undo(pid, 'u', 'undo'); if (proj() !== states[i]) { mismatches++; throw new Error(`undo to state ${i} differs`); } }
          for (let i = 1; i < states.length; i++) { s.undo(pid, 'u', 'redo'); if (proj() !== states[i]) { mismatches++; throw new Error(`redo to state ${i} differs`); } }
          const ok = JSON.stringify(s.replay(pid).doc) === JSON.stringify(s.getProject(pid).doc);
          if (!ok) mismatches++;
          return ok;
        } finally { s.close(); }
      }),
      // seeded so the coverage line below is the same on every run (set PF_PROPERTY_SEED to explore other seeds)
      { numRuns: Number(process.env.PF_PROPERTY_RUNS ?? 60), seed: Number(process.env.PF_PROPERTY_SEED ?? 20261119) },
    );
    console.log(`undo-all/redo-all with templates and adjustment layers: ${Number(process.env.PF_PROPERTY_RUNS ?? 60)} runs, ${mismatches} mismatches; accepted: ${Object.entries(accepted).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
    for (const op of ['add_adjustment', 'replace_clip_media', 'apply_template', 'set_clip_mask', 'ripple_delete_clips']) if (!accepted[op]) throw new Error(`${op} was never accepted`);
  }, 600_000);
});
