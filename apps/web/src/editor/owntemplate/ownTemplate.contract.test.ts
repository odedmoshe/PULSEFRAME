/** The owntemplate interface contract (wave 8 pre-pass): test ids are unique and namespaced; nothing is drawn or listed before W3. */
import { describe, expect, it } from 'vitest';
import { OWN_TEMPLATE_TESTIDS } from './ownTemplate.testids.ts';
import { OWN_TEMPLATE_UI_BUILT } from './ownTemplate.contract.ts';
import { OWN_TEMPLATE_COMMANDS } from './ownTemplate.commands.ts';
import { OwnTemplateSection } from './OwnTemplateSection.tsx';

describe('owntemplate interface contract', () => {
  it('test ids are unique and start with own-template-', () => {
    const ids = Object.values(OWN_TEMPLATE_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^own-template-[a-z-]+$/);
  });
  it('until W3: no section, no palette command (no dead button)', () => {
    expect(OWN_TEMPLATE_UI_BUILT).toBe(false);
    expect(OWN_TEMPLATE_COMMANDS).toEqual([]);
    expect(OwnTemplateSection({ lang: 'he', templates: [], onOpen: () => {}, onDeleted: () => {} })).toBeNull();
  });
  it.todo('W3: the save button is disabled with «אין בסרט צילומים לשמור» when the main sequence has no shots');
  it.todo('W3: the dialog fetches the preview on open and after each keepWords change with expectedRevision, and shows every clip in exactly one list');
  it.todo('W3: a 409 stale_revision shows the lists made anew and keeps the dialog open');
  it.todo('W3: the template dialog includes the first N = slot count pictures by default (C8: no 400 with more than 120 pictures)');
  it.todo('W3: the palette command «שמירת הסרט כתבנית» exists for the owner\'s own session only');
});
