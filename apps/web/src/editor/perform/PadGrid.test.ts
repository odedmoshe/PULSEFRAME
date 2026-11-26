/**
 * The pad row and the take lane as markup (react-dom/server: Node has no browser): the fixed test ids and the attributes the proof
 * and the accessibility audit read. Interaction (pointer, keys) is the capture's and is tested in capture.test.ts.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MOVES, type Chip, type MoveSpec, type PadBank } from '@pulseframe/core';
import { moveLabel, PadGrid } from './PadGrid.tsx';
import { TakeLane } from './TakeLane.tsx';
import type { PadStatus } from './capture.ts';
import { performT } from './perform.strings.ts';

const punch: MoveSpec = { id: 'move.punch', kind: 'punch', minSeconds: 0.1, scale: 1.2, releaseSeconds: 0.2 };
const sound: MoveSpec = { id: 'move.hit', kind: 'sound', minSeconds: 0.1, source: { sfxId: 'sfx.boom' }, gain: 1 };
const shake: MoveSpec = { id: 'move.shake', kind: 'adjust', minSeconds: 0.1, effects: [{ type: 'motion.shake' }], fadeOutSeconds: 0.2 };
const bank: PadBank = [punch, sound, shake, null, null, null, null, null];
const noop = () => {};
const grid = (statuses: PadStatus[], held = new Set<number>(), keysLive = true) =>
  renderToStaticMarkup(createElement(PadGrid, { bank, statuses, held, lang: 'he', onDown: noop, onUp: noop, onEdit: noop, onAdd: noop, adding: null, keysLive, addLabel: 'הוסיפו לספרייה' }));
const ready: PadStatus = { state: 'ready' };

describe('PadGrid markup', () => {
  const html = grid([ready, { state: 'disabled', reason: 'missing_asset' }, { state: 'disabled', reason: 'needs_gpu' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }], new Set([0]));
  it('is a left-to-right group of eight pads with the fixed test ids', () => {
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('data-testid="perform-pads"');
    expect(html.match(/data-testid="perform-pad"/g)).toHaveLength(8);
    for (let i = 0; i < 8; i++) expect(html).toContain(`data-pad="${i}"`);
  });
  it('a pad is a button with aria-pressed, aria-keyshortcuts, its move id and its state', () => {
    expect(html).toMatch(/<button[^>]*data-testid="perform-pad"[^>]*data-pad="0"[^>]*data-move-id="move.punch"[^>]*data-state="held-down"[^>]*aria-pressed="true"[^>]*aria-keyshortcuts="1"/);
    expect(html).toMatch(/data-pad="3"[^>]*data-move-id=""[^>]*data-state="empty"[^>]*aria-pressed="false"/);
  });
  it('a pad that cannot be used says why in words, with its reason code, and a missing sound offers «הוסיפו לספרייה»', () => {
    expect(html).toContain('data-reason="missing_asset"');
    expect(html).toContain('data-reason="needs_gpu"');
    expect(html).toContain('דורש כרטיס מסך');
    expect(html).toContain('עוד לא בספרייה');
    expect(html).toContain('data-testid="perform-pad-add"');
    expect(html).toContain('הוסיפו לספרייה');
    expect(html).toMatch(/data-pad="1"[^>]*data-state="disabled"[^>]*aria-disabled="true"/);
  });
  it('while multicam owns the digits the pads do not claim the number keys', () => {
    expect(grid([ready, ready, ready, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }], new Set(), false)).not.toContain('aria-keyshortcuts');
  });
  it('a pad hidden by «בלי הבזקים» is an empty slot, out of the tab order and the accessibility tree', () => {
    const h = grid([{ state: 'hidden' }, ready, ready, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }, { state: 'empty' }]);
    expect(h).toMatch(/data-hidden-by="no-flashes"/);
    expect(h).toMatch(/data-pad="0"[^>]*data-state="empty"[^>]*aria-hidden="true"[^>]*tabindex="-1"/);
  });
});

describe('TakeLane markup', () => {
  const chips: Chip[] = [
    { tap: 0, pad: 0, moveId: 'move.punch', frame: 30, frames: 3, state: 'kept' }, { tap: 1, pad: 0, moveId: 'move.punch', frame: 33, frames: 3, state: 'merged' },
    { tap: 2, pad: 2, moveId: 'move.shake', frame: 40, frames: 5, state: 'held', reason: 'flash_limit', since: 4 },
  ];
  const lane = (c: Chip[], ghost: boolean) => renderToStaticMarkup(createElement(TakeLane, { chips: c, lang: 'he', ghost, ghostBanner: 'תצוגה מקדימה של ההופעה — עדיין לא נשמר', heldWords: (r) => `reason:${r}` }));
  it('lists every chip with its state, reason, frame and pad, and says the reason in words', () => {
    const h = lane(chips, true);
    expect(h).toContain('data-testid="perform-ghost-banner"');
    expect(h).toContain('עדיין לא נשמר');
    expect(h.match(/data-testid="perform-chip"/g)).toHaveLength(3);
    expect(h).toMatch(/data-state="held"[^>]*data-reason="flash_limit"[^>]*data-frame="40"[^>]*data-pad="2"/);
    expect(h).toContain('reason:flash_limit');
    expect(h).toContain('4 פריימים אחרי הקודם');
    expect(h).toMatch(/data-testid="perform-counts"[^>]*>נשמרו 1 · אוחדו 1 · לא יוצגו 1</);
  });
  it('a flash_limit chip the planner names why \'shape\' is worded pv.held.shape (both languages), a plain one by its reason', () => {
    const shape: Chip = { tap: 5, pad: 1, moveId: 'move.custom', frame: 60, frames: 15, state: 'held', reason: 'flash_limit', since: 3, why: 'shape' };
    const plainHold: Chip = { tap: 6, pad: 1, moveId: 'move.custom', frame: 90, frames: 15, state: 'held', reason: 'flash_limit', since: 3 };
    for (const lang of ['he', 'en'] as const) {
      const h = renderToStaticMarkup(createElement(TakeLane, { chips: [shape, plainHold], lang, ghost: false, ghostBanner: '', heldWords: (r) => `reason:${r}` }));
      const words = performT(lang)('pv.held.shape');
      expect(h).toMatch(/data-frame="60"[^>]*data-pad="1"/);
      expect(h).toMatch(/data-shape="true"[^>]*data-frame="60"/);
      expect(h.split(words.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]!)).length - 1).toBeGreaterThanOrEqual(1);
      expect(h.match(/reason:flash_limit/g)).toHaveLength(2); // the plain hold only: in its aria-label and its words
      expect(h).not.toMatch(/data-shape="true"[^>]*data-frame="90"/);
    }
  });
  it('without a ghost there is no banner; with no chips it says what will appear', () => {
    const h = lane([], false);
    expect(h).not.toContain('perform-ghost-banner');
    expect(h).toContain('אחרי העצירה');
  });
});

describe('pad names', () => {
  it('every catalogue move has a name in the page\'s language (no move id read as English words in a Hebrew page)', () => {
    for (const m of MOVES) {
      const he = moveLabel(m, 'he'), en = moveLabel(m, 'en');
      expect(/[\u0590-\u05ff]/.test(he), `he ${m.id}: ${he}`).toBe(true);
      if (m.kind !== 'title') expect(/[\u0590-\u05ff]/.test(en), `en ${m.id}: ${en}`).toBe(false);
      expect(en).not.toMatch(/^[a-z]+( [a-z]+)*$/); // not the bare id
    }
  });
});
