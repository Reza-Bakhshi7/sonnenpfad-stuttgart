# Sonnenpfad backups (encrypted)

Daily server backups of Sonnenpfad Stuttgart. Every file is encrypted with GPG to the
backup public key; nothing in this repository is readable without the private key, which
is kept only offline by the owner. Only the two newest snapshots are kept.

Per snapshot:
- `database.dump.gpg.partNN` — PostgreSQL custom-format dump of the `sonnenpfad` database
- `server-config.tar.gz.gpg` — Nginx, systemd units, firewall rules, certificates and service code
- `SHA256SUMS`, `INFO` — checksums of the encrypted files and the backup time

Restore: see `docs/backup-and-restore.md` in the application repository.
