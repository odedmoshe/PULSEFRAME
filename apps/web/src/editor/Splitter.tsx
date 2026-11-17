/**
 * Mount point of the splitter between the viewer and the timeline (docs/design/UX_REDESIGN.md §4.1): a grip that is
 * dragged or moved with the arrow keys, role=separator with aria-valuenow, its height remembered in this browser.
 * Empty until it is built. The shell (ds/shell.css) places this element in the `split` area and gives it no room while it
 * has no content; as soon as it renders something, the row opens to --pf-splitter. The splitter resizes the timeline by
 * setting the --pf-shell-tl custom property on the shell element (`.app`, this element's parent).
 * Keep the root element and its data-shell-slot: the shell finds the mount by it.
 */
export function Splitter() {
  return <div data-shell-slot="splitter" />;
}
