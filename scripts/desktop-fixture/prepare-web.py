"""Build the Windows acceptance Web from pinned public sources in this clone."""
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".local" / "desktop-web-source"
WEB_SHA = "aafec59058e29d4248605dea30d4ff2e17c29ad8"
UI_SHA = "7e7f38deb9f0257f78704a7797403a76d72f0ec6"


def run(args, cwd):
    subprocess.run(args, cwd=cwd, check=True)


def checkout(destination, repository, sha):
    destination.mkdir(parents=True, exist_ok=True)
    if not (destination / ".git").is_dir():
        run(["git", "init", str(destination)], ROOT)
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"], cwd=destination,
    ).strip()
    if dirty:
        raise RuntimeError("Refusing to overwrite edited fixture sources: " + str(destination))
    run(["git", "fetch", "--depth=1", repository, sha], destination)
    run(["git", "checkout", "--detach", sha], destination)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=destination, text=True).strip()
    if actual != sha:
        raise RuntimeError("Fixture source revision mismatch")


def prepare():
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise RuntimeError("Install Node 24 and pnpm 10 before preparing the Web fixture")
    source = TARGET / "pockymoe"
    ui = source / "pockymoe-thread-ui"
    provenance = TARGET / "provenance.json"
    provenance.unlink(missing_ok=True)
    checkout(source, "https://github.com/dufangshi/pockymoe.git", WEB_SHA)
    if (source / "thread-ui.sha").read_text(encoding="utf-8").strip() != UI_SHA:
        raise RuntimeError("Public Web and shared UI pins disagree")
    checkout(ui, "https://github.com/dufangshi/pockymoe-thread-ui-rust.git", UI_SHA)
    run([pnpm, "install", "--frozen-lockfile"], ui)
    run([pnpm, "--filter", "@pockymoe/thread-ui", "build"], ui)
    run([pnpm, "--filter", "@pockymoe/supervisor-web...", "install", "--frozen-lockfile"], source)
    # Runtime hosting uses relative assets and the local relay's own API origin.
    # Do not run the root build (Rust) or the Pages build (compiled relay URL).
    run([pnpm, "--filter", "@pockymoe/supervisor-web", "build"], source)
    dist = source / "apps" / "supervisor-web" / "dist"
    if not (dist / "index.html").is_file():
        raise RuntimeError("Pinned Web build did not produce index.html")
    provenance.write_text(json.dumps({
        "webSha": WEB_SHA, "threadUiSha": UI_SHA, "runtimeVersion": "v0.13.44",
        "webDist": str(dist), "buildMode": "runtime",
    }, indent=2) + "\n", encoding="utf-8")
    print("Built pinned public Web; safe provenance: " + str(provenance))


if __name__ == "__main__":
    prepare()
