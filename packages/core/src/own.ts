/**
 * Looking something up in an id-keyed record of the project document (assets, sequences, transcripts, analyses,
 * variants, recipeRuns, markers, a variant's overrides, an effect's keyframes) with a key that came from outside:
 * an op argument, a route parameter, a tool input, a stored job input.
 *
 * A plain `record[key]` also answers with what every object inherits. "__proto__" gives Object.prototype itself,
 * "constructor" and "toString" give functions. All of them are truthy, so an `if (!entry) not found` check lets them
 * through, and a write to the "entry" then lands on Object.prototype for the whole process. `own` answers only with
 * what the record itself holds; anything else is `undefined`, which every caller already treats as "not found".
 *
 * Rule: a key that did not come out of the validated document is looked up with `own`, never with `record[key]`.
 * (Ids the document itself holds cannot name an inherited member: validateProject refuses such ids.)
 */
export function own<V>(record: { readonly [key: string]: V } | null | undefined, key: string | null | undefined): V | undefined {
  return record != null && key != null && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** True for an id that names something every plain object inherits ("__proto__", "constructor", "toString", …). No entity may carry one. */
export const isInheritedName = (id: string): boolean => id in Object.prototype;
