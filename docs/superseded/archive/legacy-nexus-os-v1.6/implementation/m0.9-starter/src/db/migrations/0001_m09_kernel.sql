-- M0.9 kernel primitives. Adjust table/column names to match existing ALiX DB conventions before applying.

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  session_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_json TEXT,
  policy_context_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_graphs (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  root_goal TEXT NOT NULL,
  status TEXT NOT NULL,
  strategy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_nodes (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  required_capabilities_json TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  approval_mode TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  artifacts_json TEXT NOT NULL,
  memory_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workflow_id TEXT,
  graph_id TEXT,
  node_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  visibility TEXT NOT NULL,
  causality_json TEXT,
  integrity_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_workflow_time ON events(workflow_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_task_nodes_graph_status ON task_nodes(graph_id, status);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  resource TEXT,
  decision TEXT NOT NULL,
  risk_tier INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  argument_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  valid_for_tool_id TEXT,
  valid_for_node_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS m09_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  labels_json TEXT,
  timestamp TEXT NOT NULL
);
