-- COS01: keep the frozen 001--049 history and old database-backed files intact.
-- A staging record is committed on a separate connection before writing an object. It has
-- deliberately no organization FK: the authorized business transaction already holds the
-- organization lock, and waiting for its own FK lock on another connection would deadlock.
CREATE TABLE media_cos_objects (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  bucket text NOT NULL CHECK (
    char_length(bucket) <= 63 AND
    bucket ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?-[1-9][0-9]{4,19}$'
  ),
  region text NOT NULL CHECK (
    char_length(region) <= 40 AND region ~ '^[a-z]{2}-[a-z]+(-[a-z0-9]+)*$'
  ),
  object_key text NOT NULL CHECK (
    char_length(object_key) BETWEEN 112 AND 239 AND
    object_key ~ ('^([a-z0-9]+(-[a-z0-9]+)*/)+' || org_id::text || '/' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleanup_attempted_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (org_id,id),
  UNIQUE (bucket,region,object_key),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CHECK (cleanup_attempted_at IS NULL OR cleanup_attempted_at >= created_at)
);
CREATE INDEX media_cos_objects_pending_cleanup ON media_cos_objects(cleanup_attempted_at ASC NULLS FIRST,created_at,id)
  WHERE deleted_at IS NULL;
CREATE INDEX media_cos_objects_by_org ON media_cos_objects(org_id,created_at,id);

ALTER TABLE media_files ADD COLUMN cos_object_id uuid;
ALTER TABLE media_files ADD CONSTRAINT media_files_cos_identity
  CHECK (cos_object_id IS NULL OR cos_object_id=id);
ALTER TABLE media_files ADD CONSTRAINT media_files_cos_object_fk
  FOREIGN KEY (org_id,cos_object_id) REFERENCES media_cos_objects(org_id,id);

-- The original payload CHECK is unnamed. Match its payload attribute and structure, never an
-- assumed auto-generated name or all CHECKs, and stop if schema drift makes it ambiguous.
DO $$
DECLARE payload_attribute smallint; constraint_name text; matching integer;
BEGIN
  SELECT attnum INTO STRICT payload_attribute FROM pg_attribute
    WHERE attrelid='media_files'::regclass AND attname='payload' AND NOT attisdropped;
  SELECT count(*),min(conname::text) INTO matching,constraint_name FROM pg_constraint
    WHERE conrelid='media_files'::regclass AND contype='c'
      AND payload_attribute=ANY(conkey)
      AND pg_get_constraintdef(oid) LIKE '%octet_length(payload)%';
  IF matching<>1 THEN
    RAISE EXCEPTION 'Unexpected media payload constraint; COS migration stopped';
  END IF;
  EXECUTE format('ALTER TABLE media_files DROP CONSTRAINT %I',constraint_name);
END;
$$;
ALTER TABLE media_files ADD CONSTRAINT media_files_content_storage CHECK (
  (purged_at IS NULL AND purged_by IS NULL AND (
    (cos_object_id IS NULL AND payload IS NOT NULL AND octet_length(payload)=byte_length
      AND encode(sha256(payload),'hex')=sha256) OR
    (cos_object_id IS NOT NULL AND payload IS NULL)
  )) OR
  (purged_at IS NOT NULL AND purged_by IS NOT NULL AND revoked_at IS NOT NULL
    AND payload IS NULL AND purged_at>=revoked_at)
);

-- The row lock serializes final linking with cleanup. Deletion timestamps are receipts, not
-- queue requests: the worker sets them only after COS confirms deletion. Failed attempts
-- advance a durable cursor so old failures cannot occupy every cleanup batch. A fresh orphan
-- remains protected for a day while a request may still acquire its registration lock.
CREATE FUNCTION c50_cos_object_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'COS object receipts cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.cleanup_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'COS objects start staged' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['deleted_at','cleanup_attempted_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['deleted_at','cleanup_attempted_at']) OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COS object identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    IF NEW.cleanup_attempted_at IS DISTINCT FROM OLD.cleanup_attempted_at THEN
      RAISE EXCEPTION 'Successful COS deletion preserves the last failed attempt' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.cleanup_attempted_at IS NULL OR NEW.cleanup_attempted_at>clock_timestamp() OR
    (OLD.cleanup_attempted_at IS NOT NULL AND NEW.cleanup_attempted_at<=OLD.cleanup_attempted_at) THEN
    RAISE EXCEPTION 'COS cleanup attempt timestamps must advance and cannot be future dated' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM media_files WHERE org_id=OLD.org_id AND cos_object_id=OLD.id
      AND purged_at IS NULL) THEN
    RAISE EXCEPTION 'Active COS files cannot be cleaned up' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM media_files WHERE org_id=OLD.org_id AND cos_object_id=OLD.id)
    AND OLD.created_at>clock_timestamp()-interval '24 hours' THEN
    RAISE EXCEPTION 'Staged COS objects remain within their cleanup grace period' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_cos_objects_guard BEFORE INSERT OR UPDATE OR DELETE ON media_cos_objects
  FOR EACH ROW EXECUTE FUNCTION c50_cos_object_guard();

-- Both DB files and COS files consume quota until explicit purge. Retained participant
-- ciphertext and open upload reservations continue to share that same organization limit.
CREATE OR REPLACE FUNCTION c05_media_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'File metadata cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.revoked_at IS NOT NULL OR NEW.purged_at IS NOT NULL THEN RAISE EXCEPTION 'Files must start active' USING ERRCODE='23514'; END IF;
    PERFORM id FROM organizations WHERE id=NEW.org_id AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND OR COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=NEW.org_id AND purged_at IS NULL),0)
      +COALESCE((SELECT sum(byte_length) FROM media_upload_sessions WHERE org_id=NEW.org_id AND status='OPEN' AND expires_at>now()),0)
      +COALESCE((SELECT sum(payload_byte_length) FROM participant_material_revisions WHERE org_id=NEW.org_id AND payload_ciphertext IS NOT NULL),0)
      +NEW.byte_length>134217728 THEN
      RAISE EXCEPTION 'Organization storage quota exceeded' USING ERRCODE='23514';
    END IF;
    IF NEW.cos_object_id IS NOT NULL THEN
      PERFORM id FROM media_cos_objects WHERE org_id=NEW.org_id AND id=NEW.cos_object_id
        AND deleted_at IS NULL FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'COS file requires its active organization object receipt' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR
    (to_jsonb(NEW)-ARRAY['version','payload','revoked_at','revoked_by','purged_at','purged_by']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['version','payload','revoked_at','revoked_by','purged_at','purged_by']) OR OLD.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'File content and identity are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.revoked_at IS NULL THEN
    IF NEW.revoked_at IS NULL OR NEW.purged_at IS NOT NULL OR NEW.payload IS DISTINCT FROM OLD.payload THEN RAISE EXCEPTION 'Files revoke before purge' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.purged_at IS NULL OR NEW.payload IS NOT NULL THEN RAISE EXCEPTION 'Only content purge is permitted' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c19_upload_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Upload sessions cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'OPEN' OR NEW.version<>1 THEN RAISE EXCEPTION 'Upload sessions start open' USING ERRCODE='23514'; END IF;
    PERFORM id FROM organizations WHERE id=NEW.org_id AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND OR COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=NEW.org_id AND purged_at IS NULL),0)
      +COALESCE((SELECT sum(byte_length) FROM media_upload_sessions WHERE org_id=NEW.org_id AND status='OPEN' AND expires_at>now()),0)
      +COALESCE((SELECT sum(payload_byte_length) FROM participant_material_revisions WHERE org_id=NEW.org_id AND payload_ciphertext IS NOT NULL),0)
      +NEW.byte_length>134217728 THEN
      RAISE EXCEPTION 'Organization storage quota exceeded' USING ERRCODE='23514';
    END IF;
    IF (SELECT count(*) FROM media_upload_sessions WHERE org_id=NEW.org_id AND status='OPEN' AND expires_at>now())>=8 OR
      (SELECT count(*) FROM media_upload_sessions WHERE org_id=NEW.org_id AND created_by=NEW.created_by AND status='OPEN' AND expires_at>now())>=2 THEN
      RAISE EXCEPTION 'Too many open upload sessions' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','closed_at','closed_by','file_id']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','closed_at','closed_by','file_id']) OR
    NEW.version<>OLD.version+1 OR OLD.status<>'OPEN' OR NEW.status='OPEN' OR
    (NEW.status IN ('COMPLETED','CANCELLED') AND OLD.expires_at<=now()) OR
    (NEW.status='EXPIRED' AND OLD.expires_at>now()) THEN
    RAISE EXCEPTION 'Upload sessions only close once from OPEN' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
