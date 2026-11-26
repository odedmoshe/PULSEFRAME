/**
 * Pure logic of the design-system primitives: keyboard maps, roving index, scrub arithmetic, slider direction, focus-trap
 * order, the toast queue. The repository has no DOM test environment, so everything a test must pin lives here, free of
 * React and of the DOM. The components only wire these functions to events.
 */

export type Dir = 'ltr' | 'rtl';
export type Orientation = 'horizontal' | 'vertical';

/* ------------------------------------------------------------------ roving tabindex (Tabs, Seg, ModeBar, rail, tile grids) */

/** Key names exactly as `KeyboardEvent.key` reports them. */
export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';
export const NAV_KEYS: readonly NavKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
export const isNavKey = (key: string): key is NavKey => (NAV_KEYS as readonly string[]).includes(key);

/** +1 = toward the end of the list, -1 = toward the start, 'first'/'last' for Home/End, null = not a navigation key here.
 *  Horizontal lists follow the reading direction: in RTL the start is on the right, so ArrowLeft goes to the NEXT item. */
export function navStep(key: string, dir: Dir, orientation: Orientation = 'horizontal'): 1 | -1 | 'first' | 'last' | null {
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (orientation === 'vertical') return key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : null;
  if (key === 'ArrowRight') return dir === 'rtl' ? -1 : 1;
  if (key === 'ArrowLeft') return dir === 'rtl' ? 1 : -1;
  return null;
}

/** The index the roving focus moves to, or null when the key does nothing. Disabled items are skipped; the list wraps. */
export function rovingNext(current: number, key: string, opts: { count: number; dir: Dir; orientation?: Orientation; disabled?: readonly boolean[]; wrap?: boolean }): number | null {
  const { count, dir, orientation = 'horizontal', disabled = [], wrap = true } = opts;
  const step = navStep(key, dir, orientation);
  if (step === null || count <= 0) return null;
  const ok = (i: number) => i >= 0 && i < count && !disabled[i];
  if (step === 'first') { for (let i = 0; i < count; i++) if (ok(i)) return i; return null; }
  if (step === 'last') { for (let i = count - 1; i >= 0; i--) if (ok(i)) return i; return null; }
  let i = current;
  for (let n = 0; n < count; n++) {
    i += step;
    if (i < 0 || i >= count) { if (!wrap) return null; i = (i + count) % count; }
    if (ok(i)) return i;
  }
  return null;
}

/** Which item carries tabindex=0: the active one if it is enabled, else the first enabled (so the group is always reachable). */
export function rovingTabStop(active: number, count: number, disabled: readonly boolean[] = []): number {
  if (active >= 0 && active < count && !disabled[active]) return active;
  for (let i = 0; i < count; i++) if (!disabled[i]) return i;
  return -1;
}

/** Tabs activate on focus move (automatic activation); tile grids and menus only move focus. Enter and Space always activate. */
export const isActivateKey = (key: string) => key === 'Enter' || key === ' ';

/* ------------------------------------------------------------------ scrub field */

export interface ScrubSpec { min: number; max: number; step: number; /** decimals shown and kept */ decimals?: number; /** pixels of drag per step */ pxPerStep?: number }
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** Rounds to `decimals` without float noise (0.1 + 0.2 stays 0.3). */
export const fix = (v: number, decimals: number) => Number(v.toFixed(decimals));
export const decimalsOf = (step: number) => { const s = String(step); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
/** Snap to the step grid anchored at `min`, then clamp. */
export function snap(v: number, { min, max, step, decimals = decimalsOf(step) }: ScrubSpec): number {
  return fix(clamp(min + Math.round((v - min) / step) * step, min, max), decimals);
}
/** Value after dragging `dx` pixels from `start`. Dragging toward the end of the screen (right) always increases:
 *  a scrub field is LTR in every language. Shift is coarse (x10), Alt is fine (x0.1 of a step, never below the grid). */
export function scrubValue(start: number, dx: number, spec: ScrubSpec, mods: { shift?: boolean; alt?: boolean } = {}): number {
  const per = spec.pxPerStep ?? 4;
  const mult = mods.shift ? 10 : mods.alt ? 0.1 : 1;
  const raw = start + (dx / per) * spec.step * mult;
  return mods.alt ? fix(clamp(raw, spec.min, spec.max), spec.decimals ?? decimalsOf(spec.step) + 1) : snap(raw, spec);
}
/** Arrow keys: ±step, Shift ±10 steps; Home/End jump to the ends. Returns null when the key is not handled. */
export function scrubKey(value: number, key: string, spec: ScrubSpec, shift = false): number | null {
  const n = shift ? 10 : 1;
  if (key === 'ArrowUp' || key === 'ArrowRight') return snap(value + n * spec.step, spec);
  if (key === 'ArrowDown' || key === 'ArrowLeft') return snap(value - n * spec.step, spec);
  if (key === 'Home') return spec.min;
  if (key === 'End') return spec.max;
  return null;
}
/** Parses what a person typed: accepts a comma as decimal separator, the Unicode minus, a trailing unit and spaces. null = reject. */
export function parseTyped(text: string, spec: ScrubSpec): number | null {
  const t = text.trim().replace(/[−–‒]/g, '-').replace(/,/g, '.').replace(/[^\d.+-]/g, (c) => (c === ' ' ? '' : '\u0000'));
  if (!t || t.includes('\u0000') && !/^[\d.+-]+\u0000+$/.test(t)) return null;
  const num = Number(t.replace(/\u0000/g, ''));
  if (!Number.isFinite(num)) return null;
  return snap(num, spec);
}
/** Alt-click resets to the default. */
export const resetValue = (def: number, spec: ScrubSpec) => snap(def, spec);
export const isModified = (value: number, def: number) => Math.abs(value - def) > 1e-9;

/* ------------------------------------------------------------------ sliders: spatial (always LTR) vs magnitude (follows the text direction) */

export type SliderKind = 'spatial' | 'magnitude';
/** Spatial and time sliders (X, Y, rotation, pan, the speed graph) are LTR in every language. Magnitude sliders (opacity,
 *  volume, intensity) start at the reading-direction start: the left in LTR, the right in RTL. */
export const sliderDir = (kind: SliderKind, textDir: Dir): Dir => (kind === 'spatial' ? 'ltr' : textDir);
export interface SliderGeometry { fraction: number; /** knob position as a fraction measured from the left */ knob: number; /** side the fill starts from */ from: 'left' | 'right'; /** fill covers [start,end] of the track as fractions measured from the left */ fillStart: number; fillEnd: number }
export function sliderGeometry(value: number, min: number, max: number, kind: SliderKind, textDir: Dir, bipolar = false): SliderGeometry {
  const f = max === min ? 0 : clamp((value - min) / (max - min), 0, 1);
  const rtl = sliderDir(kind, textDir) === 'rtl';
  const pos = rtl ? 1 - f : f; // where the knob sits, as a fraction from the left
  if (bipolar) { const c = 0.5; return { fraction: f, knob: pos, from: pos < c ? 'right' : 'left', fillStart: Math.min(pos, c), fillEnd: Math.max(pos, c) }; }
  return { fraction: f, knob: pos, from: rtl ? 'right' : 'left', fillStart: rtl ? pos : 0, fillEnd: rtl ? 1 : pos };
}
/** Pointer position to value: `x` and `left`/`width` are viewport pixels. */
export function sliderPointerValue(x: number, left: number, width: number, min: number, max: number, kind: SliderKind, textDir: Dir, spec: ScrubSpec): number {
  const t = width <= 0 ? 0 : clamp((x - left) / width, 0, 1);
  const f = sliderDir(kind, textDir) === 'rtl' ? 1 - t : t;
  return snap(min + f * (max - min), spec);
}
/** Keys on a slider follow what is SEEN: the arrow that points toward the "more" end increases, in either direction. */
export function sliderKey(value: number, key: string, kind: SliderKind, textDir: Dir, spec: ScrubSpec, shift = false): number | null {
  const n = (shift ? 10 : 1) * spec.step;
  const rtl = sliderDir(kind, textDir) === 'rtl';
  if (key === 'ArrowUp') return snap(value + n, spec);
  if (key === 'ArrowDown') return snap(value - n, spec);
  if (key === 'ArrowRight') return snap(value + (rtl ? -n : n), spec);
  if (key === 'ArrowLeft') return snap(value + (rtl ? n : -n), spec);
  if (key === 'PageUp') return snap(value + 10 * spec.step, spec);
  if (key === 'PageDown') return snap(value - 10 * spec.step, spec);
  if (key === 'Home') return spec.min;
  if (key === 'End') return spec.max;
  return null;
}
/** Progress bars are magnitude displays: they fill from the reading-direction start. */
export const progressFillSide = (textDir: Dir): 'left' | 'right' => (textDir === 'rtl' ? 'right' : 'left');
export const clampPercent = (p: number) => (Number.isFinite(p) ? clamp(Math.round(p), 0, 100) : 0);
/** Ring: stroke-dasharray for a circle of radius r. */
export function ringDash(percent: number, r: number): { circumference: number; dash: number } {
  const circumference = 2 * Math.PI * r;
  return { circumference, dash: circumference * (clampPercent(percent) / 100) };
}
/** A switch's thumb sits at the END of the track when on. The end is the right in LTR and the left in RTL (switches mirror). */
export const switchThumbSide = (on: boolean, textDir: Dir): 'left' | 'right' => (on ? (textDir === 'rtl' ? 'left' : 'right') : (textDir === 'rtl' ? 'right' : 'left'));

/* ------------------------------------------------------------------ focus trap (Sheet/Dialog) */

export interface FocusableInfo { tabIndex: number; disabled?: boolean; hidden?: boolean }
/** Document order, positive tabindex first (ascending), tabindex -1 and disabled/hidden excluded. Returns indexes into `items`. */
export function focusOrder(items: readonly FocusableInfo[]): number[] {
  const ok = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.disabled && !it.hidden && it.tabIndex >= 0);
  const positive = ok.filter(({ it }) => it.tabIndex > 0).sort((a, b) => a.it.tabIndex - b.it.tabIndex || a.i - b.i);
  return [...positive, ...ok.filter(({ it }) => it.tabIndex === 0)].map(({ i }) => i);
}
/** Where Tab / Shift+Tab goes from `active` (an index into `items`, -1 when focus is outside). null = let the browser move focus
 *  (it stays inside the dialog). The trap wraps at both ends and pulls an outside focus back in. */
export function trapTarget(items: readonly FocusableInfo[], active: number, shift: boolean): number | null {
  const order = focusOrder(items);
  if (order.length === 0) return -1; // nothing focusable: keep focus on the container (caller focuses it)
  const pos = order.indexOf(active);
  if (pos < 0) return shift ? order[order.length - 1]! : order[0]!;
  if (!shift && pos === order.length - 1) return order[0]!;
  if (shift && pos === 0) return order[order.length - 1]!;
  return null;
}
/** What gets focus when the dialog opens: the item marked autofocus, else the first focusable, else the container (-1). */
export function initialFocus(items: readonly (FocusableInfo & { autofocus?: boolean })[]): number {
  const order = focusOrder(items);
  const auto = order.find((i) => items[i]!.autofocus);
  return auto ?? order[0] ?? -1;
}

/* ------------------------------------------------------------------ menu */
export type MenuAction = { type: 'move'; to: number } | { type: 'activate' } | { type: 'close' } | { type: 'open-sub' } | { type: 'close-sub' } | { type: 'type'; to: number };
/** Keys of a menu. Items are `labels` (disabled ones skipped). Typeahead matches the start of a label. */
export function menuKey(key: string, active: number, labels: readonly string[], dir: Dir, disabled: readonly boolean[] = [], typed = ''): MenuAction | null {
  if (key === 'Escape' || key === 'Tab') return { type: 'close' };
  if (key === 'Enter' || key === ' ') return { type: 'activate' };
  if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    const to = rovingNext(active, key, { count: labels.length, dir, orientation: 'vertical', disabled });
    return to === null ? null : { type: 'move', to };
  }
  const endKey = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  if (key === endKey) return { type: 'open-sub' };
  if (key === (dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft')) return { type: 'close-sub' };
  if (key.length === 1 && key !== ' ') {
    const q = (typed + key).toLocaleLowerCase();
    const n = labels.length;
    for (let k = 1; k <= n; k++) { const i = (active + k) % n; if (!disabled[i] && labels[i]!.toLocaleLowerCase().startsWith(q)) return { type: 'type', to: i }; }
  }
  return null;
}

/** Items in the order a menu shows them: destructive ones last, set apart by a separator (UX_REDESIGN §3.5). */
export interface MenuItemSpec { id: string; label: string; shortcut?: string; danger?: boolean; disabled?: boolean }
export function orderMenu<T extends MenuItemSpec>(items: readonly T[]): { item: T; separatorBefore: boolean }[] {
  const safe = items.filter((i) => !i.danger), danger = items.filter((i) => i.danger);
  return [...safe.map((item) => ({ item, separatorBefore: false })), ...danger.map((item, i) => ({ item, separatorBefore: i === 0 && safe.length > 0 }))];
}

/** Tooltip placement: above the anchor when it fits, else below; centred on the anchor and kept inside the viewport by `margin`. */
export function placeTip(anchor: { left: number; top: number; width: number; height: number }, tip: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8, gap = 8): { left: number; top: number; side: 'top' | 'bottom' } {
  const fitsAbove = anchor.top - gap - tip.height >= margin;
  const side = fitsAbove ? 'top' : 'bottom';
  const top = side === 'top' ? anchor.top - gap - tip.height : anchor.top + anchor.height + gap;
  const left = clamp(anchor.left + anchor.width / 2 - tip.width / 2, margin, Math.max(margin, viewport.width - margin - tip.width));
  return { left, top, side };
}

/* ------------------------------------------------------------------ toast queue */
export type ToastKind = 'undo' | 'receipt' | 'fix' | 'info';
export interface ToastItem { id: string; kind: ToastKind; title: string; body?: string; /** action label, e.g. "ביטול" */ action?: string; /** ms until it closes itself; 0 keeps it */ ttl: number }
export const MAX_TOASTS = 3;
export const DEFAULT_TTL: Record<ToastKind, number> = { undo: 6000, receipt: 8000, fix: 0, info: 4000 };
/** Newest last; at most MAX_TOASTS visible: pushing a fourth drops the oldest (an undo is never lost silently: it has had its time). */
export function pushToast(queue: readonly ToastItem[], t: ToastItem): ToastItem[] {
  const without = queue.filter((x) => x.id !== t.id);
  return [...without, t].slice(-MAX_TOASTS);
}
export const dismissToast = (queue: readonly ToastItem[], id: string): ToastItem[] => queue.filter((x) => x.id !== id);
/** Fraction of the timer bar left, 0..1. */
export const timerLeft = (ttl: number, elapsed: number) => (ttl <= 0 ? 1 : clamp(1 - elapsed / ttl, 0, 1));
/** Politeness for the live region: errors that block use alert, everything else status. */
export const toastRole = (kind: ToastKind): 'status' | 'alert' => (kind === 'fix' ? 'status' : 'status');

/* ------------------------------------------------------------------ tooltip / tile / property row */
export const TOOLTIP_DELAY_MS = 140;
/** Property row grid: label | control | value | keyframe (UX_REDESIGN §3.5). */
export const PROPERTY_ROW_COLUMNS = '76px minmax(0,1fr) 62px 22px';
export type KeyframeState = 'none' | 'animated' | 'at-playhead' | 'on-beat';
export const keyframeGlyph = (s: KeyframeState): 'keyframeHollow' | 'keyframeHalf' | 'keyframeFull' | 'keyframeGold' =>
  s === 'none' ? 'keyframeHollow' : s === 'animated' ? 'keyframeHalf' : s === 'at-playhead' ? 'keyframeFull' : 'keyframeGold';
/** Every Tile state of the spec. A tile may carry several of these flags; one is the "face" (what the tile shows over its image). */
export type TileState = 'idle' | 'hover-playing' | 'applied' | 'favourite' | 'beat' | 'fits' | 'shortens' | 'held' | 'loading' | 'unavailable';
export const TILE_STATES: readonly TileState[] = ['idle', 'hover-playing', 'applied', 'favourite', 'beat', 'fits', 'shortens', 'held', 'loading', 'unavailable'];
/** Precedence of the face state when several flags are set: unavailable and loading hide everything; held replaces the animation. */
export function tileFace(flags: Partial<Record<TileState, boolean>>): TileState {
  for (const s of ['unavailable', 'loading', 'held', 'hover-playing', 'applied'] as const) if (flags[s]) return s;
  return 'idle';
}
export const tileInteractive = (flags: Partial<Record<TileState, boolean>>) => !flags.unavailable && !flags.loading;
