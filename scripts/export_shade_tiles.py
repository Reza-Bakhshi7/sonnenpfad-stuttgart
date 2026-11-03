"""Pack the city shade tiles (buildings, trees) for the Stage-2 shadow model.

  python scripts/export_shade_tiles.py   writes services/profile-api-v1/shade_tiles.zip
Members: meta.json (local frame, grid, source date) and one <tile>.json per shade tile, unchanged.
"""
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CITY = ROOT / 'dist/city'
OUTPUT = ROOT / 'services/profile-api-v1/shade_tiles.zip'


def main():
    manifest = json.loads((CITY / 'manifest.json').read_text(encoding='utf-8'))
    tiles = {key: tile['shadeFile'] for key, tile in manifest['obstacles']['tiles'].items() if tile.get('shadeFile')}
    meta = dict(origin=manifest['origin'], scale=manifest['scale'], grid=manifest['obstacles']['grid'],
                sourceDate=manifest.get('sourceDate'), tiles=sorted(tiles))
    with zipfile.ZipFile(OUTPUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(zipfile.ZipInfo('meta.json', (2026, 1, 1, 0, 0, 0)), json.dumps(meta))
        for key in sorted(tiles):
            # Fixed timestamps keep the archive reproducible.
            archive.writestr(zipfile.ZipInfo(key + '.json', (2026, 1, 1, 0, 0, 0)), (CITY / tiles[key]).read_bytes(), zipfile.ZIP_DEFLATED)
    print(f'{len(tiles)} tiles, {OUTPUT.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
