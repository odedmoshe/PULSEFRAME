"""
PULSEFRAME picture-model worker (wave 8 picmodels; .artifacts/wave8/picmodels-plan.md §3.4 as corrected by picmodels-verify.md; the
protocol is apps/server/src/picmodels/contract.ts). Started by the server with `python -I`, the working directory the data
directory's tmp folder, and the offline variables set; never by hand in production. It is NOT pf_tools.py and NOT pf_search.py and
shares nothing with them. ONE SELF-CONTAINED FILE (verify C6: under -I nothing beside it can be imported); its SHA-256 is pinned in
contract.ts PICTURE_WORKER_SHA256 only after the lead has read all of it (until then the server reports engine_unverified).

THE EYES ROLE (W2): after the pin and the request, an onnxruntime session on the CPU only (2 threads, logging at errors only, no
profiling), the request's rgb letterboxed (right/bottom zero padding to a multiple of 32) into a BGR float32 0-255 NCHW tensor, and
decode_yunet() reduces the twelve heads to two eye points per face. UNVERIFIED HERE (no YuNet file on the machine this was written
on; its onnxruntime 1.29.0 ran these calls only against a hand-made stand-in graph of constants, test_pf_picture.py): the output
names and layout, the colour order and the value range follow the documented OpenCV FaceDetectorYN use of the 2023mar file and
are gated by the owner's laptop checks PM4 (inspect) and PM5 (one consented picture); a different list of output names or shapes is
model_mismatch, never a guess. The score floor 0.9 and the NMS IoU 0.3 are OpenCV's defaults: heuristic
numbers, provisional (core EYES.scoreFloor, EYES.nmsIoU).

NOTICE. decode_yunet() follows the post-processing of OpenCV's modules/objdetect/src/face_detect.cpp (FaceDetectorYN, its
postProcess: score = sqrt(clip(cls) * clip(obj)), cell offsets times the stride, exp() of the box size, NMSBoxes). OpenCV is
licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0; https://opencv.org/license/).
Modified for PULSEFRAME: rewritten in numpy; only the two eye landmarks are kept and returned; boxes are floats in the NMS; the faces
are returned sorted by position, never by score; no other landmark, no box and no score leaves the function.

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
import warnings  # noqa: E402

MAX_FACES = 8  # core EYES.maxFaces
INPUT_LONG_SIDE = 640  # core EYES.inputLongSide
DEFAULT_THREADS = 2  # core EYES.threads (verify C14)
MAX_SIDE = 4096
# core PICTURE_MODELS yunet pin (= tools/library/manifests/models-01.json item yunet/face_detection_yunet_2023mar.onnx; a test keeps them equal)
YUNET_PIN = ("face_detection_yunet_2023mar.onnx", 232589, "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4")
ERROR_CODES = ("bad_request", "engine_failed", "model_mismatch", "not_built")
SCORE_FLOOR = 0.9  # core EYES.scoreFloor (OpenCV FaceDetectorYN default; heuristic, provisional)
NMS_IOU = 0.3  # core EYES.nmsIoU (OpenCV FaceDetectorYN default; heuristic, provisional)
STRIDES = (8, 16, 32)
PAD_MULTIPLE = 32  # core PICTURE_MODELS yunet input.multipleOf
# The twelve heads of the 2023mar file as OpenCV's FaceDetectorYN names them (UNVERIFIED here: laptop check PM4), and the values per
# cell of each: class score, objectness, box (dx, dy, log w, log h), five landmarks (x, y) of which only the first two (the eyes) are read.
HEAD_CHANNELS = (("cls", 1), ("obj", 1), ("bbox", 4), ("kps", 10))
EXPECTED_OUTPUTS = tuple("%s_%d" % (head, s) for head, _ in HEAD_CHANNELS for s in STRIDES)


def out(obj):
    # Written as UTF-8 bytes whatever the console's code page (the line is ASCII anyway: ensure_ascii).
    data = (json.dumps(obj, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


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
    if not (isinstance(rid, int) and not isinstance(rid, bool) and rid > 0 and req["cmd"] == "eyes"):
        raise WorkerError("bad_request")
    if not (type(w) is int and type(h) is int and 0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE and isinstance(req["rgb"], str)):
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


# ---------- the model (eyes role): everything below runs only after the pin and the request were checked ----------
def _numpy():
    try:
        import numpy as np  # noqa: PLC0415 (imported after the network is disarmed, only by the commands that need it)
    except Exception:
        raise WorkerError("engine_failed")
    return np


def _onnxruntime():
    try:
        import onnxruntime as ort  # noqa: PLC0415
    except Exception:
        raise WorkerError("engine_failed")
    try:
        ort.set_default_logger_severity(3)  # errors only: no warning about the session reaches stderr
    except Exception:
        pass
    return ort


def padded_size(w, h, input_shape=None):
    """The model's input size for a w x h picture: right/bottom padding to a multiple of PAD_MULTIPLE (OpenCV FaceDetectorYN pads the
    same way), or, when the file declares a fixed height and width, exactly that size (the picture must fit, else model_mismatch)."""
    fixed = None
    if input_shape is not None:
        if len(input_shape) != 4:
            raise WorkerError("model_mismatch")
        ih, iw = input_shape[2], input_shape[3]
        if isinstance(ih, int) and isinstance(iw, int) and not isinstance(ih, bool) and not isinstance(iw, bool) and ih > 0 and iw > 0:
            fixed = (iw, ih)
    if fixed is not None:
        if w > fixed[0] or h > fixed[1] or fixed[0] % STRIDES[-1] or fixed[1] % STRIDES[-1]:
            raise WorkerError("model_mismatch")
        return fixed
    return (-(-w // PAD_MULTIPLE) * PAD_MULTIPLE, -(-h // PAD_MULTIPLE) * PAD_MULTIPLE)


def letterbox(rgb, w, h, pad_w, pad_h):
    """rgb24 bytes (w x h, row major) -> float32 tensor (1, 3, pad_h, pad_w): BGR channel order, values 0-255 unscaled, the picture at
    the top left and zeros to the right and below. The colour order and the range are what OpenCV's blobFromImage gives YuNet
    (UNVERIFIED here: laptop checks PM4/PM5)."""
    np = _numpy()
    pic = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3)
    tensor = np.zeros((1, 3, pad_h, pad_w), dtype=np.float32)
    tensor[0, :, :h, :w] = pic[:, :, ::-1].transpose(2, 0, 1)
    return tensor


def _nms_keep(boxes, scores, iou, limit):
    """Greedy NMS as OpenCV's NMSBoxes (highest score first; a box is kept when its IoU with every kept box is <= iou). Stops once
    `limit` boxes are kept: the caller only needs to know whether there are more than MAX_FACES."""
    np = _numpy()
    order = np.argsort(-scores, kind="stable")
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = boxes[:, 0] + boxes[:, 2], boxes[:, 1] + boxes[:, 3]
    area = np.maximum(boxes[:, 2], 0) * np.maximum(boxes[:, 3], 0)
    keep = []
    while order.size and len(keep) < limit:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        iw = np.maximum(0.0, np.minimum(x2[i], x2[rest]) - np.maximum(x1[i], x1[rest]))
        ih = np.maximum(0.0, np.minimum(y2[i], y2[rest]) - np.maximum(y1[i], y1[rest]))
        inter = iw * ih
        union = area[i] + area[rest] - inter
        overlap = np.where(union > 0, inter / np.where(union > 0, union, 1.0), 0.0)
        order = rest[overlap <= iou]
    return keep


def decode_yunet(outputs, in_w, in_h, score_floor=SCORE_FLOOR, nms_iou=NMS_IOU):
    """YuNet's twelve heads (a dict name -> array, for the in_w x in_h padded input) -> the eye points of each detected face, as
    [((x, y), (x, y)), ...] in input pixels, sorted by position (eye midpoint x, then y), never by score. At most MAX_FACES + 1 faces are
    returned (more than MAX_FACES is all the caller needs to know). Per stride s and cell (r, c), as OpenCV's postProcess:
    score = sqrt(clip(cls, 0, 1) * clip(obj, 0, 1)); kept when score >= score_floor; box (only for NMS) cx = (c + b0) s,
    cy = (r + b1) s, w = exp(b2) s, h = exp(b3) s; eye k (k = 0, 1) at ((kps[2k] + c) s, (kps[2k+1] + r) s). Boxes, scores and the other
    three landmarks never leave this function. A head missing or of another size is model_mismatch."""
    np = _numpy()
    eyes, boxes, scores = [], [], []
    with np.errstate(all="ignore"):
        for s in STRIDES:
            rows, cols = in_h // s, in_w // s
            heads = {}
            for head, ch in HEAD_CHANNELS:
                name = "%s_%d" % (head, s)
                if name not in outputs:
                    raise WorkerError("model_mismatch")
                arr = np.asarray(outputs[name], dtype=np.float32)
                if arr.size != rows * cols * ch:
                    raise WorkerError("model_mismatch")
                heads[head] = arr.reshape(rows * cols, ch)
            score = np.sqrt(np.clip(heads["cls"][:, 0], 0.0, 1.0) * np.clip(heads["obj"][:, 0], 0.0, 1.0))
            idx = np.nonzero(score >= score_floor)[0]
            if idx.size == 0:
                continue
            c = (idx % cols).astype(np.float32)
            r = (idx // cols).astype(np.float32)
            b = heads["bbox"][idx]
            k = heads["kps"][idx]
            bw, bh = np.exp(b[:, 2]) * s, np.exp(b[:, 3]) * s
            cx, cy = (c + b[:, 0]) * s, (r + b[:, 1]) * s
            boxes.append(np.stack([cx - bw / 2, cy - bh / 2, bw, bh], axis=1))
            scores.append(score[idx])
            eyes.append(np.stack([(k[:, 0] + c) * s, (k[:, 1] + r) * s, (k[:, 2] + c) * s, (k[:, 3] + r) * s], axis=1))
        if not scores:
            return []
        all_boxes = np.concatenate(boxes).astype(np.float64)
        all_scores = np.concatenate(scores).astype(np.float64)
        all_eyes = np.concatenate(eyes).astype(np.float64)
        keep = _nms_keep(all_boxes, all_scores, nms_iou, MAX_FACES + 1)
        faces = [((float(all_eyes[i, 0]), float(all_eyes[i, 1])), (float(all_eyes[i, 2]), float(all_eyes[i, 3]))) for i in keep]
    del boxes, scores, all_boxes, all_scores
    faces.sort(key=lambda f: ((f[0][0] + f[1][0]) / 2, (f[0][1] + f[1][1]) / 2))
    return faces


def result_line(rid, faces, w, h):
    """The answer for a w x h request: more than MAX_FACES faces -> tooMany (decided BEFORE anything is dropped, so no count beyond the
    limit leaves); otherwise every face whose two points lie inside the picture [0, w] x [0, h] (a point in the padding is dropped with
    its face, never moved)."""
    if len(faces) > MAX_FACES:
        return eyes_line(rid, faces)
    for f in faces:
        for x, y in f:
            if not (math.isfinite(x) and math.isfinite(y)):
                raise WorkerError("engine_failed")  # a non-finite point is a failed model run, never silently dropped
    inside = [f for f in faces if all(0 <= x <= w and 0 <= y <= h for x, y in f)]
    return eyes_line(rid, inside)


def session_options(ort, threads):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.log_severity_level = 3
    so.enable_profiling = False
    return so


def open_session(ort, path, threads):
    """The CPU session (CPUExecutionProvider only, verify C14). Its outputs must be exactly the twelve expected heads and its one input
    four-dimensional, else model_mismatch."""
    try:
        sess = ort.InferenceSession(path, sess_options=session_options(ort, threads), providers=["CPUExecutionProvider"])
        inputs = sess.get_inputs()
        names = [o.name for o in sess.get_outputs()]
    except WorkerError:
        raise
    except Exception:
        raise WorkerError("engine_failed")
    if sorted(names) != sorted(EXPECTED_OUTPUTS) or len(inputs) != 1:
        raise WorkerError("model_mismatch")
    return sess, inputs[0].name, list(inputs[0].shape or [])


def eyes_once(sess, input_name, input_shape, w, h, rgb):
    pad_w, pad_h = padded_size(w, h, input_shape)
    tensor = letterbox(rgb, w, h, pad_w, pad_h)
    try:
        values = sess.run(list(EXPECTED_OUTPUTS), {input_name: tensor})
    except Exception:
        raise WorkerError("engine_failed")
    del tensor
    if len(values) != len(EXPECTED_OUTPUTS):
        raise WorkerError("model_mismatch")
    return decode_yunet(dict(zip(EXPECTED_OUTPUTS, values)), pad_w, pad_h)


def _short(value):
    """An ONNX dimension or name as JSON: an int, a short string, or null."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return value[:64]
    return None


def inspect(argv):
    """inspect --model yunet --file model=PATH (laptop check PM4): after the pin, the input and output names and shapes, nothing else."""
    try:
        spec = arg(argv, "--file", "")
        if arg(argv, "--model") != "yunet" or not spec.startswith("model=") or len(spec) <= len("model="):
            raise WorkerError("bad_request")
        path = spec[len("model="):]
        verify_pin(path)
        ort = _onnxruntime()
        try:
            sess = ort.InferenceSession(path, sess_options=session_options(ort, DEFAULT_THREADS), providers=["CPUExecutionProvider"])
            ins = [{"name": _short(i.name), "shape": [_short(d) for d in (i.shape or [])]} for i in sess.get_inputs()]
            outs = [{"name": _short(o.name), "shape": [_short(d) for d in (o.shape or [])]} for o in sess.get_outputs()]
        except Exception:
            raise WorkerError("engine_failed")
        out({"event": "result", "inputs": ins, "outputs": outs})
        return 0
    except WorkerError as e:
        out({"event": "error", "code": e.code})
        return 1
    except Exception:
        out({"event": "error", "code": "engine_failed"})
        return 1


def serve(argv):
    rid = None
    try:
        model, threads = parse_serve_args(argv)
        verify_pin(model)
        line = sys.stdin.buffer.readline()
        rid, w, h, rgb = parse_request(line)
        ort = _onnxruntime()
        sess, input_name, input_shape = open_session(ort, model, threads)
        faces = eyes_once(sess, input_name, input_shape, w, h, rgb)
        del rgb, sess
        out(result_line(rid, faces, w, h))
        return 0
    except WorkerError as e:
        out(error_line(rid, e.code) if rid else {"event": "error", "code": e.code})
        return 1
    except Exception:  # never a traceback (it could quote the request)
        out(error_line(rid, "engine_failed") if rid else {"event": "error", "code": "engine_failed"})
        return 1


def main(argv):
    warnings.simplefilter("ignore")  # nothing about the picture on stderr, not even a library's warning
    cmd = argv[0] if argv else ""
    if cmd == "probe":
        return probe()
    if cmd == "serve":
        return serve(argv)
    if cmd == "inspect":
        return inspect(argv)
    out({"event": "error", "code": "bad_request"})
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
