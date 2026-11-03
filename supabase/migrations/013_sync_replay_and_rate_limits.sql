CREATE TABLE IF NOT EXISTS sync_operation_results (
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB,
  lease_until TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation_id)
);
CREATE TABLE IF NOT EXISTS assistant_rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE sync_operation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE swine_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
