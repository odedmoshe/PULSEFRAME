"""
Unit tests of pf_picture.py's eyes role (wave 8 picmodels W2). numpy only; no YuNet file is needed or used. Where the real
onnxruntime package is importable, RealOnnxruntime also runs the worker's session code against a HAND-WRITTEN twelve-output ONNX graph
of constants (synthetic, written to a temp folder and deleted; it is NOT YuNet and proves only that the worker's calls of the library
work, never the model's layout); otherwise that class is skipped with its reason.

Run from the repository root (isolated mode; discover puts this folder on sys.path itself):
    python3 -I -B -m unittest discover -s apps/server/tools -p test_pf_picture.py   (-B: no __pycache__ beside the worker)

The head tensors here are SYNTHETIC: they are laid out as the decode expects YuNet's outputs to be (the documented OpenCV
FaceDetectorYN layout), which is UNVERIFIED until the owner's laptop check PM4. These tests prove the arithmetic of the decode, the NMS,
the limit and the strict line, never that the real model gives these tensors. The `onnxruntime` used by the serve tests is a LABELLED
STAND-IN module put into sys.modules (FakeOrt below), not the library.
"""
import base64
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest

try:
    import numpy as np
except Exception:  # pragma: no cover - the reason is printed by the skip below
    np = None

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("pf_picture_under_test", os.path.join(HERE, "pf_picture.py"))
pf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pf)

NEEDS_NUMPY = "numpy is not installed in this Python: the decode tests need it (the worker's own lock installs numpy 2.5.4)"


def heads(in_w, in_h, cells, fill=0.0):
    """Synthetic YuNet heads for an in_w x in_h input: `cells` is a list of dicts {s, r, c, cls, obj, box: (b0, b1, b2, b3),
    kps: 10 values}; every other cell has cls = obj = fill. Shapes (1, rows*cols, ch) as onnxruntime returns them."""
    o = {}
    for s in pf.STRIDES:
        n = (in_h // s) * (in_w // s)
        for head, ch in pf.HEAD_CHANNELS:
            o["%s_%d" % (head, s)] = np.full((1, n, ch), fill if head in ("cls", "obj") else 0.0, dtype=np.float32)
    for cell in cells:
        s, cols = cell["s"], in_w // cell["s"]
        i = cell["r"] * cols + cell["c"]
        o["cls_%d" % s][0, i, 0] = cell.get("cls", 1.0)
        o["obj_%d" % s][0, i, 0] = cell.get("obj", 1.0)
        o["bbox_%d" % s][0, i, :] = cell.get("box", (0.0, 0.0, 0.0, 0.0))
        o["kps_%d" % s][0, i, :] = cell.get("kps", (0.0,) * 10)
    return o


def eye_cell(s, r, c, ex1, ey1, ex2, ey2, **kw):
    """A cell whose eyes decode to the given input pixels: kps = eye / s - cell."""
    kps = (ex1 / s - c, ey1 / s - r, ex2 / s - c, ey2 / s - r, 7.0, 7.0, 8.0, 8.0, 9.0, 9.0)  # nose and mouth: must never come out
    return dict(s=s, r=r, c=c, kps=kps, **kw)


@unittest.skipIf(np is None, NEEDS_NUMPY)
class DecodeYunet(unittest.TestCase):
    def test_known_cells_give_the_known_eye_points(self):
        o = heads(64, 64, [dict(s=8, r=2, c=3, kps=(0.5, 0.25, 1.5, 0.25, 9, 9, 9, 9, 9, 9))])
        self.assertEqual(pf.decode_yunet(o, 64, 64), [((28.0, 18.0), (36.0, 18.0))])
        o = heads(64, 64, [dict(s=32, r=1, c=0, kps=(0.25, 0.5, 0.75, 0.5, 0, 0, 0, 0, 0, 0))])
        self.assertEqual(pf.decode_yunet(o, 64, 64), [((8.0, 48.0), (24.0, 48.0))])

    def test_only_two_points_per_face_leave_and_nothing_else(self):
        o = heads(96, 64, [eye_cell(8, 3, 4, 30.0, 30.0, 40.0, 30.0, box=(0.5, 0.5, 1.0, 1.0))])
        faces = pf.decode_yunet(o, 96, 64)
        self.assertEqual(len(faces), 1)
        self.assertEqual([len(f) for f in faces], [2])
        self.assertEqual([len(p) for p in faces[0]], [2, 2])
        line = pf.result_line(4, faces, 96, 64)
        self.assertEqual(set(line), {"id", "event", "faces"})
        self.assertEqual(line["faces"], [[[30.0, 30.0], [40.0, 30.0]]])
        self.assertNotIn("7.0", json.dumps(line))  # the nose and mouth values of the cell

    def test_nms_keeps_one_of_two_overlapping_detections(self):
        # two neighbouring cells of one face with big boxes (exp(2) * 8 ~ 59 px): IoU well above 0.3; the higher score's eyes stay
        a = eye_cell(8, 3, 3, 20.0, 28.0, 36.0, 28.0, cls=1.0, obj=1.0, box=(0.5, 0.5, 2.0, 2.0))
        b = eye_cell(8, 3, 4, 21.0, 29.0, 37.0, 29.0, cls=0.95, obj=0.95, box=(0.0, 0.5, 2.0, 2.0))
        self.assertEqual(pf.decode_yunet(heads(64, 64, [b, a]), 64, 64), [((20.0, 28.0), (36.0, 28.0))])
        # the same two far apart with small boxes: both stay
        a2 = eye_cell(8, 1, 1, 10.0, 10.0, 14.0, 10.0, box=(0.5, 0.5, 0.0, 0.0))
        b2 = eye_cell(8, 6, 6, 50.0, 50.0, 54.0, 50.0, cls=0.95, obj=0.95, box=(0.5, 0.5, 0.0, 0.0))
        self.assertEqual(len(pf.decode_yunet(heads(64, 64, [a2, b2]), 64, 64)), 2)

    def test_nine_detections_give_too_many_and_no_point_eight_give_eight(self):
        cells = [eye_cell(8, 1 + 2 * (k // 5), 1 + 2 * (k % 5), 16.0 * (k % 5) + 8, 16.0 * (k // 5) + 12, 16.0 * (k % 5) + 12, 16.0 * (k // 5) + 12, box=(0.5, 0.5, 0.0, 0.0)) for k in range(9)]
        nine = pf.decode_yunet(heads(96, 64, cells), 96, 64)
        self.assertEqual(len(nine), pf.MAX_FACES + 1)
        self.assertEqual(pf.result_line(2, nine, 96, 64), {"id": 2, "event": "result", "tooMany": True})
        eight = pf.decode_yunet(heads(96, 64, cells[:8]), 96, 64)
        line = pf.result_line(2, eight, 96, 64)
        self.assertEqual(len(line["faces"]), 8)

    def test_too_many_is_decided_before_points_in_the_padding_are_dropped(self):
        cells = [eye_cell(8, 1, 1 + k, 8.0 * k + 9, 10.0, 8.0 * k + 11, 10.0, box=(0.5, 0.5, -1.0, -1.0)) for k in range(9)]
        faces = pf.decode_yunet(heads(96, 32, cells), 96, 32)
        self.assertEqual(len(faces), 9)
        # the picture is only 40 px wide: most of these faces lie in the padding, yet nine were found, so: tooMany, no point
        self.assertEqual(pf.result_line(1, faces, 40, 32), {"id": 1, "event": "result", "tooMany": True})

    def test_a_score_below_the_floor_is_dropped_and_values_are_clipped(self):
        low = eye_cell(8, 2, 2, 20.0, 20.0, 24.0, 20.0, cls=0.85, obj=0.85)  # sqrt = 0.85 < 0.9
        self.assertEqual(pf.decode_yunet(heads(64, 64, [low]), 64, 64), [])
        kept = eye_cell(8, 2, 2, 20.0, 20.0, 24.0, 20.0, cls=0.95, obj=0.95)
        self.assertEqual(len(pf.decode_yunet(heads(64, 64, [kept]), 64, 64)), 1)
        # cls 1.7 is clipped to 1 and obj -3 to 0: score 0, dropped (unclipped, the product would be negative and sqrt NaN)
        odd = eye_cell(8, 2, 2, 20.0, 20.0, 24.0, 20.0, cls=1.7, obj=-3.0)
        self.assertEqual(pf.decode_yunet(heads(64, 64, [odd]), 64, 64), [])
        # cls 1.7 clipped to 1 with obj 0.9: sqrt(0.9) ~ 0.949 >= 0.9, kept
        hi = eye_cell(8, 2, 2, 20.0, 20.0, 24.0, 20.0, cls=1.7, obj=0.9)
        self.assertEqual(len(pf.decode_yunet(heads(64, 64, [hi]), 64, 64)), 1)
        # a background just under the floor everywhere gives nothing
        self.assertEqual(pf.decode_yunet(heads(64, 64, [], fill=0.89), 64, 64), [])

    def test_faces_come_out_sorted_by_position_never_by_score(self):
        right = eye_cell(8, 2, 6, 50.0, 20.0, 56.0, 20.0, cls=1.0, obj=1.0, box=(0.5, 0.5, 0.0, 0.0))
        left = eye_cell(8, 2, 1, 8.0, 20.0, 14.0, 20.0, cls=0.92, obj=0.92, box=(0.5, 0.5, 0.0, 0.0))
        faces = pf.decode_yunet(heads(64, 64, [right, left]), 64, 64)
        self.assertEqual([f[0][0] for f in faces], [8.0, 50.0])

    def test_a_missing_head_or_another_size_is_model_mismatch(self):
        o = heads(64, 64, [])
        del o["kps_32"]
        with self.assertRaises(pf.WorkerError) as e:
            pf.decode_yunet(o, 64, 64)
        self.assertEqual(e.exception.code, "model_mismatch")
        o = heads(64, 64, [])
        o["bbox_16"] = np.zeros((1, 16, 3), dtype=np.float32)
        with self.assertRaises(pf.WorkerError) as e:
            pf.decode_yunet(o, 64, 64)
        self.assertEqual(e.exception.code, "model_mismatch")

    def test_a_point_outside_the_picture_drops_its_face_and_a_nan_point_fails(self):
        inside = ((10.0, 10.0), (14.0, 10.0))
        outside = ((38.0, 10.0), (41.5, 10.0))
        self.assertEqual(pf.result_line(1, [inside, outside], 40, 32), {"id": 1, "event": "result", "faces": [[[10.0, 10.0], [14.0, 10.0]]]})
        with self.assertRaises(pf.WorkerError) as e:
            pf.result_line(1, [((float("nan"), 1.0), (2.0, 1.0))], 40, 32)
        self.assertEqual(e.exception.code, "engine_failed")


@unittest.skipIf(np is None, NEEDS_NUMPY)
class Letterbox(unittest.TestCase):
    def test_padded_size_is_a_multiple_of_32_or_the_fixed_input(self):
        self.assertEqual(pf.padded_size(640, 427), (640, 448))
        self.assertEqual(pf.padded_size(1, 1), (32, 32))
        self.assertEqual(pf.padded_size(640, 427, [1, 3, "height", "width"]), (640, 448))
        self.assertEqual(pf.padded_size(640, 427, [1, 3, 640, 640]), (640, 640))
        for shape in ([1, 3, 320, 320], [1, 3, 640], [1, 3, 650, 650]):
            with self.assertRaises(pf.WorkerError) as e:
                pf.padded_size(640, 427, shape)
            self.assertEqual(e.exception.code, "model_mismatch")

    def test_bgr_order_0_255_range_and_zero_padding(self):
        w, h = 3, 2
        rgb = bytes([10, 20, 30] * (w * h))
        t = pf.letterbox(rgb, w, h, 32, 32)
        self.assertEqual(t.shape, (1, 3, 32, 32))
        self.assertEqual(t.dtype, np.float32)
        self.assertTrue(np.all(t[0, 0, :h, :w] == 30) and np.all(t[0, 1, :h, :w] == 20) and np.all(t[0, 2, :h, :w] == 10))
        self.assertEqual(float(t[0, :, h:, :].sum() + t[0, :, :, w:].sum()), 0.0)
        # row-major: the pixel (x=2, y=1) lands at [.., 1, 2]
        b = bytearray(rgb)
        b[3 * (1 * w + 2): 3 * (1 * w + 2) + 3] = bytes([255, 0, 1])
        t = pf.letterbox(bytes(b), w, h, 32, 32)
        self.assertEqual([float(t[0, c, 1, 2]) for c in range(3)], [1.0, 0.0, 255.0])


class FakeOrt(types.ModuleType):
    """LABELLED STAND-IN for the onnxruntime module (not the library, not a model): it records the session options and providers it is
    given, and answers with the synthetic heads it was told to."""

    def __init__(self, outputs_for, names=None, input_shape=None):
        super().__init__("onnxruntime")
        self.outputs_for, self.names = outputs_for, names or list(pf.EXPECTED_OUTPUTS)
        self.input_shape = input_shape if input_shape is not None else [1, 3, "h", "w"]
        self.seen = {}
        fake = self

        class SessionOptions:
            pass

        class Node:
            def __init__(self, name, shape):
                self.name, self.shape = name, shape

        class InferenceSession:
            def __init__(self, path, sess_options=None, providers=None):
                fake.seen.update(path=path, providers=providers, intra=sess_options.intra_op_num_threads, inter=sess_options.inter_op_num_threads, severity=sess_options.log_severity_level, profiling=sess_options.enable_profiling)

            def get_inputs(self):
                return [Node("input", fake.input_shape)]

            def get_outputs(self):
                return [Node(n, [1, "n", 1]) for n in fake.names]

            def run(self, names, feeds):
                tensor = feeds["input"]
                fake.seen.update(run_names=list(names), shape=tuple(tensor.shape), dtype=str(tensor.dtype))
                o = fake.outputs_for(tensor.shape[3], tensor.shape[2])
                return [o[n] for n in names]

        self.SessionOptions, self.InferenceSession = SessionOptions, InferenceSession
        self.__version__ = "stand-in"

    def set_default_logger_severity(self, level):
        self.seen["default_severity"] = level


@unittest.skipIf(np is None, NEEDS_NUMPY)
class ServeWithAStandInRuntime(unittest.TestCase):
    """The whole serve path in this process, with FakeOrt in place of onnxruntime and a tiny temp file pinned in place of YuNet."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pf-picture-test-")
        self.model = os.path.join(self.dir, "model.onnx")
        with open(self.model, "wb") as f:
            f.write(b"stand-in model bytes")
        self.saved_pin, self.saved_ort = pf.YUNET_PIN, sys.modules.get("onnxruntime")
        pf.YUNET_PIN = ("model.onnx", 20, hashlib.sha256(b"stand-in model bytes").hexdigest())

    def tearDown(self):
        pf.YUNET_PIN = self.saved_pin
        if self.saved_ort is None:
            sys.modules.pop("onnxruntime", None)
        else:
            sys.modules["onnxruntime"] = self.saved_ort
        for n in os.listdir(self.dir):
            os.remove(os.path.join(self.dir, n))
        os.rmdir(self.dir)

    def run_serve(self, fake, w=40, h=30, rid=5, threads="2"):
        sys.modules["onnxruntime"] = fake
        req = json.dumps({"id": rid, "cmd": "eyes", "w": w, "h": h, "rgb": base64.b64encode(bytes([200, 100, 50]) * (w * h)).decode("ascii")})
        stdin, stdout, stderr = sys.stdin, sys.stdout, sys.stderr
        sys.stdin = types.SimpleNamespace(buffer=io.BytesIO((req + "\n").encode("ascii")))
        sys.stdout = types.SimpleNamespace(buffer=io.BytesIO())
        sys.stderr = io.StringIO()
        try:
            code = pf.main(["serve", "--role", "eyes", "--model", self.model, "--threads", threads])
            lines = sys.stdout.buffer.getvalue().decode("utf-8").splitlines()
            err = sys.stderr.getvalue()
        finally:
            sys.stdin, sys.stdout, sys.stderr = stdin, stdout, stderr
        return code, lines, err

    def test_one_request_one_strict_line_on_the_cpu_with_two_threads(self):
        fake = FakeOrt(lambda iw, ih: heads(iw, ih, [eye_cell(8, 1, 1, 10.0, 12.0, 18.0, 12.0, box=(0.5, 0.5, 0.0, 0.0))]))
        code, lines, err = self.run_serve(fake)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(lines, ['{"id":5,"event":"result","faces":[[[10.0,12.0],[18.0,12.0]]]}'])
        self.assertEqual(fake.seen["providers"], ["CPUExecutionProvider"])
        self.assertEqual((fake.seen["intra"], fake.seen["inter"], fake.seen["severity"], fake.seen["profiling"], fake.seen["default_severity"]), (2, 1, 3, False, 3))
        self.assertEqual((fake.seen["shape"], fake.seen["dtype"]), ((1, 3, 32, 64), "float32"))
        self.assertEqual(fake.seen["run_names"], list(pf.EXPECTED_OUTPUTS))

    def test_other_output_names_are_model_mismatch_with_the_id(self):
        fake = FakeOrt(lambda iw, ih: heads(iw, ih, []), names=list(pf.EXPECTED_OUTPUTS[:-1]) + ["landmarks"])
        code, lines, err = self.run_serve(fake)
        self.assertEqual((code, lines, err), (1, ['{"id":5,"event":"error","code":"model_mismatch"}'], ""))

    def test_a_runtime_crash_is_a_code_never_a_traceback(self):
        def boom(iw, ih):
            raise RuntimeError("a message that could quote the request")
        code, lines, err = self.run_serve(FakeOrt(boom))
        self.assertEqual((code, lines, err), (1, ['{"id":5,"event":"error","code":"engine_failed"}'], ""))

    def test_nine_faces_answer_too_many(self):
        cells = [eye_cell(8, 1, 1 + k, 8.0 * k + 9, 10.0, 8.0 * k + 11, 10.0, box=(0.5, 0.5, -1.0, -1.0)) for k in range(9)]
        code, lines, _ = self.run_serve(FakeOrt(lambda iw, ih: heads(iw, ih, cells)), w=80, h=30)
        self.assertEqual((code, lines), (0, ['{"id":5,"event":"result","tooMany":true}']))

    def test_no_file_is_written_into_the_working_directory(self):
        before = set(os.listdir(os.getcwd()))
        self.run_serve(FakeOrt(lambda iw, ih: heads(iw, ih, [])))
        self.assertEqual(set(os.listdir(os.getcwd())), before)


class Requests(unittest.TestCase):
    """The skeleton's strict parsing (no numpy needed)."""

    def test_an_id_that_is_a_boolean_is_refused(self):
        for rid in (True, 0, -1, 1.0, "1"):
            line = json.dumps({"id": rid, "cmd": "eyes", "w": 1, "h": 1, "rgb": "AAAA"})
            with self.assertRaises(pf.WorkerError) as e:
                pf.parse_request(line)
            self.assertEqual(e.exception.code, "bad_request", rid)
        line = json.dumps({"id": 1, "cmd": "eyes", "w": True, "h": 1, "rgb": "AAA="})
        with self.assertRaises(pf.WorkerError):
            pf.parse_request(line)

    def test_bytes_that_are_not_utf8_are_bad_request(self):
        with self.assertRaises(pf.WorkerError) as e:
            pf.parse_request(b"\xff\xfe{")
        self.assertEqual(e.exception.code, "bad_request")

    def test_the_expected_heads_are_the_twelve_names(self):
        self.assertEqual(sorted(pf.EXPECTED_OUTPUTS), sorted("%s_%d" % (h, s) for h in ("cls", "obj", "bbox", "kps") for s in (8, 16, 32)))


# ---------- a hand-written ONNX file (protobuf wire format; no onnx package needed) ----------
def _varint(n):
    b = b""
    while True:
        low, n = n & 0x7F, n >> 7
        if n:
            b += bytes([low | 0x80])
        else:
            return b + bytes([low])


def _vi(field, n):
    return _varint(field << 3) + _varint(n)


def _ld(field, data):
    data = data.encode("ascii") if isinstance(data, str) else data
    return _varint((field << 3) | 2) + _varint(len(data)) + data


def constant_heads_onnx(outputs, input_dims):
    """A ModelProto (ir 8, opset 13) with one float input of input_dims (ints or names) and the given outputs, each an Identity of a
    float initializer: a SYNTHETIC stand-in graph of constants, never a model."""
    def value_info(name, dims):
        shape = b"".join(_ld(1, _vi(1, d) if isinstance(d, int) else _ld(2, d)) for d in dims)
        return _ld(1, name) + _ld(2, _ld(1, _vi(1, 1) + _ld(2, shape)))
    graph = b"".join(_ld(1, _ld(1, "c_" + n) + _ld(2, n) + _ld(4, "Identity")) for n in outputs) + _ld(2, "stand_in")
    for n, a in outputs.items():
        graph += _ld(5, b"".join(_vi(1, d) for d in a.shape) + _vi(2, 1) + _ld(8, "c_" + n) + _ld(9, a.astype("<f4").tobytes()))
    graph += _ld(11, value_info("input", input_dims))
    for n, a in outputs.items():
        graph += _ld(12, value_info(n, list(a.shape)))
    return _vi(1, 8) + _ld(8, _ld(1, "") + _vi(2, 13)) + _ld(7, graph)


DRIVER = """
import importlib.util, sys
spec = importlib.util.spec_from_file_location("pf_picture", sys.argv[1])
pf = importlib.util.module_from_spec(spec); spec.loader.exec_module(pf)
pf.YUNET_PIN = (sys.argv[2], int(sys.argv[3]), sys.argv[4])  # the synthetic file stands in for the pin in this test only
sys.exit(pf.main(sys.argv[5:]))
"""


def _has_onnxruntime():
    try:
        r = subprocess.run([sys.executable, "-I", "-c", "import onnxruntime"], capture_output=True, timeout=60)
        return r.returncode == 0
    except Exception:
        return False


HAS_ORT = np is not None and _has_onnxruntime()


@unittest.skipIf(not HAS_ORT, "the onnxruntime package (and numpy) cannot be imported by this Python: the worker's library calls are checked on the laptop (PM2, PM4)")
class RealOnnxruntime(unittest.TestCase):
    """The worker as the server starts it (python -I -X utf8, its own process, cwd an empty temp folder), with the real onnxruntime
    and a synthetic constant graph pinned in place of YuNet through a test-only driver."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pf-picture-ort-")
        self.cwd = tempfile.mkdtemp(prefix="pf-picture-cwd-")

    def tearDown(self):
        for d in (self.dir, self.cwd):
            for n in os.listdir(d):
                os.remove(os.path.join(d, n))
            os.rmdir(d)

    def model(self, outputs, input_dims):
        data = constant_heads_onnx(outputs, input_dims)
        path = os.path.join(self.dir, "stand_in.onnx")
        with open(path, "wb") as f:
            f.write(data)
        return path, [os.path.basename(path), str(len(data)), hashlib.sha256(data).hexdigest()]

    def worker(self, path, pin, args, stdin=b""):
        cmd = [sys.executable, "-I", "-X", "utf8", "-B", "-c", DRIVER, os.path.join(HERE, "pf_picture.py")] + pin + args
        r = subprocess.run(cmd, input=stdin, capture_output=True, cwd=self.cwd, timeout=120)
        return r.returncode, r.stdout.decode("utf-8").splitlines(), r.stderr.decode("utf-8", "replace")

    def test_serve_runs_the_session_on_the_cpu_and_answers_one_strict_line(self):
        for dims in ([1, 3, 64, 64], [1, 3, "height", "width"]):
            path, pin = self.model(heads(64, 64, [eye_cell(16, 1, 2, 36.0, 20.0, 44.0, 20.0, box=(0.5, 0.5, 0.0, 0.0))]), dims)
            req = json.dumps({"id": 9, "cmd": "eyes", "w": 60, "h": 50, "rgb": base64.b64encode(bytes(60 * 50 * 3)).decode("ascii")})
            code, lines, err = self.worker(path, pin, ["serve", "--role", "eyes", "--model", path, "--threads", "2"], (req + "\n").encode("ascii"))
            self.assertEqual((code, lines, err), (0, ['{"id":9,"event":"result","faces":[[[36.0,20.0],[44.0,20.0]]]}'], ""), dims)
            self.assertEqual(os.listdir(self.cwd), [])

    def test_a_graph_with_other_output_names_is_model_mismatch(self):
        o = heads(64, 64, [])
        o["landmarks_32"] = o.pop("kps_32")
        path, pin = self.model(o, [1, 3, 64, 64])
        req = json.dumps({"id": 3, "cmd": "eyes", "w": 64, "h": 64, "rgb": base64.b64encode(bytes(64 * 64 * 3)).decode("ascii")})
        code, lines, err = self.worker(path, pin, ["serve", "--role", "eyes", "--model", path], (req + "\n").encode("ascii"))
        self.assertEqual((code, lines, err), (1, ['{"id":3,"event":"error","code":"model_mismatch"}'], ""))

    def test_inspect_prints_names_and_shapes_only(self):
        path, pin = self.model(heads(64, 64, []), [1, 3, "height", "width"])
        code, lines, err = self.worker(path, pin, ["inspect", "--model", "yunet", "--file", "model=" + path])
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(len(lines), 1)
        o = json.loads(lines[0])
        self.assertEqual(set(o), {"event", "inputs", "outputs"})
        self.assertEqual(o["inputs"], [{"name": "input", "shape": [1, 3, "height", "width"]}])
        self.assertEqual(sorted(x["name"] for x in o["outputs"]), sorted(pf.EXPECTED_OUTPUTS))
        self.assertEqual({x["name"]: x["shape"] for x in o["outputs"]}["kps_8"], [1, 64, 10])
        self.assertNotIn(self.dir, lines[0])

    def test_a_damaged_graph_with_a_matching_pin_is_a_code_with_no_traceback(self):
        path = os.path.join(self.dir, "stand_in.onnx")
        data = b"\x08\x08this is not a model graph"
        with open(path, "wb") as f:
            f.write(data)
        pin = [os.path.basename(path), str(len(data)), hashlib.sha256(data).hexdigest()]
        for args in (["inspect", "--model", "yunet", "--file", "model=" + path], ["serve", "--role", "eyes", "--model", path]):
            req = json.dumps({"id": 4, "cmd": "eyes", "w": 1, "h": 1, "rgb": "AAAA"}) + "\n"
            code, lines, err = self.worker(path, pin, args, req.encode("ascii"))
            self.assertEqual(code, 1, args)
            self.assertIn(lines, (['{"event":"error","code":"engine_failed"}'], ['{"id":4,"event":"error","code":"engine_failed"}']), args)
            self.assertEqual(err, "", args)  # not even onnxruntime's own load error reaches stderr


if __name__ == "__main__":
    unittest.main()
