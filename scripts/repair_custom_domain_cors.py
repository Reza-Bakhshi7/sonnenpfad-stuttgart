"""Run with sudo on Oracle. Repair one explicit Nginx CORS map, or leave it untouched."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.request

OLD = 'https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'
NEW = 'https://sonnenpfad-stuttgart.de'
ROUTE = ('https://138.2.184.1/route?start_lon=9.18&start_lat=48.78'
         '&end_lon=9.19&end_lat=48.77&profile=shortest&max_snap_m=50&include_segments=true')


def updated_map(text):
    """Accept explicit literal origins only; never widen an origin regex or wildcard."""
    maps = re.finditer(r'(?m)^\s*map\s+\$http_origin\s+\$\w+\s*\{\s*\n(?P<body>[^{}]*)^\s*}', text)
    edits = []
    for block in maps:
        body = block['body']
        old = re.escape(OLD)
        line = re.compile(r'(?m)^(?P<indent>[ \t]*)["\']?' + old
                          + r'["\']?[ \t]+(?P<value>\$http_origin|["\']?' + old
                          + r'["\']?);[ \t]*(?:#[^\r\n]*)?(?=\r?$)')
        matches = list(line.finditer(body))
        if not matches:
            continue
        if len(matches) != 1:
            raise ValueError('Ambiguous existing origin entries')
        if NEW in body:
            raise ValueError('Custom origin already appears in the map; inspect its value')
        match = matches[0]
        value = '$http_origin' if match['value'] == '$http_origin' else '"' + NEW + '"'
        newline = '\r\n' if '\r\n' in text else '\n'
        insertion = newline + match['indent'] + '"' + NEW + '" ' + value + ';'
        edits.append((block.start('body') + match.end(), insertion))
    if len(edits) > 1:
        raise ValueError('Multiple origin maps; no automatic change')
    if not edits:
        return None
    position, insertion = edits[0]
    return text[:position] + insertion + text[position:]


def replace_bytes(path, content, original_stat):
    descriptor, temporary = tempfile.mkstemp(prefix='.sonnenpfad-cors-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), stat.S_IMODE(original_stat.st_mode))
            os.fchown(stream.fileno(), original_stat.st_uid, original_stat.st_gid)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def probe():
    # Default TLS verification stays enabled, including the certificate IP SAN.
    request = urllib.request.Request(ROUTE, headers={'Origin': NEW, 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = response.read(4 * 1024 * 1024 + 1)
        if len(payload) > 4 * 1024 * 1024:
            raise ValueError('Unexpectedly large route response')
        data = json.loads(payload)
        props = data.get('properties', {})
        if (data.get('type') != 'FeatureCollection' or props.get('profile') != 'shortest'
                or props.get('segment_metadata_version') != 1):
            raise ValueError('Unexpected production route contract')
        origin = response.headers.get('Access-Control-Allow-Origin')
        print('CORS_CHECK:', repr(origin), flush=True)
        return origin == NEW, props


def apply_configuration(path, original, proposed, metadata, nginx):
    try:
        replace_bytes(path, proposed, metadata)
        subprocess.run([nginx, '-t'], capture_output=True, check=True, timeout=20)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        for attempt in range(4):
            if attempt:
                time.sleep(attempt)
            allowed, props = probe()
            if allowed:
                break
        if not allowed:
            raise ValueError('Production response still lacks the exact custom-domain CORS header')
    except BaseException:
        replace_bytes(path, original, metadata)
        subprocess.run([nginx, '-t'], capture_output=True, check=True, timeout=20)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        print('ROLLED_BACK: original Nginx configuration restored.', flush=True)
        raise
    return props


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run this script with sudo on the Oracle VM.')
    nginx = shutil.which('nginx') or '/usr/sbin/nginx'
    current, props = probe()
    if current:
        print('CORS_ROUTE_PASS: custom domain already allowed; no configuration changed.', flush=True)
        return
    result = subprocess.run([nginx, '-T'], capture_output=True, text=True, timeout=20, check=True)
    files = dict.fromkeys(re.findall(r'(?m)^# configuration file ([^\n]+):$', result.stdout))
    candidates = []
    for name in files:
        path = Path(name).resolve()
        if not str(path).startswith('/etc/nginx/') or not path.is_file():
            continue
        raw = path.read_bytes()
        proposed = updated_map(raw.decode('utf-8'))
        if proposed is not None:
            candidates.append((path, raw, proposed.encode('utf-8'), path.stat()))
    if len(candidates) != 1:
        print('NO_CHANGE: expected one explicit Nginx origin map; found', len(candidates), flush=True)
        for line in result.stdout.splitlines():
            if OLD in line or NEW in line or re.search(r'map\s+\$http_origin', line):
                print('CORS_CONFIG:', line.strip()[:500], flush=True)
        raise SystemExit(2)
    path, original, proposed, metadata = candidates[0]
    backup_dir = Path(tempfile.mkdtemp(prefix='sonnenpfad-cors-', dir='/var/backups'))
    os.chmod(backup_dir, 0o700)
    backup = backup_dir / path.name
    backup.write_bytes(original)
    backup.chmod(0o600)
    print('BACKUP:', backup, 'SHA256:', hashlib.sha256(original).hexdigest(), flush=True)
    if path.read_bytes() != original:
        raise SystemExit('Configuration changed during review; no changes made.')
    props = apply_configuration(path, original, proposed, metadata, nginx)
    print('CORS_ROUTE_PASS: HTTPS route and exact custom-domain origin verified;',
          'distance_m=', props.get('distance_m'), 'route_parts=', props.get('route_parts'), flush=True)
    print('Legacy API and test API remain on their existing ports. No database changes.', flush=True)


if __name__ == '__main__':
    main()
