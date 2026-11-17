/**
 * Operations on the people of a project (ADR-0021, people section): add_person, update_person, remove_person. Registered on
 * import of this module (packages/core/src/index.ts exports it); every one runs only through applyTransaction.
 *
 * The lead's contract fixes the names, versions, descriptions and argument schemas, the outputs, and every refusal with its
 * code, English wording and hint (PEOPLE_REFUSALS; the Hebrew wording is packages/i18n/src/people.ts HE_PEOPLE and
 * packages/evals/src/people-wording.test.ts keeps the two in step). The apply bodies are W1's.
 *
 * RULES OF THE BODIES
 * - Undo is the generic one: the store restores the before-states of the changed `person` entities (entities.ts). No
 *   operation here needs an inverse and none stores anything computed from a birth date.
 * - Refuse only with peopleRefusal(...). Look a person up with people.ts personOf (`personId` naming an Object.prototype
 *   member is refused before apply by refuseInheritedIds). Write `(d.people ??= {})`; when the last person is removed,
 *   remove the `people` key as well (a project without people is stored exactly as before this build).
 * - Ids: ctx.newId('per') (it matches schema.ts PERSON_ID). The name is stored as people.ts storedPersonName(name); two
 *   people are the same name when personNameKey says so.
 * - PRIVACY, the part of the owner's conditions that lives in core: no summary, no refusal message, no refusal detail and no
 *   output of these operations holds a birth date or the word choice. Summaries name the person and nothing else
 *   (PERSON_SUMMARIES); details hold ids only. The operation log and the entity states do hold the birth date (undo needs
 *   them); the server never sends those to a credential without the people scope (apps/server/src/peoplePrivacy.ts), and
 *   refuses a birthDate or form argument from such a credential before the operation runs.
 * - Order of refusals. add_person: personNameCharacters, personNameEmpty, noSuchBirthDay, birthDateOutOfRange,
 *   personNameTaken, tooManyPeople. update_person: personNotFound, personNothingToChange (no name, birthDate or form given),
 *   then as add_person for what is given (personNameTaken does not count the person itself), then personUnchanged (every
 *   given value is the stored one). remove_person: personNotFound, personInUse (fields.ts fieldUsersOfPerson; details
 *   { personId, clipIds } with at most 50 ids).
 * - set_text_fields (lifeOps.ts) changes with this step: turning live fields on is refused with unknownPerson when a people
 *   field names someone who is not in the project (the groups are listed); LIFE_REFUSALS.personFields ("this project holds
 *   no people") is gone. Built by the lead in lifeOps.ts (that body was already built). update_text on a title that already
 *   has live fields stays as it is: a person who is not there has no words and the export preflight says so.
 */
import { z } from 'zod';
import { defineOp, OpError, type OpErrorCode } from './ops.ts';
import { CAPTURE_MAX_YEAR, CAPTURE_MIN_YEAR, MAX_PEOPLE, MAX_PERSON_NAME, WALL_DATE } from './schema.ts';

/**
 * False while the three apply bodies are the lead's placeholders (they refuse). W1 sets it true in the commit that builds
 * them: the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) then draws the people rows, and the lead's tests that are
 * skipped until then (people contracts, wording, the walk of the server's surfaces after real commits) start to run.
 */
export const PEOPLE_OPS_BUILT = false;

// ---------- argument schemas ----------
/** Shape only: the body refuses the characters a name cannot hold by name (personNameCharacters), so the refusal can be worded. */
const NameIn = z.string().min(1).max(MAX_PERSON_NAME).describe('the name as it is shown, one line; braces, a colon, a bar and a line break are refused');
const BirthIn = z.string().regex(WALL_DATE).nullable().describe('the day of birth, YYYY-MM-DD on the Gregorian calendar; null = not given (age fields of this person then show nothing). Needs a credential that may read birth dates');
const FormIn = z.enum(['m', 'f']).nullable().describe("the Hebrew word before the age: m = «בן», f = «בת», null = «גיל». Needs a credential that may read birth dates");
export const AddPersonArgs = z.object({ name: NameIn, birthDate: BirthIn.optional(), form: FormIn.optional() }).strict();
export const UpdatePersonArgs = z.object({ personId: z.string(), name: NameIn.optional(), birthDate: BirthIn.optional().describe('null removes the birth date'), form: FormIn.optional().describe('null removes the word choice') }).strict();
export const RemovePersonArgs = z.object({ personId: z.string() }).strict();
/** The operations whose arguments can hold a birth date or a word choice, and the names of those arguments (the server's redaction reads this). */
export const PERSON_OPS = ['add_person', 'update_person', 'remove_person'] as const;
export const PERSON_PRIVATE_ARGS = ['birthDate', 'form'] as const;

// ---------- outputs (OpResult.output) ----------
export interface AddPersonOutput { personId: string }

// ---------- refusals: code, English wording (fixed) and hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/**
 * Every refusal of the people operations. The messages are fixed: the Hebrew table recognises them by their shape
 * (packages/i18n/src/people.ts HE_PEOPLE). None of them holds a birth date, and none may ever be given one.
 */
export const PEOPLE_REFUSALS = {
  personNotFound: refusal('not_found', (personId: string) => `person ${personId} not found`, 'get_summary lists the people of the project.'),
  personNameCharacters: refusal('invalid_args', () => 'a name cannot hold braces, a colon, a bar or a line break'),
  personNameEmpty: refusal('invalid_args', () => 'a name needs at least one character that is not a space'),
  noSuchBirthDay: refusal('invalid_args', () => 'a birth date must be a day that exists in the calendar', 'Give a real date, for example 2020-02-29.'),
  birthDateOutOfRange: refusal('out_of_bounds', () => `a birth date lies between ${CAPTURE_MIN_YEAR} and ${CAPTURE_MAX_YEAR}`),
  personNameTaken: refusal('incompatible', (name: string) => `another person in this project is already called "${name}"`, 'Give a name that tells the two apart.'),
  tooManyPeople: refusal('out_of_bounds', () => `a project holds at most ${MAX_PEOPLE} people`),
  personNothingToChange: refusal('invalid_args', () => 'nothing to change: give name, birthDate or form'),
  personUnchanged: refusal('invalid_args', () => 'the person already has these details'),
  personInUse: refusal('incompatible', (titles: number) => `${titles} title(s) hold a field for this person`, 'Make those titles plain text first (commit the operations freezeOps returns; in the editor: "Make it plain text"), or delete the fields from their text.'),
  // set_text_fields, from this step on (see the rules above)
  unknownPerson: refusal('invalid_args', (groups: string) => `these fields name a person who is not in this project: ${groups}`, 'get_summary lists the people; add the person first (add_person), or remove those fields from the text.'),
} as const;
export type PeopleRefusalKey = keyof typeof PEOPLE_REFUSALS;
/** The typed refusal of a people operation: `throw peopleRefusal('personInUse', { personId, clipIds }, clipIds.length)`. Details hold ids only, never a birth date. */
export function peopleRefusal<K extends PeopleRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof PEOPLE_REFUSALS)[K]['message']>): OpError {
  const r = PEOPLE_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/** The summaries of the three operations (history and events are readable by every credential): the name, and nothing else about the person. */
export const PERSON_SUMMARIES = {
  added: (name: string) => `Added "${name}" to the people of the project`,
  renamed: (before: string, after: string) => `Renamed "${before}" to "${after}"`,
  changed: (name: string) => `Changed the details of "${name}"`,
  removed: (name: string) => `Removed "${name}" from the people of the project`,
} as const;

const notBuilt = (op: string): OpError => new OpError('incompatible', `people: ${op} is not built yet`, {}, 'This build registers the operation and its rules; its body is not written.');

defineOp({
  name: 'add_person',
  version: 1,
  description: `Add a person to the project so that titles can show their name ({name:<personId>}) and their age at the time a picture was taken ({age:<personId>}, {age:<personId>:words}, {age:<personId>:en}). A person is a name, an optional birth date and an optional Hebrew word choice (m = «בן», f = «בת»); nothing else is kept. Names are unique in a project; at most ${MAX_PEOPLE} people. The birth date stays inside the project file on this machine: a connected agent reads names only unless the owner granted it birth dates, and a credential without that grant is refused when it gives birthDate or form.`,
  args: AddPersonArgs,
  apply() { throw notBuilt('add_person'); },
});
defineOp({
  name: 'update_person',
  version: 1,
  description: 'Change a person: the name (titles follow, they name the person by id), the birth date (null removes it) and the Hebrew word choice (null removes it). Age fields over dated pictures follow at once. A credential without the grant for birth dates may change the name only.',
  args: UpdatePersonArgs,
  apply() { throw notBuilt('update_person'); },
});
defineOp({
  name: 'remove_person',
  version: 1,
  description: 'Remove a person from the project. Refused while a title (or a format\'s wording of one) holds a field for them; the titles are listed. Make those titles plain text first, or delete the fields.',
  args: RemovePersonArgs,
  apply() { throw notBuilt('remove_person'); },
});
