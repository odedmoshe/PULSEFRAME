/**
 * The Python side of the picture-model runtime (wave 8 picmodels pre-pass), run by this container's python3 -I:
 * - the lock: every line of requirements-picture-win-cpu.txt is pinned to one version and at least one SHA-256; exactly onnxruntime
 *   1.29.0, flatbuffers 25.12.19 and protobuf 7.36.2; no onnxruntime-gpu; the search lock does not hold them (it stays untouched);
 * - pf_picture.py: its yunet pin equals core's; PICTURE_WORKER_SHA256 is null or this file's digest; the network is disarmed; the
 *   request is parsed strictly; eyes_line() builds exactly the strict line (tooMany above eight, no point); serve refuses a file that
 *   is not the pinned yunet with model_mismatch; with no model code it never answers a point;
 * - the labelled fake: finds the drawn eyes, says tooMany for nine faces, and its bad modes fail core EyesWorkerLineSchema.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EyesWorkerLineSchema, pictureModel } from '@pulseframe/core';
import { PICTURE_WORKER, PICTURE_WORKER_SHA256 } from './contract.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const worker = path.join(root, PICTURE_WORKER);
const fake = path.join(root, 'apps/server/src/picmodels/testdata/fake_pf_picture.py');
const lock = path.join(root, 'apps/server/tools/requirements-picture-win-cpu.txt');
const python = (() => { try { execFileSync('python3', ['-I', '-c', 'pass']); return 'python3'; } catch { return null; } })();
const py = (args: string[], input = '', env: Record<string, string> = {}) => {
  const r = spawnSync(python!, ['-I', ...args], { input, encoding: 'utf8', cwd: os.tmpdir(), env: { ...process.env, ...env }, timeout: 60_000 });
  return { code: r.status, lines: r.stdout.split('\n').filter(Boolean), stderr: r.stderr };
};

describe('the picture lock', () => {
  const lines = fs.readFileSync(lock, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith('#'));
  it('every requirement line is pinned with == and carries SHA-256 hashes only', () => {
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l, l).toMatch(/^[a-z0-9][a-z0-9-]*==[0-9][0-9A-Za-z.]*( --hash=sha256:[0-9a-f]{64})+$/);
  });
  it('holds exactly onnxruntime 1.29.0 (CPU), flatbuffers 25.12.19 and protobuf 7.36.2; never onnxruntime-gpu', () => {
    expect(lines.map((l) => l.split(' ')[0]).sort()).toEqual(['flatbuffers==25.12.19', 'onnxruntime==1.29.0', 'protobuf==7.36.2']);
    expect(fs.readFileSync(lock, 'utf8')).not.toMatch(/^onnxruntime-gpu/m);
  });
  it('the search lock stays as it is: none of the three is in it', () => {
    const search = fs.readFileSync(path.join(root, 'apps/server/tools/requirements-search-win-cpu.txt'), 'utf8');
    for (const n of ['onnxruntime', 'flatbuffers', 'protobuf']) expect(search).not.toMatch(new RegExp(`^${n}==`, 'm'));
  });
});

describe('pf_picture.py (skeleton)', () => {
  const text = fs.readFileSync(worker, 'utf8');
  it('its yunet pin equals core\'s registry, and the reviewed digest is null or this exact file', () => {
    const pin = pictureModel('yunet').pins[0]!;
    expect(text).toContain(`YUNET_PIN = ("${pin.name}", ${pin.bytes}, "${pin.sha256}")`);
    if (PICTURE_WORKER_SHA256 !== null) expect(createHash('sha256').update(fs.readFileSync(worker)).digest('hex')).toBe(PICTURE_WORKER_SHA256);
  });
  it.skipIf(!python)('the network is disarmed, the request is strict and eyes_line builds the strict line', () => {
    const script = String.raw`
import json, runpy, sys, socket
m = runpy.run_path(sys.argv[1])
res = {}
try:
    socket.create_connection(("127.0.0.1", 9)); res["net"] = "open"
except OSError:
    res["net"] = "refused"
res["two"] = m["eyes_line"](3, [((1, 2), (3, 4))])
res["nine"] = m["eyes_line"](3, [((1, 2), (3, 4))] * 9)
res["none"] = m["eyes_line"](3, [])
def code(f, *a):
    try:
        f(*a); return "ok"
    except m["WorkerError"] as e:
        return e.code
res["nan"] = code(m["eyes_line"], 3, [((float("nan"), 2), (3, 4))])
res["third"] = code(m["eyes_line"], 3, [((1, 2), (3, 4), (5, 6))])
good = json.dumps({"id": 1, "cmd": "eyes", "w": 2, "h": 1, "rgb": "AAAAAAAA"})
res["good"] = code(m["parse_request"], good)
res["extra"] = code(m["parse_request"], json.dumps({"id": 1, "cmd": "eyes", "w": 2, "h": 1, "rgb": "AAAAAAAA", "path": "x"}))
res["short"] = code(m["parse_request"], json.dumps({"id": 1, "cmd": "eyes", "w": 3, "h": 1, "rgb": "AAAAAAAA"}))
res["role"] = code(m["parse_serve_args"], ["serve", "--role", "map", "--model", "x"])
res["threads"] = code(m["parse_serve_args"], ["serve", "--role", "eyes", "--model", "x", "--threads", "9"])
print(json.dumps(res))
`;
    const r = py(['-c', script, worker]);
    expect(r.code, r.stderr).toBe(0);
    const res = JSON.parse(r.lines.at(-1)!);
    expect(res.net).toBe('refused');
    for (const k of ['two', 'nine', 'none']) expect(EyesWorkerLineSchema.safeParse(res[k]).success, k).toBe(true);
    expect(res.two).toEqual({ id: 3, event: 'result', faces: [[[1, 2], [3, 4]]] });
    expect(res.nine).toEqual({ id: 3, event: 'result', tooMany: true });
    expect([res.nan, res.third, res.good, res.extra, res.short, res.role, res.threads]).toEqual(['engine_failed', 'engine_failed', 'ok', 'bad_request', 'bad_request', 'bad_request', 'bad_request']);
  });
  it.skipIf(!python)('probe answers one line naming what it cannot import; serve refuses a file that is not the pinned yunet; no point without model code', () => {
    const p = py([worker, 'probe']);
    expect(p.lines).toHaveLength(1);
    const o = JSON.parse(p.lines[0]!);
    expect(Object.keys(o).sort()).toEqual(['cudaDevices', 'event', 'missing', 'ok', 'python', 'versions']);
    expect(p.code).toBe(o.ok ? 0 : 1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-picture-'));
    try {
      const notYunet = path.join(dir, 'face_detection_yunet_2023mar.onnx');
      fs.writeFileSync(notYunet, Buffer.alloc(232589));
      const s = py([worker, 'serve', '--role', 'eyes', '--model', notYunet], `${JSON.stringify({ id: 1, cmd: 'eyes', w: 1, h: 1, rgb: 'AAAA' })}\n`);
      expect(s.lines).toEqual(['{"event":"error","code":"model_mismatch"}']);
      expect(s.stderr).toBe('');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the labelled fake (fake_pf_picture.py)', () => {
  /** A w × h grey picture with 6×6 magenta squares centred on the given odd whole-number points. */
  const picture = (w: number, h: number, eyes: [number, number][]) => {
    const b = Buffer.alloc(w * h * 3, 128);
    for (const [cx, cy] of eyes) for (let y = cy - 3; y < cy + 3; y++) for (let x = cx - 3; x < cx + 3; x++) { const i = 3 * (y * w + x); b[i] = 255; b[i + 1] = 0; b[i + 2] = 255; }
    return b;
  };
  const ask = (rgb: Buffer, w: number, h: number, mode = 'ok') => py([fake, 'serve', '--role', 'eyes', '--model', 'x'], `${JSON.stringify({ id: 7, cmd: 'eyes', w, h, rgb: rgb.toString('base64') })}\n`, { PF_FAKE_PICTURE_MODE: mode });
  it.skipIf(!python)('says it is a stand-in, and finds two drawn eyes at their centres (a decoy square is dropped)', () => {
    expect(fs.readFileSync(fake, 'utf8')).toContain('LABELLED STAND-IN');
    const r = ask(picture(160, 120, [[41, 51], [81, 51], [131, 101]]), 160, 120);
    const line = EyesWorkerLineSchema.parse(JSON.parse(r.lines[0]!));
    expect(line).toEqual({ id: 7, event: 'result', faces: [[[41, 51], [81, 51]]] });
  });
  it.skipIf(!python)('nine faces: tooMany with no point', () => {
    const eyes: [number, number][] = [];
    for (let k = 0; k < 9; k++) eyes.push([11 + 30 * k, 21], [21 + 30 * k, 21]);
    const r = ask(picture(300, 60, eyes), 300, 60);
    expect(JSON.parse(r.lines[0]!)).toEqual({ id: 7, event: 'result', tooMany: true });
  });
  it.skipIf(!python)('its bad modes fail the strict worker line (or are not a JSON line at all)', () => {
    const rgb = picture(160, 120, [[41, 51], [81, 51]]);
    for (const mode of ['box', 'score', 'landmark', 'count', 'third', 'nan', 'garbage', 'crash', 'exit-early']) {
      const r = ask(rgb, 160, 120, mode);
      const ok = r.lines.some((l) => { try { return EyesWorkerLineSchema.safeParse(JSON.parse(l)).success; } catch { return false; } });
      expect(ok, mode).toBe(false);
    }
  });
});
