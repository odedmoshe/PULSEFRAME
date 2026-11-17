/**
 * Mount point of the status bar (docs/design/UX_REDESIGN.md §4.8): format, duration, running jobs, the flash check.
 * Empty until the chrome worker (W1) builds it. The shell (ds/shell.css) places this element in the `status` area and gives
 * it no room while it has no content; as soon as it renders something, the row opens to --pf-statusbar.
 * Keep the root element and its data-shell-slot: the shell finds the mount by it.
 */
export function StatusBar() {
  return <div data-shell-slot="status" />;
}
