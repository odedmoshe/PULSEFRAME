/** The test-id inventory reads proofs and web source as text: these pin what it recognises, and that a missing id is reported. */
import { describe, expect, it } from 'vitest';
import { extractRefs, inventory, scanSource, staticEvidence } from './testid-inventory.ts';

const ids = (src: string, consts = {}) => extractRefs('proof.ts', src, consts).refs.map((r) => `${r.kind}:${r.id}`).sort();

describe('test ids a proof refers to', () => {
  it('reads selectors, with and without quotes, and attribute operators', () => {
    expect(ids("await page.locator('[data-testid=play]').click(); page.locator('[data-testid=\"export-cancel\"]'); page.locator('.x [data-testid^=\"view-ast_\"]')"))
      .toEqual(['exact:export-cancel', 'exact:play', 'pattern:view-ast_*']);
  });
  it('reads getByTestId with a literal, a template and a table of ids', () => {
    const src = "page.getByTestId('timecode'); page.getByTestId(`view-${up.assetId}`); page.getByTestId(TID.card); page.locator(`[data-testid=${TID.media}][data-asset-id=\"${id}\"]`)";
    expect(ids(src, { TID: { card: 'template-card', media: 'template-media' } })).toEqual(['exact:template-card', 'exact:template-media', 'exact:timecode', 'pattern:view-*']);
  });
  it('follows a helper to the literals its callers pass', () => {
    const src = "const dialog = async (dialogTestId: string, opener: () => Promise<void>) => { await page.getByTestId(dialogTestId).waitFor(); };\nawait dialog('source-viewer', async () => {});\nawait dialog('projects-dialog', open);";
    expect(ids(src)).toEqual(['exact:projects-dialog', 'exact:source-viewer']);
  });
  it('reads comparisons with the id of the focused element, and prefixes cut off an id', () => {
    expect(ids("document.activeElement?.getAttribute('data-testid') === 'track-picker'; (el as HTMLElement).dataset.testid === 'palette-input'; e.dataset.testid!.replace('inspector-tab-', '')"))
      .toEqual(['exact:palette-input', 'exact:track-picker', 'pattern:inspector-tab-*']);
  });
  it('lists what it cannot read instead of dropping it, and ignores an id echoed from the page', () => {
    const r = extractRefs('proof.ts', 'page.locator(`[data-testid="${group}-${value}"]`); const d = `[data-testid=${el.dataset.testid}]`;');
    expect(r.refs).toEqual([]);
    expect(r.unresolved.map((u) => u.why)).toEqual(['every part of the id is filled in at run time']);
  });
});

describe('test ids the web source emits', () => {
  const emitted = scanSource([
    { file: 'A.tsx', src: '<button data-testid="play" /><i data-testid={`view-${a.id}`} /><b data-testid={TID.card} /><InlineRename testid="project-rename" /><u data-testid={`${group}-${value}`} />' },
    { file: 'ids.ts', src: "export const TID = { card: 'template-card' } as const;" },
  ]);
  it('finds an attribute, a template and a constant, in that order of strength', () => {
    expect(staticEvidence({ id: 'play', kind: 'exact' }, emitted)).toMatchObject({ found: true, how: 'attribute', where: ['A.tsx'] });
    expect(staticEvidence({ id: 'project-rename', kind: 'exact' }, emitted)).toMatchObject({ found: true, how: 'attribute' });
    expect(staticEvidence({ id: 'template-card', kind: 'exact' }, emitted)).toMatchObject({ found: true, how: 'constant', where: ['ids.ts'] });
    expect(staticEvidence({ id: 'view-ast_1', kind: 'exact' }, emitted)).toMatchObject({ found: true, how: 'template' });
    expect(staticEvidence({ id: 'view-*', kind: 'pattern' }, emitted)).toMatchObject({ found: true, how: 'template' });
  });
  it('reports an id nothing emits: a template with no fixed text proves nothing', () => {
    expect(staticEvidence({ id: 'gone-button', kind: 'exact' }, emitted)).toEqual({ found: false, how: null, where: [] });
    expect(staticEvidence({ id: 'gone-*', kind: 'pattern' }, emitted)).toEqual({ found: false, how: null, where: [] });
  });
});

describe('the inventory of this repository', () => {
  it('finds every test id the proofs use in the web source', async () => {
    const inv = await inventory();
    expect(inv.ids.length).toBeGreaterThan(300);
    expect(inv.ids.filter((x) => !x.static.found).map((x) => `${x.id} (${x.usedBy.join(', ')})`)).toEqual([]);
    // the ids the redesign's policy names (docs/design/UX_REDESIGN.md §8) are in the inventory
    for (const id of ['preview', 'play', 'timecode', 'ruler', 'undo', 'export', 'lang-toggle', 'projects-open', 'project-name', 'revision', 'workspace-switch', 'format-switch', 'gallery-open', 'file-input', 'export-cancel'])
      expect(inv.ids.some((x) => x.id === id), id).toBe(true);
  });
});
