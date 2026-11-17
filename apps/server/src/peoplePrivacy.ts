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
 *     What stays visible, and the interface says so (apps/web/src/editor/lifeline/people.strings.ts `people.privacy`):
 *     an age the owner made plain text ("Make it plain text"), or typed into a title or an event name, is ordinary text.
 *  3. Rows that hold operation arguments or entity states (proposals; anything later) never reach a 'names' credential
 *     with a birth date in them (scrubPeople, applied to proposals where they are read, to every JSON answer of REST as a
 *     net, to every MCP tool and resource result, and to every event of the event stream).
 *  4. The archive of a project carries its people. The owner may take one «בלי פרטי משפחה» (family: 'omit', withoutFamily);
 *     a 'names' credential always gets the archive of the document as it may read it (names, no birth dates).
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
import { holdsAgeFields, PERSON_OPS, PERSON_PRIVATE_ARGS, type ProjectDocument } from '@pulseframe/core';
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
  const people = doc.people;
  if (!people || !Object.values(people).some((p) => p.birthDate !== null || p.form !== undefined)) return doc;
  let out = namesOnlyDocs.get(doc);
  if (!out) {
    out = { ...doc, people: Object.fromEntries(Object.entries(people).map(([key, p]) => [key, { id: p.id, name: p.name, birthDate: null }])) };
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
    for (const [key, x] of Object.entries(v)) {
      if (person && key === 'birthDate') { if (x !== null && x !== undefined) set(key, null); continue; }
      if (person && key === 'form') { set(key, undefined, true); continue; }
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
export const mayHoldPeople = (json: string): boolean => /"birthDate"\s*:\s*"|"form"\s*:\s*"[mf]"/.test(json);

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
/**
 * The document for an archive «בלי פרטי משפחה» (rule 4). W2 fills it:
 * - every title with live fields that holds a people field ({age}, {name}), and each format's wording of it, is made plain
 *   text with core freezeOps(doc, sequenceId, clipId) applied through applyTransaction (so the result is exactly what "Make
 *   it plain text" gives); titles without people fields keep their live fields;
 * - `people` is removed; nothing else changes (media files are untouched: say so in the dialog);
 * - never silently broken: a title whose value changes inside it goes to `varying`, one whose people field has no words at
 *   its first frame goes to `empty`; the result must pass validateProject, hold no person and no people field, and render
 *   every unchanged title exactly as before.
 * Until then it refuses: an archive is never written with people data left in under this name.
 */
export function withoutFamily(_doc: ProjectDocument): FamilyFreeDocument {
  throw new ApiError(501, 'not_implemented', 'the archive without family details is not built yet', {}, 'Download the full archive, or remove the people first.');
}
