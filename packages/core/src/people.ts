/**
 * People named in titles (ADR-0021, people section): the project's small list of family members, and where the words of the
 * `{name:<id>}` and `{age:<id>}` fields come from. The owner approved keeping names and birth dates inside the project file
 * (so preview, stills and export agree) on conditions that this contract fixes; the server side of them is
 * apps/server/src/peoplePrivacy.ts.
 *
 * WHAT A PERSON IS: an id, a name, an optional birth date, an optional word choice for the Hebrew age wording (schema.ts
 * PersonSchema). Nothing else is stored about a person, ever: no picture, no face data, no recognition, no place.
 *
 * RULES (the lead's contract; the bodies marked W1 are the worker's):
 * - The people source of a document (documentPeople) and the titles that use a person (fieldUsersOfPerson) are in fields.ts.
 * - `doc.people` is optional and absent until the first person exists. Read it through peopleOf / personOf (own-property
 *   lookups: an id that names an Object.prototype member is nobody). When the last person is removed the key is removed too.
 * - Two people may not have the same name, compared by personNameKey (NFC, trimmed, inner spaces single, lower case).
 * - A field that names a person who is not in the project has no words (reason unknown_person); it is not a validation
 *   issue (validate.ts says why).
 * - Nothing derived from a birth date is ever stored: no stored age, no birthday event name. An age is computed when a
 *   frame is evaluated, from the birth date and the capture day of the picture under the title (fields.ts, ageWords.ts).
 *   "Make it plain text" (fields.ts freezeOps) is the one way an age becomes stored text, and it is the owner's act.
 * - No operation summary, refusal message, refusal detail or validation message holds a birth date (peopleOps.ts).
 */
import type { Person, ProjectDocument } from './schema.ts';

const NOBODY: Readonly<Record<string, Person>> = Object.freeze({});
/** The people of a document, by id ({} for a document without any). Look a person up with personOf, not by indexing this. */
export const peopleOf = (doc: ProjectDocument): Readonly<Record<string, Person>> => doc.people ?? NOBODY;
/** The person with this id, or null. An own-property lookup. */
export function personOf(doc: ProjectDocument, personId: string): Person | null {
  const people = doc.people;
  return people && Object.hasOwn(people, personId) ? people[personId]! : null;
}
/** One spelling of a name for telling whether two people are called the same: Unicode NFC, trimmed, inner spaces single, lower case. */
export const personNameKey = (name: string): string => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
/** The name as it is stored: Unicode NFC, without spaces around it. */
export const storedPersonName = (name: string): string => name.normalize('NFC').trim();
