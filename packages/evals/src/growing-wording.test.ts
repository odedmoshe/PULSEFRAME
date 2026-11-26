/**
 * Keeps the Hebrew wording of the growing refusals (packages/i18n/src/growing.ts HE_GROWING) in step with the fixed English of core
 * growingContract.ts (GROWING_REFUSALS) and apps/server/src/growing.ts (GROWING_API_ERRORS): every sentence is worded in Hebrew with
 * a next step, no pattern is unused, the shared strings exist in both languages, the Hebrew is plural (no gendered imperative), and
 * nothing is called sharp, perfect, right or AI. The server refusals are provoked for real in apps/server/src/growing.test.ts; the
 * planner's come from the table until W1's planGrowing exists (W1 then provokes each, todo below; W1 may edit only that line).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { createProject, GROWING_BUILT, GROWING_REFUSALS, GrowingError, GrowingNotBuilt, planGrowing, type Asset } from '@pulseframe/core';
import { GROWING_API_ERRORS } from '../../../apps/server/src/growing.ts';
import { dictionaries, GROWING_EN, GROWING_HE, GROWING_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const core = Object.values(GROWING_REFUSALS).map((r) => (r.message as (...a: unknown[]) => string)(11));
core.push(GROWING_REFUSALS.badParams.message('picks: Too small'));
const E = GROWING_API_ERRORS;
const server = [E.ownerRequired(), E.notBuilt(), E.runNotFound('run_x')];
const all = [...core, ...server.map((e) => e.message)];

describe('growing refusals in Hebrew', () => {
  it('every sentence is worded, in Hebrew, with a next step', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, nextStep: /[.:;—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of HE_GROWING is used, and each sentence is answered by the growing table', () => {
    expect(GROWING_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
    for (const en of all) expect({ en, ours: GROWING_REFUSAL_PATTERNS.some((re) => re.test(en)) }).toEqual({ en, ours: true });
  });
  it('the shared strings: same keys in both languages, in the dictionaries, the C7 privacy sentence word for word, nothing forbidden', () => {
    expect(Object.keys(GROWING_EN).sort()).toEqual(Object.keys(GROWING_HE).sort());
    for (const k of Object.keys(GROWING_HE)) { expect((dictionaries.he as Record<string, string>)[k]).toBe((GROWING_HE as Record<string, string>)[k]); expect((dictionaries.en as Record<string, string>)[k]).toBe((GROWING_EN as Record<string, string>)[k]); }
    expect(GROWING_HE['growing.privacy']).toBe('מיקום התמונות בסרט נשמר כמו כל עריכה, ואפשר לחשב ממנו היכן היו העיניים. הסימונים עצמם לא נשמרים.');
    const texts = [...Object.values(GROWING_HE), ...Object.values(GROWING_EN), ...all.map((en) => translateRefusal('he', en)!)];
    for (const s of texts) {
      expect({ s, forbidden: /\b(sharp|perfect|perfectly|correct|verified|AI)\b|מושלם|(^|\s)חד(ה|ות|ים)?(\s|$)|מאומת|בינה מלאכותית|לעולם לא מגיע/i.test(s) }).toEqual({ s, forbidden: false });
      // plural, ungendered Hebrew: no singular imperatives of the usual verbs
      expect({ s, gendered: /(^|\s)(בחר|בחרי|לחץ|לחצי|סמן|סמני|פתח|פתחי|הסר|הסירי)(\s|$|\.)/.test(s) }).toEqual({ s, gendered: false });
    }
  });
  it('W1: each GROWING_REFUSALS sentence is provoked through the real planGrowing and answers its code (notBuilt only while GROWING_BUILT is off)', () => {
    const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00.000Z', importedBy: 'test' };
    const doc = createProject({ id: 'prj_w', name: 'w', frameRate: { num: 30, den: 1 } });
    const h = (n: number) => `sha256:${String(n).padStart(64, '0')}`;
    doc.assets.p = { id: 'p', kind: 'image', name: 'p.jpg', contentHash: h(1), byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: 1200, height: 1600, codec: 'mjpeg', hasAlpha: false }, provenance: prov } as Asset;
    doc.assets.q = { ...doc.assets.p, id: 'q', contentHash: h(2) } as Asset;
    doc.assets.v = { id: 'v', kind: 'video', name: 'v.mp4', contentHash: h(3), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(100, { num: 30, den: 1 }), video: { width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 90 }, provenance: prov } as Asset;
    doc.assets.s = { id: 's', kind: 'audio', name: 's.wav', contentHash: h(4), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.frameTime(100, { num: 30, den: 1 }), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as Asset;
    const eyes = [{ u: 0.45, v: 0.4 }, { u: 0.55, v: 0.4 }];
    const pick = (assetId: string, frame: number | null = null, e: unknown = eyes) => ({ assetId, frame, ...(e ? { eyes: e } : {}) });
    const two = (first: object) => ({ picks: [first, pick('q')] });
    const cases: Record<Exclude<keyof typeof GROWING_REFUSALS, 'notBuilt'>, [unknown, unknown[]]> = {
      badParams: [{ ...two(pick('p')), dissolve: 'fast' }, []], // the zod path follows the fixed words
      tooFew: [{ picks: [pick('p')] }, []],
      assetMissing: [two(pick('gone')), []],
      noPicture: [two(pick('s')), []],
      frameOnStill: [two(pick('p', 3)), []],
      noFrame: [two(pick('v')), []],
      noSuchFrame: [two(pick('v', 90)), []],
      duplicatePick: [{ picks: [pick('p'), pick('p')] }, []],
      eyesTooClose: [two(pick('p', null, [{ u: 0.5, v: 0.5 }, { u: 0.501, v: 0.5 }])), []],
      needsMarks: [two(pick('p', null, null)), []],
      holdTooShort: [{ ...two(pick('p')), holdFrames: 10 }, [11]],
      personMissing: [{ ...two(pick('p')), personId: 'nobody' }, []],
    };
    for (const [key, [params, args]] of Object.entries(cases)) {
      const r = GROWING_REFUSALS[key as keyof typeof GROWING_REFUSALS];
      let e: unknown;
      try { planGrowing(doc, params, { capture: {} }); } catch (x) { e = x; }
      expect({ key, isRefusal: e instanceof GrowingError }).toEqual({ key, isRefusal: true });
      const g = e as GrowingError;
      expect({ key, code: g.code }).toEqual({ key, code: r.code });
      if (key !== 'badParams') expect({ key, message: g.message }).toEqual({ key, message: (r.message as (...a: unknown[]) => string)(...args) });
      else expect(g.message.startsWith((r.message as (...a: unknown[]) => string)(''))).toBe(true);
      const he = translateRefusal('he', g.message);
      expect({ key, hebrew: !!he && /[֐-׿]/.test(he) }).toEqual({ key, hebrew: true });
    }
    // notBuilt is the stubs' honest state: once GROWING_BUILT is on, planGrowing never answers it
    expect(GROWING_BUILT).toBe(true);
    expect(new GrowingNotBuilt('x').message).toBe(GROWING_REFUSALS.notBuilt.message());
  });
});
