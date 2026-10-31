-- X03: independent double-round-robin format and durable reusable configuration templates.
-- Old migrations and RR_CIRCLE_V1 canonical input/hashes stay unchanged.
ALTER TABLE events DROP CONSTRAINT events_format_check;
ALTER TABLE events ADD CONSTRAINT events_format_check CHECK(format IN('ROUND_ROBIN','DOUBLE_ROUND_ROBIN','SINGLE_ELIMINATION','GROUP_KNOCKOUT'));
ALTER TABLE schedule_revisions DROP CONSTRAINT schedule_revisions_algorithm_version_check;
ALTER TABLE schedule_revisions ADD CONSTRAINT schedule_revisions_algorithm_version_check CHECK(algorithm_version IN('RR_CIRCLE_V1','DRR_CIRCLE_V1','SE_SEEDED_V1','GK_BALANCED_V1'));
ALTER TABLE schedule_fixtures DROP CONSTRAINT schedule_fixtures_round_no_check;
ALTER TABLE schedule_fixtures ADD CONSTRAINT schedule_fixtures_round_no_check CHECK(round_no BETWEEN 1 AND 62);
ALTER TABLE published_matches DROP CONSTRAINT published_matches_round_no_check;
ALTER TABLE published_matches ADD CONSTRAINT published_matches_round_no_check CHECK(round_no BETWEEN 1 AND 62);

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
    IF (NEW.algorithm_version='DRR_CIRCLE_V1') IS DISTINCT FROM
       (SELECT format='DOUBLE_ROUND_ROBIN' FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id) THEN
      RAISE EXCEPTION 'Double round robin needs its own event and algorithm' USING ERRCODE='23514';
    END IF;
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
    ELSIF NEW.algorithm_version='DRR_CIRCLE_V1' THEN
      expected_matches:=jsonb_array_length(NEW.ordered_entry_ids)*(jsonb_array_length(NEW.ordered_entry_ids)-1);
      IF (SELECT count(DISTINCT (home_entry_id,away_entry_id)) FROM schedule_fixtures WHERE org_id=NEW.org_id AND revision_id=NEW.id)<>expected_matches OR
         EXISTS(SELECT 1 FROM schedule_fixtures WHERE org_id=NEW.org_id AND revision_id=NEW.id AND
           (NOT(NEW.ordered_entry_ids ? home_entry_id::text) OR NOT(NEW.ordered_entry_ids ? away_entry_id::text))) THEN
        RAISE EXCEPTION 'Double round robin must contain each ordered pair exactly once' USING ERRCODE='23514';
      END IF;
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

-- Preserve the optional bronze branches introduced in 025.
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
     (event_format='DOUBLE_ROUND_ROBIN' AND (algorithm<>'DRR_CIRCLE_V1' OR revision_status<>'PUBLISHED' OR expected_match_count<>expected_team_count*(expected_team_count-1))) OR
     (event_format='SINGLE_ELIMINATION' AND expected_match_count NOT BETWEEN 1 AND expected_team_count-1+third_place_count) OR
     (event_format='GROUP_KNOCKOUT' AND (algorithm<>'GK_BALANCED_V1' OR revision_status<>'PUBLISHED' OR expected_match_count NOT BETWEEN group_match_count AND group_match_count+group_count*2-1+third_place_count)) OR event_format NOT IN ('ROUND_ROBIN','DOUBLE_ROUND_ROBIN','SINGLE_ELIMINATION','GROUP_KNOCKOUT') OR actual_link_count <> expected_match_count THEN
    RAISE EXCEPTION 'Public publication must map every official schedule match atomically' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- DRR public links support the same authenticated follow lifecycle.
CREATE OR REPLACE FUNCTION c19_event_follow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_status text;
  event_format text;
  publication_purpose text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Event follow history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'An event follow starts ACTIVE' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM organizations WHERE id = NEW.org_id AND status = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Following requires an active organization' USING ERRCODE = '23514';
    END IF;
    SELECT status, format INTO event_status, event_format FROM events
      WHERE org_id = NEW.org_id AND id = NEW.event_id FOR SHARE;
    SELECT purpose INTO publication_purpose FROM public_event_publications
      WHERE org_id = NEW.org_id AND event_id = NEW.event_id AND id = NEW.publication_id
        AND revoked_at IS NULL FOR SHARE;
    IF publication_purpose IS NULL
      OR event_format NOT IN ('ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT')
      OR NOT (
        (publication_purpose = 'LIVE' AND event_status IN ('SCHEDULED', 'RUNNING'))
        OR (publication_purpose = 'HISTORY' AND event_status IN ('COMPLETED', 'ARCHIVED'))
      ) THEN
      RAISE EXCEPTION 'Following requires a currently readable public publication'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'CANCELLED' OR
     (to_jsonb(NEW) - ARRAY['status', 'cancelled_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'cancelled_at']) THEN
    RAISE EXCEPTION 'Event follows may only transition once from ACTIVE to CANCELLED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE event_templates (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK(name=btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  current_version_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(org_id,id)
);
CREATE INDEX event_templates_by_org_page ON event_templates(org_id,created_at DESC,id DESC);
CREATE TABLE event_template_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  template_id uuid NOT NULL,
  version_number integer NOT NULL CHECK(version_number>0),
  configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object' AND octet_length(configuration::text)<=16000 AND
    configuration ?& ARRAY['format','registration','scoring','standings','scheduling','expectedTeams'] AND
    (configuration-ARRAY['format','registration','scoring','standings','scheduling','expectedTeams'])='{}'::jsonb),
  configuration_hash char(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(org_id,template_id,id),
  UNIQUE(org_id,template_id,version_number),
  FOREIGN KEY(org_id,template_id) REFERENCES event_templates(org_id,id)
);
ALTER TABLE event_templates ADD CONSTRAINT event_templates_current_version_fk
  FOREIGN KEY(org_id,id,current_version_id) REFERENCES event_template_versions(org_id,template_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE event_template_instances (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  template_id uuid NOT NULL,
  template_version_id uuid NOT NULL,
  configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object' AND octet_length(configuration::text)<=16000),
  configuration_hash char(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  expected_team_count integer CHECK(expected_team_count BETWEEN 2 AND 32),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id,event_id),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,template_id,template_version_id) REFERENCES event_template_versions(org_id,template_id,id)
);
CREATE INDEX event_template_instances_by_source ON event_template_instances(org_id,template_id,template_version_id);
CREATE TABLE event_template_commands (
  org_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN('CREATE_TEMPLATE','UPDATE_TEMPLATE','ARCHIVE_TEMPLATE','INSTANTIATE')),
  input_hash char(64) NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=32000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id,actor_id,client_request_id),
  FOREIGN KEY(org_id,actor_id) REFERENCES organization_memberships(org_id,user_id)
);
CREATE FUNCTION x03_immutable_template_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Template versions, instances and command receipts are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER x03_template_version_immutable BEFORE UPDATE OR DELETE ON event_template_versions FOR EACH ROW EXECUTE FUNCTION x03_immutable_template_record();
CREATE TRIGGER x03_template_instance_immutable BEFORE UPDATE OR DELETE ON event_template_instances FOR EACH ROW EXECUTE FUNCTION x03_immutable_template_record();
CREATE TRIGGER x03_template_command_immutable BEFORE UPDATE OR DELETE ON event_template_commands FOR EACH ROW EXECUTE FUNCTION x03_immutable_template_record();
CREATE FUNCTION x03_template_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Template history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 OR
     (to_jsonb(NEW)-ARRAY['name','status','version','current_version_id','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['name','status','version','current_version_id','updated_at']) OR OLD.status='ARCHIVED' THEN
    RAISE EXCEPTION 'Template updates require a current active version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER x03_template_head_guard BEFORE UPDATE OR DELETE ON event_templates FOR EACH ROW EXECUTE FUNCTION x03_template_head_guard();
CREATE TRIGGER x03_template_head_no_truncate BEFORE TRUNCATE ON event_templates FOR EACH STATEMENT EXECUTE FUNCTION x03_immutable_template_record();
CREATE TRIGGER x03_template_version_no_truncate BEFORE TRUNCATE ON event_template_versions FOR EACH STATEMENT EXECUTE FUNCTION x03_immutable_template_record();
CREATE TRIGGER x03_template_instance_no_truncate BEFORE TRUNCATE ON event_template_instances FOR EACH STATEMENT EXECUTE FUNCTION x03_immutable_template_record();
CREATE TRIGGER x03_template_command_no_truncate BEFORE TRUNCATE ON event_template_commands FOR EACH STATEMENT EXECUTE FUNCTION x03_immutable_template_record();
CREATE FUNCTION x03_template_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM event_templates WHERE org_id=NEW.org_id AND id=NEW.template_id
    AND status='ACTIVE' AND version=NEW.version_number AND current_version_id=NEW.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template configuration must belong to the current version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER x03_template_version_insert_guard BEFORE INSERT ON event_template_versions FOR EACH ROW EXECUTE FUNCTION x03_template_version_insert_guard();
CREATE FUNCTION x03_template_instance_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_version event_template_versions%ROWTYPE;
BEGIN
  SELECT * INTO source_version FROM event_template_versions WHERE org_id=NEW.org_id
    AND template_id=NEW.template_id AND id=NEW.template_version_id FOR SHARE;
  IF NOT FOUND OR source_version.configuration IS DISTINCT FROM NEW.configuration OR
    source_version.configuration_hash IS DISTINCT FROM NEW.configuration_hash OR
    (NEW.configuration->>'expectedTeams')::integer IS DISTINCT FROM NEW.expected_team_count THEN
    RAISE EXCEPTION 'Template instance must preserve its exact configuration version' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM events WHERE org_id=NEW.org_id AND id=NEW.event_id AND status='DRAFT'
    AND format=NEW.configuration->>'format' AND current_schedule_revision_id IS NULL
    AND locked_ruleset_id IS NULL AND locked_scoring_ruleset_id IS NULL AND locked_standings_ruleset_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template instantiation only creates a new unlocked draft' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER x03_template_instance_insert_guard BEFORE INSERT ON event_template_instances FOR EACH ROW EXECUTE FUNCTION x03_template_instance_insert_guard();
