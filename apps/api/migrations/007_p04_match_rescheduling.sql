-- Current match plans remain in published_matches. Original publication sources stay immutable.
CREATE TABLE match_reschedules (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  from_event_version integer NOT NULL CHECK (from_event_version > 0),
  to_event_version integer NOT NULL CHECK (to_event_version = from_event_version + 1),
  from_match_version integer NOT NULL CHECK (from_match_version > 0),
  to_match_version integer NOT NULL CHECK (to_match_version = from_match_version + 1),
  old_court_id uuid NOT NULL,
  old_court_name text NOT NULL CHECK (old_court_name = btrim(old_court_name) AND char_length(old_court_name) BETWEEN 1 AND 80),
  old_starts_at timestamptz NOT NULL CHECK (isfinite(old_starts_at)),
  old_ends_at timestamptz NOT NULL CHECK (isfinite(old_ends_at) AND old_ends_at > old_starts_at),
  new_court_id uuid NOT NULL,
  new_court_name text NOT NULL CHECK (new_court_name = btrim(new_court_name) AND char_length(new_court_name) BETWEEN 1 AND 80),
  new_starts_at timestamptz NOT NULL CHECK (isfinite(new_starts_at)),
  new_ends_at timestamptz NOT NULL CHECK (isfinite(new_ends_at) AND new_ends_at > new_starts_at),
  reason text NOT NULL CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, match_id, to_match_version),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, old_court_id) REFERENCES courts(org_id, id),
  FOREIGN KEY (org_id, new_court_id) REFERENCES courts(org_id, id),
  CHECK (new_ends_at - new_starts_at = old_ends_at - old_starts_at),
  CHECK (ROW(new_court_id, new_starts_at) IS DISTINCT FROM ROW(old_court_id, old_starts_at)),
  CHECK (new_court_id <> old_court_id OR new_court_name = old_court_name)
);
CREATE INDEX match_reschedules_history ON match_reschedules(org_id, match_id, to_match_version DESC);

CREATE FUNCTION p04b_reschedule_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_event events%ROWTYPE;
  current_match published_matches%ROWTYPE;
BEGIN
  IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'Rescheduling proof must belong to this transaction' USING ERRCODE = '23514';
  END IF;
  PERFORM org_id FROM org_schedule_mutex WHERE org_id = NEW.org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rescheduling requires the organization schedule mutex' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO current_event FROM events WHERE org_id = NEW.org_id AND id = NEW.event_id FOR UPDATE;
  IF NOT FOUND OR current_event.status NOT IN ('SCHEDULED', 'RUNNING') OR current_event.version <> NEW.from_event_version THEN
    RAISE EXCEPTION 'Rescheduling requires the current eligible event version' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO current_match FROM published_matches WHERE org_id = NEW.org_id AND event_id = NEW.event_id AND id = NEW.match_id FOR UPDATE;
  IF NOT FOUND OR current_match.status NOT IN ('SCHEDULED', 'READY') OR current_match.version <> NEW.from_match_version OR
     ROW(current_match.court_id, current_match.court_name, current_match.starts_at, current_match.ends_at) IS DISTINCT FROM
     ROW(NEW.old_court_id, NEW.old_court_name, NEW.old_starts_at, NEW.old_ends_at) OR
     EXISTS (SELECT 1 FROM scoring_events WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND type = 'START_MATCH') THEN
    RAISE EXCEPTION 'Rescheduling requires the current unstarted match plan' USING ERRCODE = '23514';
  END IF;
  IF (current_match.status = 'SCHEDULED' AND EXISTS (SELECT 1 FROM scoring_states WHERE org_id = NEW.org_id AND match_id = NEW.match_id)) OR
     (current_match.status = 'READY' AND NOT EXISTS (SELECT 1 FROM scoring_states WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND source_version = current_match.version AND clock_running = false)) THEN
    RAISE EXCEPTION 'Rescheduling cannot replace a prepared scoring source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_reschedules_insert_guard BEFORE INSERT ON match_reschedules
  FOR EACH ROW EXECUTE FUNCTION p04b_reschedule_insert_guard();
CREATE TRIGGER match_reschedules_immutable BEFORE UPDATE OR DELETE ON match_reschedules
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE OR REPLACE FUNCTION p04_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
  fixture schedule_fixtures%ROWTYPE;
  proof match_reschedules%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published matches cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Published match version must advance exactly once' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'version']) IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'version']) THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status OR
       (to_jsonb(NEW) - ARRAY['version', 'court_id', 'court_name', 'starts_at', 'ends_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['version', 'court_id', 'court_name', 'starts_at', 'ends_at']) THEN
      RAISE EXCEPTION 'Published participants and source cannot be changed' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO proof FROM match_reschedules WHERE org_id = OLD.org_id AND match_id = OLD.id AND
      from_match_version = OLD.version AND to_match_version = NEW.version AND transaction_id = pg_current_xact_id();
    IF NOT FOUND OR OLD.status NOT IN ('SCHEDULED', 'READY') OR
       ROW(OLD.court_id, OLD.court_name, OLD.starts_at, OLD.ends_at) IS DISTINCT FROM
       ROW(proof.old_court_id, proof.old_court_name, proof.old_starts_at, proof.old_ends_at) OR
       ROW(NEW.court_id, NEW.court_name, NEW.starts_at, NEW.ends_at) IS DISTINCT FROM
       ROW(proof.new_court_id, proof.new_court_name, proof.new_starts_at, proof.new_ends_at) THEN
      RAISE EXCEPTION 'Published match plan requires exact transaction rescheduling proof' USING ERRCODE = '23514';
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

CREATE FUNCTION p04b_reservation_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  planned published_matches%ROWTYPE;
  proof match_reschedules%ROWTYPE;
BEGIN
  IF (to_jsonb(NEW) - ARRAY['court_id', 'starts_at', 'ends_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['court_id', 'starts_at', 'ends_at']) THEN
    RAISE EXCEPTION 'Reservation identity cannot be replaced' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO planned FROM published_matches WHERE org_id = NEW.org_id AND id = NEW.match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation requires a current match' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO proof FROM match_reschedules WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND
    to_match_version = planned.version AND transaction_id = pg_current_xact_id();
  IF NOT FOUND OR ROW(OLD.starts_at, OLD.ends_at) IS DISTINCT FROM ROW(proof.old_starts_at, proof.old_ends_at) OR
     ROW(NEW.starts_at, NEW.ends_at) IS DISTINCT FROM ROW(proof.new_starts_at, proof.new_ends_at) OR
     ROW(planned.court_id, planned.court_name, planned.starts_at, planned.ends_at) IS DISTINCT FROM
     ROW(proof.new_court_id, proof.new_court_name, proof.new_starts_at, proof.new_ends_at) THEN
    RAISE EXCEPTION 'Reservation update requires exact transaction rescheduling proof' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'court_reservations' THEN
    IF OLD.court_id IS DISTINCT FROM proof.old_court_id OR NEW.court_id IS DISTINCT FROM proof.new_court_id THEN
      RAISE EXCEPTION 'Court reservation must match the rescheduled court' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.team_id NOT IN (planned.home_team_id, planned.away_team_id) THEN
    RAISE EXCEPTION 'Team reservation must keep the published participant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER court_reservations_immutable ON court_reservations;
DROP TRIGGER team_reservations_immutable ON team_reservations;
CREATE TRIGGER court_reservations_update_guard BEFORE UPDATE ON court_reservations
  FOR EACH ROW EXECUTE FUNCTION p04b_reservation_update_guard();
CREATE TRIGGER team_reservations_update_guard BEFORE UPDATE ON team_reservations
  FOR EACH ROW EXECUTE FUNCTION p04b_reservation_update_guard();
CREATE TRIGGER court_reservations_no_delete BEFORE DELETE ON court_reservations
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();
CREATE TRIGGER team_reservations_no_delete BEFORE DELETE ON team_reservations
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE FUNCTION p04b_reschedule_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_match published_matches%ROWTYPE;
BEGIN
  SELECT * INTO current_match FROM published_matches WHERE org_id = NEW.org_id AND event_id = NEW.event_id AND id = NEW.match_id;
  IF NOT FOUND OR current_match.version <> NEW.to_match_version OR current_match.status NOT IN ('SCHEDULED', 'READY') OR
     ROW(current_match.court_id, current_match.court_name, current_match.starts_at, current_match.ends_at) IS DISTINCT FROM
     ROW(NEW.new_court_id, NEW.new_court_name, NEW.new_starts_at, NEW.new_ends_at) OR
     NOT EXISTS (SELECT 1 FROM events WHERE org_id = NEW.org_id AND id = NEW.event_id AND version = NEW.to_event_version AND status IN ('SCHEDULED', 'RUNNING')) OR
     EXISTS (SELECT 1 FROM scoring_events WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND type = 'START_MATCH') THEN
    RAISE EXCEPTION 'Rescheduling history and current plan must commit together' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM court_reservations WHERE org_id = NEW.org_id AND match_id = NEW.match_id) <> 1 OR
     NOT EXISTS (SELECT 1 FROM court_reservations WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND
       publication_id = current_match.publication_id AND court_id = NEW.new_court_id AND starts_at = NEW.new_starts_at AND ends_at = NEW.new_ends_at) OR
     (SELECT count(*) FROM team_reservations WHERE org_id = NEW.org_id AND match_id = NEW.match_id) <> 2 OR
     (SELECT count(*) FROM team_reservations WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND
       publication_id = current_match.publication_id AND team_id IN (current_match.home_team_id, current_match.away_team_id) AND
       starts_at = NEW.new_starts_at AND ends_at = NEW.new_ends_at) <> 2 THEN
    RAISE EXCEPTION 'Rescheduling must atomically replace every reservation' USING ERRCODE = '23514';
  END IF;
  IF (current_match.status = 'SCHEDULED' AND EXISTS (SELECT 1 FROM scoring_states WHERE org_id = NEW.org_id AND match_id = NEW.match_id)) OR
     (current_match.status = 'READY' AND NOT EXISTS (SELECT 1 FROM scoring_states WHERE org_id = NEW.org_id AND match_id = NEW.match_id AND source_version = current_match.version AND clock_running = false)) THEN
    RAISE EXCEPTION 'Rescheduling must preserve the scoring projection version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER match_reschedules_commit_guard AFTER INSERT ON match_reschedules
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p04b_reschedule_commit_guard();
