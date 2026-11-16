"""
PULSEFRAME local speech worker. Started by the server (apps/server/src/speech.ts) with `python -I`; never by hand in production.

It reads only the files named on its command line, never downloads anything (the server verifies and places model files),
and writes one JSON object per line to stdout:
  {"event": "progress", "seconds": 12.3}                 recognised up to this source second
  {"event": "result", ...}                                the final result (last line)
  {"event": "error", "code": "...", "message": "..."}     then exit code 1

Commands:
  probe                                  engine versions and whether a CUDA device is visible
  transcribe --model DIR --audio WAV     speech to text with word times (faster-whisper / CTranslate2)
  synthesize --model DIR --text-file F --out WAV [--reference WAV]
                                         text to speech (Chatterbox multilingual); with --reference, in that voice
"""
import argparse
import json
import os
import sys


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(code, message):
    out({"event": "error", "code": code, "message": message})
    sys.exit(1)


def cuda_count():
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count()
    except Exception:
        return 0


def probe(_args):
    info = {"event": "result", "python": sys.version.split()[0], "asr": None, "tts": None, "cudaDevices": 0}
    try:
        import ctranslate2
        import faster_whisper
        info["asr"] = {"engine": "faster-whisper", "version": faster_whisper.__version__, "ctranslate2": ctranslate2.__version__}
        info["cudaDevices"] = cuda_count()
    except Exception as e:  # reported, not raised: a missing engine is a setup state
        info["asrError"] = f"{type(e).__name__}: {e}"
    try:
        import importlib.metadata
        import torch
        import chatterbox.mtl_tts  # noqa: F401
        import perth
        if perth.PerthImplicitWatermarker is None:  # the engine would crash at load; it needs pkg_resources (setuptools < 81)
            raise RuntimeError("the engine's watermarker cannot be imported (install setuptools<81 in this environment)")
        import phonikud_onnx  # noqa: F401
        info["tts"] = {"engine": "chatterbox-tts", "version": importlib.metadata.version("chatterbox-tts"), "torch": torch.__version__, "hebrewPointing": "phonikud-onnx " + importlib.metadata.version("phonikud-onnx")}
        info["torchCuda"] = bool(torch.cuda.is_available())
    except Exception as e:
        info["tts"] = None
        info["ttsError"] = f"{type(e).__name__}: {e}"
    out(info)


def synthesize(args):
    try:
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS, SUPPORTED_LANGUAGES
    except Exception as e:
        fail("engine_missing", f"chatterbox-tts cannot be imported: {e}")
    if args.language not in SUPPORTED_LANGUAGES:
        fail("unsupported_language", f"language {args.language} is not one of {sorted(SUPPORTED_LANGUAGES)}")
    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    with open(args.text_file, encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        fail("empty_text", "there is no text to speak")
    spoken = text
    # Hebrew is written without vowels; this voice model needs them. Text that already carries vowel points is spoken as written,
    # so a wrong reading can be corrected by pointing the word by hand.
    if args.language == "he" and args.nikud and not any("\u05b0" <= c <= "\u05c7" for c in text):
        try:
            from phonikud_onnx import Phonikud
            pointed = Phonikud(args.nikud).add_diacritics(text)
            # keep standard vowel points only: drop the stress mark, the vocal-shva mark and the prefix separator this tool adds
            spoken = pointed.replace("|", "").replace("\u05ab", "").replace("\u05bd", "")
        except Exception as e:
            fail("diacritics_failed", f"{type(e).__name__}: {e}")
    try:
        torch.manual_seed(args.seed)
        model = ChatterboxMultilingualTTS.from_local(args.model, device)
    except Exception as e:
        fail("model_load_failed", f"{type(e).__name__}: {e}")
    out({"event": "progress", "stage": "model loaded"})
    try:
        wav = model.generate(spoken, language_id=args.language, audio_prompt_path=args.reference or None)
        import wave
        pcm = (wav.squeeze().clamp(-1, 1) * 32767).round().to(torch.int16).cpu().numpy()
        with wave.open(args.out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(model.sr)
            w.writeframes(pcm.tobytes())
    except Exception as e:
        fail("synthesis_failed", f"{type(e).__name__}: {e}")
    out({"event": "result", "device": device, "sampleRate": model.sr, "samples": int(pcm.shape[0]), "seed": args.seed, "spokenText": spoken,
         "watermark": "PerTh (Resemble AI) imperceptible watermark, applied by the engine"})


def transcribe(args):
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        fail("engine_missing", f"faster-whisper cannot be imported: {e}")
    device = args.device
    if device == "auto":
        device = "cuda" if cuda_count() > 0 else "cpu"
    compute = "float16" if device == "cuda" else "int8"
    try:
        model = WhisperModel(args.model, device=device, compute_type=compute, local_files_only=True, cpu_threads=args.threads)
    except Exception as e:
        fail("model_load_failed", f"{type(e).__name__}: {e}")
    try:
        # The server hands over 16 kHz mono 16-bit PCM; reading it here keeps the engine's own media decoder out of the path.
        import wave
        import numpy as np
        with wave.open(args.audio, "rb") as w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
                fail("bad_audio", "expected 16 kHz mono 16-bit PCM")
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = model.transcribe(
            samples,
            language=None if args.language == "auto" else args.language,
            word_timestamps=True,
            vad_filter=True,  # skips long non-speech, where this model family otherwise invents text
            condition_on_previous_text=False,  # a wrong phrase must not steer the following ones
            beam_size=5,
        )
        result = []
        for s in segments:  # a generator: recognition happens here
            result.append({
                "start": s.start, "end": s.end, "text": s.text,
                "avgLogProb": s.avg_logprob, "noSpeechProb": s.no_speech_prob, "compressionRatio": s.compression_ratio,
                "words": [{"start": w.start, "end": w.end, "text": w.word, "probability": w.probability} for w in (s.words or [])],
            })
            out({"event": "progress", "seconds": round(s.end, 2)})
    except Exception as e:
        fail("transcription_failed", f"{type(e).__name__}: {e}")
    out({
        "event": "result", "device": device, "computeType": compute,
        "language": info.language, "languageProbability": info.language_probability,
        "duration": info.duration, "speechDuration": info.duration_after_vad, "segments": result,
    })


def main():
    os.environ["HF_HUB_OFFLINE"] = "1"
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe").set_defaults(fn=probe)
    t = sub.add_parser("transcribe")
    t.add_argument("--model", required=True)
    t.add_argument("--audio", required=True)
    t.add_argument("--language", default="auto")
    t.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    t.add_argument("--threads", type=int, default=0)
    t.set_defaults(fn=transcribe)
    y = sub.add_parser("synthesize")
    y.add_argument("--model", required=True)
    y.add_argument("--text-file", required=True)
    y.add_argument("--out", required=True)
    y.add_argument("--language", default="he")
    y.add_argument("--reference")
    y.add_argument("--nikud", help="Hebrew vowel-pointing model (ONNX)")
    y.add_argument("--seed", type=int, default=0)
    y.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    y.set_defaults(fn=synthesize)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
