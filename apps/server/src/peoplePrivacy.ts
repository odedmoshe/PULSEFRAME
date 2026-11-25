/**
 * Who may read what about the people of a project (ADR-0021, people section). ONE module for every surface: the store, REST,
 * MCP tools and resources, server-sent events, proposals, archives, exports and rendered frames all come through here.
 *
 * THE OWNER'S CONDITIONS (2026-11-17), as rules:
 *  1. A person's birth date and word choice («בן» / «בת») stay inside the project file on this machine. The owner's own
 *     session reads them. A connected agent (a bearer token or a grant, over MCP or REST) reads the id and the NAME only,
 *     unless the owner created its grant with people: 'full'. The default is 'names'; only the owner creates grants; the
 *     built-in agent and observer tokens have no grant and are always 'names'.
 *  2. An age is a birth date in other words (a baby's age in days is the date; two ages at two capture dates give it for
 *     anyone). So WORDS AND PICTURES COMPUTED FROM A BIRTH DATE ARE WITHHELD TOO, not coarsened:
 *     a. Everything the server reads for a 'names' credential is read from the document WITHOUT birth dates and word
 *        choices (docForReader, applied by Store.getProject and Store.replay). The evaluator draws what the document it is
 *        handed says, so for that credential an {age:…} field has no words anywhere: describe_moment, render_frame, the
 *        contact sheet, proposal stills, preflight, export plans, measurements. It cannot tell "no birth date was entered"
 *        from "not for you", and is told so (peopleNote).
 *     b. A film rendered from the whole document may show ages. A 'names' credential may not start, retry or download an
 *        export (or a browser export) of a document that holds an {age:…} field in a title with live fields
 *        (assertMayTakeRendered). It is refused by the field, not by whether a birth date is recorded, so the refusal tells
 *        nothing either.
 *     c. A 'names' credential may not GIVE a birth date or a word choice either (assertMayWritePeople): otherwise
 *        "the person already has these details" would answer guesses. It may add a person by name, rename and remove.
 *     What stays visible, and the interface says so (apps/web/src/editor/lifeline/people.strings.ts PEOPLE_STRINGS.privacy):
 *     an age the owner made plain text ("Make it plain text"), or typed into a title or an event name, is ordinary text.
 *  3. Rows that hold operation arguments or entity states (proposals; anything later) never reach a 'names' credential
 *     with a birth date in them (scrubPeople, applied to proposals where they are read, to every JSON answer of REST as a
 *     net, to every MCP tool and resource result, and to every event of the event stream).
 *  4. The archive of a project carries its people. The owner may take one «בלי פרטי משפחה» (family: 'omit', withoutFamily);
 *     a 'names' credential always gets the archive of the document as it may read it (names, no birth dates).
 *  5. Marked source ranges («פנינים», wave 7; .artifacts/wave7/pearls-decisions.md §3). A range's LABEL can hold a child's words, so
 *     it is read like a birth date: a 'names' credential reads '' everywhere (namesOnly, scrubPeople) and may not give one
 *     (assertMayWritePeople). Person TAGS on ranges are the owner's alone: every credential that is not the owner's own session,
 *     people 'full' grants included, is refused any tag, any change to a tagged range and remove_person of a tagged person
 *     (assertOwnerTagsPeople, 403 human_tag_required). The archive «בלי פרטי משפחה» carries no range at all.
 *
 * EVERY SURFACE an agent credential can reach, with the helper of this module that guards it, is listed in
 * peopleSurfaces.ts; peopleSurfaces.test.ts keeps that list complete and walks it with a planted birth date.
 *
 * WHY AN AMBIENT READER: the routes, tools and jobs that read a project are many and grow with every track. The reader is
 * therefore set once where the credential is established (the REST middleware, the MCP entry) and the store applies it,
 * so a new route cannot forget. Writes never go through it: Store.commit and Store.undo read the whole document
 * (Store.wholeProject). Outside any request (server start, recovered jobs, the owner's exports) the reader is 'full'.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { applyTransaction, freezeOps, holdsAgeFields, isPersonToken, OpError, parseFields, PERSON_OPS, PERSON_PRIVATE_ARGS, validateProject, type OpCall, type ProjectDocument, type SourceRange, type TextClip } from '@pulseframe/core';
import type { Principal } from './governance.ts';
import { ApiError } from './store.ts';

export type PeopleAccess = 'names' | 'full';
export const PEOPLE_ACCESS = ['names', 'full'] as const;
/** The code of every refusal made here, so a client can tell it from other 403s. */
export const PEOPLE_SCOPE_REQUIRED = 'people_scope_required';
const HINT = 'Ask the owner: they can do this step themselves, or create a grant with people: "full".';

/** What this credential may read about people: the owner's session everything; an agent what its grant says, 'names' when it says nothing or there is no grant. */
export function peopleAccess(p: Principal): PeopleAccess {
  if (p.kind === 'user') return 'full';
  return p.grant?.people === 'full' ? 'full' : 'names';
}

// ---------- the reader of the current request ----------
const reader = new AsyncLocalStorage<{ access: PeopleAccess }>();
/** Runs `fn` (and everything it awaits or starts) as this credential: the store hands it the documents it may read. */
export function readingAs<T>(p: Principal, fn: () => T): T {
  return reader.run({ access: peopleAccess(p) }, fn);
}
/** The access of whoever the running code works for; 'full' outside any request. */
export const readerAccess = (): PeopleAccess => reader.getStore()?.access ?? 'full';

// ---------- documents ----------
const namesOnlyDocs = new WeakMap<ProjectDocument, ProjectDocument>();
/**
 * The document with every person reduced to id and name (birthDate null, no word choice). The same object when no person
 * holds either; otherwise a copy that shares everything else, kept per document (committed documents are not changed).
 */
export function namesOnly(doc: ProjectDocument): ProjectDocument {
  const people = doc.people, ranges = doc.sourceRanges;
  const dated = !!people && Object.values(people).some((p) => p.birthDate !== null || p.form !== undefined);
  // marked ranges (wave 7): their labels are family notes, read like a birth date (rule 5)
  const labelled = !!ranges && Object.values(ranges).some((r) => r.label !== '');
  if (!dated && !labelled) return doc;
  let out = namesOnlyDocs.get(doc);
  if (!out) {
    out = {
      ...doc,
      ...(dated ? { people: Object.fromEntries(Object.entries(people!).map(([key, p]) => [key, { id: p.id, name: p.name, birthDate: null }])) } : {}),
      ...(labelled ? { sourceRanges: Object.fromEntries(Object.entries(ranges!).map(([key, r]) => [key, { ...r, label: '' }])) } : {}),
    };
    namesOnlyDocs.set(doc, out);
    namesOnlyDocs.set(out, out);
  }
  return out;
}
export const docForAccess = (doc: ProjectDocument, access: PeopleAccess): ProjectDocument => (access === 'full' ? doc : namesOnly(doc));
/** The document as this credential may read it. */
export const docForPrincipal = (doc: ProjectDocument, p: Principal): ProjectDocument => docForAccess(doc, peopleAccess(p));
/** The document as the current request's credential may read it (Store.getProject and Store.replay answer through this). */
export const docForReader = (doc: ProjectDocument): ProjectDocument => docForAccess(doc, readerAccess());

// ---------- rows and answers that are not a document read through the store ----------
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const personOps: readonly string[] = PERSON_OPS;
/** The operations that give a range's label (rule 5). */
const LABEL_OPS: readonly string[] = ['add_source_range', 'update_source_range'];
/** A marked range wherever it sits (a document's map, an entity state, a row of the pearls view): its label is blanked for 'names'. */
const isRangeLike = (v: Record<string, unknown>): boolean => typeof v.label === 'string' && (v.kind === 'pearl' || v.kind === 'presence') && typeof v.assetId === 'string' && Object.hasOwn(v, 'span');
/**
 * Any JSON value without what a 'names' credential may not read, wherever it sits: every `birthDate` becomes null and the
 * `form` next to it is dropped (a person, in a document or in an entity state of a diff), and the birthDate and form
 * arguments of add_person / update_person calls are dropped (operation lists of proposals, also nested ones). Returns the
 * same value when there is nothing to take out; never changes its input.
 */
export function scrubPeople<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => { const y = walk(x); if (y !== x) changed = true; return y; });
      return changed ? out : v;
    }
    if (!isObject(v)) return v;
    let out: Record<string, unknown> | null = null;
    const set = (key: string, to: unknown, drop = false) => { out ??= { ...v }; if (drop) delete out[key]; else out[key] = to; };
    const person = Object.hasOwn(v, 'birthDate');
    const call = typeof v.op === 'string' && personOps.includes(v.op) && isObject(v.args);
    const range = isRangeLike(v);
    const labelCall = typeof v.op === 'string' && LABEL_OPS.includes(v.op) && isObject(v.args) && Object.hasOwn(v.args, 'label');
    for (const [key, x] of Object.entries(v)) {
      if (person && key === 'birthDate') { if (x !== null && x !== undefined) set(key, null); continue; }
      if (person && key === 'form') { set(key, undefined, true); continue; }
      if (range && key === 'label') { if (x !== '') set(key, ''); continue; }
      if (labelCall && key === 'args') { const { label: _l, ...kept } = x as Record<string, unknown>; set(key, kept); continue; }
      if (call && key === 'args') {
        const args = x as Record<string, unknown>;
        const kept = Object.fromEntries(Object.entries(args).filter(([k]) => !(PERSON_PRIVATE_ARGS as readonly string[]).includes(k)));
        if (Object.keys(kept).length !== Object.keys(args).length) set(key, kept);
        continue;
      }
      const y = walk(x);
      if (y !== x) set(key, y);
    }
    return out ?? v;
  };
  return walk(value) as T;
}
/** A value as this credential may read it: untouched for 'full', scrubbed for 'names'. */
export const forPrincipal = <T,>(value: T, p: Principal): T => (peopleAccess(p) === 'full' ? value : scrubPeople(value));
/** True when a serialised JSON answer may hold something scrubPeople takes out (so the REST net parses only those). */
export const mayHoldPeople = (json: string): boolean => /"birthDate"\s*:\s*"|"form"\s*:\s*"[mf]"|"kind"\s*:\s*"(?:pearl|presence)"|"op"\s*:\s*"(?:add|update)_source_range"/.test(json);

// ---------- writes ----------
/**
 * A 'names' credential may not give a birth date or a word choice (rule 2c): refused before the operation runs, for a
 * commit, a dry run and a proposal alike, also inside nested operation lists. The refusal names the arguments, never a value.
 */
export function assertMayWritePeople(p: Principal, ops: unknown): void {
  if (peopleAccess(p) === 'full') return;
  const given = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isObject(v)) return;
    if (typeof v.op === 'string' && personOps.includes(v.op) && isObject(v.args)) for (const k of PERSON_PRIVATE_ARGS) if (Object.hasOwn(v.args, k)) given.add(k);
    for (const x of Object.values(v)) walk(x);
  };
  walk(ops);
  if (given.size) throw new ApiError(403, PEOPLE_SCOPE_REQUIRED, `this credential may give a person's name only, not ${[...given].join(' or ')}`, { arguments: [...given], people: 'names' }, HINT);
  // rule 5: nor a range's label (a refusal such as "already has these details" would otherwise answer guesses)
  if (callsOf(ops, LABEL_OPS).some((c) => Object.hasOwn(c.args, 'label'))) throw new ApiError(403, PEOPLE_SCOPE_REQUIRED, HUMAN_TAG_REFUSALS.label, { arguments: ['label'], people: 'names' }, 'Add the pearl without a name; the owner names it in the editor.');
}

// ---------- tags on marked ranges: the owner's alone (rule 5) ----------
export const HUMAN_TAG_REQUIRED = 'human_tag_required';
/** Fixed English of the guards of rule 5; the Hebrew is packages/i18n/src/pearls.ts HE_PEARLS. */
export const HUMAN_TAG_REFUSALS = {
  tagging: 'only the project owner tags people on marked ranges, from their own session',
  taggedRange: 'this marked range has people tagged by the project owner; only the owner may change or remove it',
  taggedPerson: 'this person is tagged in marked ranges; only the project owner may remove them',
  label: 'this credential may not give the name of a marked range: pearl names are family notes',
} as const;
const TAG_HINT = 'Ask the owner to do this step in the editor. Marking and changing ranges without people stays open to you.';
/** Every operation call named `ops` holds (also nested: apply_transaction steps, template steps), with object arguments. */
function callsOf(ops: unknown, names: readonly string[]): { op: string; args: Record<string, unknown> }[] {
  const out: { op: string; args: Record<string, unknown> }[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isObject(v)) return;
    if (typeof v.op === 'string' && names.includes(v.op) && isObject(v.args)) out.push({ op: v.op, args: v.args });
    for (const x of Object.values(v)) walk(x);
  };
  walk(ops);
  return out;
}
const TAG_OPS: readonly string[] = ['add_source_range', 'update_source_range', 'remove_source_range', 'remove_person'];
/**
 * Only the owner's own session tags people on marked ranges (rule 5; decisions §2.2). Keyed on the credential's KIND, never on its
 * people access: a grant with people 'full' is refused as well. Refused before any operation runs, for a commit, a dry run and a
 * proposal alike, also inside nested operation lists, 403 human_tag_required, when:
 *  - add_source_range or update_source_range carries a `people` key (also []), or add_source_range has kind 'presence';
 *  - update_source_range or remove_source_range names a range that holds people in the WHOLE document;
 *  - remove_person names a person that some range holds.
 * `wholeDoc` is read only when such a call is present; lookups are own-property, and an unknown id is left to the op's not_found.
 */
export function assertOwnerTagsPeople(p: Principal, ops: unknown, wholeDoc: () => ProjectDocument): void {
  if (p.kind === 'user') return;
  const calls = callsOf(ops, TAG_OPS);
  if (!calls.length) return;
  const refuse = (key: keyof typeof HUMAN_TAG_REFUSALS, details: Record<string, unknown>) => { throw new ApiError(403, HUMAN_TAG_REQUIRED, HUMAN_TAG_REFUSALS[key], details, TAG_HINT); };
  for (const c of calls) if (c.op !== 'remove_person' && c.op !== 'remove_source_range' && (Object.hasOwn(c.args, 'people') || (c.op === 'add_source_range' && c.args.kind === 'presence'))) refuse('tagging', { op: c.op });
  let ranges: Record<string, SourceRange> | null = null;
  const all = () => (ranges ??= wholeDoc().sourceRanges ?? {});
  for (const c of calls) {
    if (c.op === 'update_source_range' || c.op === 'remove_source_range') {
      const id = c.args.rangeId;
      const r = typeof id === 'string' && Object.hasOwn(all(), id) ? all()[id]! : null;
      if (r?.people?.length) refuse('taggedRange', { op: c.op, rangeId: id });
    } else if (c.op === 'remove_person') {
      const id = c.args.personId;
      if (typeof id === 'string' && Object.values(all()).some((r) => r.people?.includes(id))) refuse('taggedPerson', { op: c.op, personId: id });
    }
  }
}

// ---------- films and stills rendered from the whole document ----------
/**
 * Refuses to hand a 'names' credential a film (or the document to render one from) when the document it was, or would be,
 * rendered from holds an age field (rule 2b). `doc` is the WHOLE document or a job's stored snapshot, never the reader's.
 */
export function assertMayTakeRendered(p: Principal, doc: ProjectDocument, what: string): void {
  if (peopleAccess(p) === 'full' || !holdsAgeFields(doc)) return;
  throw new ApiError(403, PEOPLE_SCOPE_REQUIRED, `this credential may not ${what}: a title shows a person's age, which is worked out from a birth date`, { people: 'names' }, `${HINT} A title made plain text no longer counts.`);
}
/**
 * What an answer made for a 'names' credential says when the document holds an age field, so that an empty age is not read
 * as a mistake: spread into the answer (`...peopleNote(p, doc)`). Nothing for 'full', and nothing when no age field exists.
 */
export function peopleNote(p: Principal, doc: ProjectDocument): { peopleAccess?: { access: 'names'; note: string } } {
  if (peopleAccess(p) === 'full' || !holdsAgeFields(doc)) return {};
  return { peopleAccess: { access: 'names', note: 'Birth dates are not available to this credential, so age fields have no words here: they are drawn empty and reported as without data, whether or not a birth date is recorded. Exports that would show them are refused.' } };
}

// ---------- the archive «בלי פרטי משפחה» ----------
export type ArchiveFamily = 'keep' | 'omit';
export interface FamilyFreeDocument {
  /** The document without `people`, every title that had a people field made plain text showing what it shows at its first frame. */
  doc: ProjectDocument;
  /** Titles whose words change inside them (two ages across a cut): they are frozen at their first value, and listed for the dialog. */
  varying: string[];
  /** Titles with a people field that has no words at their first frame (no date under them, no birth date): the field becomes nothing, and they are listed. */
  empty: string[];
}
/** True when this stored text holds a people field ({name:…}, {age:…}, also an age with a format outside AGE_FORMATS). */
const holdsPeopleField = (text: string): boolean => text.includes('{') && parseFields(text).some((p) => 'token' in p && isPersonToken(p.token));
/**
 * The titles with live fields whose text, or a format's wording of it, holds a people field: in document order (sequences,
 * tracks bottom to top as stored, clips in time order), with their track and whether that track is locked.
 */
function peopleTitles(doc: ProjectDocument): { sequenceId: string; trackId: string; clipId: string; locked: boolean }[] {
  const worded = new Set<string>();
  for (const v of Object.values(doc.variants ?? {}))
    for (const [clipId, ov] of Object.entries(v.overrides)) if (ov.text !== undefined && holdsPeopleField(ov.text)) worded.add(clipId);
  const out: { sequenceId: string; trackId: string; clipId: string; locked: boolean }[] = [];
  for (const [sequenceId, seq] of Object.entries(doc.sequences))
    for (const track of seq.tracks)
      for (const c of track.clips)
        if (c.type === 'text' && c.fields && (holdsPeopleField(c.text) || worded.has(c.id))) out.push({ sequenceId, trackId: track.id, clipId: c.id, locked: track.locked });
  return out;
}
/**
 * Stands for an empty frozen text inside the transaction: update_text and set_variant_override take one character at least,
 * while a field without words can leave a title with none. Replaced right after the transaction, in the outputs it was put in.
 */
const EMPTY_TEXT = '\u0000';
/**
 * The document for an archive «בלי פרטי משפחה» (rule 4):
 * - every title with live fields that holds a people field ({age}, {name}) in its text or in a format's wording of it is
 *   made plain text with core freezeOps(doc, sequenceId, clipId) at its first frame, all of them in ONE applyTransaction
 *   (so each is exactly what "Make it plain text" gives, and the result is validated once). A title on a locked track is
 *   unlocked and locked again inside that transaction, so the lock is kept. Titles without people fields keep their live
 *   fields, and every other part of the document is unchanged (the media files too: the dialog says so);
 * - `people` is removed;
 * - never silently broken: a title whose words change inside it is frozen at its first value and listed in `varying`; a
 *   title with a field that has no words at its first frame (no date under it, no birth date, a person who is not there,
 *   or a document read without birth dates) is frozen with nothing in that field's place and listed in `empty`. When that
 *   leaves no words at all, the text is stored empty (as the title drew it); a format's own wording that is left with no
 *   words takes the master's when the master is empty too, else the title is hidden in that format;
 * - refused (409) rather than written partly: a title whose plain text would pass 2000 characters, or a transaction the
 *   operations refuse. The result is checked before it is returned: it passes validateProject and holds no person and no
 *   people field.
 * Pure: `doc` is not changed. It is the document as the caller may read it (the owner's whole document, or one without
 * birth dates), so a 'names' credential's family-free archive has ages frozen to nothing and listed in `empty`.
 */
export function withoutFamily(doc: ProjectDocument): FamilyFreeDocument {
  const titles = peopleTitles(doc);
  const varying: string[] = [], empty: string[] = [], tooLong: string[] = [];
  const ops: OpCall[] = [];
  const emptied: { clipId: string; variantId: string | null }[] = [];
  const locked = new Map<string, string>(); // trackId → sequenceId
  for (const t of titles) {
    const frozen = freezeOps(doc, t.sequenceId, t.clipId);
    if (frozen.varies) varying.push(t.clipId);
    if (frozen.missing.length) empty.push(t.clipId);
    if (frozen.tooLong.length) { tooLong.push(t.clipId); continue; }
    for (const call of frozen.ops) {
      const args = call.args as Record<string, unknown>;
      if ((call.op === 'update_text' || call.op === 'set_variant_override') && args.text === '') {
        emptied.push({ clipId: t.clipId, variantId: call.op === 'update_text' ? null : String(args.variantId) });
        ops.push({ op: call.op, args: { ...args, text: EMPTY_TEXT } });
      } else ops.push(call);
    }
    if (t.locked) locked.set(t.trackId, t.sequenceId);
  }
  if (tooLong.length) throw new ApiError(409, 'title_too_long', `${tooLong.length === 1 ? 'a title' : `${tooLong.length} titles`} would pass 2000 characters as plain text, so the archive without family details cannot be written`, { clipIds: tooLong.slice(0, 20) }, 'Shorten the title, or make it plain text yourself and shorten it then.');
  let out: ProjectDocument;
  if (ops.length) {
    const lock = (on: boolean): OpCall[] => [...locked].map(([trackId, sequenceId]) => ({ op: 'update_track', args: { sequenceId, trackId, locked: on } }));
    try {
      out = applyTransaction(doc, [...lock(false), ...ops, ...lock(true)], { idSeed: 'family_free_', actor: 'archive' }).doc;
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      throw new ApiError(409, 'family_free_refused', `the titles could not be made plain text for the archive without family details: ${e.message}`, { code: e.code, op: e.details.op ?? null, index: e.details.index ?? null });
    }
    for (const { clipId, variantId } of emptied) {
      const clip = findText(out, clipId);
      if (variantId === null) { if (clip) clip.text = ''; continue; }
      const ov = out.variants[variantId]?.overrides[clipId];
      if (!ov || ov.text !== EMPTY_TEXT) continue;
      delete ov.text;
      if (clip?.text !== '') ov.hidden = true; // no words in this format, and the master has some: show nothing here rather than the master's
    }
  } else out = { ...doc };
  delete out.people;
  // marked ranges (rule 5): labels are family notes and tags name people, so the archive without family details holds none
  delete out.sourceRanges;
  // the archive is never written with people data left in under this name
  const issues = validateProject(out);
  const left = peopleTitles(out).map((t) => t.clipId);
  if (issues.length || left.length || out.people !== undefined) throw new ApiError(500, 'family_free_incomplete', 'the archive without family details came out incomplete, so it is not written', { issues: issues.slice(0, 5).map((i) => i.message), titlesWithPeopleFields: left.slice(0, 20) });
  return { doc: out, varying, empty };
}
/** A title anywhere in the document, by id. */
function findText(doc: ProjectDocument, clipId: string): TextClip | null {
  for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const c of track.clips) if (c.id === clipId) return c.type === 'text' ? c : null;
  return null;
}
