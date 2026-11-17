import { describe, expect, it } from 'vitest';
import { agentName, isAgentEvent } from './Copilot.tsx';

describe('receipt authorship', () => {
  it('names an agent that has its own credential, and says only "an agent" for the shared local one', () => {
    expect(agentName('agent:local')).toBeNull();
    expect(agentName('agent:subtitles')).toBe('subtitles');
    expect(isAgentEvent({ actor: 'agent:subtitles' })).toBe(true);
    expect(isAgentEvent({ actor: 'user:local' })).toBe(false);
  });
});
