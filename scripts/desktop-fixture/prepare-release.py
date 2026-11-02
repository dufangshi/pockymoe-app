"""Download and verify the public pinned runtime/Web assets into this clone only."""
import hashlib
import os
from pathlib import Path
import platform
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".local" / "desktop-runtime-v0.13.44"
ORIGIN = "https://github.com/dufangshi/remoteCodex/releases/download/v0.13.44/"


def prepare():
    TARGET.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        binary = "remote-codex-win32-x64-msvc-cli.exe"
    elif platform.system() == "Darwin" and platform.machine() == "arm64":
        binary = "remote-codex-darwin-arm64"
    else:
        raise RuntimeError("Supply DESKTOP_E2E_BIN explicitly on other test platforms")
    sums = urllib.request.urlopen(ORIGIN + "SHA256SUMS", timeout=60).read().decode()
    expected = {line.split()[-1].lstrip("*"): line.split()[0] for line in sums.splitlines() if line.strip()}
    for name in [binary, "remote-codex-web.zip"]:
        destination = TARGET / name
        if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != expected[name]:
            partial = destination.with_suffix(".partial")
            with urllib.request.urlopen(ORIGIN + name, timeout=120) as source, partial.open("wb") as output:
                while block := source.read(1024 * 1024):
                    output.write(block)
            if hashlib.sha256(partial.read_bytes()).hexdigest() != expected[name]:
                partial.unlink()
                raise RuntimeError("Public release checksum mismatch: " + name)
            partial.replace(destination)
    (TARGET / binary).chmod(0o700)
    web = TARGET / "web"
    with zipfile.ZipFile(TARGET / "remote-codex-web.zip") as archive:
        for entry in archive.infolist():
            if not (web / entry.filename).resolve().is_relative_to(web.resolve()):
                raise RuntimeError("Unsafe release archive path")
        archive.extractall(web)
    print("Verified public v0.13.44 runtime and Web assets under " + str(TARGET))


if __name__ == "__main__":
    prepare()
