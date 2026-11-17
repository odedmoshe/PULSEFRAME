/** Reviewed local tools (ADR-0017): pinned code, pinned files, licence eligibility. No engine, model or network is touched. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_WAVE_PINS, OPUS_MT_ATTRIBUTION, OPUS_MT_SMALL_FILES } from './aiPins.ts';
import { DescriptorSchema, publicationBlockers, resolveParams, type LocalToolDescriptor } from './descriptor.ts';
import { ALL_CAPABILITIES, BUILTIN_CAPABILITIES } from './index.ts';
import { LOCAL_TOOLS, TRANSLATE_EN_HE, TRANSLATE_HE_EN, VOCALS_CLASSIC, VOICE_CLEAN } from './local-registry.ts';

const root = path.resolve(import.meta.dirname, '../../..');
/** Blockers a recorded run (or a human review) earns; they never stop a run (apps/server capabilities.ts and localtools.ts). */
const RUN_EARNED = new Set(['not_executed', 'not_hardwareQualified', 'not_qualityReviewed', 'not_hebrewQualified']);
/** The rule model downloads are refused by (apps/server capabilities.ts startDownload, localtools.ts licenceBlockers). */
const downloadBlockers = (d: LocalToolDescriptor) => publicationBlockers(d, 'commercial').filter((b) => /model|license|unresolved/i.test(b.code));

describe('local tools registry', () => {
  it('lists the four reviewed tools, all provider local, in the one registry and not clashing with the ComfyUI ids', () => {
    expect(LOCAL_TOOLS.map((d) => d.id)).toEqual(['local.text.translate-he-en', 'local.text.translate-en-he', 'local.voice.clean', 'local.audio.vocals-classic']);
    for (const d of LOCAL_TOOLS) {
      expect(d.provider).toBe('local');
      expect(ALL_CAPABILITIES).toContain(d);
      expect(BUILTIN_CAPABILITIES.some((b) => b.id === d.id)).toBe(false);
    }
  });
  it('every codeDigest equals the sha256 of its code files, concatenated in the listed order, with CRLF line endings read as LF', () => {
    for (const d of LOCAL_TOOLS) {
      const h = createHash('sha256');
      for (const f of d.codeFiles) {
        expect(fs.existsSync(path.join(root, f)), f).toBe(true);
        // A Windows checkout (core.autocrlf) has CRLF files with the same code; the digest is over the LF form (localtools.ts).
        h.update(fs.readFileSync(path.join(root, f), 'latin1').replace(/\r\n/g, '\n'), 'latin1');
      }
      expect(d.codeDigest, `${d.id}: update DIGEST in local-registry.ts after changing ${d.codeFiles.join(', ')}`).toBe(`sha256:${h.digest('hex')}`);
    }
  });
  it('descriptors parse unchanged under the union schema, and a wrong installed digest is a blocker', () => {
    for (const d of LOCAL_TOOLS) {
      expect(DescriptorSchema.parse(JSON.parse(JSON.stringify(d)))).toEqual(d);
      expect(publicationBlockers(d, 'commercial', { codeDigest: `sha256:${'0'.repeat(64)}` }).map((b) => b.code)).toContain('code_digest_mismatch');
      expect(publicationBlockers(d, 'commercial', { codeDigest: d.codeDigest }).map((b) => b.code)).not.toContain('code_digest_mismatch');
    }
  });
  it('commercial profile: no licence, model, structure or egress blockers for all four; only what a run or a human review earns is open', () => {
    for (const d of LOCAL_TOOLS) {
      const left = publicationBlockers(d, 'commercial', { codeDigest: d.codeDigest }).filter((b) => !RUN_EARNED.has(b.code));
      expect(left, d.id).toEqual([]);
      expect(downloadBlockers(d), d.id).toEqual([]);
    }
  });
  it('a test copy with commercialUse "unknown" is blocked for both run and download', () => {
    for (const real of LOCAL_TOOLS.filter((d) => d.models.length)) {
      // TEST COPY (labelled): the real descriptor with one model record's commercial-use field changed.
      const copy: LocalToolDescriptor = { ...real, models: real.models.map((m, i) => (i === 0 ? { ...m, commercialUse: 'unknown' as const } : m)) };
      const run = publicationBlockers(copy, 'commercial', { codeDigest: copy.codeDigest }).filter((b) => !RUN_EARNED.has(b.code));
      expect(run.map((b) => b.code), real.id).toContain('model_not_commercially_eligible');
      expect(downloadBlockers(copy).length, real.id).toBeGreaterThan(0);
      expect(publicationBlockers(copy, 'research').filter((b) => !RUN_EARNED.has(b.code)), 'research profile allows it').toEqual([]);
    }
  });
});

describe('pinned files', () => {
  it('translation models are the pinned OPUS-MT files at one revision, in one directory, with CC-BY attribution', () => {
    for (const [d, weights, small, dir] of [[TRANSLATE_HE_EN, AI_WAVE_PINS.opusMtHeEnWeights, OPUS_MT_SMALL_FILES['he-en'], 'translate/opus-mt-tc-big-he-en'], [TRANSLATE_EN_HE, AI_WAVE_PINS.opusMtEnHeWeights, OPUS_MT_SMALL_FILES['en-he'], 'translate/opus-mt-en-he']] as const) {
      expect(d.models[0]).toMatchObject({ path: `${dir}/${weights.file}`, sha256: weights.sha256, bytes: weights.bytes, source: weights.url, commercialUse: 'allowed' });
      expect(d.models.slice(1).map((m) => [m.path, m.sha256, m.bytes, m.source])).toEqual(small.map((f) => [`${dir}/${f.file}`, f.sha256, f.bytes, f.url]));
      const rev = /\/resolve\/([0-9a-f]{40})\//.exec(weights.url)![1]!;
      for (const m of d.models) {
        expect(path.posix.dirname(m.path)).toBe(dir);
        expect(m.revision).toBe(rev);
        expect(m.source).toMatch(new RegExp(`^https://huggingface\\.co/Helsinki-NLP/[^/]+/resolve/${rev}/`));
        expect(m.attribution).toBe(OPUS_MT_ATTRIBUTION);
        expect(m.license).toBe('CC-BY-4.0');
      }
      expect(d.resources.downloadBytes).toBe(weights.bytes + small.reduce((n, f) => n + f.bytes, 0));
      expect(d.outputs).toEqual([expect.objectContaining({ mediaType: 'data', dataSchema: 'translation.v1', nodeId: null })]);
      expect(d.engine).toEqual({ kind: 'python-worker', configVar: 'PF_TOOLS_PYTHON', verifiedBinaries: [] });
    }
    // he-en ships safetensors; en-he only a pickle checkpoint (loaded weights-only by the worker)
    expect(TRANSLATE_HE_EN.models[0]!.path.endsWith('.safetensors')).toBe(true);
    expect(TRANSLATE_EN_HE.models[0]!.path.endsWith('pytorch_model.bin')).toBe(true);
  });
  it('voice cleanup: the operator-installed deep-filter build and the DeepFilterNet3 model are the pinned ones', () => {
    expect(VOICE_CLEAN.engine).toEqual({ kind: 'binary', configVar: 'PF_DENOISE_BIN', verifiedBinaries: [{ platform: 'linux-x64', version: '0.5.6', bytes: AI_WAVE_PINS.deepFilterLinuxMusl.bytes, sha256: AI_WAVE_PINS.deepFilterLinuxMusl.sha256, source: AI_WAVE_PINS.deepFilterLinuxMusl.url }] });
    expect(VOICE_CLEAN.models).toEqual([expect.objectContaining({ path: 'denoise/DeepFilterNet3_onnx.tar.gz', sha256: AI_WAVE_PINS.deepFilterNet3Model.sha256, bytes: AI_WAVE_PINS.deepFilterNet3Model.bytes, source: AI_WAVE_PINS.deepFilterNet3Model.url, commercialUse: 'allowed' })]);
    expect(VOCALS_CLASSIC.models).toEqual([]);
    expect(VOCALS_CLASSIC.engine.kind).toBe('ffmpeg');
  });
});

describe('controls and names', () => {
  it('voice cleanup takes only the reviewed attenuation limits', () => {
    expect(resolveParams(VOICE_CLEAN, {}).resolved).toEqual({ attenLimitDb: 100 });
    for (const v of [6, 12, 24, 100]) expect(resolveParams(VOICE_CLEAN, { attenLimitDb: v }).resolved.attenLimitDb).toBe(v);
    for (const v of [0, 50, 6.5, '12']) expect(() => resolveParams(VOICE_CLEAN, { attenLimitDb: v })).toThrow();
    expect(() => resolveParams(VOICE_CLEAN, { path: '/etc/passwd' })).toThrow(/not a parameter/);
  });
  it('local tools bind nothing to a graph', () => {
    for (const d of LOCAL_TOOLS) {
      for (const i of d.inputs) expect(i.binding).toBeNull();
      for (const o of d.outputs) expect(o.nodeId).toBeNull();
      expect(d.egress).toBe('none');
    }
  });
  it('names: the AI voice cleanup is distinct from the DSP effect «ניקוי קול»; the vocal remover says it is classic, not AI', () => {
    expect(VOICE_CLEAN.title.he).toBe('ניקוי קול בבינה מלאכותית');
    expect(VOICE_CLEAN.title.he).not.toBe('ניקוי קול');
    expect(VOCALS_CLASSIC.title.he).toContain('קלאסי, לא בינה מלאכותית');
    expect(VOCALS_CLASSIC.title.en).toMatch(/classic, not AI/);
    expect(TRANSLATE_HE_EN.title.he).toContain('מעברית לאנגלית');
    expect(TRANSLATE_EN_HE.title.he).toContain('מאנגלית לעברית');
  });
});
