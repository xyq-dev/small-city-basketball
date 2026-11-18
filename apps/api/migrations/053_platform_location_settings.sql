-- Platform map configuration. Credentials are AES-256-GCM with a root key that is
-- distinct from object storage. Revisions stay immutable. 001-052 are unchanged.
CREATE TABLE location_config_revisions (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE CHECK (version>0),
  provider text NOT NULL CHECK (provider IN ('AMAP','TENCENT')),
  signature_enabled boolean NOT NULL,
  credentials_ciphertext bytea NOT NULL CHECK (octet_length(credentials_ciphertext) BETWEEN 1 AND 40000),
  credentials_nonce bytea NOT NULL CHECK (octet_length(credentials_nonce)=12),
  credentials_tag bytea NOT NULL CHECK (octet_length(credentials_tag)=16),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((provider='AMAP') OR (provider='TENCENT' AND signature_enabled=false))
);
CREATE TABLE location_config_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL DEFAULT 0 CHECK (version>=0),
  external_mode text NOT NULL DEFAULT 'UNCONFIGURED' CHECK (external_mode IN ('UNCONFIGURED','ACTIVE','DISABLED')),
  draft_revision_id uuid REFERENCES location_config_revisions(id),
  active_revision_id uuid REFERENCES location_config_revisions(id),
  activated_at timestamptz,
  activated_by uuid REFERENCES users(id),
  disabled_at timestamptz,
  disabled_by uuid REFERENCES users(id),
  CHECK ((external_mode<>'ACTIVE' AND active_revision_id IS NULL AND activated_at IS NULL AND activated_by IS NULL)
      OR (external_mode='ACTIVE' AND active_revision_id IS NOT NULL AND activated_at IS NOT NULL AND activated_by IS NOT NULL)
      OR (external_mode='DISABLED'))
);
INSERT INTO location_config_state(singleton) VALUES (true);
CREATE TABLE location_config_operations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('SAVE','TEST','ACTIVATE','DISABLE')),
  status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  config_version integer NOT NULL CHECK (config_version>=0),
  result jsonb,
  test_result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (actor_id, command_id),
  CHECK ((status='PENDING' AND completed_at IS NULL) OR (status<>'PENDING' AND completed_at IS NOT NULL))
);
CREATE INDEX location_config_operations_latest ON location_config_operations(kind, created_at DESC, id);
CREATE FUNCTION c53_location_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Location configuration history is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER location_config_revisions_immutable BEFORE UPDATE OR DELETE ON location_config_revisions
  FOR EACH ROW EXECUTE FUNCTION c53_location_immutable();
CREATE FUNCTION c53_location_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.singleton IS DISTINCT FROM OLD.singleton THEN
    RAISE EXCEPTION 'Location configuration singleton is permanent' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.version>2147483646 THEN
    RAISE EXCEPTION 'Location configuration version must advance exactly once' USING ERRCODE='23514';
  END IF;
  IF NEW.draft_revision_id IS DISTINCT FROM OLD.draft_revision_id
     AND NEW.active_revision_id IS NOT DISTINCT FROM OLD.active_revision_id
     AND NEW.external_mode IS NOT DISTINCT FROM OLD.external_mode
     AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
     AND NEW.activated_by IS NOT DISTINCT FROM OLD.activated_by
     AND NEW.disabled_at IS NOT DISTINCT FROM OLD.disabled_at
     AND NEW.disabled_by IS NOT DISTINCT FROM OLD.disabled_by THEN
    IF NOT EXISTS (SELECT 1 FROM location_config_revisions WHERE id=NEW.draft_revision_id AND version=NEW.version) THEN
      RAISE EXCEPTION 'Saving a draft never activates location' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.external_mode='ACTIVE'
     AND NEW.draft_revision_id IS NOT DISTINCT FROM OLD.draft_revision_id
     AND NEW.active_revision_id IS NOT DISTINCT FROM NEW.draft_revision_id
     AND NEW.activated_at IS NOT NULL AND NEW.activated_by IS NOT NULL THEN
    NULL;
  ELSIF NEW.external_mode='DISABLED'
     AND OLD.external_mode<>'DISABLED'
     AND NEW.draft_revision_id IS NOT DISTINCT FROM OLD.draft_revision_id
     AND NEW.active_revision_id IS NOT DISTINCT FROM OLD.active_revision_id
     AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
     AND NEW.activated_by IS NOT DISTINCT FROM OLD.activated_by
     AND NEW.disabled_at IS NOT NULL AND NEW.disabled_by IS NOT NULL THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Location configuration change is not an allowed draft, activation, or disable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER location_config_state_guard BEFORE UPDATE OR DELETE ON location_config_state
  FOR EACH ROW EXECUTE FUNCTION c53_location_state_guard();
CREATE FUNCTION c53_location_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'PENDING' OR
    (to_jsonb(NEW)-ARRAY['status','result','test_result','completed_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','result','test_result','completed_at']) THEN
    RAISE EXCEPTION 'Location command identity and terminal receipts are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER location_config_operations_guard BEFORE UPDATE OR DELETE ON location_config_operations
  FOR EACH ROW EXECUTE FUNCTION c53_location_operation_guard();
REVOKE ALL ON location_config_revisions, location_config_state, location_config_operations FROM PUBLIC;
