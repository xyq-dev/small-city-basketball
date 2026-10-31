-- X01: optional third-place game uses genuine semifinal losers and current confirmations.
-- Existing policy/hash and every source/fixture/reservation guard remain unchanged by default.
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
  bronze_enabled boolean;
  bronze_final boolean;
  expected_fixture_count integer;
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
  IF revision.policy ? 'thirdPlaceMatch' AND jsonb_typeof(revision.policy->'thirdPlaceMatch')<>'boolean' THEN
    RAISE EXCEPTION 'Third-place policy must be boolean' USING ERRCODE='23514';
  END IF;
  bronze_enabled:=COALESCE((revision.policy->>'thirdPlaceMatch')::boolean,false);
  IF bronze_enabled AND bracket_size<4 THEN
    RAISE EXCEPTION 'Third-place game requires two actual semifinal sources' USING ERRCODE='23514';
  END IF;
  bronze_final:=bronze_enabled AND power(2,NEW.round_no-round_offset)=bracket_size;
  expected_fixture_count:=CASE WHEN bronze_final THEN 2 ELSE bracket_size/power(2,NEW.round_no-round_offset)::integer END;
  positions:=c04_seed_positions(bracket_size);
  IF NEW.round_no-round_offset<2 OR power(2,NEW.round_no-round_offset)>bracket_size OR jsonb_array_length(NEW.fixtures)<>expected_fixture_count OR
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
      IF bronze_final AND slot=2 THEN
        SELECT CASE WHEN m.home_entry_id=(s.value->>'winnerEntryId')::uuid THEN m.away_entry_id ELSE m.home_entry_id END
          INTO winner FROM jsonb_array_elements(NEW.sources) s(value)
          JOIN published_matches m ON m.org_id=NEW.org_id AND m.event_id=NEW.event_id AND m.id=(s.value->>'matchId')::uuid
          WHERE s.value->>'fixtureKey'='R'||(NEW.round_no-1)||'-P'||(1+side);
      ELSE
        SELECT (value->>'winnerEntryId')::uuid INTO winner FROM jsonb_array_elements(NEW.sources)
          WHERE value->>'fixtureKey'='R'||(NEW.round_no-1)||'-P'||(slot*2-1+side);
      END IF;
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
  third_place_count integer;
BEGIN
  SELECT r.source -> 'entries',e.format,r.algorithm_version,r.status,r.group_config,CASE WHEN r.policy->'thirdPlaceMatch'='true'::jsonb THEN 1 ELSE 0 END INTO frozen_entries,event_format,algorithm,revision_status,grouping,third_place_count FROM schedule_publications p
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
     (event_format='SINGLE_ELIMINATION' AND expected_match_count NOT BETWEEN 1 AND expected_team_count-1+third_place_count) OR
     (event_format='GROUP_KNOCKOUT' AND (algorithm<>'GK_BALANCED_V1' OR revision_status<>'PUBLISHED' OR expected_match_count NOT BETWEEN group_match_count AND group_match_count+group_count*2-1+third_place_count)) OR event_format NOT IN ('ROUND_ROBIN','SINGLE_ELIMINATION','GROUP_KNOCKOUT') OR actual_link_count <> expected_match_count THEN
    RAISE EXCEPTION 'Public publication must map every official schedule match atomically' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
