#!/usr/bin/env python3
"""
TEST FAKE (labelled; used only by apps/server/src/localtools.test.ts). It is NOT deep-filter and removes no noise. It accepts the
command line the runner gives the real engine (deep-filter 0.5.6: -D -m MODEL --atten-lim-db DB --output-dir OUTDIR FILE) and writes OUTDIR/<name of
FILE>, so the runner's padding, trimming and validation can be tested without the engine or its model.

Like the real engine as measured by the lead (2026-11-17), its pass-through output is 1440 samples shorter than its input.
Behaviour is chosen with environment variables:
  PF_FAKE_DF_MODE      copy (default) | shift (10 ms later) | silence | truncate (half length) | nan (a non-finite sample) | slow | fail
  PF_FAKE_DF_PIDFILE   if set, a processing run (not --version) writes its pid there when it starts
  PF_FAKE_DF_ARGSFILE  if set, a processing run writes its arguments there as JSON
"""
import json
import os
import struct
import sys
import time
import wave

SHORTER = 1440


def main():
    argv = sys.argv[1:]
    if argv == ["--version"]:
        print("deep_filter 0.5.6 (TEST FAKE)")
        return 0
    if os.environ.get("PF_FAKE_DF_PIDFILE"):
        with open(os.environ["PF_FAKE_DF_PIDFILE"], "w") as f:
            f.write(str(os.getpid()))
    if os.environ.get("PF_FAKE_DF_ARGSFILE"):
        with open(os.environ["PF_FAKE_DF_ARGSFILE"], "w") as f:
            json.dump(argv, f)
    mode = os.environ.get("PF_FAKE_DF_MODE", "copy")
    if mode == "fail":
        sys.stderr.write("fake deep-filter: simulated engine failure\n")
        return 3
    out_dir, files, i = "out", [], 0
    while i < len(argv):
        a = argv[i]
        if a in ("-m", "--model", "-a", "--atten-lim-db", "--pf-beta", "--min-db-thresh", "--max-db-erb-thresh", "--max-db-df-thresh", "--reduce-mask"):
            i += 2
            continue
        if a in ("-o", "--output-dir"):
            out_dir = argv[i + 1]
            i += 2
            continue
        if a in ("-D", "--compensate-delay", "--pf", "-v", "--verbose"):
            i += 1
            continue
        if a.startswith("-"):  # like the real engine's argument parser: an option it does not know is an error
            sys.stderr.write(f"error: unexpected argument '{a}' found\n")
            return 2
        files.append(a)
        i += 1
    if mode == "slow":
        time.sleep(30)
    os.makedirs(out_dir, exist_ok=True)
    for path in files:
        with wave.open(path, "rb") as w:
            rate, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            data = w.readframes(n)
        if width != 2:
            sys.stderr.write("fake deep-filter: expects 16-bit PCM\n")
            return 2
        samples = list(struct.unpack(f"<{n * ch}h", data))
        keep = max(0, n - SHORTER)
        if mode == "shift":
            d = rate // 100 * ch
            samples = ([0] * d + samples)[: keep * ch]
        elif mode == "silence":
            samples = [0] * (keep * ch)
        elif mode == "truncate":
            samples = samples[: (n // 2) * ch]
        else:
            samples = samples[: keep * ch]
        target = os.path.join(out_dir, os.path.basename(path))
        if mode == "nan":
            floats = [s / 32768.0 for s in samples[: keep * ch]]
            if floats:
                floats[len(floats) // 2] = float("nan")
            body = struct.pack(f"<{len(floats)}f", *floats)
            fmt = struct.pack("<HHIIHH", 3, ch, rate, rate * ch * 4, ch * 4, 32)
            with open(target, "wb") as f:
                f.write(b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(body)) + b"WAVE")
                f.write(b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(body)) + body)
            continue
        with wave.open(target, "wb") as w:
            w.setnchannels(ch)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return 0


if __name__ == "__main__":
    sys.exit(main())
