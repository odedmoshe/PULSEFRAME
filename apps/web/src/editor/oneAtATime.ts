/**
 * One action at a time. A control that commits an edit must not start a second one while the first is still on its way:
 * a double-click would otherwise apply the edit twice, the second time to whatever the first one left behind.
 */
export type Flight<R> = { dropped: true } | { dropped: false; value: R };

export function singleFlight() {
  let busy = false;
  return {
    /** True while an action is running; read it when the click arrives, not from a render that may be stale. */
    get busy() { return busy; },
    /** Runs `fn` unless another action is still running, in which case nothing is started and `dropped` is true. */
    async run<R>(fn: () => Promise<R>): Promise<Flight<R>> {
      if (busy) return { dropped: true };
      busy = true;
      try { return { dropped: false, value: await fn() }; } finally { busy = false; }
    },
  };
}

/** The same ids, in any order. */
export const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
