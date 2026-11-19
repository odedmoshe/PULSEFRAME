/**
 * The owner's assistant files (ADR-0027, plan §7.5; decision 9): mode 0600, written by temp-then-rename, the key never in
 * the config, a host outside PF_ASSISTANT_HOSTS refused, adapter text redacted. The key here is a labelled test double.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../store.ts';
import { ASSISTANT_CONFIG_FILE, ASSISTANT_KEY_FILE } from './contract.ts';
import { AssistantFiles, EMPTY_ASSISTANT_CONFIG, normalizeHost, redact, writePrivateFile } from './credential.ts';

const KEY = 'TEST-DOUBLE-NOT-A-KEY-7f3a9c';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-acred-')); dirs.push(d); return d; };
const mode = (f: string) => fs.statSync(f).mode & 0o777;
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}${e.hint ? '+hint' : ''}` : String(e); } return 'ok'; };
const config = (host: string | null) => ({ adapter: 'x', host, model: 'm', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 500, perRequestCapCents: 50, toggles: { titlesAndMarkers: false, peopleNames: true } });

describe('the key file', () => {
  it('is written with mode 0600 by temp-then-rename, leaves no temporary file, and is never in the config file', () => {
    const dir = tmp();
    const files = new AssistantFiles(dir, ['api.example.test']);
    expect(files.keyState()).toEqual({ keySet: false, keyAddedAt: null });
    const st = files.writeKey(`  ${KEY}\n`);
    expect(st.keySet).toBe(true);
    expect(Date.parse(st.keyAddedAt!)).toBeGreaterThan(0);
    expect(mode(path.join(dir, ASSISTANT_KEY_FILE))).toBe(0o600);
    expect(fs.readFileSync(path.join(dir, ASSISTANT_KEY_FILE), 'utf8')).toBe(KEY); // trimmed
    expect(files.readKey()).toBe(KEY);
    files.writeConfig(config('api.example.test'));
    expect(mode(path.join(dir, ASSISTANT_CONFIG_FILE))).toBe(0o600);
    expect(fs.readFileSync(path.join(dir, ASSISTANT_CONFIG_FILE), 'utf8')).not.toContain(KEY);
    expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([]);
    expect(JSON.stringify(st)).not.toContain(KEY);
    expect(files.deleteKey()).toEqual({ keySet: false, keyAddedAt: null });
    expect(fs.existsSync(path.join(dir, ASSISTANT_KEY_FILE))).toBe(false);
    expect(files.readKey()).toBeNull();
  });
  it('refuses a key with spaces or control characters inside it', () => {
    const files = new AssistantFiles(tmp(), []);
    expect(err(() => files.writeKey('two words'))).toBe('400:invalid_request+hint');
    expect(err(() => files.writeKey('a\u0000b'))).toBe('400:invalid_request+hint');
  });
  it('replacing a file keeps it 0600 even when it had been opened up by hand', () => {
    const dir = tmp();
    const f = path.join(dir, 'x');
    fs.writeFileSync(f, 'old', { mode: 0o644 });
    fs.chmodSync(f, 0o644);
    writePrivateFile(f, 'new');
    expect(mode(f)).toBe(0o600);
    expect(fs.readFileSync(f, 'utf8')).toBe('new');
  });
});

describe('the config file', () => {
  it('reads as the empty config when absent, and names a damaged file instead of trusting it', () => {
    const dir = tmp();
    const files = new AssistantFiles(dir, ['api.example.test']);
    expect(files.readConfig()).toEqual({ config: EMPTY_ASSISTANT_CONFIG, problem: null });
    fs.writeFileSync(path.join(dir, ASSISTANT_CONFIG_FILE), '{nope');
    expect(files.readConfig().problem).toMatch(/not JSON/);
    fs.writeFileSync(path.join(dir, ASSISTANT_CONFIG_FILE), JSON.stringify({ ...config('api.example.test'), key: KEY }));
    expect(files.readConfig()).toMatchObject({ config: EMPTY_ASSISTANT_CONFIG, problem: expect.stringMatching(/not hold a valid/) });
  });
  it('stores the host as a plain host name; https:// is reduced; http, a port, a path, an address and an unlisted host are refused', () => {
    const files = new AssistantFiles(tmp(), ['api.example.test']);
    expect(files.writeConfig(config('https://API.example.test/')).host).toBe('api.example.test');
    expect(files.readConfig().config).toMatchObject({ host: 'api.example.test', toggles: { peopleNames: true } });
    expect(err(() => files.writeConfig(config('other.example.test')))).toBe('409:host_not_allowed+hint');
    for (const h of ['http://api.example.test', 'api.example.test:443', 'https://api.example.test/v1', '127.0.0.1', 'ftp://api.example.test'])
      expect(err(() => normalizeHost(h, ['api.example.test', '127.0.0.1'])), h).toBe('400:invalid_request+hint');
    expect(normalizeHost(null, [])).toBeNull();
    expect(files.writeConfig(config(null)).host).toBeNull();
  });
});

describe('redact', () => {
  it('removes the key, also URL-encoded, from what an adapter reports', () => {
    const k = 'TEST/DOUBLE+KEY=1';
    const r = redact(k);
    expect(r(`401: key ${k} refused (${encodeURIComponent(k)})`)).toBe('401: key [redacted] refused ([redacted])');
    expect(redact(null)('x')).toBe('x');
  });
});
