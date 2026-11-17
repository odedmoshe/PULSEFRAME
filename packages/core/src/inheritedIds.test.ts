/**
 * Library files, sequences, analyses and variants are plain objects keyed by id. An id equal to a name every object
 * answers to through its prototype (`__proto__`, `constructor`, `toString`, …) must be refused like any unknown id:
 * never found, never written. Before the guard in applyTransaction, `rename_asset` with the id `__proto__` wrote a
 * `name` onto Object.prototype, so every object in the process then had a name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, listOps, OpError, refuseInheritedIds, type OpCall, type ProjectDocument } from './index.ts';

const INHERITED = Object.getOwnPropertyNames(Object.prototype);
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `i${n++}_`, actor: 'test', allowInternal: true });
const prototypeKeys = () => Object.getOwnPropertyNames(Object.prototype).sort().join(',');
const before = prototypeKeys();
afterEach(() => {
  // whatever happened, nothing was added to Object.prototype
  expect(prototypeKeys()).toBe(before);
  expect(({} as Record<string, unknown>).name).toBeUndefined();
});

function project() {
  let doc = createProject({ id: 'prj_i', name: 'I' });
  // a sound file: the simplest asset that a clip, an analysis and a speed change all accept
  const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' } };
  const img = tx(doc, [{ op: 'import_asset', args: { asset: song } }]);
  doc = img.doc;
  const assetId = img.results[0]!.output!.assetId as string;
  const clip = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(30) } }]);
  return { doc: clip.doc, assetId, clipId: clip.results[0]!.output!.clipId as string };
}

describe('ids that are names of Object.prototype members', () => {
  it('reported: rename_asset with the id "__proto__" is refused as not found and writes nothing anywhere', () => {
    const { doc } = project();
    for (const id of INHERITED) {
      let err: unknown;
      try { tx(doc, [{ op: 'rename_asset', args: { assetId: id, name: 'polluted' } }]); } catch (e) { err = e; }
      expect(err, id).toBeInstanceOf(OpError);
      expect((err as OpError).code, id).toBe('not_found');
    }
  });

  it('every op that takes an id refuses each such name with an operation error, never a crash, and the document keeps its shape', () => {
    const { doc, assetId, clipId } = project();
    const known: Record<string, (id: string) => Record<string, unknown>> = {
      rename_asset: (id) => ({ assetId: id, name: 'x' }),
      remove_asset: (id) => ({ assetId: id }),
      add_clip: (id) => ({ assetId: id, start: f(0) }),
      delete_clip: (id) => ({ clipId: id }),
      add_effect: (id) => ({ clipId: id, type: 'color.invert' }),
      attach_analysis: (id) => ({ assetId: id, kind: 'beats', method: 'test', params: {}, createdAt: '2026-01-01T00:00:00Z', times: [f(0), f(15)] }),
      update_variant: (id) => ({ variantId: id, name: 'x' }),
      // life line (ADR-0021): events are a plain object keyed by id too; the guard refuses these names before any body runs
      set_asset_capture: (id) => ({ assetId: id, capture: null }),
      shift_asset_captures: (id) => ({ assetIds: [id], minutes: 60 }),
      add_event: (id) => ({ assetIds: [id] }),
      update_event: (id) => ({ eventId: id, name: 'x' }),
      remove_event: (id) => ({ eventId: id }),
      set_text_fields: (id) => ({ clipId: id, enabled: true }),
    };
    let reached = 0;
    for (const def of listOps()) {
      const shape = (def.args as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      const idKeys = Object.keys(shape).filter((k) => k === 'id' || /Ids?$/.test(k));
      if (!idKeys.length) continue;
      for (const id of INHERITED) {
        const args = known[def.name]?.(id) ?? Object.fromEntries(idKeys.map((k) => [k, k.endsWith('Ids') ? [id] : id]));
        let err: unknown;
        try { tx(doc, [{ op: def.name, args }]); } catch (e) { err = e; }
        expect(err, `${def.name} ${id}`).toBeInstanceOf(OpError);
        if (known[def.name]) { reached++; expect((err as OpError).code, `${def.name} ${id}`).toBe('not_found'); }
      }
    }
    expect(reached).toBe(Object.keys(known).length * INHERITED.length);
    for (const c of [doc.assets, doc.sequences, doc.analyses ?? {}, doc.variants ?? {}, doc.events ?? {}]) expect(Object.getPrototypeOf(c)).toBe(Object.prototype);
    expect(Object.keys(doc.assets)).toEqual([assetId]);
  });

  it('an inherited name inside effect parameters (a colour table id) is refused too; the same words as text are not ids and are kept', () => {
    const { doc } = project();
    const titled0 = tx(doc, [{ op: 'add_text', args: { text: 'T', start: f(0), duration: f(30) } }]);
    const titleId = titled0.results[0]!.output!.clipId as string;
    for (const id of INHERITED) {
      expect(() => tx(titled0.doc, [{ op: 'add_effect', args: { clipId: titleId, type: 'color.lut', params: { lut: id } } }]), id).toThrow(OpError);
      expect(() => tx(titled0.doc, [{ op: 'apply_lut', args: { clipId: titleId, assetId: id } }]), id).toThrow(OpError);
    }
    const titled = tx(doc, [{ op: 'add_text', args: { text: 'constructor', start: f(0), duration: f(30) } }]);
    expect(titled.results[0]!.output!.clipId).toBeTruthy();
    expect(() => refuseInheritedIds({ text: 'toString', name: '__proto__', style: { font: 'constructor' } }, 'x')).not.toThrow();
    expect(() => refuseInheritedIds({ clipIds: ['clp_1', 'valueOf'] }, 'x')).toThrow(OpError);
    expect(() => refuseInheritedIds({ items: [{ id: 'hasOwnProperty' }] }, 'x')).toThrow(OpError);
  });
});
