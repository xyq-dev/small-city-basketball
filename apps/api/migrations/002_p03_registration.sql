CREATE TABLE teams (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id)
);

CREATE INDEX teams_by_org_page ON teams(org_id, created_at DESC, id DESC);

CREATE TABLE team_members (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, team_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
);

CREATE INDEX members_by_team ON team_members(org_id, team_id, status, id);

CREATE TABLE team_access_grants (
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'TEAM_MANAGER' CHECK (role = 'TEAM_MANAGER'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, team_id, user_id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
);

CREATE INDEX grants_by_user ON team_access_grants(user_id, status, org_id, team_id);

CREATE TABLE team_invitations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES users(id),
  issuer_user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL DEFAULT 'TEAM_MANAGER' CHECK (purpose = 'TEAM_MANAGER'),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, team_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '168 hours'),
  CHECK (accepted_at IS NULL OR accepted_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX invitations_by_team_page ON team_invitations(org_id, team_id, created_at DESC, id DESC);
CREATE INDEX invitations_by_target ON team_invitations(target_user_id, created_at DESC, id DESC);

CREATE TABLE event_rulesets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  min_players integer NOT NULL CHECK (min_players BETWEEN 1 AND 60),
  max_players integer NOT NULL CHECK (max_players BETWEEN min_players AND 60),
  zero_and_double_zero_distinct boolean NOT NULL,
  require_identity boolean NOT NULL,
  require_insurance boolean NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, event_id, id, version),
  UNIQUE (org_id, event_id, version),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id)
);

ALTER TABLE events
  ADD COLUMN current_ruleset_id uuid,
  ADD COLUMN locked_ruleset_id uuid,
  ADD CONSTRAINT events_current_ruleset_fk FOREIGN KEY (org_id, id, current_ruleset_id)
    REFERENCES event_rulesets(org_id, event_id, id),
  ADD CONSTRAINT events_locked_ruleset_fk FOREIGN KEY (org_id, id, locked_ruleset_id)
    REFERENCES event_rulesets(org_id, event_id, id),
  ADD CONSTRAINT events_locked_ruleset_current_check
    CHECK (locked_ruleset_id IS NULL OR (current_ruleset_id IS NOT NULL AND current_ruleset_id = locked_ruleset_id));

CREATE FUNCTION p03_protect_locked_ruleset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_ruleset_id IS NOT NULL AND NEW.locked_ruleset_id IS DISTINCT FROM OLD.locked_ruleset_id THEN
    RAISE EXCEPTION 'The registration ruleset is already locked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_protect_locked_ruleset BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION p03_protect_locked_ruleset();

CREATE TABLE entries (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  team_name text NOT NULL CHECK (team_name = btrim(team_name) AND char_length(team_name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ruleset_id uuid NOT NULL,
  roster_revision_id uuid,
  last_submitted_by uuid REFERENCES users(id),
  latest_review_reason text CHECK (latest_review_reason IS NULL OR (latest_review_reason = btrim(latest_review_reason) AND char_length(latest_review_reason) BETWEEN 1 AND 500)),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, team_id, id),
  UNIQUE (event_id, team_id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id),
  FOREIGN KEY (org_id, event_id, ruleset_id) REFERENCES event_rulesets(org_id, event_id, id)
);

CREATE INDEX entries_by_event_page ON entries(org_id, event_id, created_at DESC, id DESC);
CREATE INDEX entries_by_team_page ON entries(org_id, team_id, created_at DESC, id DESC);
CREATE INDEX entries_by_event_status ON entries(org_id, event_id, status, id);

CREATE TABLE entry_roster_revisions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, entry_id, id),
  UNIQUE (org_id, team_id, entry_id, id),
  UNIQUE (org_id, entry_id, version),
  FOREIGN KEY (org_id, event_id, entry_id) REFERENCES entries(org_id, event_id, id),
  FOREIGN KEY (org_id, team_id, entry_id) REFERENCES entries(org_id, team_id, id)
);

ALTER TABLE entries ADD CONSTRAINT entries_roster_revision_fk
  FOREIGN KEY (org_id, id, roster_revision_id) REFERENCES entry_roster_revisions(org_id, entry_id, id);

CREATE TABLE entry_roster_players (
  org_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  team_id uuid NOT NULL,
  member_id uuid NOT NULL,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  jersey_no text NOT NULL CHECK (jersey_no ~ '^(0|00|[1-9][0-9]?)$'),
  PRIMARY KEY (org_id, revision_id, member_id),
  UNIQUE (org_id, revision_id, jersey_no),
  FOREIGN KEY (org_id, team_id, entry_id, revision_id) REFERENCES entry_roster_revisions(org_id, team_id, entry_id, id),
  FOREIGN KEY (org_id, team_id, member_id) REFERENCES team_members(org_id, team_id, id)
);

CREATE INDEX roster_players_by_member ON entry_roster_players(org_id, team_id, member_id);

CREATE TABLE entry_review_history (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  command text NOT NULL CHECK (command IN ('SUBMIT', 'WITHDRAW', 'APPROVE', 'REQUEST_CHANGES', 'REJECT')),
  reason text CHECK (reason IS NULL OR (reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 500)),
  roster_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id, event_id, entry_id) REFERENCES entries(org_id, event_id, id),
  FOREIGN KEY (org_id, entry_id, roster_revision_id) REFERENCES entry_roster_revisions(org_id, entry_id, id),
  CHECK (command NOT IN ('REQUEST_CHANGES', 'REJECT') OR reason IS NOT NULL)
);

CREATE INDEX review_history_by_entry ON entry_review_history(org_id, entry_id, created_at DESC, id DESC);

CREATE TABLE registration_freezes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  ruleset_id uuid NOT NULL,
  ruleset_version integer NOT NULL CHECK (ruleset_version > 0),
  event_version integer NOT NULL CHECK (event_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, event_id, ruleset_id, ruleset_version) REFERENCES event_rulesets(org_id, event_id, id, version)
);

CREATE FUNCTION p03_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registration history is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER event_rulesets_immutable BEFORE UPDATE OR DELETE ON event_rulesets
  FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
CREATE TRIGGER entry_roster_revisions_immutable BEFORE UPDATE OR DELETE ON entry_roster_revisions
  FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
CREATE TRIGGER entry_roster_players_immutable BEFORE UPDATE OR DELETE ON entry_roster_players
  FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
CREATE TRIGGER entry_review_history_immutable BEFORE UPDATE OR DELETE ON entry_review_history
  FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
CREATE TRIGGER registration_freezes_immutable BEFORE UPDATE OR DELETE ON registration_freezes
  FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
