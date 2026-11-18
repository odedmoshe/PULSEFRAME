import { describe, expect, it } from 'vitest';
import {
  MAX_TOASTS, orderMenu, placeTip, clamp, clampPercent, decimalsOf, dismissToast, focusOrder, initialFocus, isModified, keyframeGlyph, menuKey, navStep, parseTyped, progressFillSide,
  pushToast, ringDash, rovingNext, rovingTabStop, scrubKey, scrubValue, sliderDir, sliderGeometry, sliderKey, sliderPointerValue, snap, switchThumbSide, tileFace,
  tileInteractive, timerLeft, trapTarget, type ScrubSpec, type ToastItem,
} from './logic.ts';

const spec: ScrubSpec = { min: 0, max: 100, step: 1 };

describe('roving index (Tabs, Seg, ModeBar)', () => {
  it('follows the reading direction: in RTL the right arrow goes to the previous item', () => {
    expect(navStep('ArrowRight', 'ltr')).toBe(1);
    expect(navStep('ArrowRight', 'rtl')).toBe(-1);
    expect(navStep('ArrowLeft', 'rtl')).toBe(1);
    expect(navStep('ArrowLeft', 'ltr')).toBe(-1);
  });
  it('vertical lists use up and down in both directions and ignore left and right', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(navStep('ArrowDown', dir, 'vertical')).toBe(1);
      expect(navStep('ArrowUp', dir, 'vertical')).toBe(-1);
      expect(navStep('ArrowLeft', dir, 'vertical')).toBeNull();
    }
  });
  it('wraps, and skips disabled items', () => {
    const o = { count: 4, dir: 'ltr' as const, disabled: [false, true, false, false] };
    expect(rovingNext(0, 'ArrowRight', o)).toBe(2);
    expect(rovingNext(3, 'ArrowRight', o)).toBe(0);
    expect(rovingNext(0, 'ArrowLeft', o)).toBe(3);
    expect(rovingNext(2, 'ArrowLeft', o)).toBe(0);
    expect(rovingNext(0, 'ArrowRight', { ...o, wrap: false, disabled: [false, true, true, true] })).toBeNull();
  });
  it('Home and End land on the first and last enabled item', () => {
    const o = { count: 5, dir: 'rtl' as const, disabled: [true, false, false, false, true] };
    expect(rovingNext(2, 'Home', o)).toBe(1);
    expect(rovingNext(2, 'End', o)).toBe(3);
  });
  it('does nothing for other keys, an empty list or a list of disabled items', () => {
    expect(rovingNext(0, 'a', { count: 3, dir: 'ltr' })).toBeNull();
    expect(rovingNext(0, 'ArrowRight', { count: 0, dir: 'ltr' })).toBeNull();
    expect(rovingNext(0, 'Home', { count: 2, dir: 'ltr', disabled: [true, true] })).toBeNull();
  });
  it('exactly one tab stop: the active item, or the first enabled one when the active is disabled or out of range', () => {
    expect(rovingTabStop(2, 4)).toBe(2);
    expect(rovingTabStop(2, 4, [false, false, true, false])).toBe(0);
    expect(rovingTabStop(9, 4)).toBe(0);
    expect(rovingTabStop(0, 2, [true, true])).toBe(-1);
  });
});

describe('scrub arithmetic', () => {
  it('dragging right increases, left decreases, 4px per step by default', () => {
    expect(scrubValue(50, 8, spec)).toBe(52);
    expect(scrubValue(50, -8, spec)).toBe(48);
    expect(scrubValue(50, 0, spec)).toBe(50);
  });
  it('Shift is coarse and Alt is fine; both clamp to the range', () => {
    expect(scrubValue(50, 8, spec, { shift: true })).toBe(70);
    expect(scrubValue(50, 8, spec, { alt: true })).toBeCloseTo(50.2, 5);
    expect(scrubValue(95, 400, spec)).toBe(100);
    expect(scrubValue(5, -400, spec)).toBe(0);
  });
  it('keeps decimals exact (no float noise) on a 0.1 grid', () => {
    const s: ScrubSpec = { min: 0, max: 2, step: 0.1 };
    expect(decimalsOf(0.1)).toBe(1);
    expect(snap(0.1 + 0.2, s)).toBe(0.3);
    expect(scrubValue(0.5, 12, s)).toBe(0.8);
    expect(scrubKey(0.7, 'ArrowUp', s)).toBe(0.8);
  });
  it('arrows step by one, Shift by ten, Home/End jump; other keys are not handled', () => {
    expect(scrubKey(10, 'ArrowUp', spec)).toBe(11);
    expect(scrubKey(10, 'ArrowRight', spec)).toBe(11);
    expect(scrubKey(10, 'ArrowDown', spec, true)).toBe(0);
    expect(scrubKey(95, 'ArrowUp', spec, true)).toBe(100);
    expect(scrubKey(10, 'Home', spec)).toBe(0);
    expect(scrubKey(10, 'End', spec)).toBe(100);
    expect(scrubKey(10, 'x', spec)).toBeNull();
  });
  it('typed values accept a comma, the Unicode minus and a unit, snap and clamp; garbage is refused', () => {
    const s: ScrubSpec = { min: -24, max: 12, step: 0.5 };
    expect(parseTyped('3,5', s)).toBe(3.5);
    expect(parseTyped('−9 dB', s)).toBe(-9);
    expect(parseTyped(' 0.5 ש׳', { min: 0, max: 10, step: 0.1 })).toBe(0.5);
    expect(parseTyped('99', s)).toBe(12);
    expect(parseTyped('abc', s)).toBeNull();
    expect(parseTyped('', s)).toBeNull();
  });
  it('a value is "modified" when it differs from the default', () => {
    expect(isModified(100, 100)).toBe(false);
    expect(isModified(99.5, 100)).toBe(true);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe('slider direction: spatial is LTR, magnitude follows the text', () => {
  it('chooses the axis direction by kind', () => {
    expect(sliderDir('spatial', 'rtl')).toBe('ltr');
    expect(sliderDir('magnitude', 'rtl')).toBe('rtl');
    expect(sliderDir('magnitude', 'ltr')).toBe('ltr');
  });
  it('a magnitude fill starts at the right in RTL and at the left in LTR', () => {
    const rtl = sliderGeometry(25, 0, 100, 'magnitude', 'rtl');
    expect(rtl).toMatchObject({ from: 'right', fillStart: 0.75, fillEnd: 1 });
    const ltr = sliderGeometry(25, 0, 100, 'magnitude', 'ltr');
    expect(ltr).toMatchObject({ from: 'left', fillStart: 0, fillEnd: 0.25 });
  });
  it('a spatial fill never flips, in either language', () => {
    expect(sliderGeometry(25, 0, 100, 'spatial', 'rtl')).toEqual(sliderGeometry(25, 0, 100, 'spatial', 'ltr'));
  });
  it('bipolar fills from the centre tick toward the value', () => {
    expect(sliderGeometry(-50, -100, 100, 'spatial', 'rtl', true)).toMatchObject({ fillStart: 0.25, fillEnd: 0.5 });
    expect(sliderGeometry(50, -100, 100, 'spatial', 'ltr', true)).toMatchObject({ fillStart: 0.5, fillEnd: 0.75 });
    // a bipolar MAGNITUDE slider mirrors with the text
    expect(sliderGeometry(50, -100, 100, 'magnitude', 'rtl', true)).toMatchObject({ fillStart: 0.25, fillEnd: 0.5 });
  });
  it('pointer positions map to the value the person sees', () => {
    const s: ScrubSpec = { min: 0, max: 100, step: 1 };
    expect(sliderPointerValue(25, 0, 100, 0, 100, 'spatial', 'rtl', s)).toBe(25);
    expect(sliderPointerValue(25, 0, 100, 0, 100, 'magnitude', 'rtl', s)).toBe(75);
    expect(sliderPointerValue(-30, 0, 100, 0, 100, 'magnitude', 'ltr', s)).toBe(0);
    expect(sliderPointerValue(500, 0, 100, 0, 100, 'magnitude', 'ltr', s)).toBe(100);
    expect(sliderPointerValue(5, 0, 0, 0, 100, 'magnitude', 'ltr', s)).toBe(0);
  });
  it('arrow keys move the knob the way the arrow points', () => {
    expect(sliderKey(50, 'ArrowRight', 'spatial', 'rtl', spec)).toBe(51);
    expect(sliderKey(50, 'ArrowRight', 'magnitude', 'rtl', spec)).toBe(49);
    expect(sliderKey(50, 'ArrowLeft', 'magnitude', 'rtl', spec)).toBe(51);
    expect(sliderKey(50, 'ArrowUp', 'magnitude', 'rtl', spec)).toBe(51);
    expect(sliderKey(50, 'ArrowRight', 'magnitude', 'ltr', spec, true)).toBe(60);
    expect(sliderKey(50, 'PageDown', 'spatial', 'ltr', spec)).toBe(40);
    expect(sliderKey(50, 'Home', 'spatial', 'ltr', spec)).toBe(0);
    expect(sliderKey(50, 'q', 'spatial', 'ltr', spec)).toBeNull();
  });
  it('progress fills from the reading start; a switch thumb goes to the end side', () => {
    expect(progressFillSide('rtl')).toBe('right');
    expect(progressFillSide('ltr')).toBe('left');
    expect(switchThumbSide(true, 'ltr')).toBe('right');
    expect(switchThumbSide(true, 'rtl')).toBe('left');
    expect(switchThumbSide(false, 'rtl')).toBe('right');
  });
  it('percent and ring arithmetic are clamped', () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(ringDash(50, 10).dash).toBeCloseTo(Math.PI * 10, 6);
  });
});

describe('focus-trap order', () => {
  const items = [{ tabIndex: 0 }, { tabIndex: -1 }, { tabIndex: 0, disabled: true }, { tabIndex: 2 }, { tabIndex: 1 }, { tabIndex: 0, hidden: true }, { tabIndex: 0 }];
  it('orders positive tabindex first (ascending), then document order, and drops -1, disabled and hidden', () => {
    expect(focusOrder(items)).toEqual([4, 3, 0, 6]);
  });
  it('Tab on the last wraps to the first and Shift+Tab on the first wraps to the last; the middle is left to the browser', () => {
    expect(trapTarget(items, 6, false)).toBe(4);
    expect(trapTarget(items, 4, true)).toBe(6);
    expect(trapTarget(items, 3, false)).toBeNull();
    expect(trapTarget(items, 0, true)).toBeNull();
  });
  it('focus outside the dialog is pulled in: first on Tab, last on Shift+Tab', () => {
    expect(trapTarget(items, -1, false)).toBe(4);
    expect(trapTarget(items, -1, true)).toBe(6);
  });
  it('an empty dialog keeps focus on the container', () => {
    expect(trapTarget([{ tabIndex: -1 }], -1, false)).toBe(-1);
    expect(initialFocus([])).toBe(-1);
  });
  it('opens on the autofocus item, else the first focusable', () => {
    expect(initialFocus([{ tabIndex: 0 }, { tabIndex: 0, autofocus: true }])).toBe(1);
    expect(initialFocus([{ tabIndex: -1 }, { tabIndex: 0 }])).toBe(1);
  });
});

describe('menu keys', () => {
  const labels = ['Cut', 'Copy', 'Delete'];
  it('moves with up and down, activates with Enter, closes with Escape', () => {
    expect(menuKey('ArrowDown', 0, labels, 'ltr')).toEqual({ type: 'move', to: 1 });
    expect(menuKey('ArrowUp', 0, labels, 'ltr')).toEqual({ type: 'move', to: 2 });
    expect(menuKey('Enter', 1, labels, 'ltr')).toEqual({ type: 'activate' });
    expect(menuKey('Escape', 1, labels, 'ltr')).toEqual({ type: 'close' });
  });
  it('the submenu arrow follows the reading direction', () => {
    expect(menuKey('ArrowRight', 0, labels, 'ltr')).toEqual({ type: 'open-sub' });
    expect(menuKey('ArrowLeft', 0, labels, 'rtl')).toEqual({ type: 'open-sub' });
    expect(menuKey('ArrowRight', 0, labels, 'rtl')).toEqual({ type: 'close-sub' });
  });
  it('typeahead matches the start of a label and skips disabled items', () => {
    expect(menuKey('d', 0, labels, 'ltr')).toEqual({ type: 'type', to: 2 });
    expect(menuKey('c', 0, labels, 'ltr')).toEqual({ type: 'type', to: 1 });
    expect(menuKey('c', 2, labels, 'ltr', [true, true, false])).toBeNull();
  });
});

describe('toast queue', () => {
  const t = (id: string): ToastItem => ({ id, kind: 'undo', title: id, ttl: 1000 });
  it('keeps at most three, newest last, dropping the oldest', () => {
    let q: ToastItem[] = [];
    for (const id of ['a', 'b', 'c', 'd']) q = pushToast(q, t(id));
    expect(MAX_TOASTS).toBe(3);
    expect(q.map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });
  it('pushing an id that is already shown replaces it, at the end', () => {
    const q = pushToast(pushToast(pushToast([], t('a')), t('b')), { ...t('a'), title: 'again' });
    expect(q.map((x) => x.id)).toEqual(['b', 'a']);
    expect(q[1]!.title).toBe('again');
  });
  it('dismisses by id and counts the timer down', () => {
    expect(dismissToast([t('a'), t('b')], 'a').map((x) => x.id)).toEqual(['b']);
    expect(timerLeft(1000, 250)).toBe(0.75);
    expect(timerLeft(1000, 5000)).toBe(0);
    expect(timerLeft(0, 5000)).toBe(1);
  });
});

describe('tile faces and keyframe glyphs', () => {
  it('unavailable and loading win over everything, held over the animation', () => {
    expect(tileFace({ applied: true, 'hover-playing': true })).toBe('hover-playing');
    expect(tileFace({ applied: true, held: true, 'hover-playing': true })).toBe('held');
    expect(tileFace({ loading: true, held: true })).toBe('loading');
    expect(tileFace({ unavailable: true, loading: true })).toBe('unavailable');
    expect(tileFace({ favourite: true, beat: true })).toBe('idle');
  });
  it('an unavailable or loading tile is not interactive', () => {
    expect(tileInteractive({ unavailable: true })).toBe(false);
    expect(tileInteractive({ loading: true })).toBe(false);
    expect(tileInteractive({ applied: true })).toBe(true);
  });
  it('maps the four keyframe states to their glyph', () => {
    expect(['none', 'animated', 'at-playhead', 'on-beat'].map((s) => keyframeGlyph(s as never))).toEqual(['keyframeHollow', 'keyframeHalf', 'keyframeFull', 'keyframeGold']);
  });
});

describe('menu order and tooltip placement', () => {
  it('puts destructive items last, behind one separator', () => {
    const out = orderMenu([{ id: 'del', label: 'Delete', danger: true }, { id: 'cut', label: 'Cut' }, { id: 'copy', label: 'Copy' }, { id: 'clear', label: 'Clear', danger: true }]);
    expect(out.map((o) => o.item.id)).toEqual(['cut', 'copy', 'del', 'clear']);
    expect(out.map((o) => o.separatorBefore)).toEqual([false, false, true, false]);
    expect(orderMenu([{ id: 'x', label: 'x', danger: true }])[0]!.separatorBefore).toBe(false);
  });
  it('places a tip above when it fits, below when it does not, and keeps it inside the viewport', () => {
    const vp = { width: 400, height: 300 };
    expect(placeTip({ left: 180, top: 100, width: 40, height: 30 }, { width: 80, height: 24 }, vp)).toEqual({ left: 160, top: 68, side: 'top' });
    expect(placeTip({ left: 180, top: 10, width: 40, height: 30 }, { width: 80, height: 24 }, vp).side).toBe('bottom');
    expect(placeTip({ left: 0, top: 100, width: 10, height: 10 }, { width: 80, height: 24 }, vp).left).toBe(8);
    expect(placeTip({ left: 395, top: 100, width: 10, height: 10 }, { width: 80, height: 24 }, vp).left).toBe(312);
  });
});
