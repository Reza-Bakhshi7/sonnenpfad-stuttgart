#!/usr/bin/env python3
"""Bundle the original atlas SVG files as data URLs for reliable static delivery."""

import base64
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dist" / "icons" / "poi"
OUTPUT = ROOT / "dist" / "poi-icons.json"
NAMES = [
    "Signalized_Crossings.svg", "Elevators.svg", "Ramps.svg", "Escalators.svg",
    "Stairs.svg", "Barriers_and_Gates.svg", "Lowered_Curbs.svg", "Raised_Curbs.svg",
    "Benches.svg", "Shelters.svg",
]


payload = {
    name: "data:image/svg+xml;base64," + base64.b64encode((SOURCE / name).read_bytes()).decode("ascii")
    for name in NAMES
}
OUTPUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
print(f"Bundled {len(payload)} atlas POI icons in {OUTPUT}")
