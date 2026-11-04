#!/usr/bin/env python3
"""Display every quarantined test and expiration without hiding failures."""
import argparse
import datetime
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--summary", type=Path)
args = parser.parse_args()
entries = json.loads((Path(__file__).resolve().parent.parent / "desktop/test/quarantine.json").read_text())
lines = ["## Quarantine (non-required)", "", "No global retries; failures and expiration remain visible.", "", "| Test | Reason | Added | Expires |", "|---|---|---|---|"]
for entry in entries:
    added = datetime.date.fromisoformat(entry["added"])
    expires = datetime.date.fromisoformat(entry["expires"])
    if (expires - added).days != 7:
        raise SystemExit("Quarantine entries must expire exactly seven days after addition")
    if expires <= datetime.datetime.now(datetime.timezone.utc).date():
        lines.append(f"::warning::Expired quarantine: {entry['test']}")
    lines.append(f"| {entry['test']} | {entry['reason']} | {added} | {expires} |")
text = "\n".join(lines) + "\n"
print(text)
if args.summary:
    with args.summary.open("a") as out:
        out.write(text)
