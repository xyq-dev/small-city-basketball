-- Platform-wide configuration: credentials are AES-256-GCM ciphertext, with an independent
-- deployment key kept outside the database. Revisions and object locations are immutable.
CREATE TABLE storage_config_revisions (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE CHECK (version>0),
  mode text NOT NULL CHECK (mode='COS'),
  bucket text NOT NULL CHECK (char_length(bucket)<=63 AND bucket ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?-[1-9][0-9]{4,19}$'),
  region text NOT NULL CHECK (char_length(region)<=40 AND region ~ '^[a-z]{2}-[a-z]+(-[a-z0-9]+)*$'),
  prefix text NOT NULL CHECK (char_length(prefix) BETWEEN 1 AND 128 AND prefix ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'),
  credentials_ciphertext bytea NOT NULL CHECK (octet_length(credentials_ciphertext) BETWEEN 1 AND 40000),
  credentials_nonce bytea NOT NULL CHECK (octet_length(credentials_nonce)=12),
  credentials_tag bytea NOT NULL CHECK (octet_length(credentials_tag)=16),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE storage_config_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  draft_revision_id uuid REFERENCES storage_config_revisions(id),
  active_revision_id uuid REFERENCES storage_config_revisions(id),
  activated_at timestamptz,
  activated_by uuid REFERENCES users(id),
  CHECK ((active_revision_id IS NULL AND activated_at IS NULL AND activated_by IS NULL)
      OR (active_revision_id IS NOT NULL AND activated_at IS NOT NULL AND activated_by IS NOT NULL))
);
INSERT INTO storage_config_state(singleton) VALUES(true);
CREATE TABLE storage_config_operations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK(kind IN ('SAVE','TEST','ACTIVATE')),
  status text NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
  config_version integer NOT NULL CHECK(config_version>=0),
  result jsonb,
  test_result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(actor_id,command_id),
  CHECK ((status='PENDING' AND completed_at IS NULL) OR (status<>'PENDING' AND completed_at IS NOT NULL))
);
CREATE INDEX storage_config_operations_latest ON storage_config_operations(kind,created_at DESC,id);
CREATE TABLE storage_config_probes (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES storage_config_operations(id),
  revision_id uuid NOT NULL REFERENCES storage_config_revisions(id),
  bucket text NOT NULL,
  region text NOT NULL,
  prefix text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  put_confirmed_at timestamptz,
  cleanup_attempted_at timestamptz,
  deleted_at timestamptz,
  UNIQUE(bucket,region,object_key),
  CHECK (object_key ~ ('^' || prefix || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || id::text || '$')),
  CHECK (deleted_at IS NULL OR deleted_at>=created_at),
  CHECK (cleanup_attempted_at IS NULL OR cleanup_attempted_at>=created_at)
);
CREATE INDEX storage_config_probes_pending ON storage_config_probes(created_at,id) WHERE deleted_at IS NULL;
CREATE FUNCTION c51_storage_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Storage configuration history is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER storage_config_revisions_immutable BEFORE UPDATE OR DELETE ON storage_config_revisions
  FOR EACH ROW EXECUTE FUNCTION c51_storage_immutable();
CREATE FUNCTION c51_storage_probe_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['put_confirmed_at','cleanup_attempted_at','deleted_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['put_confirmed_at','cleanup_attempted_at','deleted_at']) OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Storage probe identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.put_confirmed_at IS NOT NULL AND (NEW.put_confirmed_at<OLD.created_at OR NEW.put_confirmed_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Probe PUT confirmation time is invalid' USING ERRCODE='23514';
  END IF;
  IF OLD.put_confirmed_at IS NOT NULL AND NEW.put_confirmed_at IS DISTINCT FROM OLD.put_confirmed_at THEN
    RAISE EXCEPTION 'Probe PUT confirmation is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND NEW.put_confirmed_at IS NULL AND OLD.created_at>clock_timestamp()-interval '24 hours' THEN
    RAISE EXCEPTION 'Unknown PUT outcomes retain a 24 hour cleanup grace period' USING ERRCODE='23514';
  END IF;
  IF NEW.cleanup_attempted_at IS NOT NULL AND (NEW.cleanup_attempted_at>clock_timestamp() OR
    (OLD.cleanup_attempted_at IS NOT NULL AND NEW.cleanup_attempted_at<=OLD.cleanup_attempted_at)) THEN
    RAISE EXCEPTION 'Storage probe cleanup clock must advance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER storage_config_probes_guard BEFORE UPDATE OR DELETE ON storage_config_probes
  FOR EACH ROW EXECUTE FUNCTION c51_storage_probe_guard();
REVOKE ALL ON storage_config_revisions,storage_config_state,storage_config_operations,storage_config_probes FROM PUBLIC;
CREATE FUNCTION c51_storage_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.singleton IS DISTINCT FROM OLD.singleton THEN
    RAISE EXCEPTION 'Storage configuration singleton is permanent' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.version>2147483646 THEN
    RAISE EXCEPTION 'Storage configuration version must advance exactly once' USING ERRCODE='23514';
  END IF;
  IF NEW.draft_revision_id IS DISTINCT FROM OLD.draft_revision_id THEN
    IF NEW.active_revision_id IS DISTINCT FROM OLD.active_revision_id OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.activated_by IS DISTINCT FROM OLD.activated_by OR NOT EXISTS(SELECT 1 FROM storage_config_revisions WHERE id=NEW.draft_revision_id AND version=NEW.version) THEN
      RAISE EXCEPTION 'Saving a draft never activates storage' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.active_revision_id IS DISTINCT FROM NEW.draft_revision_id OR NEW.activated_at IS NULL OR NEW.activated_by IS NULL THEN
      RAISE EXCEPTION 'Only the saved revision may be activated' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER storage_config_state_guard BEFORE UPDATE OR DELETE ON storage_config_state
  FOR EACH ROW EXECUTE FUNCTION c51_storage_state_guard();
CREATE FUNCTION c51_storage_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'PENDING' OR
    (to_jsonb(NEW)-ARRAY['status','result','test_result','completed_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','result','test_result','completed_at']) THEN
    RAISE EXCEPTION 'Storage command identity and terminal receipts are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER storage_config_operations_guard BEFORE UPDATE OR DELETE ON storage_config_operations
  FOR EACH ROW EXECUTE FUNCTION c51_storage_operation_guard();
