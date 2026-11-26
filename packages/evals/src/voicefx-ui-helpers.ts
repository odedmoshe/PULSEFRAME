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

/** A chip's box on the page (getBoundingClientRect, in CSS pixels). */
export interface ChipBox { value?: string; left: number; right: number; top: number; bottom: number }

/**
 * Whether the chips, in their DOM (focus) order, are laid out in reading order. A row that wraps (flex-wrap in a narrow
 * inspector) is read line by line: each next chip lies wholly before-in-reading-direction of the one before on the same line
 * (to its left in a right-to-left row), or starts a line below it. Two boxes are on one line when they overlap vertically.
 */
export function inReadingOrder(chips: readonly ChipBox[], rtl: boolean): boolean {
  return chips.every((c, i) => {
    if (i === 0) return true;
    const p = chips[i - 1]!;
    const sameLine = c.top < p.bottom && c.bottom > p.top;
    if (sameLine) return rtl ? c.right <= p.left : c.left >= p.right;
    return c.top >= p.bottom;
  });
}
