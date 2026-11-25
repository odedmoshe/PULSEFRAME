/** The play control before the player holds the project (a proof clicked it too early and nothing happened): disabled with its reason, and Space does nothing. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { playControl } from './playControl.ts';
import { COMMANDS } from './commands.ts';
import { STAGE_STRINGS } from './stage.strings.ts';

let Editor: typeof import('./store.ts').Editor;
beforeAll(async () => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  ({ Editor } = await import('./store.ts'));
});
describe('play before the player holds the project', () => {
  it('the control is disabled, aria-disabled, with the reason as its tooltip, until ready', () => {
    expect(playControl(false, 'reason')).toEqual({ disabled: true, 'aria-disabled': true, title: 'reason' });
    expect(playControl(true, 'reason')).toEqual({});
  });
  it('both languages word the reason', () => {
    for (const l of ['he', 'en'] as const) expect(STAGE_STRINGS[l].playNotReady.length).toBeGreaterThan(10);
  });
  const withPlayer = (doc: unknown) => {
    const e = new Editor();
    const player = { doc, playing: false, play: vi.fn(), pause: vi.fn() };
    (e as unknown as { player: unknown }).player = player;
    return { e, player };
  };
  it('Space (transport.toggle) does not call play while the player has no project, and does once it has', () => {
    const toggle = COMMANDS.find((c) => c.id === 'transport.toggle')!;
    const none = withPlayer(null);
    expect(none.e.playerReady).toBe(false);
    void toggle.run(none.e);
    expect(none.player.play).not.toHaveBeenCalled();
    const held = withPlayer({ id: 'prj' });
    expect(held.e.playerReady).toBe(true);
    void toggle.run(held.e);
    expect(held.player.play).toHaveBeenCalledTimes(1);
  });
});
