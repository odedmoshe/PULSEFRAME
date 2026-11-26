"""
PULSEFRAME picture-model worker (wave 8 picmodels; .artifacts/wave8/picmodels-plan.md §3.4 as corrected by picmodels-verify.md; the
protocol is apps/server/src/picmodels/contract.ts). Started by the server with `python -I`, the working directory the data
directory's tmp folder, and the offline variables set; never by hand in production. It is NOT pf_tools.py and NOT pf_search.py and
shares nothing with them. ONE SELF-CONTAINED FILE (verify C6: under -I nothing beside it can be imported); its SHA-256 is pinned in
contract.ts PICTURE_WORKER_SHA256 only after the lead has read all of it (until then the server reports engine_unverified).

PRE-PASS SKELETON: the network is disarmed, the commands and the eyes role's arguments are parsed, the yunet pin is verified, the one
request line is validated, and the strict output line is built by eyes_line(). There is NO MODEL CODE yet: `serve --role eyes`
answers {"id": n, "event": "error", "code": "not_built"} — never a made-up point. W2 adds the onnxruntime session and decode_yunet.

NO NETWORK. Before anything else is imported the offline variables are set and the socket module is disarmed.
ONE REQUEST PER PROCESS. `serve --role eyes` reads exactly one JSON line from stdin, writes exactly one JSON line to stdout and exits.
The pixels arrive inline (base64 rgb24); nothing is written to disk; nothing about the picture is printed to stderr.
WHAT LEAVES THIS PROCESS (verify C10, C11; core EyesWorkerLineSchema): per face exactly the two eye points in the pixels of the picture
it was sent, nothing else — no box, no score, no nose or mouth, no count. More than MAX_FACES faces: {"tooMany": true} and no point.
Errors: {"id": n, "event": "error", "code": <bad_request | engine_failed | model_mismatch | not_built>} — never a message, never a
traceback (a traceback could quote the request).

Commands (one JSON object per line on stdout):
  probe                                    versions of numpy and onnxruntime; {"missing": "<module>"} and exit 1 when one cannot be imported
  inspect --model yunet --file model=PATH  (laptop check PM4; W2) the ONNX input and output names and shapes
  serve --role eyes --model PATH [--threads 2]
                                           verify PATH's size and SHA-256 (YUNET_PIN), then one request:
    {"id": 1, "cmd": "eyes", "w": W, "h": H, "rgb": "<base64 rgb24, W*H*3 bytes>"}
      -> {"id": 1, "event": "result", "faces": [[[x, y], [x, y]], ...]}  (at most MAX_FACES)
      -> {"id": 1, "event": "result", "tooMany": true}
"""
import os
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

import socket  # noqa: E402


def _no_network(*_a, **_k):
    raise OSError("the picture-model worker has no network (disarmed by pf_picture.py)")


for _name in ("connect", "connect_ex", "bind", "sendto"):
    setattr(socket.socket, _name, _no_network)
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

import base64  # noqa: E402
import binascii  # noqa: E402
import hashlib  # noqa: E402
import importlib  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402

MAX_FACES = 8  # core EYES.maxFaces
INPUT_LONG_SIDE = 640  # core EYES.inputLongSide
DEFAULT_THREADS = 2  # core EYES.threads (verify C14)
MAX_SIDE = 4096
# core PICTURE_MODELS yunet pin (= tools/library/manifests/models-01.json item yunet/face_detection_yunet_2023mar.onnx; a test keeps them equal)
YUNET_PIN = ("face_detection_yunet_2023mar.onnx", 232589, "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4")
ERROR_CODES = ("bad_request", "engine_failed", "model_mismatch", "not_built")


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


class WorkerError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code if code in ERROR_CODES else "engine_failed"


def arg(argv, name, default=None):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


def eyes_line(rid, faces):
    """THE ONLY WAY A RESULT LEAVES: faces is a list of ((x, y), (x, y)) in input pixels. Builds exactly the strict line."""
    if len(faces) > MAX_FACES:
        return {"id": rid, "event": "result", "tooMany": True}
    clean = []
    for face in faces:
        if len(face) != 2:
            raise WorkerError("engine_failed")
        pair = []
        for pt in face:
            if len(pt) != 2:
                raise WorkerError("engine_failed")
            x, y = float(pt[0]), float(pt[1])
            if not (math.isfinite(x) and math.isfinite(y)):
                raise WorkerError("engine_failed")
            pair.append([x, y])
        clean.append(pair)
    return {"id": rid, "event": "result", "faces": clean}


def error_line(rid, code):
    return {"id": rid, "event": "error", "code": code if code in ERROR_CODES else "engine_failed"}


def parse_request(line):
    """One eyes request, strictly: exactly the keys id, cmd, w, h, rgb; the pixels are exactly w*h*3 bytes. Returns (id, w, h, bytes)."""
    try:
        req = json.loads(line)
    except ValueError:
        raise WorkerError("bad_request")
    if not isinstance(req, dict) or set(req.keys()) != {"id", "cmd", "w", "h", "rgb"}:
        raise WorkerError("bad_request")
    rid, w, h = req["id"], req["w"], req["h"]
    if not (isinstance(rid, int) and rid > 0 and req["cmd"] == "eyes"):
        raise WorkerError("bad_request")
    if not (isinstance(w, int) and isinstance(h, int) and 0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE and isinstance(req["rgb"], str)):
        raise WorkerError("bad_request")
    try:
        rgb = base64.b64decode(req["rgb"], validate=True)
    except (binascii.Error, ValueError):
        raise WorkerError("bad_request")
    if len(rgb) != w * h * 3:
        raise WorkerError("bad_request")
    return rid, w, h, rgb


def parse_serve_args(argv):
    """serve --role eyes --model PATH [--threads N]: returns (model_path, threads) or raises bad_request. No other role in this wave."""
    if arg(argv, "--role") != "eyes":
        raise WorkerError("bad_request")
    model = arg(argv, "--model")
    if not model:
        raise WorkerError("bad_request")
    try:
        threads = int(arg(argv, "--threads", str(DEFAULT_THREADS)))
    except ValueError:
        raise WorkerError("bad_request")
    if not 1 <= threads <= 4:
        raise WorkerError("bad_request")
    return model, threads


def verify_pin(path):
    """The yunet file at its exact size and SHA-256, else model_mismatch (never naming the file's contents)."""
    name, size, sha = YUNET_PIN
    try:
        if not os.path.isfile(path) or os.path.getsize(path) != size:
            raise WorkerError("model_mismatch")
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    except OSError:
        raise WorkerError("model_mismatch")
    if h.hexdigest() != sha:
        raise WorkerError("model_mismatch")


def probe():
    info = {"event": "result", "ok": False, "python": sys.version.split()[0], "versions": {}, "missing": None, "cudaDevices": 0}
    for name in ("numpy", "onnxruntime"):
        try:
            mod = importlib.import_module(name)
            info["versions"][name] = str(getattr(mod, "__version__", "unknown"))[:40]
        except Exception:  # a missing package is a setup state, not a crash
            info["missing"] = info["missing"] or name
    info["ok"] = info["missing"] is None
    out(info)
    return 0 if info["ok"] else 1


def serve(argv):
    rid = None
    try:
        model, threads = parse_serve_args(argv)
        verify_pin(model)
        line = sys.stdin.readline()
        rid, w, h, rgb = parse_request(line)
        del rgb, w, h, threads
        # W2: the onnxruntime session (CPUExecutionProvider only, intra_op_num_threads=threads, log_severity_level=3), the letterbox to
        # INPUT_LONG_SIDE, decode_yunet and NMS, then out(eyes_line(rid, faces)). Until then: honest not_built, never a point.
        raise WorkerError("not_built")
    except WorkerError as e:
        if rid is None:
            rid = 0
        out(error_line(rid, e.code) if rid else {"event": "error", "code": e.code})
        return 1
    except Exception:  # never a traceback (it could quote the request)
        out(error_line(rid, "engine_failed") if rid else {"event": "error", "code": "engine_failed"})
        return 1


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "probe":
        return probe()
    if cmd == "serve":
        return serve(argv)
    if cmd == "inspect":
        out({"event": "error", "code": "not_built"})
        return 1
    out({"event": "error", "code": "bad_request"})
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
