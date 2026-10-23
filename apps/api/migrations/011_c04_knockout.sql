-- C04 preserves original published match/scoring identities. Only complete,
-- transaction-bound round proofs may append later knockout fixtures.
ALTER TABLE schedule_revisions DROP CONSTRAINT schedule_revisions_algorithm_version_check;
ALTER TABLE schedule_revisions ADD CONSTRAINT schedule_revisions_algorithm_version_check
  CHECK (algorithm_version IN ('RR_CIRCLE_V1', 'SE_SEEDED_V1'));

CREATE TABLE knockout_round_publications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  round_no integer NOT NULL CHECK (round_no BETWEEN 2 AND 5),
  transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  from_event_version integer NOT NULL CHECK (from_event_version > 0),
  to_event_version integer NOT NULL CHECK (to_event_version = from_event_version + 1),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) BETWEEN 1 AND 16),
  fixtures jsonb NOT NULL CHECK (jsonb_typeof(fixtures) = 'array' AND jsonb_array_length(fixtures) BETWEEN 1 AND 8),
  reason text NOT NULL CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 4 AND 500),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, event_id, round_no),
  FOREIGN KEY (org_id, event_id, publication_id, revision_id)
    REFERENCES schedule_publications(org_id, event_id, id, revision_id)
);
CREATE INDEX knockout_round_sources ON knockout_round_publications USING gin (sources jsonb_path_ops);
CREATE TRIGGER knockout_round_publications_immutable BEFORE UPDATE OR DELETE ON knockout_round_publications
  FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE FUNCTION c04_seed_positions(bracket_size integer) RETURNS integer[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result integer[] := ARRAY[1,2];
  expanded integer[];
  item integer;
BEGIN
  IF bracket_size NOT IN (2,4,8,16,32) THEN
    RAISE EXCEPTION 'Unsupported knockout bracket size' USING ERRCODE = '23514';
  END IF;
  WHILE cardinality(result) < bracket_size LOOP
    expanded := ARRAY[]::integer[];
    FOREACH item IN ARRAY result LOOP
      expanded := expanded || ARRAY[item, cardinality(result) * 2 + 1 - item];
    END LOOP;
    result := expanded;
  END LOOP;
  RETURN result;
END;
$$;

CREATE FUNCTION c04_round_fixture_proof(scope_org uuid, scope_revision uuid, scope_key text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT fixture.value FROM knockout_round_publications p
    CROSS JOIN LATERAL jsonb_array_elements(p.fixtures) fixture(value)
    WHERE p.org_id=scope_org AND p.revision_id=scope_revision
      AND p.transaction_id=pg_current_xact_id() AND fixture.value->>'fixtureKey'=scope_key;
$$;

CREATE FUNCTION c04_round_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_event events%ROWTYPE;
  revision schedule_revisions%ROWTYPE;
  bracket_size integer := 2;
  positions integer[];
  previous_count integer;
  fixture jsonb;
  source jsonb;
  target_match published_matches%ROWTYPE;
  target_state scoring_states%ROWTYPE;
  confirmation result_confirmations%ROWTYPE;
  expected_home uuid;
  expected_away uuid;
  first_entry text;
  second_entry text;
  slot integer;
  side integer;
  winner uuid;
  participant jsonb;
BEGIN
  IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'Knockout proof must belong to the current transaction' USING ERRCODE='23514';
  END IF;
  PERFORM org_id FROM org_schedule_mutex WHERE org_id=NEW.org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Knockout publication needs organization mutex' USING ERRCODE='23514'; END IF;
  SELECT * INTO current_event FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id FOR UPDATE;
  IF NOT FOUND OR current_event.format<>'SINGLE_ELIMINATION' OR current_event.status NOT IN ('SCHEDULED','RUNNING') OR
      current_event.version<>NEW.from_event_version OR current_event.current_schedule_revision_id<>NEW.revision_id THEN
    RAISE EXCEPTION 'Knockout publication needs current active event version' USING ERRCODE='23514';
  END IF;
  SELECT * INTO revision FROM schedule_revisions WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND id=NEW.revision_id FOR SHARE;
  IF NOT FOUND OR revision.status<>'PUBLISHED' OR revision.algorithm_version<>'SE_SEEDED_V1' THEN
    RAISE EXCEPTION 'Knockout publication needs immutable seeded source' USING ERRCODE='23514';
  END IF;
  WHILE bracket_size<jsonb_array_length(revision.ordered_entry_ids) LOOP bracket_size:=bracket_size*2; END LOOP;
  positions:=c04_seed_positions(bracket_size);
  IF power(2,NEW.round_no)>bracket_size OR jsonb_array_length(NEW.fixtures)<>bracket_size/power(2,NEW.round_no)::integer OR
      (NEW.round_no>2 AND NOT EXISTS(SELECT 1 FROM knockout_round_publications WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND round_no=NEW.round_no-1)) OR
      EXISTS(SELECT 1 FROM published_matches WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND round_no>=NEW.round_no) THEN
    RAISE EXCEPTION 'Only the next full knockout round may be published' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO previous_count FROM published_matches WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND round_no=NEW.round_no-1;
  IF previous_count<>jsonb_array_length(NEW.sources) OR
     (SELECT count(DISTINCT value->>'matchId') FROM jsonb_array_elements(NEW.sources))<>previous_count OR
     (SELECT count(DISTINCT value->>'fixtureKey') FROM jsonb_array_elements(NEW.fixtures))<>jsonb_array_length(NEW.fixtures) OR
     (SELECT count(DISTINCT value->>'matchId') FROM jsonb_array_elements(NEW.fixtures))<>jsonb_array_length(NEW.fixtures) THEN
    RAISE EXCEPTION 'Knockout proof must exactly cover source and target matches' USING ERRCODE='23514';
  END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(NEW.sources) LOOP
    SELECT * INTO target_match FROM published_matches WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND id=(source->>'matchId')::uuid FOR SHARE;
    IF NOT FOUND OR target_match.round_no<>NEW.round_no-1 OR target_match.status<>'FINAL' OR
       target_match.fixture_key IS DISTINCT FROM source->>'fixtureKey' THEN
      RAISE EXCEPTION 'Knockout source must be the exact current FINAL match' USING ERRCODE='23514';
    END IF;
    SELECT * INTO target_state FROM scoring_states WHERE org_id=NEW.org_id AND match_id=target_match.id;
    SELECT * INTO confirmation FROM result_confirmations WHERE org_id=NEW.org_id AND match_id=target_match.id AND id=(source->>'confirmationId')::uuid;
    IF NOT FOUND OR target_state.latest_confirmation_id IS DISTINCT FROM confirmation.id OR target_state.source_version IS DISTINCT FROM target_match.version OR
       target_state.requires_reconfirmation IS DISTINCT FROM false OR target_state.clock_running IS DISTINCT FROM false OR
       confirmation.source_match_version+1 IS DISTINCT FROM (source->>'matchVersion')::integer OR
       confirmation.source_match_version+1>target_match.version OR confirmation.home_score=confirmation.away_score OR
       confirmation.home_score IS DISTINCT FROM target_state.home_score OR confirmation.away_score IS DISTINCT FROM target_state.away_score OR
       confirmation.last_event_seq+1 IS DISTINCT FROM target_state.last_event_seq THEN
      RAISE EXCEPTION 'Knockout source confirmation is no longer current' USING ERRCODE='23514';
    END IF;
    winner:=CASE WHEN confirmation.home_score>confirmation.away_score THEN target_match.home_entry_id ELSE target_match.away_entry_id END;
    IF winner IS DISTINCT FROM (source->>'winnerEntryId')::uuid THEN
      RAISE EXCEPTION 'Knockout source winner must match confirmed score' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOR fixture IN SELECT value FROM jsonb_array_elements(NEW.fixtures) LOOP
    slot:=(fixture->>'positionNo')::integer;
    IF (fixture->>'roundNo')::integer IS DISTINCT FROM NEW.round_no OR slot NOT BETWEEN 1 AND jsonb_array_length(NEW.fixtures) OR
        fixture->>'fixtureKey' IS DISTINCT FROM 'R'||NEW.round_no||'-P'||slot THEN
      RAISE EXCEPTION 'Knockout target coordinates are invalid' USING ERRCODE='23514';
    END IF;
    expected_home:=NULL; expected_away:=NULL;
    FOR side IN 0..1 LOOP
      SELECT (value->>'winnerEntryId')::uuid INTO winner FROM jsonb_array_elements(NEW.sources)
        WHERE value->>'fixtureKey'='R'||(NEW.round_no-1)||'-P'||(slot*2-1+side);
      IF winner IS NULL AND NEW.round_no=2 THEN
        first_entry:=revision.ordered_entry_ids->>(positions[(slot*2-2+side)*2+1]-1);
        second_entry:=revision.ordered_entry_ids->>(positions[(slot*2-2+side)*2+2]-1);
        IF (first_entry IS NULL)=(second_entry IS NULL) THEN
          RAISE EXCEPTION 'Only initial genuine byes may advance without confirmation' USING ERRCODE='23514';
        END IF;
        winner:=COALESCE(first_entry,second_entry)::uuid;
      END IF;
      IF side=0 THEN expected_home:=winner; ELSE expected_away:=winner; END IF;
    END LOOP;
    IF expected_home IS NULL OR expected_away IS NULL OR
       expected_home IS DISTINCT FROM (fixture->>'homeEntryId')::uuid OR expected_away IS DISTINCT FROM (fixture->>'awayEntryId')::uuid THEN
      RAISE EXCEPTION 'Knockout target participants do not follow their fixed bracket sources' USING ERRCODE='23514';
    END IF;
    FOR side IN 0..1 LOOP
      SELECT value INTO participant FROM jsonb_array_elements(revision.source->'entries')
        WHERE value->>'entryId'=CASE WHEN side=0 THEN fixture->>'homeEntryId' ELSE fixture->>'awayEntryId' END;
      IF participant IS NULL OR participant->>'teamId' IS DISTINCT FROM fixture->>(CASE WHEN side=0 THEN 'homeTeamId' ELSE 'awayTeamId' END) OR
         participant->>'teamName' IS DISTINCT FROM fixture->>(CASE WHEN side=0 THEN 'homeTeamName' ELSE 'awayTeamName' END) OR
         participant->>'rosterRevisionId' IS DISTINCT FROM fixture->>(CASE WHEN side=0 THEN 'homeRosterRevisionId' ELSE 'awayRosterRevisionId' END) THEN
        RAISE EXCEPTION 'Knockout target must retain frozen team and roster identities' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER knockout_round_publications_insert_guard BEFORE INSERT ON knockout_round_publications
  FOR EACH ROW EXECUTE FUNCTION c04_round_insert_guard();

CREATE FUNCTION c04_round_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fixture jsonb;
  planned published_matches%ROWTYPE;
  source_fixture schedule_fixtures%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id AND version=NEW.to_event_version AND status IN ('SCHEDULED','RUNNING')) OR
     (SELECT count(*) FROM published_matches WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND round_no=NEW.round_no)<>jsonb_array_length(NEW.fixtures) OR
     (SELECT count(*) FROM schedule_fixtures WHERE org_id=NEW.org_id AND revision_id=NEW.revision_id AND round_no=NEW.round_no)<>jsonb_array_length(NEW.fixtures) THEN
    RAISE EXCEPTION 'Knockout proof, complete target round and event version must commit together' USING ERRCODE='23514';
  END IF;
  FOR fixture IN SELECT value FROM jsonb_array_elements(NEW.fixtures) LOOP
    SELECT * INTO planned FROM published_matches WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND id=(fixture->>'matchId')::uuid;
    SELECT * INTO source_fixture FROM schedule_fixtures WHERE org_id=NEW.org_id AND revision_id=NEW.revision_id AND fixture_key=fixture->>'fixtureKey';
    IF planned.id IS NULL OR source_fixture.fixture_key IS NULL OR planned.publication_id<>NEW.publication_id OR planned.revision_id<>NEW.revision_id OR planned.status<>'SCHEDULED' OR planned.version<>1 OR
       ROW(planned.fixture_key,planned.round_no,planned.position_no,planned.home_entry_id,planned.away_entry_id,planned.home_team_id,planned.away_team_id,planned.home_team_name,planned.away_team_name,planned.home_roster_revision_id,planned.away_roster_revision_id,planned.court_id,planned.court_name,planned.starts_at,planned.ends_at) IS DISTINCT FROM
       ROW(fixture->>'fixtureKey',(fixture->>'roundNo')::integer,(fixture->>'positionNo')::integer,(fixture->>'homeEntryId')::uuid,(fixture->>'awayEntryId')::uuid,(fixture->>'homeTeamId')::uuid,(fixture->>'awayTeamId')::uuid,fixture->>'homeTeamName',fixture->>'awayTeamName',(fixture->>'homeRosterRevisionId')::uuid,(fixture->>'awayRosterRevisionId')::uuid,(fixture->>'courtId')::uuid,fixture->>'courtName',(fixture->>'startsAt')::timestamptz,(fixture->>'endsAt')::timestamptz) OR
       ROW(source_fixture.round_no,source_fixture.position_no,source_fixture.home_entry_id,source_fixture.away_entry_id,source_fixture.home_team_id,source_fixture.away_team_id,source_fixture.court_id,source_fixture.starts_at,source_fixture.ends_at) IS DISTINCT FROM
       ROW(planned.round_no,planned.position_no,planned.home_entry_id,planned.away_entry_id,planned.home_team_id,planned.away_team_id,planned.court_id,planned.starts_at,planned.ends_at) OR
       (SELECT count(*) FROM court_reservations WHERE org_id=NEW.org_id AND match_id=planned.id AND publication_id=NEW.publication_id AND court_id=planned.court_id AND starts_at=planned.starts_at AND ends_at=planned.ends_at)<>1 OR
       (SELECT count(*) FROM team_reservations WHERE org_id=NEW.org_id AND match_id=planned.id AND publication_id=NEW.publication_id AND team_id IN (planned.home_team_id,planned.away_team_id) AND starts_at=planned.starts_at AND ends_at=planned.ends_at)<>2 THEN
      RAISE EXCEPTION 'Knockout round must atomically insert exact fixtures, matches and every reservation' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER knockout_round_publications_commit_guard AFTER INSERT ON knockout_round_publications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c04_round_commit_guard();


CREATE OR REPLACE FUNCTION p04_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_matches integer;
  target_publication_id uuid;
  bracket_size integer := 2;
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
    IF NEW.algorithm_version='SE_SEEDED_V1' THEN
      WHILE bracket_size<jsonb_array_length(NEW.ordered_entry_ids) LOOP bracket_size:=bracket_size*2; END LOOP;
      expected_matches:=jsonb_array_length(NEW.ordered_entry_ids)-bracket_size/2;
    ELSE
      expected_matches := jsonb_array_length(NEW.ordered_entry_ids) * (jsonb_array_length(NEW.ordered_entry_ids) - 1) / 2;
    END IF;
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

CREATE OR REPLACE FUNCTION p04_fixture_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Scheduling fixtures cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT r.status INTO revision_status FROM schedule_revisions r
    WHERE r.org_id = NEW.org_id AND r.event_id = NEW.event_id AND r.id = NEW.revision_id FOR SHARE;
  IF TG_OP='INSERT' AND revision_status='PUBLISHED' AND
     c04_round_fixture_proof(NEW.org_id,NEW.revision_id,NEW.fixture_key) IS NOT NULL THEN
    RETURN NEW;
  END IF;
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
  IF (revision_status IS DISTINCT FROM 'DRAFT' AND
      NOT (revision_status='PUBLISHED' AND c04_round_fixture_proof(NEW.org_id,NEW.revision_id,NEW.fixture_key) IS NOT NULL)) OR
      NEW.status <> 'SCHEDULED' OR NEW.version <> 1 THEN
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

CREATE OR REPLACE FUNCTION p04_reservation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF (revision_status IS DISTINCT FROM 'DRAFT' AND
      NOT (revision_status='PUBLISHED' AND c04_round_fixture_proof(planned.org_id,planned.revision_id,planned.fixture_key) IS NOT NULL)) OR
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

ALTER TABLE public_event_publications ALTER COLUMN ruleset_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION p05b_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked_ruleset uuid;
  event_format text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Public publications cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_xid <> pg_current_xact_id() OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL THEN
      RAISE EXCEPTION 'A public publication must start active in its creating transaction' USING ERRCODE = '23514';
    END IF;
    SELECT e.locked_standings_ruleset_id,e.format INTO locked_ruleset,event_format FROM events e
      WHERE e.org_id = NEW.org_id AND e.id = NEW.event_id FOR SHARE;
    IF (event_format='SINGLE_ELIMINATION' AND NEW.ruleset_id IS NOT NULL) OR
       (event_format IS DISTINCT FROM 'SINGLE_ELIMINATION' AND (locked_ruleset IS NULL OR locked_ruleset IS DISTINCT FROM NEW.ruleset_id)) THEN
      RAISE EXCEPTION 'Public viewing requires the formally locked standings ruleset' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL OR
     (to_jsonb(NEW) - ARRAY['revoked_at', 'revoked_by']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['revoked_at', 'revoked_by']) THEN
    RAISE EXCEPTION 'Public publications may only transition once from active to revoked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION p05b_publication_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  frozen_entries jsonb;
  event_format text;
  algorithm text;
  revision_status text;
  expected_team_count integer;
  distinct_entry_count integer;
  expected_match_count integer;
  actual_link_count integer;
  mapped_team_count integer;
  distinct_public_key_count integer;
BEGIN
  SELECT r.source -> 'entries',e.format,r.algorithm_version,r.status INTO frozen_entries,event_format,algorithm,revision_status FROM schedule_publications p
    JOIN schedule_revisions r ON r.org_id = p.org_id AND r.event_id = p.event_id AND r.id = p.revision_id
    JOIN events e ON e.org_id=p.org_id AND e.id=p.event_id
    WHERE p.org_id = NEW.org_id AND p.event_id = NEW.event_id AND p.id = NEW.schedule_publication_id;
  IF frozen_entries IS NULL OR jsonb_typeof(frozen_entries) <> 'array' OR
     (event_format='SINGLE_ELIMINATION' AND (algorithm<>'SE_SEEDED_V1' OR revision_status<>'PUBLISHED')) THEN
    RAISE EXCEPTION 'Public publication requires its immutable schedule participants' USING ERRCODE = '23514';
  END IF;
  expected_team_count := jsonb_array_length(frozen_entries);
  SELECT count(DISTINCT participant.value ->> 'entryId') INTO distinct_entry_count
    FROM jsonb_array_elements(frozen_entries) AS participant(value);
  IF expected_team_count NOT BETWEEN 2 AND 32 OR distinct_entry_count <> expected_team_count THEN
    RAISE EXCEPTION 'Public schedule participants must be complete and distinct' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), count(DISTINCT mapping.value) INTO mapped_team_count, distinct_public_key_count
    FROM jsonb_each(NEW.team_keys) AS mapping;
  IF mapped_team_count <> expected_team_count OR distinct_public_key_count <> expected_team_count OR
     EXISTS (SELECT 1 FROM jsonb_each(NEW.team_keys) AS mapping
       WHERE jsonb_typeof(mapping.value) <> 'string' OR (mapping.value #>> '{}') !~ '^[A-Za-z0-9_-]{22}$') OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(frozen_entries) AS participant(value)
       WHERE NOT (NEW.team_keys ? (participant.value ->> 'entryId'))) THEN
    RAISE EXCEPTION 'Public team keys must exactly cover the frozen schedule participants' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO expected_match_count FROM published_matches m
    WHERE m.org_id = NEW.org_id AND m.event_id = NEW.event_id AND m.publication_id = NEW.schedule_publication_id;
  SELECT count(*) INTO actual_link_count FROM public_match_links link
    WHERE link.org_id = NEW.org_id AND link.event_id = NEW.event_id AND link.publication_id = NEW.id;
  IF (event_format='ROUND_ROBIN' AND expected_match_count <> expected_team_count * (expected_team_count - 1) / 2) OR
     (event_format='SINGLE_ELIMINATION' AND expected_match_count NOT BETWEEN 1 AND expected_team_count-1) OR
     event_format NOT IN ('ROUND_ROBIN','SINGLE_ELIMINATION') OR actual_link_count <> expected_match_count THEN
    RAISE EXCEPTION 'Public publication must map every official schedule match atomically' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
