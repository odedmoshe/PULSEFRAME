"""
TEST FAKE (labelled; used only by apps/server/src/search/*.test.ts). It is NOT the reviewed picture search worker and has no model: it
speaks the JSON-lines protocol of apps/server/tools/pf_search.py (probe, serve --role scan|query, embed-images, embed-text) with the
standard library only and returns marked placeholder vectors (images: the strongest of the mean red, green and blue picks dim 0, 1 or 2;
text: the words red, green, blue do the same, anything else dim 767). It proves the runner's protocol, validation, queue and lifecycle,
never quality.

Behaviour (environment, read at start):
  PF_FAKE_SEARCH_MODE   ok (default) | probe-missing | load-fail | nan | wrong-length | not-unit | too-long | crash | slow
  PF_FAKE_SEARCH_PIDFILE  if set, a serve process appends "<role> <pid>" to it when it starts
  PF_FAKE_SEARCH_ENVFILE  if set, a serve process writes the offline variables it was started with (JSON) there
"""
import base64
import json
import os
import struct
import sys
import time

MODE = os.environ.get("PF_FAKE_SEARCH_MODE", "ok")
DIM = 768
FRAME = 256 * 256 * 3


def out(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


def arg(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default


def pack(vectors):
    flat = [x for v in vectors for x in v]
    if MODE == "nan":
        flat[0] = float("nan")
    if MODE == "wrong-length":
        flat = flat[:-1]
    if MODE == "not-unit":
        flat = [x * 1.5 for x in flat]
    return base64.b64encode(struct.pack("<%df" % len(flat), *flat)).decode("ascii")


def onehot(i):
    v = [0.0] * DIM
    v[i] = 1.0
    return v


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "probe":
        if MODE == "probe-missing":
            out({"event": "result", "ok": False, "python": "3.13.0", "versions": {"torch": "0.0-fake"}, "device": None, "cudaDevices": 0,
                 "missing": "transformers", "errors": {"transformers": "ModuleNotFoundError: No module named 'transformers' (TEST FAKE)"}})
            return 1
        out({"event": "result", "ok": True, "python": "3.13.0", "versions": {"torch": "0.0-fake", "transformers": "0.0-fake"}, "device": "cpu", "cudaDevices": 0})
        return 0
    if cmd != "serve":
        out({"event": "error", "code": "bad_request", "message": "fake: unknown command"})
        return 2
    role = arg(argv, "--role")
    if os.environ.get("PF_FAKE_SEARCH_PIDFILE"):
        with open(os.environ["PF_FAKE_SEARCH_PIDFILE"], "a") as f:
            f.write(f"{role} {os.getpid()}\n")
    if os.environ.get("PF_FAKE_SEARCH_ENVFILE"):
        with open(os.environ["PF_FAKE_SEARCH_ENVFILE"], "w") as f:
            json.dump({k: os.environ.get(k) for k in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY")} | {"cwd": os.getcwd(), "argv": argv}, f)
    if MODE == "load-fail":
        out({"event": "error", "code": "model_missing", "message": "model files not as pinned: model.safetensors (checksum) (TEST FAKE)"})
        return 1
    out({"event": "ready", "role": role, "device": "cpu", "dtype": "fp32", "logitScale": 20.0, "logitBias": -10.0, "loadSeconds": 0.0, "versions": {"torch": "0.0-fake"}})
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        rid = req.get("id")
        if MODE == "crash":
            sys.exit(3)
        if MODE == "slow":
            time.sleep(2)
        if req.get("cmd") == "embed-images":
            with open(req["input"], "rb") as f:
                data = f.read()
            n = int(req["count"])
            vecs = []
            for k in range(n):
                fr = data[k * FRAME:(k + 1) * FRAME]
                sums = [sum(fr[c::3 * 64]) for c in range(3)]
                vecs.append(onehot(sums.index(max(sums))))
            out({"id": rid, "event": "result", "dim": DIM, "count": n, "vectors": pack(vecs)})
        elif req.get("cmd") == "embed-text":
            if MODE == "too-long":
                out({"id": rid, "event": "error", "code": "query_too_long", "message": "more than 64 tokens"})
                continue
            vecs = []
            for t in req["texts"]:
                words = str(t).lower().split()
                i = 0 if "red" in words else 1 if "green" in words else 2 if "blue" in words else DIM - 1
                vecs.append(onehot(i))
            out({"id": rid, "event": "result", "dim": DIM, "count": len(vecs), "vectors": pack(vecs)})
        else:
            out({"id": rid, "event": "error", "code": "bad_request", "message": "unknown command"})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
