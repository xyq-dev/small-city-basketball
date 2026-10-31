-- Explicit opt-in professional acquisition. Legacy basic JSON and event hashes stay intact.
ALTER TABLE scoring_states
  ADD COLUMN technical_collection boolean NOT NULL DEFAULT false,
  ADD COLUMN professional_stats jsonb,
  ADD CONSTRAINT scoring_states_professional_shape CHECK (
    (NOT technical_collection AND professional_stats IS NULL) OR
    (technical_collection AND collection_mode='PLAYER_BASIC' AND professional_stats IS NOT NULL AND
      jsonb_typeof(professional_stats)='object' AND professional_stats->>'algorithmVersion'='PLAYER_TECHNICAL_V1')
  );

ALTER TABLE result_confirmations
  ADD COLUMN technical_collection boolean NOT NULL DEFAULT false,
  ADD COLUMN professional_stats jsonb,
  ADD CONSTRAINT result_confirmations_professional_shape CHECK (
    (NOT technical_collection AND professional_stats IS NULL) OR
    (technical_collection AND collection_mode='PLAYER_BASIC' AND professional_stats IS NOT NULL AND
      jsonb_typeof(professional_stats)='object' AND professional_stats->>'algorithmVersion'='PLAYER_TECHNICAL_V1')
  );

ALTER TABLE scoring_commands DROP CONSTRAINT scoring_commands_command_type_check;
ALTER TABLE scoring_commands ADD CONSTRAINT scoring_commands_command_type_check CHECK (command_type IN (
  'PREPARE_MATCH','START_MATCH','RECORD_STAT','ADD_CORRECTION','VOID_STAT','REPLACE_STAT',
  'CLOCK_START','CLOCK_PAUSE','CLOCK_SET','NEXT_PERIOD','START_OVERTIME','END_MATCH','CONFIRM_RESULT','REOPEN_RESULT',
  'RECORD_SHOT','RECORD_TECHNICAL','SET_LINEUP','SUBSTITUTE_PLAYER','VOID_PRO_STAT','ADD_PRO_CORRECTION','CORRECT_LINEUP'
));

CREATE OR REPLACE FUNCTION p05_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Scoring states cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.org_id,NEW.event_id,NEW.match_id,NEW.ruleset_id,NEW.created_at,NEW.collection_mode,NEW.technical_collection)
     IS DISTINCT FROM ROW(OLD.org_id,OLD.event_id,OLD.match_id,OLD.ruleset_id,OLD.created_at,OLD.collection_mode,OLD.technical_collection) OR
     NEW.source_version<OLD.source_version OR NEW.last_event_seq<OLD.last_event_seq OR NEW.clock_version<OLD.clock_version THEN
    RAISE EXCEPTION 'Scoring state source and versions cannot be replaced' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
