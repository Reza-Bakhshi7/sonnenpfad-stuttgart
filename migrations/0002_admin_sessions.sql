-- Admin sessions (password + TOTP login); a logout or 30 minutes without activity removes the row.
CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, created INTEGER NOT NULL, last INTEGER NOT NULL);
