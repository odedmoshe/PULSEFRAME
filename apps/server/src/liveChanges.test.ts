/**
 * The editor follows the server from the revision events' changes (apps/web/src/editor/sync.ts) instead of reading the whole
 * document on every event. Its document must be the server's, byte for byte: after EVERY event of a long fuzzed edit sequence
 * (many operation kinds, several operations per transaction, undo and redo, failed edits, a missed event and an event replayed
 * without changes), the hash of the editor's document equals the hash of GET /projects/:id's document (Store.getProject,
 * serialised as the route serialises it). Events reach the editor as the event stream sends them to the owner's session
 * (revisionWithChanges, the same function http.ts calls), through JSON.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import type { OpCall, ProjectDocument } from '@pulseframe/core';
import { ApiError, revisionWithChanges, Store, type RevisionEvent } from './store.ts';
import { applyLiveChanges, EditorDocSync, MAX_LIVE_CHANGES } from '../../web/src/editor/sync.ts';

const dirs: string[] = [];
const open = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-live-')); dirs.push(d); return new Store(d); };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const sha = (doc: unknown) => createHash('sha256').update(JSON.stringify(doc)).digest('hex');
/** What GET /projects/:id answers the owner: the store's document through JSON (c.json). */
const served = (s: Store, pid: string) => { const p = s.getProject(pid); return JSON.parse(JSON.stringify({ project: p.doc, revision: p.revision })) as { project: ProjectDocument; revision: number }; };
const asset = (c: string) => ({ kind: 'video' as const, name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' } });

type Step = [kind: number, a: number, b: number, pick: number, n: number];
/** One operation chosen from the step and the current document (ids picked from what exists; some are refused, which is fine). */
function opFor(doc: ProjectDocument, assetIds: string[], [kind, a, b, pick, n]: Step): OpCall {
  const seqs = Object.values(doc.sequences);
  const seq = seqs[pick % seqs.length]!;
  const clips = seqs.flatMap((q) => q.tracks.flatMap((t) => t.clips));
  const clip = clips.length ? clips[pick % clips.length]! : null;
  const clipId = clip?.id ?? 'none';
  const tracks = seq.tracks;
  const trackId = tracks.length ? tracks[pick % tracks.length]!.id : 'none';
  const markers = Object.keys(doc.markers ?? {}), variants = Object.keys(doc.variants ?? {}), people = Object.keys(doc.people ?? {});
  const prop = (['x', 'y', 'scale', 'opacity', 'rotation'] as const)[b % 5]!;
  const keys = (count: number) => Array.from({ length: count }, (_, k) => ({ time: f(k * (1 + (b % 3))), value: Number((((k * 37 + a) % 200) / 1000 - 0.1).toFixed(4)), easing: (['smooth', 'overshoot', 'linear', 'ease-in'] as const)[(k + n) % 4]! }));
  const ops: (() => OpCall)[] = [
    () => ({ op: 'add_clip', args: { assetId: assetIds[n % assetIds.length]!, start: f(a), sourceIn: f(b % 300), duration: f(1 + (n % 90)), ...(n % 3 === 0 ? { withLinkedAudio: false } : {}) } }),
    () => ({ op: 'add_text', args: { text: `שלום ${a}`, start: f(a), duration: f(1 + (b % 60)), ...(n % 2 ? { sequenceId: seq.id } : {}) } }),
    () => ({ op: 'move_clip', args: { clipId, start: f(a) } }),
    () => ({ op: 'trim_clip', args: { clipId, edge: b % 2 ? 'start' : 'end', to: f(a) } }),
    () => ({ op: 'split_clip', args: { clipId, at: f(a) } }),
    () => ({ op: 'delete_clip', args: { clipId } }),
    () => ({ op: 'set_clip_transform', args: { clipId, transform: { x: (a - 100) / 400, scale: 1 + b / 400 } } }),
    () => ({ op: 'set_keyframe', args: { clipId, property: prop, time: f(a % 40), value: prop === 'scale' ? 1 + b / 300 : prop === 'opacity' ? (b % 100) / 100 : prop === 'rotation' ? b - 100 : (b - 100) / 1000, easing: (['linear', 'smooth', 'overshoot'] as const)[n % 3]! } }),
    () => ({ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: keys(n % 25) } }),
    () => ({ op: 'clear_keyframes', args: { clipId } }),
    () => ({ op: 'update_text', args: { clipId, text: `טקסט ${n}` } }),
    () => ({ op: 'ripple_delete_clips', args: { clipIds: [clipId], includeLinked: n % 2 === 0 } }),
    () => ({ op: 'duplicate_clips', args: { clipIds: [clipId], at: f(a) } }),
    () => ({ op: 'move_clips', args: { clipIds: clips.slice(0, 1 + (n % 3)).map((c) => c.id), delta: f((a % 40) - 20), includeLinked: n % 2 === 0 } }),
    () => ({ op: 'add_track', args: { kind: (['video', 'audio', 'text'] as const)[n % 3]!, sequenceId: seq.id, name: `t${a}` } }),
    () => ({ op: 'update_track', args: { sequenceId: seq.id, trackId, name: `n${a}`, muted: n % 2 === 0 } }),
    () => ({ op: 'move_track', args: { sequenceId: seq.id, trackId, toIndex: n % Math.max(1, tracks.length) } }),
    () => ({ op: 'remove_track', args: { sequenceId: seq.id, trackId } }),
    () => ({ op: 'add_marker', args: { time: f(a), label: `m${b}` } }),
    () => ({ op: 'update_marker', args: { markerId: markers[pick % Math.max(1, markers.length)] ?? 'none', label: `M${a}`, time: f(b) } }),
    () => ({ op: 'remove_marker', args: { markerId: markers[pick % Math.max(1, markers.length)] ?? 'none' } }),
    () => ({ op: 'add_variant', args: { name: `v${a}`, width: 360 + (b % 4) * 8, height: 640, fit: n % 2 ? 'cover' : 'contain' } }),
    () => ({ op: 'update_variant', args: { variantId: variants[pick % Math.max(1, variants.length)] ?? 'none', name: `V${a}` } }),
    () => ({ op: 'remove_variant', args: { variantId: variants[pick % Math.max(1, variants.length)] ?? 'none' } }),
    () => ({ op: 'rename_project', args: { name: `פרויקט ${a}` } }),
    () => ({ op: 'set_project_format', args: { background: `#${(a * 9973 + b).toString(16).padStart(6, '0').slice(-6)}` } }),
    () => ({ op: 'set_timeline_behaviour', args: { mainMagnet: a % 2 === 0, rippleDelete: b % 2 === 0 } }),
    () => ({ op: 'add_sequence', args: { name: `קצר ${a}` } }),
    () => ({ op: 'remove_sequence', args: { sequenceId: seq.id, withContents: n % 2 === 0 } }),
    () => ({ op: 'add_person', args: { name: `אדם ${a}`, ...(n % 2 ? { birthDate: '2014-11-04', form: 'f' } : {}) } }),
    () => ({ op: 'remove_person', args: { personId: people[pick % Math.max(1, people.length)] ?? 'none' } }),
    () => ({ op: 'insert_gap', args: { at: f(a), duration: f(1 + (b % 30)) } }),
    () => ({ op: 'close_gaps', args: {} }),
    () => ({ op: 'unlink_clip', args: { clipId } }),
    () => ({ op: 'set_clip_fades', args: { clipId, fadeIn: f(b % 10), fadeOut: f(n % 10) } }),
    () => ({ op: 'delete_keyframe', args: { clipId, property: prop, time: f(a % 40) } }),
  ];
  return ops[kind % ops.length]!();
}
const KINDS = 36 + 3; // the operations above, then: a transaction of several, undo, redo

describe('the editor follows the server from the revision events\' changes', () => {
  it('a fuzzed edit sequence: after every event the editor\'s document hashes as the server\'s', async () => {
    let applied = 0, reads = 0, events = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.nat(KINDS - 1), fc.nat(400), fc.nat(400), fc.nat(60), fc.nat(60)), { minLength: 120, maxLength: 220 }), fc.nat(1000), async (steps, salt) => {
        const s = open();
        const pid = s.createProject({ name: 'p' }).doc.id;
        const assetIds = ['a', 'b'].map((c) => s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: asset(c) } }] }).results[0]!.output!.assetId as string);
        const sync = new EditorDocSync(async () => served(s, pid));
        const start = served(s, pid);
        sync.reset(start.project, start.revision);
        // the owner's event stream: each live event as http.ts sends it, through JSON
        const wire: string[] = [];
        s.events.on('revision', (e: RevisionEvent) => { const ch = s.liveChanges(e); wire.push(ch ? revisionWithChanges(e, ch) : JSON.stringify(e)); });
        let i = 0;
        for (const step of steps) {
          i++;
          const doc = s.getProject(pid).doc;
          const kind = step[0];
          const actor = step[3] % 4 === 0 ? 'agent:b' : 'user:a';
          try {
            if (kind === KINDS - 2) s.undo(pid, actor, 'undo');
            else if (kind === KINDS - 1) s.undo(pid, actor, 'redo');
            else if (kind === KINDS - 3) s.commit({ projectId: pid, actor, ops: [0, 1, 2].slice(0, 2 + (step[4] % 2)).map((k) => opFor(doc, assetIds, [(step[1] + k * 7) % (KINDS - 3), (step[2] + k * 31) % 400, (step[1] + k * 13) % 400, step[3] + k, step[4] + k])) });
            else s.commit({ projectId: pid, actor, ops: [opFor(doc, assetIds, step)] });
          } catch (e) {
            if (!(e instanceof ApiError)) throw e; // refused edits commit nothing and send no event
          }
          for (const json of wire.splice(0)) {
            events++;
            const e = JSON.parse(json);
            // now and then the stream misses an event (the next one has a gap) or replays one without changes (a reconnect)
            if ((i + salt) % 29 === 0) continue;
            if ((i + salt) % 31 === 0) delete e.changes;
            await sync.onEvent(e);
          }
          const server = served(s, pid);
          if (sync.revision < server.revision) await sync.onEvent({ revision: server.revision }); // the editor reads once it sees the gap
          if (sync.revision !== server.revision || sha(sync.doc) !== sha(server.project)) {
            s.close();
            throw new Error(`step ${i} (${JSON.stringify(step)}): editor at ${sync.revision} ${sha(sync.doc).slice(0, 12)}, server at ${server.revision} ${sha(server.project).slice(0, 12)}\n${JSON.stringify(sync.doc).slice(0, 400)}\n${JSON.stringify(server.project).slice(0, 400)}`);
          }
        }
        applied += sync.applied; reads += sync.reads;
        s.close();
        return true;
      }),
      { numRuns: Number(process.env.PF_PROPERTY_RUNS ?? 8) },
    );
    console.log(`live changes: ${events} events, ${applied} applied from their changes, ${reads} whole-document reads`);
    // the sequence exercised the applied path, not only the whole-document reads
    expect(events).toBeGreaterThan(200);
    expect(applied).toBeGreaterThan(reads * 3);
  }, 300_000);

  it('applies nothing it cannot apply exactly: too many changes, clips that share a start, a state that does not fit', () => {
    const s = open();
    const pid = s.createProject({ name: 'p' }).doc.id;
    const doc = served(s, pid).project;
    const many = Array.from({ length: MAX_LIVE_CHANGES + 1 }, (_, k) => ({ id: `mrk_${k}`, after: { kind: 'marker' as const, marker: { id: `mrk_${k}`, time: f(k), label: '' } as any } }));
    expect(applyLiveChanges(doc, many)).toBeNull();
    const t = doc.sequences[doc.mainSequenceId]!.tracks.find((x) => x.kind === 'text')!;
    const text = (id: string) => ({ id, after: { kind: 'clip' as const, sequenceId: doc.mainSequenceId, trackId: t.id, clip: { id, type: 'text', start: f(0), duration: f(10), text: 'x' } as any } });
    expect(applyLiveChanges(doc, [text('clp_a'), text('clp_b')])).toBeNull();
    expect(applyLiveChanges(doc, [{ id: 'clp_z', after: { kind: 'clip', sequenceId: 'seq_none', trackId: 'trk_none', clip: { id: 'clp_z' } as any } }])).toBeNull();
    expect(applyLiveChanges(doc, [])).toBeNull();
  });
});
