#!/usr/bin/env python3
"""Scan tracked files or explicit build directories; never print matched content."""
import hashlib
import os
import shutil
from functools import lru_cache
from pathlib import Path
import re
import subprocess
import sys

FORBIDDEN_SHA256 = "7df74e492c2d8019eedb0cb61b246f59866a45c8bc1f240214898db8d90f7ca6"
FORBIDDEN_LENGTH = 9


@lru_cache(maxsize=65536)
def forbidden_word(word):
    return any(hashlib.sha256(word[index:index + FORBIDDEN_LENGTH]).hexdigest() == FORBIDDEN_SHA256
               for index in range(len(word) - FORBIDDEN_LENGTH + 1))


def private_identifiers(root):
    """Read local identities in memory only; never emit their values."""
    values = []
    for field in ("user.email", "user.name"):
        result = subprocess.run(["git", "config", "--get", field], cwd=root, capture_output=True)
        value = result.stdout.strip()
        if value and (field == "user.email" or b" " in value):
            values.append(value)
    if sys.platform == "darwin" and shutil.which("security"):
        result = subprocess.run(["security", "find-identity", "-v", "-p", "codesigning"], capture_output=True)
        for identity in re.findall(rb'"([^"\n]+)"', result.stdout):
            values.append(identity)
            values.extend(re.findall(rb"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", identity))
    extra = os.environ.get("POCKYMOE_PRIVATE_IDENTIFIERS_FILE")
    if extra:
        values.extend(line.strip() for line in Path(extra).read_bytes().splitlines() if line.strip())
    return tuple(set(value.lower() for value in values))


def forbidden(data):
    # Sliding windows catch the fragment inside longer labels and identifiers.
    for match in re.finditer(rb"[A-Za-z0-9-]{9,}", data):
        if forbidden_word(match.group()):
            return True
    return False


def main():
    root = Path(__file__).resolve().parent.parent
    if sys.argv[1:]:
        paths = []
        for name in sys.argv[1:]:
            path = Path(name)
            if not path.exists():
                raise SystemExit(f"Missing scan input: {path}")
            paths.extend(sorted(path.rglob("*")) if path.is_dir() else [path])
    else:
        paths = [root / name.decode() for name in subprocess.check_output(
            ["git", "ls-files", "-z"], cwd=root).split(b"\0") if name]
    identifiers = private_identifiers(root)
    hits = []
    for path in paths:
        if not path.is_file():
            continue
        data = path.read_bytes()
        if forbidden(data) or any(value in data.lower() or value.decode(errors="ignore").encode("utf-16le") in data.lower() for value in identifiers):
            hits.append(str(path))
    for path in hits:
        print(f"Private address/identifier found: {path}")
    print(f"Private address/identifier scan: {len(hits)} hit files")
    return bool(hits)


if __name__ == "__main__":
    sys.exit(main())
