/**
 * The archive «בלי פרטי משפחה» (ADR-0021, people section; peoplePrivacy.ts withoutFamily and archive.ts planArchive with
 * family 'omit'): no person, no birth date, no people field, and nothing silently broken (titles whose words change inside
 * them are listed in `varying`, titles with a field without words in `empty`); every other title, and every title at its
 * first frame, draws what it drew before (the evaluator's text layers, the same evaluate as preview, still and export).
 *
 * People are planted in the document directly (as an archive written by a later build holds them): the people operations
 * are W1's. Groups that need the words of people fields (names and ages: core documentPeople and ageWords, W1) run only once
 * PEOPLE_FIELDS_BUILT is true; until then documentPeople knows nobody, every people field has no words, and the groups
 * that hold without those words run (they are written to pass either way).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, isPersonToken, parseFields, PEOPLE_FIELDS_BUILT, validateProject, type Asset, type OpCall, type Person, type ProjectDocument, type TextClip } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { importArchive, planArchive, writeArchive } from './archive.ts';
import type { Principal } from './governance.ts';
import { namesOnly, readingAs, withoutFamily } from './peoplePrivacy.ts';
import { ApiError, Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const AGENT: Principal = { actor: 'agent:x', kind: 'agent', scopes: ['observe', 'edit'] };
/** Born 10 March 2020; pictures of 1 June 2021 (she is one, «בת שנה») and 1 June 2024 (she is four, «בת 4»). */
const NOA: Person = { id: 'per_noa', name: 'נועה', birthDate: '2020-03-10', form: 'f' };
/** A person without a birth date: her age has no words anywhere. */
const ITAI: Person = { id: 'per_itai', name: 'איתי', birthDate: null };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (n: number, at: string, contentHash = `sha256:${n.toString(16).padStart(64, '0')}`): Omit<Asset, 'id'> => ({ kind: 'video', name: `clip-${n}.mp4`, contentHash, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, provenance: prov, capture: { at, utcOffsetMinutes: null, source: 'manual' } });

/**
 * A film of two pictures (June 2021 for frames 0–59, June 2024 for 60–119) with:
 *  name   «{name} ({age})» over the first picture, with a format wording «גיל: {age}» and a second format whose wording is
 *         only Itai's age (no words there);
 *  cut    «{age} · {date}» across the cut (frames 30–89): its words change inside it;
 *  date   «{date}» only: no people field, so it keeps its live fields;
 *  plain  a title without fields that happens to hold the characters of a people field: it is drawn as typed, so it stays;
 *  itai   «{age:per_itai}» alone: no words at all;
 *  locked «{name}» on a locked track of its own.
 */
function planted(hashes?: [string, string]) {
  let n = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pp${n++}_`, actor: 'user:local', allowInternal });
  const lib = tx(createProject({ id: 'prj_family', name: 'משפחה', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: video(1, '2021-06-01T10:00:00', hashes?.[0]) } }, { op: 'import_asset', args: { asset: video(2, '2024-06-01T10:00:00', hashes?.[1]) } }], true);
  const [a1, a2] = lib.results.map((r) => r.output!.assetId as string);
  const withPeople: ProjectDocument = { ...lib.doc, people: { [NOA.id]: NOA, [ITAI.id]: ITAI } };
  const t = tx(withPeople, [
    { op: 'add_clip', args: { assetId: a1, start: f(0), duration: f(60), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: a2, start: f(60), duration: f(60), withLinkedAudio: false } },
    { op: 'add_text', args: { text: '{name:per_noa} ({age:per_noa})', start: f(0), duration: f(30) } },
    { op: 'add_text', args: { text: '{age:per_noa} · {date}', start: f(30), duration: f(60) } },
    { op: 'add_text', args: { text: '{date}', start: f(90), duration: f(30) } },
    { op: 'add_text', args: { text: 'כתוב כך: {name:per_noa}', start: f(0), duration: f(30) } },
    { op: 'add_text', args: { text: '{age:per_itai}', start: f(30), duration: f(30) } },
    { op: 'add_variant', args: { profileId: 'square-1x1' } },
    { op: 'add_variant', args: { profileId: 'vertical-9x16' } },
  ]);
  const id = (i: number) => t.results[i]!.output!.clipId as string;
  const ids = { name: id(2), cut: id(3), date: id(4), plain: id(5), itai: id(6), locked: '' };
  const [square, vertical] = [7, 8].map((i) => t.results[i]!.output!.variantId as string) as [string, string];
  const l = tx(t.doc, [{ op: 'add_text', args: { text: '{name:per_noa}', start: f(60), duration: f(30), transform: { y: 0.3 } } }]);
  ids.locked = l.results[0]!.output!.clipId as string;
  const lockedTrack = l.results[0]!.output!.trackId as string;
  const doc = tx(l.doc, [
    { op: 'set_variant_override', args: { variantId: square, clipId: ids.name, text: 'גיל: {age:per_noa}' } },
    { op: 'set_variant_override', args: { variantId: vertical, clipId: ids.name, text: '{age:per_itai}' } },
    ...[ids.name, ids.cut, ids.date, ids.itai, ids.locked].map((clipId): OpCall => ({ op: 'set_text_fields', args: { clipId, enabled: true } })),
    { op: 'update_track', args: { trackId: lockedTrack, locked: true } },
  ]).doc;
  return { doc, ids, square, vertical, lockedTrack };
}
const titleOf = (doc: ProjectDocument, clipId: string): TextClip => {
  for (const seq of Object.values(doc.sequences)) for (const tr of seq.tracks) for (const c of tr.clips) if (c.id === clipId && c.type === 'text') return c;
  throw new Error(`no title ${clipId}`);
};
const trackOf = (doc: ProjectDocument, trackId: string) => Object.values(doc.sequences).flatMap((s) => s.tracks).find((tr) => tr.id === trackId)!;
/** What the evaluator draws for this title at this frame ('' when it is not drawn), as preview, still and export see it. */
const drawn = (doc: ProjectDocument, clipId: string, frame: number): string | null => {
  const l = evaluate(doc, f(frame)).layers.find((x) => x.kind === 'text' && x.clipId === clipId);
  return l && l.kind === 'text' ? l.text : null;
};
const peopleFieldsIn = (doc: ProjectDocument): string[] => {
  const out: string[] = [];
  const has = (text: string) => parseFields(text).some((p) => 'token' in p && isPersonToken(p.token));
  for (const seq of Object.values(doc.sequences)) for (const tr of seq.tracks) for (const c of tr.clips) if (c.type === 'text' && c.fields && has(c.text)) out.push(c.id);
  for (const v of Object.values(doc.variants ?? {})) for (const [clipId, ov] of Object.entries(v.overrides)) if (ov.text !== undefined && titleOf(doc, clipId).fields && has(ov.text)) out.push(`${v.id}/${clipId}`);
  return out;
};
const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ApiError) return `${e.status} ${e.code}`; throw e; } return 'ok'; };

describe('withoutFamily: the document of the archive «בלי פרטי משפחה»', () => {
  it('leaves out the people and every people field; titles without one keep their live fields; the result is valid and the input untouched', () => {
    const { doc, ids } = planted();
    const before = JSON.stringify(doc);
    const r = withoutFamily(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(r.doc.people).toBeUndefined();
    expect(Object.hasOwn(r.doc, 'people')).toBe(false);
    expect(JSON.stringify(r.doc)).not.toMatch(/birthDate|2020-03-10/);
    expect(peopleFieldsIn(r.doc)).toEqual([]);
    expect(validateProject(r.doc)).toEqual([]);
    for (const k of ['name', 'cut', 'itai', 'locked'] as const) expect(titleOf(r.doc, ids[k]).fields, k).toBeUndefined();
    expect(titleOf(r.doc, ids.date)).toEqual(titleOf(doc, ids.date));
    expect(titleOf(r.doc, ids.plain)).toEqual(titleOf(doc, ids.plain));
    // nothing else changes: assets, clips, effects, events, captures
    const rest = (d: ProjectDocument) => { const { people: _p, sequences: _s, variants: _v, ...x } = d; return x; };
    expect(rest(r.doc)).toEqual(rest(doc));
  });

  it('every title draws at its first frame exactly what it drew before; the titles without people fields, at every frame', () => {
    const { doc, ids } = planted();
    const r = withoutFamily(doc);
    const first: Record<keyof typeof ids, number> = { name: 0, cut: 30, date: 90, plain: 0, itai: 30, locked: 60 };
    for (const [k, frame] of Object.entries(first)) expect(drawn(r.doc, ids[k as keyof typeof ids], frame), k).toBe(drawn(doc, ids[k as keyof typeof ids], frame));
    for (let frame = 0; frame < 120; frame += 7) for (const k of ['date', 'plain'] as const) expect(drawn(r.doc, ids[k], frame), `${k} at ${frame}`).toBe(drawn(doc, ids[k], frame));
    // the plain text is plain: a later frame of the frozen title shows the words of its first frame
    expect(drawn(r.doc, ids.cut, 89)).toBe(drawn(doc, ids.cut, 30));
  });

  it('never silently broken: a title whose words change inside it is listed in varying, one with a field without words in empty', () => {
    const { doc, ids } = planted();
    const r = withoutFamily(doc);
    // the date under «{age} · {date}» changes at the cut, whoever the people source knows
    expect(r.varying).toEqual([ids.cut]);
    expect(drawn(doc, ids.cut, 30)).not.toBe(drawn(doc, ids.cut, 89));
    // Itai has no birth date: his age has no words in the title, nor in the vertical format's wording of the name title
    expect(r.empty).toContain(ids.itai);
    expect(r.empty).toContain(ids.name);
    expect(new Set(r.empty).size).toBe(r.empty.length);
  });

  it('a title left with no words at all is stored empty, as it was drawn; a format wording left with none is not drawn in that format', () => {
    const { doc, ids, vertical, square } = planted();
    const r = withoutFamily(doc);
    expect(titleOf(r.doc, ids.itai).text).toBe('');
    expect(drawn(r.doc, ids.itai, 30)).toBe('');
    expect(JSON.stringify(r.doc)).not.toContain('\\u0000');
    const v = r.doc.variants[vertical]!.overrides[ids.name]!;
    expect(v.text).toBeUndefined();
    expect(v.hidden).toBe(true);
    expect(r.doc.variants[square]!.overrides[ids.name]!.text).not.toMatch(/\{/);
  });

  it('a title on a locked track is made plain and its track stays locked', () => {
    const { doc, ids, lockedTrack } = planted();
    const r = withoutFamily(doc);
    expect(trackOf(r.doc, lockedTrack).locked).toBe(true);
    expect(titleOf(r.doc, ids.locked).fields).toBeUndefined();
    expect(drawn(r.doc, ids.locked, 60)).toBe(drawn(doc, ids.locked, 60));
  });

  it('a document without people or people fields comes back the same, without a people key', () => {
    const doc = createProject({ id: 'p', name: 'P' });
    const r = withoutFamily({ ...doc, people: {} });
    expect(r).toEqual({ doc, varying: [], empty: [] });
  });

  it('refuses (409) instead of writing a title whose plain text would pass 2000 characters', () => {
    const { doc, ids } = planted();
    const long = applyTransaction(doc, [{ op: 'update_text', args: { clipId: ids.cut, text: `{name:per_noa}${' {date}'.repeat(280)}` } }], { idSeed: 'long_', actor: 'user:local' }).doc;
    expect(code(() => withoutFamily(long))).toBe('409 title_too_long');
  });

  it.runIf(PEOPLE_FIELDS_BUILT)('(W1) names and ages are frozen to the words they show at the first frame, in the master and in each format', () => {
    const { doc, ids, square } = planted();
    const r = withoutFamily(doc);
    expect(titleOf(r.doc, ids.name).text).toBe('נועה (בת שנה)');
    expect(r.doc.variants[square]!.overrides[ids.name]!.text).toBe('גיל: בת שנה');
    expect(titleOf(r.doc, ids.cut).text).toBe('בת שנה · 1 ביוני 2021');
    expect(titleOf(r.doc, ids.locked).text).toBe('נועה');
    // the vertical format's wording is Itai's age (no words) and the name title, which is in no other list, is in empty for it
    expect(r.empty.sort()).toEqual([ids.name, ids.itai].sort());
    expect(r.varying).toEqual([ids.cut]);
  });

  it.runIf(PEOPLE_FIELDS_BUILT)('(W1) made from a document read without birth dates, ages are frozen to nothing and listed in empty; names stay', () => {
    const { doc, ids } = planted();
    const r = withoutFamily(namesOnly(doc));
    expect(titleOf(r.doc, ids.name).text).toBe('נועה ()');
    expect(titleOf(r.doc, ids.locked).text).toBe('נועה');
    expect(r.empty).toEqual(expect.arrayContaining([ids.name, ids.cut, ids.itai]));
    expect(JSON.stringify(r.doc)).not.toMatch(/בת שנה|בת 4/);
  });
});

describe('the archive «בלי פרטי משפחה» through the store, and imported into another', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const world = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-family-free-')); dirs.push(d); return new Store(d); };
  const seed = (store: Store) => {
    const hashes = [1, 2].map((s) => {
      const bytes = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 17 + s) & 0xff));
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const tmp = path.join(store.tmpDir, `seed${s}`);
      fs.writeFileSync(tmp, bytes);
      store.putBlob(hash, tmp, bytes.length, 'video/mp4');
      return hash;
    }) as [string, string];
    const p = planted(hashes);
    return { ...p, pid: store.importProject(p.doc).doc.id };
  };
  const tar = async (plan: ReturnType<typeof planArchive>) => { const chunks: Buffer[] = []; for await (const c of writeArchive(plan)) chunks.push(c); return Buffer.concat(chunks); };

  for (const [who, p] of [['the owner', OWNER], ['an agent without the people scope', AGENT]] as const)
    it(`family 'omit' for ${who}: no person and no birth date in the archive; it imports into another store as a valid project without people fields`, async () => {
      const src = world(), dst = world();
      const { pid, ids } = seed(src);
      const plan = readingAs(p, () => planArchive(src, pid, { family: 'omit' }));
      const buf = await tar(plan);
      expect(buf.length).toBe(plan.bytes);
      const text = buf.toString('utf8');
      expect(text).not.toMatch(/birthDate|2020-03-10|"people":\s*\{|per_itai"/);
      const manifest = JSON.parse(plan.manifest.toString('utf8'));
      expect([manifest.family, manifest.people]).toEqual(['omit', 'none']);
      const file = path.join(dst.tmpDir, 'in.tar');
      fs.writeFileSync(file, buf);
      const imported = importArchive(dst, file).doc;
      expect(imported.people).toBeUndefined();
      expect(peopleFieldsIn(imported)).toEqual([]);
      expect(validateProject(imported)).toEqual([]);
      expect(titleOf(imported, ids.date).fields).toBe(true);
      for (const k of ['date', 'plain'] as const) for (const frame of [0, 45, 95]) expect(drawn(imported, ids[k], frame), `${k} at ${frame}`).toBe(drawn(src.wholeProject(pid).doc, ids[k], frame));
    });

  it('family "keep" (the default) carries the people for the owner, names only for an agent without the people scope', async () => {
    const src = world();
    const { pid } = seed(src);
    expect((await tar(readingAs(OWNER, () => planArchive(src, pid)))).toString('utf8')).toContain('2020-03-10');
    const agent = (await tar(readingAs(AGENT, () => planArchive(src, pid)))).toString('utf8');
    expect(agent).toContain('נועה');
    expect(agent).not.toContain('2020-03-10');
  });
});
