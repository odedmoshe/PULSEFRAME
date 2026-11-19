/**
 * Word tables of the command bar are looked up by what the owner typed. A plain object literal would answer for its
 * prototype too («constructor», «__proto__», «toString» find Object.prototype members), so every table is built here
 * with a null prototype: a key is found only when the table lists it.
 */
export function dict<V>(entries: Record<string, V>): Readonly<Record<string, V>> {
  const out = Object.create(null) as Record<string, V>;
  for (const k of Object.keys(entries)) out[k] = entries[k]!;
  return Object.freeze(out);
}
