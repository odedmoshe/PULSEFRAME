/**
 * The server-side contracts of the life line (ADR-0021) that the lead pre-pass owns: the home time zone setting, the two
 * routes with their guards, and the wiring of the field issues into the export plan and the preflight report.
 * Every fixture here is one where the finished feature must answer the same as today (a field with nothing to take a date
 * from; a stamp over an undated file), so nothing pins a placeholder. What W2 builds is listed as todo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { DEFAULT_HOME_ZONE, loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { preflight } from './preflight.ts';
import { FIELD_ISSUE_CODES, fieldIssues, isFieldIssueCode } from './preflight.fields.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, exporter: Exporter;
let pid = '', ownerCookie = '';
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (token: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-life-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, governance, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = store.createProject({ name: 'life', width: 640, height: 360, frameRate: R }).doc.id;
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('life line: the home time zone (PF_HOME_TZ)', () => {
  it('defaults to Asia/Jerusalem, takes an IANA name, and refuses to start with a name this machine does not know', () => {
    expect(DEFAULT_HOME_ZONE).toBe('Asia/Jerusalem');
    expect(loadConfig({}).homeZone).toBe('Asia/Jerusalem');
    expect(loadConfig({ PF_HOME_TZ: '' }).homeZone).toBe('Asia/Jerusalem');
    expect(loadConfig({ PF_HOME_TZ: 'Europe/London' }).homeZone).toBe('Europe/London');
    expect(() => loadConfig({ PF_HOME_TZ: 'Mars/Olympus' })).toThrow(/PF_HOME_TZ=Mars\/Olympus refused/);
  });
});

describe('life line: route guards', () => {
  it('"on this day" reads across every project, so it answers the owner\'s own session only', async () => {
    for (const token of [auth.tokens.agent, auth.tokens.observer]) {
      const r = await rest('GET', '/on-this-day?date=2024-12-25', bearer(token));
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('owner_required');
    }
    const none = await app.fetch(new Request(`${base()}/api/v1/on-this-day?date=2024-12-25`, { headers: { host: `127.0.0.1:${cfg.port}` } }));
    expect(none.status).toBe(401);
  });
  it('"on this day" wants a real day written YYYY-MM-DD and refuses anything else before reading a project', async () => {
    for (const q of ['', '?date=', '?date=2024-02-30', '?date=2024-12-25T10:00:00', '?date=25.12.2024', '?date=1850-01-01', '?date=today']) {
      const r = await rest('GET', `/on-this-day${q}`, ownerHeaders());
      expect(r.status, q).toBe(400);
      expect(r.body.error.code, q).toBe('invalid_request');
    }
  });
  it('re-reading capture dates is an edit of the project: an observer is refused, and an unknown project is not found', async () => {
    const observer = await rest('POST', `/projects/${pid}/captures/read`, bearer(auth.tokens.observer));
    expect(observer.status).toBe(403);
    expect(observer.body.error.code).toBe('insufficient_scope');
    const unknown = await rest('POST', '/projects/prj_none/captures/read', bearer(auth.tokens.agent));
    expect(unknown.status).toBe(404);
    expect(store.getProject(pid).revision).toBe(0);
  });
  // W2 (apps/server/src/lifeline.test.ts):
  it.todo('"on this day" lists the owner\'s files taken on this date in earlier years, by the Gregorian and the Hebrew date, at most 12');
  it.todo('re-reading attaches dates read from the stored originals in one transaction, never over a date set by hand, and can be undone');
  it.todo('an upload gets the capture date read from its original bytes before any conform, and no location is read or stored');
});

describe('life line: field issues in the export plan and the preflight', () => {
  /** A title with a field and nothing under it to take a date from (no picture clip, no dated file anywhere), and a clip of an undated file with a capture-sourced stamp. */
  function fixture(): { doc: ProjectDocument; revision: number; titleId: string; clipId: string } {
    const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
    const video = { kind: 'video' as const, name: 'undated.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };
    const id = store.createProject({ name: 'fields', width: 640, height: 360, frameRate: R }).doc.id;
    const imp = store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: video } }] });
    const r = store.commit({ projectId: id, actor: 'user:local', ops: [
      { op: 'add_text', args: { text: 'צולם ב־{date}', start: f(120), duration: f(30) } },
      { op: 'add_clip', args: { assetId: imp.results[0]!.output!.assetId as string, start: f(0), duration: f(60) } },
    ] });
    const titleId = r.results[0]!.output!.clipId as string, clipId = r.results[1]!.output!.clipId as string;
    store.commit({ projectId: id, actor: 'user:local', ops: [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture' } } }] });
    const p = store.getProject(id);
    // the title is given its `fields` mark directly: the operation that sets it (set_text_fields) is W1's
    const doc = structuredClone(p.doc);
    for (const t of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === titleId && c.type === 'text') c.fields = true;
    return { doc, revision: p.revision, titleId, clipId };
  }
  it('a field without data stops an export of moving picture, and never a still or sound alone', () => {
    const { doc, revision, titleId, clipId } = fixture();
    for (const format of ['mp4-h264-aac', 'webm-vp9-opus', 'gif'] as const) {
      const plan = exporter.plan(doc, revision, { format });
      expect(plan.blockers.filter((b) => isFieldIssueCode(b.code)), format).toEqual([expect.objectContaining({ code: 'field_no_data', ids: expect.arrayContaining([titleId]) })]);
      expect(plan.warnings.filter((b) => isFieldIssueCode(b.code)), format).toEqual([expect.objectContaining({ code: 'stamp_no_date', ids: [clipId] })]);
    }
    for (const options of [{ format: 'png', frame: 125 }, { format: 'wav' }] as const) {
      const plan = exporter.plan(doc, revision, options);
      expect([...plan.blockers, ...plan.warnings].filter((b) => isFieldIssueCode(b.code)), options.format).toEqual([]);
    }
    // a range that does not reach the title is not stopped by it
    const early = exporter.plan(doc, revision, { range: { startFrame: 0, endFrame: 60 } });
    expect(early.blockers.filter((b) => isFieldIssueCode(b.code))).toEqual([]);
    expect(early.warnings.filter((b) => isFieldIssueCode(b.code)).map((b) => b.code)).toEqual(['stamp_no_date']);
    const late = exporter.plan(doc, revision, { range: { startFrame: 100, endFrame: 150 } });
    expect(late.blockers.filter((b) => isFieldIssueCode(b.code)).map((b) => b.code)).toEqual(['field_no_data']);
    expect(late.warnings.filter((b) => isFieldIssueCode(b.code))).toEqual([]);
  });
  it('the preflight lists each of those issues once, with the frames where it holds', () => {
    const { doc, revision, titleId, clipId } = fixture();
    const report = preflight(exporter, doc, revision);
    const life = report.issues.filter((i) => isFieldIssueCode(i.code)).sort((x, y) => (x.code < y.code ? -1 : 1)); // their order is not part of the contract
    expect(life.map((i) => [i.code, i.severity])).toEqual([['field_no_data', 'blocker'], ['stamp_no_date', 'warning']]);
    expect(life[0]).toMatchObject({ ids: expect.arrayContaining([titleId]), range: { startFrame: 120, endFrame: 150 } });
    expect(life[1]).toMatchObject({ ids: [clipId], range: { startFrame: 0, endFrame: 60 } });
    expect(report.ok).toBe(false);
    expect(report.scope).toMatch(/title fields without data/);
    expect(fieldIssues(doc).map((i) => i.code).sort()).toEqual(['field_no_data', 'stamp_no_date']);
  });
  it('a project without fields or capture-sourced stamps has no such issue, and its plan is what it was', () => {
    const p = store.getProject(pid);
    expect(fieldIssues(p.doc)).toEqual([]);
    const { doc, revision } = fixture();
    const plain = structuredClone(doc);
    for (const t of plain.sequences[plain.mainSequenceId]!.tracks) for (const c of t.clips) { if (c.type === 'text') delete c.fields; if (c.type !== 'caption') delete c.effects; }
    expect([...exporter.plan(plain, revision, {}).blockers, ...exporter.plan(plain, revision, {}).warnings].filter((b) => isFieldIssueCode(b.code))).toEqual([]);
    expect(FIELD_ISSUE_CODES).toEqual(['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date']);
  });
  // W2 (apps/server/src/preflight.fields.test.ts):
  it.todo('an undated clip under a title with a field, with a dated clip later on the same track: empty text and field_no_data with the frame range');
  it.todo('an evening clip with {hebrewDate}: field_sunset_undecided, cleared by update_event afterSunset');
  it.todo('a field that takes its date from a file-name estimate: note capture_estimated');
});
