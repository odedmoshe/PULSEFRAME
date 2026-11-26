/**
 * The agent's provider keys and settings on disk (wave 8 autonomy Part 2, decision 3). Builder W2 owns this file and
 * agent/providers.ts.
 *
 * Contract:
 *  - One key per provider preset: `<dataDir>/agent/keys/<providerId>.key`, the key alone, written with assistant/credential.ts
 *    writePrivateFile (tmp of mode 0600 + rename; the directories 0700). Typed by the owner into the connect card only.
 *  - Settings (base URL, model, no key) in `<dataDir>/agent/providers.json` (same writer), with the provider connected last
 *    (the default of a run that names none).
 *  - The whole `agent/` directory is in backup.ts NEVER_BACKED_UP (removed recursively from a destination): after a restore the
 *    owner connects again, as for the assistant's key.
 *  - The owner's model rows are NOT secret and are the owner's work: `<dataDir>/agent-models.json` (lead decision of 2026-11-26,
 *    pre-pass answer 5), outside `agent/`, copied by the backup like the owner's templates. (contract.ts AGENT_MODELS_FILE
 *    'agent/models.json' is the pre-pass's name and is not used.)
 *  - The key is never returned by any route (state = keySet + keyAddedAt only), never logged, never put in a step, an error or an SSE
 *    event; anything an adapter reports passes redact(key) (assistant/credential.ts) before it is stored or answered.
 *  - providerId must be one of AGENT_PROVIDER_PRESETS (a path segment is never built from free text).
 *  - Base URL: any http(s) URL the owner types (D7: a second PC on the LAN included). It is NOT assistant/credential.ts's
 *    "https://<listed host> only" rule (C5: that rule stays the command-bar assistant's); an http:// non-loopback URL is stored and
 *    the card says «החיבור לא מוצפן» (providers isUnencryptedRemote). Changing it is the owner's floor (it decides where the key goes).
 *    What is refused is what cannot be a base URL: another scheme, a user name or password inside it (the address is shown on the
 *    card and would carry a secret), a query or a fragment (the adapters append the API path).
 *  - Windows (say what is true, decision 3): chmod 0600 only toggles read-only there; the key is protected by the NTFS ACL of the
 *    data folder (under the user profile: the user, SYSTEM and Administrators; on a secondary drive such as E: the default ACL often
 *    lets other local accounts read it — unknown until `icacls` runs on the laptop). DPAPI is a later step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_REFUSAL_CODES } from '@pulseframe/core';
import { AGENT_PROVIDER_PRESETS, AgentModelTableSchema, type AgentModelRow, type AgentProviderPreset } from '@pulseframe/providers';
import { writePrivateFile } from '../assistant/credential.ts';
import { ApiError } from '../store.ts';

export const AGENT_KEYS_DIR_REL = path.join('agent', 'keys');
export const AGENT_PROVIDERS_FILE_REL = path.join('agent', 'providers.json');
/** The owner's model rows: backed up (backup.ts copies it), unlike everything under agent/. */
export const AGENT_OWNER_MODELS_FILE = 'agent-models.json';
export const AGENT_KEY_MAX_CHARS = 4096;

export interface AgentKeyState { keySet: boolean; keyAddedAt: string | null }
export interface AgentProviderSettings { providerId: string; baseUrl: string; model: string | null }
interface ProvidersFile { settings: AgentProviderSettings[]; lastConnected: string | null }

/** The preset of a provider id, or 404 agent_provider_unknown (the id is never used in a path before this). */
export function presetOf(providerId: string): AgentProviderPreset {
  const p = AGENT_PROVIDER_PRESETS.find((x) => x.id === providerId);
  if (!p) throw new ApiError(AGENT_REFUSAL_CODES.providerUnknown.status, AGENT_REFUSAL_CODES.providerUnknown.code, `no provider preset ${providerId}`, { providerId }, 'GET /api/v1/agent/providers lists them. / הספק הזה לא מוכר: בחרו אחד מהרשימה.');
  return p;
}

/** A base URL as stored: http(s), no user/password, no query or fragment, without a trailing slash. Else 400 with the next step. */
export function normalizeBaseUrl(input: string): string {
  const t = input.trim();
  let u: URL;
  try { u = new URL(t); } catch { throw new ApiError(400, 'invalid_request', `"${t.slice(0, 200)}" is not an address`, {}, 'Type the address as the provider or the local server shows it, for example http://127.0.0.1:9931/v1. / הקלידו את הכתובת כמו שהספק או השרת המקומי מציגים אותה.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ApiError(400, 'invalid_request', 'a model provider is reached over http or https', { protocol: u.protocol }, 'Start the address with https:// or http://. / התחילו את הכתובת ב־https:// או ב־http://.');
  if (u.username || u.password) throw new ApiError(400, 'invalid_request', 'the address holds a user name or password', {}, 'Remove the user name and password from the address and paste the key into the key field. / הסירו שם משתמש וסיסמה מהכתובת והדביקו את המפתח בשדה המפתח.');
  if (u.search || u.hash) throw new ApiError(400, 'invalid_request', 'the address has a query or a fragment', {}, 'Type the address without ?… or #…; the editor adds the API path itself. / הקלידו את הכתובת בלי ?… או #….');
  return u.toString().replace(/\/+$/, '');
}

export class AgentKeyStore {
  readonly keysDir: string;
  readonly providersFile: string;
  readonly ownerModelsFile: string;
  constructor(readonly dataDir: string) {
    this.keysDir = path.join(dataDir, AGENT_KEYS_DIR_REL);
    this.providersFile = path.join(dataDir, AGENT_PROVIDERS_FILE_REL);
    this.ownerModelsFile = path.join(dataDir, AGENT_OWNER_MODELS_FILE);
  }
  private ensureDirs(): void {
    for (const d of [path.join(this.dataDir, 'agent'), this.keysDir]) {
      fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(d, 0o700); } catch { /* Windows: the folder's ACL decides (see the header) */ }
    }
  }
  private keyFile(providerId: string): string { return path.join(this.keysDir, `${presetOf(providerId).id}.key`); }

  /** keySet/keyAddedAt from the file's size and mtime; never the key. */
  keyState(providerId: string): AgentKeyState {
    try {
      const st = fs.statSync(this.keyFile(providerId));
      return st.size > 0 ? { keySet: true, keyAddedAt: st.mtime.toISOString() } : { keySet: false, keyAddedAt: null };
    } catch (e) { if (e instanceof ApiError) throw e; return { keySet: false, keyAddedAt: null }; }
  }
  /** For an adapter's call only. */
  readKey(providerId: string): string | null {
    try { const k = fs.readFileSync(this.keyFile(providerId), 'utf8'); return k.length ? k : null; } catch (e) { if (e instanceof ApiError) throw e; return null; }
  }
  /** One line of visible characters, else 400 invalid_request «הדביקו את המפתח בדיוק כמו שהספק מציג אותו». */
  writeKey(providerId: string, key: string): AgentKeyState {
    const file = this.keyFile(providerId);
    const k = typeof key === 'string' ? key.trim() : '';
    if (!k || k.length > AGENT_KEY_MAX_CHARS || /[\s\u0000-\u001f\u007f]/.test(k)) throw new ApiError(400, 'invalid_request', 'a key is one line of visible characters', {}, 'Paste the key exactly as the provider shows it. / הדביקו את המפתח בדיוק כמו שהספק מציג אותו.');
    this.ensureDirs();
    writePrivateFile(file, k);
    this.markConnected(providerId);
    return this.keyState(providerId);
  }
  deleteKey(providerId: string): AgentKeyState {
    fs.rmSync(this.keyFile(providerId), { force: true });
    return this.keyState(providerId);
  }

  private readProvidersFile(): ProvidersFile {
    try {
      const j = JSON.parse(fs.readFileSync(this.providersFile, 'utf8')) as Partial<ProvidersFile>;
      const settings = (Array.isArray(j.settings) ? j.settings : []).filter((s): s is AgentProviderSettings =>
        !!s && typeof s === 'object' && AGENT_PROVIDER_PRESETS.some((p) => p.id === s.providerId) && typeof s.baseUrl === 'string' && (s.model === null || typeof s.model === 'string'));
      return { settings, lastConnected: typeof j.lastConnected === 'string' ? j.lastConnected : null };
    } catch { return { settings: [], lastConnected: null }; }
  }
  private writeProvidersFile(f: ProvidersFile): void {
    this.ensureDirs();
    writePrivateFile(this.providersFile, `${JSON.stringify(f, null, 2)}\n`);
  }
  private markConnected(providerId: string): void {
    const f = this.readProvidersFile();
    if (f.lastConnected !== providerId) this.writeProvidersFile({ ...f, lastConnected: providerId });
  }
  /** Stored settings only (presets without a stored row are not listed). */
  readSettings(): AgentProviderSettings[] { return this.readProvidersFile().settings; }
  /** The settings in force for one provider: stored, else the preset's address and no model. */
  settingsOf(providerId: string): AgentProviderSettings {
    const p = presetOf(providerId);
    return this.readSettings().find((s) => s.providerId === p.id) ?? { providerId: p.id, baseUrl: p.baseUrl, model: null };
  }
  /** The provider connected last (a key or settings were saved for it), or null. */
  lastConnected(): string | null { return this.readProvidersFile().lastConnected; }
  writeSettings(s: AgentProviderSettings): AgentProviderSettings {
    const p = presetOf(s.providerId);
    const model = s.model === null ? null : s.model.trim();
    if (model !== null && (!model || model.length > 128 || /[\s\u0000-\u001f\u007f]/.test(model))) throw new ApiError(400, 'invalid_request', 'a model id is one word of visible characters', {}, 'Copy the model id from the model table or the provider\'s page, for example claude-opus-5-5. / העתיקו את שם המודל מטבלת המודלים או מעמוד הספק.');
    const row: AgentProviderSettings = { providerId: p.id, baseUrl: normalizeBaseUrl(s.baseUrl), model };
    const f = this.readProvidersFile();
    this.writeProvidersFile({ settings: [...f.settings.filter((x) => x.providerId !== p.id), row], lastConnected: p.id });
    return row;
  }

  /** The owner's model rows ([] when none, or when the file cannot be read: the problem is said, never thrown). */
  readOwnerModels(): { rows: AgentModelRow[]; problem: string | null } {
    let text: string;
    try { text = fs.readFileSync(this.ownerModelsFile, 'utf8'); } catch { return { rows: [], problem: null }; }
    try {
      const r = AgentModelTableSchema.safeParse(JSON.parse(text));
      return r.success ? { rows: r.data, problem: null } : { rows: [], problem: `${AGENT_OWNER_MODELS_FILE} does not hold a valid model table; save the table again` };
    } catch { return { rows: [], problem: `${AGENT_OWNER_MODELS_FILE} is not JSON; save the table again` }; }
  }
  /** Replace the owner's rows. Each row's provider must be a preset; one row per provider and id. */
  writeOwnerModels(rows: AgentModelRow[]): AgentModelRow[] {
    const seen = new Set<string>();
    for (const r of rows) {
      presetOf(r.providerId);
      const k = `${r.providerId}/${r.id}`;
      if (seen.has(k)) throw new ApiError(400, 'invalid_request', `the row ${k} appears twice`, { row: k }, 'Keep one row per provider and model id. / השאירו שורה אחת לכל ספק ומודל.');
      seen.add(k);
    }
    const parsed = AgentModelTableSchema.parse(rows);
    writePrivateFile(this.ownerModelsFile, `${JSON.stringify(parsed, null, 2)}\n`);
    return parsed;
  }
}
