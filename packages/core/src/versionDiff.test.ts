/**
 * Versions in core (wave 7 craft, W2; versionDiff.ts): the privacy digest moves with exactly the privacy facts (regions, the
 * samples a region follows, the people's ids) and nothing else; composeRestore takes the edit from the version and keeps the
 * library as now (re-adding only what a restored clip needs, never a person); describeDiff counts and names what changed and
 * marks what restore applies; restoring through restore_entities gives the version's edit back and undoes exactly.
 * Fixtures typed here (no media).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, composeRestore, createProject, creativeProjection, describeDiff, diffEntities, DIFF_ROW_LIMIT, entityMap, findClip,
  privacyDigest, restoreEntities, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `vd${seed++}_`, actor: 'test', allowInternal: true });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (n: string, h: string) => ({ kind: 'video' as const, name: n, contentHash: `sha256:${h.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov });
const out = (r: ReturnType<typeof tx>) => r.results[r.results.length - 1]!.output as any;
const EDIT_KINDS = new Set(['project', 'sequence', 'track', 'trackOrder', 'clip', 'marker', 'variant', 'recipeRun']);
/** The edit entities of a document (without the project's name), canonical. */
const editOf = (doc: ProjectDocument) => canonical([...entityMap(doc)].filter(([, s]) => EDIT_KINDS.has(s.kind)).map(([id, s]) => [id, s.kind === 'project' ? { settings: s.settings } : s]).sort(([a], [b]) => (a! < b! ? -1 : 1)));
/** What the store commits for a restore: restore_entities of the changes from current to the composed target. */
const restore = (current: ProjectDocument, version: ProjectDocument) => {
  const target = composeRestore(current, version);
  const changes = diffEntities(current, target);
  return { target, changes, doc: tx(current, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.after })) } }]).doc };
};

/** A film: two shots of «ים.mp4» on V1, a title «שלום נעה», a marker; a person «נועה» with a birth date. */
function film() {
  let doc = createProject({ id: 'prj_vd', name: 'Versions', width: 640, height: 360, frameRate: R });
  doc = tx(doc, [{ op: 'import_asset', args: { asset: video('ים.mp4', '1') } }, { op: 'import_asset', args: { asset: video('חוף.mp4', '2') } }]).doc;
  const [sea, beach] = Object.keys(doc.assets) as [string, string];
  let r = tx(doc, [{ op: 'add_clip', args: { assetId: sea, start: f(0), sourceIn: f(0), duration: f(30) } }]); doc = r.doc;
  const a = out(r).clipId as string;
  const track = findClip(doc, a)!.track.id;
  r = tx(doc, [{ op: 'add_clip', args: { assetId: sea, trackId: track, start: f(30), sourceIn: f(40), duration: f(30) } }]); doc = r.doc;
  const b = out(r).clipId as string;
  r = tx(doc, [{ op: 'add_text', args: { text: 'שלום נעה', start: f(10), duration: f(30) } }]); doc = r.doc;
  const title = out(r).clipId as string;
  doc = tx(doc, [{ op: 'add_marker', args: { time: f(20), label: 'כאן' } }, { op: 'add_person', args: { name: 'נועה', birthDate: '2016-11-04', form: 'f' } }]).doc;
  return { doc, sea, beach, a, b, title, track };
}
const region = { shape: 'rect', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0, feather: 0, style: 'blur', strength: 1, color: '#000000', onLoss: 'frame', motionTrackId: null };

describe('privacyDigest', () => {
  it('changes when a region is added, changed or removed, and when a person is added or removed; not for other edits', () => {
    const { doc, a, title } = film();
    const d0 = privacyDigest(doc);
    expect(d0).toMatch(/^[0-9a-f]{64}$/);
    expect(privacyDigest(structuredClone(doc))).toBe(d0);
    // other edits leave it alone: a trim, a reworded title, the person's birth date (names and dates are not what it guards)
    const edited = tx(doc, [{ op: 'trim_clip', args: { clipId: a, edge: 'end', to: f(20) } }, { op: 'update_text', args: { clipId: title, text: 'שלום' } }]).doc;
    expect(privacyDigest(edited)).toBe(d0);
    const pid = Object.keys(doc.people!)[0]!;
    expect(privacyDigest(tx(doc, [{ op: 'update_person', args: { personId: pid, birthDate: '2015-01-01' } }]).doc)).toBe(d0);
    // a region added, changed, removed
    const withRegion = tx(doc, [{ op: 'set_redact_region', args: { clipId: a, region } }]).doc;
    const d1 = privacyDigest(withRegion);
    expect(d1).not.toBe(d0);
    const regionId = (findClip(withRegion, a)!.clip as any).redact[0].id as string;
    expect(privacyDigest(tx(withRegion, [{ op: 'set_redact_region', args: { clipId: a, regionId, region: { x: 0.3 } } }]).doc)).not.toBe(d1);
    expect(privacyDigest(tx(withRegion, [{ op: 'set_redact_region', args: { clipId: a, regionId, region: null } }]).doc)).toBe(d0);
    // a person removed or added
    expect(privacyDigest(tx(doc, [{ op: 'remove_person', args: { personId: pid } }]).doc)).not.toBe(d0);
    expect(privacyDigest(tx(doc, [{ op: 'add_person', args: { name: 'דן' } }]).doc)).not.toBe(d0);
  });
});

describe('composeRestore', () => {
  it('the edit comes from the version, the library stays as now; restore_entities gives exactly that and undoes exactly', () => {
    const { doc: version, a, b, title, beach } = film();
    let now = tx(version, [{ op: 'trim_clip', args: { clipId: a, edge: 'end', to: f(18) } }, { op: 'delete_clip', args: { clipId: b } }, { op: 'update_text', args: { clipId: title, text: 'שלום נועה' } }]).doc;
    now = { ...now, name: 'שם חדש' }; // as a rename would leave it
    now = tx(now, [{ op: 'remove_asset', args: { assetId: beach } }, { op: 'import_asset', args: { asset: video('חדש.mp4', '3') } }]).doc;
    const r = restore(now, version);
    expect(editOf(r.doc)).toBe(editOf(version));
    expect(r.doc.name).toBe('שם חדש'); // the name is not restored
    expect(Object.keys(r.doc.assets).sort()).toEqual(Object.keys(now.assets).sort()); // a file imported later stays; one removed and not used is not brought back
    expect(r.doc.people).toEqual(now.people);
    // undo: the changes' before-states restored on the result
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(now, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(now));
  });
  it('a file a restored clip needs that was removed since comes back (with its transcript); a removed person never does', () => {
    const { doc, sea, a, b } = film();
    const pid = Object.keys(doc.people!)[0]!;
    const version = { ...doc, transcripts: { [sea]: { assetId: sea, language: 'he', segments: [], origin: { kind: 'fixture' } } as any } };
    let now = tx(doc, [{ op: 'delete_clip', args: { clipId: a } }, { op: 'delete_clip', args: { clipId: b } }]).doc;
    now = tx(now, [{ op: 'remove_asset', args: { assetId: sea } }, { op: 'remove_person', args: { personId: pid } }]).doc;
    expect(now.assets[sea]).toBeUndefined();
    const target = composeRestore(now, version);
    expect(target.assets[sea]).toEqual(doc.assets[sea]);
    expect(target.transcripts[sea]).toEqual(version.transcripts[sea]);
    expect(target.people ?? {}).toEqual(now.people ?? {});
    expect(findClip(target, a)).toBeTruthy();
  });
});

describe('describeDiff', () => {
  it('counts and names a clip shortened, one deleted, a title reworded, an effect added; library rows do not restore', () => {
    const { doc: version, a, b, title } = film();
    let now = tx(version, [{ op: 'trim_clip', args: { clipId: a, edge: 'end', to: f(18) } }, { op: 'delete_clip', args: { clipId: b } }, { op: 'update_text', args: { clipId: title, text: 'שלום נועה' } }]).doc;
    now = tx(now, [{ op: 'add_effect', args: { clipId: title, type: 'blur.gaussian' } }]).doc;
    now = tx(now, [{ op: 'import_asset', args: { asset: video('חדש.mp4', '3') } }]).doc;
    const d = describeDiff(version, now);
    const rows = d.rows.map((r) => `${r.entity}:${r.change}:${r.name}:${r.restores}`);
    expect(rows).toEqual(['clip:changed:ים.mp4:true', 'clip:removed:ים.mp4:true', 'clip:changed:שלום נועה:true', 'asset:added:חדש.mp4:false']);
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 2 });
    expect(d.more).toBe(0);
    expect(d.privacy).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(describeDiff(version, version)).toEqual({ counts: { added: 0, removed: 0, changed: 0 }, rows: [], more: 0, privacy: { added: 0, removed: 0, changed: 0 } });
  });
  it('privacy: restoring a version from before a region was added would remove it; one changed since counts as changed', () => {
    const { doc: version, a } = film();
    const now = tx(version, [{ op: 'set_redact_region', args: { clipId: a, region } }]).doc;
    expect(describeDiff(version, now).privacy).toEqual({ added: 0, removed: 1, changed: 0 });
    const regionId = (findClip(now, a)!.clip as any).redact[0].id as string;
    const later = tx(now, [{ op: 'set_redact_region', args: { clipId: a, regionId, region: { width: 0.5 } } }]).doc;
    expect(describeDiff(now, later).privacy).toEqual({ added: 0, removed: 0, changed: 1 });
    expect(describeDiff(later, version).privacy).toEqual({ added: 1, removed: 0, changed: 0 });
  });
  it(`lists at most ${DIFF_ROW_LIMIT} rows and counts the rest`, () => {
    const { doc: version } = film();
    const now = tx(version, Array.from({ length: 520 }, (_, i) => ({ op: 'add_marker', args: { time: f(100 + i), label: `m${i}` } }))).doc;
    const d = describeDiff(version, now);
    expect(d.rows.length).toBe(DIFF_ROW_LIMIT);
    expect(d.more).toBe(20);
    expect(d.counts.added).toBe(520);
  });
});
