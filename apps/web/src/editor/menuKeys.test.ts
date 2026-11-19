import { describe, expect, it } from 'vitest';
import { menuTarget } from './menuKeys.ts';

describe('menuTarget', () => {
  it('moves with the arrows and wraps at both ends', () => {
    expect(menuTarget('ArrowDown', 0, 3)).toBe(1);
    expect(menuTarget('ArrowDown', 2, 3)).toBe(0);
    expect(menuTarget('ArrowUp', 0, 3)).toBe(2);
    expect(menuTarget('Home', 2, 3)).toBe(0);
    expect(menuTarget('End', 0, 3)).toBe(2);
  });
  it('ignores other keys and an empty menu', () => {
    expect(menuTarget('a', 0, 3)).toBeNull();
    expect(menuTarget('ArrowDown', -1, 0)).toBeNull();
  });
  it('from no focused item the first ArrowDown lands on the first item', () => {
    expect(menuTarget('ArrowDown', -1, 3)).toBe(0);
  });
});
