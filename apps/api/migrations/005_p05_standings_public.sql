CREATE TABLE standings_rulesets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  algorithm_version text NOT NULL DEFAULT 'RR_STANDINGS_V1' CHECK (algorithm_version = 'RR_STANDINGS_V1'),
  win_points integer NOT NULL CHECK (win_points BETWEEN 0 AND 1000),
  loss_points integer NOT NULL CHECK (loss_points BETWEEN 0 AND 1000),
  draw_points integer NOT NULL CHECK (draw_points BETWEEN 0 AND 1000),
  tiebreakers text[] NOT NULL CHECK (
    cardinality(tiebreakers) BETWEEN 0 AND 3 AND
    tiebreakers <@ ARRAY['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS']::text[] AND
    array_position(tiebreakers, NULL) IS NULL AND
    (cardinality(tiebreakers) = 0 OR
      (array_ndims(tiebreakers) = 1 AND array_lower(tiebreakers, 1) = 1 AND
        (cardinality(tiebreakers) = 1 OR
          (cardinality(tiebreakers) = 2 AND tiebreakers[1] <> tiebreakers[2]) OR
          (cardinality(tiebreakers) = 3 AND tiebreakers[1] <> tiebreakers[2] AND
            tiebreakers[1] <> tiebreakers[3] AND tiebreakers[2] <> tiebreakers[3]))))
  ),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, event_id, version),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id)
);

ALTER TABLE events
  ADD COLUMN current_standings_ruleset_id uuid,
  ADD COLUMN locked_standings_ruleset_id uuid,
  ADD CONSTRAINT events_current_standings_ruleset_fk FOREIGN KEY (org_id, id, current_standings_ruleset_id)
    REFERENCES standings_rulesets(org_id, event_id, id),
  ADD CONSTRAINT events_locked_standings_ruleset_fk FOREIGN KEY (org_id, id, locked_standings_ruleset_id)
    REFERENCES standings_rulesets(org_id, event_id, id),
  ADD CONSTRAINT events_locked_standings_ruleset_current_check CHECK (locked_standings_ruleset_id IS NULL OR
    (current_standings_ruleset_id IS NOT NULL AND current_standings_ruleset_id = locked_standings_ruleset_id));

CREATE TABLE public_event_publications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  schedule_publication_id uuid NOT NULL,
  ruleset_id uuid NOT NULL,
  public_event_id text NOT NULL UNIQUE CHECK (public_event_id ~ '^[A-Za-z0-9_-]{43}$'),
  team_keys jsonb NOT NULL CHECK (jsonb_typeof(team_keys) = 'object'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  UNIQUE (org_id, event_id, id),
  UNIQUE (org_id, event_id, id, schedule_publication_id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, event_id, schedule_publication_id) REFERENCES schedule_publications(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, ruleset_id) REFERENCES standings_rulesets(org_id, event_id, id),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND isfinite(revoked_at) AND revoked_at >= created_at))
);

CREATE UNIQUE INDEX public_event_publications_one_active ON public_event_publications(org_id, event_id)
  WHERE revoked_at IS NULL;
CREATE INDEX public_event_publications_by_event ON public_event_publications(org_id, event_id, created_at DESC, id DESC);

CREATE TABLE public_match_links (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  schedule_publication_id uuid NOT NULL,
  match_id uuid NOT NULL,
  public_match_id text NOT NULL UNIQUE CHECK (public_match_id ~ '^[A-Za-z0-9_-]{43}$'),
  PRIMARY KEY (publication_id, match_id),
  FOREIGN KEY (org_id, event_id, publication_id, schedule_publication_id)
    REFERENCES public_event_publications(org_id, event_id, id, schedule_publication_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, schedule_publication_id, match_id) REFERENCES published_matches(org_id, publication_id, id)
);

CREATE FUNCTION p05b_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Standings and public identity history is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER standings_rulesets_immutable BEFORE UPDATE OR DELETE ON standings_rulesets
  FOR EACH ROW EXECUTE FUNCTION p05b_reject_history_mutation();
CREATE TRIGGER public_match_links_immutable BEFORE UPDATE OR DELETE ON public_match_links
  FOR EACH ROW EXECUTE FUNCTION p05b_reject_history_mutation();

CREATE FUNCTION p05b_protect_locked_ruleset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_standings_ruleset_id IS NOT NULL AND NEW.locked_standings_ruleset_id IS DISTINCT FROM OLD.locked_standings_ruleset_id THEN
    RAISE EXCEPTION 'The standings ruleset is already locked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_protect_locked_standings_ruleset BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION p05b_protect_locked_ruleset();

CREATE FUNCTION p05b_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked_ruleset uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Public publications cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_xid <> pg_current_xact_id() OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL THEN
      RAISE EXCEPTION 'A public publication must start active in its creating transaction' USING ERRCODE = '23514';
    END IF;
    SELECT e.locked_standings_ruleset_id INTO locked_ruleset FROM events e
      WHERE e.org_id = NEW.org_id AND e.id = NEW.event_id FOR SHARE;
    IF locked_ruleset IS NULL OR locked_ruleset IS DISTINCT FROM NEW.ruleset_id THEN
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

CREATE TRIGGER public_event_publications_guard BEFORE INSERT OR UPDATE OR DELETE ON public_event_publications
  FOR EACH ROW EXECUTE FUNCTION p05b_publication_guard();

CREATE FUNCTION p05b_match_link_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  publication_xid xid8;
  publication_revoked_at timestamptz;
BEGIN
  SELECT p.created_xid, p.revoked_at INTO publication_xid, publication_revoked_at FROM public_event_publications p
    WHERE p.org_id = NEW.org_id AND p.event_id = NEW.event_id AND p.id = NEW.publication_id
      AND p.schedule_publication_id = NEW.schedule_publication_id FOR SHARE;
  IF NOT FOUND OR publication_xid <> pg_current_xact_id() OR publication_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Public match identities must be inserted with their initial publication' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER public_match_links_insert_guard BEFORE INSERT ON public_match_links
  FOR EACH ROW EXECUTE FUNCTION p05b_match_link_insert_guard();

CREATE FUNCTION p05b_publication_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  frozen_entries jsonb;
  expected_team_count integer;
  distinct_entry_count integer;
  expected_match_count integer;
  actual_link_count integer;
  mapped_team_count integer;
  distinct_public_key_count integer;
BEGIN
  SELECT r.source -> 'entries' INTO frozen_entries FROM schedule_publications p
    JOIN schedule_revisions r ON r.org_id = p.org_id AND r.event_id = p.event_id AND r.id = p.revision_id
    WHERE p.org_id = NEW.org_id AND p.event_id = NEW.event_id AND p.id = NEW.schedule_publication_id;
  IF frozen_entries IS NULL OR jsonb_typeof(frozen_entries) <> 'array' THEN
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
  IF expected_match_count <> expected_team_count * (expected_team_count - 1) / 2 OR actual_link_count <> expected_match_count THEN
    RAISE EXCEPTION 'Public publication must map every official schedule match atomically' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER public_event_publications_complete_guard AFTER INSERT ON public_event_publications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p05b_publication_complete_guard();
