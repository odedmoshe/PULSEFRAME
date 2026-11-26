import { describe, expect, it } from 'vitest';
import { failureWords, refusalWords, stageWords } from './engineInstall.logic.ts';
import { ENGINE_STRINGS } from './engineInstall.strings.ts';

/** The server's stage lines and codes (apps/server/src/speechEngine.ts; speechEngine.test.ts pins the same literals there). */
const SERVER_STAGES = ['finding Python', 'creating the environment', 'downloading 0 of 24 files', 'downloading 7 of 24 files', 'installing', 'checking the engine', 'removing the unfinished environment', 'queued (waiting for compute: export job_1)'];
const SERVER_FAILURES = ['python_not_found', 'python_unsupported', 'python_not_64bit', 'python_no_venv', 'not_enough_disk', 'network_unavailable', 'proxy_refused', 'pip_failed', 'probe_failed', 'interrupted', 'internal_error'];
const SERVER_REFUSALS = ['owner_required', 'engine_configured_elsewhere', 'engine_already_installed', 'engine_install_running', 'speech_busy', 'platform_unsupported', 'download_size_mismatch', 'storage_quota_exceeded'];

const flat = (o: unknown): string[] => (typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as (v: Record<string, string>) => string)({ mb: '89', files: '24', python: '3.13.1', done: '1', total: '24', n: '2', of: '4', found: '3.15.0', min: '3.12', max: '3.14', direction: 'too_new', need: '445 MB', free: '10 MB', hashMismatch: 'false' }))] : Array.isArray(o) ? o.flatMap(flat) : o && typeof o === 'object' ? Object.values(o).flatMap(flat) : []);

describe('the engine install words', () => {
  it('every server stage line has words in both languages, the download with its numbers', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const s of SERVER_STAGES) expect({ s, other: stageWords(s, lang).text === ENGINE_STRINGS[lang].stages.other }).toEqual({ s, other: false });
      expect(stageWords('downloading 7 of 24 files', lang)).toMatchObject({ step: 2, done: 7, total: 24 });
    }
    expect(stageWords('downloading 7 of 24 files', 'he').text).toBe('מורידים ובודקים קובץ 7 מתוך 24');
  });
  it('every failure code has what happened and a next step, in both languages; pip\'s lines are passed through', () => {
    for (const lang of ['he', 'en'] as const) {
      expect(Object.keys(ENGINE_STRINGS[lang].failures).sort()).toEqual([...SERVER_FAILURES].sort());
      for (const code of SERVER_FAILURES) {
        const w = failureWords({ code, details: { found: '3.15.0', min: '3.12', max: '3.14', direction: 'too_new', neededBytes: 445e6, freeBytes: 1e7, tail: 'ERROR: x' } }, lang);
        expect(w.what.length).toBeGreaterThan(10); expect(w.next.length).toBeGreaterThan(10); expect(w.lines).toBe('ERROR: x');
      }
      for (const code of SERVER_REFUSALS) expect(refusalWords(code, lang)).not.toBe(ENGINE_STRINGS[lang].refusals.other);
    }
    expect(failureWords({ code: 'python_unsupported', details: { found: '3.11.9', min: '3.12', max: '3.14', direction: 'too_old' } }, 'he').what).toContain('ישן מדי');
    expect(failureWords({ code: 'python_not_found' }, 'he').next).toContain('Windows installer (64-bit)');
    expect(failureWords({ code: 'unknown_thing' }, 'en').what).toBe(ENGINE_STRINGS.en.failures.internal_error.what());
  });
  it('Hebrew and English have the same keys; the Hebrew is plural and has no gendered slash forms; nothing promises accuracy', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v).map((x) => `${k}.${x}`) : [k]));
    expect(keys(ENGINE_STRINGS.he).sort()).toEqual(keys(ENGINE_STRINGS.en).sort());
    const he = flat(ENGINE_STRINGS.he).join('\n');
    expect(he).not.toMatch(/[א-ת]\/[א-ת]/); // מצהיר/ה and the like
    expect(he).not.toMatch(/(^|\s)(לחץ|לחצי|בחר|בחרי|התקן|התקיני|בדוק|בדקי|נסה|נסי)(\s|$)/m);
    // the only sentence about accuracy is the one that says installing does not make it accurate
    const rest = [...flat(ENGINE_STRINGS.he), ...flat(ENGINE_STRINGS.en)].filter((x) => x !== ENGINE_STRINGS.he.noPromise && x !== ENGINE_STRINGS.en.noPromise).join('\n');
    expect(rest).not.toMatch(/מדויק|דיוק|accura|guarantee|reliabl/i);
    expect(ENGINE_STRINGS.he.noPromise).toContain('לא מבטיחה');
  });
});
