/** focusNow / focusIn: the focus is given synchronously and only to something that is in the page. No DOM in the unit tests: stand-ins. */
import { describe, expect, it } from 'vitest';
import { focusIn, focusNow } from './focus.ts';

const el = (log: string[], name: string, isConnected = true) => ({ isConnected, focus: (o?: FocusOptions) => log.push(`${name}${o?.preventScroll ? ':noscroll' : ''}`) });

describe('focusNow', () => {
  it('focuses a connected element before it returns, and says so', () => {
    const log: string[] = [];
    expect(focusNow(el(log, 'a'))).toBe(true);
    expect(log).toEqual(['a']);
  });
  it('passes the options on (preventScroll)', () => {
    const log: string[] = [];
    focusNow(el(log, 'a'), { preventScroll: true });
    expect(log).toEqual(['a:noscroll']);
  });
  it('does nothing for null, undefined or an element that left the page', () => {
    const log: string[] = [];
    expect(focusNow(null)).toBe(false);
    expect(focusNow(undefined)).toBe(false);
    expect(focusNow(el(log, 'gone', false))).toBe(false);
    expect(log).toEqual([]);
  });
});

describe('focusIn', () => {
  const root = (found: Record<string, ReturnType<typeof el>>) => ({ querySelector: (s: string) => found[s] ?? null }) as unknown as ParentNode;
  it('focuses the first selector that is found, in order, and no other', () => {
    const log: string[] = [];
    expect(focusIn(root({ '.b': el(log, 'b'), '.c': el(log, 'c') }), '.a', '.b', '.c')).toBe(true);
    expect(log).toEqual(['b']);
  });
  it('returns false and focuses nothing when no selector is found or there is no root', () => {
    expect(focusIn(root({}), '.a')).toBe(false);
    expect(focusIn(null, '.a')).toBe(false);
  });
});
