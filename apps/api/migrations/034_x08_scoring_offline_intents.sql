-- Durable logical-operation receipts. Leases are deliberately absent from this ledger.
CREATE TABLE scoring_offline_intents (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  intent_id uuid NOT NULL,
  queue_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 10000),
  previous_intent_id uuid,
  intent_hash char(64) NOT NULL CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
  command_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(accepted_at)),
  PRIMARY KEY (org_id,actor_id,match_id,intent_id),
  UNIQUE (org_id,actor_id,match_id,queue_id,ordinal),
  UNIQUE (org_id,actor_id,match_id,command_id),
  FOREIGN KEY (org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id),
  FOREIGN KEY (org_id,actor_id,match_id,command_id) REFERENCES scoring_commands(org_id,actor_id,match_id,command_id),
  FOREIGN KEY (org_id,actor_id,match_id,previous_intent_id) REFERENCES scoring_offline_intents(org_id,actor_id,match_id,intent_id),
  CHECK (intent_id=command_id),
  CHECK ((ordinal=1 AND previous_intent_id IS NULL) OR (ordinal>1 AND previous_intent_id IS NOT NULL AND previous_intent_id<>intent_id))
);
CREATE TRIGGER scoring_offline_intents_immutable BEFORE UPDATE OR DELETE ON scoring_offline_intents
  FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
