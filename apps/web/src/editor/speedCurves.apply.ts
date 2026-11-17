/**
 * Applying a speed curve from the inspector, one action at a time. The op keeps the clip's id on the FIRST part of the result,
 * so a second apply with the same clip id (a double-click, or another tile right after) would put a whole new curve inside
 * that first part. This guard takes one action while a commit is on its way, and none while the timeline selection is still
 * exactly the parts the last curve made; choosing a clip (or undoing) lifts it.
 */
import type { OpCall } from '@pulseframe/core';
import { sameIds, singleFlight } from './oneAtATime.ts';

export interface CurveHost {
  commit(ops: OpCall[], label?: string): Promise<{ results: { output?: Record<string, any> }[] } | null>;
  select(id: string, mode?: 'replace' | 'toggle'): void;
  /** The timeline selection as it is now. */
  selection(): readonly string[];
}
export type CurveOutcome =
  | { kind: 'applied'; partIds: string[] }
  | { kind: 'busy' } // another apply is still on its way: nothing was sent
  | { kind: 'repeat' } // the parts of the curve just applied are still selected: nothing was sent
  | { kind: 'refused' }; // the op was refused or made no parts; the editor reports why

export function curveApplier(host: CurveHost) {
  const flight = singleFlight();
  let lastParts: string[] | null = null;
  const repeat = () => !!lastParts && sameIds(host.selection(), lastParts);
  return {
    get busy() { return flight.busy; },
    /** True while a second curve would land on the first part of the curve just applied. */
    repeat,
    async apply(clipId: string, args: Record<string, unknown>, label: string): Promise<CurveOutcome> {
      if (flight.busy) return { kind: 'busy' };
      if (repeat()) return { kind: 'repeat' };
      const done = await flight.run(async (): Promise<CurveOutcome> => {
        const r = await host.commit([{ op: 'apply_speed_curve', args: { clipId, ...args } }], label);
        const ids = (r?.results[0]?.output as { partClipIds?: string[] } | undefined)?.partClipIds;
        if (!ids?.length) return { kind: 'refused' };
        host.select(ids[0]!);
        for (const id of ids.slice(1)) host.select(id, 'toggle');
        lastParts = ids;
        return { kind: 'applied', partIds: ids };
      });
      return done.dropped ? { kind: 'busy' } : done.value;
    },
  };
}
