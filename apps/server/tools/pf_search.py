"""
PULSEFRAME picture search worker («חיפוש בצילומים», wave 7 search track; .artifacts/wave7/search-decisions.md §2–§3). Started by the server
(apps/server/src/search/workers.ts) with `python -I`, the working directory the data directory's tmp folder, and HF_HUB_OFFLINE /
TRANSFORMERS_OFFLINE set; never by hand in production. It is NOT pf_tools.py and shares nothing with it (own probe, own model cache).

NO NETWORK. Before anything else is imported the offline variables are set and the socket module is disarmed: connect, connect_ex,
bind, sendto, create_connection and getaddrinfo raise. The model is loaded only from the folder the server names (PF_SEARCH_MODEL_DIR or
the library root), with local_files_only, and only after every one of the seven pinned files has its exact size and SHA-256 (PINS
below = apps/server/src/search/contract.ts SEARCH_PICTURE.pins; a test keeps them equal). A file with another checksum is refused. This
script never downloads anything.

WHOLE FRAMES ONLY. It embeds whole 256×256 frames the server decoded (rgb24, (x/255 − 0.5)/0.5; embedder suffix pre1) and text queries.
It has no face, person, crop or region code and takes no image as a query.

Commands (one JSON object per line on stdout):
  probe                     versions of torch, transformers, safetensors, tokenizers and the device; exit 1 naming what cannot be imported
  verify --model DIR        the seven pins checked (sizes, then SHA-256); exit 1 with {"event":"error","code":"model_missing",...}
  check-offline --port N    tries to reach 127.0.0.1:N through the disarmed socket module and reports {"refused": true} (tests)
  serve --role scan|query --model DIR [--device auto|cpu]
                            loads the model once (scan: vision tower, CUDA fp16 when torch sees a device, else CPU fp32; query: text tower,
                            CPU fp32), answers {"event":"ready", ...}, then takes requests as JSON lines on stdin, one at a time:
    {"id": 1, "cmd": "embed-images", "input": "<frames file>", "count": N}   -> {"id": 1, "event": "result", "dim": 768, "count": N, "vectors": "<base64 float32 LE>"}
    {"id": 2, "cmd": "embed-text", "texts": ["..."]}                         -> the same; texts travel inline and are never written anywhere
    errors: {"id": n, "event": "error", "code": "query_too_long" | "bad_request" | "engine_failed", "message": "..."}
"""
import os
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"

import socket  # noqa: E402


def _no_network(*_a, **_k):
    raise OSError("the picture search worker has no network (disarmed by pf_search.py)")


for _name in ("connect", "connect_ex", "bind", "sendto"):
    setattr(socket.socket, _name, _no_network)
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

import base64  # noqa: E402
import hashlib  # noqa: E402
import importlib  # noqa: E402
import json  # noqa: E402
import struct  # noqa: E402
import time  # noqa: E402

DIM = 768
SIDE = 256
MAX_TOKENS = 64
PINS = [
    ("model.safetensors", 1500985224, "6125cacc01fa93bdc98a0c5101cefcd69b2ed1f8ab4f38d86f4ad5984f5dc863"),
    ("config.json", 276, "7b5aedcb8893e31376e129c1ffd7a5392f1a806dbc793ce53eda220c2ec59edf"),
    ("preprocessor_config.json", 394, "d14ba2ee3fd816f3de8abaddc31953565128eaf37c73ad4bed32101a98465aff"),
    ("special_tokens_map.json", 636, "baec30ea10906f16adb8c18af7a34023002c1746542612b8b41c9f09e1351351"),
    ("tokenizer.json", 34363039, "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322"),
    ("tokenizer.model", 4241003, "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2"),
    ("tokenizer_config.json", 47164, "14afe629fe4959b9e0d51e1852b8d9f7ad074f90a1a7125a4fcdd17f06e78fc8"),
]


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class WorkerError(BaseException):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def arg(argv, name, default=None):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


def probe():
    info = {"event": "result", "ok": False, "python": sys.version.split()[0], "versions": {}, "device": None, "cudaDevices": 0}
    missing, errors = None, {}
    for name in ("torch", "transformers", "safetensors", "tokenizers"):
        try:
            mod = importlib.import_module(name)
            info["versions"][name] = str(getattr(mod, "__version__", "unknown"))
        except Exception as e:  # a missing package is a setup state, not a crash
            errors[name] = f"{type(e).__name__}: {e}"
            missing = missing or name
    if missing is None:
        try:
            from transformers import AutoTokenizer, SiglipModel  # noqa: F401
        except Exception as e:
            errors["transformers.SiglipModel"] = f"{type(e).__name__}: {e}"
            missing = "transformers.SiglipModel"
    if missing is None:
        import torch
        info["cudaDevices"] = torch.cuda.device_count() if torch.cuda.is_available() else 0
        info["device"] = "cuda" if info["cudaDevices"] else "cpu"
        info["ok"] = True
        out(info)
        return 0
    info["missing"] = missing
    info["errors"] = errors
    out(info)
    sys.stderr.write(f"cannot import {missing}\n")
    return 1


def verify(model_dir):
    """The seven pins at exact size and SHA-256, or WorkerError model_missing naming the files (never their contents)."""
    if not model_dir or not os.path.isdir(model_dir):
        raise WorkerError("model_missing", "the model folder does not exist")
    bad = []
    for name, size, sha in PINS:
        p = os.path.join(model_dir, name)
        try:
            if os.path.getsize(p) != size:
                bad.append(f"{name} (size)")
                continue
        except OSError:
            bad.append(f"{name} (absent)")
            continue
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
        if h.hexdigest() != sha:
            bad.append(f"{name} (checksum)")
    if bad:
        raise WorkerError("model_missing", "model files not as pinned: " + ", ".join(bad))


def check_offline(port):
    refused = True
    try:
        socket.create_connection(("127.0.0.1", int(port)), timeout=2)
        refused = False
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.connect(("127.0.0.1", int(port)))
            refused = False
        except OSError:
            pass
        finally:
            s.close()
    except OSError:
        pass
    out({"event": "result", "refused": refused})
    return 0


class Model:
    def __init__(self, model_dir, role, device_req):
        verify(model_dir)
        started = time.monotonic()
        try:
            import torch
            from transformers import AutoTokenizer, SiglipModel
        except Exception as e:
            raise WorkerError("engine_missing", f"torch or transformers cannot be imported: {type(e).__name__}: {e}")
        self.torch = torch
        self.role = role
        if role == "scan" and device_req != "cpu" and torch.cuda.is_available():
            self.device, self.dtype = "cuda", torch.float16
        else:
            self.device, self.dtype = "cpu", torch.float32
        model = SiglipModel.from_pretrained(model_dir, local_files_only=True, use_safetensors=True)
        model.eval()
        self.scale = float(model.logit_scale.exp().item())
        self.bias = float(model.logit_bias.item()) if getattr(model, "logit_bias", None) is not None else 0.0
        if role == "scan":
            model.text_model = None
            self.tok = None
        else:
            model.vision_model = None
            self.tok = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        model.to(device=self.device, dtype=self.dtype)
        self.model = model
        torch.manual_seed(0)
        self.load_seconds = time.monotonic() - started

    def _features(self, f):
        if not isinstance(f, self.torch.Tensor):  # transformers 5 may answer an output object
            f = getattr(f, "pooler_output", None)
            if f is None:
                raise WorkerError("engine_failed", "the model answered no pooled features")
        f = f.float()
        f = f / f.norm(dim=-1, keepdim=True)
        flat = f.detach().cpu().reshape(-1).tolist()
        return base64.b64encode(struct.pack("<%df" % len(flat), *flat)).decode("ascii"), f.shape[0], f.shape[-1]

    def embed_images(self, path, count):
        if self.role != "scan":
            raise WorkerError("bad_request", "this worker holds the text tower")
        with open(path, "rb") as fh:
            data = fh.read()
        if len(data) != count * SIDE * SIDE * 3:
            raise WorkerError("bad_request", f"{len(data)} bytes for {count} frames")
        torch = self.torch
        x = torch.frombuffer(bytearray(data), dtype=torch.uint8).view(count, SIDE, SIDE, 3).permute(0, 3, 1, 2).float()
        x = (x / 255.0 - 0.5) / 0.5
        with torch.inference_mode():
            f = self.model.get_image_features(pixel_values=x.to(device=self.device, dtype=self.dtype))
        return self._features(f)

    def embed_text(self, texts):
        if self.role != "query":
            raise WorkerError("bad_request", "this worker holds the vision tower")
        lowered = [str(t).lower() for t in texts]
        for t in lowered:
            if len(self.tok(t)["input_ids"]) > MAX_TOKENS:
                raise WorkerError("query_too_long", f"more than {MAX_TOKENS} tokens")
        enc = self.tok(lowered, padding="max_length", max_length=MAX_TOKENS, truncation=False, return_tensors="pt")
        with self.torch.inference_mode():
            f = self.model.get_text_features(input_ids=enc["input_ids"].to(self.device))
        return self._features(f)


def serve(argv):
    role = arg(argv, "--role")
    if role not in ("scan", "query"):
        out({"event": "error", "code": "bad_request", "message": "--role scan|query"})
        return 1
    try:
        m = Model(arg(argv, "--model"), role, arg(argv, "--device", "auto") if role == "scan" else "cpu")
    except WorkerError as e:
        out({"event": "error", "code": e.code, "message": str(e)})
        return 1
    except Exception as e:  # the model did not load: an honest error line, never a traceback on stdout
        out({"event": "error", "code": "engine_failed", "message": f"{type(e).__name__}: {e}"[:400]})
        return 1
    versions = {}
    for name in ("torch", "transformers"):
        try:
            versions[name] = str(importlib.import_module(name).__version__)
        except Exception:
            pass
    out({"event": "ready", "role": role, "device": m.device, "dtype": "fp16" if m.device == "cuda" else "fp32", "logitScale": m.scale,
         "logitBias": m.bias, "loadSeconds": round(m.load_seconds, 3), "versions": versions})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            if req.get("cmd") == "embed-images":
                vec, n, d = m.embed_images(str(req["input"]), int(req["count"]))
            elif req.get("cmd") == "embed-text":
                texts = req.get("texts")
                if not isinstance(texts, list) or not texts:
                    raise WorkerError("bad_request", "texts must be a non-empty list")
                vec, n, d = m.embed_text(texts)
            else:
                raise WorkerError("bad_request", "unknown command")
            out({"id": rid, "event": "result", "dim": d, "count": n, "vectors": vec})
        except WorkerError as e:
            out({"id": rid, "event": "error", "code": e.code, "message": str(e)})
        except Exception as e:  # a failed request is reported, never echoing a query
            out({"id": rid, "event": "error", "code": "engine_failed", "message": type(e).__name__})
    return 0


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "probe":
        return probe()
    if cmd == "verify":
        try:
            verify(arg(argv, "--model"))
        except WorkerError as e:
            out({"event": "error", "code": e.code, "message": str(e)})
            return 1
        out({"event": "result", "ok": True})
        return 0
    if cmd == "check-offline":
        return check_offline(arg(argv, "--port", "9"))
    if cmd == "serve":
        return serve(argv)
    out({"event": "error", "code": "bad_request", "message": "commands: probe, verify, check-offline, serve"})
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
