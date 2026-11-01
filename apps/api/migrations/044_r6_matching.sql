-- R6MATCH: suggestions and mutual interests are not confirmed reservations.
CREATE TABLE matching_supply_preferences (
 source_kind text NOT NULL CHECK(source_kind IN('TEAM_MATCHUP','ADULT_PLAYER','STAFF_SERVICE')),
 source_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES users(id), org_id uuid REFERENCES organizations(id),
 region_catalog_version text NOT NULL, region_id uuid NOT NULL,
 allowed_region_ids uuid[] NOT NULL CHECK(cardinality(allowed_region_ids) BETWEEN 1 AND 20),
 discovery_enabled boolean NOT NULL, contact_enabled boolean NOT NULL,
 adult_confirmed boolean NOT NULL CHECK(adult_confirmed),
 availability jsonb NOT NULL CHECK(jsonb_typeof(availability)='array' AND jsonb_array_length(availability)<=64),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_kind,source_id), FOREIGN KEY(region_catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id)
);
CREATE INDEX matching_preferences_regions ON matching_supply_preferences USING gin(allowed_region_ids) WHERE discovery_enabled AND contact_enabled;
CREATE TABLE matching_needs (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id),org_id uuid NOT NULL REFERENCES organizations(id),team_id uuid,
 kind text NOT NULL CHECK(kind IN('TEAM_MATCHUP','ADULT_PLAYER','STAFF_SERVICE')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 100),address text NOT NULL CHECK(char_length(address) BETWEEN 1 AND 200),
 region_catalog_version text NOT NULL,region_id uuid NOT NULL,allowed_region_ids uuid[] NOT NULL CHECK(cardinality(allowed_region_ids) BETWEEN 1 AND 20),
 role text NOT NULL,quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 16),windows jsonb NOT NULL CHECK(jsonb_typeof(windows)='array' AND jsonb_array_length(windows) BETWEEN 1 AND 64),
 unit_budget_fen integer NOT NULL CHECK(unit_budget_fen BETWEEN 0 AND 100000000),total_budget_fen integer NOT NULL CHECK(total_budget_fen BETWEEN 0 AND 100000000),
 max_travel_minutes integer NOT NULL CHECK(max_travel_minutes BETWEEN 0 AND 1440),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','PAUSED','CLOSED','EXPIRED')),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),version integer NOT NULL DEFAULT 1 CHECK(version>0),latest_run_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,team_id) REFERENCES teams(org_id,id), FOREIGN KEY(region_catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id),
 CHECK(total_budget_fen>=unit_budget_fen*quantity),CHECK(kind='STAFF_SERVICE' OR team_id IS NOT NULL),
 CHECK(kind<>'TEAM_MATCHUP' OR (quantity=1 AND unit_budget_fen=0 AND total_budget_fen=0 AND role='TEAM'))
);
CREATE INDEX matching_needs_owner ON matching_needs(owner_id,created_at DESC,id);
CREATE TABLE matching_demand_slots (
 id uuid PRIMARY KEY,need_id uuid NOT NULL REFERENCES matching_needs(id),seat_no integer NOT NULL CHECK(seat_no BETWEEN 1 AND 16),
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0),state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','CONVERTED','SOURCE_ENDED')),
 UNIQUE(need_id,seat_no),UNIQUE(need_id,id)
);
CREATE TABLE matching_runs (
 id uuid PRIMARY KEY,need_id uuid NOT NULL REFERENCES matching_needs(id),need_version integer NOT NULL CHECK(need_version>0),
 rule_version text NOT NULL CHECK(rule_version='match-rules-v1'),seed text NOT NULL, truncated boolean NOT NULL DEFAULT false,
 status text NOT NULL CHECK(status IN('READY','STALE')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(need_id,id)
);
ALTER TABLE matching_needs ADD FOREIGN KEY(id,latest_run_id) REFERENCES matching_runs(need_id,id);
CREATE TABLE matching_candidates (
 id uuid PRIMARY KEY,need_id uuid NOT NULL,run_id uuid NOT NULL,source_id uuid NOT NULL,source_org_id uuid REFERENCES organizations(id),source_user_id uuid NOT NULL REFERENCES users(id),
 source_version integer NOT NULL CHECK(source_version>0),source_slot_id uuid,preference_version integer NOT NULL CHECK(preference_version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(need_id,run_id) REFERENCES matching_runs(need_id,id),UNIQUE(run_id,source_id),UNIQUE(need_id,id)
);
CREATE TABLE matching_intents (
 id uuid PRIMARY KEY,need_id uuid NOT NULL,slot_id uuid NOT NULL,candidate_id uuid NOT NULL,generation integer NOT NULL CHECK(generation>0),
 need_version integer NOT NULL CHECK(need_version>0),receiver_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','MUTUAL_INTEREST','CONVERTED','DECLINED','WITHDRAWN','EXPIRED','STALE','SUPERSEDED')),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),version integer NOT NULL DEFAULT 1 CHECK(version>0),accepted_at timestamptz,
 source_kind text CHECK(source_kind IN('LOCAL_BOOKING','PLAYER_ORDER','TEAM_MATCHUP')),source_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(need_id,slot_id) REFERENCES matching_demand_slots(need_id,id),FOREIGN KEY(need_id,candidate_id) REFERENCES matching_candidates(need_id,id),
 UNIQUE(slot_id,generation,candidate_id),CHECK((source_kind IS NULL)=(source_id IS NULL)),CHECK((status='CONVERTED')=(source_id IS NOT NULL)),
 CHECK(status NOT IN('MUTUAL_INTEREST','CONVERTED') OR accepted_at IS NOT NULL)
);
CREATE INDEX matching_intents_receiver ON matching_intents(receiver_id,created_at DESC,id);
CREATE TABLE matching_slot_assignments (
 id uuid PRIMARY KEY,need_id uuid NOT NULL,slot_id uuid NOT NULL,generation integer NOT NULL,intent_id uuid NOT NULL UNIQUE REFERENCES matching_intents(id),
 source_user_id uuid NOT NULL REFERENCES users(id),source_kind text NOT NULL CHECK(source_kind IN('LOCAL_BOOKING','PLAYER_ORDER','TEAM_MATCHUP')),source_id uuid NOT NULL,
 amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 0 AND 100000000),retained_cost_fen integer CHECK(retained_cost_fen BETWEEN 0 AND amount_fen),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),ended_at timestamptz,
 FOREIGN KEY(need_id,slot_id) REFERENCES matching_demand_slots(need_id,id),UNIQUE(slot_id,generation),UNIQUE(source_kind,source_id),CHECK(active=(ended_at IS NULL))
);
CREATE UNIQUE INDEX matching_one_person_per_group ON matching_slot_assignments(need_id,source_user_id) WHERE active;
CREATE TABLE matching_command_receipts (
 actor_id uuid NOT NULL REFERENCES users(id),command_id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER matching_receipts_immutable BEFORE UPDATE OR DELETE ON matching_command_receipts FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
CREATE TRIGGER matching_candidates_immutable BEFORE UPDATE OR DELETE ON matching_candidates FOR EACH ROW EXECUTE FUNCTION p03_reject_history_mutation();
CREATE TABLE matching_outbox (
 id uuid PRIMARY KEY,need_id uuid NOT NULL REFERENCES matching_needs(id),intent_id uuid NOT NULL REFERENCES matching_intents(id),recipient_id uuid NOT NULL REFERENCES users(id),
 event text NOT NULL CHECK(event IN('INTENT_SENT','INTENT_ACCEPTED','INTENT_DECLINED','INTENT_WITHDRAWN','CONVERTED')),
 resource_version integer NOT NULL CHECK(resource_version>0),state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CANCELLED','READ')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(intent_id,event,resource_version,recipient_id)
);
