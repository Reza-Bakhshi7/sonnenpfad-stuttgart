-- Sonnenpfad platform database (Cloudflare D1). Aggregated counts only; see services/platform.mjs.
CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, metric TEXT NOT NULL, dim TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, metric, dim));
-- Daily visitor hashes (salted, salt deleted after the day); rolled up into counts and deleted every night.
CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, hash TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, sessions INTEGER NOT NULL DEFAULT 1, duration INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, hash));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS security (ts INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS security_ts ON security (ts);
