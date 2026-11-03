#!/usr/bin/env python3
"""Update only the installed Stage-2 profile API on port 8002, with automatic rollback.

Production (8000), Stage 1 (8001), Nginx, the unit file and the database are not touched.
"""
import base64
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib

PAYLOAD='__PAYLOAD_BASE64__'
FILES=__FILE_NAMES__
VERSION='__API_VERSION__'
BASE=Path('/opt/sonnenpfad-profile-test')
TARGET=BASE/'api-stage2'
UNIT=Path('/etc/systemd/system/sonnenpfad-profile-v2.service')
UNIT_NAME='sonnenpfad-profile-v2.service'
UNIT_MARKER='WorkingDirectory=/opt/sonnenpfad-profile-test/api-stage2'
# The in-memory engine needs more room than the SQL-only preview; only these two Stage-2 limits change.
UNIT_LIMITS={'MemoryMax':'1G','CPUQuota':'100%'}


def unit_with_limits(text):
    for key,value in UNIT_LIMITS.items():
        text,count=re.subn(r'(?m)^'+key+r'=.*$',key+'='+value,text)
        if count!=1:raise ValueError('Unit ohne eindeutige Zeile '+key+'. Nichts geaendert.')
    return text


def run(arguments,**kwargs):
    return subprocess.run(arguments,check=True,**kwargs)


def safe_existing(path,folder=False):
    if path.is_symlink() or not (path.is_dir() if folder else path.is_file()):
        raise ValueError('Fehlender oder unerwarteter Pfad: '+str(path))


def payload():
    files={name:base64.b64decode(data,validate=True) for name,data in json.loads(zlib.decompress(base64.b64decode(PAYLOAD,validate=True))).items()}
    if sorted(files)!=sorted(FILES):
        raise ValueError('Unerwarteter Paketinhalt')
    return files


def health_version():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8002/health',timeout=2) as response:
            data=json.load(response)
            return data.get('api_version') if data.get('production_ready') is False else None
    except (OSError,ValueError,urllib.error.URLError):
        return None


def wait_for(version,seconds=120):
    for _ in range(seconds):
        if health_version()==version:return True
        time.sleep(1)
    return False


def update():
    if os.geteuid()!=0:
        raise SystemExit('Bitte mit sudo /usr/bin/python3 ausfuehren.')
    safe_existing(BASE,True);safe_existing(TARGET,True);safe_existing(UNIT)
    unit_before=UNIT.read_text()
    if UNIT_MARKER not in unit_before:raise ValueError('Unerwartete Unit. Nichts geaendert.')
    unit_after=unit_with_limits(unit_before)
    try:pwd.getpwnam('sonnenpfad_api')
    except KeyError:raise ValueError('Benutzer sonnenpfad_api fehlt. Nichts geaendert.')
    files=payload()
    if unit_after==unit_before and all((TARGET/name).is_file() and (TARGET/name).read_bytes()==data for name,data in files.items()) and health_version()==VERSION:
        print('Stufe 2 ist bereits auf diesem Stand und erreichbar. Keine Aenderung.',flush=True)
        return
    stamp=time.strftime('%Y%m%d-%H%M%S');backup=BASE/('api-stage2.prev-'+stamp)
    if backup.exists():raise ValueError('Sicherungsziel existiert bereits. Nichts geaendert.')
    staged=Path(tempfile.mkdtemp(prefix='.profile-v2-update-',dir=BASE))
    try:
        staged.chmod(0o755)
        for name,data in files.items():
            path=staged/name;path.write_bytes(data);path.chmod(0o644)
        print('Pruefe die neue Fassung im Staging.',flush=True)
        run(['sudo','-u','sonnenpfad_api','/usr/bin/python3','-B','-m','unittest','-v','test_adapter','test_engine','test_shadows'],cwd=staged,timeout=120)
        TARGET.rename(backup)
        staged.rename(TARGET);staged=None
        print('Starte nur sonnenpfad-profile-v2.service neu. Sicherung: '+str(backup),flush=True)
        try:
            if unit_after!=unit_before:
                UNIT.write_text(unit_after);run(['systemctl','daemon-reload'])
                print('Stufe-2-Unit: '+', '.join(k+'='+v for k,v in UNIT_LIMITS.items()),flush=True)
            run(['systemctl','restart',UNIT_NAME])
            if not wait_for(VERSION):raise ValueError('Neue Fassung wurde nicht erreichbar.')
            run(['sudo','-u','sonnenpfad_api','/usr/bin/python3','-B','-u','smoke_v2.py'],cwd=TARGET,timeout=300)
        except Exception:
            TARGET.rename(BASE/('api-stage2.failed-'+stamp));backup.rename(TARGET)
            if UNIT.read_text()!=unit_before:
                UNIT.write_text(unit_before);subprocess.run(['systemctl','daemon-reload'],check=False)
            subprocess.run(['systemctl','restart',UNIT_NAME],check=False)
            print('Zurueckgerollt: vorherige Stufe 2 wieder aktiv. Fehlversion liegt in api-stage2.failed-'+stamp,flush=True)
            raise
        print('UPDATE_V2_PASS: Stufe 2 aktualisiert ('+VERSION+'). Produktion, Stufe 1, Nginx und Datenbank unveraendert.',flush=True)
    finally:
        if staged is not None:shutil.rmtree(staged)


if __name__=='__main__':
    try:update()
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        print('UPDATE_V2_STOP: '+str(error),file=sys.stderr,flush=True);sys.exit(1)
