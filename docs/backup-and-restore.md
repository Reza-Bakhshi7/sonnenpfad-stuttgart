# Backup and restore

## What is backed up

A systemd timer on the Oracle VM (`sonnenpfad-backup.timer`, daily 03:30 UTC) runs
`/usr/local/sbin/sonnenpfad-backup` ([ops/backup/sonnenpfad-backup.sh](../ops/backup/sonnenpfad-backup.sh)):

- PostgreSQL database `sonnenpfad` (custom-format `pg_dump`)
- Nginx configuration, systemd units of the Sonnenpfad services, firewall rules, certificates
  and the service code under `/opt/sonnenpfad-*` (without virtual environments)

Everything is encrypted with GPG to the backup **public** key before it leaves the server and
pushed to the private repository `Reza-Bakhshi7/sonnenpfad-backups` with a write-only deploy
key that is valid for that repository alone. Only the two newest snapshots are kept; the
history is replaced on each run, so the repository does not grow.

The **private** key exists only on the owner's PC in `C:\Thesis\App\backup-key\gnupg`
(never in a repository, never on the server). Keep an additional offline copy of that folder
(e.g. a USB stick): without it the backups cannot be read.

A weekly copy to the PC (`C:\Thesis\App\backups\update-backups.ps1`) keeps the eight newest
snapshots in `C:\Thesis\App\backups\archive`.

## Check

```sh
ssh sonnenpfad-vm 'systemctl list-timers sonnenpfad-backup.timer; journalctl -u sonnenpfad-backup -n 3 -o cat'
```

Every snapshot has `SHA256SUMS` (checksums of the encrypted files) and `INFO` (time, PostgreSQL version).

## Restore

On the PC (Git Bash), decrypt the newest snapshot:

```sh
export GNUPGHOME=/c/Thesis/App/backup-key/gnupg
cd /c/Thesis/App/backups/sonnenpfad-backups && git pull
cd "$(ls -d 20* | tail -1)" && sha256sum -c SHA256SUMS
cat database.dump.gpg.part* | gpg --decrypt > sonnenpfad.dump
gpg --decrypt server-config.tar.gz.gpg > server-config.tar.gz
```

On a new Ubuntu 24.04 server with PostgreSQL 16, PostGIS and pgRouting:

```sh
sudo -u postgres createdb sonnenpfad
sudo -u postgres pg_restore -d sonnenpfad --no-owner sonnenpfad.dump
sudo tar -C / -xzf server-config.tar.gz   # Nginx, systemd units, /opt/sonnenpfad-*, certificates
sudo systemctl daemon-reload && sudo systemctl enable --now sonnenpfad-profile-v2 nginx
curl -s https://<server>/profile-v2/health
```

Then recreate the Python environment of the routing service (`services/profile-api-v1`) and
update the server address in the app (`PROFILE_V2_API`) if the IP changed. Until the server is
back, switch the app to browser routing (`"serverRouting": false` in `dist/city-config.json`).
