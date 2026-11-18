/**
 * Keeps the Hebrew wording of the fast export's blockers and job failures (packages/i18n/src/renderCache.ts HE_RENDER_CACHE) in
 * step with their fixed English sentences (core renderCache.ts RENDER_CACHE_BLOCKERS, RENDER_CACHE_JOB_ERRORS; ADR-0024). Each
 * blocker is provoked for real through the server's incrementalBlockers, the function Exporter.plan calls; the job failures are
 * built from their table (they are raised by W2's segmented route, which is not built yet). Every pattern is used. Also: the
 * shared strings exist in both languages, every uncacheable reason and every new error code has a headline, and no string
 * promises a speed or says the cache was verified as a whole.
 */
import { describe, expect, it } from 'vitest';
import { RENDER_CACHE_BLOCKERS, RENDER_CACHE_JOB_ERRORS, UNCACHEABLE_CODES, type RenderCacheStatus } from '@pulseframe/core';
import { incrementalBlockers, type IncrementalRoute } from '../../../apps/server/src/export.ts';
import { dictionaries, RENDER_CACHE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { RENDER_CACHE_EN, RENDER_CACHE_HE } from '../../i18n/src/renderCache.ts';

const status: RenderCacheStatus = { enabled: true, capBytes: 1 << 30, usedBytes: 0, segments: 0, highWaterBytes: 0, autoClear: true, minFreeBytes: 1 << 30 };
const route = (join: ReturnType<IncrementalRoute['join']>, capBytes = status.capBytes): IncrementalRoute => ({ status: () => ({ ...status, capBytes, enabled: capBytes > 0 }), join: () => join });
const only = (bs: { message: string }[]) => { expect(bs).toHaveLength(1); return bs[0]!.message; };

/** Every server sentence of the track, provoked where the server can say it today. */
function provoked(): string[] {
  const mp4 = { format: 'mp4-h264-aac' as const, mode: 'incremental' as const };
  return [
    only(incrementalBlockers({ format: 'webm-vp9-opus', mode: 'incremental' }, route({ ok: true }))),
    only(incrementalBlockers({ format: 'gif', mode: 'incremental' }, route({ ok: true }))),
    only(incrementalBlockers(mp4, route({ ok: true }, 0))),
    only(incrementalBlockers(mp4, null)),
    only(incrementalBlockers(mp4, route(null))),
    only(incrementalBlockers(mp4, route({ ok: false, reason: 'ffmpeg 4.4 has no setts bitstream filter' }))),
    RENDER_CACHE_JOB_ERRORS.selfCheckFailed.message(1200, 60, 1234, 12),
    RENDER_CACHE_JOB_ERRORS.joinMismatch.message(1800),
  ];
}

describe('fast export refusals in Hebrew (ADR-0024)', () => {
  it('each blocker and job failure is worded in Hebrew, keeping its numbers; every pattern of the table is used', () => {
    const used = new Set<RegExp>();
    for (const message of provoked()) {
      const he = translateRefusal('he', message);
      expect(he, message).toBeDefined();
      expect(/[֐-׿]/.test(he!), message).toBe(true);
      for (const n of message.match(/\b\d+\b/g) ?? []) if (!/ffmpeg 4\.4/.test(message)) expect(he, `${message} keeps ${n}`).toContain(n);
      for (const re of RENDER_CACHE_REFUSAL_PATTERNS) if (re.test(message)) used.add(re);
    }
    expect(used.size).toBe(RENDER_CACHE_REFUSAL_PATTERNS.length);
    expect(RENDER_CACHE_REFUSAL_PATTERNS.length).toBe(Object.keys(RENDER_CACHE_BLOCKERS).length + Object.keys(RENDER_CACHE_JOB_ERRORS).length);
  });
  it('the reasons the server gives for "not available" have Hebrew words; an unknown reason is kept as written, isolated left to right', () => {
    expect(translateRefusal('he', only(incrementalBlockers({ format: 'mp4-h264-aac', mode: 'incremental' }, null)))).toBe('ייצוא מהיר אינו זמין במחשב הזה: מסלול הייצוא המהיר עוד לא הושלם בגרסה הזו');
    expect(translateRefusal('he', only(incrementalBlockers({ format: 'mp4-h264-aac', mode: 'incremental' }, route({ ok: false, reason: 'no setts' }))))).toBe('ייצוא מהיר אינו זמין במחשב הזה: ⁦no setts⁩');
    expect(translateRefusal('he', only(incrementalBlockers({ format: 'webm-vp9-opus', mode: 'incremental' }, null)))).toBe('ייצוא מהיר זמין כרגע רק ל־MP4; ⁦WebM⁩ מיוצא במעבר אחד');
  });
  it('every code of the track has a headline in both languages, and they differ', () => {
    const codes = [...Object.values(RENDER_CACHE_BLOCKERS).map((b) => b.code), ...Object.values(RENDER_CACHE_JOB_ERRORS).map((e) => e.code)];
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const c of codes) expect(d[`error.code.${c}`]?.trim(), `${lang} ${c}`).toBeTruthy();
      for (const c of UNCACHEABLE_CODES) expect(d[`cache.uncacheable.${c}`]?.trim(), `${lang} ${c}`).toBeTruthy();
    }
    for (const c of codes) expect(dictionaries.he[`error.code.${c}` as keyof typeof dictionaries.he]).not.toBe(dictionaries.en[`error.code.${c}` as keyof typeof dictionaries.en]);
  });
  it('the shared strings cover the same keys in both languages, and none promises a speed or says the cache was verified', () => {
    expect(Object.keys(RENDER_CACHE_EN).sort()).toEqual(Object.keys(RENDER_CACHE_HE).sort());
    const all = [...Object.values(RENDER_CACHE_HE), ...Object.values(RENDER_CACHE_EN), ...provoked().map((m) => translateRefusal('he', m)!)];
    for (const s of all) {
      expect(s).not.toMatch(/מהיר פי|פי \d|\d+x faster|times faster|guarantee|מובטח|בוודאות|certain/i);
      expect(s).not.toMatch(/המטמון (נבדק|אומת)|cache (was|is) (verified|checked)/i);
    }
  });
});
