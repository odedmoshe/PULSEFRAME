/** Roving focus inside a group of tiles laid out in a wrapping grid (the ARIA radio-group pattern: one Tab stop, arrows move within). */
export function nextTileIndex(key: string, index: number, count: number, columns: number, rtl: boolean): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case forward: return Math.min(last, index + 1);
    case back: return Math.max(0, index - 1);
    case 'ArrowDown': return Math.min(last, index + Math.max(1, columns));
    case 'ArrowUp': return Math.max(0, index - Math.max(1, columns));
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}
/** The one tile that is a Tab stop: the chosen one, else the first. */
export function tabStopIndex(ids: readonly string[], value: string | null): number {
  const i = value ? ids.indexOf(value) : -1;
  return i < 0 ? 0 : i;
}
