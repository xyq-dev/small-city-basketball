-- C23: explicit opt-in only; old locked rules and rosters remain unchanged.
ALTER TABLE event_rulesets ADD COLUMN require_participant_materials boolean NOT NULL DEFAULT false;

ALTER TABLE team_member_bindings ADD CONSTRAINT c23_binding_identity UNIQUE (org_id,team_id,member_id,user_id,id);

CREATE TABLE participant_materials (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  member_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  binding_id uuid NOT NULL,
  key_id text NOT NULL CHECK (key_id ~ '^[0-9a-f]{16,64}$'),
  identity_digest char(64) CHECK (identity_digest IS NULL OR identity_digest ~ '^[0-9a-f]{64}$'),
  current_revision_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','CHANGES_REQUESTED')),
  publicity_consent boolean NOT NULL DEFAULT false,
  reservation_active boolean NOT NULL DEFAULT true,
  legal_hold boolean NOT NULL DEFAULT false,
  reviewer_id uuid REFERENCES users(id),
  review_reason text CHECK (review_reason IS NULL OR (review_reason=btrim(review_reason) AND char_length(review_reason) BETWEEN 1 AND 500)),
  reviewed_start_date date,
  reviewed_end_date date,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id,event_id,entry_id,member_id),
  UNIQUE (org_id,event_id,id),
  UNIQUE (org_id,event_id,team_id,entry_id,member_id,user_id,id),
  FOREIGN KEY (org_id,event_id,entry_id) REFERENCES entries(org_id,event_id,id),
  FOREIGN KEY (org_id,team_id,entry_id) REFERENCES entries(org_id,team_id,id),
  FOREIGN KEY (org_id,team_id,member_id) REFERENCES team_members(org_id,team_id,id),
  FOREIGN KEY (org_id,team_id,member_id,user_id,binding_id) REFERENCES team_member_bindings(org_id,team_id,member_id,user_id,id),
  CHECK (reviewer_id IS NULL OR reviewer_id<>user_id),
  CHECK ((status IN ('APPROVED','CHANGES_REQUESTED')) = (reviewer_id IS NOT NULL AND review_reason IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK ((status='APPROVED') = (reviewed_start_date IS NOT NULL AND reviewed_end_date IS NOT NULL)),
  CHECK (reviewed_end_date IS NULL OR reviewed_end_date>=reviewed_start_date)
);
CREATE UNIQUE INDEX participant_identity_one_event ON participant_materials(org_id,event_id,identity_digest) WHERE reservation_active AND identity_digest IS NOT NULL;
CREATE UNIQUE INDEX participant_user_one_event ON participant_materials(org_id,event_id,user_id) WHERE reservation_active;
CREATE INDEX participant_materials_by_entry ON participant_materials(org_id,entry_id,member_id);

CREATE TABLE participant_material_revisions (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  member_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  ruleset_id uuid NOT NULL,
  roster_revision_id uuid NOT NULL,
  jersey_no text NOT NULL CHECK (jersey_no ~ '^(0|00|[1-9][0-9]?)$'),
  key_id text NOT NULL CHECK (key_id ~ '^[0-9a-f]{16,64}$'),
  payload_ciphertext text,
  payload_byte_length integer NOT NULL CHECK (payload_byte_length BETWEEN 1 AND 25000000),
  has_identity boolean NOT NULL,
  has_real_name boolean NOT NULL,
  has_signature boolean NOT NULL,
  portrait_sha256 char(64) CHECK (portrait_sha256 IS NULL OR portrait_sha256 ~ '^[0-9a-f]{64}$'),
  portrait_bytes integer NOT NULL CHECK (portrait_bytes BETWEEN 0 AND 8388608),
  insurance_bytes integer NOT NULL CHECK (insurance_bytes BETWEEN 0 AND 8388608),
  insurance_start_date date,
  insurance_end_date date,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id,client_request_id),
  UNIQUE (org_id,event_id,material_id,id),
  FOREIGN KEY (org_id,event_id,team_id,entry_id,member_id,user_id,material_id)
    REFERENCES participant_materials(org_id,event_id,team_id,entry_id,member_id,user_id,id),
  FOREIGN KEY (org_id,event_id,ruleset_id) REFERENCES event_rulesets(org_id,event_id,id),
  FOREIGN KEY (org_id,entry_id,roster_revision_id) REFERENCES entry_roster_revisions(org_id,entry_id,id),
  CHECK ((payload_ciphertext IS NULL)=(purged_at IS NOT NULL)),
  CHECK (insurance_end_date IS NULL OR (insurance_start_date IS NOT NULL AND insurance_end_date>=insurance_start_date)),
  CHECK ((portrait_bytes=0)=(portrait_sha256 IS NULL))
);
ALTER TABLE participant_materials ADD CONSTRAINT participant_current_revision_fk
  FOREIGN KEY (org_id,event_id,id,current_revision_id)
  REFERENCES participant_material_revisions(org_id,event_id,material_id,id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX participant_revisions_by_material ON participant_material_revisions(material_id,created_at,id);

-- Revisions and request receipts do not expire. Only ciphertext may be irreversibly purged;
-- preserve metadata/tombstones so an old clientRequestId can never create another revision.
CREATE FUNCTION c23_protect_material_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eligible boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Participant revision receipts cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['payload_ciphertext','purged_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['payload_ciphertext','purged_at'])
    OR OLD.payload_ciphertext IS NULL OR NEW.payload_ciphertext IS NOT NULL OR NEW.purged_at IS NULL THEN
    RAISE EXCEPTION 'Participant revisions are immutable' USING ERRCODE='23514';
  END IF;
  SELECT (e.status IN ('ARCHIVED','CANCELLED') AND current_date>e.end_date+90 AND NOT m.legal_hold)
    INTO eligible FROM participant_materials m JOIN events e ON e.org_id=m.org_id AND e.id=m.event_id
    WHERE m.id=OLD.material_id;
  IF eligible IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Participant material retention has not ended' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_revisions_immutable BEFORE UPDATE OR DELETE ON participant_material_revisions
  FOR EACH ROW EXECUTE FUNCTION c23_protect_material_revision();
