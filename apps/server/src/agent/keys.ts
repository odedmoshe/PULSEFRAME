/**
 * The agent's provider keys and settings on disk (wave 8 autonomy Part 2, decision 3). LEAD PRE-PASS: the contract and typed stubs.
 * BUILDER W2 (opus) owns this file and agent/providers.ts after the pre-pass.
 *
 * Contract:
 *  - One key per provider preset: `<dataDir>/agent/keys/<providerId>.key`, the key alone, written with assistant/credential.ts
 *    writePrivateFile (tmp of mode 0600 + rename; the directories 0700). Typed by the owner into the connect card only.
 *  - Settings (base URL, model, no key) in `<dataDir>/agent/providers.json` (same writer). The owner's model rows in agent/models.json.
 *  - The whole `agent/` directory is in backup.ts NEVER_BACKED_UP (removed recursively from a destination): after a restore the
 *    owner connects again, as for the assistant's key.
 *  - The key is never returned by any route (state = keySet + keyAddedAt only), never logged, never put in a step, an error or an SSE
 *    event; anything an adapter reports passes redact(key) (assistant/credential.ts) before it is stored or answered.
 *  - providerId must be one of AGENT_PROVIDER_PRESETS (a path segment is never built from free text).
 *  - Base URL: any http(s) URL the owner types (D7: a second PC on the LAN included). It is NOT assistant/credential.ts's
 *    "https://<listed host> only" rule (C5: that rule stays the command-bar assistant's); an http:// non-loopback URL is stored and
 *    the card says «החיבור לא מוצפן» (providers isUnencryptedRemote). Changing it is the owner's floor (it decides where the key goes).
 *  - Windows (say what is true, decision 3): chmod 0600 only toggles read-only there; the key is protected by the NTFS ACL of the
 *    data folder (under the user profile: the user, SYSTEM and Administrators; on a secondary drive such as E: the default ACL often
 *    lets other local accounts read it — unknown until `icacls` runs on the laptop). DPAPI is a later step.
 */
import { AgentNotBuiltError } from '@pulseframe/core';

export interface AgentKeyState { keySet: boolean; keyAddedAt: string | null }
export interface AgentProviderSettings { providerId: string; baseUrl: string; model: string | null }

export class AgentKeyStore {
  constructor(readonly dataDir: string) {}
  /** keySet/keyAddedAt from the file's size and mtime; never the key. */
  keyState(providerId: string): AgentKeyState { void providerId; return { keySet: false, keyAddedAt: null }; }
  /** For an adapter's call only. */
  readKey(providerId: string): string | null { void providerId; return null; }
  /** One line of visible characters, else 400 invalid_request «הדביקו את המפתח בדיוק כמו שהספק מציג אותו». */
  writeKey(providerId: string, key: string): AgentKeyState { void providerId; void key; throw new AgentNotBuiltError('AgentKeyStore.writeKey'); }
  deleteKey(providerId: string): AgentKeyState { void providerId; throw new AgentNotBuiltError('AgentKeyStore.deleteKey'); }
  readSettings(): AgentProviderSettings[] { return []; }
  writeSettings(s: AgentProviderSettings): AgentProviderSettings { void s; throw new AgentNotBuiltError('AgentKeyStore.writeSettings'); }
}
