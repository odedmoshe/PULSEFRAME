/**
 * A labelled MOCK local adapter for unit tests (wave 7; assistant-decisions.md §4): its id says MOCK; it answers scripted texts and
 * records what it was sent; it never opens a socket. Never imported by production code.
 *
 * `script` maps the owner's text (the user turn without its 'REQUEST (data):\n' mark) to the answer's message text; a text it does not
 * know is answered {"intent":"none","slots":{}}. `queue` puts one behaviour in front of the script for the next call: a LocalModelError
 * to throw, a hold until the signal aborts (then canceled, sent true), a reply with another finish or text.
 */
import type * as Core from '@pulseframe/core';
import type { LocalDropReason, LocalSlotName, LocalSlots } from '@pulseframe/core';
import { LocalModelError, type LocalChatRequest, type LocalChatResponse, type LocalErrorCode, type LocalModelAdapter, type LocalModelCheck } from '@pulseframe/providers';

/** The setup reads only whether a local adapter is installed (deps.local), so the MOCK's own id can say MOCK. */
export const LOCAL_MOCK_ADAPTER_ID = 'local-llama-server-MOCK';
export type LocalMockStep =
  | { throw: LocalErrorCode; sent?: boolean; detail?: string }
  | { hold: true }
  | { reply: LocalChatResponse };
export interface LocalMockAdapter extends LocalModelAdapter {
  readonly label: 'MOCK'; readonly sent: LocalChatRequest[];
  /** Ports and time limits each complete() was called with. */
  readonly calls: { port: number; timeoutMs: number }[];
  queue(step: LocalMockStep): void;
  /** What check() answers (default running, MOCK.gguf). */
  checkAnswer: LocalModelCheck;
}

const MARK = 'REQUEST (data):\n';

export function createLocalMockAdapter(script: Record<string, string>): LocalMockAdapter {
  const steps: LocalMockStep[] = [];
  const sent: LocalChatRequest[] = [];
  const calls: { port: number; timeoutMs: number }[] = [];
  const self: LocalMockAdapter = {
    id: LOCAL_MOCK_ADAPTER_ID, label: 'MOCK', sent, calls,
    checkAnswer: { state: 'running', model: 'MOCK.gguf' },
    queue: (step) => { steps.push(step); },
    check: async (_port, signal) => { if (signal.aborted) throw new LocalModelError('canceled', false, 'canceled'); return { ...self.checkAnswer }; },
    complete: async (req, port, timeoutMs, signal) => {
      sent.push(req);
      calls.push({ port, timeoutMs });
      const step = steps.shift();
      if (step && 'throw' in step) throw new LocalModelError(step.throw, step.sent ?? (step.throw !== 'not_running' && step.throw !== 'not_loopback'), step.detail ?? step.throw);
      if (step && 'hold' in step) {
        await new Promise<void>((_res, rej) => {
          if (signal.aborted) rej(new LocalModelError('canceled', true, 'canceled'));
          signal.addEventListener('abort', () => rej(new LocalModelError('canceled', true, 'canceled')), { once: true });
        });
      }
      if (step && 'reply' in step) return step.reply;
      const text = req.user.startsWith(MARK) ? req.user.slice(MARK.length) : req.user;
      return { text: script[text] ?? '{"intent":"none","slots":{}}', finish: 'stop', model: 'MOCK.gguf' };
    },
  };
  return self;
}

/**
 * A labelled DOUBLE of builder A's core groundLocalAnswer and localPhrase, for the server's unit tests while they are not merged
 * (core LOCAL_INTENT_BUILT false: the real ones throw "not built"). Use it from a vi.mock factory of '@pulseframe/core':
 *   vi.mock('@pulseframe/core', async (orig) => (await import('./localTestAdapter.ts')).withLocalIntentDouble(await orig()));
 * Once A is merged it returns the real module untouched. The double knows a few Hebrew phrases the real grammar reads (asserted by
 * the tests through barUnderstands): gain_change of the music, add_title at the start, undo; any other intent renders no phrase.
 * Grounding: a numeric slot stays when the request holds its digits as a word or one of three Hebrew number words; a text slot when
 * it is a substring of the NFC request; enum slots stay; a slot the intent does not take is not_for_intent. This module imports
 * nothing of core at run time (it is loaded inside the mock factory).
 */
export function withLocalIntentDouble(real: typeof Core): typeof Core {
  if (real.LOCAL_INTENT_BUILT) return real;
  const WORD_NUMBERS: Record<string, string> = { שש: '6', ארבעה: '4', שלוש: '3' };
  const numeric = new Set<string>(real.LOCAL_NUMERIC_SLOTS);
  const groundLocalAnswer: typeof real.groundLocalAnswer = (request, answer) => {
    const takes = new Set<string>(answer.intent === 'none' ? [] : real.LOCAL_INTENT_SLOTS[answer.intent]);
    const words = request.normalize('NFC').split(/[\s,.]+/).filter(Boolean);
    const slots: Record<string, string> = {};
    const dropped: { slot: LocalSlotName; why: LocalDropReason }[] = [];
    for (const [k, v] of Object.entries(answer.slots) as [LocalSlotName, string | undefined][]) {
      if (v === undefined) continue;
      if (!takes.has(k)) { dropped.push({ slot: k, why: 'not_for_intent' }); continue; }
      const ok = numeric.has(k) ? words.some((w) => w === v || WORD_NUMBERS[w.replace(/^[בו]/, '')] === v) : k === 'text' ? request.normalize('NFC').includes(v) : true;
      if (ok) slots[k] = v; else dropped.push({ slot: k, why: 'ungrounded' });
    }
    return { intent: answer.intent, slots: slots as LocalSlots, dropped };
  };
  const localPhrase: typeof real.localPhrase = (intent, s) => {
    if (intent === 'gain_change' && s.target === 'music' && s.dir) return `${s.dir === 'up' ? 'הגבר' : 'הנמך'} את המוזיקה${s.db ? ` ב־${s.db} דציבל` : ''}`;
    if (intent === 'add_title' && s.text && s.at === 'start') return `הוסף כותרת "${s.text}" בהתחלה`;
    if (intent === 'undo') return 'בטל';
    return null;
  };
  // LOCAL_INTENT_BUILT true: the double stands in for the built functions (the server refuses 501 not_built without them)
  return { ...real, groundLocalAnswer, localPhrase, LOCAL_INTENT_BUILT: true } as unknown as typeof Core;
}
