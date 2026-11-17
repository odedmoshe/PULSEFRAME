"""
PULSEFRAME local tools worker (ADR-0017, route R3). Started by the server (apps/server/src/localtools.ts) with `python -I`, from a
working directory outside any ComfyUI folder; never by hand in production. It imports no ComfyUI module.

It reads only the files named in its requests, never downloads anything (the server verifies model files by size and SHA-256 and
places them; HF_HUB_OFFLINE and TRANSFORMERS_OFFLINE are set before transformers is imported and every load is local_files_only),
and writes one JSON object per line to stdout:
  {"event": "progress", "done": 8, "total": 10}            phrases translated so far
  {"event": "result", ...}                                  the final result (last line)
  {"event": "error", "code": "...", "message": "..."}       then exit code 1

Commands:
  probe                                       versions of torch, transformers and sentencepiece, and the device; exit 1 when one
                                              of them cannot be imported (the result names it in "missing")
  translate --model DIR --weights safetensors|pickle --direction he-en|en-he --input IN.json --output OUT.json [--device auto|cpu|cuda]
                                              machine translation with MarianMT. IN.json is {"items": [{"id": ..., "text": ...}]};
                                              OUT.json gets {"translations": {id: text}}. A pickle checkpoint (pytorch_model.bin) is
                                              loaded weights-only; if transformers refuses that, the request fails, loudly.
  serve                                       stay alive and take the same commands as JSON lines on stdin, e.g.
                                              {"cmd": "translate", "model": "...", ...}; each request ends with {"event": "end"}.
                                              The most recently used model stays loaded between requests.
"""
import argparse
import importlib
import json
import os
import sys
import time

# Before anything can import huggingface_hub or transformers: this worker never touches the network.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

# MarianMT's position embeddings end at 512 tokens; a longer phrase is refused rather than cut silently.
MAX_TOKENS = 512


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class WorkerError(BaseException):  # not an Exception, so the broad handlers around engine calls do not swallow it
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(code, message):
    raise WorkerError(code, message)


# One loaded model at a time (in `serve` mode it is reused by the next request for the same files).
_model = {"key": None, "value": None}


def device_of(requested):
    import torch
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        fail("device_unavailable", "a CUDA device was requested but torch sees none")
    return requested


def probe(_args):
    info = {"event": "result", "ok": False, "python": sys.version.split()[0], "versions": {}, "device": None, "cudaDevices": 0}
    missing, errors = None, {}
    for name in ("torch", "transformers", "sentencepiece"):
        try:
            mod = importlib.import_module(name)
            info["versions"][name] = str(getattr(mod, "__version__", "unknown"))
        except Exception as e:  # reported, not raised: a missing package is a setup state
            errors[name] = f"{type(e).__name__}: {e}"
            missing = missing or name
    if missing is None:
        try:
            from transformers import MarianMTModel, MarianTokenizer  # noqa: F401
        except Exception as e:
            errors["transformers.MarianMTModel"] = f"{type(e).__name__}: {e}"
            missing = "transformers.MarianMTModel"
    if missing is None:
        import torch
        info["cudaDevices"] = torch.cuda.device_count() if torch.cuda.is_available() else 0
        info["device"] = "cuda" if info["cudaDevices"] else "cpu"
        info["ok"] = True
        out(info)
        return
    info["missing"] = missing
    info["errors"] = errors
    out(info)
    sys.stderr.write(f"cannot import {missing}: {errors.get(missing, '')}\n")
    sys.stderr.flush()
    sys.exit(1)


def load_marian(model_dir, weights, device):
    try:
        import torch
        from transformers import MarianMTModel, MarianTokenizer
    except Exception as e:
        fail("engine_missing", f"transformers or torch cannot be imported: {type(e).__name__}: {e}")
    key = (model_dir, weights, device)
    if _model["key"] == key:
        return _model["value"], 0.0
    _model["key"], _model["value"] = None, None  # release the previous model before loading another
    started = time.monotonic()
    try:
        tok = MarianTokenizer.from_pretrained(model_dir, local_files_only=True)
        if weights == "safetensors":
            model = MarianMTModel.from_pretrained(model_dir, local_files_only=True, use_safetensors=True)
        else:
            # A pickle checkpoint: only tensors may be read from it (torch.load with weights_only=True). If this transformers build
            # cannot or will not load it that way, the request fails; it is never loaded with full unpickling.
            model = MarianMTModel.from_pretrained(model_dir, local_files_only=True, use_safetensors=False, weights_only=True)
        model.eval()
        model.to(device)
        torch.manual_seed(0)
    except WorkerError:
        raise
    except Exception as e:
        fail("model_load_failed", f"{type(e).__name__}: {e}")
    _model["key"], _model["value"] = key, (tok, model)
    return (tok, model), time.monotonic() - started


def translate(args):
    if args.weights not in ("safetensors", "pickle"):
        fail("bad_request", "weights must be safetensors or pickle")
    try:
        with open(args.input, encoding="utf-8") as f:
            items = json.load(f)["items"]
    except Exception as e:
        fail("bad_request", f"the request file could not be read: {type(e).__name__}: {e}")
    if not isinstance(items, list) or not all(isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("text"), str) for x in items):
        fail("bad_request", "items must be a list of {id, text}")
    try:
        import torch
    except Exception as e:
        fail("engine_missing", f"torch cannot be imported: {type(e).__name__}: {e}")
    device = device_of(args.device)
    (tok, model), load_seconds = load_marian(args.model, args.weights, device)
    for x in items:
        n = len(tok(x["text"]).input_ids)
        if n > MAX_TOKENS:
            fail("phrase_too_long", f"phrase {x['id']} is {n} tokens; the model reads at most {MAX_TOKENS}. Split it into shorter phrases.")
    # Similar lengths together, so a batch pads little; the order of the result does not depend on it.
    order = sorted(range(len(items)), key=lambda i: len(items[i]["text"]))
    batch = max(1, min(32, args.batch))
    result, done = {}, 0
    started = time.monotonic()
    try:
        with torch.inference_mode():
            for at in range(0, len(order), batch):
                idx = order[at:at + batch]
                enc = tok([items[i]["text"] for i in idx], return_tensors="pt", padding=True).to(device)
                generated = model.generate(**enc)  # decoding settings: the pinned generation_config.json
                for i, text in zip(idx, tok.batch_decode(generated, skip_special_tokens=True)):
                    result[items[i]["id"]] = text.strip()
                done += len(idx)
                out({"event": "progress", "done": done, "total": len(items)})
    except Exception as e:
        fail("translation_failed", f"{type(e).__name__}: {e}")
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump({"translations": result}, f, ensure_ascii=False)
    import transformers
    out({"event": "result", "device": device, "count": len(result), "loadSeconds": round(load_seconds, 3),
         "translateSeconds": round(time.monotonic() - started, 3),
         "versions": {"torch": str(torch.__version__), "transformers": str(transformers.__version__)}})


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe").set_defaults(fn=probe)
    t = sub.add_parser("translate")
    t.add_argument("--model", required=True)
    t.add_argument("--weights", required=True)
    t.add_argument("--direction", required=True, choices=["he-en", "en-he"])
    t.add_argument("--input", required=True)
    t.add_argument("--output", required=True)
    t.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    t.add_argument("--batch", type=int, default=8)
    t.set_defaults(fn=translate)
    sub.add_parser("serve").set_defaults(fn=None)
    a = p.parse_args()
    if a.cmd != "serve":
        try:
            a.fn(a)
        except WorkerError as e:
            out({"event": "error", "code": e.code, "message": str(e)})
            sys.exit(1)
        return
    out({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            argv = [str(req.pop("cmd"))]
            for k, v in req.items():
                if v is not None:
                    argv += ["--" + k.replace("_", "-"), str(v)]
            r = p.parse_args(argv)
            if r.fn is None:
                raise SystemExit(2)
            r.fn(r)
        except WorkerError as e:
            out({"event": "error", "code": e.code, "message": str(e)})
        except SystemExit:  # argparse rejected the request, or probe exited (probe is a command of its own process)
            out({"event": "error", "code": "bad_request", "message": "the request was not understood"})
        except Exception as e:
            out({"event": "error", "code": "worker_failed", "message": f"{type(e).__name__}: {e}"})
        out({"event": "end"})


if __name__ == "__main__":
    main()
