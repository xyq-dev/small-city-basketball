CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80),
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 80 AND 256),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE organization_memberships (
  org_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('ORG_OWNER', 'ORG_ADMIN', 'EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, user_id)
);

CREATE UNIQUE INDEX one_owner_per_organization ON organization_memberships(org_id) WHERE role = 'ORG_OWNER';
CREATE INDEX memberships_by_user ON organization_memberships(user_id, status, org_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_by_user ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  start_date date NOT NULL CHECK (start_date >= DATE '0001-01-01'),
  end_date date NOT NULL CHECK (end_date <= DATE '9999-12-31' AND end_date >= start_date),
  timezone text NOT NULL CHECK (timezone = 'Asia/Shanghai'),
  venue_name text CHECK (venue_name IS NULL OR (venue_name = btrim(venue_name) AND char_length(venue_name) BETWEEN 1 AND 100)),
  format text NOT NULL CHECK (format IN ('ROUND_ROBIN', 'GROUP_KNOCKOUT', 'SINGLE_ELIMINATION')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'ARCHIVED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id)
);

CREATE INDEX events_by_org_page ON events(org_id, created_at DESC, id DESC);
CREATE INDEX events_by_org_status ON events(org_id, status, created_at DESC, id DESC);

CREATE TABLE event_staff (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, event_id, user_id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES organization_memberships(org_id, user_id)
);

CREATE INDEX staff_by_member ON event_staff(org_id, user_id, status, event_id);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES organizations(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 40),
  resource_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX audit_by_org ON audit_logs(org_id, created_at DESC);

CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 160),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
