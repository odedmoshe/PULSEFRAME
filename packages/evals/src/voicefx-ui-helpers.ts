/**
 * Small pieces of voicefx-ui-proof.ts that do not need a browser, kept apart so they can be unit-tested
 * (voicefx-ui-helpers.test.ts): the proof itself starts a server and Chromium on import.
 */

/** What expandAll needs of a Playwright Locator (a Locator satisfies it). */
export interface Clickables {
  count(): Promise<number>;
  first(): { click(): Promise<void> };
}

/**
 * Clicks every element `collapsed` matches, for a selector that stops matching an element once it is clicked (a disclosure
 * button matched by `[aria-expanded=false]`). Always the first match: Playwright's `all()` gives `nth(i)` locators that are
 * resolved again when used, so after the first click the list is one shorter and the last index no longer exists. At most as
 * many clicks as there were matches, so a button that does not open cannot keep the loop going. Returns how many still match
 * afterwards (0 when every one opened).
 */
export async function expandAll(collapsed: Clickables): Promise<number> {
  const n = await collapsed.count();
  for (let i = 0; i < n && (await collapsed.count()) > 0; i++) await collapsed.first().click();
  return collapsed.count();
}

