"""
TEST FAKE (labelled; used only by apps/server/src/localtools.test.ts). It is NOT the reviewed tools worker and translates nothing:
it speaks the JSON-lines protocol of apps/server/tools/pf_tools.py (probe, translate, serve) and returns marked placeholder text,
so the runner's setup states, validation, commit, cancel and kept-worker lifecycle can be tested without torch or any model.

Behaviour is chosen with environment variables (read when the process starts):
  PF_FAKE_TOOLS_MODE     ok (default) | probe-exit | probe-missing | missing-id | extra-id | empty | slow | error
  PF_FAKE_TOOLS_PIDFILE  if set, a translate or serve process (not probe) writes its pid there when it starts (tests check that cancel killed it)
"""
import argparse
import json
import os
import sys
import time

MODE = os.environ.get("PF_FAKE_TOOLS_MODE", "ok")


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def probe(_a):
    if MODE == "probe-exit":
        sys.stderr.write("Traceback (most recent call last):\n  File \"<fake>\", line 1\nModuleNotFoundError: No module named 'sentencepiece'\n")
        sys.exit(1)
    if MODE == "probe-missing":
        out({"event": "result", "ok": False, "python": "fake", "versions": {"torch": "0.0-fake"}, "device": None, "cudaDevices": 0,
             "missing": "sentencepiece", "errors": {"sentencepiece": "ModuleNotFoundError: No module named 'sentencepiece'"}})
        sys.exit(1)
    out({"event": "result", "ok": True, "python": "fake", "versions": {"torch": "0.0-fake", "transformers": "0.0-fake", "sentencepiece": "0.0-fake"}, "device": "cpu", "cudaDevices": 0})


def translate(a):
    with open(a.input, encoding="utf-8") as f:
        items = json.load(f)["items"]
    if MODE == "error":
        out({"event": "error", "code": "model_load_failed", "message": "fake: the model could not be loaded"})
        return 1
    result = {}
    for i, x in enumerate(items):
        if MODE == "slow":
            time.sleep(0.5)
        result[x["id"]] = f"[FAKE {a.direction}] {x['text']}"
        out({"event": "progress", "done": i + 1, "total": len(items)})
    ids = [x["id"] for x in items]
    if MODE == "missing-id" and ids:
        del result[ids[-1]]
    if MODE == "extra-id":
        result["seg_not_asked_for"] = "[FAKE] extra"
    if MODE == "empty" and ids:
        result[ids[0]] = "   "
    with open(a.output, "w", encoding="utf-8") as f:
        json.dump({"translations": result}, f, ensure_ascii=False)
    out({"event": "result", "device": "cpu", "count": len(result), "loadSeconds": 0.0, "translateSeconds": 0.0, "versions": {"torch": "0.0-fake", "transformers": "0.0-fake"}})
    return 0


def main():
    if os.environ.get("PF_FAKE_TOOLS_PIDFILE") and sys.argv[1:2] != ["probe"]:
        with open(os.environ["PF_FAKE_TOOLS_PIDFILE"], "w") as f:
            f.write(str(os.getpid()))
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe").set_defaults(fn=probe)
    t = sub.add_parser("translate")
    for k in ("--model", "--weights", "--direction", "--input", "--output"):
        t.add_argument(k, required=True)
    t.add_argument("--device", default="auto")
    t.add_argument("--batch", type=int, default=8)
    t.set_defaults(fn=translate)
    sub.add_parser("serve").set_defaults(fn=None)
    a = p.parse_args()
    if a.cmd != "serve":
        sys.exit(a.fn(a) or 0)
    out({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        argv = [str(req.pop("cmd"))]
        for k, v in req.items():
            if v is not None:
                argv += ["--" + k.replace("_", "-"), str(v)]
        r = p.parse_args(argv)
        r.fn(r)
        out({"event": "end"})


if __name__ == "__main__":
    main()
