# Local model research for the 500 GB download grant (wave 7)

Read on 2026-11-25. Read-only research: nothing was downloaded, installed or registered. Every licence, size and benchmark below was read today at the publisher's own page; the URL follows each quote. Where today's reading was impossible the item is in section 14 ("Not verified").

How the facts were read:
- Licence files and READMEs: `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<file>`.
- Model cards: `https://huggingface.co/<repo>` (raw card at `/raw/main/README.md`).
- Sizes, gating, revision and SHA-256: `https://huggingface.co/api/models/<repo>?blobs=true`. Every large file there carries an `lfs.sha256`, so a manifest can pin revision + bytes + digest exactly as `aiPins.ts` and `speech.ts` do now.
- Limits of this session: `github.com` HTML and the GitHub API return 403 through the session proxy, so GitHub *release-asset* sizes and digests were not re-read. Cards of gated repositories return 401 without an account (none was created). Google Drive, Dropbox and Baidu links were not opened.

"Fits 4 GB" is only stated when the publisher gives a number. One publisher number on another GPU is not a measurement on the RTX 3050; every such figure is labelled with its hardware.

## 1. Main findings

1. **Speech recognition: keep the current model.** The pinned `ivrit-ai/whisper-large-v3-turbo-ct2@72ad623a` is still the head revision and is the publisher's 2025-05-13 release. On the publisher's own leaderboard the full large-v3 fine-tune is better by 0.2 points of word error on one set and worse by 0.1 on another, at twice the size and with a published VRAM figure (for the same architecture) above 4 GB in half precision.
2. **No licence-clean Hebrew forced aligner exists today.** WhisperX's Hebrew model has no licence, the MMS aligner is CC BY-NC, Qwen3-ForcedAligner (Apache-2.0) does not list Hebrew. Word timing stays with Whisper's own word timestamps until measured on the owner's clips.
3. **Diarisation: the "gated" objection no longer covers the whole field.** `nvidia/Nemotron-3-Diarization` is ungated, OpenMDW-1.1 ("ready for commercial or non-commercial use"), 107 MB as GGUF, with an Apache-2.0 C++ runtime. Its training data is mostly English and nothing is known about overlapping children. It reopens the feature as a trial, not as a recommendation.
4. **Phonikud licence, resolved as far as the publisher's pages allow:** the ONNX weights card still says `license: mit`; the publisher's repository LICENSE says CC BY 4.0 for the code, with an added requirement of "a clear and visible link to the Phonikud project"; the PyTorch weights card says only `license: cc`; the model is credited as built on Dicta's model, which is CC BY 4.0. Every reading allows commercial use; the safe record is CC BY 4.0-style attribution to Phonikud (with link) and to Dicta. Today's pin has `attribution: null` (`apps/server/src/speech.ts:75`), which is the thing to fix.
5. **A local Hebrew command assistant is now possible under Apache-2.0 without an account:** Gemma 4 is Apache-2.0 and ungated (Gemma 3 was gated under Google's own terms), DictaLM 3.0 (Hebrew-specific, Apache-2.0) has a 1.7B model with publisher GGUF files, and llama.cpp's server (MIT) constrains output to a JSON schema. Google's own table puts Gemma 4 E2B at 2.9 GB in 4-bit. Hebrew instruction quality of all of them is unmeasured.
6. **Correction to an earlier note:** Depth Anything **V2 Base is CC BY-NC-4.0**. Apache-2.0 holds only for V2 Small and for Depth Anything 3 Small and Base.
7. **DDColor is not "without a weights licence":** the publisher's Hugging Face cards for the weights say `license: apache-2.0` (since 2024-01). The training data is ImageNet, so it is the same kind of owner decision as Real-ESRGAN's DIV2K, not a missing licence.
8. **ACE-Step 1.5 now describes its training data** on its model card (licensed, royalty-free/public-domain, synthetic), but only as categories; nothing is itemised. Weights MIT. Owner decision.
9. **Still non-commercial or gated, unchanged:** NLLB, MMS, MusicGen weights, MatAnyone/MatAnyone 2, Depth Anything V2 Base/Large and DA3 Large/Giant, Aya, pyannote (gated), SAM 3/3.1 (gated, own licence), Stable Audio Open (gated, community licence), Llama 3.2 (gated), Demucs weights ("not clear").
10. **Tier 1 is 8.74 GB** (nine downloads). Everything in tier 2 together is under 90 GB. The 500 GB grant is not the constraint; licences and the 4 GB card are.

## 2. What the project uses today (from the code and docs)

| Capability | Model and pin | Runtime | Licence record in the repository |
|---|---|---|---|
| Hebrew speech recognition, word times | `ivrit-ai/whisper-large-v3-turbo-ct2@72ad623a`, 1,621,665,181 B, 5 files (`apps/server/src/speech.ts:51-63`) | faster-whisper 1.2.1 / CTranslate2 4.9.0, own Python env | Apache-2.0 by model card, "metadata-level check" |
| Text to speech | `ResembleAI/chatterbox@5bb1f6ee` multilingual, 3,207,031,585 B (`speech.ts:64-74`) | chatterbox-tts 0.1.7, own Python env | MIT by model card |
| Hebrew vowel pointing (for speech) | `Phonikud/phonikud-onnx@b806189f` `phonikud-1.0.int8.onnx`, 307,844,158 B (`speech.ts:75`) | phonikud-onnx 1.0.6 | MIT by model card; reconciliation open (docs/BLOCKERS.md B-8) |
| Voice cleanup | DeepFilterNet3 model 7,983,136 B + `deep-filter` 0.5.6 binary (`packages/providers/src/aiPins.ts`) | operator-installed binary | MIT OR Apache-2.0 |
| Translation he↔en | `Helsinki-NLP/opus-mt-tc-big-he-en@134c5a85` (476 MB), `opus-mt-en-he@b3df900a` (314 MB) | transformers, tools Python env | CC BY 4.0, attribution shown |
| Upscale / video enhance | Real-ESRGAN x4plus 67 MB, realesr-general-x4v3 4.9 MB | ComfyUI core nodes | BSD-3-Clause; DIV2K risk accepted by the owner |
| Slow motion | RIFE v4.25, Comfy-Org repack, 22.7 MB | ComfyUI core | MIT at the publisher, key-renamed repack |
| Background removal | BiRefNet (Swin-L) 444 MB | ComfyUI core | MIT |
| Vocal removal | FFmpeg centre cancel | model-free | — |
| Command assistant | provider-neutral interface, test adapter only (`packages/providers/src/chat.ts`) | none | — |
| Diarisation, search, tagging, depth, click-select, faces, music, colourisation | not built | — | — |

## 3. Speech recognition with word timing

**Today:** see table. **Recommendation: keep current.**

Evidence, publisher's leaderboard file `https://huggingface.co/spaces/ivrit-ai/hebrew-transcription-leaderboard/raw/main/benchmark.csv` (word error rate, lower is better; columns: eval-d1 podcast conversation, eval-whatsapp voice messages, SASPEECH, FLEURS he, KAN):

| Model (engine) | eval-d1 | whatsapp | saspeech | fleurs | kan |
|---|---|---|---|---|---|
| ivrit-ai/whisper-large-v3-ct2-20250513 (faster-whisper) | 0.051 | 0.072 | 0.064 | 0.174 | 0.081 |
| **ivrit-ai/whisper-large-v3-turbo-ct2-20250513 (in use)** | 0.053 | 0.071 | 0.066 | 0.181 | 0.082 |
| thewh1teagle/zipformer2-66m-streaming-he (sherpa-onnx) | 0.053 | 0.088 | 0.064 | 0.234 | 0.118 |
| openai large-v3-turbo (faster-whisper) | 0.084 | 0.128 | 0.104 | 0.289 | 0.156 |
| openai large-v3 (faster-whisper) | 0.098 | 0.132 | 0.094 | 0.262 | 0.134 |

The commit list of the pinned repository shows `a2cec1d3 2025-05-22 "New version: 2025.05.13"` followed only by a README update (`72ad623a`), so the pin is the best turbo release. None of these sets contains children; that remains unmeasured.

Speed, same space, `timing.csv` (ivrit-ai turbo-ct2, faster-whisper, audio ≥ 30 s, median): T4 24.1× real time, L4 31.0×, RTX 2080 Ti 33.9×, A10 42.8×. No RTX 3050 row exists. VRAM for turbo is not published by ivrit.ai; the project's own note (about 1.6 GB in half precision, docs/INTEGRATIONS.md) is untested.

| Candidate | Weights licence | Data statement | Size | Fit / speed (publisher) | Verdict |
|---|---|---|---|---|---|
| `ivrit-ai/whisper-large-v3-turbo-ct2` | Apache-2.0 (card) | card: "295 hours of volunteer-transcribed speech from the ivrit-ai/crowd-transcribe-v5 dataset, as well as 93 hours of professional transcribed speech"; the transformers card lists crowd-transcribe-v5 (~300 h), crowd-recital (~50 h), Knesset plenums (~4700 h) | 1.62 GB | see above | keep |
| `ivrit-ai/whisper-large-v3-ct2@e9ed4a4a` | Apache-2.0 | same three datasets | 3,090,836,850 B | faster-whisper README, large-v2 on RTX 3070 Ti 8 GB: fp16 4525 MB, int8 2926 MB (same architecture class, not this file) | runner-up; tier 2 as an "int8 accuracy mode" only if the owner's clips show a gain |
| `thewh1teagle/zipformer2-66m-streaming-he@6c07526e` | CC BY 4.0 ("CC-BY-4.0. Base model from k2-fsa/icefall (Apache-2.0). Trained on audio from ivrit.ai") | ~9k h of ivrit.ai audio per the sibling card, pseudo-labelled with the ivrit Whisper | int8 ONNX set 72 MB | 66 M parameters, streaming in 1.28 s chunks; int8 scores 5.3 / 8.8; sherpa-onnx runtime (Apache-2.0) | tier 2: a CPU recogniser for when the GPU is busy; word timing not documented |
| `thewh1teagle/parakeet-tdt-0.6b-v3-he` | CC BY 4.0 | ivrit.ai audio, pseudo-labelled | 5.75 GB repo | 6.1 / 8.8; "Hebrew only: English words come out in Hebrew letters" | rejected: worse than current, NeMo runtime |
| Qwen3-ASR 1.7B/0.6B | Apache-2.0 | not itemised | 4.09 GB | language list on the card has no Hebrew | rejected for Hebrew |
| openai large-v3 / large-v3-turbo | Apache-2.0 / MIT (cards) | — | — | worse on every Hebrew set above | rejected |

Training-data licence statement (the ivrit.ai datasets are gated; their cards could not be read; the publisher's licence page was): "the Data may only be used, modified and distributed for the express purpose of either (a) training AI models, or (b) academic research. In addition, the Data may not be used in order to create audiovisual material that simulates the voice or likeness of the specific individuals appearing or speaking in such materials and data (a 'deep-fake')" and "enabling use for training AI models for any reasonable purpose – including commercial ones" — `https://www.ivrit.ai/en/the-license/`. This restricts the data, not the model's output; it is the first time the training-data terms of the pinned model have been read.

Engine licences: faster-whisper MIT, CTranslate2 MIT, OpenAI Whisper MIT, Silero VAD MIT ("Published under permissive license (MIT) Silero VAD has zero strings attached - no telemetry, no keys, no registration") — respective `LICENSE`/`README.md` files.

**Forced alignment (word times for typed text):**

| Aligner | Finding | Verdict |
|---|---|---|
| WhisperX (code BSD-2-Clause) | its Hebrew model is `imvladikon/wav2vec2-xls-r-300m-hebrew` (`whisperx/alignment.py`); that card has no licence field at all | rejected: no licence |
| ctc-forced-aligner (code BSD-2-Clause) | "note that the default model has CC-BY-NC 4.0 License, so make sure to use a different model for commercial usage" — README | rejected (default model `MahmoudAshraf/mms-300m-1130-forced-aligner`, CC BY-NC 4.0) |
| `facebook/mms-1b-all` | CC BY-NC 4.0 (card tag) | rejected |
| Qwen3-ForcedAligner-0.6B | Apache-2.0, but "Chinese, English, Cantonese, French, German, Italian, Japanese, Korean, Portuguese, Russian, Spanish" | rejected: no Hebrew |
| stable-ts | MIT code, no weights of its own; re-times with the Whisper model already installed | the only clean option; a code experiment, not a download |

So: none qualifies as a dedicated Hebrew aligner. The ivrit training note is relevant to timing quality: "Timestamps were used from 40% of samples" of two of the three datasets, and the crowd set "has no timestamps". Word-boundary accuracy on Hebrew is unpublished and still has to be measured on the owner's clips (BLOCKERS B-7).

## 4. Speaker separation / diarisation

**Today:** not built; rejected in wave 5 because the segmentation model is gated and children overlap.

| Candidate | Licence and access | Data | Size / runtime | Verdict |
|---|---|---|---|---|
| `nvidia/Nemotron-3-Diarization@52a43267` | `license: openmdw-1.1`, not gated. Card: "This model is ready for commercial or non-commercial use." Licence text: "permission is hereby granted, free of charge, to deal in the Model Materials without restriction" with notice retention and a patent-suit termination clause — `https://openmdw.ai/license/1-1/` | "Approximately 10,000 hours of real conversations plus 82,611 hours of simulated multi-talker audio mixtures"; sources listed by name (Fisher, AMI, ICSI, LibriSpeech, NOTSOFAR1, DISPLACE, and "David AI … Licensed under agreement"); languages "English, Mandarin, Hindi, Kannada, Telugu, Bengali, and other languages" | 100 M parameters; `Nemotron-3-Diarization.q8_0.gguf` 107,012,128 B (sha256 `08456d9e22cd9a32…`); runs in NVIDIA NeMo-Speech.cpp (Apache-2.0, Windows builds mentioned) or NeMo; up to 8 speakers; output is per-speaker activity over time with generic labels | **the one that qualifies on licence**; tier 2 trial. Hebrew and children are not covered by any published number |
| `nvidia/diar_streaming_sortformer_4spk-v2` | CC BY 4.0, not gated | "trained on publicly available speech datasets, primarily in English … Performance may degrade on non-English speech" | 147 MB GGUF; 4 speakers | superseded by the row above (the card itself says so) |
| `nvidia/diar_streaming_sortformer_4spk-v2.1` | NVIDIA Open Model License ("Models are commercially usable"; rights end if a "Guardrail" is bypassed; use must follow NVIDIA's Trustworthy AI terms) | — | 471 MB | not needed |
| `nvidia/diar_sortformer_4spk-v1` | CC BY-NC 4.0 | — | — | rejected |
| `pyannote/speaker-diarization-community-1` | CC BY 4.0 but `gated: auto`: "you have to accept the conditions to access its files … By providing your details, you agree that we may email you" | — | 33.7 MB; pyannote.audio (MIT) | tier 2: needs the owner's own account |
| `pyannote/speaker-diarization-3.1`, `segmentation-3.0` | MIT, `gated: auto` | — | 6 MB | same |
| `ivrit-ai/pyannote-speaker-diarization-3.1`, `ivrit-ai/pyannote-segmentation-3.0` | ungated forks tagged MIT ("This model is a fork of pyannote/speaker-diarization-3.1") | — | 6 MB | MIT allows the copy, but it sidesteps the publisher's gate; owner's ruling |
| Speaker-embedding models used by classic pipelines: `pyannote/wespeaker-voxceleb-resnet34-LM`, `speechbrain/spkrec-ecapa-voxceleb` | CC BY 4.0, ungated ("The pretrained model in WeNet follows the license of it's corresponding dataset") / Apache-2.0, ungated | VoxCeleb | 27 MB / 83 MB | only as parts of a pyannote-style pipeline |

Privacy note for the lead: a classic pipeline computes a voice embedding per speaker. A stored voice embedding of a child is the same class of data as the face embeddings the lead rejected. Any diarisation here should label speakers per file ("speaker 1/2"), keep nothing between files, and never match a voice to a named person. The end-to-end Nemotron model fits that shape by construction.

## 5. Voice cleanup, music/voice separation, de-reverb

**Voice cleanup — keep DeepFilterNet3.** "All code and model weights in this repository are dual-licensed under either: MIT License … Apache License, Version 2.0 … at your option." — `Rikorose/DeepFilterNet` README. Confirmed.

| Candidate | Licence (code / weights) | Data | Size / runtime | Verdict |
|---|---|---|---|---|
| Resemble Enhance | MIT / MIT (card `license: mit`) | "trained on high-quality 44.1kHz speech data" (no list) | enhancer checkpoint 713,176,232 B, a pickle; own Python env | runner-up; tier 2 (restores bandwidth, may invent detail; needs listening) |
| ClearerVoice `MossFormer2_SE_48K` | Apache-2.0 / Apache-2.0 | "trained on large scale datasets inclduing open-sourced and private data" | 221,552,019 B; `clearvoice` package | tier 2: a 48 kHz alternative denoiser |
| Meta denoiser | CC BY-NC (earlier record, not re-read today) | — | — | rejected |

**Music/voice separation — none qualifies for the default profile.**

| Candidate | What the publisher says | Verdict |
|---|---|---|
| Demucs v4 (`htdemucs`, `htdemucs_ft`) | "Demucs code is released under the MIT license … The license of the weights is not clear: MusDB contains some data that were only usable for research purpose. I sadly cannot help granting a license … The 6 source variant of htdemucs was trained only on Meta internal dataset, which likely means CC-NC-BY license" — `adefossez/demucs` README. The Meta repository says it "is not maintained anymore" | best quality, but research profile only unless the owner rules |
| Spleeter | README: "The code of **Spleeter** is MIT-licensed." Nothing on the weights. The README also asks automated agents not to contact the maintainers about the weights licence, so no clarification will come that way | unchanged: owner's ruling still pending |
| Open-Unmix | `umxl`: "the weights are only licensed for non-commercial use (CC BY-NC-SA 4.0)"; `umxhq`: trained on MUSDB18-HQ, no licence line | rejected / unclear |
| UVR model zoo, BS-/Mel-Band RoFormer community checkpoints (via python-audio-separator, MIT) | UVR: "For all third-party application developers who wish to use our models, please honor the MIT license by providing credit to UVR and its developers." Training data is not stated per model | not verified per checkpoint; do not use |
| FFmpeg centre cancel (in use) | model-free | keep as the default |

**De-reverb — none qualifies as a model.** `anvuew/dereverb_mel_band_roformer` is GPL-3.0 with no data statement; UVR de-reverb checkpoints as above. The clean options are model-free (`nara_wpe`, MIT, weighted prediction error) or the enhancer stage of Resemble Enhance. Neither has been heard.

## 6. Hebrew text to speech and vowel pointing

**Text to speech — keep Chatterbox Multilingual.** Still MIT (`resemble-ai/chatterbox` LICENSE and card), the pinned revision `5bb1f6ee` is still head, Hebrew is in the language list, "Trained on 0.5M hours of cleaned data" (not itemised), "Every audio file generated by Chatterbox includes … Perth … imperceptible neural watermarks". Chatterbox-Turbo is English only.

| Candidate | Licence | Data | Size / runtime | Verdict |
|---|---|---|---|---|
| `thewh1teagle/piper-he-noa@23f8e069` | CC BY 4.0 | "24 h of Hebrew speech generated with Chatterbox, Knesset sentences, Whisper-filtered" + LJSpeech (public domain) | `he_IL-noa-medium.onnx` 77,056,101 B; "Fast, CPU-friendly, standard Piper ONNX"; needs the renikud phonemiser (`renikud/renikud`, CC BY 4.0, `model.onnx` 20,620,594 B) | runner-up: a fast CPU voice. The Piper engine is `OHF-Voice/piper1-gpl`, **GPL-3.0**, so it would be an operator-installed separate program like ComfyUI. Tier 2 |
| `notmax123/blue-onnx` (BlueTTS) | MIT (card) | not stated on the card | 0.94 GB repo, ONNX Runtime | not verified further; no data statement |
| `notmax123/QwenTTS-he-1.7B-GGUF` | Apache-2.0 | "~131k Hebrew" items (card) | 1.47 GB; takes stressed IPA, voice cloning | not verified further |
| `nvidia/magpie_tts_multilingual_357m` | NVIDIA Open Model License | listed | "12 languages: Arabic, Chinese, English, French, German, Hindi, Italian, Japanese, Korean, Portuguese, Spanish, and Vietnamese" | rejected: no Hebrew |
| `facebook/mms-tts-heb` | CC BY-NC 4.0 | — | — | rejected |
| `Phonikud/phonikud-tts-checkpoints` | "non commercial (cc-nc)" | — | — | rejected |
| `thewh1teagle/kokoro-hebrew-nc`, `notmax123/Zonos-Hebrew`, `robo_shaul`, `MamreTTS` | non-commercial | — | — | rejected |
| `Yzamari/f5tts-hebrew-v2` | tagged Apache-2.0, fine-tuned from F5-TTS on SASPEECH and others | SASPEECH is listed as non-commercial by the Phonikud README | — | rejected: tag contradicts the upstream terms |

**Vowel pointing — the open Phonikud question.** What each publisher page says today:

| Page | Statement |
|---|---|
| Weights in use, `https://huggingface.co/Phonikud/phonikud-onnx` (head = pinned `b806189f`, last commit 2025-08-24) | front matter `license: mit`; "Special thanks ❤️ to dicta-il for their amazing Hebrew diacritics model ✨ and the dataset that made this possible!" |
| PyTorch weights, `https://huggingface.co/Phonikud/phonikud` | front matter `license: cc` (no variant named) |
| Code, `https://raw.githubusercontent.com/thewh1teagle/phonikud/main/LICENSE` | "Creative Commons Attribution 4.0 International Public License (CC BY 4.0)" and "**Note**: (1) This license applies only to the **code** in this repository (Phonikud G2P). Any **datasets** included or referenced in this project may have **separate licenses**. … (2) When giving attribution, you must include a clear and visible link to the Phonikud project" |
| README, same repository | "Phonikud G2P (the code in this repository) is licensed under CC BY 4.0 (open use)"; datasets: "ILSpeech (speech, non commercial) · Saspeech (speech, non commercial) · phonikud-data (nikud and phonetics, cc-4.0)" |
| Dataset `Phonikud/phonikud-data` | tagged `license: mit` (the README above calls it "cc-4.0") |
| PyPI `phonikud-onnx` 1.0.6, `phonikud` 0.4.1 | no licence metadata |
| Upstream `dicta-il/dictabert-large-char-menaked` | "This work is licensed under a Creative Commons Attribution 4.0 International License" |

Reading: the weights file the product downloads is MIT by its own card; the code and the upstream model are CC BY 4.0; the two non-commercial speech sets are for the publisher's TTS, not for the pointing model. No page forbids commercial use. The pages disagree with each other, so the record should carry the stricter consistent terms: attribution to Phonikud with a visible link, and attribution to Dicta. That is a record-and-notices change, not a blocker. What only the owner can decide is in section 13.

For pointed captions (the «נקד» idea): Dicta's own model is the better source. `dicta-il/dictabert-large-char-menaked@4dfc20b9`, CC BY 4.0, `model.safetensors` 1,222,010,788 B, "trained on a corpus of modern Hebrew texts manually diacritized by linguistic experts", "not intended for earlier layers of Hebrew (e.g. Biblical, Rabbinic, Premodern), nor for poetic texts". It writes standard niqqud; Phonikud adds its own phonetic marks meant for speech. Runs in transformers on CPU (no publisher speed number). Tier 1.

## 7. Translation

**Today:** OPUS-MT he↔en, CC BY 4.0 ("They are distribted with a CC-BY 4.0 license" — `Helsinki-NLP/OPUS-MT-train` README). Keep as the baseline.

| Candidate | Weights licence | Size | Verdict |
|---|---|---|---|
| NLLB-200 (600M, 3.3B) | "License: CC-BY-NC" (card) | 2.48 GB / 17.6 GB | rejected, confirmed |
| MADLAD-400 3B (`google/madlad400-3b-mt@fa184c67`) | card in Google's organisation says "License: Apache 2.0", but also "Juarez Bochi, who was not involved in this research, converted the original weights and wrote the contents of this model card". Google's own `madlad_400/README.md` gives checkpoint links and no licence sentence; the enclosing `google-research` repository is Apache-2.0. "Primary intended users: Research community." | `model.safetensors` 11,761,587,872 B; covers Hebrew | runner-up, tier 2: one model for many languages; the licence statement's author is a third party |
| M2M100 418M | MIT (card) | 3.88 GB repo | usable fallback for other languages; quality for Hebrew not read |
| Aya Expanse 8B | CC BY-NC 4.0, gated | 16 GB | rejected |
| TranslateGemma 4B | `license: gemma`, `gated: manual` | 8.6 GB | rejected (account + Google terms) |
| Tencent Hunyuan-MT-7B (lists Hebrew) | "TENCENT HUNYUAN COMMUNITY LICENSE AGREEMENT … THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA", with an acceptable-use policy | 16 GB | rejected |
| A local Apache-2.0 chat model (section 10) used as translator | Apache-2.0 | no extra download | **recommended addition to try**: the same file serves the assistant and translation into languages OPUS-MT does not cover. Quality unmeasured |

## 8. Image and video

Runtime notes: where the table says "ComfyUI core" it relies on `.artifacts/ai-plan.md` (the judged plan), which found core nodes for BiRefNet, RIFE/FILM, Depth Anything 3, MediaPipe and SAM 3.1; that was not re-checked against the ComfyUI source today. The product never installs custom node packs. For reference, licences read today: ComfyUI GPL-3.0; `Fannovel16/ComfyUI-Frame-Interpolation` MIT; `kijai/ComfyUI-segment-anything-2` Apache-2.0; `chflame163/ComfyUI_LayerStyle` MIT; `1038lab/ComfyUI-RMBG` GPL-3.0; `ltdrdata/ComfyUI-Impact-Pack` GPL-3.0; `kijai/ComfyUI-DepthAnythingV2` and `kijai/ComfyUI-MatAnyone` have no LICENSE file at the root of main/master.

**Upscaling — keep Real-ESRGAN.** BSD-3-Clause confirmed (`xinntao/Real-ESRGAN` LICENSE). SwinIR, HAT and SCUNet are Apache-2.0 repositories whose weights carry no separate terms and the same class of training data; none publishes a 4 GB figure. SeedVR2 stays out on memory (repository-reported 6.7–27.7 GB, docs/INTEGRATIONS.md). No upgrade recommended.

**Frame interpolation — keep RIFE v4.25.** "The content of these links is under the same MIT license as this project … Currently, it is recommended to choose 4.25 by default for most scenes." — `hzwer/Practical-RIFE` README. v4.26 exists (2024-09-21) and is in the same repack (`rife_v4.26.safetensors` 22,674,688 B) but the publisher does not recommend it over 4.25. The repack card declares `license_name: mit-and-apache-2.0`. FILM's weights statement was not re-read.

**Matting and background removal.**

| Candidate | Licence | Publisher numbers | Verdict |
|---|---|---|---|
| BiRefNet (in use) | MIT (LICENSE and card) | "the standard BiRefNet can run in 17 FPS with resolution==1024x1024 with 3.45GB GPU memory on a single RTX 4090" (FP16); table: inference 4.8 GB FP32, 3.5 GB FP16 | keep for stills. 3.5 GB leaves almost nothing on a 4 GB card |
| `ZhengPeng7/BiRefNet_lite@aa62cd87` (Swin-T) | MIT | no memory figure | **recommended addition** for video frames on 4 GB; `model.safetensors` 177,634,392 B. Tier 1 |
| `ZhengPeng7/BiRefNet-matting`, `BiRefNet_HR-matting` | MIT | same backbone as the standard model; trained on P3M-10k, AM-2k, Human-2k and others | tier 2 (hair), after the standard model is measured on the laptop |
| BEN2 base | MIT | "trained on the DIS5k and our 22K proprietary segmentation dataset"; a separate commercial model is sold | not needed |
| Robust Video Matting | code "re-released under GPL-3.0 license"; no separate weights terms | "4K 76FPS and HD 104FPS on an Nvidia GTX 1080 Ti" | runner-up on speed; weights terms unstated; tier 3 until clarified |
| MatAnyone, MatAnyone 2 | "licensed under NTU S-Lab License 1.0": "Redistribution and use for non-commercial purpose" | — | rejected |
| RMBG 1.4/2.0 | non-commercial (earlier record, not re-read today) | — | rejected |
| SAM 2.1 Hiera Tiny / Small (click-to-segment, video propagation) | "The SAM 2 model checkpoints, SAM 2 demo code … and SAM 2 training code are licensed under Apache 2.0" | 38.9 M / 46 M parameters; 91.2 / 84.8 FPS "measured on an A100"; no VRAM figure | **recommended addition** (already planned for wave 1b): `facebook/sam2.1-hiera-tiny@de431c40` `model.safetensors` 155,908,064 B; `hiera-small@ee5bba1d` 184,305,280 B. Tier 1 |
| EdgeTAM | "The EdgeTAM model checkpoints and code are licensed under Apache 2.0" | "22× faster than SAM 2 and achieves 16 FPS on iPhone 15 Pro Max"; `edgetam.pt` 56,116,523 B | runner-up if SAM 2.1 is too slow or large on the laptop |
| SAM 3 / 3.1 | `gated: manual`; "SAM License": no reverse engineering, trade-control and military-use clauses | 3.5–6.9 GB | rejected: gated and too large |

**Depth.** "Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." — `DepthAnything/Depth-Anything-V2` README. Depth Anything 3 README table: DA3-SMALL (0.08B) and DA3-BASE (0.12B) "Apache 2.0"; DA3-LARGE, GIANT and NESTED "CC BY-NC 4.0"; DA3METRIC-LARGE and DA3MONO-LARGE "Apache 2.0". Recommended addition: `depth-anything/DA3-SMALL@e08cab65` 137,248,940 B and `DA3-BASE@f4a6c9b3` 541,518,028 B, ComfyUI core per the plan. No publisher VRAM figure for single images. Video Depth Anything Small is Apache-2.0 but stays excluded on memory (plan).

**Face detection for framing only.** YuNet: "All files in this directory are licensed under MIT License" — `opencv_zoo/models/face_detection_yunet/README.md`; `face_detection_yunet_2023mar.onnx` 232,589 B at `opencv/face_detection_yunet@3cc26e7f` (sha256 `8f2383e4dd3cfbb4…`); WIDER Face AP 0.834/0.824/0.708; runs in OpenCV DNN or ONNX Runtime on CPU. Tier 1.
**Face recognition, face embeddings and any grouping or naming of children's faces were rejected by the lead and are not proposed anywhere in this document.** YuNet returns boxes and five landmarks only; nothing should be stored beyond the framing keyframes.

**Denoise, deblur, low light.** Prefer the model-free route first: this machine's FFmpeg already has `hqdn3d`, `nlmeans`, `deshake`. Models: NAFNet (MIT repository; weights for SIDD/GoPro/REDS are linked from Google Drive, so there is nothing to pin), Restormer (MIT), SCUNet (Apache-2.0); none states weight-specific terms or a 4 GB figure. Retinexformer (low light) has no LICENSE file and its Hugging Face repository has no licence tag: rejected. No download recommended now.

**Stabilisation.** No learned stabiliser with a stated weights licence and a 4 GB figure was found; the model-free plan (tracked points, smoothed path) stands. This machine's FFmpeg also has `vidstabdetect`/`vidstabtransform`; whether the owner's Windows FFmpeg build has them is unknown.

**Colourisation.** DDColor: repository Apache-2.0; `MODEL_ZOO.md` still has no licence column, but the weights cards it links to (`piddnad/ddcolor_modelscope`, `ddcolor_paper_tiny`, `ddcolor_artistic`, all last changed 2024-01-29) declare `license: apache-2.0`. Training: "DDColor-L trained on ImageNet" (default model); `ddcolor_artistic` is "ImageNet + private data". `pytorch_model.bin` 911,914,869 B (tiny: 220,372,845 B), pickle format. So the earlier reason for rejection ("no stated licence") does not hold; the open point is ImageNet's research-only terms. Tier 2, owner decision, and only the ImageNet-only default model. DeOldify: MIT code, weights terms not stated in the README.

**Optical flow.** RAFT: BSD-3-Clause repository, weights on Dropbox/Google Drive with no terms. SEA-RAFT: BSD-3-Clause repository and the checkpoint card `MemorySlices/Tartan-C-T-TSKH-spring540x960-S` is tagged `bsd-3-clause`, 35,595,384 B. Tier 2: only if the model-free stabiliser or a cut detector needs it.

## 9. Search over the owner's clips, and audio tagging

**Image-text search.**

| Candidate | Weights licence | Data | Size | Verdict |
|---|---|---|---|---|
| `google/siglip2-base-patch16-256@3f9f96cb` | Apache-2.0 (card) | "SigLIP 2 is pre-trained on the WebLI dataset" | `model.safetensors` 1,500,985,224 B (repo 1.54 GB); transformers; a third-party ONNX export exists | **recommended addition**, tier 1. Titled "Multilingual Vision-Language Encoders", but no Hebrew figure is published |
| `laion/CLIP-ViT-B-32-xlm-roberta-base-laion5B-s13B-b90k` | MIT (card); open_clip code MIT-style | LAION-5B | 1.46 GB | runner-up: multilingual text tower, older and weaker image tower |
| `google/siglip2-so400m-patch14-384` | Apache-2.0 | WebLI | 4.54 GB | better quality, too heavy to index a library on this laptop comfortably; not recommended first |
| `jinaai/jina-clip-v2`, `visheratin/nllb-clip-base-siglip` | CC BY-NC 4.0 | — | — | rejected |
| `apple/MobileCLIP2-S2` | `apple-amlr` (Apple's research licence) | — | — | rejected |

CPU feasibility is not published for any of these. Indexing is a one-time batch per clip (a few frames each) and can use the GPU; a text query needs only the text tower. If Hebrew queries match poorly, translate the query with the OPUS-MT model already installed and search in English; that needs no new download.

**Audio tagging.**

| Candidate | Licence | Size | Verdict |
|---|---|---|---|
| PANNs Cnn14 | code MIT (`LICENSE.MIT`); weights on Zenodo record 3987831, `license: cc-by-4.0`, each file with an MD5 | `Cnn14_mAP=0.431.pth` 327,428,481 B, md5 `541141fa2ee191a88f24a3219fff024e` (`MobileNetV2_mAP=0.383.pth` 20,834,417 B) | **recommended addition**, tier 1; PyTorch, CPU. Stability AI used the same classifier to screen its own training set |
| `MIT/ast-finetuned-audioset-10-10-0.4593` | BSD-3-Clause (card; the card was written by Hugging Face staff, not the authors) | 346 MB | runner-up |
| `laion/clap-htsat-unfused` (free-text audio search) | Apache-2.0 card; LAION-AI/CLAP code CC0 | 615 MB | tier 2: only if text search over sounds is wanted |
| EfficientAT, BEATs | MIT repositories, no weight-specific statement | — | not verified |
| YAMNet | unchanged: its README still has no licence sentence for `yamnet.h5` | — | stays rejected |

One shared caveat: all of these predict AudioSet classes. "The dataset is made available by Google Inc. under a … CC BY 4.0 license, while the ontology is available under a … CC BY-SA 4.0 license" — `https://research.google.com/audioset/download.html`. The class names are the ontology. See section 13, question 6.

## 10. A small local language model for the Hebrew command bar

**Today:** provider-neutral interface with one tool (`propose_transaction`, JSON-schema input) and a test adapter only; the owner planned to supply a cloud key.

**Runtime.** llama.cpp: MIT (`ggml-org/llama.cpp` LICENSE). Its server documents schema-constrained output: "`json_schema`: Set a JSON schema for grammar-based sampling" and "The `response_format` parameter supports both plain JSON output … and schema-constrained JSON", plus "Function calling / tool use for ~any model". That matters more than the model: the grammar makes the output parse; only the *choice of operation* depends on the model's Hebrew. Ollama: MIT (`ollama/ollama` LICENSE); it pulls from its own registry, which the project's pin-by-digest download path does not cover, so llama.cpp's server with a pinned GGUF file is the better fit. Both are loopback HTTP servers and would be operator-installed, like ComfyUI.

| Model | Licence and access | Hebrew, tools | File and memory (publisher) | Verdict |
|---|---|---|---|---|
| **Gemma 4 E2B-it** (`google/gemma-4-E2B-it-qat-q4_0-gguf@675cff42`) | `license: apache-2.0`, not gated; the licence page `https://ai.google.dev/gemma/docs/gemma_4_license` is the Apache 2.0 text | "Out-of-the-box support for 35+ languages, pre-trained on 140+ languages" (Hebrew not named); "Function Calling – Native support for structured tool use"; native system role | `gemma-4-E2B_q4_0-it.gguf` 3,349,516,256 B. Google's table: E2B Q4_0 2.9 GB, "Approximate GPU or TPU memory required to load … 20% overhead" (`https://ai.google.dev/gemma/docs/core`) | **tier 1** |
| **DictaLM 3.0 1.7B Thinking** (`dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF@34cd0523`) | Apache-2.0, not gated | "trained on extensive corpora of Hebrew and English texts … set a new SOTA for their weight-class for Hebrew"; "The model supports tool-calling"; initialised from Qwen3-1.7B-Base; a reasoning model (thinks before answering) | `…Q4_K_M.gguf` 1,107,409,152 B; no memory figure published | **tier 1** (the Hebrew-specific candidate; only the Thinking variant has publisher GGUF files) |
| Gemma 4 E4B-it | Apache-2.0, not gated | as E2B | `gemma-4-E4B_q4_0-it.gguf` 5,154,941,280 B; Google's table: 4.5 GB in Q4_0, so it does not fit the card whole | tier 2 (partly on CPU) |
| Qwen3-4B (`Qwen/Qwen3-4B-GGUF`) | Apache-2.0, not gated | "Support of 100+ languages and dialects"; tool calling | `Qwen3-4B-Q4_K_M.gguf` 2,497,280,256 B; no memory figure | tier 2 |
| Qwen3.5 2B/4B/9B | Apache-2.0 | "201 languages and dialects" | publisher GGUF repositories answer 401; only third-party conversions are reachable | tier 2, after a publisher GGUF is reachable or converted locally |
| Phi-4-mini-instruct | MIT | the only card that names Hebrew: "Supported languages: Arabic, … Hebrew, …"; has a tool format; "trained primarily on English text" | 7.69 GB safetensors repo; publisher ONNX exists; no publisher GGUF | tier 2 |
| Ministral 3 3B / 8B | Apache-2.0 | Hebrew is not named in the language list; "native function calling and JSON outputting" | `…3B…Q4_K_M.gguf` 2,147,023,008 B / 8B 5,198,911,904 B | not recommended first |
| DictaLM 3.0 24B Thinking | Apache-2.0 (from Mistral Small 3.1) | flagship Hebrew model | Q4_K_M 14,333,912,160 B | CPU only and slow; needs RAM the laptop may not have. Tier 2 |
| DictaLM 3.0 Nemotron 12B | NVIDIA Open Model License | Hebrew | Q4_K_M 7,494,495,200 B | tier 2; extra licence terms |
| Gemma 3 (4B) | `license: gemma`, `gated: manual` | — | — | superseded by Gemma 4; do not use |
| Llama 3.2 3B | `gated: manual`; Llama 3.2 Community License with an Acceptable Use Policy ("must … adhere to the Acceptable Use Policy") | — | — | rejected: gated, own terms |
| Aya Expanse 8B | CC BY-NC 4.0, gated | — | — | rejected |
| Mistral Small 3.2 24B, Mistral 7B v0.3 | Apache-2.0 | — | 24B is too large; 7B has no Hebrew claim | not recommended |

Nobody publishes Hebrew instruction-following or tool-call accuracy for any 4 GB-class model. The honest plan is a bake-off on the laptop over the command bar's existing model-free grammar cases, with schema-constrained output, comparing DictaLM 1.7B and Gemma 4 E2B. Both are sent only the timeline summary, as today's design already requires. On a 4 GB card the assistant cannot stay loaded beside speech or ComfyUI; the compute lane has to treat it like any other model, or it runs on CPU.

## 11. Music and sound generation

| Candidate | Weights licence and access | Training data, as stated | Size / hardware (publisher) | Verdict |
|---|---|---|---|---|
| ACE-Step 1.5 (`ACE-Step/Ace-Step1.5@19671f40`) | MIT (card and LICENSE), not gated | card: "trained on a massive, legally compliant dataset consisting of: Licensed Data: Professionally licensed music tracks. Royalty-Free / No-Copyright Data … Synthetic Data: High-quality audio generated via advanced MIDI-to-Audio conversion." No list of sources | repo 10.09 GB (turbo DiT 4,787,825,604 B, LM 3,708,521,528 B, text encoder 1,191,586,416 B, VAE 337,431,388 B). "Runs locally with less than 4GB of VRAM"; README table for ≤ 6 GB: "2B turbo … LM disabled by default; INT8 quantization + full CPU offload"; "under 10 seconds on an RTX 3090" | the closest to qualifying; **tier 2, owner decision** on a data statement that cannot be audited |
| Stable Audio Open 1.0 / Small | `gated: auto` (sharing username and e-mail); "License: Stability AI Community License. Commercial License: to use this model commercially, please refer to https://stability.ai/license"; that page: free "for individuals or organizations that generate under $1M … of annual revenue" | the best-documented: "486492 audio recordings, where 472618 are from Freesound and 13874 are from the Free Music Archive (FMA). All audio files are licensed under CC0, CC BY, or CC Sampling+", with an attribution page | 15.68 GB / 6.44 GB repos; 47 s / 11 s clips; better at sound effects than songs | tier 2: needs the owner's own account and acceptance |
| Magenta RealTime (`google/magenta-realtime`) | "the codebase is licensed under Apache 2.0, and the model weights under Creative Commons Attribution 4.0 International", plus "do not generate content … that infringe or violate the rights of others" | "trained on ~190k hours of stock music from multiple sources, mostly instrumental" | 11.13 GB repo; memory need not read | tier 2; hardware fit unverified |
| MusicGen | "Code is released under MIT, model weights are released under CC-BY-NC 4.0" | licensed (Meta sound collection, Shutterstock, Pond5) | — | rejected, confirmed |
| YuE (v1) | Apache-2.0 | not stated | 12.45 GB; YuE2 asks for "24 GB VRAM" | rejected: too large |

None qualifies cleanly on all three of licence, itemised data and 4 GB. The built-in synthesised music stays the default.

## 12. Proposed downloads

Sizes are the files a manifest would pin. All tier 1 items are ungated, on huggingface.co (SHA-256 from the API) except PANNs (zenodo.org, MD5), which needs `zenodo.org` added to `PF_MODEL_HOSTS`.

**Tier 1 — clearly licensed, sized for the laptop, real value for a Hebrew family-video editor (in priority order)**

| # | Download | Licence | Bytes | For |
|---|---|---|---|---|
| 1 | `google/siglip2-base-patch16-256@3f9f96cb` (whole repo) | Apache-2.0 | 1,539,642,681 | "find the clip with the cake / the beach" across the library |
| 2 | `facebook/sam2.1-hiera-tiny@de431c40` + `hiera-small@ee5bba1d` (`model.safetensors`) | Apache-2.0 | 340,213,344 | click-to-select a child or object; video cut-out propagation |
| 3 | `ZhengPeng7/BiRefNet_lite@aa62cd87` | MIT | 177,634,392 | video background removal within 4 GB |
| 4 | `depth-anything/DA3-SMALL@e08cab65` + `DA3-BASE@f4a6c9b3` | Apache-2.0 | 678,766,968 | parallax "living picture", depth blur, text behind subject |
| 5 | `opencv/face_detection_yunet@3cc26e7f` `face_detection_yunet_2023mar.onnx` | MIT | 232,589 | auto-reframe to vertical; detection only |
| 6 | `dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF@34cd0523` Q4_K_M | Apache-2.0 | 1,107,409,152 | local Hebrew command assistant, candidate A |
| 7 | `google/gemma-4-E2B-it-qat-q4_0-gguf@675cff42` `gemma-4-E2B_q4_0-it.gguf` | Apache-2.0 | 3,349,516,256 | candidate B; also a translator for other languages |
| 8 | `dicta-il/dictabert-large-char-menaked@4dfc20b9` | CC BY 4.0 (attribution) | 1,222,010,788 | pointed captions for children; a second reading beside Phonikud |
| 9 | PANNs `Cnn14_mAP=0.431.pth` (Zenodo 3987831) | CC BY 4.0 (attribution) | 327,428,481 | find laughter, singing, applause, crying, music in clips |
| | **Total tier 1** | | **8,742,854,651 B = 8.74 GB** | |

Engines are extra and were not sized: a llama.cpp Windows build, and (for 1–5, 8, 9) packages in the existing tools Python environment.

**Tier 2 — useful, needs the owner's decision or account**

| Download | Bytes | Why it waits |
|---|---|---|
| `nvidia/Nemotron-3-Diarization` q8_0 GGUF + NeMo-Speech.cpp | 107,012,128 | reopens a feature the lead rejected; new licence type (OpenMDW-1.1); no Hebrew or child evidence |
| `pyannote/speaker-diarization-community-1` | 33,695,573 | gated: owner's own account |
| `ivrit-ai/whisper-large-v3-ct2@e9ed4a4a` | 3,090,836,850 | ≤ 0.2 point gain; only as an int8 mode if the owner's clips show it |
| `thewh1teagle/zipformer2-66m-streaming-he` int8 ONNX | 72,316,960 | new runtime (sherpa-onnx); CPU fallback |
| `thewh1teagle/piper-he-noa` ONNX + `renikud/renikud` ONNX | 97,681,743 | GPL-3.0 Piper engine to install; voice trained on synthetic speech |
| Gemma 4 E4B Q4_0 · Qwen3-4B Q4_K_M · Phi-4-mini · DictaLM 24B Q4_K_M · DictaLM Nemotron 12B Q4_K_M | 5.15 · 2.50 · 7.69 · 14.33 · 7.49 GB | after the tier 1 bake-off shows what is missing |
| `google/madlad400-3b-mt` | 11,761,587,872 | licence sentence written by a third party; needs local conversion to int8 |
| Resemble Enhance · MossFormer2_SE_48K | 713,176,232 · 221,552,019 | must be listened to; data partly private |
| `ZhengPeng7/BiRefNet-matting` | 884,878,856 | same memory class as the standard model; measure that first |
| `facebook/EdgeTAM` · SEA-RAFT S | 56,116,523 · 35,595,384 | only if SAM 2.1 is too slow / a flow model is needed |
| `piddnad/ddcolor_modelscope` | 911,914,869 | ImageNet training-data decision |
| ACE-Step 1.5 (without the 1.7B LM) | about 6.3 GB | unauditable data statement |
| Stable Audio Open 1.0 or Small | 15.68 / 6.44 GB repo | gated: owner's account and licence acceptance |
| `laion/clap-htsat-unfused` | 614,525,833 | only if free-text sound search is wanted |
| Demucs `htdemucs_ft` | not re-read | weights licence "not clear"; research profile only |

**Tier 3 — do not download**

Non-commercial: NLLB-200, MMS (aligner, TTS, `mms-1b-all`), MusicGen, MatAnyone and MatAnyone 2, Depth Anything V2 Base/Large, DA3 Large/Giant/Nested, `diar_sortformer_4spk-v1`, Aya, jina-clip-v2, nllb-clip, Open-Unmix `umxl`, `htdemucs_6s`, Phonikud TTS checkpoints, Kokoro/Zonos/Robo-Shaul Hebrew voices; and, from the earlier record without a new reading today, RMBG, CodeFormer and Meta's denoiser.
Gated with their own terms: SAM 3/3.1, Llama 3.2, Gemma 3, TranslateGemma.
Own restrictive terms: Hunyuan-MT (territory-limited), MobileCLIP 2 (research licence).
No licence or unstated weights terms: Retinexformer, WhisperX's Hebrew alignment model, YAMNet weights, RAFT and DeOldify weights, UVR/RoFormer community checkpoints, Robust Video Matting weights (code GPL-3.0), `f5tts-hebrew-v2` (tag contradicts upstream).
Too large for the laptop: SeedVR2, YuE, Mistral Small 24B.
No Hebrew: Qwen3-ASR, Qwen3-ForcedAligner, MagpieTTS, Chatterbox-Turbo.
Rejected by the lead and not to be proposed: any face recognition, face embedding or grouping of children's faces; by the same reasoning, any stored voice print.

## 13. Open licence questions only the owner can settle

1. **Phonikud.** Accept the reading "MIT for the ONNX weights per their card, CC BY 4.0 for the code and the upstream Dicta model", and show attribution to Phonikud (with a visible link) and to Dicta in the credits? The alternative is to ask the publisher to state one licence on the weights card. Narration works either way.
2. **Is the owner's use "commercial"?** Private family films are not; monetised shorts are. Several good models are open only to non-commercial use (Demucs, MatAnyone, NLLB, MusicGen). The product has a `research` profile for exactly that; the owner decides whether to use it, per feature, knowing a monetised short made with it would breach those terms.
3. **Stem separation.** Demucs ("not clear"), Spleeter (weights unstated; the maintainers will not answer), or stay with the FFmpeg centre cancel.
4. **Diarisation.** Reopen as a trial with Nemotron-3-Diarization under OpenMDW-1.1, per-file speaker labels only and nothing stored? Or create a Hugging Face account for pyannote community-1? Or treat ivrit.ai's ungated MIT fork of pyannote 3.1 as acceptable?
5. **Training-data residual risks of the same kind already accepted for Real-ESRGAN:** ImageNet (DDColor), WebLI (SigLIP 2, undisclosed web data), VoxCeleb (speaker models), AudioSet/YouTube (PANNs), ACE-Step's unlisted sources, Chatterbox's and Gemma's unlisted data.
6. **AudioSet class names.** The ontology is CC BY-SA 4.0. Showing translated class names in the editor may make that Hebrew label list a share-alike adaptation. Accept (and publish the label list under CC BY-SA), or show the project's own coarse categories instead?
7. **ivrit.ai data terms** (training-only use, no deep-fakes of the recorded speakers): acknowledged as the terms behind the recognition model already in use?
8. **Accounts.** Stable Audio Open and pyannote need the owner's own Hugging Face account and acceptance of terms that share name and e-mail. Nothing was registered.
9. **GPL-3.0 engines** (Piper) installed by the owner beside the product, on the same footing as ComfyUI: acceptable?
10. **MADLAD-400.** Accept an Apache-2.0 statement that sits on a card in Google's organisation but was written by a third party?

## 14. Not verified today

- Anything on the RTX 3050: no speed or memory figure in this document was measured on it. Published figures are from the hardware named beside them.
- VRAM of: the pinned Whisper turbo model, SAM 2.1, EdgeTAM, DA3, SigLIP 2, PANNs, BiRefNet_lite, DictaLM, Qwen3-4B, Nemotron-3-Diarization, Magenta RealTime. No publisher figure found.
- Hebrew quality of: every small language model (instructions and tool choice), SigLIP 2 text search, MADLAD/M2M100 translation, Piper he-noa, BlueTTS, Dicta pointing on spoken-style captions. Word-timestamp accuracy of any recogniser on Hebrew. Any model on children's speech or overlapping children.
- GitHub release assets (Real-ESRGAN, DeepFilterNet binaries including the Windows one, SCUNet, SwinIR, EdgeTAM's in-repo checkpoint): sizes and digests not re-read (github.com blocked here). Existing pins were not re-downloaded.
- Cards of gated repositories (ivrit.ai datasets, pyannote, SAM 3, Gemma 3, Llama 3.2, Aya, TranslateGemma, the Stable Audio `LICENSE.md` file itself): only the public page text or the API tags were read.
- Which ComfyUI core nodes load SAM 2.1, EdgeTAM or DDColor; taken as "local tools Python" unless the earlier plan says core. The plan's statements about core nodes were not re-checked.
- Licence of the `phonikud-onnx` wrapper package (no PyPI metadata), of `panns_inference`, `renikud-onnx`, `clearvoice` and the sherpa-onnx Windows wheels; FILM's weights statement; BEATs' and EfficientAT's weight terms; `torchaudio` MMS_FA terms.
- The full text of the Stability AI Community License and of the NVIDIA Trustworthy AI terms; only the sentences quoted were read.
- NeMo-Speech.cpp diarisation speed on CPU; its README gives CPU figures for recognition and speech synthesis only.
- Whether the owner's Windows FFmpeg has `vidstab`, `nlmeans` or `arnndn`.
- The laptop's RAM and free disk, which decide whether CPU-only language models (DictaLM 24B) are even possible.
