/**
 * Mount point of the rail (docs/design/UX_REDESIGN.md §4.3): the asset and catalogue categories at the start edge.
 * Empty until the chrome worker (W1) builds it. The shell (ds/shell.css) places this element in the `rail` area and gives
 * it no room while it has no content; as soon as it renders something, the rail column opens to --pf-rail.
 * Keep the root element and its data-shell-slot: the shell finds the mount by it.
 */
export function Rail() {
  return <div data-shell-slot="rail" />;
}
