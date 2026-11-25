/**
 * A labelled MOCK local adapter for unit tests (wave 7; assistant-decisions.md §4): its id says MOCK; it answers scripted texts and
 * records what it was sent; it never opens a socket. BUILDER B: the body. Never imported by production code.
 */
import type { LocalChatRequest, LocalModelAdapter } from '@pulseframe/providers';

/** The setup reads only whether a local adapter is installed (deps.local), so the MOCK's own id can say MOCK. */
export const LOCAL_MOCK_ADAPTER_ID = 'local-llama-server-MOCK';
export interface LocalMockAdapter extends LocalModelAdapter { readonly label: 'MOCK'; readonly sent: LocalChatRequest[] }

export function createLocalMockAdapter(script: Record<string, string>): LocalMockAdapter {
  void script;
  throw new Error('the local MOCK adapter is not built yet (builder B, wave 7 assistant)');
}
