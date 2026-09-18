"""Create browser-ready, size-bounded JSON chunks from prepared atlas data."""

from __future__ import annotations

import json
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "build_data"
TARGET = ROOT / "dist" / "data"
MAX_BYTES = 180_000


def write_json(path: pathlib.Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def chunk_array(name: str, values: list[object]) -> list[str]:
    files: list[str] = []
    chunk: list[object] = []
    size = 2
    for value in values:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        additional = len(encoded.encode("utf-8")) + (1 if chunk else 0)
        if chunk and size + additional > MAX_BYTES:
            filename = f"{name}-{len(files):03d}.json"
            write_json(TARGET / filename, chunk)
            files.append(filename)
            chunk = []
            size = 2
        chunk.append(value)
        size += additional
    if chunk:
        filename = f"{name}-{len(files):03d}.json"
        write_json(TARGET / filename, chunk)
        files.append(filename)
    return files


def main() -> None:
    meta = json.loads((SOURCE / "meta.json").read_text())
    network = json.loads((SOURCE / "network.json").read_text())
    obstacles = json.loads((SOURCE / "obstacles.json").read_text())

    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir(parents=True)
    write_json(TARGET / "meta.json", meta)
    manifest = {
        "version": 1,
        "meta": "meta.json",
        "nodes": chunk_array("nodes", network["nodes"]),
        "edges": chunk_array("edges", network["edges"]),
        "buildings": chunk_array("buildings", obstacles["buildings"]),
        "trees": chunk_array("trees", obstacles["trees"]),
    }
    write_json(TARGET / "manifest.json", manifest)
    print(json.dumps({key: len(value) for key, value in manifest.items() if isinstance(value, list)}))


if __name__ == "__main__":
    main()
