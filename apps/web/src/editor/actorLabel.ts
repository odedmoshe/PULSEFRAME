/**
 * Who made a change, as the activity lists name it (ADR-0023): the owner, an agent, or a phone upload (`phone:<dropId>`,
 * core importView.ts actorKind → «העלאה מהטלפון»). Anything else is shown as the owner, as before.
 */
import { actorKind } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';

export { actorKind };
export function actorWord(t: (key: Key) => string, actor: string): string {
  const kind = actorKind(actor);
  return kind === 'agent' ? t('actor.agent') : kind === 'phone' ? t('actor.phone') : t('actor.user');
}
