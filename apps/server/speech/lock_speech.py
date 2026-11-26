"""
Regenerates the speech engine's hash-locked requirements files (apps/server/speech/requirements-speech-*.txt).
A maintainer's tool, never run by the server. Needs network access to pypi.org and pip >= 23.

    python3 -I apps/server/speech/lock_speech.py apps/server/speech/speech-constraints.txt apps/server/speech

How the files are made, so a reader can check them:
  1. speech-constraints.txt lists the exact versions of the set that ran `pnpm proof:speech` here (the `pip freeze` of that
     environment: faster-whisper 1.2.1, CTranslate2 4.9.0 and their closure on Linux x86-64, Python 3.13).
  2. For each platform and each CPython minor version below, pip's own resolver is asked for faster-whisper==1.2.1 under those
     constraints, binary wheels only (`pip install --dry-run --ignore-installed --only-binary=:all: --platform ... --python-version
     ... --implementation cp --report`). Nothing is downloaded or installed by this step except package metadata. A Python version
     whose resolution fails is not supported by the file and is listed as such; a version that resolves to a different set of
     versions stops the script (one file = one set of versions).
  2b. pip evaluates markers against the interpreter running it, so every Requires-Dist is walked again with the target's markers
     (os, machine, Python version; no extras): a package pip missed is added (the constraints' version, else the newest release
     with a fitting wheel, from the JSON API) and one only the generating machine needed is dropped; both are listed in the header.
  3. The wheel each resolution chose is recorded with the sha256 pip's report gives (the index's own digest); the same file's
     sha256 and size are read again from PyPI's JSON API (https://pypi.org/pypi/<name>/<version>/json) and must agree.
  4. One line per package: `name==version` and one `--hash=sha256:` per wheel chosen for any supported Python version.
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date

ROOT = "faster-whisper==1.2.1"
PYTHONS = ["3.10", "3.11", "3.12", "3.13", "3.14", "3.15"]
LINUX_TAGS = ["manylinux2014_x86_64", "manylinux_2_17_x86_64"] + [f"manylinux_2_{n}_x86_64" for n in range(18, 36)]
PLATFORMS = {
    "win-amd64": {"tags": ["win_amd64"], "title": "Windows x86-64 (win_amd64)",
                  "env": {"os_name": "nt", "sys_platform": "win32", "platform_system": "Windows", "platform_machine": "AMD64"}},
    "linux-x86_64": {"tags": LINUX_TAGS, "title": "Linux x86-64 (manylinux, glibc 2.35 or newer assumed by the tags offered)",
                     "env": {"os_name": "posix", "sys_platform": "linux", "platform_system": "Linux", "platform_machine": "x86_64"}},
}
# pip evaluates environment markers against the interpreter running it, not against --platform/--python-version (so a Windows-only
# requirement such as tqdm's colorama is missed when this runs on Linux). Step 2b below walks every Requires-Dist again with the
# target's markers and corrects the set; what it adds or drops is printed in the file's header.
from pip._vendor.packaging.markers import Marker  # noqa: E402
from pip._vendor.packaging.requirements import Requirement  # noqa: E402
from pip._vendor.packaging.utils import canonicalize_name  # noqa: E402
from pip._vendor.packaging.version import Version  # noqa: E402


def marker_env(plat, py):
    env = {"platform_python_implementation": "CPython", "implementation_name": "cpython", "python_version": py,
           "python_full_version": f"{py}.0", "implementation_version": f"{py}.0", "platform_release": "", "platform_version": "", "extra": ""}
    env.update(plat["env"])
    return env


def pypi_json(name, version=None):
    url = f"https://pypi.org/pypi/{name}/{version}/json" if version else f"https://pypi.org/pypi/{name}/json"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def wheel_fits(filename, plat, py):
    parts = filename[:-4].split("-")
    pytag, abi, platform = parts[-3], parts[-2], parts[-1]
    minor = int(py.split(".")[1])
    py_ok = any(t in ("py3", f"cp3{minor}") or (t.startswith("cp3") and abi == "abi3" and int(t[3:]) <= minor) for t in pytag.split("."))
    plat_ok = platform == "any" or any(t in plat["tags"] for t in platform.split("."))
    return py_ok and plat_ok


def constraint_pins(constraints):
    pins = {}
    with open(constraints, encoding="utf-8") as f:
        for line in f:
            line = line.split("#")[0].strip()
            if "==" in line:
                n, v = line.split("==")
                pins[canonicalize_name(n)] = v.strip()
    return pins


def correct_markers(picked, requires, plat, py, pins, notes):
    """Walk the closure from the root with the target's markers; add what pip missed, drop what only the host needed."""
    env = marker_env(plat, py)
    need, todo, meta = set(), [canonicalize_name("faster-whisper")], dict(requires)
    while todo:
        n = todo.pop()
        if n in need:
            continue
        need.add(n)
        if n not in picked:
            versions = [pins[n]] if n in pins else sorted(pypi_json(n)["releases"], key=Version, reverse=True)
            for v in versions:
                data = pypi_json(n, v)
                fits = [u for u in data["urls"] if u["packagetype"] == "bdist_wheel" and wheel_fits(u["filename"], plat, py)]
                if fits:
                    u = fits[0]
                    picked[n] = {"version": v, "file": u["filename"], "sha256": u["digests"]["sha256"], "license": ""}
                    meta[n] = data["info"].get("requires_dist") or []
                    notes.add(f"# Python {py}: {n}=={v} added by the marker walk (needed on this platform; pip missed it), wheel and sha256 from PyPI's JSON API")
                    break
            else:
                raise SystemExit(f"{n}: no wheel fits {plat['title']} Python {py}")
        for spec in meta.get(n, []):
            req = Requirement(spec)
            if req.marker is not None and not req.marker.evaluate(env):
                continue
            dep = canonicalize_name(req.name)
            if dep in picked and not req.specifier.contains(picked[dep]["version"], prereleases=True):
                raise SystemExit(f"{dep}=={picked[dep]['version']} does not satisfy {spec} on {plat['title']} Python {py}")
            todo.append(dep)
    for n in sorted(set(picked) - need):
        notes.add(f"# Python {py}: {n} dropped by the marker walk (only the machine running the generator needs it)")
        del picked[n]


def resolve(constraints, tags, py):
    with tempfile.TemporaryDirectory() as tmp:
        report = os.path.join(tmp, "report.json")
        cmd = [sys.executable, "-m", "pip", "install", "--dry-run", "--quiet", "--ignore-installed", "--no-cache-dir",
               "--only-binary=:all:", "--implementation", "cp", "--python-version", py, "--report", report, "-c", constraints, ROOT]
        for t in tags:
            cmd += ["--platform", t]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            return None, (r.stderr.strip().splitlines() or ["(no output)"])[-1]
        with open(report, encoding="utf-8") as f:
            data = json.load(f)
    picked, requires = {}, {}
    for item in data["install"]:
        info = item["download_info"]
        url = info["url"]
        sha = info.get("archive_info", {}).get("hashes", {}).get("sha256")
        if not url.endswith(".whl") or not sha:
            raise SystemExit(f"not a wheel with a sha256: {url}")
        name = canonicalize_name(item["metadata"]["name"])
        requires[name] = item["metadata"].get("requires_dist") or []
        picked[name] = {"version": item["metadata"]["version"], "file": url.rsplit("/", 1)[1], "sha256": sha,
                        "license": item["metadata"].get("license_expression") or item["metadata"].get("license") or ""}
    return (picked, requires), None


def pypi_file(name, version, filename):
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json", timeout=60) as r:
        data = json.load(r)
    for u in data["urls"]:
        if u["filename"] == filename:
            lic = data["info"].get("license_expression") or ""
            if not lic:
                lic = next((c.split(" :: ")[-1] for c in data["info"].get("classifiers", []) if c.startswith("License ::")), "")
            return u["digests"]["sha256"], u["size"], u["packagetype"], lic
    raise SystemExit(f"{filename} is not listed by PyPI for {name} {version}")


def main(constraints, out_dir):
    pins = constraint_pins(constraints)
    for key, plat in PLATFORMS.items():
        sets, supported, refused, notes = {}, [], {}, set()
        for py in PYTHONS:
            res, err = resolve(constraints, plat["tags"], py)
            if res is None:
                refused[py] = err
                continue
            picked, requires = res
            correct_markers(picked, requires, plat, py, pins, notes)
            versions = {n: p["version"] for n, p in picked.items()}
            if sets and versions != next(iter(sets.values())):
                raise SystemExit(f"{key}: Python {py} resolves to another set of versions; split the file")
            sets[py] = versions
            supported.append((py, picked))
        if not supported:
            raise SystemExit(f"{key}: no Python version resolves")
        files = {}
        for py, picked in supported:
            for n, p in picked.items():
                files.setdefault(n, {"version": p["version"], "wheels": {}})["wheels"][p["file"]] = p["sha256"]
        lines, total, sizes = [], {}, {}
        for n in sorted(files):
            f = files[n]
            hashes, lic = [], ""
            for filename, sha in sorted(f["wheels"].items()):
                api_sha, size, kind, lic = pypi_file(n, f["version"], filename)
                if api_sha != sha or kind != "bdist_wheel":
                    raise SystemExit(f"{filename}: pip's report and PyPI's JSON API disagree")
                hashes.append((filename, sha, size))
                sizes[filename] = size
            lines.append(f"# {n}: {lic or 'licence not stated in PyPI metadata'}")
            for filename, sha, size in hashes:
                lines.append(f"#   {filename} ({size} bytes)")
            lines.append(f"{n}=={f['version']} " + " ".join(f"--hash=sha256:{sha}" for _, sha, _ in hashes))
            lines.append("")
        for py, picked in supported:
            total[py] = sum(sizes[p["file"]] for p in picked.values())
        lo, hi = supported[0][0], supported[-1][0]
        head = [
            f"# Speech engine («מנוע הדיבור») - {plat['title']}. Generated {date.today().isoformat()} by apps/server/speech/lock_speech.py",
            f"# from apps/server/speech/speech-constraints.txt (the versions of the set that ran `pnpm proof:speech` here). Root: {ROOT}.",
            "# Every package was chosen by pip's own resolver (pip install --dry-run --only-binary=:all: --platform/--python-version",
            "# --report) and each wheel's sha256 is the index's digest from that report, checked against PyPI's JSON API. Regenerate with:",
            "#   python3 -I apps/server/speech/lock_speech.py apps/server/speech/speech-constraints.txt apps/server/speech",
            "# Installed by the editor itself (apps/server/src/speechEngine) into <data dir>/engines/speech/venv with:",
            "#   python -m pip install --require-hashes --only-binary=:all: -r <this file>",
            f"# SUPPORTED-PYTHON: {lo} {hi}",
        ]
        for py in PYTHONS:
            if py in refused:
                head.append(f"# Python {py}: not supported by this set ({refused[py][:160]})")
        for py, _ in supported:
            head.append(f"# DOWNLOAD-BYTES {py}: {total[py]}")
        head.extend(sorted(notes))
        head.append("# Licence after each name is what PyPI's metadata says; it is not a legal review.")
        head.append("")
        path = os.path.join(out_dir, f"requirements-speech-{key}.txt")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(head + lines))
        print(path, "pythons", [p for p, _ in supported], "bytes", total)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
