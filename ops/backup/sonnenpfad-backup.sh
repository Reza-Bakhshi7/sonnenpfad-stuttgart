#!/bin/sh
# Daily encrypted backup of the Sonnenpfad server to the private GitHub repository
# Reza-Bakhshi7/sonnenpfad-backups. Everything leaves the server GPG-encrypted to the
# backup public key only; the matching private key exists solely on the owner's PC.
set -eu
umask 077
CONF=/etc/sonnenpfad-backup
WORK=/var/backups/sonnenpfad
REPO="$WORK/repo"
KEEP=2
export GNUPGHOME="$CONF/gnupg"
FPR=$(cat "$CONF/fingerprint")
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
SNAP="$REPO/$STAMP"
mkdir -p "$SNAP"

encrypt() { gpg --batch --yes --quiet --trust-model always --encrypt --recipient "$FPR" --output - ; }

# 1. Database (custom format, already compressed), split below GitHub's 50 MB warning size.
sudo -u postgres pg_dump -Fc sonnenpfad | encrypt | split -b 45m -d -a 2 - "$SNAP/database.dump.gpg.part"

# 2. Server configuration and service code (no Python virtual environments).
tar -C / -czf - --ignore-failed-read \
  --exclude='*/venv' --exclude='*/.venv' --exclude='*/__pycache__' \
  etc/nginx etc/systemd/system/sonnenpfad-api.service etc/systemd/system/sonnenpfad-profile-v2.service \
  etc/iptables opt/sonnenpfad-profile-test opt/sonnenpfad-https opt/sonnenpfad-certbot etc/letsencrypt \
  2>/dev/null | encrypt > "$SNAP/server-config.tar.gz.gpg"

# 3. Plain-text manifest: sizes and checksums of the encrypted files only.
( cd "$SNAP" && sha256sum database.dump.gpg.part* server-config.tar.gz.gpg ) > "$WORK/sums.tmp" && mv "$WORK/sums.tmp" "$SNAP/SHA256SUMS"
printf 'created_utc=%s\nhost=%s\npostgres=%s\n' "$STAMP" "$(hostname)" "$(sudo -u postgres psql -Atc 'show server_version')" > "$SNAP/INFO"

# Keep only the newest snapshots; history is replaced so the repository does not grow.
ls -1d "$REPO"/20* | sort | head -n -"$KEEP" | xargs -r rm -rf
cd "$REPO"
cp "$CONF/README.md" README.md
echo '* -text' > .gitattributes
git init -q 2>/dev/null || true
git checkout -q --orphan next
git add -A
git -c user.name="Sonnenpfad backup" -c user.email="backup@sonnenpfad.invalid" commit -q -m "Encrypted backup $STAMP"
git branch -D main >/dev/null 2>&1 || true
git branch -m main
GIT_SSH_COMMAND="ssh -i $CONF/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$CONF/known_hosts" \
  git push -q --force git@github.com:Reza-Bakhshi7/sonnenpfad-backups.git main
git gc -q --prune=now
echo "backup $STAMP pushed: $(du -sh "$SNAP" | cut -f1)"
