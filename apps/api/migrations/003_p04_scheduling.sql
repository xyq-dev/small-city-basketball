CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE courts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id)
);

CREATE UNIQUE INDEX courts_by_normalized_name ON courts(org_id, lower(btrim(name)));
CREATE INDEX courts_by_org_page ON courts(org_id, created_at DESC, id DESC);

CREATE TABLE org_schedule_mutex (
  org_id uuid PRIMARY KEY REFERENCES organizations(id)
);

ALTER TABLE registration_freezes ADD CONSTRAINT registration_freezes_scope_id_key
  UNIQUE (org_id, event_id, id);

CREATE TABLE schedule_revisions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  freeze_id uuid NOT NULL,
  algorithm_version text NOT NULL CHECK (algorithm_version = 'RR_CIRCLE_V1'),
  seed char(64) NOT NULL CHECK (seed ~ '^[0-9a-f]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  pairing_hash char(64) NOT NULL CHECK (pairing_hash ~ '^[0-9a-f]{64}$'),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  rounds jsonb NOT NULL CHECK (jsonb_typeof(rounds) = 'array'),
  ordered_entry_ids jsonb NOT NULL CHECK (jsonb_typeof(ordered_entry_ids) = 'array' AND jsonb_array_length(ordered_entry_ids) BETWEEN 2 AND 32),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUPERSEDED', 'PUBLISHED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  redraw_reason text CHECK (redraw_reason IS NULL OR (redraw_reason = btrim(redraw_reason) AND char_length(redraw_reason) BETWEEN 1 AND 500)),
  previous_revision_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, event_id, id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, event_id, freeze_id) REFERENCES registration_freezes(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, previous_revision_id) REFERENCES schedule_revisions(org_id, event_id, id),
  CHECK (previous_revision_id IS NULL OR (previous_revision_id <> id AND redraw_reason IS NOT NULL))
);

CREATE INDEX schedule_revisions_by_event ON schedule_revisions(org_id, event_id, created_at DESC, id DESC);

ALTER TABLE events ADD COLUMN current_schedule_revision_id uuid,
  ADD CONSTRAINT events_current_schedule_revision_fk FOREIGN KEY (org_id, id, current_schedule_revision_id)
    REFERENCES schedule_revisions(org_id, event_id, id);

CREATE TABLE schedule_fixtures (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  fixture_key text NOT NULL CHECK (fixture_key = btrim(fixture_key) AND char_length(fixture_key) BETWEEN 1 AND 80),
  round_no integer NOT NULL CHECK (round_no BETWEEN 1 AND 31),
  position_no integer NOT NULL CHECK (position_no BETWEEN 1 AND 16),
  home_entry_id uuid NOT NULL,
  away_entry_id uuid NOT NULL,
  home_team_id uuid NOT NULL,
  away_team_id uuid NOT NULL,
  court_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  PRIMARY KEY (org_id, revision_id, fixture_key),
  UNIQUE (org_id, event_id, revision_id, fixture_key),
  UNIQUE (org_id, revision_id, round_no, position_no),
  FOREIGN KEY (org_id, event_id, revision_id) REFERENCES schedule_revisions(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, home_entry_id) REFERENCES entries(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, away_entry_id) REFERENCES entries(org_id, event_id, id),
  FOREIGN KEY (org_id, home_team_id, home_entry_id) REFERENCES entries(org_id, team_id, id),
  FOREIGN KEY (org_id, away_team_id, away_entry_id) REFERENCES entries(org_id, team_id, id),
  FOREIGN KEY (org_id, court_id) REFERENCES courts(org_id, id),
  CHECK (home_entry_id <> away_entry_id AND home_team_id <> away_team_id),
  CHECK (
    (court_id IS NULL AND starts_at IS NULL AND ends_at IS NULL) OR
    (court_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND
      isfinite(starts_at) AND isfinite(ends_at) AND ends_at > starts_at)
  )
);

CREATE TABLE schedule_publications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  revision_id uuid NOT NULL UNIQUE,
  publication_hash char(64) NOT NULL CHECK (publication_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, event_id, id, revision_id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, event_id, revision_id) REFERENCES schedule_revisions(org_id, event_id, id)
);

CREATE TABLE published_matches (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  fixture_key text NOT NULL,
  round_no integer NOT NULL CHECK (round_no BETWEEN 1 AND 31),
  position_no integer NOT NULL CHECK (position_no BETWEEN 1 AND 16),
  home_entry_id uuid NOT NULL,
  away_entry_id uuid NOT NULL,
  home_team_id uuid NOT NULL,
  away_team_id uuid NOT NULL,
  home_team_name text NOT NULL CHECK (home_team_name = btrim(home_team_name) AND char_length(home_team_name) BETWEEN 1 AND 80),
  away_team_name text NOT NULL CHECK (away_team_name = btrim(away_team_name) AND char_length(away_team_name) BETWEEN 1 AND 80),
  home_roster_revision_id uuid NOT NULL,
  away_roster_revision_id uuid NOT NULL,
  court_id uuid NOT NULL,
  court_name text NOT NULL CHECK (court_name = btrim(court_name) AND char_length(court_name) BETWEEN 1 AND 80),
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  ends_at timestamptz NOT NULL CHECK (isfinite(ends_at) AND ends_at > starts_at),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'READY', 'LIVE', 'PENDING_CONFIRMATION', 'FINAL', 'POSTPONED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (org_id, id),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, publication_id, id),
  UNIQUE (org_id, publication_id, fixture_key),
  FOREIGN KEY (org_id, event_id, publication_id, revision_id) REFERENCES schedule_publications(org_id, event_id, id, revision_id),
  FOREIGN KEY (org_id, event_id, revision_id, fixture_key) REFERENCES schedule_fixtures(org_id, event_id, revision_id, fixture_key),
  FOREIGN KEY (org_id, event_id, home_entry_id) REFERENCES entries(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, away_entry_id) REFERENCES entries(org_id, event_id, id),
  FOREIGN KEY (org_id, home_team_id, home_entry_id) REFERENCES entries(org_id, team_id, id),
  FOREIGN KEY (org_id, away_team_id, away_entry_id) REFERENCES entries(org_id, team_id, id),
  FOREIGN KEY (org_id, home_entry_id, home_roster_revision_id) REFERENCES entry_roster_revisions(org_id, entry_id, id),
  FOREIGN KEY (org_id, away_entry_id, away_roster_revision_id) REFERENCES entry_roster_revisions(org_id, entry_id, id),
  FOREIGN KEY (org_id, court_id) REFERENCES courts(org_id, id),
  CHECK (home_entry_id <> away_entry_id AND home_team_id <> away_team_id)
);

CREATE INDEX published_matches_by_event_page ON published_matches(org_id, event_id, starts_at, id);

CREATE TABLE court_reservations (
  org_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  match_id uuid NOT NULL,
  court_id uuid NOT NULL,
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  ends_at timestamptz NOT NULL CHECK (isfinite(ends_at) AND ends_at > starts_at),
  PRIMARY KEY (org_id, match_id),
  FOREIGN KEY (org_id, publication_id, match_id) REFERENCES published_matches(org_id, publication_id, id),
  FOREIGN KEY (org_id, court_id) REFERENCES courts(org_id, id),
  EXCLUDE USING gist (org_id WITH =, court_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);

CREATE TABLE team_reservations (
  org_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  match_id uuid NOT NULL,
  team_id uuid NOT NULL,
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  ends_at timestamptz NOT NULL CHECK (isfinite(ends_at) AND ends_at > starts_at),
  PRIMARY KEY (org_id, match_id, team_id),
  FOREIGN KEY (org_id, publication_id, match_id) REFERENCES published_matches(org_id, publication_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id),
  EXCLUDE USING gist (org_id WITH =, team_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);

CREATE INDEX court_reservations_by_publication ON court_reservations(org_id, publication_id);
CREATE INDEX court_reservations_by_court_end ON court_reservations(org_id, court_id, ends_at);
CREATE INDEX team_reservations_by_publication ON team_reservations(org_id, publication_id);
CREATE INDEX team_reservations_by_team_end ON team_reservations(org_id, team_id, ends_at);

CREATE FUNCTION p04_reject_plan_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published scheduling facts are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION p04_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_matches integer;
  target_publication_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Scheduling revisions cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.version <> 1 OR
       EXISTS (SELECT 1 FROM schedule_publications p WHERE p.org_id = NEW.org_id AND p.event_id = NEW.event_id) THEN
      RAISE EXCEPTION 'A scheduling revision must start as a draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' OR
     (to_jsonb(NEW) - ARRAY['status', 'version', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'version', 'updated_at']) THEN
    RAISE EXCEPTION 'Scheduling source is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'PUBLISHED' THEN
    expected_matches := jsonb_array_length(NEW.ordered_entry_ids) * (jsonb_array_length(NEW.ordered_entry_ids) - 1) / 2;
    SELECT p.id INTO target_publication_id FROM schedule_publications p
      WHERE p.org_id = NEW.org_id AND p.event_id = NEW.event_id AND p.revision_id = NEW.id;
    IF target_publication_id IS NULL OR
       (SELECT count(*) FROM schedule_fixtures f WHERE f.org_id = NEW.org_id AND f.revision_id = NEW.id) <> expected_matches OR
       (SELECT count(*) FROM published_matches m WHERE m.org_id = NEW.org_id AND m.publication_id = target_publication_id) <> expected_matches OR
       (SELECT count(*) FROM court_reservations r WHERE r.org_id = NEW.org_id AND r.publication_id = target_publication_id) <> expected_matches OR
       (SELECT count(*) FROM team_reservations r WHERE r.org_id = NEW.org_id AND r.publication_id = target_publication_id) <> expected_matches * 2 THEN
      RAISE EXCEPTION 'Publication must contain every match and reservation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER schedule_revisions_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION p04_revision_guard();

CREATE FUNCTION p04_fixture_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Scheduling fixtures cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT r.status INTO revision_status FROM schedule_revisions r
    WHERE r.org_id = NEW.org_id AND r.event_id = NEW.event_id AND r.id = NEW.revision_id FOR SHARE;
  IF revision_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft fixtures may be written' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND
     (to_jsonb(NEW) - ARRAY['court_id', 'starts_at', 'ends_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['court_id', 'starts_at', 'ends_at']) THEN
    RAISE EXCEPTION 'Fixture pairings are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER schedule_fixtures_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule_fixtures
  FOR EACH ROW EXECUTE FUNCTION p04_fixture_guard();

CREATE FUNCTION p04_publication_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
  current_revision uuid;
BEGIN
  SELECT r.status INTO revision_status FROM schedule_revisions r
    WHERE r.org_id = NEW.org_id AND r.event_id = NEW.event_id AND r.id = NEW.revision_id FOR SHARE;
  SELECT e.current_schedule_revision_id INTO current_revision FROM events e
    WHERE e.org_id = NEW.org_id AND e.id = NEW.event_id;
  IF revision_status IS DISTINCT FROM 'DRAFT' OR current_revision IS DISTINCT FROM NEW.revision_id THEN
    RAISE EXCEPTION 'Only the current draft may be published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER schedule_publications_insert_guard BEFORE INSERT ON schedule_publications
  FOR EACH ROW EXECUTE FUNCTION p04_publication_insert_guard();
CREATE TRIGGER schedule_publications_immutable BEFORE UPDATE OR DELETE ON schedule_publications
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE FUNCTION p04_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
  fixture schedule_fixtures%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published matches cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'version']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'version']) OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Published match plan cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT r.status INTO revision_status FROM schedule_revisions r
    WHERE r.org_id = NEW.org_id AND r.event_id = NEW.event_id AND r.id = NEW.revision_id FOR SHARE;
  IF revision_status IS DISTINCT FROM 'DRAFT' OR NEW.status <> 'SCHEDULED' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'Matches can only be inserted during initial publication' USING ERRCODE = '23514';
  END IF;
  SELECT f.* INTO fixture FROM schedule_fixtures f
    WHERE f.org_id = NEW.org_id AND f.event_id = NEW.event_id AND f.revision_id = NEW.revision_id AND f.fixture_key = NEW.fixture_key FOR SHARE;
  IF NOT FOUND OR ROW(NEW.round_no, NEW.position_no, NEW.home_entry_id, NEW.away_entry_id,
       NEW.home_team_id, NEW.away_team_id, NEW.court_id, NEW.starts_at, NEW.ends_at) IS DISTINCT FROM
     ROW(fixture.round_no, fixture.position_no, fixture.home_entry_id, fixture.away_entry_id,
       fixture.home_team_id, fixture.away_team_id, fixture.court_id, fixture.starts_at, fixture.ends_at) THEN
    RAISE EXCEPTION 'Published match must match its source fixture' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER published_matches_guard BEFORE INSERT OR UPDATE OR DELETE ON published_matches
  FOR EACH ROW EXECUTE FUNCTION p04_match_guard();

CREATE FUNCTION p04_reservation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  planned published_matches%ROWTYPE;
  revision_status text;
BEGIN
  SELECT m.* INTO planned FROM published_matches m
    WHERE m.org_id = NEW.org_id AND m.publication_id = NEW.publication_id AND m.id = NEW.match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation requires a matching publication' USING ERRCODE = '23514';
  END IF;
  SELECT r.status INTO revision_status FROM schedule_revisions r
    WHERE r.org_id = planned.org_id AND r.event_id = planned.event_id AND r.id = planned.revision_id FOR SHARE;
  IF revision_status IS DISTINCT FROM 'DRAFT' OR
     ROW(NEW.starts_at, NEW.ends_at) IS DISTINCT FROM ROW(planned.starts_at, planned.ends_at) THEN
    RAISE EXCEPTION 'Reservations can only record the initial published match plan' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'court_reservations' THEN
    IF NEW.court_id IS DISTINCT FROM planned.court_id THEN
      RAISE EXCEPTION 'Court reservation must match the published court' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.team_id <> planned.home_team_id AND NEW.team_id <> planned.away_team_id THEN
      RAISE EXCEPTION 'Team reservation must match a published participant' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER court_reservations_insert_guard BEFORE INSERT ON court_reservations
  FOR EACH ROW EXECUTE FUNCTION p04_reservation_insert_guard();
CREATE TRIGGER court_reservations_immutable BEFORE UPDATE OR DELETE ON court_reservations
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();
CREATE TRIGGER team_reservations_insert_guard BEFORE INSERT ON team_reservations
  FOR EACH ROW EXECUTE FUNCTION p04_reservation_insert_guard();
CREATE TRIGGER team_reservations_immutable BEFORE UPDATE OR DELETE ON team_reservations
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE FUNCTION p04_publication_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
  event_status text;
  current_revision uuid;
BEGIN
  SELECT r.status INTO revision_status FROM schedule_revisions r
    WHERE r.org_id = NEW.org_id AND r.event_id = NEW.event_id AND r.id = NEW.revision_id;
  SELECT e.status, e.current_schedule_revision_id INTO event_status, current_revision FROM events e
    WHERE e.org_id = NEW.org_id AND e.id = NEW.event_id;
  IF revision_status IS DISTINCT FROM 'PUBLISHED' OR event_status IS DISTINCT FROM 'SCHEDULED' OR
     current_revision IS DISTINCT FROM NEW.revision_id THEN
    RAISE EXCEPTION 'Publication, revision and scheduled event must commit together' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER schedule_publications_commit_guard AFTER INSERT ON schedule_publications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p04_publication_commit_guard();

CREATE FUNCTION p04_current_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_schedule_revision_id IS DISTINCT FROM OLD.current_schedule_revision_id AND
     EXISTS (SELECT 1 FROM schedule_publications p WHERE p.org_id = OLD.org_id AND p.event_id = OLD.id) THEN
    RAISE EXCEPTION 'Published schedule pointer is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_protect_schedule_pointer BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION p04_current_revision_guard();
