#!/usr/bin/env python3
"""Classify a client diff into the smallest safe CI tier.

The classifier is deliberately conservative: an unknown path is a desktop
change, and a package file is a version-only change only when its allowed
version fields are the only changed fields.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess


VERSION_FILES = {
    "desktop/package.json",
    "android/app/build.gradle.kts",
}
VERSION_PATTERNS = {
    "desktop/package.json": re.compile(r'^\s*"version"\s*:\s*"[^"]+",?\s*$'),
    "android/app/build.gradle.kts": re.compile(
        r'^\s*(?:versionCode\s*=\s*\d+|versionName\s*=\s*"[^"]+")\s*$'
    ),
}


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, text=True,
                          stdout=subprocess.PIPE, timeout=30).stdout


def version_fields(path: str, content: str):
    if path.endswith("package.json"):
        value = json.loads(content)
        version = value.pop("version")
        if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise ValueError("Invalid version")
        return value, version
    # Normalize only complete assignment values; retain every other byte.
    values = {}
    for field, pattern in [("versionName", r'versionName\s*=\s*"(\d+\.\d+\.\d+)"'),
                           ("versionCode", r'versionCode\s*=\s*(\d+)')]:
        matches = list(re.finditer(pattern, content))
        if len(matches) != 1:
            raise ValueError("Ambiguous version assignment")
        values[field] = matches[0].group(1)
        content = re.sub(pattern, field + " = <version>", content)
    return content, values


def is_version_only(base: str, head: str, paths: list[str]) -> bool:
    if not paths or not set(paths).issubset(VERSION_FILES):
        return False
    try:
        for path in paths:
            old, old_version = version_fields(path, git("show", f"{base}:{path}"))
            new, new_version = version_fields(path, git("show", f"{head}:{path}"))
            if old != new or old_version == new_version:
                return False
        return True
    except (ValueError, KeyError, subprocess.CalledProcessError):
        return False


def classify(paths: list[str], version_only: bool, full: bool) -> dict[str, object]:
    desktop = pet = updater = media = android = False
    for path in paths:
        if path.startswith(("docs/", "ios/")) or path.endswith(".md"):
            continue
        if path.startswith("android/") or path == "scripts/e2e-android.sh":
            android = True
        elif path.startswith(("desktop/src/pet/", "desktop/test/petWork", "desktop/test/petMedia")):
            pet = True
            media |= "media" in path.lower()
        elif path.startswith(("desktop/src/main/update", "desktop/test/update")):
            desktop = updater = True
        elif path.startswith(("desktop/src/local/", "desktop/src/renderer/", "desktop/src/shared/")):
            desktop = True
        else:
            # Unmapped scripts, dependencies, workflow and main-process changes
            # may affect installation as well as desktop behavior.
            desktop = updater = media = True
    if version_only and not full:
        desktop = pet = updater = media = android = False
    if full:
        desktop = pet = updater = media = android = True
    windows = desktop or pet
    matrix = [{"scale": scale, "locale": locale}
              for scale in (["1", "1.5"] if full else ["1"])
              for locale in (["en-US", "zh-CN"] if full else ["en-US"])] if windows else []
    mode = "full" if full else "desktop-pet" if desktop and pet else "pet" if pet else "desktop"
    tier = "full" if full else "version-only" if version_only else mode if windows else "android" if android else "docs"
    return {"tier": tier, "mode": mode, "version_only": version_only and not full,
            "windows": windows, "windows_matrix": matrix,
            "unit": windows or updater or media, "updater": updater,
            "pet_media": media, "android": android}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("head")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--assert-version-only", action="store_true")
    args = parser.parse_args()
    paths = git("diff", "--name-only", "--no-renames", f"{args.base}...{args.head}").splitlines()
    version = is_version_only(args.base, args.head, paths)
    if args.assert_version_only and not version:
        raise SystemExit("version-only fast path rejected: files or fields outside the allowlist changed")
    print(json.dumps(classify(paths, version, args.full), separators=(",", ":")))


if __name__ == "__main__":
    main()
