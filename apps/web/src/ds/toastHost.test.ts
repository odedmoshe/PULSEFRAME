import { describe, expect, it } from 'vitest';
import { createHostStack } from './toastHost.ts';

describe('toast host stack', () => {
  it('the page holds the region until a modal claims it; the newest modal wins; closing in any order gives it back', () => {
    const s = createHostStack<string>();
    let changes = 0;
    const off = s.subscribe(() => { changes++; });
    expect(s.current()).toBeNull();
    const a = s.claim('dialog-a');
    expect(s.current()).toBe('dialog-a');
    const b = s.claim('dialog-b'); // a dialog opened from another one
    expect(s.current()).toBe('dialog-b');
    a(); // the lower one closes first
    expect(s.current()).toBe('dialog-b');
    b();
    expect(s.current()).toBeNull();
    b(); // releasing twice changes nothing
    expect(changes).toBe(4);
    off();
    s.claim('dialog-c');
    expect(changes).toBe(4);
  });
  it('the same element claimed twice (a re-render) is released one claim at a time', () => {
    const s = createHostStack<string>();
    const r1 = s.claim('x'), r2 = s.claim('x');
    r1();
    expect(s.current()).toBe('x');
    r2();
    expect(s.current()).toBeNull();
  });
});
