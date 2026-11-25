/**
 * Named versions on the server (wave 7 craft, W2; craft/versions.ts), against a real Store and Governance (no HTTP; the routes
 * are routes.test.ts): the access rule, the copy saved in the same transaction (V1), the limits and the storage ceiling (V11),
 * the list's flags, rename and delete for the owner only, restore as one undoable transaction with every refusal (V4), a file
 * removed and cleaned up since comes back with its bytes (V5), deleting the project leaves no row (V7). Fixtures are typed here;
 * the one blob is a few synthetic bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { canonical, CRAFT_LIMITS, entityMap, findClip, privacyDigest, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { Governance, type Principal } from '../governance.ts';
import { collectGarbage, deleteProject } from '../storage.ts';
import { ApiError, Store } from '../store.ts';
import { CRAFT_SERVER_BUILT, CRAFT_SERVER_REFUSALS, VERSIONS_TABLE } from './contract.ts';
import { deleteVersion, diffVersions, listVersions, mayReadVersionContent, renameVersion, restoreVersion, saveVersion, versionDoc } from './versions.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const AGENT: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
const OBSERVER: Principal = { actor: 'agent:observer', kind: 'agent', scopes: ['observe'] };
const HEX = 'ab'.repeat(32);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const VIDEO = (name: string, hex: string) => ({ kind: 'video' as const, name, contentHash: `sha256:${hex}`, byteSize: 4, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov });
const region = { shape: 'rect', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0, feather: 0, style: 'blur', strength: 1, color: '#000000', onLoss: 'frame', motionTrackId: null };

let dir: string, store: Store, gov: Governance, pid: string;
const commit = (ops: OpCall[], actor = 'user:local') => store.commit({ projectId: pid, actor, ops, allowInternal: true });
const out = (r: ReturnType<typeof commit>) => r.results[r.results.length - 1]!.output as any;
const whole = () => store.wholeProject(pid);
const refusal = (fn: () => unknown): ApiError => { try { fn(); } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('not refused'); };
/** The edit entities (settings, sequences, tracks, clips, markers, formats, recipe runs), canonical. */
const EDIT = new Set(['sequence', 'track', 'trackOrder', 'clip', 'marker', 'variant', 'recipeRun']);
const editOf = (doc: ProjectDocument) => canonical([doc.settings, [...entityMap(doc)].filter(([, s]) => EDIT.has(s.kind)).sort(([a], [b]) => (a < b ? -1 : 1))]);

let a = '', b = '', title = '', sea = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-versions-'));
  store = new Store(dir);
  gov = new Governance(store);
  pid = store.createProject({ name: 'גרסאות', width: 640, height: 360, frameRate: R }).doc.id;
  commit([{ op: 'import_asset', args: { asset: VIDEO('ים.mp4', HEX) } }]);
  sea = Object.keys(whole().doc.assets)[0]!;
  let r = commit([{ op: 'add_clip', args: { assetId: sea, start: f(0), sourceIn: f(0), duration: f(30) } }]); a = out(r).clipId;
  const track = findClip(whole().doc, a)!.track.id;
  r = commit([{ op: 'add_clip', args: { assetId: sea, trackId: track, start: f(30), sourceIn: f(40), duration: f(30) } }]); b = out(r).clipId;
  r = commit([{ op: 'add_text', args: { text: 'שלום נעה', start: f(10), duration: f(30) } }]); title = out(r).clipId;
  commit([{ op: 'add_person', args: { name: 'נועה', birthDate: '2016-11-04', form: 'f' } }]);
});
afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('the access rule of a version\'s content (mayReadVersionContent)', () => {
  it('the owner\'s own session always; any other credential only while the privacy digest is unchanged', () => {
    expect(CRAFT_SERVER_BUILT).toBe(true);
    for (const p of [OWNER, AGENT, OBSERVER]) expect({ p: p.actor, same: mayReadVersionContent(p, 'd1', 'd1') }).toEqual({ p: p.actor, same: true });
    expect(mayReadVersionContent(OWNER, 'd0', 'd1')).toBe(true);
    for (const p of [AGENT, OBSERVER, { ...AGENT, actor: 'user:local' } as Principal, { ...OWNER, actor: 'user:other' } as Principal])
      expect({ p: `${p.kind} ${p.actor}`, changed: mayReadVersionContent(p, 'd0', 'd1') }).toEqual({ p: `${p.kind} ${p.actor}`, changed: false });
  });
  it('applied: after a region is added, an agent is refused the diff, the copy and restore of an earlier version; the owner is not', () => {
    const v = saveVersion(store, gov, OWNER, pid, 'לפני הטשטוש');
    commit([{ op: 'set_redact_region', args: { clipId: a, region } }]);
    expect(listVersions(store, AGENT, pid)[0]!.privacyChanged).toBe(true);
    for (const fn of [() => diffVersions(store, AGENT, pid, v.id, 'current'), () => versionDoc(store, OBSERVER, pid, v.id), () => restoreVersion(store, gov, AGENT, pid, v.id, { confirmPrivacy: true })]) {
      const e = refusal(fn);
      expect([e.status, e.code, e.message]).toEqual([403, 'version_privacy_changed', CRAFT_SERVER_REFUSALS.privacyChanged.message()]);
    }
    expect(diffVersions(store, OWNER, pid, v.id, 'current').privacy).toEqual({ added: 0, removed: 1, changed: 0 }); // what restoring it would do
    // a person removed since: the same rule
    const v2 = saveVersion(store, gov, OWNER, pid, 'עם הטשטוש');
    commit([{ op: 'remove_person', args: { personId: Object.keys(whole().doc.people!)[0]! } }]);
    expect(refusal(() => diffVersions(store, AGENT, pid, v2.id, 'current')).code).toBe('version_privacy_changed');
    expect(versionDoc(store, OWNER, pid, v2.id).people).toBeTruthy();
  });
});

describe('save', () => {
  it('V1: the copy is the stored document of that revision (= replay(revision) = current), with its digest, size and frames', () => {
    const before = whole();
    const v = saveVersion(store, gov, OWNER, pid, 'לפני הקיצור');
    const row = store.db.prepare(`SELECT * FROM ${VERSIONS_TABLE} WHERE id = ?`).get(v.id) as any;
    const stored = store.db.prepare('SELECT doc FROM projects WHERE id = ?').get(pid) as { doc: string };
    expect(row.doc).toBe(stored.doc);
    expect(canonical(JSON.parse(row.doc))).toBe(canonical(before.doc));
    expect(canonical(JSON.parse(row.doc))).toBe(canonical(store.replay(pid, before.revision).doc));
    const tx = store.db.prepare('SELECT id FROM transactions WHERE project_id = ? AND revision = ?').get(pid, before.revision) as { id: string };
    expect([row.revision, row.transaction_id, row.privacy_digest, row.bytes, row.frames, row.actor]).toEqual([before.revision, tx.id, privacyDigest(before.doc), Buffer.byteLength(stored.doc), 60, 'user:local']);
    expect(v).toMatchObject({ name: 'לפני הקיצור', revision: before.revision, frames: 60, sameAsCurrent: true, privacyChanged: false });
    expect(Object.keys(v).sort()).toEqual(['actor', 'bytes', 'createdAt', 'frames', 'id', 'name', 'privacyChanged', 'revision', 'sameAsCurrent']);
    expect(whole().revision).toBe(before.revision); // saving is not an edit
  });
  it(`V11: the ${CRAFT_LIMITS.versions + 1}st save answers version_limit; an agent's ${CRAFT_LIMITS.agentVersions + 1}th version_limit_agents; a full disk 507`, () => {
    for (let i = 0; i < CRAFT_LIMITS.agentVersions; i++) saveVersion(store, gov, AGENT, pid, `agent ${i}`);
    const e = refusal(() => saveVersion(store, gov, AGENT, pid, 'one more'));
    expect([e.status, e.code, e.message]).toEqual([409, 'version_limit_agents', CRAFT_SERVER_REFUSALS.agentVersionLimit.message(CRAFT_LIMITS.agentVersions)]);
    for (let i = CRAFT_LIMITS.agentVersions; i < CRAFT_LIMITS.versions; i++) saveVersion(store, gov, OWNER, pid, `owner ${i}`);
    const full = refusal(() => saveVersion(store, gov, OWNER, pid, 'one more'));
    expect([full.status, full.code, full.message]).toEqual([409, 'version_limit', CRAFT_SERVER_REFUSALS.versionLimit.message(CRAFT_LIMITS.versions)]);
    expect(listVersions(store, OWNER, pid).length).toBe(CRAFT_LIMITS.versions);
    deleteVersion(store, OWNER, pid, listVersions(store, OWNER, pid)[0]!.id);
    store.maxStorageBytes = 1;
    const disk = refusal(() => saveVersion(store, gov, OWNER, pid, 'no room'));
    expect([disk.status, disk.code]).toEqual([507, 'storage_quota_exceeded']);
    expect(listVersions(store, OWNER, pid).length).toBe(CRAFT_LIMITS.versions - 1);
  });
  it('an observer and a propose-mode grant cannot save', () => {
    expect(refusal(() => saveVersion(store, gov, OBSERVER, pid, 'x')).status).toBe(403);
    const proposer = gov.principalForToken(gov.createGrant({ name: 'p', mode: 'propose' }, OWNER).token)!;
    expect(refusal(() => saveVersion(store, gov, proposer, pid, 'x')).message).toBe(CRAFT_SERVER_REFUSALS.proposeOnly.message());
  });
});

describe('list, rename, delete', () => {
  it('lists newest first with sameAsCurrent; rename and delete are the owner\'s; delete removes the row', () => {
    const v1 = saveVersion(store, gov, OWNER, pid, 'ראשונה');
    commit([{ op: 'trim_clip', args: { clipId: a, edge: 'end', to: f(20) } }]);
    const v2 = saveVersion(store, gov, OWNER, pid, 'שנייה');
    expect(listVersions(store, OBSERVER, pid).map((v) => [v.name, v.sameAsCurrent])).toEqual([['שנייה', true], ['ראשונה', false]]);
    expect(refusal(() => renameVersion(store, AGENT, pid, v1.id, 'x')).code).toBe('owner_required');
    expect(refusal(() => deleteVersion(store, AGENT, pid, v1.id)).code).toBe('owner_required');
    expect(renameVersion(store, OWNER, pid, v1.id, 'לפני הקיצור').name).toBe('לפני הקיצור');
    expect(deleteVersion(store, OWNER, pid, v2.id)).toEqual({ deleted: v2.id });
    expect(listVersions(store, OWNER, pid).map((v) => v.id)).toEqual([v1.id]);
    expect(refusal(() => deleteVersion(store, OWNER, pid, v2.id)).code).toBe('version_not_found');
    expect(refusal(() => renameVersion(store, OWNER, 'prj_other', v1.id, 'x')).code).toBe('version_not_found'); // a version of another project
  });
});

describe('restore', () => {
  it('V4: the edit entities become the version\'s, a later file stays, one transaction, the owner\'s Ctrl+Z gives the document back', () => {
    const v = saveVersion(store, gov, OWNER, pid, 'לפני');
    const version = whole().doc;
    commit([{ op: 'trim_clip', args: { clipId: a, edge: 'end', to: f(18) } }, { op: 'delete_clip', args: { clipId: b } }, { op: 'update_text', args: { clipId: title, text: 'שלום נועה' } }]);
    commit([{ op: 'import_asset', args: { asset: VIDEO('חדש.mp4', 'cd'.repeat(32)) } }]);
    const before = whole();
    const r = restoreVersion(store, gov, OWNER, pid, v.id, { expectRevision: before.revision });
    expect(r.revision).toBe(before.revision + 1);
    expect(r.diff.counts).toEqual({ added: 1, removed: 1, changed: 2 });
    const after = whole().doc;
    expect(editOf(after)).toBe(editOf(version));
    expect(Object.keys(after.assets).length).toBe(2);
    const tx = store.db.prepare('SELECT label, ops, kind FROM transactions WHERE project_id = ? AND revision = ?').get(pid, r.revision) as any;
    expect([tx.label, tx.kind, JSON.parse(tx.ops).map((o: OpCall) => o.op)]).toEqual(['שחזור גרסה: לפני', 'edit', ['restore_entities']]);
    store.undo(pid, 'user:local', 'undo');
    expect(canonical(whole().doc)).toBe(canonical(before.doc));
    // saved again at the restored state: nothing to restore
    const again = restoreVersion(store, gov, OWNER, pid, v.id, {});
    expect(refusal(() => restoreVersion(store, gov, OWNER, pid, v.id, {})).code).toBe('nothing_to_restore');
    void again;
  });
  it('refusals: stale_revision, restore_needs_confirmation, restore_too_large, version_conflict, version_not_found', () => {
    const v = saveVersion(store, gov, OWNER, pid, 'בלי אזור');
    commit([{ op: 'set_redact_region', args: { clipId: a, region } }]);
    const now = whole().revision;
    const stale = refusal(() => restoreVersion(store, gov, OWNER, pid, v.id, { expectRevision: now - 1 }));
    expect([stale.status, stale.code, stale.message]).toEqual([409, 'stale_revision', CRAFT_SERVER_REFUSALS.staleRevision.message(now)]);
    const confirm = refusal(() => restoreVersion(store, gov, OWNER, pid, v.id, {}));
    expect([confirm.status, confirm.code, confirm.message]).toEqual([409, 'restore_needs_confirmation', CRAFT_SERVER_REFUSALS.needsConfirmation.message(1)]);
    expect(whole().revision).toBe(now);
    const ok = restoreVersion(store, gov, OWNER, pid, v.id, { confirmPrivacy: true });
    expect((findClip(whole().doc, a)!.clip as any).redact).toBeUndefined();
    expect(ok.revision).toBe(now + 1);
    // too large: 5,001 markers added since
    const big = saveVersion(store, gov, OWNER, pid, 'בלי סמנים');
    store.commit({ projectId: pid, actor: 'user:local', ops: Array.from({ length: CRAFT_LIMITS.restoreEntities + 1 }, (_, i) => ({ op: 'add_marker', args: { time: f(100 + i) } })) });
    const large = refusal(() => restoreVersion(store, gov, OWNER, pid, big.id, {}));
    expect([large.status, large.code, large.message]).toEqual([422, 'restore_too_large', CRAFT_SERVER_REFUSALS.restoreTooLarge.message(CRAFT_LIMITS.restoreEntities + 1, CRAFT_LIMITS.restoreEntities)]);
    // conflict: a version whose clip runs past the end of its file (a copy changed by hand in the table: a synthetic
    // stand-in for an edit that no longer fits the library); nothing changes
    const bad = saveVersion(store, gov, OWNER, pid, 'פגומה');
    const row = store.db.prepare(`SELECT doc FROM ${VERSIONS_TABLE} WHERE id = ?`).get(bad.id) as { doc: string };
    const doc = JSON.parse(row.doc) as ProjectDocument;
    for (const t of Object.values(doc.sequences).flatMap((s) => s.tracks)) for (const c of t.clips) if (c.id === b) (c as any).duration = { value: '20', timescale: 1 };
    store.db.prepare(`UPDATE ${VERSIONS_TABLE} SET doc = ? WHERE id = ?`).run(JSON.stringify(doc), bad.id);
    const rev = whole().revision;
    const conflict = refusal(() => restoreVersion(store, gov, OWNER, pid, bad.id, {}));
    expect([conflict.status, conflict.code]).toEqual([409, 'version_conflict']);
    expect(conflict.message.startsWith('restoring this version would make the project invalid: ')).toBe(true);
    expect(whole().revision).toBe(rev);
    expect(refusal(() => restoreVersion(store, gov, OWNER, pid, 'ver_none', {})).code).toBe('version_not_found');
  });
  it('V5: a file removed since and cleaned up from storage comes back with its bytes', () => {
    const blob = path.join(store.blobDir, HEX);
    fs.writeFileSync(blob, 'abcd');
    store.db.prepare('INSERT INTO blobs (hash, size, mime, created_at) VALUES (?, 4, ?, ?)').run(`sha256:${HEX}`, 'video/mp4', new Date().toISOString());
    const v = saveVersion(store, gov, OWNER, pid, 'עם הים');
    commit([{ op: 'delete_clip', args: { clipId: a } }, { op: 'delete_clip', args: { clipId: b } }]);
    commit([{ op: 'remove_asset', args: { assetId: sea } }]);
    collectGarbage(store, OWNER, true);
    expect(fs.existsSync(blob)).toBe(true);
    restoreVersion(store, gov, OWNER, pid, v.id, {});
    expect(whole().doc.assets[sea]?.contentHash).toBe(`sha256:${HEX}`);
    expect(fs.readFileSync(blob, 'utf8')).toBe('abcd');
  });
  it('an agent restores through its grant: a clip-limited grant is refused out_of_scope and nothing changes', () => {
    const v = saveVersion(store, gov, OWNER, pid, 'לפני');
    commit([{ op: 'delete_clip', args: { clipId: b } }, { op: 'update_text', args: { clipId: title, text: 'אחר' } }]);
    const limited = gov.principalForToken(gov.createGrant({ name: 'tracks', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token)!;
    const rev = whole().revision;
    expect(refusal(() => restoreVersion(store, gov, limited, pid, v.id, {})).code).toBe('out_of_scope');
    expect(whole().revision).toBe(rev);
    expect(restoreVersion(store, gov, AGENT, pid, v.id, {}).revision).toBe(rev + 1);
    expect((store.db.prepare('SELECT actor FROM transactions WHERE project_id = ? AND revision = ?').get(pid, rev + 1) as any).actor).toBe('agent:local');
  });
});

describe('the project', () => {
  it('V7: deleting the project leaves no row of it in project_versions', () => {
    saveVersion(store, gov, OWNER, pid, 'אחת');
    const other = store.createProject({ name: 'אחר' }).doc.id;
    saveVersion(store, gov, OWNER, other, 'של האחר');
    deleteProject(store, OWNER, pid, 'גרסאות');
    expect((store.db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONS_TABLE} WHERE project_id = ?`).get(pid) as any).n).toBe(0);
    expect((store.db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONS_TABLE} WHERE project_id = ?`).get(other) as any).n).toBe(1);
  });
});
