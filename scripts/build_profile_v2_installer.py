"""Build a single-file installer; running this builder changes no server."""
import base64
import hashlib
import json
from pathlib import Path
import zlib

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'services/profile-api-v1'
TEMPLATE=ROOT/'scripts/profile_v2_installer.template.py'
OUTPUT=ROOT/'build/install_sonnenpfad_profile_v2.py'

def main():
    names=['app.py','test_adapter.py','smoke_v2.py','inspect_sources.py','README.md']
    content={name:base64.b64encode((SOURCE/name).read_bytes()).decode() for name in names}
    packed=base64.b64encode(zlib.compress(json.dumps(content,sort_keys=True).encode(),9)).decode()
    core_names=['profile_api.py','routing_core.py','sonnenpfad_profile_rules.py']
    hashes={name:hashlib.sha256((SOURCE/name).read_bytes()).hexdigest() for name in core_names}
    output=TEMPLATE.read_text().replace('__PAYLOAD_BASE64__',packed).replace('__CORE_HASHES__',repr(hashes))
    compile(output,str(OUTPUT),'exec')
    OUTPUT.parent.mkdir(parents=True,exist_ok=True);OUTPUT.write_text(output)
    print(str(OUTPUT))

if __name__=='__main__':main()
