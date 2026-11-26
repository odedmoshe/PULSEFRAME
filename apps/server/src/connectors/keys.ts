/**
 * Keys and settings of the outside services this track connects (wave 8 `sources`; verify C1, C2; decisions «sources» Keys, D1, D8).
 * LEAD PRE-PASS, complete: a store of the track's own (the agent's agent/keys.ts refuses these ids and is another track's file),
 * reusing assistant/credential.ts writePrivateFile (tmp of mode 0600 + rename) and redact. Converge with the agent's store at
 * integration if it has landed by then.
 *
 * - Ids come from CONNECTOR_KEY_IDS (an allow-list; a path segment is never built from free text).
 * - Files: `<dataDir>/connectors/keys/<id>.key`, directories 0700. The whole `connectors/` folder is in backup.ts NEVER_BACKED_UP
 *   (removed recursively from a destination): after a restore the owner connects again.
 * - A value is never returned by any route (state = keySet + keyAddedAt), never logged, never in a job row, an error or an SSE event;
 *   anything a service answers passes redact(value) before it is stored or answered.
 * - Wikimedia's contact line is stored here too: it is the owner's personal detail, sent only to Wikimedia in the User-Agent.
 * - Settings without secrets (`sources.maxDownloadBytes`) live in `<dataDir>/connectors.json`, which IS backed up by name (D8).
 * - Windows: chmod 0600 only toggles read-only; the files are protected by the data folder's NTFS ACL (as agent/keys.ts says).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { redact, writePrivateFile } from '../assistant/credential.ts';
import { ApiError } from '../store.ts';

/** The folder a backup never holds (backup.ts NEVER_BACKED_UP). */
export const CONNECTORS_DIR = 'connectors' as const;
/** Settings without secrets; backed up by name (backup.ts, D8). */
export const CONNECTORS_FILE = 'connectors.json' as const;
/** Every stored value: the Pixabay key, Openverse's client (JSON {clientId, clientSecret}), Wikimedia's contact line. */
export const CONNECTOR_KEY_IDS = ['source.pixabay', 'source.openverse.client', 'source.wikimedia.contact'] as const;
export type ConnectorKeyId = (typeof CONNECTOR_KEY_IDS)[number];
export interface ConnectorKeyState { keySet: boolean; keyAddedAt: string | null }
/** The longest value stored (a key, a client as JSON, a contact line). */
export const CONNECTOR_VALUE_MAX = 1024;

const isId = (id: string): id is ConnectorKeyId => (CONNECTOR_KEY_IDS as readonly string[]).includes(id);

export class ConnectorKeyStore {
  constructor(readonly dataDir: string) {}
  private dir(): string { return path.join(this.dataDir, CONNECTORS_DIR, 'keys'); }
  private file(id: string): string {
    if (!isId(id)) throw new ApiError(404, 'source_unknown', 'no such connector key', {}, 'GET /api/v1/sources lists the services.');
    return path.join(this.dir(), `${id}.key`);
  }
  /** keySet and when it was stored (the file's mtime); never the value. */
  state(id: ConnectorKeyId): ConnectorKeyState {
    try { const st = fs.statSync(this.file(id)); return { keySet: st.size > 0, keyAddedAt: st.mtime.toISOString() }; } catch { return { keySet: false, keyAddedAt: null }; }
  }
  /** For a service call only. */
  read(id: ConnectorKeyId): string | null {
    try { const v = fs.readFileSync(this.file(id), 'utf8'); return v.length ? v : null; } catch { return null; }
  }
  /** One line of visible text (no control characters), at most CONNECTOR_VALUE_MAX; else 400 invalid_credentials. */
  write(id: ConnectorKeyId, value: string): ConnectorKeyState {
    const file = this.file(id);
    if (!value.trim() || value.length > CONNECTOR_VALUE_MAX || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, 'invalid_credentials', 'what was typed is not the form this service\'s key takes', {}, 'Paste the key exactly as the service shows it, on one line.');
    fs.mkdirSync(this.dir(), { recursive: true, mode: 0o700 });
    writePrivateFile(file, value.trim());
    return this.state(id);
  }
  delete(id: ConnectorKeyId): ConnectorKeyState {
    fs.rmSync(this.file(id), { force: true });
    return this.state(id);
  }
  /** A redactor over every stored value (for anything a service answers). */
  redactor(): (text: string) => string {
    const fns = CONNECTOR_KEY_IDS.map((id) => redact(this.read(id)));
    return (t) => fns.reduce((s, f) => f(s), t);
  }
}

export const ConnectorSettingsSchema = z.object({
  version: z.literal(1),
  sources: z.object({ maxDownloadBytes: z.number().int().positive().nullable() }).strict(),
}).strict();
export type ConnectorSettings = z.infer<typeof ConnectorSettingsSchema>;
export const DEFAULT_CONNECTOR_SETTINGS: ConnectorSettings = { version: 1, sources: { maxDownloadBytes: null } };
/** The settings file; a missing or unreadable file is the defaults (the card then shows the defaults, nothing is invented). */
export function readConnectorSettings(dataDir: string): ConnectorSettings {
  try { const r = ConnectorSettingsSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dataDir, CONNECTORS_FILE), 'utf8'))); return r.success ? r.data : DEFAULT_CONNECTOR_SETTINGS; } catch { return DEFAULT_CONNECTOR_SETTINGS; }
}
export function writeConnectorSettings(dataDir: string, s: ConnectorSettings): ConnectorSettings {
  const v = ConnectorSettingsSchema.parse(s);
  writePrivateFile(path.join(dataDir, CONNECTORS_FILE), `${JSON.stringify(v, null, 1)}\n`);
  return v;
}
