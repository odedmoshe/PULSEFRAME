/**
 * The activity feed and the history dialog describe each edit by its operation name, in the interface language.
 * An operation without wording shows up as a raw name like `set_clip_reverse`, so every registered operation must have it.
 */
import { describe, expect, it } from 'vitest';
import { listOps } from '@pulseframe/core';
import { dictionaries } from '../../i18n/src/index.ts';

describe('wording for operations', () => {
  it('every registered operation has a name in Hebrew and in English', () => {
    for (const lang of ['he', 'en'] as const) {
      const missing = listOps().map((o) => o.name).filter((n) => !(dictionaries[lang] as Record<string, string>)[`op.${n}`]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });
  it('command labels exist in both languages', async () => {
    const { COMMANDS } = await import('../../../apps/web/src/editor/commands.ts');
    for (const lang of ['he', 'en'] as const) {
      const missing = COMMANDS.map((c) => c.label).filter((k) => !(dictionaries[lang] as Record<string, string>)[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });
});
