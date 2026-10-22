CREATE TABLE scoring_rulesets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  regulation_periods integer NOT NULL CHECK (regulation_periods BETWEEN 1 AND 8),
  period_duration_seconds integer NOT NULL CHECK (period_duration_seconds BETWEEN 1 AND 3600),
  allowed_score_values integer[] NOT NULL CHECK (
    array_ndims(allowed_score_values) = 1 AND array_lower(allowed_score_values, 1) = 1 AND
    cardinality(allowed_score_values) BETWEEN 1 AND 3 AND allowed_score_values <@ ARRAY[1, 2, 3] AND
    array_position(allowed_score_values, NULL) IS NULL AND
    (cardinality(allowed_score_values) = 1 OR
      (cardinality(allowed_score_values) = 2 AND allowed_score_values[1] <> allowed_score_values[2]) OR
      (cardinality(allowed_score_values) = 3 AND allowed_score_values[1] <> allowed_score_values[2] AND
        allowed_score_values[1] <> allowed_score_values[3] AND allowed_score_values[2] <> allowed_score_values[3]))
  ),
  tie_policy text NOT NULL CHECK (tie_policy IN ('ALLOW_DRAW', 'OVERTIME')),
  overtime_duration_seconds integer,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, event_id, id, version),
  UNIQUE (org_id, event_id, version),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  CHECK ((tie_policy = 'ALLOW_DRAW' AND overtime_duration_seconds IS NULL) OR
    (tie_policy = 'OVERTIME' AND overtime_duration_seconds IS NOT NULL AND overtime_duration_seconds BETWEEN 1 AND 1800))
);

ALTER TABLE events
  ADD COLUMN current_scoring_ruleset_id uuid,
  ADD COLUMN locked_scoring_ruleset_id uuid,
  ADD CONSTRAINT events_current_scoring_ruleset_fk FOREIGN KEY (org_id, id, current_scoring_ruleset_id)
    REFERENCES scoring_rulesets(org_id, event_id, id),
  ADD CONSTRAINT events_locked_scoring_ruleset_fk FOREIGN KEY (org_id, id, locked_scoring_ruleset_id)
    REFERENCES scoring_rulesets(org_id, event_id, id),
  ADD CONSTRAINT events_locked_scoring_ruleset_current_check CHECK (locked_scoring_ruleset_id IS NULL OR
    (current_scoring_ruleset_id IS NOT NULL AND current_scoring_ruleset_id = locked_scoring_ruleset_id));

CREATE TABLE match_staff (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('SCORER', 'RESULT_REVIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, match_id, user_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES organization_memberships(org_id, user_id)
);

CREATE INDEX match_staff_by_user ON match_staff(org_id, user_id, status, match_id);

CREATE TABLE scoring_states (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  ruleset_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  last_event_seq integer NOT NULL DEFAULT 0 CHECK (last_event_seq >= 0),
  home_score integer NOT NULL DEFAULT 0 CHECK (home_score >= 0),
  away_score integer NOT NULL DEFAULT 0 CHECK (away_score >= 0),
  home_fouls integer NOT NULL DEFAULT 0 CHECK (home_fouls >= 0),
  away_fouls integer NOT NULL DEFAULT 0 CHECK (away_fouls >= 0),
  home_timeouts integer NOT NULL DEFAULT 0 CHECK (home_timeouts >= 0),
  away_timeouts integer NOT NULL DEFAULT 0 CHECK (away_timeouts >= 0),
  period_stats jsonb NOT NULL CHECK (jsonb_typeof(period_stats) = 'array'),
  period integer NOT NULL CHECK (period > 0),
  remaining_ms integer NOT NULL CHECK (remaining_ms BETWEEN 0 AND 3600000),
  clock_running boolean NOT NULL,
  anchor_server_time timestamptz NOT NULL CHECK (isfinite(anchor_server_time)),
  clock_version integer NOT NULL CHECK (clock_version >= 0),
  latest_confirmation_id uuid,
  requires_reconfirmation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, match_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, ruleset_id) REFERENCES scoring_rulesets(org_id, event_id, id)
);

CREATE TABLE scoring_leases (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  lease_id uuid,
  holder_user_id uuid REFERENCES users(id),
  holder_session_id uuid REFERENCES sessions(id),
  client_instance_id uuid,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  expires_at timestamptz CHECK (expires_at IS NULL OR isfinite(expires_at)),
  PRIMARY KEY (org_id, match_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  CHECK ((lease_id IS NULL AND holder_user_id IS NULL AND holder_session_id IS NULL AND client_instance_id IS NULL AND expires_at IS NULL AND fencing_token = 0) OR
    (lease_id IS NOT NULL AND holder_user_id IS NOT NULL AND holder_session_id IS NOT NULL AND client_instance_id IS NOT NULL AND expires_at IS NOT NULL AND fencing_token > 0))
);

CREATE INDEX scoring_leases_by_session ON scoring_leases(holder_session_id) WHERE holder_session_id IS NOT NULL;

CREATE TABLE scoring_commands (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  command_type text NOT NULL CHECK (command_type IN (
    'PREPARE_MATCH', 'START_MATCH', 'RECORD_STAT', 'ADD_CORRECTION', 'VOID_STAT', 'REPLACE_STAT',
    'CLOCK_START', 'CLOCK_PAUSE', 'CLOCK_SET', 'NEXT_PERIOD', 'START_OVERTIME', 'END_MATCH', 'CONFIRM_RESULT', 'REOPEN_RESULT'
  )),
  applied_version integer NOT NULL CHECK (applied_version > 0),
  first_event_seq integer,
  last_event_seq integer,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(accepted_at)),
  PRIMARY KEY (org_id, actor_id, match_id, command_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  CHECK ((first_event_seq IS NULL AND last_event_seq IS NULL) OR
    (first_event_seq IS NOT NULL AND last_event_seq IS NOT NULL AND first_event_seq > 0 AND last_event_seq >= first_event_seq))
);

CREATE INDEX scoring_commands_by_match_version ON scoring_commands(org_id, match_id, applied_version);

CREATE TABLE scoring_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  type text NOT NULL CHECK (type = btrim(type) AND char_length(type) BETWEEN 1 AND 80),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  captured_at timestamptz NOT NULL CHECK (isfinite(captured_at)),
  server_time timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(server_time)),
  target_event_id uuid,
  UNIQUE (org_id, match_id, id),
  UNIQUE (org_id, match_id, seq),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, actor_id, match_id, command_id) REFERENCES scoring_commands(org_id, actor_id, match_id, command_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (org_id, match_id, target_event_id) REFERENCES scoring_events(org_id, match_id, id),
  CHECK (target_event_id IS NULL OR target_event_id <> id),
  CHECK (type <> 'STAT_VOIDED' OR target_event_id IS NOT NULL)
);

CREATE UNIQUE INDEX scoring_events_void_once ON scoring_events(org_id, match_id, target_event_id)
  WHERE type = 'STAT_VOIDED';
CREATE INDEX scoring_events_by_actor ON scoring_events(org_id, match_id, actor_id, seq);

ALTER TABLE scoring_commands
  ADD CONSTRAINT scoring_commands_first_event_fk FOREIGN KEY (org_id, match_id, first_event_seq)
    REFERENCES scoring_events(org_id, match_id, seq) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT scoring_commands_last_event_fk FOREIGN KEY (org_id, match_id, last_event_seq)
    REFERENCES scoring_events(org_id, match_id, seq) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE result_confirmations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  confirming_user_id uuid NOT NULL REFERENCES users(id),
  ruleset_id uuid NOT NULL,
  ruleset_version integer NOT NULL CHECK (ruleset_version > 0),
  source_match_version integer NOT NULL CHECK (source_match_version > 0),
  last_event_seq integer NOT NULL CHECK (last_event_seq >= 0),
  home_score integer NOT NULL CHECK (home_score >= 0),
  away_score integer NOT NULL CHECK (away_score >= 0),
  home_fouls integer NOT NULL CHECK (home_fouls >= 0),
  away_fouls integer NOT NULL CHECK (away_fouls >= 0),
  home_timeouts integer NOT NULL CHECK (home_timeouts >= 0),
  away_timeouts integer NOT NULL CHECK (away_timeouts >= 0),
  period_stats jsonb NOT NULL CHECK (jsonb_typeof(period_stats) = 'array'),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(confirmed_at)),
  UNIQUE (org_id, match_id, id),
  UNIQUE (org_id, match_id, source_match_version),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, ruleset_id, ruleset_version) REFERENCES scoring_rulesets(org_id, event_id, id, version)
);

ALTER TABLE scoring_states ADD CONSTRAINT scoring_states_latest_confirmation_fk
  FOREIGN KEY (org_id, match_id, latest_confirmation_id) REFERENCES result_confirmations(org_id, match_id, id);

CREATE FUNCTION p05_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Scoring history is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER scoring_rulesets_immutable BEFORE UPDATE OR DELETE ON scoring_rulesets
  FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
CREATE TRIGGER scoring_commands_immutable BEFORE UPDATE OR DELETE ON scoring_commands
  FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
CREATE TRIGGER scoring_events_immutable BEFORE UPDATE OR DELETE ON scoring_events
  FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
CREATE TRIGGER result_confirmations_immutable BEFORE UPDATE OR DELETE ON result_confirmations
  FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();

CREATE FUNCTION p05_protect_locked_ruleset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_scoring_ruleset_id IS NOT NULL AND NEW.locked_scoring_ruleset_id IS DISTINCT FROM OLD.locked_scoring_ruleset_id THEN
    RAISE EXCEPTION 'The scoring ruleset is already locked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_protect_locked_scoring_ruleset BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION p05_protect_locked_ruleset();

CREATE FUNCTION p05_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Scoring states cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.org_id, NEW.event_id, NEW.match_id, NEW.ruleset_id, NEW.created_at) IS DISTINCT FROM
     ROW(OLD.org_id, OLD.event_id, OLD.match_id, OLD.ruleset_id, OLD.created_at) OR
     NEW.source_version < OLD.source_version OR NEW.last_event_seq < OLD.last_event_seq OR NEW.clock_version < OLD.clock_version THEN
    RAISE EXCEPTION 'Scoring state source and versions cannot be replaced' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scoring_states_guard BEFORE UPDATE OR DELETE ON scoring_states
  FOR EACH ROW EXECUTE FUNCTION p05_state_guard();

CREATE FUNCTION p05_state_version_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope_org uuid;
  scope_match uuid;
  projected_version integer;
  match_version integer;
BEGIN
  scope_org := NEW.org_id;
  IF TG_TABLE_NAME = 'published_matches' THEN
    scope_match := NEW.id;
  ELSE
    scope_match := NEW.match_id;
  END IF;
  SELECT s.source_version INTO projected_version FROM scoring_states s
    WHERE s.org_id = scope_org AND s.match_id = scope_match;
  IF FOUND THEN
    SELECT m.version INTO match_version FROM published_matches m WHERE m.org_id = scope_org AND m.id = scope_match;
    IF projected_version IS DISTINCT FROM match_version THEN
      RAISE EXCEPTION 'Scoring projection and match versions must commit together' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER scoring_states_version_commit_guard AFTER INSERT OR UPDATE ON scoring_states
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p05_state_version_commit_guard();
CREATE CONSTRAINT TRIGGER scoring_match_version_commit_guard AFTER UPDATE ON published_matches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p05_state_version_commit_guard();

CREATE FUNCTION p05_lease_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  session_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Scoring lease fences cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.org_id, NEW.event_id, NEW.match_id) IS DISTINCT FROM ROW(OLD.org_id, OLD.event_id, OLD.match_id) OR
       NEW.fencing_token < OLD.fencing_token THEN
      RAISE EXCEPTION 'Scoring lease scope and fence cannot be replaced' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW.lease_id, NEW.holder_user_id, NEW.holder_session_id, NEW.client_instance_id) IS DISTINCT FROM
       ROW(OLD.lease_id, OLD.holder_user_id, OLD.holder_session_id, OLD.client_instance_id) AND
       NEW.fencing_token <= OLD.fencing_token THEN
      RAISE EXCEPTION 'A new scoring lease requires a higher fence' USING ERRCODE = '23514';
    END IF;
    IF NEW.fencing_token > OLD.fencing_token AND NEW.lease_id IS NOT DISTINCT FROM OLD.lease_id THEN
      RAISE EXCEPTION 'A higher fence requires a new lease identity' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.holder_session_id IS NOT NULL THEN
    SELECT s.user_id INTO session_user_id FROM sessions s WHERE s.id = NEW.holder_session_id;
    IF session_user_id IS DISTINCT FROM NEW.holder_user_id THEN
      RAISE EXCEPTION 'A scoring lease must belong to its bound session user' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scoring_leases_guard BEFORE INSERT OR UPDATE OR DELETE ON scoring_leases
  FOR EACH ROW EXECUTE FUNCTION p05_lease_guard();

CREATE FUNCTION p05_event_sequence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_seq integer;
  target_seq integer;
BEGIN
  SELECT COALESCE(max(e.seq), 0) + 1 INTO next_seq FROM scoring_events e
    WHERE e.org_id = NEW.org_id AND e.match_id = NEW.match_id;
  IF NEW.seq <> next_seq THEN
    RAISE EXCEPTION 'Scoring event sequence must be continuous' USING ERRCODE = '23514';
  END IF;
  IF NEW.target_event_id IS NOT NULL THEN
    SELECT e.seq INTO target_seq FROM scoring_events e
      WHERE e.org_id = NEW.org_id AND e.match_id = NEW.match_id AND e.id = NEW.target_event_id;
    IF target_seq IS NULL OR target_seq >= NEW.seq THEN
      RAISE EXCEPTION 'Scoring correction must reference an earlier event in this match' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scoring_events_sequence_guard BEFORE INSERT ON scoring_events
  FOR EACH ROW EXECUTE FUNCTION p05_event_sequence_guard();
