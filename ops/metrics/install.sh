#!/bin/sh
# Install or update the metrics collector and the token-protected Nginx endpoint /ops/metrics.
# Run as root on the VM from a directory containing this folder's files. Rolls back Nginx on test failure.
set -eu
SITE=/etc/nginx/sites-enabled/sonnenpfad-api
install -d -m 755 /var/lib/sonnenpfad-metrics
install -d -m 700 /etc/sonnenpfad-ops
# 128-bit token; 32 hex characters fit Nginx's default map hash bucket.
[ "$(wc -c < /etc/sonnenpfad-ops/token 2>/dev/null || echo 0)" = 33 ] || (umask 077; openssl rand -hex 16 > /etc/sonnenpfad-ops/token)
TOKEN=$(cat /etc/sonnenpfad-ops/token)
install -m 755 sonnenpfad-metrics.py /usr/local/sbin/sonnenpfad-metrics
install -m 644 sonnenpfad-metrics.service sonnenpfad-metrics.timer /etc/systemd/system/
# IP-free timing log format and the token check, in a root-only file included by the site after
# its map_hash_bucket_size directive (a map in conf.d would be parsed before it).
umask 077
printf '%s\n' "log_format sonnenpfad_api '\$msec \$status \$request_time \$uri';" "map \$http_x_ops_token \$sonnenpfad_ops_ok { default 0; \"$TOKEN\" 1; }" > /etc/nginx/sonnenpfad-ops.conf
rm -f /etc/nginx/conf.d/sonnenpfad-ops.conf
umask 022
cp -p "$SITE" /root/sonnenpfad-api.nginx.before-metrics
if ! grep -q sonnenpfad-api-metrics.log "$SITE"; then
  python3 - "$SITE" <<'PY'
import sys
path = sys.argv[1]; s = open(path).read()
s = s.replace("map_hash_bucket_size 128;\n", "map_hash_bucket_size 128;\ninclude /etc/nginx/sonnenpfad-ops.conf;\n", 1)
s = s.replace("        proxy_pass http://127.0.0.1:8002/$1;\n", "        access_log /var/log/nginx/sonnenpfad-api-metrics.log sonnenpfad_api;\n        proxy_pass http://127.0.0.1:8002/$1;\n", 1)
s = s.replace("    location / { return 404; }\n}\n", "    # Server health for the admin dashboard (Cloudflare Worker sends X-Ops-Token).\n    location = /ops/metrics {\n        if ($sonnenpfad_ops_ok = 0) { return 404; }\n        default_type application/json;\n        add_header Cache-Control \"no-store\" always;\n        alias /var/lib/sonnenpfad-metrics/latest.json;\n    }\n    location / { return 404; }\n}\n", 1)
open(path, "w").write(s)
PY
fi
if nginx -t 2>/dev/null; then systemctl reload nginx; else cp -p /root/sonnenpfad-api.nginx.before-metrics "$SITE"; echo "nginx test failed, rolled back" >&2; exit 1; fi
systemctl daemon-reload
systemctl enable --now sonnenpfad-metrics.timer
systemctl start sonnenpfad-metrics.service
echo "metrics installed"
