export const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE requests (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('created','saving','save_failed','processing','completed','processing_failed','abandoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  manifest jsonb,
  fingerprint text,
  audio_key text,
  audio_stored boolean NOT NULL DEFAULT false,
  error jsonb,
  abandon_reason text,
  report_key text,
  report_sha256 text,
  CHECK ((closed_at IS NULL) = (status IN ('created','saving','save_failed'))),
  CHECK (status NOT IN ('processing','completed','processing_failed') OR audio_stored),
  CHECK (status <> 'completed' OR (report_key IS NOT NULL AND report_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX requests_one_open_owner ON requests(owner_id) WHERE closed_at IS NULL;
CREATE INDEX requests_history ON requests(owner_id, created_at DESC, id DESC);
CREATE TABLE request_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX request_events_request ON request_events(request_id, id);
CREATE TABLE processing_intents (
  request_id uuid PRIMARY KEY REFERENCES requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  source_audio_key text NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE processing_commands (
  command_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id),
  source_audio_key text NOT NULL,
  parameters jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','polling','succeeded','failed','timed_out')),
  first_sent_at timestamptz,
  deadline_at timestamptz,
  next_action_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  remote_status text,
  snapshot jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX processing_commands_one_active ON processing_commands(request_id)
  WHERE status IN ('pending','polling');
CREATE INDEX processing_commands_due ON processing_commands(next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX processing_commands_history ON processing_commands(request_id,created_at);
ALTER TABLE processing_intents ADD COLUMN command_id uuid REFERENCES processing_commands(command_id);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE clinics (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 320),
  password_hash text,
  password_created_at timestamptz,
  full_name text CHECK (full_name IS NULL OR char_length(full_name) <= 300),
  position text CHECK (position IS NULL OR char_length(position) <= 200),
  specialization text CHECK (specialization IS NULL OR char_length(specialization) <= 200),
  blocked_at timestamptz,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (password_hash IS NOT NULL OR (is_system AND blocked_at IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_unique ON users(email);
CREATE INDEX users_clinic ON users(clinic_id, created_at DESC);

CREATE TABLE user_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE user_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_expiry ON user_sessions(expires_at);
CREATE INDEX user_sessions_user ON user_sessions(user_id);

CREATE TABLE auth_login_buckets (
  key_hash char(64) PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);
CREATE INDEX auth_login_buckets_expiry ON auth_login_buckets(first_failed_at);

INSERT INTO clinics(id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Legacy data');
INSERT INTO users(id, clinic_id, email, blocked_at, is_system)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'legacy-system@invalid.local',
  now(),
  true
);
UPDATE requests
SET owner_id = '00000000-0000-4000-8000-000000000001'
WHERE owner_id = 'technical-user';
ALTER TABLE requests ALTER COLUMN owner_id TYPE uuid USING owner_id::uuid;
ALTER TABLE requests
  ADD CONSTRAINT requests_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;
`,
  },
] as const;
