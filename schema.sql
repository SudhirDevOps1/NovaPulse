-- NovaPulse 2026 — Universal Serverless SQL Schema
-- Compatible with Cloudflare D1, Turso libSQL, and SQLite

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT DEFAULT 'http',
  method TEXT DEFAULT 'GET',
  interval_sec INTEGER DEFAULT 60,
  timeout_ms INTEGER DEFAULT 10000,
  enabled INTEGER DEFAULT 1,
  expected_status TEXT,
  expected_keyword TEXT,
  warn_ms INTEGER DEFAULT 0,
  failures_before_down INTEGER DEFAULT 1,
  check_ssl INTEGER DEFAULT 1,
  body TEXT,
  headers TEXT,
  tags TEXT,
  status TEXT DEFAULT 'unknown',
  last_check TEXT,
  ssl TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status INTEGER,
  ms REAL,
  degraded INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_history_monitor_at ON history(monitor_id, at);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  type TEXT NOT NULL,
  reason TEXT,
  status INTEGER,
  response_snippet TEXT,
  screenshot_url TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_at ON incidents(at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
