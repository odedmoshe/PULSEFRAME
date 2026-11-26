/**
 * The owner's assistant settings and key on disk (ADR-0027, plan §7.5; decision 9). Two files in the data directory, outside
 * every project, archive and backup (backup.ts NEVER_BACKED_UP): `assistant.json` (adapter, host, model, the owner's
 * prices, the monthly limit, the per-request cap, the two data switches; NO key) and `assistant.key` (the key alone). Both
 * are written to a temporary file of mode 0600 and renamed into place, so a crash never leaves a half-written key or a
 * readable one.
 *
 * The key is never returned (status says only keySet and keyAddedAt), never logged, and only ever handed to an adapter's
 * call. Anything an adapter reports passes through redact(key) before it is stored or answered. The host must be a plain
 * host name that PF_ASSISTANT_HOSTS lists; requests go to https://<host> only. The trust boundary is ADR-0002's: a process of
 * the same user can read the data directory (an OS keychain or an encrypted store is not done yet).
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ASSISTANT_TOGGLES_DEFAULT, AssistantConfigBodySchema, type AssistantConfigBody, type AssistantKeyState } from '@pulseframe/core';
import { CHAT_HOST_PATTERN } from '@pulseframe/providers';
import { ApiError } from '../store.ts';
import { warnsOpen, type ServerMode } from '../autonomy-mode.ts';
import { ASSISTANT_CONFIG_FILE, ASSISTANT_FILE_MODE, ASSISTANT_KEY_FILE } from './contract.ts';

/** The configuration before the owner has set anything: nothing chosen, no prices, no limits, both switches off. */
export const EMPTY_ASSISTANT_CONFIG: AssistantConfigBody = Object.freeze({
  adapter: null, host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { ...ASSISTANT_TOGGLES_DEFAULT },
}) as AssistantConfigBody;

/** Write `text` to `file` as mode 0600: a temporary file in the same directory, then a rename (atomic on one file system). */
export function writePrivateFile(file: string, text: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { mode: ASSISTANT_FILE_MODE, flag: 'wx' });
    fs.chmodSync(tmp, ASSISTANT_FILE_MODE); // the umask can only lower a mode; this states it
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Replace every occurrence of the key (as typed, and URL-encoded) in a text an adapter produced. */
export function redact(key: string | null): (text: string) => string {
  if (!key) return (t) => t;
  const forms = [...new Set([key, encodeURIComponent(key)])].filter((f) => f.length > 0);
  return (t) => forms.reduce((s, f) => s.split(f).join('[redacted]'), t);
}

/**
 * The host as stored: a plain lowercase host name. `https://host` (with nothing after it but an optional '/') is accepted
 * and reduced to `host`; http, a port, a path or an address literal are refused, and so is a host PF_ASSISTANT_HOSTS does not list
 * (unless `anyListed`: open server mode, row D6, where the host is kept and named in a warning by the setup state).
 */
export function normalizeHost(input: string | null, allowedHosts: readonly string[], anyListed = false): string | null {
  if (input === null) return null;
  let h = input.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) {
    if (!h.startsWith('https://')) throw new ApiError(400, 'invalid_request', 'the language assistant is reached over https only', { host: input }, 'Give the service\'s host name, for example api.example.com; requests go to https://<host>.');
    h = h.slice('https://'.length).replace(/\/$/, '');
  }
  if (!CHAT_HOST_PATTERN.test(h)) throw new ApiError(400, 'invalid_request', `"${input}" is not a host name`, { host: input }, 'Give the host name only (no port, path or address), for example api.example.com.');
  if (!allowedHosts.includes(h) && !anyListed) throw new ApiError(409, 'host_not_allowed', `the host ${h} is not listed in PF_ASSISTANT_HOSTS`, { host: h, allowed: [...allowedHosts] }, 'Add exactly this host to PF_ASSISTANT_HOSTS and restart the server, then save again.');
  return h;
}

export class AssistantFiles {
  readonly configFile: string;
  readonly keyFile: string;
  /** `modeCfg`: the server mode to read (config.ts mode/liveMode); absent = guarded behaviour (the host must be listed). */
  constructor(dataDir: string, private allowedHosts: readonly string[], private modeCfg?: { mode: ServerMode; liveMode?: () => ServerMode }) {
    this.configFile = path.join(dataDir, ASSISTANT_CONFIG_FILE);
    this.keyFile = path.join(dataDir, ASSISTANT_KEY_FILE);
  }
  /** The stored config, or the empty one (with the reason) when there is none or it cannot be read. Never throws. */
  readConfig(): { config: AssistantConfigBody; problem: string | null } {
    let text: string;
    try { text = fs.readFileSync(this.configFile, 'utf8'); } catch { return { config: EMPTY_ASSISTANT_CONFIG, problem: null }; }
    try {
      const p = AssistantConfigBodySchema.safeParse(JSON.parse(text));
      if (p.success) return { config: p.data, problem: null };
      return { config: EMPTY_ASSISTANT_CONFIG, problem: `${ASSISTANT_CONFIG_FILE} does not hold a valid configuration; save the settings again` };
    } catch { return { config: EMPTY_ASSISTANT_CONFIG, problem: `${ASSISTANT_CONFIG_FILE} is not JSON; save the settings again` }; }
  }
  /** Validate (host) and store the owner's config. The body never holds a key (its schema is strict). */
  writeConfig(body: AssistantConfigBody): AssistantConfigBody {
    const config: AssistantConfigBody = AssistantConfigBodySchema.parse({ ...body, host: normalizeHost(body.host, this.allowedHosts, !!this.modeCfg && warnsOpen(this.modeCfg)) }); // D6: open mode keeps an unlisted host
    writePrivateFile(this.configFile, `${JSON.stringify(config, null, 2)}\n`);
    return config;
  }
  keyState(): AssistantKeyState {
    try {
      const st = fs.statSync(this.keyFile);
      return st.size > 0 ? { keySet: true, keyAddedAt: st.mtime.toISOString() } : { keySet: false, keyAddedAt: null };
    } catch { return { keySet: false, keyAddedAt: null }; }
  }
  /** The key, for an adapter's call only. Never returned by a route. */
  readKey(): string | null {
    try { const k = fs.readFileSync(this.keyFile, 'utf8'); return k.length ? k : null; } catch { return null; }
  }
  writeKey(key: string): AssistantKeyState {
    const k = key.trim();
    if (!k || /[\s\u0000-\u001f\u007f]/.test(k)) throw new ApiError(400, 'invalid_request', 'a key is one line of visible characters', {}, 'Paste the key exactly as the provider shows it.');
    writePrivateFile(this.keyFile, k);
    return this.keyState();
  }
  deleteKey(): AssistantKeyState {
    fs.rmSync(this.keyFile, { force: true });
    return this.keyState();
  }
}
