/** Who made a change, as the activity lists name it (wave 8 understand C7: the server's automatic runs are «אוטומטי», never the owner). */
import { describe, expect, it } from 'vitest';
import { he, en, type Key } from '@pulseframe/i18n';
import { actorWord } from './actorLabel.ts';

describe('actorWord', () => {
  it('names the owner, an agent, a phone upload and the automatic runs', () => {
    const tHe = (k: Key) => he[k], tEn = (k: Key) => en[k];
    expect(['user:local', 'agent:local', 'phone:drp_1', 'server:understand'].map((a) => actorWord(tHe, a))).toEqual([he['actor.user'], he['actor.agent'], he['actor.phone'], 'אוטומטי']);
    expect(actorWord(tEn, 'server:understand')).toBe('Automatic');
  });
});
