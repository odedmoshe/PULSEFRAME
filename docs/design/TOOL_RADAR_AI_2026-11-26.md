# AI tool radar, 2026-11-26

Research only. Nothing was installed, downloaded (no weights) or signed up for. Every row was read on 2026-11-26 unless a row says otherwise. "[read]" = I opened the page, API record or licence file today. "[search]" = only a web-search summary, treat as unverified. "[carried]" = taken from an existing project document (`docs/MARKET_RESEARCH.md`, `.artifacts/wave8/*`), not re-read. "unknown" = I looked and could not tell.

How I read pages: the WebFetch tool could not resolve most hosts, so I used `curl` through the proxy into `/tmp/claude-0/-home-user-PULSEFRAME/84ecc641-352b-53c1-abc2-950bc66f10c4/scratchpad/radar-b/` and read the text as data. Hugging Face model records came from `huggingface.co/api/models/<id>` (licence tag, parameter count, dates), model cards from `raw/main/README.md`, licences from `raw.githubusercontent.com/.../LICENSE`, MCP servers from `registry.modelcontextprotocol.io/v0/servers`, package data from `pypi.org/pypi/<name>/json`. A licence tag on a model record is what the publisher typed; where the licence file differs I say so.

Already known to the project and not repeated in detail: BiRefNet, SAM 2.1, Depth Anything, YuNet, SigLIP 2, DictaLM 3.0, Gemma 4 E2B, dictabert-large-char-menaked, PANNs, OPUS-MT he-en, DeepFilterNet3, Real-ESRGAN, RIFE v4.25, Chatterbox multilingual + Phonikud, ivrit-ai Whisper, pyannote community-1, llama.cpp, ComfyUI, stock sources, yt-dlp, YouTube publishing, LLM provider wire formats. Rejected earlier and still rejected: RMBG, MatAnyone, SAM 3, Depth Anything V2 Base/Large, Wav2Lip, ProPainter (all non-commercial or gated).

Key licence question carried from `.artifacts/wave8/vision-models-research.md` item 10: whether the owner's use counts as commercial (monetised shorts are). Rows flagged "NC" are out if the answer is yes.

---

## 1. What the leading editors and AI video tools offer today

★ = agent-like: the tool does a whole job from a request. Marketing pages describe intent, not quality; "how it works" is what the page or release note says.

| Feature | Who has it | How it works for the user | ★ | Source (read) |
|---|---|---|---|---|
| Chat agent that edits the project from a request | Descript Underlord ("vibe editing"); Adobe Premiere AI Assistant (public beta); Filmora AI Mate; Captions AI Edit; Kapwing assistant; Vizard Agent (22 templates); Runway "Create with Agent"; Luma Agents | User types "edit this down to 2 minutes, focus on the part about X". Descript's own examples: trailer from a webinar, hide jump cuts with zooms, add stock media to placeholders, write a script then edit to it | ★ | descript.com/underlord, vizard.ai, runwayml.com, lumalabs.ai (all read 2026-11-26); Adobe: petapixel.com/2026/11/10/..., community.adobe.com AI Assistant beta thread [search] |
| Agent works inside the real project: bins, stringouts, rough assembly, captions, approval rules | Premiere AI Assistant | Creates and renames bins, labels clips, makes transcripts, detects slates, adds markers, builds stringouts and rough assemblies, keeps working while the user edits; user sets "ask before every action" or "ask only before disk and generative actions"; uses Firefly credits | ★ | Adobe help page and trade press [search]; redsharknews.com/adobe-max-2026-premiere-color-mode-mcp (read) |
| Third-party agents call the editor (MCP / API / ChatGPT or Claude plugin) | Descript (hosted MCP `https://api.descript.com/v2/mcp`, API with token), Adobe (MCP integrations in preview for Photoshop, Illustrator, Premiere, After Effects; third-party agents from early 2027), CapCut (plugin in ChatGPT and Codex), Luma (in Claude and ChatGPT, MCP), HeyGen (MCP, ChatGPT plugin), Synthesia (API + MCP), Riverside (MCP + Agents), Loom (MCP, "Record for agent"), Kapwing (MCP), Pika (API, MCP, ChatGPT), Submagic (Video Editing API, ChatGPT and Claude integrations), Vizard (API), DaVinci Resolve 21.1 (MCP support [carried]) | The competitor becomes a tool the user's own agent calls. Descript's MCP: import media, run Underlord edits, search projects, publish to a link; costs media minutes and AI credits | ★ | descript.com/underlord, descript.com/mcp, help.descript.com/api-and-mcp/mcp [search], capcut.com, lumalabs.ai, heygen.com, synthesia.io/api, riverside.com, loom.com, kapwing.com/ai, pika.art, submagic.co (all read) |
| Text-based editing (delete words, video follows) | Descript, Kapwing "Trim with Transcript", Resolve Studio "text based editing", Riverside, Gling, Final Cut 12 Transcript Search | Edit the transcript; the matching media is cut | | descript.com, kapwing.com, blackmagicdesign.com/products/davinciresolve/ai (read) |
| Silence, filler words, bad takes removal | Gling (silences, filler words, "remove bad takes"), Descript (Remove Filler Words, Remove Retakes), Kapwing Smart Cut, Clipchamp, Recut/TimeBolt (TimeBolt page blocked, not read) | One pass, then the user reviews cuts | ★ (Gling, Descript) | gling.ai, descript.com/underlord (read) |
| Multicam auto-switch by who speaks | AutoPod (Premiere plug-in, up to 10 cameras and 10 microphones), Descript Automatic Multicam, Resolve 20 Multicam SmartSwitch [carried] | Assigns cameras to speakers and cuts between them | ★ | autopod.fm (read) |
| Long video to short clips with scoring | OpusClip (virality score, ClipAnything), Vizard, Submagic Magic Clips, Descript Create Clips, Riverside Magic Clips, Klap | Finds moments, scores them, reframes to 9:16, adds captions | ★ | opus.pro, vizard.ai, submagic.co, riverside.com (read); scoring detail [carried] |
| Animated word-by-word captions with style presets | Submagic, CapCut, Captions, Final Cut 12.3, Resolve 20 Animated Subtitles, Premiere iPhone | One click, 20+ languages claimed | | submagic.co (read); others [carried] |
| Eye contact correction | Descript, Veed, Captions, Submagic | Re-renders the gaze | | descript.com/underlord, veed.io, submagic.co (read) |
| Speech clean-up ("Studio Sound") | Descript Studio Sound, Premiere Enhance Speech, Resolve Audio Assistant, Riverside Magic Audio, Veed Clean Audio | Denoise + EQ + level in one step | | descript.com, riverside.com, veed.io (read) |
| Auto B-roll (stock or generated) | OpusClip AI B-roll, Submagic B-Roll, Descript stock media, Kapwing | Reads the script, inserts footage at topic changes | ★ | submagic.co (read); OpusClip [carried] |
| Translation and dubbing with voice clone and lip sync | ElevenLabs Dubbing (90+ languages, speaker-aware, keeps background audio), HeyGen, Synthesia Dubbing API, Kapwing Dubbing (40+ languages), Veed, Captions lip-synced dubbing, Descript | Upload, pick language, get dubbed video | ★ | elevenlabs.io/dubbing, synthesia.io/api, kapwing.com/ai (read) |
| Avatars and talking photos from a script | HeyGen, Synthesia (interactive avatars API), Descript, Veed (Fabric), Captions Twins, Submagic AI Actors, Riverside AI Twin | Script in, presenter video out | ★ | heygen.com, synthesia.io, veed.io, submagic.co (read) |
| Text/image/video-to-video generation with native audio | Runway (Gen-4.5, Aleph 2), Luma Ray 3.2, Pika (hosts Kling 4.0, Seedance 2.5, MiniMax H3, Wan 3.0, Gemini Omni), Google Gemini Omni Flash, CapCut (Seedance 2.0/2.5, Sora 2 listed), Veed, Descript | Prompt or reference images to 3 to 15 s clips | | pika.art, capcut.com, runwayml.com, ai.google.dev/gemini-api/docs/omni (read) |
| Conversational video editing of generated or uploaded clips | Gemini Omni Flash (multi-turn "make it night", extend by 3 to 10 s up to 30 s; upload up to 15 s) , Runway Aleph 2, FLUX Video Edit | Describe the change, model re-renders preserving the rest | | ai.google.dev/gemini-api/docs/omni.md.txt (read) |
| Music generation | Suno (no public API), ElevenLabs Music (cleared for commercial use per its page), Google Lyria 3.5, Pika Music Studio, Veed | Prompt or lyrics to song | | suno.com, elevenlabs.io docs, ai.google.dev pricing (read) |
| Sound-effect generation | ElevenLabs SFX (0.1 to 30 s), Premiere iPhone Generative Sound Effects, Pika SFX Studio | Text (or voice performance) to effect | | elevenlabs.io/docs/.../sound-effects.md (read); Adobe [carried] |
| Screen recording with automatic zoom and framing | Screen Studio (Mac only), Tella, Loom, Riverside | Records, then adds zooms, motion, framing automatically | | screen.studio, tella.com, loom.com (read) |
| AI object mask / tracking | Premiere 26 Object Mask, Resolve Magic Mask 2, Resolve 21 CineFocus (depth of field after the fact), IntelliSearch, Blemish Removal, Slate ID | Click, track | | blackmagicdesign.com/products/davinciresolve/ai (read); detail [carried] |
| Visual and transcript search of footage | Final Cut 12 Visual Search (natural language), Resolve 21 IntelliSearch, Premiere AI Assistant, TwelveLabs | Type "man in red jacket near a car", jump to matches | ★ (search) | blackmagicdesign.com (read); Final Cut [carried] |
| Beat detection and beat-synced cuts | Resolve 20 Detect Music Beats, Final Cut 12 Beat Detection, VN BeatsClip | Markers on bars and beats | | [carried] |
| Prompt-to-draft video | CapCut AI video maker (script, scenes, voiceover, pacing), Canva Magic Video, Filmora, Veed, Descript | Prompt to editable draft | ★ | capcut.com (read); detail [carried] |
| Publish and schedule from the editor | Submagic "Publishing Automation", Vizard, Riverside Social Scheduling, Descript publish link | One-click post | | submagic.co, riverside.com (read) |
| Licensed music inside the editor | Premiere iPhone: UMG and WMG tracks for personal, non-commercial videos only; Adobe Stock Audio for commercial | Browse and drop in | | petapixel.com/2026/11/10/... (read) |

---

## 2. Local, open models for a 4 GB GPU or CPU

Laptop: RTX 3050 4 GB, Intel iGPU, Windows 11, library drive with models. "Fits 4 GB" below is my judgement from parameter count and the card's own figure; where a card gives a VRAM figure I quote it, otherwise "unknown". Parameter counts are from the Hugging Face record.

Plug-in key: **PY** = Python worker, **ONNX** = ONNX Runtime worker, **CF** = ComfyUI workflow (project rule: no raw graph accepted, ADR-0007, so each is a named, validated workflow), **LC** = llama.cpp server (already integrated), **BUILD** = feature built in the editor.

### 2.1 Video generation

| Item | What | Publisher; version/date | Licence (exact) | Runs; needs | Plug-in; agent use | Blocks | Source |
|---|---|---|---|---|---|---|---|
| Wan 2.2 TI2V-5B | Text/image to 720p video, 5B | Alibaba Wan-AI; created 2025-07-18 | Apache-2.0 (HF tag) | Card: command "can run on a GPU with at least 24GB VRAM"; GGUF builds exist (QuantStack, Apache-2.0); 4 GB: not shown anywhere I read, unknown; a search summary said about 6 GB at 480p with GGUF [search] | CF (GGUF + offload). Agent makes 3 to 5 s inserts | Speed and fit on 4 GB unknown; needs a trial | huggingface.co/api/models/Wan-AI/Wan2.2-TI2V-5B, .../QuantStack/Wan2.2-TI2V-5B-GGUF (read) |
| Wan 2.1 T2V-1.3B | Smallest Wan, 480p | Wan-AI; 2025-02-25 | Apache-2.0 | Card: "requires only 8.19 GB VRAM" | CF with offload | Over 4 GB by the card's own number | huggingface.co/Wan-AI/Wan2.1-T2V-1.3B README (read) |
| Wan 2.1 VACE 1.3B | Video edit / inpaint / reference, 2.15B params | Wan-AI; 2025-05-13 | Apache-2.0 | Several GB, VRAM unknown | CF (official ComfyUI inpaint workflow exists [carried]) | Marginal on 4 GB | huggingface.co/api/models/Wan-AI/Wan2.1-VACE-1.3B (read) |
| LTX-2 / LTX-2.3 | 22B video+audio, distilled 8-step | Lightricks; updated 2026-10-22 | LTX-2 Community License Agreement, dated 2026-01-05: entities with annual revenue of at least USD 10,000,000 need a separate licence (line 87 of LICENSE-2) | 18.9B params file set; NVIDIA guide and vendor page say tens of GB; 4 GB: no | CF, or cloud | Not for this laptop | huggingface.co/Lightricks/LTX-2.3, raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2 (read) |
| LTX-Video 2B (0.9.x) | Older small LTX | Lightricks; 2024-10-31 | HF tag "other"; licence text not read | 1.9B params; card lists 2B distilled "for light VRAM usage", figure not given | CF | Licence text unread | huggingface.co/Lightricks/LTX-Video (read) |
| HunyuanVideo 1.5 | Video model | Tencent; 2025-11 | Tencent Hunyuan Community Licence: does not apply in EU, UK, South Korea | Large | cloud only in practice | Territory clause; size | raw.githubusercontent.com/Tencent-Hunyuan/HunyuanVideo-1.5/main/LICENSE (read) |
| MiniMax H3 (open weights, 33B) and H3-Tiny (14B to 17B pruned, INT8 18 GB) | Joint video+audio generation | MiniMax; 2026-07-28 / 2026-11-21 | MiniMax H3 Community Licence: applicable territory excludes EU, UK, South Korea and USA; separate authorisation above USD 20 million revenue | 18 GB even for the pruned INT8 | none locally | Size; territory | huggingface.co/MiniMaxAI/MiniMax-H3 LICENSE, H3-Tiny README (read) |
| CogVideoX-2b | 1.7B older video model | Zhipu; 2024-08 | Apache-2.0 (5B variant is "other") | Old; quality below Wan | CF | Dated | huggingface.co/api/models/zai-org/CogVideoX-2b (read) |
| LongCat-Video | Video model | Meituan; 2025-10-24 | MIT (HF tag) | Size not read | CF | Size unknown | huggingface.co/api/models/meituan-longcat/LongCat-Video (read) |

Reading: no open video generator I read runs on 4 GB without unproven offloading. Cloud generation (section 3) is the realistic route; local Wan 2.2 5B GGUF is a one-day trial, not a plan.

### 2.2 Image generation and ComfyUI node packs

| Item | What | Publisher; version/date | Licence | Runs; needs | Plug-in; agent use | Blocks | Source |
|---|---|---|---|---|---|---|---|
| FLUX.2 [klein] 4B | 3.9B image gen and edit | Black Forest Labs; 2026-01-14 | Apache-2.0 (HF tag, not gated) | Card: "~13GB VRAM"; GGUF builds exist (unsloth, Apache-2.0); 4 GB with GGUF: unknown | CF. Title cards, backgrounds, thumbnails | VRAM unproven | huggingface.co/black-forest-labs/FLUX.2-klein-4B (read) |
| FLUX.2 [klein] 9B | Larger | BFL | `flux-non-commercial-license` (NC), gated | no | none | NC | huggingface.co/api/models/black-forest-labs/FLUX.2-klein-9B (read) |
| Z-Image-Turbo | 6.2B fast image gen | Tongyi-MAI; 2025-11-25 | Apache-2.0 | VRAM not read; 6B means offload or GGUF | CF | Fit unknown | huggingface.co/api/models/Tongyi-MAI/Z-Image-Turbo (read) |
| SANA 1.6B | Small fast image gen | NVIDIA/Efficient-Large-Model | Apache-2.0 (HF tag) | VRAM not read | CF | Quality/fit unknown | huggingface.co/api/models/Efficient-Large-Model/Sana_1600M_1024px (read) |
| Stable Diffusion 1.5 | 0.86B | Runway/stable-diffusion-v1-5 mirror | CreativeML OpenRAIL-M (use restrictions travel with outputs) | Fits 4 GB (long-standing, not re-measured) | CF | Dated look | huggingface.co/api/models/stable-diffusion-v1-5/stable-diffusion-v1-5 (read) |
| Chroma1-HD (8.9B), Qwen-Image (20B), FLUX.1-schnell (11.9B, gated "auto") | Larger image models | various | Apache-2.0 each | Too large for 4 GB without GGUF | CF | Size | HF API records (read) |
| SDXL-Turbo; SD 3.5 Medium | Image gen | Stability | SAI NC community; "stabilityai-ai-community" (revenue threshold, text not read) | | | NC / unread | HF API records (read) |
| ComfyUI-GGUF | Load GGUF-quantised diffusion models | city96 | Apache-2.0 | Key to low VRAM | CF | none | raw.githubusercontent.com/city96/ComfyUI-GGUF/main/LICENSE (read) |
| ComfyUI-WanVideoWrapper | Wan nodes with block-swap offload | kijai | Apache-2.0 | | CF | none | raw.githubusercontent.com/kijai/ComfyUI-WanVideoWrapper/main/LICENSE (read) |
| ComfyUI-Frame-Interpolation | RIFE, FILM nodes | Fannovel16 | MIT | | CF | none | raw.githubusercontent.com/Fannovel16/ComfyUI-Frame-Interpolation/main/LICENSE (read) |
| ComfyUI-segment-anything-2 | SAM 2 masks | kijai | Apache-2.0 | | CF | none | .../kijai/ComfyUI-segment-anything-2 (read) |
| ComfyUI-SeedVR2_VideoUpscaler | SeedVR2 | numz | Apache-2.0 | needs far more than 4 GB | CF | VRAM | .../numz/ComfyUI-SeedVR2_VideoUpscaler (read) |
| ComfyUI-LTXVideo | LTX nodes | Lightricks | LTX-2 Community Licence | | CF | revenue clause | .../Lightricks/ComfyUI-LTXVideo (read) |
| ComfyUI, ComfyUI-Manager, VideoHelperSuite, KJNodes, ComfyUI-MultiGPU | Core and utility packs | Comfy-Org, Kosinkadink, kijai, pollockjj | GPL-3.0 each | The project already runs ComfyUI as a separate optional process over HTTP (ADR-0007) | CF | GPL is acceptable only while these stay separate processes the owner installs; do not bundle | raw.githubusercontent.com/... LICENSE files (read) |

Node packs worth having (all Apache-2.0 or MIT, so safe to name in a workflow): GGUF, WanVideoWrapper, Frame-Interpolation, segment-anything-2. VideoHelperSuite and KJNodes are GPL-3.0 and widely used; fine as the owner's own install, not as something this project ships.

### 2.3 Upscaling, interpolation, restoration, colourisation, inpainting

| Item | What | Publisher; version | Licence | Runs; needs | Plug-in; agent use | Blocks | Source |
|---|---|---|---|---|---|---|---|
| Real-ESRGAN (+ realesrgan 0.3.0 on PyPI) | Upscale, general-x4v3 for video | xinntao | BSD-3-Clause | Fits with tiling; already in project | CF today; ONNX possible | none | raw.githubusercontent.com/xinntao/Real-ESRGAN/master/LICENSE, pypi.org/pypi/realesrgan (read) |
| SeedVR2 3B / 7B | One-step video restoration | ByteDance-Seed; 2025-06 | Apache-2.0 (HF tag) | A user report of about 18 GB for 3B [carried] | CF | VRAM | huggingface.co/api/models/ByteDance-Seed/SeedVR2-3B (read) |
| FlashVSR | Fast video super-resolution | JunhaoZhuang; 2025-10 (updated 2026-08-15) | Apache-2.0 (HF tag); GitHub LICENSE not found | VRAM unknown | CF | Unknown fit | huggingface.co/api/models/JunhaoZhuang/FlashVSR (read) |
| RIFE (v4.25 weights; repos hzwer/ECCV2022-RIFE and Practical-RIFE) | Frame interpolation | hzwer / Megvii | MIT (both LICENSE files read) | 20 to 25 MB models; also a LiteRT build "RIFE-4.25-Lite", MIT, 2026-11-08 | CF today; ONNX/LiteRT possible | none | raw.githubusercontent.com/hzwer/Practical-RIFE/main/LICENSE, huggingface.co/litert-community/RIFE-4.25-Lite (read) |
| FILM | Interpolation for large motion | Google Research | Apache-2.0 (code) | Weights licence not read | CF | Weights licence unread | raw.githubusercontent.com/google-research/frame-interpolation/main/LICENSE (read) |
| CodeFormer | Face restoration | S-Lab NTU | S-Lab License 1.0, non-commercial | | none | NC | raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE (read) |
| GFPGAN | Face restoration | Tencent ARC | Apache-2.0 on the code (LICENSE read) | Model weights' own terms not read | PY | Weights unread | raw.githubusercontent.com/TencentARC/GFPGAN/master/LICENSE (read) |
| DDColor | Colourise black-and-white | piddnad | Apache-2.0 code and weights repo (HF tag) | Small; VRAM not read | PY/ONNX per frame (flicker risk) | Temporal consistency unknown | raw.githubusercontent.com/piddnad/DDColor/master/LICENSE, huggingface.co/api/models/piddnad/DDColor-models (read) |
| LaMa | Single-image inpainting | advimman | Apache-2.0 | About 200 MB [carried]; fits | PY/ONNX. Agent removes a sign or logo from a locked-off shot via one clean plate | Not video-aware | raw.githubusercontent.com/advimman/lama/main/LICENSE (read) |
| ProPainter | Video object removal | S-Lab NTU | S-Lab License 1.0, non-commercial ("for non-commercial purpose") | ONNX port exists (moonbox-dev, "other", 2026-11-20) | none | NC | raw.githubusercontent.com/sczhou/ProPainter/main/LICENSE (read) |
| DiffuEraser | Diffusion video inpainting | lixiaowen-xw | Apache-2.0 (code, HF) | SD1.5 + ProPainter prior [carried]; several GB | CF | Depends on ProPainter weights (NC) and VRAM | raw.githubusercontent.com/lixiaowen-xw/DiffuEraser/main/LICENSE (read) |
| MiniMax-Remover, E2FGVI | Video erase | various | GitHub LICENSE not found for either | | | Licence unknown | (404 on raw LICENSE) |
| Denoise / deblur | FFmpeg hqdn3d/nlmeans already; Real-ESRGAN general; cloud FLUX Deblur | | | | | | no separate local open model verified |

### 2.4 Lip sync, talking heads

| Item | What | Publisher; version | Licence | Runs; needs | Plug-in | Blocks | Source |
|---|---|---|---|---|---|---|---|
| MuseTalk 1.5 | Lip-sync a face video to new audio | Tencent Music (TMElyralab); HF updated 2026-11-19 | MIT (LICENSE + HF tag) | VRAM unknown; sources disagree, 4 to 8 GB [carried] | PY. Agent re-syncs mouth to a dubbed track | Dependent models (face parsing, whisper) licences unread | raw.githubusercontent.com/TMElyralab/MuseTalk/main/LICENSE (read) |
| LatentSync 1.6 | Higher-quality lip sync | ByteDance; 2025-06 | OpenRAIL++ (HF tag) | 18 to 20 GB reported [carried] | none | VRAM | huggingface.co/api/models/ByteDance/LatentSync-1.6 (read) |
| Wav2Lip | Old lip sync | IIIT Hyderabad | Non-commercial; README: "research/academic/personal purposes only" | | none | NC | raw.githubusercontent.com/Rudrabha/Wav2Lip/master/README.md (read) |
| FlashHead-LipSync-Lite | Lip sync | CreativeHub008; 2026-08-09 | MIT (HF tag only) | unknown | | Unvetted, tiny download count | huggingface.co/api/models?search=lip sync (read) |
| LivePortrait | Portrait animation | Kling Team; 2025-03 | MIT (HF tag) | | PY | The face-detection dependency's licence is unread | huggingface.co/api/models/KlingTeam/LivePortrait (read) |
| Wan 2.2 S2V 14B | Audio-driven talking video | Wan-AI | Apache-2.0 | 16B params | none | Size | huggingface.co/api/models/Wan-AI/Wan2.2-S2V-14B (read) |

### 2.5 Speech: Hebrew text-to-speech, voice conversion, recognition

| Item | What | Publisher; version | Licence | Hebrew? | Runs; needs | Plug-in | Blocks | Source |
|---|---|---|---|---|---|---|---|---|
| Chatterbox multilingual (ResembleAI) | TTS + voice clone | Resemble AI; chatterbox-tts 0.1.7 | MIT (README, LICENSE) | Yes, already adopted with Phonikud | CPU about 15 s per sentence in project proof | PY (done) | Hebrew needs pointing first | raw.githubusercontent.com/resemble-ai/chatterbox/main/LICENSE (read) |
| ZONOS3-Mini | 100M active params, 43 languages, voice clone, runs in browser | Zyphra; 2026-11-09 | Apache-2.0 on HF; the GitHub LICENSE is MIT (two files, both permissive) | Yes: "Middle East and Caucasus: Turkish, Arabic, Hebrew, Georgian" | "Real time on phones and laptops"; GGUF builds exist (ggml-org, Apache-2.0) | PY or in-browser; a second Hebrew voice | Hebrew quality: unknown, released 17 days ago, nobody here has listened | huggingface.co/Zyphra/ZONOS3-Mini README, raw.githubusercontent.com/Zyphra/ZONOS3-Mini/main/LICENSE (read) |
| VoxCPM2 | 2.3B TTS, 48 kHz, 30 languages, voice design from text | OpenBMB; 2026-04-03 (v2.0.3 on PyPI) | Apache-2.0 | Yes: "Hebrew" in the 30-language list | Card: about 8 GB VRAM; GGUF builds exist (Apache-2.0) | PY on CPU/GGUF | 4 GB fit unproven; Hebrew quality unknown | huggingface.co/openbmb/VoxCPM2, pypi.org/pypi/voxcpm (read) |
| Fish Audio S2-Pro | 4.6B TTS | Fish Audio; 2026-03 | "fish-audio-research-license"; fish-speech repo moved to a Fish Audio Community Licence (2026-10-13) | README mentions Hebrew | | none | Research licence | huggingface.co/api/models/fishaudio/s2-pro (read) |
| MMS-TTS Hebrew | Meta's Hebrew voice | Meta; 2023 | CC-BY-NC-4.0 | Yes | tiny | none | NC | huggingface.co/api/models?search=mms-tts-heb (read) |
| Higgs Audio v3 | TTS | Boson AI; 2026 | "research and non-commercial licence" | listed languages long | | none | NC | huggingface.co/drbaph/Higgs-Audio-v3-Studio (read) |
| Kokoro-82M, Dia 1.6B, CSM-1B, IndexTTS-2.5 | English-centred TTS | various | Apache-2.0 (IndexTTS-2.5 "other") | Hebrew not listed in the cards I searched (Kokoro, Dia, CSM, IndexTTS-2.5: 0 matches) | | none | No Hebrew | HF README searches (read) |
| Qwen3-TTS 0.6B / 1.7B | TTS | Alibaba; 2026-01 | Apache-2.0 | One mention of the word Hebrew in a 58 KB README; context not read, unknown | | trial | Unknown | huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base (read) |
| Seed-VC | Voice conversion | Plachta | GPL-3.0 (HF tag; GitHub LICENSE not found) | n/a | | none | GPL | huggingface.co/api/models/Plachta/Seed-VC (read) |
| RVC | Voice conversion | RVC-Project | MIT | n/a | needs per-voice training | PY | Consent workflow needed | raw.githubusercontent.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/main/LICENSE (read) |
| OpenVoice | Voice conversion/cloning | MyShell | MIT (text begins "Permission is hereby granted") | cross-lingual | PY | none | raw.githubusercontent.com/myshell-ai/OpenVoice/main/LICENSE (read) |
| VibeVoice-ASR | Speech recognition with speakers | Microsoft; 2026-01-21 | MIT | `he` in language list | 7B and 1.5B GGUF builds exist | PY/LC | Not tested | huggingface.co/microsoft/VibeVoice-ASR (read) |
| Qwen3-ASR 1.7B | Speech recognition | Alibaba; 2026-01-28 | Apache-2.0 | Hebrew not checked | | | | huggingface.co/api/models/Qwen/Qwen3-ASR-1.7B (read) |
| ivrit-ai Whisper large-v3(-turbo) CT2, pyannote 3.1 (ivrit-ai) | Hebrew recognition and speakers | ivrit.ai | Apache-2.0 (whisper), MIT (pyannote fork) | Yes | already planned | PY | | HF API (read) |

### 2.6 Music, sound effects, audio understanding

| Item | What | Publisher; version | Licence | Runs; needs | Plug-in; agent use | Blocks | Source |
|---|---|---|---|---|---|---|---|
| ACE-Step 1.5 | Text/lyrics to song, local | ACE Studio / StepFun; 2026-01-23 | MIT (GitHub LICENSE and HF tag); Comfy-Org ComfyUI build Apache-2.0 | Card: "less than 4GB of VRAM" | CF (Comfy-Org/ACE-Step-1.5) or PY. Agent makes a bed track to length | Card claim not tested; Hebrew lyrics not stated | huggingface.co/ACE-Step/Ace-Step1.5, raw.githubusercontent.com/ace-step/ACE-Step-1.5/main/LICENSE (read) |
| Stable Audio Open Small (497M) / 1.0 (1.2B) | Short audio, SFX | Stability; 2025 | Stability AI Community licence (gated "auto") | Small | CF/PY | Revenue-threshold terms unread | huggingface.co/api/models/stabilityai/stable-audio-open-small (read) |
| MusicGen / AudioCraft | Music | Meta | Code MIT (audiocraft 1.3.0), weights CC-BY-NC-4.0 | | none | NC weights | huggingface.co/api/models/facebook/musicgen-small (read) |
| YuE2 (3B) | Full songs with vocals | m-a-p; 2026-09 | CC-BY-NC-4.0 | | none | NC | huggingface.co/m-a-p/YuE2-3B (read) |
| MMAudio | Video-to-audio (foley) | Sony / hkchengrex | Code MIT; weights CC-BY-NC-4.0 (a repack tagged MIT conflicts, take the stricter) | | none | NC | raw.githubusercontent.com/hkchengrex/MMAudio/main/LICENSE, huggingface.co/api/models/hkchengrex/MMAudio (read) |
| HunyuanVideo-Foley | Video-to-audio | Tencent; 2025-08 | Tencent Hunyuan Community Licence (territory clause as above) | | | | raw.githubusercontent.com/Tencent-Hunyuan/HunyuanVideo-Foley/main/LICENSE (read) |
| TangoFlux | Text to audio | declare-lab | HF record has no licence field; unknown | | | | huggingface.co/api/models/declare-lab/TangoFlux (read) |
| CLAP (laion/clap-htsat-unfused) | Audio-text matching, tagging | LAION | Apache-2.0 | Small | PY/ONNX. Agent finds "applause", "dog bark" in footage | none | huggingface.co/api/models/laion/clap-htsat-unfused (read) |
| PANNs CNN14 | Audio tagging | already in manifest (CC-BY-4.0) | | | | | |
| Qwen3-Omni 30B-A3B, Kimi-Audio 7B, Audio Flamingo 3 | Audio captioning / audio chat | Alibaba (Apache-2.0), Moonshot (MIT), NVIDIA ("other") | | 35B / 9.8B / 8.3B params | none | Size | HF API (read) |
| Qwen2.5-Omni-3B | Small omni model | Alibaba | `qwen-research` licence | | none | Research licence | HF API (read) |

### 2.7 Understanding footage: shots, text on screen, vision-language, highlights

| Item | What | Publisher; version | Licence | Runs; needs | Plug-in; agent use | Blocks | Source |
|---|---|---|---|---|---|---|---|
| PySceneDetect 0.7.3 | Shot boundaries by content/threshold | Breakthrough | BSD-3-Clause | CPU, Python 3.10+ | PY or port the idea to the existing frame jobs. Agent cuts footage into shots, builds a shot list | none | pypi.org/pypi/scenedetect, raw.githubusercontent.com/Breakthrough/PySceneDetect/main/LICENSE (read) |
| TransNetV2 (`transnetv2-pytorch` 1.0.5) | Learned shot-boundary net, handles dissolves | Souček / Lokoč | MIT | Small; CPU ok | PY/ONNX (conversion unverified) | none | raw.githubusercontent.com/soCzech/TransNetV2/master/LICENSE, pypi.org/pypi/transnetv2-pytorch (read) |
| Tesseract | OCR | tesseract-ocr | Apache-2.0; `heb.traineddata` exists (tessdata_fast, 961 KB) | CPU | PY/CLI. Agent finds on-screen Hebrew text, reads slides | Accuracy on video frames unknown | raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/heb.traineddata (HTTP 200) (read) |
| RapidOCR 3.10.0 (ONNX), PaddleOCR 3.7.0, EasyOCR 1.7.2, docTR | OCR families | RapidAI, Baidu, Jaided, Mindee | Apache-2.0 each | ONNX Runtime fits the project's runtime | ONNX | Hebrew support not confirmed in the pages I could read | pypi.org JSON, GitHub LICENSE files (read); Hebrew: unknown |
| Surya OCR | Layout + OCR | VikParuchuri | Apache-2.0 code; model-weight terms not read | | | Weights unread | raw.githubusercontent.com/VikParuchuri/surya/master/LICENSE (read) |
| Qwen3-VL 2B / 4B Instruct | Image+video question answering | Alibaba; 2025-10 | Apache-2.0 | 2.1B / 4.4B params; GGUF through llama.cpp | LC. Agent describes keyframes, finds "the shot with the red car" | Hebrew ability unknown | huggingface.co/api/models/Qwen/Qwen3-VL-2B-Instruct (read) |
| SmolVLM2 2.2B | Small video-capable VLM | Hugging Face; updated 2026-11-12 | Apache-2.0 | 2.2B | LC/PY | Hebrew unknown | HF API (read) |
| InternVL3.5 1B / 2B | Small VLM | OpenGVLab; 2025-08 | Apache-2.0 | | LC/PY | | HF API (read) |
| Florence-2 large | Captions, detection, OCR in one | Microsoft | MIT | 0.78B | PY/ONNX | English-centred | HF API (read) |
| moondream2 | Tiny VLM | vikhyatk; updated 2026-09-23 | Apache-2.0 | 1.9B | PY | | HF API (read) |
| Gemma 4 E2B-it | Already on the drive | Google; 2026-03-02 | Apache-2.0 (licence_link ai.google.dev/gemma/docs/gemma_4_license) | 5.1B params incl. embeddings | LC (done) | | HF API (read) |
| MiniCPM-V 4.5 (8.7B), Inkling-2-Mini (26B MoE, multimodal, Apache-2.0, 2026-11-17) | Larger VLMs | OpenBMB; Thinking Machines | Apache-2.0 | Too big for 4 GB; CPU only if RAM allows (RAM of the laptop: unknown) | | Size | HF API (read) |
| LFM2-VL 1.6B | Small VLM | Liquid AI | `lfm1.0` licence (revenue threshold, text not read) | | | Unread terms | HF API (read) |
| FastVLM 1.5B | Small VLM | Apple | `apple-amlr` (research) | | none | Research only | HF API (read) |
| Highlight / virality scoring | No licensed open model found. The workable approach: score candidate moments with (a) transcript text through the assistant model, (b) audio energy and laughter tags (PANNs/CLAP), (c) shot rate from PySceneDetect, (d) keyframe captions from a VLM; optionally cloud: TwelveLabs, Gemini | | | | BUILD | The weights of "virality" are a product guess; no ground truth available | method only |

### 2.8 Translation, Hebrew text tools, safety

| Item | What | Publisher; version | Licence | Runs; needs | Plug-in | Blocks | Source |
|---|---|---|---|---|---|---|---|
| NLLB-200 (600M, 1.3B, 3.3B) | Translation, 200 languages | Meta; 2022 | CC-BY-NC-4.0 | | none | NC. Out | huggingface.co/api/models?search=nllb (read) |
| MADLAD-400 3B / 7B / 10B | Translation, 400+ languages | Google; 2023-11 | Apache-2.0; CT2 int8 (3B) and GGUF builds exist | 2.9B params; int8 about 3 GB; Hebrew: card has one match for "he"/"Hebrew", language list is in the paper, not read | PY (CTranslate2) or LC. A permissive replacement for NLLB | Hebrew quality unknown | huggingface.co/google/madlad400-3b-mt, Nextcloud-AI/madlad400-3b-mt-ct2-int8 (read) |
| OPUS-MT he-en (tc-big) / en-he | Translation | Helsinki-NLP | CC-BY-4.0 / Apache-2.0 | Already in project | | | HF API (read) |
| Hunyuan-MT-7B | Translation | Tencent | HF record has no licence field (Tencent community licence likely, not read) | 8B params | | Unread | HF API (read) |
| Seed-X-PPO-7B | Translation | ByteDance Seed | OpenMDW licence | 7.5B | | Size, Hebrew unknown | HF API (read) |
| TranslateGemma 4B | Translation | Google; 2026-01 | Gemma licence, gated "manual" | 4.3B | | Gate; Hebrew listing not confirmed (0 matches in the ungated read, which may have failed) | HF API (read) |
| dictabert-large-char-menaked, Phonikud | Hebrew vowel points | Dicta, Phonikud | CC-BY-4.0, MIT | already in manifests | | | |
| Hebrew punctuation model | Restore punctuation in unpunctuated Hebrew | | | I found none in the Dicta model list (15 top models by downloads) | | Whisper-style models output punctuation; a separate Hebrew punctuation model: unknown | HF search for "dicta-il" (read) |
| OpenAI `omni-moderation` | Text and image moderation | OpenAI | Page: "free to use", images up to 20 MB | Cloud | provider adapter | Sends content to OpenAI | developers.openai.com/api/docs/guides/moderation (read) |
| Qwen3Guard-Gen-0.6B | Safety classification, "119 languages and dialects" | Alibaba; 2025-11 | Apache-2.0 | 0.75B; CPU/LC | LC/PY. Agent flags unsafe transcript segments | Hebrew accuracy unknown | huggingface.co/Qwen/Qwen3Guard-Gen-0.6B (read) |
| Falconsai nsfw_image_detection | Image NSFW classifier | Falconsai | Apache-2.0 | 86M params | ONNX/PY per keyframe | English-centred; accuracy on video unknown | HF API (read) |
| xlmr-large-toxicity-classifier-v2 | Multilingual toxicity | textdetox | OpenRAIL++ | 560M | PY | Hebrew coverage unknown | HF API (read) |
| ShieldGemma 2 4B, Llama Guard 4 12B, gpt-oss-safeguard 20B | Safety models | Google (gemma), Meta (llama4), OpenAI (Apache-2.0) | gated / licence-restricted / Apache | Large | | Size or gate | HF API (read) |
| Hebrew profanity and bleep | No model found. Use the transcript with word timestamps and a word list; the project already has transcript-driven cuts | | | | BUILD | Needs a Hebrew word list the owner approves | method only |

---

## 3. Cloud APIs the agent could call with the owner's keys

Prices are what the page said on 2026-11-26. "Auth" is what I could confirm. Published-video terms I could not read for most providers; I say so.

| Capability | Provider and API | Auth; price unit | Terms that matter for published videos | Plug-in | Source (read) |
|---|---|---|---|---|---|
| Video gen + edit, multi-vendor router | **Runway API**: own Gen-4.5 (12 credits/s), Gen-4 Turbo (5), Aleph 2 (28, edits footage), Act-Two (5); also routes Kling 3.0/4, Wan 3, Seedance 2.0/2.5, Hailuo 3, Grok Imagine 1.5, Veo 3.1 (20 to 40 credits/s), Gemini Omni Flash | API key in developer portal; 1 credit = USD 0.01; per second of output; response reports realised cost | Not read | provider adapter, async task | docs.dev.runwayml.com/guides/pricing (read) |
| Video gen + conversational edit | **Google Gemini Omni 1.2 Flash** (`gemini-omni-1.2-flash`): 3 to 15 s with audio, 6 reference images, multi-turn edit, extend to 30 s | Gemini API key; USD 12 per 1M output tokens, 5,792 tokens per second of 720p = about USD 0.07 per second (360p 0.023, 1080p 0.104, 4K 0.209) | SynthID watermark on all output; editing or extending uploaded video not available in EEA, Switzerland, UK; some recognisable people refused; "Veo 3.1 Preview in the Gemini API has been shut down" | adapter on the same Gemini key as the language provider | ai.google.dev/gemini-api/docs/omni.md.txt, .../pricing.md.txt, .../video.md.txt (read) |
| Video gen | **OpenAI Sora 2 / Videos API** | | Page: "shut down on September 24, 2026" | none | developers.openai.com/api/docs/guides/video-generation (read) |
| Video gen via many models | **fal.ai**: Kling v3 Pro about USD 0.14/s, MiniMax H3 Max T2V USD 0.03/s (turbo 0.015), Seedance 2 per 1,000 tokens (USD 0.014), Nano Banana 2 USD 0.08/image, FLUX schnell USD 0.003/MP, ElevenLabs TTS USD 0.10 per 1,000 characters, ElevenLabs SFX v2 USD 0.002/s, ACE-Step USD 0.0002/s | API key; output units | Per model; not read | adapter (project's TECH_RADAR lists fal as candidate) | fal.ai/pricing (read) |
| Video gen | **Luma** Dream Machine API, now "Luma Agents API" (Ray 3.2); Luma MCP | API key via Luma API Platform; price: not read | Not read | adapter or MCP | docs.lumalabs.ai, lumalabs.ai (read) |
| Video gen | **Pika** (Developers, API, MCP); **Kling**, **Seedance (BytePlus ModelArk)**, **Hailuo/MiniMax** | Pages thin or unreadable (kling dev page empty; BytePlus page index only) | Not read | via Runway/fal instead | pika.art, byteplus docs (read, little content) |
| Video edit tools | **Black Forest Labs**: FLUX 3 Video, FLUX Video Edit [fast] (per second of output), Video Upscale (per output megapixel-second), Erase, Deblur, Outpainting; MCP server with OAuth; "MCP & Agent Skills" docs | API key; credits; exact prices are rendered by script, not captured | Not read | adapter or MCP | docs.bfl.ai (read) |
| Image gen | Google Nano Banana 2 (`gemini-3.1-flash-image`) about USD 0.0504 at 2K, USD 0.113 at 4K; OpenAI `gpt-image-2` (via fal at USD 1 unit, unit unclear); BFL FLUX.2 / klein; Stability Stable Image | Keys; credits (Stability 1 credit = USD 0.01) | SynthID on Google output | adapter | ai.google.dev pricing, fal.ai/pricing, platform.stability.ai/pricing (read) |
| Avatars | **HeyGen** (API, MCP, ChatGPT plugin), **Synthesia API** (video creation, dubbing, interactive avatars, MCP), D-ID, Tavus (not read) | HeyGen/Synthesia: key; plan caps (Synthesia write limits 60 to 120 requests/minute by plan); price per video: not captured | Avatar consent rules: not read. The project already requires named consent for voices | adapter + consent gate | heygen.com, synthesia.io/api (read) |
| Dubbing / lip-sync translation | **ElevenLabs Dubbing** (90+ languages, speaker detection, background kept, Dubbing Studio editing); HeyGen, Synthesia Dubbing API | `xi-api-key`; credits | Not read for dubbing; Eleven Music page says "cleared for nearly all commercial" use | adapter (ElevenLabs is one adapter for TTS, SFX, music, dubbing, Scribe) | elevenlabs.io/docs/overview/capabilities/dubbing.md (read) |
| Music | **ElevenLabs Music**; **Google Lyria 3.5** (USD 0.08 per full song; Lyria 3 clip preview USD 0.04); Stability Stable Audio. **Suno**: no public API; a partner-programme intake form opened 2026-07 [search]; wrappers are unofficial. **Udio**: no API found; licensing deals with UMG and WMG, terms unread [search] | keys | ElevenLabs: cleared for commercial use (own page). Lyria: Google terms, output carries SynthID (Gemini page) | adapter | elevenlabs.io docs, ai.google.dev pricing (read) |
| Sound effects | ElevenLabs SFX: 0.1 to 30 s, "40 credits per second" | key | Not read | same ElevenLabs adapter | elevenlabs.io/docs/.../sound-effects.md (read) |
| Stock with AI search | Pexels, Pixabay, Storyblocks, Shutterstock etc. | See `.artifacts/wave8/sources-research.md` [carried] | | | |
| Transcription with speaker names | AssemblyAI (Universal-2 USD 0.15/hr; AssemblyAI-STT-3.7 USD 0.21/hr, 32 languages, speaker labelling; Hebrew in either: unknown); Deepgram Nova (60+ languages, diarisation; Flux STT USD 0.0065 to 0.0078/min; Hebrew: unknown); ElevenLabs Scribe v3 (Hebrew listed [carried]); Google Chirp 3 (Hebrew listed [carried]) | keys; per hour/minute | Not read | adapter | assemblyai.com/pricing, deepgram.com/pricing (read) |
| Clip finder / video search | **TwelveLabs** (Marengo search, Pegasus questions, Jockey agent in Claude/ChatGPT, API; plans Free, Plus USD 29/month, Pro USD 99/month with storage caps; per-minute indexing price not captured); **OpusClip API** (sources conflict: "Limited API Access" on Pro, Beta, or Business-only) [search]; **Vizard API** (paid plans) [search]; **Klap** (about USD 0.32 to 0.48 per operation) [search]; **Submagic API** | keys | Not read | adapter; most useful: TwelveLabs for finding a moment in hours of footage | docs.twelvelabs.io, twelvelabs.io/pricing, opus.pro/blog [search] (read/search) |
| Video understanding (no extra vendor) | Gemini video input (same key as language model) | key; tokens | Data use: free tier "used to improve our products: Yes", paid tier "No" (pricing page tables) | adapter extension | ai.google.dev/gemini-api/docs/video-understanding.md.txt (read), pricing.md.txt |
| Upscaling | **Topaz Labs API** (video/image upscale and enhance; price not captured); BFL Video Upscale; Runway; Stability Upscale | keys | Not read | adapter | topazlabs.com/api (read, thin) |
| Descript Underlord as a cloud co-editor | Hosted MCP + API | Login-based OAuth (MCP, one Drive) or API token; media minutes + AI credits | Publishing gives a Descript link; no raw file without publishing | MCP the agent connects to; a possible fallback for jobs the editor cannot do yet | descript.com/mcp, help.descript.com/api-and-mcp/mcp [search] |
| Moderation | OpenAI omni-moderation (free) | key | Do not send suspected CSAM | adapter | developers.openai.com/api/docs/guides/moderation (read) |

Platform terms for published videos that I did read: YouTube asks creators to disclose AI-generated or altered content that seems realistic, at upload (support.google.com/youtube/answer/14328491, read). Google Omni and Lyria output carries SynthID. Adobe's UMG/WMG tracks are for personal, non-commercial use only. TikTok, Meta and Instagram labelling rules: not read.

---

## 4. The agent ecosystem

### 4.1 MCP servers for creative and media tools

Licence from the repository LICENSE file unless marked. "Maturity" is what the repo or registry shows; I did not run any of them.

| Tool | Server (repo) | Licence | Exposes | Maturity | Source |
|---|---|---|---|---|---|
| DaVinci Resolve | samuelgursky/davinci-resolve-mcp | MIT | Full Resolve Scripting API; 37 tools in compact mode, 390 in full mode; README claims 93.6% live tested; needs Resolve Studio; Python 3.10+; npm package | v5.5.2, 3.1K stars [search] | github.com/samuelgursky/davinci-resolve-mcp (read) |
| Premiere Pro | Immersive-Media-Technologies/premiere-mcp-imt | Apache-2.0 | About 380 readback-verified operations behind 9 tools; masks and speed keys by sight; skills library | v1.3.1 in registry | registry.modelcontextprotocol.io, GitHub README (read) |
| Premiere + Resolve | koptsev63/premiere-claude-bridge | MIT | Logs, transcribes, rough cut, subtitles, QC | v0.8.10, "Beta" | GitHub README (read) |
| After Effects | Dakkshin/after-effects-mcp (panel bridge), kumoproductions/mcp-aftereffects (no panel, Node 24+, Windows and macOS, AE 2024 to 2026), a-y-ibrahim fork (47 tools) | not read | Layers, keyframes, effects | community, several forks | web search [search] |
| Blender | ahujasid/blender-mcp (now PyPI `mcp-for-blender`) | MIT | Scene modelling, materials, rendering | widely used [search] | raw LICENSE (read) |
| Unreal Engine | ChiR24/Unreal_mcp | MIT | Assets, levels, sequences | v0.4.x | registry (read) |
| Figma | Official `com.figma.mcp` (hosted); GLips/Figma-Context-MCP | MIT (GLips) | Design context | v0.13 (GLips) | registry (read) |
| OBS | royshil/obs-mcp (OBS 31+), `obs-studio-mcp` on PyPI, xDarkzx (148 tools), others | not read | Scenes, sources, record, stream, replay buffer via obs-websocket v5 | several community | web search [search] |
| ComfyUI | artokun/comfyui-mcp | MIT | Run workflows, manage models and VRAM | v0.52.x | registry, raw LICENSE (read) |
| FFmpeg | Ashutos1997/ffmpeg-mcp-server, ffmpeg-micro (cloud) | not read | FFmpeg/FFprobe | small | registry (read); low value, the editor owns FFmpeg |
| ElevenLabs | elevenlabs/elevenlabs-mcp (official) | MIT | TTS, voices, music, SFX, transcription, agents | official | raw LICENSE, registry (read) |
| Descript | descriptinc/descript-mcp and hosted server | Apache-2.0 | search_drive, import_media, prompt_project_agent (Underlord), publish | official | raw LICENSE, README (read) |
| Runway | mindstone/mcp-server-runway | not read | Video, image, audio, voice generation, task management | third-party v0.5 | registry (read) |
| Replicate | sena-labs/replicate-mcp-server | not read | 36 tools: image, video, audio, speech, upscale | v3.3 | registry (read) |
| Hosted vendor MCPs | Luma, HeyGen, Synthesia, Pika, Loom, Kapwing, Riverside, BFL, Stability, TwelveLabs Jockey | their own terms | Their generation and edit APIs | vendor-run | vendor pages (read) |
| Stock | Pexels (several), Unsplash | not read | Search photos/videos | many small servers | registry (read) |
| Motion graphics | LottieFiles `creator`, Shotstack MCP (cloud render), Remotion | Remotion: own licence, free for individuals and for-profit companies of up to 3 people, company licence above that | Remotion MCP (`@remotion/mcp`) reported retired 2026-10-26 in favour of Agent Skills [search; one source disagrees] | | remotion-dev/remotion LICENSE.md (read) |
| Browsers | microsoft/playwright-mcp, ChromeDevTools/chrome-devtools-mcp | Apache-2.0 | Drive a real Chrome | official, mature | raw LICENSE (read) |
| YouTube | kirbah/mcp-youtube (data only) | not read | Search and statistics; no upload server found in the registry | | registry (read) |
| Music apps | Ableton Live servers (3 found) | not read | | | registry (read) |
| Discovery | `registry.modelcontextprotocol.io/v0/servers?search=` (official registry API) | | | live | read |

### 4.2 Agent skills formats

| Format | What | Licence | How a skill is described | Source |
|---|---|---|---|---|
| Agent Skills (open standard, originated at Anthropic, now at agentskills.io) | A folder with `SKILL.md` plus optional `scripts/`, `references/`, `assets/` | Spec repo Apache-2.0 | YAML front matter: `name` (1 to 64 chars, lower-case letters, digits, hyphens, must equal folder name), `description` (1 to 1024 chars, says what it does and when to use it), optional `license`, `compatibility` (up to 500 chars), `metadata` (string map), `allowed-tools` (space-separated, experimental). Body is Markdown instructions loaded only when the description matches ("progressive disclosure") | agentskills.io/specification, raw.githubusercontent.com/agentskills/agentskills/main/LICENSE (read) |
| Products that already ship skills for media | Remotion (`npx skills add remotion-dev/skills`), BFL ("MCP & Agent Skills"), Gemini coding-agent skills, premiere-mcp-imt skills library | various | same folder format | remotion.dev/docs/ai/skills [search], docs.bfl.ai, ai.google.dev (read) |

Fit for this editor: store a saved editing skill as a standard folder with a `SKILL.md` whose body names the editor's MCP tools, so the same skill loads in other agents; `allowed-tools` can list the tool names. The skill is instructions, not code; the editor still enforces scopes at the tool (CLAUDE.md invariant: actor and scopes come from the credential).

### 4.3 Frameworks for long-running tool-using agents (Node)

| Framework | Licence | What it adds over a plain tool loop | Verdict |
|---|---|---|---|
| Temporal TypeScript SDK | MIT | Durable execution, retries, human-approval waits across restarts. Needs a Temporal server | The project already has durable job rows and approval gates; only worth it if agent runs must survive restarts for hours |
| Inngest AgentKit | Apache-2.0 | Step-wise durable functions | Same |
| OpenAI Agents SDK (JS) | MIT | Handoffs, guardrails, tracing | Little beyond the loop; ties to OpenAI shapes |
| Vercel AI SDK | Apache-2.0 | Provider-neutral tool calling and streaming | Overlaps the project's own provider adapters |
| LangGraph JS | MIT | Graph state, checkpointing | Heavier than needed |
| Mastra | Apache-2.0 with `ee/` directories under a separate licence (file says so) | Agents, workflows, evals | Mixed licence; skip |
| Claude Agent SDK (TypeScript) | "© Anthropic PBC. Use is subject to Anthropic's Commercial Terms" (not open source) | Same harness as Claude Code: context management, subagents, MCP client, skills | Possible for the Claude-first path, but it ties the agent to one vendor; a plain loop keeps OpenAI-compatible providers equal |

Verdict: nothing here beats the project's own loop for this job except durable resume (Temporal or Inngest) if needed later. Source: raw.githubusercontent.com/<repo>/main/LICENSE for each (read).

### 4.4 Evaluation harnesses for agents that edit media

| Item | What | Licence / date | Source |
|---|---|---|---|
| Timeline-Bench (arXiv 2609.35143) | 56 end-to-end editing tasks from raw footage and a brief; a task passes only if the rendered video passes every test; best of 16 agents solved 15 of 56 | arXiv, 2026-09-28 | arxiv.org/abs/2609.35143 (title and date read; numbers [search]) |
| TimelineBench (NeurIPS 2026 listing) | 100 tasks, scored by comparing structured project-state changes, not the agent's path | not read | neurips.cc/virtual/2026/166886 [search] |
| CutVerse (arXiv 2605.19484) | GUI-agent benchmark for post-production; reported 36.0% best task success | arXiv, 2026-05-19 | arxiv.org/abs/2605.19484 (read); number [search] |
| AgenticVBench (arXiv 2605.27705) | 100 tasks in four post-production families, open rubrics | CC BY 4.0 [search], 2026-05-26 | arxiv.org/abs/2605.27705 (read) |
| inspect_ai (UK AI Security Institute) | General agent-evaluation harness with tool and sandbox support | MIT | raw LICENSE (read) |
| promptfoo | Prompt and tool-call regression tests | MIT | raw LICENSE (read) |

Fit: TimelineBench's "compare project state" scoring matches this editor's design (every edit is an op on one store), so a state-diff checker is cheap to write. The task lists can seed a private eval set. Whether the benchmark data is downloadable and under what terms: not read.

---

## 5. Other finds an autonomous editor would want

| Item | What it gives | Where from | Licence / terms | Plug-in; what blocks it | Source |
|---|---|---|---|---|---|
| AI-content disclosure flag on publish | YouTube requires disclosure of realistic AI-generated/altered content; the publish connector should set it from the asset provenance the project already records | YouTube Help | policy | BUILD (publishing connectors are "not built") | support.google.com/youtube/answer/14328491 (read) |
| SynthID detection / provenance | Google marks Gemini Omni output; the editor could record the marker beside C2PA | Google | Gemini terms | BUILD; detection tool availability: unknown | ai.google.dev omni doc (read) |
| Retention / hook analysis | Pre-flight "will viewers stay" from pacing, hook length, caption density | No tool found; build from shot rate, speech rate, silence | n/a | BUILD | method only |
| Teleprompter and webcam capture | Tella, Loom, Riverside record then edit | Competitors | | BUILD; not in CAPABILITIES or the parity list | tella.com, loom.com (read) |
| Loom "Record for agent" | A screen recording with clicks and URLs packaged as a prompt for an agent | Loom | Loom terms | Idea: the editor accepts a recorded walkthrough as an instruction | loom.com (read) |
| Gemini Docs MCP | Live, current API docs inside the agent | Google | | MCP, free | ai.google.dev (read; URL `gemini-api-docs-mcp.dev` given in page header) |
| Adobe Premiere AI Assistant approval rules | A model for the editor's own approval levels (ask every action / ask only for disk and generative actions) | Adobe | | Design reference | petapixel, Adobe help [search] |

---

## 6. Top 20 to adopt first

Ranked by value to an autonomous general-purpose editor divided by cost to plug in on this laptop. Size: S under 3 days, M under 2 weeks, L longer. Plug-in way in brackets.

| # | Item | Plug-in way | Size | Why |
|---|---|---|---|---|
| 1 | Agent Skills `SKILL.md` as the saved-skill format | feature (BUILD) | S | Open standard, Apache-2.0, no model; makes every saved workflow portable and gives the agent progressive loading |
| 2 | PySceneDetect 0.7.3 (+ TransNetV2 later) | Python worker (BSD-3 / MIT) | S | CPU only; gives the agent a shot list for every file, which feeds search, B-roll, reframing and highlight picking |
| 3 | Gemini video understanding on the existing Gemini key | provider adapter | S | The agent can "watch" footage with no local GPU; same key as the language provider; paid tier says content is not used for product improvement |
| 4 | Small local VLM for keyframe captions (Qwen3-VL 2B/4B or SmolVLM2; Gemma 4 E2B already on drive) | llama.cpp server (already integrated) | S | Offline footage description; Hebrew ability unknown, test first |
| 5 | ElevenLabs adapter: TTS (Hebrew in v3/v4), SFX, Music, Dubbing, Scribe | provider adapter with key | M | One key covers five missing capabilities, including dubbing, which is "not built" in CAPABILITIES |
| 6 | Runway API as a video-generation router (or fal.ai) | provider adapter, async jobs | M | One adapter reaches Kling, Seedance, Veo, Wan, Hailuo, Grok and Gemini Omni at USD 0.01 per credit; no vendor lock |
| 7 | Gemini Omni 1.2 Flash for generate-and-edit of short clips | provider adapter on the Gemini key | S after #3 | About USD 0.07 per second at 720p, 3 to 15 s with audio, edits its own output across turns; EEA/UK limits on editing uploads |
| 8 | Image generation adapter (Nano Banana 2 / FLUX / gpt-image) | provider adapter | S | Title cards, thumbnails, B-roll stills; per-image prices are small |
| 9 | Safety pass: OpenAI omni-moderation (free) + Qwen3Guard-Gen-0.6B local | adapter + llama.cpp/Python | S | Flags sensitive speech and frames before publish; profanity bleep itself is a transcript-cut feature to build |
| 10 | Hebrew TTS trial: ZONOS3-Mini and VoxCPM2 | Python worker, side-by-side with Chatterbox | S | Both list Hebrew and are Apache-2.0; Chatterbox needs pointed text and 15 s per sentence; quality unknown until someone listens |
| 11 | MADLAD-400 3B (Apache-2.0) for local caption translation | Python (CTranslate2) or llama.cpp | S | NLLB is non-commercial; MADLAD is the permissive route; Hebrew quality to be checked against OPUS-MT |
| 12 | Tesseract (`heb`) / RapidOCR for on-screen text | CLI / ONNX worker | S | Makes slides, signs and lower-thirds searchable and lets the agent avoid covering text; accuracy on video frames unknown |
| 13 | ACE-Step 1.5 local music | ComfyUI workflow (Apache-2.0 Comfy-Org build) or Python | M | MIT; card claims under 4 GB VRAM; fills the "music generation" gap without a key |
| 14 | Playwright MCP / Chrome DevTools MCP | MCP the agent connects to | S | Apache-2.0; agent can check a published page, download its own assets, preview HTML templates |
| 15 | Agent-edit evaluation set (Timeline-Bench / AgenticVBench task shapes + a state-diff checker; inspect_ai optional) | BUILD (tests) | M | Best published agent solves 15 of 56; this editor needs its own measure to know it is improving |
| 16 | TwelveLabs (Marengo / Pegasus) clip finder | provider adapter | S | "Find the moment" across hours of footage without local GPU; paid, per-minute price not captured |
| 17 | BFL FLUX Erase / Deblur / Video Edit and Upscale | provider adapter | M | Cloud answer to object removal and restoration while ProPainter is non-commercial; prices not captured |
| 18 | HeyGen / Synthesia adapters for avatars and dubbing | provider adapter + consent gate | M | Whole-job avatar video; the consent gate for voices already exists |
| 19 | YouTube publish connector with AI-disclosure field | BUILD (publishing connectors "not built") | M | Closes the loop from request to published video; disclosure is required by YouTube |
| 20 | MuseTalk 1.5 lip sync | Python worker | L | MIT, would let local dubbing look right; 4 GB fit unproven, so cloud dubbing (#5, #18) first |

Not ranked but cheap: LaMa for single-plate removal (Apache-2.0), DDColor colourise (Apache-2.0), Descript hosted MCP as an optional external co-editor, Blender MCP for 3D titles.

---

## 7. Features every competitor has that this editor lacks

Checked against `docs/design/REFERENCE_PARITY_2026-11-26.md` and `docs/CAPABILITIES.md`. The editor already has silence and filler candidates, AI voice clean-up (DeepFilterNet3), Real-ESRGAN upscale, RIFE slow motion, chroma key, transcript-driven edits, multicam switching, beat analysis, captions with 7 presets, tracking and stabilisation. Not listed again below.

| Missing here | Who has it | Evidence it is missing |
|---|---|---|
| Prompt-to-video and image-to-video generation | Runway, Luma, Pika, CapCut, Veed, Descript, Google | CAPABILITIES: "Every other AI capability in SPEC §18 (generation, dubbing, …) not built" |
| Dubbing with voice clone and lip sync | ElevenLabs, HeyGen, Synthesia, Kapwing, Veed, Captions | CAPABILITIES "dubbing: not built" |
| Avatars and talking photos | HeyGen, Synthesia, Descript, Veed, Submagic, Riverside | 0 matches in CAPABILITIES and parity |
| Eye contact correction | Descript, Veed, Captions, Submagic | 0 matches |
| Auto B-roll from script | OpusClip, Submagic, Descript | 0 matches |
| Virality / highlight scoring and long-to-short clip finding | OpusClip, Vizard, Submagic, Riverside, Descript | "highlight" appears only as a caption style; no scoring |
| Subject-following auto-reframe | OpusClip, CapCut, Resolve Smart Reframe, Premiere | Parity list: "Subject-following reframe (B-4)" under Large |
| AI object removal / video inpainting | Premiere, Runway, Resolve | 0 matches for inpaint/object removal |
| AI music and sound-effect generation | ElevenLabs, Suno, Google Lyria, Pika, Premiere iPhone | CAPABILITIES lists only 80 synthesised SFX; 0 matches for music generation |
| Natural-language search of footage (visual, spoken, on-screen text) | Final Cut 12, Resolve 21 IntelliSearch, Premiere AI Assistant, TwelveLabs | No shot detection, OCR or visual search entry; parity has none |
| Scene / shot detection as an agent-readable index | Resolve, Premiere, Final Cut | 0 matches for scene detect |
| Colourisation, relighting, deblur | Resolve (AI), Topaz, Runway | 0 matches for colourise and relight |
| Publish and schedule to platforms | Submagic, Vizard, Riverside, Descript | CAPABILITIES: "Publishing connectors, thumbnails/metadata … not built" |
| In-editor agent that works the project | Descript Underlord, Premiere AI Assistant, Filmora AI Mate, Captions, Kapwing | CAPABILITIES: "Language assistant inside the editor: setup state only" |
| Screen recording with auto zoom; teleprompter | Screen Studio, Tella, Loom, Riverside | 0 matches for screen record and teleprompter |
| Saved, shareable skills / recipes the agent can load | Premiere-MCP-IMT, Remotion, BFL, Descript templates | 0 matches for "skill" |
| Profanity bleep and sensitive-content flags | Platform tools; none of the editors I read advertise it | 0 matches (this is a gap, not a competitor feature) |
| Third-party agent doors on a competitor's tool set | Descript, Adobe (preview), CapCut, Luma, HeyGen, Loom | This editor already has MCP and REST for every edit, which matches; no outbound adapters to these |

---

## 8. Ruled out by licence, hardware or terms

| Item | Reason |
|---|---|
| NLLB-200 (all sizes) | CC-BY-NC-4.0 |
| MusicGen / AudioCraft weights, YuE2, MMAudio weights, AudioLDM | CC-BY-NC family (MMAudio code is MIT, weights are not) |
| ProPainter, CodeFormer | S-Lab License 1.0, "non-commercial purpose" |
| Wav2Lip | Research/academic/personal use only |
| MMS-TTS Hebrew, F5-TTS (base), Higgs Audio v3, Fish Audio S2-Pro | CC-BY-NC / research and non-commercial licences |
| FLUX.2 [klein] 9B, FLUX.1-dev, SDXL-Turbo | Non-commercial licences |
| Seed-VC | GPL-3.0 |
| Apple FastVLM, DepthPro, FastFrames | `apple-amlr` research licence |
| Qwen2.5-Omni-3B | `qwen-research` licence |
| LTX-2 / 2.3, ComfyUI-LTXVideo | Fine below USD 10 million revenue; 19 to 22B params, not for 4 GB |
| MiniMax H3 and H3-Tiny; HunyuanVideo 1.5 | Licence territory excludes EU, UK, South Korea (MiniMax also USA); 18 GB or more |
| SeedVR2, LatentSync 1.6, Wan 2.2 S2V 14B, Qwen-Image 20B, Qwen3-Omni, Kimi-Audio | VRAM far above 4 GB |
| OpenAI Sora 2 API | Shut down 2026-09-24 |
| Gemini Veo 3.1 preview in the Gemini API | Shut down (Gemini video page) |
| Suno API | No public API; unofficial wrappers only |
| Remotion for a for-profit company of more than 3 people | Company licence required |
| ComfyUI, Manager, VideoHelperSuite, KJNodes (GPL-3.0) | Not ruled out for the owner's own install; do not bundle or link them into this project |

---

## 9. Could not read

| What | Why |
|---|---|
| DaVinci Resolve release notes page, Adobe help pages, Descript changelog, OpusClip features | Blocked by the fetch tool for most hosts; `curl` read the vendor home pages only. Competitor feature rows lean on those pages and on `docs/MARKET_RESEARCH.md` |
| TimeBolt / Recut, Clipchamp, Canva video, Final Cut, Filmora detail | TimeBolt blocked (Cloudflare); the rest not opened this session; covered by [carried] material |
| Terms of use for published output (Runway, Luma, HeyGen, Synthesia, Kling, Pika, fal) | Pages not captured |
| Prices: Luma, HeyGen, Synthesia, Topaz, BFL (rendered by script), Twelve Labs per minute, Kling, BytePlus Seedance | Client-rendered or unreadable |
| Hebrew support in PaddleOCR, EasyOCR, MADLAD-400, Qwen3-TTS, Qwen3-ASR, TranslateGemma, small VLMs | Language lists not captured or ambiguous |
| Hebrew quality of ZONOS3-Mini, VoxCPM2, Qwen3Guard, any VLM | Needs a listening or reading test; none was run |
| VRAM on a 4 GB card for Wan 2.2 5B GGUF, FLUX.2 klein GGUF, VoxCPM2, MuseTalk, FlashVSR | Only vendor-card numbers exist (13 GB, 8 GB, 24 GB, 8.19 GB); nothing measured |
| LICENSE files: MiniMax-Remover, E2FGVI, FlashVSR (GitHub), Seed-VC (GitHub), DiffuEraser weights, FILM weights, After Effects and OBS MCP servers | 404 or not opened |
| arXiv papers' contents (only titles and dates of three benchmarks were read), ZONOS3-Mini arXiv 2611.16525 | Not opened |
| YouTube upload MCP servers | None found in the registry; unknown whether any exist elsewhere |
| huggingface.co and github.com through WebFetch | Hosts did not resolve there; they are reachable by `curl` through the proxy, which is what I used |
