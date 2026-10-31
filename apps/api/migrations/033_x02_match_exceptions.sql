-- X02 administrative adjudications never fabricate scoring events or confirmations.
CREATE TABLE match_exception_rules (
 id uuid PRIMARY KEY, org_id uuid NOT NULL,event_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 forfeit_win_points integer NOT NULL CHECK(forfeit_win_points BETWEEN 0 AND 1000),
 forfeit_loss_points integer NOT NULL CHECK(forfeit_loss_points BETWEEN 0 AND 1000),
 cancellation_policy text NOT NULL CHECK(cancellation_policy='EXCLUDE_FROM_TABLE'),
 created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,event_id),UNIQUE(org_id,event_id,id,version),
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE match_exception_heads (
 org_id uuid NOT NULL,event_id uuid NOT NULL,match_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),active_request_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(org_id,match_id),UNIQUE(org_id,event_id,match_id),
 FOREIGN KEY(org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id)
);
CREATE TABLE match_exception_requests (
 id uuid PRIMARY KEY,org_id uuid NOT NULL,event_id uuid NOT NULL,match_id uuid NOT NULL,
 rules_id uuid NOT NULL,rules_version integer NOT NULL,
 source_match_version integer NOT NULL CHECK(source_match_version>0),
 source_head_version integer NOT NULL CHECK(source_head_version>0),
 operation text NOT NULL CHECK(operation IN ('DECLARE','REVOKE')),
 kind text NOT NULL CHECK(kind IN ('FORFEIT','CANCELLED')),
 forfeiting_side text CHECK(forfeiting_side IN ('HOME','AWAY')),
 winner_entry_id uuid,loser_entry_id uuid,target_adjudication_id uuid,
 proposed_by uuid NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(reason=btrim(reason) AND char_length(reason) BETWEEN 4 AND 500),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 version integer NOT NULL DEFAULT 1 CHECK(version IN (1,2)),
 reviewed_by uuid REFERENCES users(id),review_reason text CHECK(review_reason=btrim(review_reason) AND char_length(review_reason) BETWEEN 4 AND 500),
 reviewed_at timestamptz,review_transaction_id xid8,review_event_version integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,event_id,match_id,id),
 FOREIGN KEY(org_id,event_id,match_id) REFERENCES match_exception_heads(org_id,event_id,match_id),
 FOREIGN KEY(org_id,event_id,rules_id,rules_version) REFERENCES match_exception_rules(org_id,event_id,id,version),
 FOREIGN KEY(org_id,event_id,winner_entry_id) REFERENCES entries(org_id,event_id,id),
 FOREIGN KEY(org_id,event_id,loser_entry_id) REFERENCES entries(org_id,event_id,id),
 FOREIGN KEY(org_id,event_id,match_id,target_adjudication_id) REFERENCES match_exception_requests(org_id,event_id,match_id,id),
 CHECK ((kind='FORFEIT')=(forfeiting_side IS NOT NULL AND winner_entry_id IS NOT NULL AND loser_entry_id IS NOT NULL)),
 CHECK (kind<>'CANCELLED' OR (forfeiting_side IS NULL AND winner_entry_id IS NULL AND loser_entry_id IS NULL)),
 CHECK (winner_entry_id IS NULL OR winner_entry_id<>loser_entry_id),
 CHECK ((operation='REVOKE')=(target_adjudication_id IS NOT NULL)),
 CHECK ((status='PENDING')=(version=1 AND reviewed_by IS NULL AND review_reason IS NULL AND reviewed_at IS NULL AND review_transaction_id IS NULL AND review_event_version IS NULL)),
 CHECK (status='PENDING' OR (version=2 AND reviewed_by IS NOT NULL AND reviewed_by<>proposed_by AND review_reason IS NOT NULL AND reviewed_at IS NOT NULL AND review_transaction_id IS NOT NULL AND review_event_version>0))
);
CREATE UNIQUE INDEX match_exception_one_pending ON match_exception_requests(org_id,match_id) WHERE status='PENDING';
CREATE INDEX match_exception_requests_page ON match_exception_requests(org_id,match_id,created_at DESC,id);
ALTER TABLE match_exception_heads ADD CONSTRAINT match_exception_head_active_fk
 FOREIGN KEY(org_id,event_id,match_id,active_request_id) REFERENCES match_exception_requests(org_id,event_id,match_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE match_exception_receipts (
 user_id uuid NOT NULL REFERENCES users(id),client_request_id uuid NOT NULL,
 org_id uuid NOT NULL,event_id uuid NOT NULL,match_id uuid,
 request_fingerprint char(64) NOT NULL CHECK(request_fingerprint~'^[0-9a-f]{64}$'),
 action text NOT NULL CHECK(action IN ('RULES','PROPOSE','REVIEW')),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,client_request_id),
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
 FOREIGN KEY(org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id)
);
CREATE TRIGGER match_exception_receipts_immutable BEFORE UPDATE OR DELETE ON match_exception_receipts
 FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();

CREATE FUNCTION x02_can_adjudicate(scope_org uuid,scope_event uuid,scope_match uuid,actor uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN organization_memberships om ON om.user_id=u.id AND om.org_id=scope_org
  JOIN organizations o ON o.id=om.org_id WHERE u.id=actor AND u.status='ACTIVE' AND o.status='ACTIVE' AND om.status='ACTIVE'
  AND (om.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff es WHERE es.org_id=scope_org AND es.event_id=scope_event AND es.user_id=actor AND es.status='ACTIVE' AND es.role='EVENT_MANAGER')
   OR EXISTS(SELECT 1 FROM match_staff ms WHERE ms.org_id=scope_org AND ms.match_id=scope_match AND ms.user_id=actor AND ms.status='ACTIVE' AND ms.role='RESULT_REVIEWER')));
$$;
CREATE FUNCTION x02_independent_reviewer(scope_org uuid,scope_event uuid,scope_match uuid,actor uuid,proposer uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT actor<>proposer AND x02_can_adjudicate(scope_org,scope_event,scope_match,actor)
 AND NOT EXISTS(SELECT 1 FROM published_matches m JOIN team_access_grants g ON g.org_id=m.org_id AND g.team_id IN (m.home_team_id,m.away_team_id) WHERE m.org_id=scope_org AND m.id=scope_match AND g.user_id=actor AND g.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM published_matches m JOIN team_member_bindings b ON b.org_id=m.org_id AND b.team_id IN (m.home_team_id,m.away_team_id) WHERE m.org_id=scope_org AND m.id=scope_match AND b.user_id=actor AND b.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM scoring_commands c WHERE c.org_id=scope_org AND c.match_id=scope_match AND c.actor_id=actor AND c.command_type NOT IN ('PREPARE_MATCH','CONFIRM_RESULT','REOPEN_RESULT'))
 AND NOT EXISTS(SELECT 1 FROM scoring_leases l WHERE l.org_id=scope_org AND l.match_id=scope_match AND l.holder_user_id=actor AND l.expires_at>clock_timestamp());
$$;
CREATE FUNCTION x02_assert_unstarted(scope_org uuid,scope_event uuid,scope_match uuid,source_version integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE m published_matches%ROWTYPE;s scoring_states%ROWTYPE;
BEGIN
 SELECT * INTO m FROM published_matches WHERE org_id=scope_org AND event_id=scope_event AND id=scope_match FOR SHARE;
 IF NOT FOUND OR m.version<>source_version OR m.status NOT IN ('SCHEDULED','READY') OR EXISTS(SELECT 1 FROM scoring_events WHERE org_id=scope_org AND match_id=scope_match AND type='START_MATCH') THEN
  RAISE EXCEPTION 'Administrative adjudication requires exact unstarted match' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM scoring_states WHERE org_id=scope_org AND match_id=scope_match FOR SHARE;
 IF (m.status='SCHEDULED' AND FOUND) OR (m.status='READY' AND (s.match_id IS NULL OR s.source_version<>m.version OR s.clock_running IS DISTINCT FROM false)) THEN
  RAISE EXCEPTION 'Prepared administrative match must retain valid unstarted state' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM knockout_round_publications WHERE org_id=scope_org AND event_id=scope_event AND sources @> jsonb_build_array(jsonb_build_object('matchId',scope_match::text))) OR EXISTS(SELECT 1 FROM group_qualification_publications WHERE org_id=scope_org AND event_id=scope_event AND sources @> jsonb_build_array(jsonb_build_object('matchId',scope_match::text))) THEN
  RAISE EXCEPTION 'Consumed result cannot be administratively replaced' USING ERRCODE='23514';END IF;
END;
$$;
CREATE FUNCTION x02_rules_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exception rules cannot be deleted' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id AND status='DRAFT') OR NOT x02_can_adjudicate(NEW.org_id,NEW.event_id,NULL,NEW.updated_by) THEN
  RAISE EXCEPTION 'Exception rules lock before registration and publication' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND (NEW.version<>1 OR NEW.created_by<>NEW.updated_by) THEN RAISE EXCEPTION 'Exception rules start at version one' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['version','forfeit_win_points','forfeit_loss_points','cancellation_policy','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','forfeit_win_points','forfeit_loss_points','cancellation_policy','updated_by','updated_at']) OR NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION 'Exception rules have immutable identity and exact version' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER match_exception_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON match_exception_rules FOR EACH ROW EXECUTE FUNCTION x02_rules_guard();
CREATE FUNCTION x02_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h match_exception_heads%ROWTYPE;m published_matches%ROWTYPE;r match_exception_requests%ROWTYPE;e events%ROWTYPE;expected_winner uuid;expected_loser uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Adjudication history cannot be deleted' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event missing' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' OR NEW.status='APPROVED' THEN
 IF e.status NOT IN ('SCHEDULED','RUNNING') THEN RAISE EXCEPTION 'Adjudication requires active published event' USING ERRCODE='23514';END IF;
 PERFORM x02_assert_unstarted(NEW.org_id,NEW.event_id,NEW.match_id,NEW.source_match_version);
 SELECT * INTO h FROM match_exception_heads WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND match_id=NEW.match_id FOR SHARE;
 IF NOT FOUND OR h.version<>NEW.source_head_version THEN RAISE EXCEPTION 'Adjudication head changed' USING ERRCODE='23514';END IF;
 IF NEW.operation='DECLARE' AND h.active_request_id IS NOT NULL THEN RAISE EXCEPTION 'Match already has an effective adjudication' USING ERRCODE='23514';END IF;
 IF NEW.operation='REVOKE' THEN
  SELECT * INTO r FROM match_exception_requests WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND match_id=NEW.match_id AND id=NEW.target_adjudication_id;
  IF NOT FOUND OR h.active_request_id IS DISTINCT FROM r.id OR r.status<>'APPROVED' OR r.operation<>'DECLARE' OR ROW(NEW.kind,NEW.forfeiting_side,NEW.winner_entry_id,NEW.loser_entry_id) IS DISTINCT FROM ROW(r.kind,r.forfeiting_side,r.winner_entry_id,r.loser_entry_id) THEN
   RAISE EXCEPTION 'Revocation must name the exact current adjudication' USING ERRCODE='23514';END IF;
 END IF;
 END IF;
 SELECT * INTO m FROM published_matches WHERE org_id=NEW.org_id AND id=NEW.match_id;
 IF NEW.kind='FORFEIT' THEN
  IF NEW.forfeiting_side='HOME' THEN expected_winner:=m.away_entry_id;expected_loser:=m.home_entry_id;
  ELSIF NEW.forfeiting_side='AWAY' THEN expected_winner:=m.home_entry_id;expected_loser:=m.away_entry_id;
  ELSE RAISE EXCEPTION 'Forfeit must explicitly name the original side' USING ERRCODE='23514';END IF;
  IF NEW.winner_entry_id IS DISTINCT FROM expected_winner OR NEW.loser_entry_id IS DISTINCT FROM expected_loser THEN
   RAISE EXCEPTION 'Administrative winner and loser must be the original opposing entries' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.version<>1 OR NOT x02_can_adjudicate(NEW.org_id,NEW.event_id,NEW.match_id,NEW.proposed_by) THEN RAISE EXCEPTION 'Adjudication must start as an authorized proposal' USING ERRCODE='23514';END IF;
 ELSE
  IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version<>OLD.version+1 OR NEW.review_transaction_id IS DISTINCT FROM pg_current_xact_id() OR NEW.review_event_version<>e.version OR
   (to_jsonb(NEW)-ARRAY['version','status','reviewed_by','review_reason','reviewed_at','review_transaction_id','review_event_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','status','reviewed_by','review_reason','reviewed_at','review_transaction_id','review_event_version']) OR
   NOT x02_independent_reviewer(NEW.org_id,NEW.event_id,NEW.match_id,NEW.reviewed_by,OLD.proposed_by) OR (NEW.status='APPROVED' AND NOT x02_can_adjudicate(NEW.org_id,NEW.event_id,NEW.match_id,OLD.proposed_by)) THEN
   RAISE EXCEPTION 'Adjudication review must be current, independent and final' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER match_exception_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON match_exception_requests FOR EACH ROW EXECUTE FUNCTION x02_request_guard();
CREATE FUNCTION x02_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r match_exception_requests%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Adjudication heads cannot be deleted' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.active_request_id IS NOT NULL OR NEW.version<>1 THEN RAISE EXCEPTION 'Adjudication head starts empty' USING ERRCODE='23514';END IF;
 ELSE
  IF ROW(NEW.org_id,NEW.event_id,NEW.match_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.org_id,OLD.event_id,OLD.match_id,OLD.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Adjudication head has immutable identity and exact version' USING ERRCODE='23514';END IF;
  SELECT * INTO r FROM match_exception_requests WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND match_id=NEW.match_id AND status='APPROVED' AND review_transaction_id=pg_current_xact_id() AND source_head_version=OLD.version;
  IF NOT FOUND OR (r.operation='DECLARE' AND (OLD.active_request_id IS NOT NULL OR NEW.active_request_id IS DISTINCT FROM r.id)) OR (r.operation='REVOKE' AND (OLD.active_request_id IS DISTINCT FROM r.target_adjudication_id OR NEW.active_request_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'Adjudication effect requires current-transaction independent approval' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER match_exception_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON match_exception_heads FOR EACH ROW EXECUTE FUNCTION x02_head_guard();
CREATE FUNCTION x02_review_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h match_exception_heads%ROWTYPE;
BEGIN
 IF NEW.status='APPROVED' THEN
  SELECT * INTO h FROM match_exception_heads WHERE org_id=NEW.org_id AND match_id=NEW.match_id;
  IF h.version<>NEW.source_head_version+1 OR (NEW.operation='DECLARE' AND h.active_request_id IS DISTINCT FROM NEW.id) OR (NEW.operation='REVOKE' AND h.active_request_id IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id AND version=NEW.review_event_version+1) THEN
   RAISE EXCEPTION 'Adjudication approval, effect and event version must commit atomically' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER match_exception_review_commit AFTER UPDATE ON match_exception_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION x02_review_commit_guard();

-- Service writers already lock event then match. Direct writers acquire the same lock order.
CREATE FUNCTION x02_scoring_active_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM events WHERE org_id=NEW.org_id AND id=(SELECT event_id FROM published_matches WHERE org_id=NEW.org_id AND id=NEW.match_id) FOR SHARE;
 PERFORM 1 FROM published_matches WHERE org_id=NEW.org_id AND id=NEW.match_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM match_exception_heads WHERE org_id=NEW.org_id AND match_id=NEW.match_id AND active_request_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Effective administrative adjudication blocks scoring' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER match_exception_scoring_events_guard BEFORE INSERT ON scoring_events FOR EACH ROW EXECUTE FUNCTION x02_scoring_active_guard();
CREATE TRIGGER match_exception_scoring_states_guard BEFORE INSERT OR UPDATE ON scoring_states FOR EACH ROW EXECUTE FUNCTION x02_scoring_active_guard();

CREATE FUNCTION x02_assert_administrative_source(scope_org uuid,scope_event uuid,item jsonb,allow_cancellation boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE m published_matches%ROWTYPE;r match_exception_requests%ROWTYPE;h match_exception_heads%ROWTYPE;actual_keys text[];expected_winner uuid;expected_loser uuid;
BEGIN
 SELECT array_agg(k ORDER BY k) INTO actual_keys FROM jsonb_object_keys(item) k;
 IF actual_keys IS DISTINCT FROM ARRAY['adjudicationId','adjudicationVersion','fixtureKey','kind','loserEntryId','matchId','matchVersion','winnerEntryId']::text[] OR COALESCE(item->>'kind','') NOT IN ('ADJUDICATION','CANCELLATION') THEN
  RAISE EXCEPTION 'Administrative source must use exact explicit provenance' USING ERRCODE='23514';END IF;
 SELECT * INTO m FROM published_matches WHERE org_id=scope_org AND event_id=scope_event AND id=(item->>'matchId')::uuid FOR SHARE;
 IF NOT FOUND OR m.fixture_key IS DISTINCT FROM item->>'fixtureKey' OR m.status NOT IN ('SCHEDULED','READY') OR EXISTS(SELECT 1 FROM scoring_events WHERE org_id=scope_org AND match_id=m.id AND type='START_MATCH') THEN
  RAISE EXCEPTION 'Administrative source match changed or started' USING ERRCODE='23514';END IF;
 SELECT * INTO h FROM match_exception_heads WHERE org_id=scope_org AND match_id=m.id;
 SELECT * INTO r FROM match_exception_requests WHERE org_id=scope_org AND event_id=scope_event AND match_id=m.id AND id=h.active_request_id;
 IF NOT FOUND OR r.id IS DISTINCT FROM (item->>'adjudicationId')::uuid OR r.status<>'APPROVED' OR r.operation<>'DECLARE' OR r.version IS DISTINCT FROM (item->>'adjudicationVersion')::integer OR r.version<>2 OR r.source_match_version IS DISTINCT FROM (item->>'matchVersion')::integer OR r.source_match_version>m.version OR r.reviewed_by IS NULL OR r.reviewed_by=r.proposed_by OR r.reviewed_at IS NULL OR NOT EXISTS(SELECT 1 FROM match_exception_rules WHERE org_id=scope_org AND event_id=scope_event AND id=r.rules_id AND version=r.rules_version) THEN
  RAISE EXCEPTION 'Administrative decision must remain the exact effective independently approved source' USING ERRCODE='23514';END IF;
 IF r.kind='CANCELLED' THEN
  IF NOT allow_cancellation OR item->>'kind'<>'CANCELLATION' OR item->'winnerEntryId'<>'null'::jsonb OR item->'loserEntryId'<>'null'::jsonb THEN RAISE EXCEPTION 'Cancellation never supplies a knockout contestant' USING ERRCODE='23514';END IF;
 ELSE
  IF r.forfeiting_side='HOME' THEN expected_winner:=m.away_entry_id;expected_loser:=m.home_entry_id;
  ELSIF r.forfeiting_side='AWAY' THEN expected_winner:=m.home_entry_id;expected_loser:=m.away_entry_id;
  ELSE RAISE EXCEPTION 'Administrative source requires an explicit original forfeiting side' USING ERRCODE='23514';END IF;
  IF item->>'kind'<>'ADJUDICATION' OR (item->>'winnerEntryId')::uuid IS DISTINCT FROM r.winner_entry_id OR (item->>'loserEntryId')::uuid IS DISTINCT FROM r.loser_entry_id OR r.winner_entry_id IS DISTINCT FROM expected_winner OR r.loser_entry_id IS DISTINCT FROM expected_loser THEN
   RAISE EXCEPTION 'Administrative source must retain actual opposing winner and loser' USING ERRCODE='23514';END IF;
 END IF;
END;
$$;
CREATE FUNCTION x02_match_active_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM match_exception_heads WHERE org_id=OLD.org_id AND match_id=OLD.id AND active_request_id IS NOT NULL) AND
  (to_jsonb(NEW)-ARRAY['version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','updated_at']) THEN
  RAISE EXCEPTION 'Revoke effective adjudication before changing original match facts' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER match_exception_published_match_guard BEFORE UPDATE ON published_matches FOR EACH ROW EXECUTE FUNCTION x02_match_active_guard();

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
    IF NOT FOUND OR target_match.round_no<>NEW.round_no-1 OR
       target_match.fixture_key IS DISTINCT FROM source->>'fixtureKey' THEN
      RAISE EXCEPTION 'Knockout source must be the exact current FINAL match' USING ERRCODE='23514';
    END IF;
    IF source ? 'kind' THEN
      PERFORM x02_assert_administrative_source(NEW.org_id,NEW.event_id,source,false);
    ELSE
    IF target_match.status<>'FINAL' OR EXISTS(SELECT 1 FROM match_exception_heads WHERE org_id=NEW.org_id AND match_id=target_match.id AND active_request_id IS NOT NULL) THEN RAISE EXCEPTION 'Played source must be current FINAL without administrative effect' USING ERRCODE='23514';END IF;
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


CREATE OR REPLACE FUNCTION c05_assert_group_sources(scope_org uuid,scope_event uuid,scope_revision uuid,sources jsonb,scope_group text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item jsonb;m published_matches%ROWTYPE;s scoring_states%ROWTYPE;c result_confirmations%ROWTYPE;expected integer;
BEGIN
 SELECT count(*) INTO expected FROM published_matches pm WHERE pm.org_id=scope_org AND pm.event_id=scope_event
  AND EXISTS(SELECT 1 FROM c05_group_members(scope_org,scope_revision) gm WHERE gm.entry_id=pm.home_entry_id AND (scope_group IS NULL OR gm.group_key=scope_group))
  AND NOT EXISTS(SELECT 1 FROM group_qualification_publications q WHERE q.org_id=scope_org AND q.event_id=scope_event AND pm.round_no>=q.round_no);
 IF expected<>jsonb_array_length(sources) OR expected<>(SELECT count(DISTINCT value->>'matchId') FROM jsonb_array_elements(sources)) THEN
  RAISE EXCEPTION 'Group sources must exactly cover all original group matches' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(sources) LOOP
  SELECT * INTO m FROM published_matches WHERE org_id=scope_org AND event_id=scope_event AND id=(item->>'matchId')::uuid;
  IF NOT FOUND OR m.fixture_key IS DISTINCT FROM item->>'fixtureKey' OR
   NOT EXISTS(SELECT 1 FROM c05_group_members(scope_org,scope_revision) a JOIN c05_group_members(scope_org,scope_revision) b ON a.group_key=b.group_key WHERE a.entry_id=m.home_entry_id AND b.entry_id=m.away_entry_id AND (scope_group IS NULL OR a.group_key=scope_group)) THEN
   RAISE EXCEPTION 'Group source match is not current FINAL in its original group' USING ERRCODE='23514';END IF;
  IF item ? 'kind' THEN
   PERFORM x02_assert_administrative_source(scope_org,scope_event,item,true);
  ELSE
  IF m.status<>'FINAL' OR EXISTS(SELECT 1 FROM match_exception_heads WHERE org_id=scope_org AND match_id=m.id AND active_request_id IS NOT NULL) THEN RAISE EXCEPTION 'Played group source is no longer current' USING ERRCODE='23514';END IF;
  SELECT * INTO s FROM scoring_states WHERE org_id=scope_org AND match_id=m.id;
  SELECT * INTO c FROM result_confirmations WHERE org_id=scope_org AND match_id=m.id AND id=(item->>'confirmationId')::uuid;
  IF NOT FOUND OR s.latest_confirmation_id IS DISTINCT FROM c.id OR s.source_version IS DISTINCT FROM m.version OR s.requires_reconfirmation IS DISTINCT FROM false OR s.clock_running IS DISTINCT FROM false OR
   c.source_match_version+1 IS DISTINCT FROM (item->>'matchVersion')::integer OR c.source_match_version+1>m.version OR c.home_score=c.away_score OR c.home_score IS DISTINCT FROM s.home_score OR c.away_score IS DISTINCT FROM s.away_score OR c.last_event_seq+1 IS DISTINCT FROM s.last_event_seq OR
   (item->>'winnerEntryId')::uuid IS DISTINCT FROM (CASE WHEN c.home_score>c.away_score THEN m.home_entry_id ELSE m.away_entry_id END) THEN
   RAISE EXCEPTION 'Group source confirmation must be effective and unchanged' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION c05_group_rankings(scope_org uuid,scope_event uuid,scope_revision uuid,scope_ruleset uuid)
 RETURNS TABLE(entry_id uuid,group_key text,rank_no bigint) LANGUAGE sql STABLE AS $$
 WITH totals AS (
 SELECT g.entry_id,g.group_key,
 COALESCE(sum(CASE WHEN x.kind='FORFEIT' THEN CASE WHEN x.winner_entry_id=g.entry_id THEN xr.forfeit_win_points ELSE xr.forfeit_loss_points END WHEN (m.home_entry_id=g.entry_id AND c.home_score>c.away_score) OR (m.away_entry_id=g.entry_id AND c.away_score>c.home_score) THEN r.win_points ELSE r.loss_points END) FILTER(WHERE c.id IS NOT NULL OR x.kind='FORFEIT'),0) AS league_points,
 COALESCE(sum(CASE WHEN m.home_entry_id=g.entry_id THEN c.home_score-c.away_score ELSE c.away_score-c.home_score END),0) AS score_difference,
 COALESCE(sum(CASE WHEN m.home_entry_id=g.entry_id THEN c.home_score ELSE c.away_score END),0) AS points_for,
 count(m.id) FILTER(WHERE (x.kind='FORFEIT' AND x.winner_entry_id=g.entry_id) OR (m.home_entry_id=g.entry_id AND c.home_score>c.away_score) OR (m.away_entry_id=g.entry_id AND c.away_score>c.home_score)) AS wins,
 r.tiebreakers
 FROM c05_group_members(scope_org,scope_revision) g
 JOIN standings_rulesets r ON r.org_id=scope_org AND r.event_id=scope_event AND r.id=scope_ruleset
 LEFT JOIN published_matches m ON m.org_id=scope_org AND m.event_id=scope_event AND (m.home_entry_id=g.entry_id OR m.away_entry_id=g.entry_id)
   AND EXISTS(SELECT 1 FROM c05_group_members(scope_org,scope_revision) other WHERE other.group_key=g.group_key AND other.entry_id=CASE WHEN m.home_entry_id=g.entry_id THEN m.away_entry_id ELSE m.home_entry_id END)
   AND m.round_no<COALESCE((SELECT round_no FROM group_qualification_publications WHERE org_id=scope_org AND event_id=scope_event),32)
 LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id
 LEFT JOIN result_confirmations c ON c.org_id=m.org_id AND c.match_id=m.id AND c.id=s.latest_confirmation_id AND m.status='FINAL' AND NOT EXISTS(SELECT 1 FROM match_exception_heads h WHERE h.org_id=m.org_id AND h.match_id=m.id AND h.active_request_id IS NOT NULL)
 LEFT JOIN match_exception_heads xh ON xh.org_id=m.org_id AND xh.match_id=m.id
 LEFT JOIN match_exception_requests x ON x.org_id=xh.org_id AND x.id=xh.active_request_id AND x.status='APPROVED' AND x.operation='DECLARE'
 LEFT JOIN match_exception_rules xr ON xr.org_id=x.org_id AND xr.id=x.rules_id AND xr.version=x.rules_version
 GROUP BY g.entry_id,g.group_key,r.tiebreakers
 ) SELECT entry_id,group_key,rank() OVER(PARTITION BY group_key ORDER BY league_points DESC,
 CASE tiebreakers[1] WHEN 'SCORE_DIFFERENCE' THEN score_difference WHEN 'POINTS_FOR' THEN points_for WHEN 'WINS' THEN wins END DESC NULLS LAST,
 CASE tiebreakers[2] WHEN 'SCORE_DIFFERENCE' THEN score_difference WHEN 'POINTS_FOR' THEN points_for WHEN 'WINS' THEN wins END DESC NULLS LAST,
 CASE tiebreakers[3] WHEN 'SCORE_DIFFERENCE' THEN score_difference WHEN 'POINTS_FOR' THEN points_for WHEN 'WINS' THEN wins END DESC NULLS LAST) FROM totals;
$$;
