-- Optional player attribution projects the existing scoring stream. Old games remain TEAM_ONLY.
ALTER TABLE scoring_states
  ADD COLUMN collection_mode text NOT NULL DEFAULT 'TEAM_ONLY'
    CHECK (collection_mode IN ('TEAM_ONLY', 'PLAYER_BASIC')),
  ADD COLUMN player_stats jsonb,
  ADD CONSTRAINT scoring_states_player_stats_shape CHECK (
    (collection_mode = 'TEAM_ONLY' AND player_stats IS NULL) OR
    (collection_mode = 'PLAYER_BASIC' AND player_stats IS NOT NULL AND
      jsonb_typeof(player_stats) = 'object' AND (player_stats->>'mode') IS NOT DISTINCT FROM 'PLAYER_BASIC')
  );

ALTER TABLE result_confirmations
  ADD COLUMN collection_mode text NOT NULL DEFAULT 'TEAM_ONLY'
    CHECK (collection_mode IN ('TEAM_ONLY', 'PLAYER_BASIC')),
  ADD COLUMN player_stats jsonb,
  ADD CONSTRAINT result_confirmations_player_stats_shape CHECK (
    (collection_mode = 'TEAM_ONLY' AND player_stats IS NULL) OR
    (collection_mode = 'PLAYER_BASIC' AND player_stats IS NOT NULL AND
      jsonb_typeof(player_stats) = 'object' AND (player_stats->>'mode') IS NOT DISTINCT FROM 'PLAYER_BASIC')
  );

CREATE OR REPLACE FUNCTION p05_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Scoring states cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.org_id, NEW.event_id, NEW.match_id, NEW.ruleset_id, NEW.created_at, NEW.collection_mode) IS DISTINCT FROM
     ROW(OLD.org_id, OLD.event_id, OLD.match_id, OLD.ruleset_id, OLD.created_at, OLD.collection_mode) OR
     NEW.source_version < OLD.source_version OR NEW.last_event_seq < OLD.last_event_seq OR NEW.clock_version < OLD.clock_version THEN
    RAISE EXCEPTION 'Scoring state source and versions cannot be replaced' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
