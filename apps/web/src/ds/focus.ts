/**
 * Focus helpers for the one rule behind two defects of 2026-11-26: the focus is never given in a LATER task (setTimeout,
 * requestAnimationFrame), because between the surface closing and the timer the focus is on the page body (a key typed then goes to
 * the page), and a late focus can pull the focus away from a field the person has already moved to (one typed letter is lost).
 *  - the element to go back to is already in the page: focusNow(el), THEN close the surface, in the same task (craft: closeSurface);
 *  - the element exists only after the next render: record the intent in a ref and focus in a layout effect of that commit
 *    (TemplateDialog: focusStep). Read the element with focusIn() there.
 * A source-level test (deferredFocus.test.ts) keeps a deferred focus() out of the tree.
 */
export type FocusTarget = { isConnected: boolean; focus(options?: FocusOptions): void };

/** Focus `el` now if it is (still) in the page. True when the focus was given. null/undefined/detached: nothing happens. */
export function focusNow(el: FocusTarget | null | undefined, options?: FocusOptions): boolean {
  if (!el || !el.isConnected) return false;
  el.focus(options);
  return true;
}

/** The first element of `selectors` (in order) found under `root`, focused now; false when none is there. */
export function focusIn(root: ParentNode | null | undefined, ...selectors: string[]): boolean {
  if (!root) return false;
  for (const s of selectors) {
    const el = root.querySelector<HTMLElement>(s);
    if (el) return focusNow(el);
  }
  return false;
}
