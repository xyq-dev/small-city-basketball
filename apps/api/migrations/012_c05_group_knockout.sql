-- Original matches, scoring events and confirmations remain the sole result source.
ALTER TABLE schedule_revisions DROP CONSTRAINT schedule_revisions_algorithm_version_check;
ALTER TABLE schedule_revisions ADD CONSTRAINT schedule_revisions_algorithm_version_check CHECK (algorithm_version IN ('RR_CIRCLE_V1','SE_SEEDED_V1','GK_BALANCED_V1'));
ALTER TABLE schedule_revisions ADD COLUMN group_config jsonb;
ALTER TABLE schedule_revisions ADD CONSTRAINT schedule_revisions_group_config_check CHECK (
 (algorithm_version='GK_BALANCED_V1' AND group_config IS NOT NULL AND jsonb_typeof(group_config)='object' AND (group_config->>'groupCount') IS NOT NULL AND (group_config->>'groupCount')::integer IN (2,4,8) AND jsonb_typeof(group_config->'seededEntryIds') IS NOT DISTINCT FROM 'array') OR
 (algorithm_version<>'GK_BALANCED_V1' AND group_config IS NULL));
ALTER TABLE knockout_round_publications DROP CONSTRAINT knockout_round_publications_round_no_check;
ALTER TABLE knockout_round_publications ADD CONSTRAINT knockout_round_publications_round_no_check CHECK (round_no BETWEEN 2 AND 31);

CREATE TABLE group_tiebreak_draws (
 id uuid PRIMARY KEY,org_id uuid NOT NULL,event_id uuid NOT NULL,revision_id uuid NOT NULL,
 group_key text NOT NULL CHECK(group_key ~ '^[A-H]$'),source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 seed char(64) NOT NULL CHECK(seed ~ '^[0-9a-f]{64}$'),
 tied_entry_ids jsonb NOT NULL CHECK(jsonb_typeof(tied_entry_ids)='array' AND jsonb_array_length(tied_entry_ids) BETWEEN 2 AND 16),
 ordered_entry_ids jsonb NOT NULL CHECK(jsonb_typeof(ordered_entry_ids)='array' AND jsonb_array_length(ordered_entry_ids)=jsonb_array_length(tied_entry_ids)),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array' AND jsonb_array_length(sources) BETWEEN 1 AND 120),
 ruleset_id uuid NOT NULL,reason text NOT NULL CHECK(reason=btrim(reason) AND char_length(reason) BETWEEN 4 AND 500),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,event_id,group_key,source_hash),FOREIGN KEY(org_id,event_id,revision_id)REFERENCES schedule_revisions(org_id,event_id,id),
 FOREIGN KEY(org_id,event_id,ruleset_id)REFERENCES standings_rulesets(org_id,event_id,id));
CREATE TABLE group_qualification_publications (
 id uuid PRIMARY KEY,org_id uuid NOT NULL,event_id uuid NOT NULL,publication_id uuid NOT NULL,revision_id uuid NOT NULL,
 round_no integer NOT NULL CHECK(round_no BETWEEN 2 AND 16),transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
 from_event_version integer NOT NULL CHECK(from_event_version>0),to_event_version integer NOT NULL CHECK(to_event_version=from_event_version+1),
 source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array' AND jsonb_array_length(sources) BETWEEN 2 AND 240),
 slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots) IN (4,8,16)),
 draw_ids jsonb NOT NULL CHECK(jsonb_typeof(draw_ids)='array' AND jsonb_array_length(draw_ids)<=8),
 fixtures jsonb NOT NULL CHECK(jsonb_typeof(fixtures)='array' AND jsonb_array_length(fixtures) IN (2,4,8)),
 ruleset_id uuid NOT NULL,reason text NOT NULL CHECK(reason=btrim(reason) AND char_length(reason) BETWEEN 4 AND 500),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,event_id),FOREIGN KEY(org_id,event_id,publication_id,revision_id)REFERENCES schedule_publications(org_id,event_id,id,revision_id),
 FOREIGN KEY(org_id,event_id,ruleset_id)REFERENCES standings_rulesets(org_id,event_id,id));
CREATE INDEX group_qualification_sources ON group_qualification_publications USING gin(sources jsonb_path_ops);
CREATE TRIGGER group_tiebreak_draws_immutable BEFORE UPDATE OR DELETE ON group_tiebreak_draws FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();
CREATE TRIGGER group_qualification_publications_immutable BEFORE UPDATE OR DELETE ON group_qualification_publications FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE FUNCTION c05_group_members(scope_org uuid,scope_revision uuid) RETURNS TABLE(entry_id uuid,group_key text) LANGUAGE sql STABLE AS $$
 SELECT (item.value #>> '{}')::uuid,chr(65+CASE WHEN ((item.ordinality-1)/(r.group_config->>'groupCount')::integer)%2=1
 THEN (r.group_config->>'groupCount')::integer-1-((item.ordinality-1)%(r.group_config->>'groupCount')::integer)::integer
 ELSE ((item.ordinality-1)%(r.group_config->>'groupCount')::integer)::integer END)
 FROM schedule_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.ordered_entry_ids) WITH ORDINALITY item(value,ordinality)
 WHERE r.org_id=scope_org AND r.id=scope_revision AND r.algorithm_version='GK_BALANCED_V1';
$$;
CREATE FUNCTION c05_group_rankings(scope_org uuid,scope_event uuid,scope_revision uuid,scope_ruleset uuid)
 RETURNS TABLE(entry_id uuid,group_key text,rank_no bigint) LANGUAGE sql STABLE AS $$
 WITH totals AS (
 SELECT g.entry_id,g.group_key,
 COALESCE(sum(CASE WHEN (m.home_entry_id=g.entry_id AND c.home_score>c.away_score) OR (m.away_entry_id=g.entry_id AND c.away_score>c.home_score) THEN r.win_points ELSE r.loss_points END) FILTER(WHERE c.id IS NOT NULL),0) AS league_points,
 COALESCE(sum(CASE WHEN m.home_entry_id=g.entry_id THEN c.home_score-c.away_score ELSE c.away_score-c.home_score END),0) AS score_difference,
 COALESCE(sum(CASE WHEN m.home_entry_id=g.entry_id THEN c.home_score ELSE c.away_score END),0) AS points_for,
 count(c.id) FILTER(WHERE (m.home_entry_id=g.entry_id AND c.home_score>c.away_score) OR (m.away_entry_id=g.entry_id AND c.away_score>c.home_score)) AS wins,
 r.tiebreakers
 FROM c05_group_members(scope_org,scope_revision) g
 JOIN standings_rulesets r ON r.org_id=scope_org AND r.event_id=scope_event AND r.id=scope_ruleset
 LEFT JOIN published_matches m ON m.org_id=scope_org AND m.event_id=scope_event AND (m.home_entry_id=g.entry_id OR m.away_entry_id=g.entry_id)
   AND EXISTS(SELECT 1 FROM c05_group_members(scope_org,scope_revision) other WHERE other.group_key=g.group_key AND other.entry_id=CASE WHEN m.home_entry_id=g.entry_id THEN m.away_entry_id ELSE m.home_entry_id END)
   AND m.round_no<COALESCE((SELECT round_no FROM group_qualification_publications WHERE org_id=scope_org AND event_id=scope_event),32)
 LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id
 LEFT JOIN result_confirmations c ON c.org_id=m.org_id AND c.match_id=m.id AND c.id=s.latest_confirmation_id AND m.status='FINAL'
 GROUP BY g.entry_id,g.group_key,r.tiebreakers
 ) SELECT entry_id,group_key,rank() OVER(PARTITION BY group_key ORDER BY league_points DESC,
 CASE tiebreakers[1] WHEN 'SCORE_DIFFERENCE' THEN score_difference WHEN 'POINTS_FOR' THEN points_for WHEN 'WINS' THEN wins END DESC NULLS LAST,
 CASE tiebreakers[2] WHEN 'SCORE_DIFFERENCE' THEN score_difference WHEN 'POINTS_FOR' THEN points_for WHEN 'WINS' THEN wins END DESC NULLS LAST,
 CASE tiebreakers[3] WHEN 'SCORE_DIFFERENCE' THEN score_difference WHEN 'POINTS_FOR' THEN points_for WHEN 'WINS' THEN wins END DESC NULLS LAST) FROM totals;
$$;
CREATE FUNCTION c05_assert_group_sources(scope_org uuid,scope_event uuid,scope_revision uuid,sources jsonb,scope_group text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item jsonb;m published_matches%ROWTYPE;s scoring_states%ROWTYPE;c result_confirmations%ROWTYPE;expected integer;
BEGIN
 SELECT count(*) INTO expected FROM published_matches pm WHERE pm.org_id=scope_org AND pm.event_id=scope_event
  AND EXISTS(SELECT 1 FROM c05_group_members(scope_org,scope_revision) gm WHERE gm.entry_id=pm.home_entry_id AND (scope_group IS NULL OR gm.group_key=scope_group))
  AND NOT EXISTS(SELECT 1 FROM group_qualification_publications q WHERE q.org_id=scope_org AND q.event_id=scope_event AND pm.round_no>=q.round_no);
 IF expected<>jsonb_array_length(sources) OR expected<>(SELECT count(DISTINCT value->>'matchId') FROM jsonb_array_elements(sources)) THEN
  RAISE EXCEPTION 'Group sources must exactly cover all original group matches' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(sources) LOOP
  SELECT * INTO m FROM published_matches WHERE org_id=scope_org AND event_id=scope_event AND id=(item->>'matchId')::uuid;
  IF NOT FOUND OR m.status<>'FINAL' OR m.fixture_key IS DISTINCT FROM item->>'fixtureKey' OR
   NOT EXISTS(SELECT 1 FROM c05_group_members(scope_org,scope_revision) a JOIN c05_group_members(scope_org,scope_revision) b ON a.group_key=b.group_key WHERE a.entry_id=m.home_entry_id AND b.entry_id=m.away_entry_id AND (scope_group IS NULL OR a.group_key=scope_group)) THEN
   RAISE EXCEPTION 'Group source match is not current FINAL in its original group' USING ERRCODE='23514';END IF;
  SELECT * INTO s FROM scoring_states WHERE org_id=scope_org AND match_id=m.id;
  SELECT * INTO c FROM result_confirmations WHERE org_id=scope_org AND match_id=m.id AND id=(item->>'confirmationId')::uuid;
  IF NOT FOUND OR s.latest_confirmation_id IS DISTINCT FROM c.id OR s.source_version IS DISTINCT FROM m.version OR s.requires_reconfirmation IS DISTINCT FROM false OR s.clock_running IS DISTINCT FROM false OR
   c.source_match_version+1 IS DISTINCT FROM (item->>'matchVersion')::integer OR c.source_match_version+1>m.version OR c.home_score=c.away_score OR c.home_score IS DISTINCT FROM s.home_score OR c.away_score IS DISTINCT FROM s.away_score OR c.last_event_seq+1 IS DISTINCT FROM s.last_event_seq OR
   (item->>'winnerEntryId')::uuid IS DISTINCT FROM CASE WHEN c.home_score>c.away_score THEN m.home_entry_id ELSE m.away_entry_id END THEN
   RAISE EXCEPTION 'Group source confirmation must be effective and unchanged' USING ERRCODE='23514';END IF;
 END LOOP;
END;
$$;
CREATE FUNCTION c05_draw_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e events%ROWTYPE;expected jsonb;actual jsonb;
BEGIN
 SELECT * INTO e FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id FOR UPDATE;
 IF NOT FOUND OR e.format<>'GROUP_KNOCKOUT' OR e.status NOT IN ('SCHEDULED','RUNNING') OR e.current_schedule_revision_id<>NEW.revision_id OR e.locked_standings_ruleset_id IS DISTINCT FROM NEW.ruleset_id OR EXISTS(SELECT 1 FROM group_qualification_publications WHERE org_id=NEW.org_id AND event_id=NEW.event_id) THEN
 RAISE EXCEPTION 'Group draw requires current active group stage and locked ranking rules' USING ERRCODE='23514';END IF;
 PERFORM c05_assert_group_sources(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.sources,NEW.group_key);
 SELECT jsonb_agg(to_jsonb(r.entry_id::text) ORDER BY r.entry_id::text) INTO expected FROM c05_group_rankings(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.ruleset_id) r
 WHERE r.group_key=NEW.group_key AND r.rank_no IN(SELECT x.rank_no FROM c05_group_rankings(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.ruleset_id) x WHERE x.group_key=NEW.group_key AND x.rank_no<=2 GROUP BY x.rank_no HAVING count(*)>1);
 SELECT jsonb_agg(value ORDER BY value #>> '{}') INTO actual FROM jsonb_array_elements(NEW.tied_entry_ids);
 IF expected IS NULL OR expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Draw must cover precisely the unresolved qualification tie' USING ERRCODE='23514';END IF;
 SELECT jsonb_agg(value ORDER BY encode(sha256(convert_to('["'||NEW.seed||'","'||(value #>> '{}')||'"]','UTF8')),'hex'),value #>> '{}') INTO actual FROM jsonb_array_elements(NEW.tied_entry_ids);
 IF NEW.ordered_entry_ids IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Draw order must replay the recorded seed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER group_tiebreak_draws_insert_guard BEFORE INSERT ON group_tiebreak_draws FOR EACH ROW EXECUTE FUNCTION c05_draw_guard();
CREATE FUNCTION c05_qualification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e events%ROWTYPE;r schedule_revisions%ROWTYPE;g integer;k integer;max_size integer;group_index integer;group_key_value text;top_entries jsonb;top_by_group jsonb:='{}';fixed_slots jsonb:='[]';half integer;pair_index integer;fixture jsonb;used_draws jsonb:='[]';participant jsonb;side integer;position integer;d group_tiebreak_draws%ROWTYPE;tie jsonb;subset jsonb;
BEGIN
 IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id() THEN RAISE EXCEPTION 'Qualification proof must belong to current transaction' USING ERRCODE='23514';END IF;
 PERFORM org_id FROM org_schedule_mutex WHERE org_id=NEW.org_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Qualification needs organization schedule mutex' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id FOR UPDATE;
 SELECT * INTO r FROM schedule_revisions WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND id=NEW.revision_id;
 IF e.format IS DISTINCT FROM 'GROUP_KNOCKOUT' OR e.status NOT IN ('SCHEDULED','RUNNING') OR e.version<>NEW.from_event_version OR e.current_schedule_revision_id<>NEW.revision_id OR r.algorithm_version IS DISTINCT FROM 'GK_BALANCED_V1' OR r.status<>'PUBLISHED' OR e.locked_standings_ruleset_id IS DISTINCT FROM NEW.ruleset_id THEN
 RAISE EXCEPTION 'Qualification needs current published group stage and locked rules' USING ERRCODE='23514';END IF;
 g:=(r.group_config->>'groupCount')::integer;max_size:=ceil(jsonb_array_length(r.ordered_entry_ids)::numeric/g);k:=CASE WHEN max_size%2=0 THEN max_size-1 ELSE max_size END;
 IF NEW.round_no<>k+1 OR jsonb_array_length(NEW.slots)<>g*2 OR jsonb_array_length(NEW.fixtures)<>g OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW.slots))<>g*2 OR EXISTS(SELECT 1 FROM published_matches WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND round_no>k) THEN
 RAISE EXCEPTION 'Qualification must publish the first complete fixed knockout round' USING ERRCODE='23514';END IF;
 PERFORM c05_assert_group_sources(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.sources);
 FOR group_index IN 0..g-1 LOOP
  group_key_value:=chr(65+group_index);
  SELECT jsonb_agg(to_jsonb(x.entry_id::text) ORDER BY x.entry_id::text) INTO tie FROM c05_group_rankings(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.ruleset_id) x
   WHERE x.group_key=group_key_value AND x.rank_no IN(SELECT a.rank_no FROM c05_group_rankings(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.ruleset_id) a WHERE a.group_key=group_key_value AND a.rank_no<=2 GROUP BY a.rank_no HAVING count(*)>1);
  d:=NULL;
  IF tie IS NOT NULL THEN
   SELECT * INTO d FROM group_tiebreak_draws WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND revision_id=NEW.revision_id AND group_key=group_key_value AND NEW.draw_ids ? id::text;
   SELECT jsonb_agg(item.value ORDER BY item.value->>'matchId') INTO subset FROM jsonb_array_elements(NEW.sources) item(value)
    JOIN published_matches m ON m.org_id=NEW.org_id AND m.event_id=NEW.event_id AND m.id=(item.value->>'matchId')::uuid
    JOIN c05_group_members(NEW.org_id,NEW.revision_id) gm ON gm.entry_id=m.home_entry_id AND gm.group_key=group_key_value;
   IF d.id IS NULL OR d.ruleset_id<>NEW.ruleset_id OR NOT(d.tied_entry_ids @> tie AND tie @> d.tied_entry_ids) OR NOT(d.sources @> subset AND subset @> d.sources) THEN
    RAISE EXCEPTION 'Qualification needs a persisted draw of exactly the current tied sources' USING ERRCODE='23514';END IF;
   used_draws:=used_draws||jsonb_build_array(d.id::text);
  END IF;
  SELECT jsonb_agg(to_jsonb(ordered.entry_id::text) ORDER BY ordered.rank_no,ordered.draw_position) INTO top_entries FROM (
   SELECT rk.entry_id,rk.rank_no,(SELECT ordinality FROM jsonb_array_elements_text(COALESCE(d.ordered_entry_ids,'[]'::jsonb)) WITH ORDINALITY item(value,ordinality) WHERE item.value=rk.entry_id::text) AS draw_position
   FROM c05_group_rankings(NEW.org_id,NEW.event_id,NEW.revision_id,NEW.ruleset_id) rk WHERE rk.group_key=group_key_value
   ORDER BY rk.rank_no,draw_position NULLS LAST LIMIT 2) ordered;
  top_by_group:=top_by_group||jsonb_build_object(group_key_value,top_entries);
 END LOOP;
 IF NOT(NEW.draw_ids @> used_draws AND used_draws @> NEW.draw_ids) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW.draw_ids))<>jsonb_array_length(NEW.draw_ids) THEN
 RAISE EXCEPTION 'Qualification must reference exactly its necessary tie draws' USING ERRCODE='23514';END IF;
 FOR half IN 0..1 LOOP FOR pair_index IN 0..g/2-1 LOOP
  fixed_slots:=fixed_slots||jsonb_build_array(top_by_group->chr(65+pair_index*2+half)->>0,top_by_group->chr(65+pair_index*2+1-half)->>1);
 END LOOP;END LOOP;
 IF NEW.slots IS DISTINCT FROM fixed_slots OR (SELECT count(DISTINCT value->>'fixtureKey') FROM jsonb_array_elements(NEW.fixtures))<>g OR (SELECT count(DISTINCT value->>'matchId') FROM jsonb_array_elements(NEW.fixtures))<>g THEN
 RAISE EXCEPTION 'Qualification seats must follow current top two and fixed cross-group bracket' USING ERRCODE='23514';END IF;
 FOR fixture IN SELECT value FROM jsonb_array_elements(NEW.fixtures) LOOP
  position:=(fixture->>'positionNo')::integer;
  IF position NOT BETWEEN 1 AND g OR (fixture->>'roundNo')::integer IS DISTINCT FROM NEW.round_no OR fixture->>'fixtureKey' IS DISTINCT FROM 'R'||NEW.round_no||'-P'||position OR
    fixture->>'homeEntryId' IS DISTINCT FROM NEW.slots->>((position-1)*2) OR fixture->>'awayEntryId' IS DISTINCT FROM NEW.slots->>((position-1)*2+1) THEN
    RAISE EXCEPTION 'Qualification fixtures must match every fixed seat' USING ERRCODE='23514';END IF;
  FOR side IN 0..1 LOOP
   SELECT value INTO participant FROM jsonb_array_elements(r.source->'entries') WHERE value->>'entryId'=fixture->>(CASE WHEN side=0 THEN 'homeEntryId' ELSE 'awayEntryId' END);
   IF participant IS NULL OR participant->>'teamId' IS DISTINCT FROM fixture->>(CASE WHEN side=0 THEN 'homeTeamId' ELSE 'awayTeamId' END) OR participant->>'teamName' IS DISTINCT FROM fixture->>(CASE WHEN side=0 THEN 'homeTeamName' ELSE 'awayTeamName' END) OR participant->>'rosterRevisionId' IS DISTINCT FROM fixture->>(CASE WHEN side=0 THEN 'homeRosterRevisionId' ELSE 'awayRosterRevisionId' END) THEN
    RAISE EXCEPTION 'Qualification must preserve frozen participant identities' USING ERRCODE='23514';END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER group_qualification_publications_insert_guard BEFORE INSERT ON group_qualification_publications FOR EACH ROW EXECUTE FUNCTION c05_qualification_guard();
CREATE CONSTRAINT TRIGGER group_qualification_publications_commit_guard AFTER INSERT ON group_qualification_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c04_round_commit_guard();

CREATE OR REPLACE FUNCTION p04_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_matches integer;
  target_publication_id uuid;
  bracket_size integer := 2;
  group_count integer;
  per_group integer;
  extra integer;
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
    IF NEW.algorithm_version='GK_BALANCED_V1' THEN
      group_count:=(NEW.group_config->>'groupCount')::integer;
      per_group:=jsonb_array_length(NEW.ordered_entry_ids)/group_count;extra:=jsonb_array_length(NEW.ordered_entry_ids)%group_count;
      IF per_group<2 THEN RAISE EXCEPTION 'Every group needs at least two teams' USING ERRCODE='23514';END IF;
      expected_matches:=extra*(per_group+1)*per_group/2+(group_count-extra)*per_group*(per_group-1)/2;
    ELSIF NEW.algorithm_version='SE_SEEDED_V1' THEN
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

CREATE OR REPLACE FUNCTION c04_round_fixture_proof(scope_org uuid, scope_revision uuid, scope_key text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT fixture.value FROM knockout_round_publications p
    CROSS JOIN LATERAL jsonb_array_elements(p.fixtures) fixture(value)
    WHERE p.org_id=scope_org AND p.revision_id=scope_revision
      AND p.transaction_id=pg_current_xact_id() AND fixture.value->>'fixtureKey'=scope_key
  UNION ALL SELECT fixture.value FROM group_qualification_publications p CROSS JOIN LATERAL jsonb_array_elements(p.fixtures) fixture(value) WHERE p.org_id=scope_org AND p.revision_id=scope_revision AND p.transaction_id=pg_current_xact_id() AND fixture.value->>'fixtureKey'=scope_key;
$$;

CREATE OR REPLACE FUNCTION c04_round_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_event events%ROWTYPE;
  revision schedule_revisions%ROWTYPE;
  bracket_size integer := 2;
  round_offset integer := 0;
  group_qualification group_qualification_publications%ROWTYPE;
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
  IF NOT FOUND OR current_event.format NOT IN ('SINGLE_ELIMINATION','GROUP_KNOCKOUT') OR current_event.status NOT IN ('SCHEDULED','RUNNING') OR
      current_event.version<>NEW.from_event_version OR current_event.current_schedule_revision_id<>NEW.revision_id THEN
    RAISE EXCEPTION 'Knockout publication needs current active event version' USING ERRCODE='23514';
  END IF;
  SELECT * INTO revision FROM schedule_revisions WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND id=NEW.revision_id FOR SHARE;
  IF NOT FOUND OR revision.status<>'PUBLISHED' OR revision.algorithm_version NOT IN ('SE_SEEDED_V1','GK_BALANCED_V1') THEN
    RAISE EXCEPTION 'Knockout publication needs immutable seeded source' USING ERRCODE='23514';
  END IF;
  IF revision.algorithm_version='GK_BALANCED_V1' THEN
    SELECT * INTO group_qualification FROM group_qualification_publications WHERE org_id=NEW.org_id AND event_id=NEW.event_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group qualification must be explicitly published first' USING ERRCODE='23514';END IF;
    bracket_size:=jsonb_array_length(group_qualification.slots);round_offset:=group_qualification.round_no-1;
  ELSE
    WHILE bracket_size<jsonb_array_length(revision.ordered_entry_ids) LOOP bracket_size:=bracket_size*2; END LOOP;
  END IF;
  positions:=c04_seed_positions(bracket_size);
  IF NEW.round_no-round_offset<2 OR power(2,NEW.round_no-round_offset)>bracket_size OR jsonb_array_length(NEW.fixtures)<>bracket_size/power(2,NEW.round_no-round_offset)::integer OR
      (NEW.round_no-round_offset>2 AND NOT EXISTS(SELECT 1 FROM knockout_round_publications WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND round_no=NEW.round_no-1)) OR
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
      IF winner IS NULL AND NEW.round_no=2 AND revision.algorithm_version='SE_SEEDED_V1' THEN
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
  grouping jsonb;
  group_count integer;
  per_group integer;
  extra integer;
  group_match_count integer;
BEGIN
  SELECT r.source -> 'entries',e.format,r.algorithm_version,r.status,r.group_config INTO frozen_entries,event_format,algorithm,revision_status,grouping FROM schedule_publications p
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
  IF event_format='GROUP_KNOCKOUT' THEN
    group_count:=(grouping->>'groupCount')::integer;per_group:=expected_team_count/group_count;extra:=expected_team_count%group_count;
    group_match_count:=extra*(per_group+1)*per_group/2+(group_count-extra)*per_group*(per_group-1)/2;
  END IF;
  IF (event_format='ROUND_ROBIN' AND expected_match_count <> expected_team_count * (expected_team_count - 1) / 2) OR
     (event_format='SINGLE_ELIMINATION' AND expected_match_count NOT BETWEEN 1 AND expected_team_count-1) OR
     (event_format='GROUP_KNOCKOUT' AND (algorithm<>'GK_BALANCED_V1' OR revision_status<>'PUBLISHED' OR expected_match_count NOT BETWEEN group_match_count AND group_match_count+group_count*2-1)) OR event_format NOT IN ('ROUND_ROBIN','SINGLE_ELIMINATION','GROUP_KNOCKOUT') OR actual_link_count <> expected_match_count THEN
    RAISE EXCEPTION 'Public publication must map every official schedule match atomically' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
