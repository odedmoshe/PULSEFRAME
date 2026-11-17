/** The test-id inventory reads proofs and web source as text: these pin what it recognises, and that a missing id is reported. */
import { describe, expect, it } from 'vitest';
import { extractRefs, inventory, pinnedReport, scanSource, sourceLosses, staticEvidence, templatePattern, webSources } from './testid-inventory.ts';

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
    expect(staticEvidence({ id: 'view-ast_1', kind: 'exact' }, emitted)).toMatchObject({ found: true, how: 'template', via: ['view-*'] });
    expect(staticEvidence({ id: 'view-*', kind: 'pattern' }, emitted)).toMatchObject({ found: true, how: 'template', via: ['view-*'] });
  });
  it('names the templates that can emit an id, the one with the most fixed text first', () => {
    const e = scanSource([{ file: 'T.tsx', src: '<i data-testid={`clip-${c.id}`} /><b data-testid={`clip-speed-${n}`} />' }]);
    expect(staticEvidence({ id: 'clip-speed-2', kind: 'exact' }, e).via).toEqual(['clip-speed-*', 'clip-*']);
    expect(staticEvidence({ id: 'clip-abc', kind: 'exact' }, e).via).toEqual(['clip-*']);
  });
  it('reports an id nothing emits: a template with no fixed text proves nothing', () => {
    expect(staticEvidence({ id: 'gone-button', kind: 'exact' }, emitted)).toEqual({ found: false, how: null, where: [] });
    expect(staticEvidence({ id: 'gone-*', kind: 'pattern' }, emitted)).toEqual({ found: false, how: null, where: [] });
  });
});

describe('evidence weaker than the committed report records', () => {
  // the source after an element lost its data-testid: the id is still an ordinary word of the code, and a loose template still accepts it
  const pinned = [
    { id: 'undo', kind: 'exact', static: { how: 'attribute' } },
    { id: 'clip-speed', kind: 'exact', static: { how: 'attribute' } },
    { id: 'clip-speed-2', kind: 'exact', static: { how: 'template', via: ['clip-speed-*', 'clip-*'] } },
    { id: 'template-card', kind: 'exact', static: { how: 'constant' } },
    { id: 'view-*', kind: 'pattern', static: { how: 'template', via: ['view-*'] } },
    { id: 'gone-button', kind: 'exact', static: { how: 'attribute' } },
    { id: 'old-report', kind: 'exact' },
  ];
  const judge = (src: string) => { const e = scanSource([{ file: 'A.tsx', src }]); return sourceLosses(pinned, pinned.map((p) => ({ id: p.id, kind: p.kind, static: staticEvidence({ id: p.id, kind: p.kind as 'exact' | 'pattern' }, e) }))); };
  const whole = "<button data-testid=\"undo\" onClick={() => editor.history('undo')} /><i data-testid=\"clip-speed\" /><i data-testid={`clip-speed-${n}`} /><i data-testid={`clip-${c.id}`} /><b data-testid={T.card} /><u data-testid={`view-${a.id}`} />; const T = { card: 'template-card' }; const old = 'old-report';";
  it('reports nothing while every id is emitted as it was', () => {
    expect(judge(whole)).toEqual([]);
  });
  it('reports an attribute that is now only a constant or a template, and a template that is gone while a looser one still matches', () => {
    const stripped = whole.replace(' data-testid="undo"', '').replace('<i data-testid="clip-speed" />', '').replace('<i data-testid={`clip-speed-${n}`} />', '');
    for (const id of ['undo', 'clip-speed', 'clip-speed-2']) expect(staticEvidence({ id, kind: 'exact' }, scanSource([{ file: 'A.tsx', src: stripped }])).found, id).toBe(true); // "found" alone does not fail
    expect(judge(stripped)).toEqual([
      { id: 'undo', why: 'was a data-testid attribute in the source, is now only a string constant' },
      { id: 'clip-speed', why: 'was a data-testid attribute in the source, is now only a data-testid template (clip-*)' },
      { id: 'clip-speed-2', why: 'the template clip-speed-* that emitted it is gone; only clip-* still matches' },
    ]);
  });
  it('reports a constant that is now only matched by a template, and never an id that became an attribute', () => {
    expect(judge(whole.replace("card: 'template-card'", 'card: `template-${kind}`')).map((l) => l.id)).toEqual(['template-card']);
    expect(judge(whole.replace('data-testid={T.card}', 'data-testid="template-card"').replace('data-testid={`clip-speed-${n}`}', 'data-testid="clip-speed-2"'))).toEqual([]);
  });
  it('leaves an id nothing emits to the missing list, and judges no id the report has no evidence for', () => {
    expect(staticEvidence({ id: 'gone-button', kind: 'exact' }, scanSource([{ file: 'A.tsx', src: whole }])).found).toBe(false);
    expect(judge(whole).some((l) => l.id === 'gone-button' || l.id === 'old-report')).toBe(false);
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

  it('finds no id on weaker evidence than the committed report records (the check of `pnpm audit:testids -- --static`)', async () => {
    const pinned = pinnedReport();
    expect(pinned?.ids.length).toBeGreaterThan(300);
    // a failure here names ids that most likely left their element; one moved on purpose is recorded by `pnpm audit:testids -- --accept`
    expect(sourceLosses(pinned!.ids, (await inventory()).ids)).toEqual([]);
  });

  it('cannot be passed by an id that left its element: with the attribute, the template or the constant taken out of the source, every id is reported', async () => {
    const inv = await inventory(), web = webSources();
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const survivors: string[] = [], notRemoved: string[] = [];
    const tally: Record<string, number> = {};
    for (const x of inv.ids) {
      const how = x.static.how!;
      let mutate: (src: string) => string;
      if (how === 'attribute' && x.kind === 'exact') {
        // every form scanSource reads an attribute from: data-testid="x", testid='x', data-testid={`x`}, 'data-testid': 'x', setAttribute('data-testid', 'x')
        const forms = [new RegExp(`(?:data-testid|testid|testId|['"]data-testid['"])\\s*[=:]\\s*\\{?\\s*(['"\`])${esc(x.id)}\\1\\s*\\}?`, 'g'), new RegExp(`setAttribute\\(\\s*['"]data-testid['"]\\s*,\\s*(['"])${esc(x.id)}\\1\\s*\\)`, 'g')];
        mutate = (src) => forms.reduce((s, re) => s.replace(re, ''), src);
      } else if (how === 'template') {
        const first = x.static.via![0]!;
        mutate = (src) => src.replace(/`[^`]+`/g, (t) => (templatePattern(t.slice(1, -1)) === first ? '``' : t));
      } else if (how === 'constant') {
        const literal = new RegExp(`(['"])${esc(x.id)}\\1`, 'g');
        mutate = (src) => src.replace(literal, "''");
      } else continue; // a pattern met by attributes: each of those ids is in the loop itself
      const mutated = web.map((f) => ({ file: f.file, src: mutate(f.src) }));
      if (!mutated.some((m, i) => m.src !== web[i]!.src)) { notRemoved.push(x.id); continue; }
      const after = staticEvidence(x, scanSource(mutated));
      tally[how] = (tally[how] ?? 0) + 1;
      if (after.found && !sourceLosses([{ id: x.id, kind: x.kind, static: x.static }], [{ id: x.id, kind: x.kind, static: after }]).length) survivors.push(`${x.id} (${how} -> ${after.how})`);
    }
    expect(notRemoved).toEqual([]);
    expect(survivors).toEqual([]);
    expect(tally.attribute).toBeGreaterThan(300);
    expect(tally.template).toBeGreaterThan(20);
    expect(tally.constant).toBeGreaterThan(50);
  }, 240_000);
});
