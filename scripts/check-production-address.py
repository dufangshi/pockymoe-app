#!/usr/bin/env python3
"""Scan tracked files or explicit build directories; never print matched content."""
import hashlib
from pathlib import Path
import re
import subprocess
import sys

FORBIDDEN_SHA256 = "7df74e492c2d8019eedb0cb61b246f59866a45c8bc1f240214898db8d90f7ca6"
FORBIDDEN_LENGTH = 9


def forbidden(data):
    # Sliding windows catch the fragment inside longer labels and identifiers.
    for match in re.finditer(rb"[A-Za-z0-9-]{9,}", data):
        word = match.group()
        for index in range(len(word) - FORBIDDEN_LENGTH + 1):
            if hashlib.sha256(word[index:index + FORBIDDEN_LENGTH]).hexdigest() == FORBIDDEN_SHA256:
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
    hits = [str(path) for path in paths if path.is_file() and forbidden(path.read_bytes())]
    for path in hits:
        print(f"Production address found: {path}")
    print(f"Production address scan: {len(hits)} hit files")
    return bool(hits)


if __name__ == "__main__":
    sys.exit(main())
