-- E08: opt-in youth participation; no existing event or material is silently changed.
CREATE TABLE youth_event_policies (
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  enabled boolean NOT NULL DEFAULT false,
  guardian_age_threshold integer NOT NULL DEFAULT 18 CHECK(guardian_age_threshold BETWEEN 18 AND 21),
  terms_version text NOT NULL CHECK(char_length(terms_version) BETWEEN 1 AND 80),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id,event_id),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);

CREATE TABLE youth_guardian_preconsents (
 id uuid PRIMARY KEY,org_id uuid NOT NULL,event_id uuid NOT NULL,
 subject_user_id uuid NOT NULL REFERENCES users(id),guardian_user_id uuid NOT NULL REFERENCES users(id),
 subject_alias text NOT NULL CHECK(char_length(subject_alias) BETWEEN 1 AND 40),
 policy_version integer NOT NULL CHECK(policy_version>0),data_terms_version text NOT NULL CHECK(data_terms_version='youth-data-processing-v1'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),status text NOT NULL DEFAULT 'INVITED' CHECK(status IN('INVITED','CONSENTED','DECLINED','WITHDRAWN')),
 guardian_confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,event_id,id),FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
 CHECK(subject_user_id<>guardian_user_id),CHECK(status<>'CONSENTED' OR guardian_confirmed_at IS NOT NULL)
);
CREATE UNIQUE INDEX youth_one_data_preconsent ON youth_guardian_preconsents(org_id,event_id,subject_user_id) WHERE status IN('INVITED','CONSENTED');
CREATE INDEX youth_preconsents_by_guardian ON youth_guardian_preconsents(guardian_user_id,created_at,id);

CREATE TABLE youth_guardian_requests (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  member_id uuid NOT NULL,
  subject_user_id uuid NOT NULL REFERENCES users(id),
  guardian_user_id uuid NOT NULL REFERENCES users(id),
  material_id uuid NOT NULL,
  material_revision_id uuid NOT NULL,
  qualification_id uuid NOT NULL,
  preconsent_id uuid NOT NULL,
  preconsent_version integer NOT NULL CHECK(preconsent_version>0),
  roster_revision_id uuid NOT NULL,
  ruleset_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK(policy_version>0),
  terms_version text NOT NULL CHECK(char_length(terms_version) BETWEEN 1 AND 80),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  status text NOT NULL DEFAULT 'AWAITING_GUARDIAN' CHECK(status IN('AWAITING_GUARDIAN','AWAITING_REVIEW','APPROVED','REJECTED','WITHDRAWN')),
  subject_confirmed_at timestamptz NOT NULL,
  subject_purposes text[] NOT NULL DEFAULT ARRAY['PARTICIPATION']::text[],
  guardian_purposes text[] NOT NULL DEFAULT ARRAY[]::text[],
  guardian_confirmed_at timestamptz,
  guardian_payload_version integer NOT NULL DEFAULT 0 CHECK(guardian_payload_version>=0),
  guardian_payload_ciphertext text,
  guardian_payload_bytes integer NOT NULL DEFAULT 0 CHECK(guardian_payload_bytes BETWEEN 0 AND 20971520),
  guardian_payload_hash char(64),
  guardian_key_id char(64),
  reviewed_payload_version integer,
  guardian_identity_checked boolean NOT NULL DEFAULT false,
  relationship_checked boolean NOT NULL DEFAULT false,
  guardian_adult_checked boolean NOT NULL DEFAULT false,
  reviewer_id uuid REFERENCES users(id),
  review_reason text CHECK(review_reason IS NULL OR char_length(review_reason) BETWEEN 1 AND 500),
  reviewed_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  proof_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(org_id,event_id,id),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,event_id,preconsent_id) REFERENCES youth_guardian_preconsents(org_id,event_id,id),
  FOREIGN KEY(org_id,event_id,entry_id) REFERENCES entries(org_id,event_id,id),
  FOREIGN KEY(org_id,event_id,team_id,entry_id,member_id,subject_user_id,material_id)
    REFERENCES participant_materials(org_id,event_id,team_id,entry_id,member_id,user_id,id),
  FOREIGN KEY(org_id,event_id,material_id,material_revision_id)
    REFERENCES participant_material_revisions(org_id,event_id,material_id,id),
  FOREIGN KEY(org_id,entry_id,roster_revision_id) REFERENCES entry_roster_revisions(org_id,entry_id,id),
  FOREIGN KEY(org_id,event_id,ruleset_id) REFERENCES event_rulesets(org_id,event_id,id),
  CHECK(subject_user_id<>guardian_user_id),
  CHECK(subject_purposes <@ ARRAY['PARTICIPATION','PUBLICITY','PUBLIC_ARCHIVE','LIVE_RECORDING']::text[] AND subject_purposes @> ARRAY['PARTICIPATION']::text[]),
  CHECK(guardian_purposes <@ ARRAY['PARTICIPATION','PUBLICITY','PUBLIC_ARCHIVE','LIVE_RECORDING']::text[]),
  CHECK(guardian_confirmed_at IS NULL OR guardian_purposes @> ARRAY['PARTICIPATION']::text[]),
  CHECK(reviewer_id IS NULL OR (reviewer_id<>subject_user_id AND reviewer_id<>guardian_user_id)),
  CHECK((guardian_payload_version=0)=(guardian_confirmed_at IS NULL)),
  CHECK((guardian_payload_hash IS NULL)=(guardian_payload_version=0)),
  CHECK(guardian_payload_hash IS NULL OR guardian_payload_hash ~ '^[0-9a-f]{64}$'),
  CHECK(guardian_key_id IS NULL OR guardian_key_id ~ '^[0-9a-f]{64}$'),
  CHECK(guardian_payload_version=0 OR guardian_key_id IS NOT NULL),
  CHECK(guardian_payload_ciphertext IS NULL OR (guardian_payload_version>0 AND guardian_payload_bytes>0 AND proof_purged_at IS NULL)),
  CHECK(proof_purged_at IS NULL OR guardian_payload_ciphertext IS NULL),
  CHECK(status NOT IN('AWAITING_REVIEW','APPROVED','REJECTED') OR guardian_confirmed_at IS NOT NULL),
  CHECK(status<>'APPROVED' OR (guardian_identity_checked AND relationship_checked AND guardian_adult_checked
    AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL
    AND reviewed_payload_version=guardian_payload_version AND guardian_payload_version>0
    AND guardian_payload_ciphertext IS NOT NULL AND proof_purged_at IS NULL))
);
CREATE UNIQUE INDEX youth_one_active_guardian ON youth_guardian_requests(org_id,event_id,entry_id,member_id)
  WHERE status IN('AWAITING_GUARDIAN','AWAITING_REVIEW','APPROVED');
CREATE INDEX youth_guardians_by_subject ON youth_guardian_requests(subject_user_id,created_at,id);
CREATE INDEX youth_guardians_by_guardian ON youth_guardian_requests(guardian_user_id,created_at,id);
CREATE INDEX youth_guardians_by_event ON youth_guardian_requests(org_id,event_id,status,created_at,id);

CREATE TABLE youth_guardian_history (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES youth_guardian_requests(id),
  version integer NOT NULL CHECK(version>0),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK(action IN('PROPOSE','GUARDIAN_CONFIRM','REVIEW_APPROVE','REVIEW_REJECT','WITHDRAW','SOURCE_CHANGED','ACCOUNT_CLOSURE','PURGE_PROOF')),
  facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id,version)
);
CREATE TABLE youth_guardian_commands (
  actor_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  request_id uuid REFERENCES youth_guardian_requests(id),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,client_request_id),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE FUNCTION e08_immutable_guardian_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Guardian facts and command receipts are append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER youth_guardian_history_immutable BEFORE UPDATE OR DELETE ON youth_guardian_history
  FOR EACH ROW EXECUTE FUNCTION e08_immutable_guardian_fact();
CREATE TRIGGER youth_guardian_commands_immutable BEFORE UPDATE OR DELETE ON youth_guardian_commands
  FOR EACH ROW EXECUTE FUNCTION e08_immutable_guardian_fact();

CREATE TABLE youth_preconsent_history (
 id uuid PRIMARY KEY,preconsent_id uuid NOT NULL REFERENCES youth_guardian_preconsents(id),version integer NOT NULL CHECK(version>0),actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK(action IN('INVITE','CONSENT','DECLINE','WITHDRAW','ACCOUNT_CLOSURE')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(preconsent_id,version)
);
CREATE TRIGGER youth_preconsent_history_immutable BEFORE UPDATE OR DELETE ON youth_preconsent_history FOR EACH ROW EXECUTE FUNCTION e08_immutable_guardian_fact();

CREATE FUNCTION e08_protect_guardian_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Guardian consent history is retained' USING ERRCODE='23514';END IF;
 IF NEW.version<>OLD.version+1 OR
  (to_jsonb(NEW)-ARRAY['version','status','guardian_confirmed_at','guardian_purposes','guardian_payload_version','guardian_payload_ciphertext','guardian_payload_bytes','guardian_payload_hash','guardian_key_id','reviewed_payload_version','guardian_identity_checked','relationship_checked','guardian_adult_checked','reviewer_id','review_reason','reviewed_at','legal_hold','proof_purged_at','updated_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['version','status','guardian_confirmed_at','guardian_purposes','guardian_payload_version','guardian_payload_ciphertext','guardian_payload_bytes','guardian_payload_hash','guardian_key_id','reviewed_payload_version','guardian_identity_checked','relationship_checked','guardian_adult_checked','reviewer_id','review_reason','reviewed_at','legal_hold','proof_purged_at','updated_at']) THEN
  RAISE EXCEPTION 'Guardian consent sources are immutable and versioned' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER youth_guardian_source_immutable BEFORE UPDATE OR DELETE ON youth_guardian_requests FOR EACH ROW EXECUTE FUNCTION e08_protect_guardian_source();
CREATE FUNCTION e08_protect_preconsent_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Prior data consent history is retained' USING ERRCODE='23514';END IF;
 IF NEW.version<>OLD.version+1 OR
  (to_jsonb(NEW)-ARRAY['version','status','guardian_confirmed_at','updated_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['version','status','guardian_confirmed_at','updated_at']) THEN
  RAISE EXCEPTION 'Prior data consent sources are immutable and versioned' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER youth_preconsent_source_immutable BEFORE UPDATE OR DELETE ON youth_guardian_preconsents FOR EACH ROW EXECUTE FUNCTION e08_protect_preconsent_source();
