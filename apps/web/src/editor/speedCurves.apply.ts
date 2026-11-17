/**
 * Applying a speed curve from the inspector, one action at a time. The op keeps the clip's id on the FIRST part of the result,
 * so a second apply with the same clip id (a double-click, or another tile right after) would put a whole new curve inside
 * that first part. This guard takes one action while a commit is on its way, and none while the timeline selection is still
 * exactly the parts the last curve made; choosing a clip (or undoing) lifts it.
 *
 * A curve of ONE part (Smooth ramp, a hand-made curve of two points) leaves the clip whole, with the same id and the same
 * selection as before, so there is no first part to protect and nothing to tell "applied" from "undone" by: it is not held.
 * Another curve on that clip replaces its speed over the same stretch of the source (the op reads the source shown now).
 */
import type { OpCall } from '@pulseframe/core';
import { sameIds, singleFlight } from './oneAtATime.ts';

export interface CurveHost {
  commit(ops: OpCall[], label?: string): Promise<{ results: { output?: Record<string, any> }[] } | null>;
  select(id: string, mode?: 'replace' | 'toggle'): void;
  /** The timeline selection as it is now. */
  selection(): readonly string[];
  /** Whether the clip is in the document as it is now. */
  hasClip(id: string): boolean;
}
export type CurveOutcome =
  | { kind: 'applied'; partIds: string[] }
  | { kind: 'busy' } // another apply is still on its way: nothing was sent
  | { kind: 'repeat' } // the parts of the curve just applied are still selected: nothing was sent
  | { kind: 'refused' }; // the op was refused or made no parts; the editor reports why

/**
 * How the given clips look now, as one string (a clip that is gone counts as null). The status line under the tiles speaks of
 * the clips a curve made; it is dropped once they no longer look as they did, and kept through edits elsewhere.
 */
export const clipsLook = (clipOf: (id: string) => unknown, ids: readonly string[]) => JSON.stringify(ids.map((id) => clipOf(id) ?? null));

export function curveApplier(host: CurveHost) {
  const flight = singleFlight();
  /** The parts of the last curve applied here, when it made more than one. */
  let lastParts: string[] | null = null;
  /** Some of them have left the document since (an undo, usually). */
  let partsGone = false;
  const selectAll = (ids: readonly string[]) => { host.select(ids[0]!); for (const id of ids.slice(1)) host.select(id, 'toggle'); };
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
        selectAll(ids);
        lastParts = ids.length > 1 ? ids : null;
        partsGone = false;
        return { kind: 'applied', partIds: ids };
      });
      return done.dropped ? { kind: 'busy' } : done.value;
    },
    /**
     * Call when the document has changed. An undo takes the parts away and the editor drops them from the selection; a redo
     * brings them back but selects nothing, which would leave the first part (it kept the clip's id) alone in the inspector
     * with the tiles live. So when the parts return and that first part is all that is selected, they are selected again,
     * as the apply left them. Returns 'gone' or 'back' when that happened, for the status line; otherwise null.
     */
    documentChanged(): 'gone' | 'back' | null {
      if (!lastParts) return null;
      if (!lastParts.every((id) => host.hasClip(id))) { const first = !partsGone; partsGone = true; return first ? 'gone' : null; }
      if (!partsGone) return null;
      partsGone = false;
      if (!sameIds(host.selection(), [lastParts[0]!])) return null;
      selectAll(lastParts);
      return 'back';
    },
  };
}
