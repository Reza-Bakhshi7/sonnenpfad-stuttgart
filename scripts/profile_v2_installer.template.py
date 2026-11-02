#!/usr/bin/env python3
"""Install only the separate local Sonnenpfad profile API on port 8002."""
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib

PAYLOAD='__PAYLOAD_BASE64__'
CORE_HASHES=__CORE_HASHES__
BASE=Path('/opt/sonnenpfad-profile-test')
ORIGINAL=BASE/'api-stage1'
TARGET=BASE/'api-stage2'
UNIT=Path('/etc/systemd/system/sonnenpfad-profile-v2.service')
UNIT_NAME='sonnenpfad-profile-v2.service'
UNIT_CONTENT='''[Unit]
Description=Sonnenpfad versioned profile API (local preview)
After=network.target postgresql.service

[Service]
Type=simple
User=sonnenpfad_api
Group=sonnenpfad_api
WorkingDirectory=/opt/sonnenpfad-profile-test/api-stage2
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 -B -m uvicorn app:app --host 127.0.0.1 --port 8002 --workers 1 --no-access-log --no-proxy-headers --limit-concurrency 8 --timeout-keep-alive 5 --backlog 16
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=512M
CPUQuota=50%
UMask=0077

[Install]
WantedBy=multi-user.target
'''


def run(arguments,**kwargs):
    return subprocess.run(arguments,check=True,**kwargs)


def safe_existing(path,folder=False):
    if path.is_symlink() or not (path.is_dir() if folder else path.is_file()):
        raise ValueError('Fehlender oder unerwarteter Pfad: '+str(path))


def expected_files():
    payload={name:base64.b64decode(data,validate=True) for name,data in json.loads(zlib.decompress(base64.b64decode(PAYLOAD,validate=True))).items()}
    if set(payload)!={'app.py','test_adapter.py','smoke_v2.py','inspect_sources.py','README.md'}:
        raise ValueError('Unerwarteter Paketinhalt')
    for name,digest in CORE_HASHES.items():
        source=ORIGINAL/name;safe_existing(source)
        data=source.read_bytes()
        if hashlib.sha256(data).hexdigest()!=digest:
            raise ValueError('Quellstand weicht ab: '+name+'. Nichts ueberschrieben.')
        payload[name]=data
    return payload


def verify_directory(directory,files):
    safe_existing(directory,True)
    for name,data in files.items():
        path=directory/name;safe_existing(path)
        if path.read_bytes()!=data:
            raise ValueError('Vorhandene Stufe 2 weicht ab: '+name+'. Nichts ueberschrieben.')


def health_ok():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8002/health',timeout=2) as response:
            data=json.load(response)
            return data.get('api_version')=='0.3.0-preview.1' and data.get('production_ready') is False
    except (OSError,ValueError,urllib.error.URLError):return False


def install():
    if os.geteuid()!=0:
        raise SystemExit('Bitte mit sudo /usr/bin/python3 ausfuehren.')
    safe_existing(BASE,True);safe_existing(ORIGINAL,True)
    pwd.getpwnam('sonnenpfad_api')
    files=expected_files()
    if UNIT.is_symlink():raise ValueError('Unerwarteter Unit-Symlink')
    if UNIT.exists() and UNIT.read_text()!=UNIT_CONTENT:raise ValueError('Vorhandene Unit weicht ab. Nichts ueberschrieben.')
    if TARGET.exists():verify_directory(TARGET,files)
    if UNIT.exists() and TARGET.exists() and health_ok():
        print('Stufe 2 ist bereits installiert und erreichbar. Keine Aenderung.',flush=True)
        return
    with socket.socket() as probe:
        try:probe.bind(('127.0.0.1',8002))
        except OSError:raise ValueError('Port 8002 ist bereits belegt. Keine fremden Dienste beendet.')
    print('Pruefe vorhandene Bibliotheken; es wird nichts installiert.',flush=True)
    run(['sudo','-u','sonnenpfad_api','/usr/bin/python3','-B','-c','import fastapi,uvicorn,psycopg2; print("Vorhandene FastAPI/Uvicorn/PostgreSQL-Bibliotheken: OK")'])
    staged=None
    try:
        if TARGET.exists():staged=TARGET
        else:
            staged=Path(tempfile.mkdtemp(prefix='.profile-v2-',dir=BASE));staged.chmod(0o755)
            for name,data in files.items():
                path=staged/name;path.write_bytes(data);path.chmod(0o644)
        print('Pruefe nur den neuen API-Transport.',flush=True)
        run(['sudo','-u','sonnenpfad_api','/usr/bin/python3','-B','-m','unittest','-v','test_adapter'],cwd=staged,timeout=45)
        if staged!=TARGET:
            if TARGET.exists():raise ValueError('Ziel wurde waehrend der Vorbereitung angelegt. Abbruch.')
            staged.rename(TARGET);staged=None
        if not UNIT.exists():
            fd=os.open(UNIT,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
            with os.fdopen(fd,'w') as output:output.write(UNIT_CONTENT)
        print('Starte nur sonnenpfad-profile-v2.service auf 127.0.0.1:8002.',flush=True)
        run(['systemctl','daemon-reload'])
        run(['systemctl','enable','--now',UNIT_NAME])
        try:
            for _ in range(15):
                if health_ok():break
                time.sleep(1)
            else:raise ValueError('Neuer Dienst wurde nicht erreichbar.')
            print('Pruefe die neue Schnittstelle mit drei Profilen.',flush=True)
            run(['sudo','-u','sonnenpfad_api','/usr/bin/python3','-B','-u','smoke_v2.py'],cwd=TARGET,timeout=150)
        except Exception:
            subprocess.run(['systemctl','disable','--now',UNIT_NAME],check=False)
            print('Nur der neue Dienst wurde gestoppt. Dateien bleiben fuer die Diagnose erhalten.',flush=True)
            raise
        print('Lese Spaltennamen fuer den weiteren Profilausbau.',flush=True)
        inventory=subprocess.run(['sudo','-u','sonnenpfad_api','/usr/bin/python3','-B','inspect_sources.py'],cwd=TARGET,timeout=20)
        if inventory.returncode:print('Spalteninventar nicht verfuegbar; Ausgabe melden.',flush=True)
        print('INSTALL_V2_PASS: lokaler Vorschau-Dienst eingerichtet. Produktion, Nginx und Datenbankschema unveraendert.',flush=True)
    finally:
        if staged is not None and staged!=TARGET:
            # Only this invocation's fresh staging directory is removed.
            shutil.rmtree(staged)


if __name__=='__main__':
    try:install()
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        print('INSTALL_V2_STOP: '+str(error),file=sys.stderr,flush=True);sys.exit(1)
