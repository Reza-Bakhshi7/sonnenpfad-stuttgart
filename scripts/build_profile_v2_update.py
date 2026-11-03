"""Build a single-file Stage-2 updater; running this builder changes no server."""
import base64
import json
from pathlib import Path
import re
import zlib

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'services/profile-api-v1'
TEMPLATE=ROOT/'scripts/profile_v2_update.template.py'
OUTPUT=ROOT/'build/update_sonnenpfad_profile_v2.py'
NAMES=['app.py','test_adapter.py','smoke_v2.py','inspect_sources.py','README.md',
       'profile_api.py','routing_core.py','sonnenpfad_profile_rules.py','gap_supplement.json',
       'engine.py','test_engine.py','poi_points.json','shadows.py','test_shadows.py','shade_fixture.json','shade_tiles.zip']


def main():
    content={name:base64.b64encode((SOURCE/name).read_bytes()).decode() for name in NAMES}
    packed=base64.b64encode(zlib.compress(json.dumps(content,sort_keys=True).encode(),9)).decode()
    version=re.search(r"^VERSION = '([^']+)'",(SOURCE/'app.py').read_text(encoding='utf-8'),re.M).group(1)
    output=(TEMPLATE.read_text(encoding='utf-8').replace('__PAYLOAD_BASE64__',packed)
            .replace('__FILE_NAMES__',repr(NAMES)).replace('__API_VERSION__',version))
    compile(output,str(OUTPUT),'exec')
    OUTPUT.parent.mkdir(parents=True,exist_ok=True);OUTPUT.write_text(output,encoding='utf-8',newline='\n')
    print(str(OUTPUT))


if __name__=='__main__':main()
