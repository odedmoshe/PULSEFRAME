/**
 * Exact pins of the AI-model wave's files (ADR-0017), one table for the ComfyUI descriptors (builtin.ts) and the local tools
 * (local-registry.ts), so both use the same bytes and digests. Data only: nothing here downloads, installs or runs anything.
 *
 * Sources: the files downloaded under the owner's grant of 2026-11-17 are recorded in docs/evidence/ai-wave-pins.json (sha256 of the
 * bytes received, compared with the publisher's size and, where one exists, the publisher's digest). The Hugging Face files that are
 * fetched later through the owner-approval download path are pinned by the publisher's LFS sha256 at a fixed revision (repository
 * metadata, checked by HEAD/API in the judged plan); the product verifies size and digest before a file counts as ready.
 * The small OPUS-MT tokenizer and config files have no recorded digest yet, so they are NOT in this table.
 */
export interface FilePin { file: string; url: string; bytes: number; sha256: string; publisher: string; licence: string; evidence: string }

export const AI_WAVE_PINS = {
  realesrganX4plus: {
    file: 'RealESRGAN_x4plus.pth', url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth', bytes: 67040989,
    sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1', publisher: 'xinntao/Real-ESRGAN release v0.1.0',
    licence: 'BSD-3-Clause (publisher LICENSE https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE; no separate weight terms). Residual risk: DIV2K training data is labelled academic-research-only; recorded as a residual risk on the same footing as BiRefNet (the owner approved Real-ESRGAN by name on 2026-11-17; lead decision in docs/BLOCKERS.md B-4).',
    evidence: 'docs/evidence/ai-wave-pins.json: downloaded from the publisher; sha256 equals the digest already pinned from the Hugging Face mirror (byte-identical files)',
  },
  realesrGeneralX4v3: {
    file: 'realesr-general-x4v3.pth', url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth', bytes: 4885111,
    sha256: '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292', publisher: 'xinntao/Real-ESRGAN release v0.2.5.0',
    licence: 'BSD-3-Clause (same publisher repository; no separate weight terms). Same training-data residual risk.',
    evidence: 'docs/evidence/ai-wave-pins.json: md5 equals the publisher\'s Content-MD5 91a7644643c884ee00737db24e478156; sha256 recorded at that download',
  },
  rifeV425: {
    file: 'rife_v4.25.safetensors', url: 'https://huggingface.co/Comfy-Org/Frame-Interpolation/resolve/aa7009be4d1471ea0bac91d6fe4d7e4b637cbbfc/frame_interpolation/rife_v4.25.safetensors', bytes: 22674688,
    sha256: '1505884b9bdae956795430d2a70f7e2317b2abd8f130f8cfdb35a5759f909481', publisher: 'hzwer/Practical-RIFE v4.25; file as repacked (keys renamed) by Comfy-Org',
    licence: 'MIT per the original publisher ("The content of these links is under the same MIT license as this project", https://github.com/hzwer/Practical-RIFE). Recorded as a key-renamed repack. Vimeo-90K training terms not reviewed.',
    evidence: 'LFS sha256 (x-linked-etag) at the pinned revision; not downloaded yet (fetched by proof:ai-trials through the owner-approval download path)',
  },
  deepFilterNet3Model: {
    file: 'DeepFilterNet3_onnx.tar.gz', url: 'https://raw.githubusercontent.com/Rikorose/DeepFilterNet/v0.5.6/models/DeepFilterNet3_onnx.tar.gz', bytes: 7983136,
    sha256: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616', publisher: 'Rikorose/DeepFilterNet tag v0.5.6',
    licence: 'MIT OR Apache-2.0 (code and weights; DeepFilterNet README)',
    evidence: 'docs/evidence/ai-wave-pins.json: size equals the publisher\'s Content-Length; no published digest, sha256 recorded at that download',
  },
  deepFilterLinuxMusl: {
    file: 'deep-filter-0.5.6-x86_64-unknown-linux-musl', url: 'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-unknown-linux-musl', bytes: 36417296,
    sha256: '70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da', publisher: 'Rikorose/DeepFilterNet release v0.5.6',
    licence: 'MIT OR Apache-2.0',
    evidence: 'docs/evidence/ai-wave-pins.json: size equals the publisher\'s Content-Length; sha256 recorded. An operator-installed engine (verifiedBinaries): the product verifies it and never installs or downloads it. Not kept on this machine (deleted unexecuted).',
  },
  opusMtHeEnWeights: {
    file: 'model.safetensors', url: 'https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-he-en/resolve/134c5a850dcaa763eec85bd1f4eb25112fecedbb/model.safetensors', bytes: 476295730,
    sha256: 'a87ec3a7225963cbc97874f7f39c6faaaa9de869dd5e84485617c6612ceac823', publisher: 'Helsinki-NLP/opus-mt-tc-big-he-en@134c5a85',
    licence: 'CC-BY-4.0 (model card; OPUS-MT-train README). Attribution required. Residual risk: the Tatoeba training-data release is CC-BY-NC-SA.',
    evidence: 'LFS sha256 at the pinned revision; not downloaded yet (fetched by proof:ai-local through the owner-approval download path)',
  },
  opusMtEnHeWeights: {
    file: 'pytorch_model.bin', url: 'https://huggingface.co/Helsinki-NLP/opus-mt-en-he/resolve/b3df900afbb13bc343b0d28a03ac6f7990091f54/pytorch_model.bin', bytes: 313806597,
    sha256: 'c0aad3671d8043d87ecbead016c218162f4c1549a4eb6ad8785e59657d22708b', publisher: 'Helsinki-NLP/opus-mt-en-he@b3df900a',
    licence: 'CC-BY 4.0 per the publisher\'s OPUS-MT-train README (the Hugging Face tag says apache-2.0; publisher terms take precedence). Attribution required. A pickle checkpoint: loaded weights-only.',
    evidence: 'LFS sha256 at the pinned revision; not downloaded yet (fetched by proof:ai-local through the owner-approval download path)',
  },
} as const satisfies Record<string, FilePin>;
/** CC-BY attribution text for OPUS-MT, for the descriptors' model records and the notices/credits. */
/** Wording not yet checked against the citation the publisher asks for; the lead reviews it before it reaches the notices screen. */
export const OPUS_MT_ATTRIBUTION = 'Translation models: OPUS-MT by Helsinki-NLP (Language Technology Research Group, University of Helsinki), CC-BY 4.0. Tiedemann and Thottingal, "OPUS-MT: Building open translation services for the World", EAMT 2020.';
