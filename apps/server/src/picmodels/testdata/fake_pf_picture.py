"""
TEST-ADAPTER-picture/1 — a LABELLED STAND-IN for apps/server/tools/pf_picture.py (wave 8 picmodels). NOT A MODEL: it proves the
server's plumbing (one process per request, strict line parsing, shown coordinates, abort, nothing stored), never quality.
Python standard library only. Used ONLY through the runtime's test seam (PictureModelsTestSeams.worker), never from configuration.

It speaks the protocol of apps/server/src/picmodels/contract.ts. "Eyes" are the centroids of pure-magenta blobs (R >= 215, G <= 40,
B >= 215: the drawn 6x6 squares of packages/evals/src/picmodels-fixtures.ts), paired by nearest neighbour; an unpaired blob is dropped
(a decoy). More than 8 pairs -> {"tooMany": true}. Centroids are in continuous pixel coordinates (pixel i covers [i, i+1)).

Modes (environment variable PF_FAKE_PICTURE_MODE; the tests set it, nothing else does):
  ok (default)   the answer above
  planted        every x is shifted by 0.1234567 px (a value the privacy tests search for everywhere)
  box | score | landmark | count | third | outside | nan | garbage | crash | exit-early | slow
                 the bad answers the server must refuse: an extra key, a third point, a point outside the picture, NaN (not JSON),
                 a non-JSON line only, a crash with a traceback on stderr, an exit before answering, a 60 s sleep before answering
  missing:<module>  `probe` reports that module missing
"""
import base64
import json
import os
import sys
import time

LABEL = "TEST-ADAPTER-picture/1 (labelled stand-in: not a model; proves plumbing, never quality)"
MODE = os.environ.get("PF_FAKE_PICTURE_MODE", "ok")
PLANTED = 0.1234567


def out(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def blobs(w, h, rgb):
    mag = bytearray(w * h)
    for i in range(w * h):
        r, g, b = rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]
        if r >= 215 and g <= 40 and b >= 215:
            mag[i] = 1
    found = []
    for start in range(w * h):
        if not mag[start]:
            continue
        mag[start] = 0
        stack, sx, sy, n = [start], 0.0, 0.0, 0
        while stack:
            i = stack.pop()
            x, y = i % w, i // w
            sx += x + 0.5
            sy += y + 0.5
            n += 1
            for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, (i - w) if y > 0 else -1, (i + w) if y < h - 1 else -1):
                if j >= 0 and mag[j]:
                    mag[j] = 0
                    stack.append(j)
        if n >= 4:
            found.append((sx / n, sy / n))
    return found


def pairs(points):
    left = sorted(points)
    faces = []
    while len(left) >= 2:
        a = left.pop(0)
        k = min(range(len(left)), key=lambda j: (left[j][0] - a[0]) ** 2 + (left[j][1] - a[1]) ** 2)
        b = left.pop(k)
        faces.append([[a[0], a[1]], [b[0], b[1]]])
    return faces


def serve():
    line = sys.stdin.readline()
    if MODE == "exit-early":
        return 0
    if MODE == "crash":
        raise RuntimeError("fake crash with request text " + line[:40])
    req = json.loads(line)
    rid, w, h = req["id"], req["w"], req["h"]
    rgb = base64.b64decode(req["rgb"])
    faces = pairs(blobs(w, h, rgb))
    if MODE == "slow":
        time.sleep(60)
    if MODE == "garbage":
        sys.stdout.write("not json at all\n")
        sys.stdout.flush()
        return 0
    if len(faces) > 8:
        out({"id": rid, "event": "result", "tooMany": True})
        return 0
    if MODE == "planted":
        faces = [[[a[0] + PLANTED, a[1]], [b[0] + PLANTED, b[1]]] for a, b in faces]
    line = {"id": rid, "event": "result", "faces": faces}
    if MODE == "box":
        line["boxes"] = [[0, 0, 10, 10] for _ in faces]
    elif MODE == "score":
        line["scores"] = [0.99 for _ in faces]
    elif MODE == "landmark":
        line["faces"] = [[a, b, [a[0], a[1] + 5]] for a, b in faces]
    elif MODE == "count":
        line["count"] = len(faces)
    elif MODE == "third":
        line["faces"] = [[a, b, b] for a, b in faces]
    elif MODE == "outside":
        line["faces"] = [[[w * 1.2, a[1]], b] for a, b in faces]
    elif MODE == "nan":
        sys.stdout.write(json.dumps(line).replace("]]", ", NaN]]", 1) + "\n")
        sys.stdout.flush()
        return 0
    out(line)
    return 0


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "probe":
        missing = MODE.split(":", 1)[1] if MODE.startswith("missing:") else None
        out({"event": "result", "ok": missing is None, "python": sys.version.split()[0], "versions": {"numpy": "TEST", "onnxruntime": "TEST"}, "missing": missing, "cudaDevices": 0})
        return 0 if missing is None else 1
    if cmd == "serve":
        return serve()
    out({"event": "error", "code": "bad_request"})
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
