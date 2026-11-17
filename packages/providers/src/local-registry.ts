/**
 * Reviewed local tools (ADR-0017, route R3): PULSEFRAME-owned code run by an operator-installed engine, pinned by `codeDigest`
 * (sha256 over the listed code files, concatenated in order). The server (apps/server/src/localtools.ts) refuses to run a tool whose
 * installed code differs from that digest (code_digest_mismatch), verifies every model file by size and SHA-256 before it counts as
 * ready, and verifies an operator-installed binary against `verifiedBinaries` (anything else is engine_unverified). Nothing here
 * downloads, installs or runs anything.
 *
 * Model and binary records come from the wave's pin table (aiPins.ts: AI_WAVE_PINS, OPUS_MT_SMALL_FILES).
 * A change to any listed code file changes its digest: update the digest here in the same change (local-registry.test.ts checks it).
 */
import { AI_WAVE_PINS, OPUS_MT_ATTRIBUTION, OPUS_MT_SMALL_FILES, type FilePin, type SmallFilePin } from './aiPins.ts';
import { LocalToolDescriptorSchema, type CapabilityModel, type LocalToolDescriptor } from './descriptor.ts';

const NA = { status: 'not_applicable' as const };
const RUN_EARNED = {
  executed: { status: 'not_assessed' as const, evidence: 'set from a recorded run on a named profile' },
  hardwareQualified: { status: 'not_assessed' as const, evidence: 'set from a recorded run; a CPU run is not GPU qualification' },
};
const NO_COST = { cents: 0, basis: 'runs locally; no charge' };
/** The runner's code: extraction, engine invocation, validation and the ffmpeg filter chains are all in this file. */
const RUNNER = 'apps/server/src/localtools.ts';
const WORKER = 'apps/server/tools/pf_tools.py';

const revisionOf = (url: string) => /\/resolve\/([0-9a-f]{40})\//.exec(url)?.[1] ?? null;
function opusModels(dir: string, publisher: string, weights: FilePin, small: readonly SmallFilePin[], licence: string): CapabilityModel[] {
  const rev = revisionOf(weights.url);
  const evidence = `${weights.licence} Pinned at ${publisher}@${rev}; ${weights.evidence}. The tokenizer and configuration files were downloaded by the lead at the same revision on 2026-11-17 (sha256 of the bytes received). Training-data residual risk: the Tatoeba release is CC-BY-NC-SA (a recorded residual risk; accepted on that footing in the wave-3 lead decisions of 2026-11-17).`;
  const rec = (role: string, file: string, bytes: number, sha256: string, source: string): CapabilityModel => ({
    role, path: `${dir}/${file}`, publisher, revision: rev, sha256, bytes, license: licence, licenseEvidence: evidence, commercialUse: 'allowed', gated: false, source, attribution: OPUS_MT_ATTRIBUTION,
  });
  return [
    rec('translation', weights.file, weights.bytes, weights.sha256, weights.url),
    ...small.map((f) => rec(f.file.endsWith('.spm') || f.file === 'vocab.json' ? 'tokenizer' : 'config', f.file, f.bytes, f.sha256, f.url)),
  ];
}

const translateInputs = [
  { name: 'captionTrackId', label: { he: 'רצועת כתוביות ידנית (במקום תמלול)', en: 'Manual caption track (instead of a transcript)' }, type: 'string' as const, binding: null, required: false, maxLength: 64, reviewed: true },
  { name: 'baseVariantId', label: { he: 'פורמט בסיס (גודל, מסגרת וסגנון כתוביות)', en: 'Base format (size, frame and caption style)' }, type: 'string' as const, binding: null, required: false, maxLength: 64, reviewed: true },
  { name: 'variantId', label: { he: 'פורמט שפה קיים לעדכון', en: 'Existing language format to update' }, type: 'string' as const, binding: null, required: false, maxLength: 64, reviewed: true },
  { name: 'name', label: { he: 'שם הפורמט', en: 'Format name' }, type: 'string' as const, binding: null, required: false, maxLength: 80, reviewed: true },
];
const translationOutput = [{ name: 'translation', role: 'primary' as const, mediaType: 'data' as const, nodeId: null, encoding: 'display' as const, expectSize: null, expectFrames: null, dataSchema: 'translation.v1' as const, reviewed: true }];
const translateLimitations = [
  'Machine translation: it needs a human review before publishing. Nothing is called reviewed until the owner marks it so.',
  'Phrase-timed: each translated phrase keeps the master phrase\'s times; words are never mapped one by one (SPEC §16).',
  'Stored as a language format (variant); one export shows one language. Two languages at once cannot be burned in yet.',
  'Runs on the CPU unless the tools environment has a CUDA device; speed has not been measured on any profile.',
  'A phrase longer than the model reads at once (512 tokens) is refused, not cut.',
  'Credit: OPUS-MT is CC-BY 4.0 and must be credited in the notices.',
];
function translator(from: 'he' | 'en', to: 'he' | 'en', models: CapabilityModel[], digest: string): LocalToolDescriptor {
  const he = { he: 'עברית', en: 'אנגלית' }, en = { he: 'Hebrew', en: 'English' };
  return LocalToolDescriptorSchema.parse({
    id: `local.text.translate-${from}-${to}`,
    version: '0.1.0',
    provider: 'local',
    state: 'published',
    title: { he: `תרגום כתוביות מ${he[from]} ל${he[to]} (תרגום מכונה)`, en: `Translate captions, ${en[from]} to ${en[to]} (machine translation)` },
    description: {
      he: `מתרגם את משפטי התמלול או את כתוביות הרצועה הידנית מ${he[from]} ל${he[to]} ושומר אותם כפורמט שפה חדש. התזמון של כל משפט נשמר; התרגום מסומן «לא נבדק» עד שבעל הפרויקט בודק אותו.`,
      en: `Translates the transcript phrases or the cues of a manual caption track from ${en[from]} to ${en[to]} and stores them as a new language format. Every phrase keeps its timing; the translation is marked "not reviewed" until the owner reviews it.`,
    },
    source: { repository: null, commit: null, notices: `Tool code authored for PULSEFRAME (${WORKER}, ${RUNNER}). Models: ${OPUS_MT_ATTRIBUTION}` },
    engine: { kind: 'python-worker', configVar: 'PF_TOOLS_PYTHON', verifiedBinaries: [] },
    task: 'translate',
    codeFiles: [WORKER, RUNNER],
    codeDigest: digest,
    inputs: translateInputs,
    outputs: translationOutput,
    models,
    limits: { maxFrames: null, maxPixels: null },
    resources: { downloadBytes: models.reduce((n, m) => n + m.bytes!, 0), estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
    cost: NO_COST,
    egress: 'none',
    languages: [from, to],
    limitations: translateLimitations,
    qualification: {
      schemaValid: { status: 'pass', evidence: 'LocalToolDescriptorSchema + code digest' },
      dependencyReady: { status: 'pass', evidence: 'pinned files verified by size and SHA-256 at run time; the tools environment is probed (torch, transformers, sentencepiece) before every run' },
      licenseReviewed: { status: 'pass', evidence: 'CC-BY 4.0 at the publisher (attribution in the notices); Tatoeba training-data term recorded as a residual risk; accepted in the wave-3 lead decisions (2026-11-17)' },
      ...RUN_EARNED,
      qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed translation set' },
      hebrewQualified: { status: 'not_assessed', evidence: 'nobody has read the Hebrew output yet; the owner (or someone they name) must' },
    },
  });
}

/** Digests of the listed code files (sha256 over their bytes in order). Checked by local-registry.test.ts. */
const DIGEST = {
  translate: 'sha256:b80939b568cb97384c0a953a32f1a83ca6c2bc30f5cfe87a6439c845fc198b87',
  runner: 'sha256:346cd815009d54b57963edae5a5b7a0c3a09a230efa7c7186a7b168129462b6f',
};

export const TRANSLATE_HE_EN = translator('he', 'en', opusModels('translate/opus-mt-tc-big-he-en', 'Helsinki-NLP/opus-mt-tc-big-he-en', AI_WAVE_PINS.opusMtHeEnWeights, OPUS_MT_SMALL_FILES['he-en'], 'CC-BY-4.0'), DIGEST.translate);
export const TRANSLATE_EN_HE = translator('en', 'he', opusModels('translate/opus-mt-en-he', 'Helsinki-NLP/opus-mt-en-he', AI_WAVE_PINS.opusMtEnHeWeights, OPUS_MT_SMALL_FILES['en-he'], 'CC-BY-4.0'), DIGEST.translate);

const dfn = AI_WAVE_PINS.deepFilterNet3Model, dfBin = AI_WAVE_PINS.deepFilterLinuxMusl;
/** «ניקוי קול בבינה מלאכותית»: a job that makes a new, cleaned copy of the sound (distinct from the DSP effect «ניקוי קול», ADR-0013). */
export const VOICE_CLEAN = LocalToolDescriptorSchema.parse({
  id: 'local.voice.clean',
  version: '0.1.0',
  provider: 'local',
  state: 'published',
  title: { he: 'ניקוי קול בבינה מלאכותית', en: 'AI voice cleanup' },
  description: {
    he: 'מסיר רעשי רקע מדיבור בעזרת מודל DeepFilterNet3 ויוצר עותק חדש ונקי של הקול, באותו תזמון בדיוק. הקובץ המקורי לא משתנה.',
    en: 'Removes background noise from speech with the DeepFilterNet3 model and makes a new, cleaned copy of the sound with exactly the same timing. The original file is not changed.',
  },
  source: { repository: 'https://github.com/Rikorose/DeepFilterNet', commit: 'v0.5.6', notices: `Runner authored for PULSEFRAME (${RUNNER}). Engine and model: DeepFilterNet 0.5.6 by Hendrik Schröter, MIT OR Apache-2.0.` },
  engine: { kind: 'binary', configVar: 'PF_DENOISE_BIN', verifiedBinaries: [{ platform: 'linux-x64', version: '0.5.6', bytes: dfBin.bytes, sha256: dfBin.sha256, source: dfBin.url }] },
  task: 'voice-clean',
  codeFiles: [RUNNER],
  codeDigest: DIGEST.runner,
  inputs: [
    { name: 'attenLimitDb', label: { he: 'הנחתת רעש מרבית (דציבל; 100 = ללא הגבלה)', en: 'Most noise reduction (dB; 100 = no limit)' }, type: 'int', binding: null, required: false, default: 100, allowed: [6, 12, 24, 100], reviewed: true },
  ],
  outputs: [{ name: 'voice', role: 'primary', mediaType: 'audio', nodeId: null, encoding: 'display', expectSize: null, expectFrames: null, dataSchema: null, reviewed: true }],
  models: [{
    role: 'denoise', path: `denoise/${dfn.file}`, publisher: 'Rikorose/DeepFilterNet', revision: 'v0.5.6', sha256: dfn.sha256, bytes: dfn.bytes,
    license: 'MIT OR Apache-2.0', licenseEvidence: `${dfn.licence}. ${dfn.evidence}.`, commercialUse: 'allowed', gated: false, source: dfn.url, attribution: null,
  }],
  limits: { maxFrames: null, maxPixels: null },
  resources: { downloadBytes: dfn.bytes, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
  cost: NO_COST,
  egress: 'none',
  languages: [],
  limitations: [
    'Made for speech: steady tones and music under the voice can be removed as noise.',
    'The result is mono, 48 kHz.',
    'Up to 30 minutes per run.',
    'Not quality-reviewed: nobody has listened to a reviewed set of results.',
    'Runs on the CPU; the engine reports no progress while it works.',
  ],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'LocalToolDescriptorSchema + code digest' },
    dependencyReady: { status: 'pass', evidence: 'operator-installed binary verified by SHA-256 against verifiedBinaries; model file verified by size and SHA-256 at run time' },
    licenseReviewed: { status: 'pass', evidence: 'MIT OR Apache-2.0 for code and weights at the publisher (DeepFilterNet README); wave-3 lead decisions (2026-11-17)' },
    ...RUN_EARNED,
    qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed listening set' },
    hebrewQualified: { status: 'not_assessed', evidence: 'nobody has listened to Hebrew results yet' },
  },
});

/** Classic centre-channel cancellation with ffmpeg: no model, labelled «קלאסי, לא בינה מלאכותית». */
export const VOCALS_CLASSIC = LocalToolDescriptorSchema.parse({
  id: 'local.audio.vocals-classic',
  version: '0.1.0',
  provider: 'local',
  state: 'published',
  title: { he: 'הסרת שירה (קלאסי, לא בינה מלאכותית)', en: 'Remove vocals (classic, not AI)' },
  description: {
    he: 'מבטל את מה שנמצא בדיוק במרכז הסטריאו, בדרך כלל השירה, ויוצר עותק חדש של הצליל. אפשר לשמור את הבס. לא עובד על הקלטות מונו.',
    en: 'Cancels what sits exactly in the centre of the stereo picture, usually the vocals, and makes a new copy of the sound. The bass can be kept. Does not work on mono recordings.',
  },
  source: { repository: null, commit: null, notices: `Filter chain authored for PULSEFRAME (${RUNNER}); uses ffmpeg's pan, lowpass and amix filters.` },
  engine: { kind: 'ffmpeg', configVar: null, verifiedBinaries: [] },
  task: 'vocals-classic',
  codeFiles: [RUNNER],
  codeDigest: DIGEST.runner,
  inputs: [
    { name: 'keepBass', label: { he: 'לשמור את הבס (מתחת ל־150 הרץ)', en: 'Keep the bass (below 150 Hz)' }, type: 'boolean', binding: null, required: false, default: false, reviewed: true },
  ],
  outputs: [{ name: 'accompaniment', role: 'primary', mediaType: 'audio', nodeId: null, encoding: 'display', expectSize: null, expectFrames: null, dataSchema: null, reviewed: true }],
  models: [],
  limits: { maxFrames: null, maxPixels: null },
  resources: { downloadBytes: 0, estimatedResidencyBytes: 0, hostRamBytes: null, measuredProfiles: [] },
  cost: NO_COST,
  egress: 'none',
  languages: [],
  limitations: [
    'Classic, not AI: it removes everything mixed exactly to the centre (often also bass, kick drum and speech) and keeps reverb that is not centred.',
    'Needs a stereo recording whose channels differ; an effectively mono recording (left and right more than 98% alike) is refused.',
    'The result is stereo, 48 kHz; up to 30 minutes per run.',
  ],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'LocalToolDescriptorSchema + code digest' },
    dependencyReady: { status: 'pass', evidence: 'ffmpeg only; no models' },
    licenseReviewed: { status: 'pass', evidence: 'no model weights; filter chain authored in this repository' },
    ...RUN_EARNED,
    qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed listening set' },
    hebrewQualified: NA,
  },
});

export const LOCAL_TOOLS: LocalToolDescriptor[] = [TRANSLATE_HE_EN, TRANSLATE_EN_HE, VOICE_CLEAN, VOCALS_CLASSIC];
