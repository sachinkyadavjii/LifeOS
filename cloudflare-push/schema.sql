CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  expiration_time INTEGER,
  keys_json TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  time TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  last_sent_date TEXT,
  PRIMARY KEY (device_id, name),
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminders_enabled_time
  ON reminders(enabled, time);