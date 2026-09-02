-- 0002_observability_metric.sql — rename m09_metrics → metrics, keep compat view
-- M8 Observability: m09.metric → observability.metric

-- Create canonical metrics table if not exists (new DBs)
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  labels_json TEXT,
  timestamp TEXT NOT NULL
);

-- Migrate existing m09_metrics rows into metrics (existing DBs, idempotent)
INSERT OR IGNORE INTO metrics (id, name, type, value, labels_json, timestamp)
  SELECT id, name, type, value, labels_json, timestamp FROM m09_metrics
  WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='m09_metrics');
