/** Arrow-key movement for a role=menu: Up/Down wrap, Home/End jump. Returns the item to focus, or null when the key is not a movement. */
export function menuTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** The keydown handler of a menu element: moves focus between its enabled menu items. Tab is left to the caller (it closes the menu). */
export function onMenuKeyDown(e: { key: string; preventDefault(): void; currentTarget: Element }) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')];
  const to = menuTarget(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
  if (to == null) return;
  e.preventDefault();
  items[to]!.focus();
}
