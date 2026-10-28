-- C19: match media request idempotency and bounded chunked upload sessions.
-- Receipts and upload sessions are permanent request identities: they are never deleted and an
-- old client request ID never executes again. "Cleanup" only nulls chunk payloads and records a
-- terminal session state. Quota counts active file payloads plus the declared bytes of OPEN,
-- unexpired upload sessions (reservations), so chunks cannot bypass the organization limit.

CREATE TABLE media_upload_sessions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('MATCH_IMAGE', 'MATCH_VIDEO')),
  file_name text NOT NULL CHECK (
    char_length(file_name) BETWEEN 1 AND 120 AND file_name !~ '[[:cntrl:]/\\]'
  ),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'video/mp4')),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  chunk_size integer NOT NULL CHECK (chunk_size = 524288),
  chunk_count integer NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  file_id uuid,
  UNIQUE (org_id, id),
  UNIQUE (org_id, created_by, match_id, client_request_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  -- Deferred: completion closes the session (releasing its reservation) before inserting the
  -- assembled file in the same transaction, so the file quota never counts it twice.
  FOREIGN KEY (org_id, event_id, match_id, file_id)
    REFERENCES media_files(org_id, event_id, match_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (chunk_count = (byte_length + chunk_size - 1) / chunk_size),
  CHECK (
    (purpose = 'MATCH_IMAGE' AND content_type IN ('image/png', 'image/jpeg')) OR
    (purpose = 'MATCH_VIDEO' AND content_type = 'video/mp4')
  ),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CHECK (
    (status = 'OPEN' AND closed_at IS NULL AND closed_by IS NULL AND file_id IS NULL) OR
    (status = 'COMPLETED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND file_id IS NOT NULL) OR
    (status = 'CANCELLED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND file_id IS NULL) OR
    (status = 'EXPIRED' AND closed_at IS NOT NULL AND file_id IS NULL)
  )
);
CREATE INDEX media_upload_sessions_open ON media_upload_sessions(org_id, expires_at, id)
  WHERE status = 'OPEN';

CREATE TABLE media_upload_chunks (
  org_id uuid NOT NULL,
  session_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index BETWEEN 0 AND 15),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 524288),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  payload bytea,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  PRIMARY KEY (org_id, session_id, chunk_index),
  FOREIGN KEY (org_id, session_id) REFERENCES media_upload_sessions(org_id, id),
  CHECK (
    (released_at IS NULL AND payload IS NOT NULL AND octet_length(payload) = byte_length
      AND encode(sha256(payload), 'hex') = sha256) OR
    (released_at IS NOT NULL AND payload IS NULL)
  )
);

CREATE TABLE media_request_receipts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL CHECK (operation IN ('MATCH_FILE_UPLOAD', 'MATCH_MEDIA_CREATE')),
  client_request_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_file_id uuid,
  result_media_id uuid,
  upload_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, actor_user_id, match_id, operation, client_request_id),
  UNIQUE (org_id, upload_session_id),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, match_id, result_file_id)
    REFERENCES media_files(org_id, event_id, match_id, id),
  FOREIGN KEY (org_id, match_id, result_media_id) REFERENCES match_media(org_id, match_id, id),
  FOREIGN KEY (org_id, upload_session_id) REFERENCES media_upload_sessions(org_id, id),
  CHECK (
    (operation = 'MATCH_MEDIA_CREATE' AND result_media_id IS NOT NULL
      AND result_file_id IS NULL AND upload_session_id IS NULL) OR
    (operation = 'MATCH_FILE_UPLOAD' AND result_media_id IS NULL
      AND (result_file_id IS NOT NULL OR upload_session_id IS NOT NULL))
  )
);

-- Quota: active file payloads plus OPEN, unexpired upload-session reservations. Everything else
-- is unchanged from 015 (which stays untouched); this replaces the function body only.
CREATE OR REPLACE FUNCTION c05_media_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'File metadata cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.revoked_at IS NOT NULL OR NEW.purged_at IS NOT NULL THEN RAISE EXCEPTION 'Files must start active' USING ERRCODE='23514'; END IF;
    -- All storage writers serialize against the same organization, including team-grant users.
    PERFORM id FROM organizations WHERE id=NEW.org_id AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND OR COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=NEW.org_id AND payload IS NOT NULL),0)
      +COALESCE((SELECT sum(byte_length) FROM media_upload_sessions WHERE org_id=NEW.org_id AND status='OPEN' AND expires_at>now()),0)
      +NEW.byte_length>134217728 THEN
      RAISE EXCEPTION 'Organization storage quota exceeded' USING ERRCODE='23514';
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

-- Expiry decisions (close, chunk accept) use the transaction's own time, now(), exactly like the
-- service's checks, so one transaction never sees a session both open and lapsed.
CREATE FUNCTION c19_upload_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Upload sessions cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'OPEN' OR NEW.version<>1 THEN RAISE EXCEPTION 'Upload sessions start open' USING ERRCODE='23514'; END IF;
    -- Same serialization point as file inserts: the organization row.
    PERFORM id FROM organizations WHERE id=NEW.org_id AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND OR COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=NEW.org_id AND payload IS NOT NULL),0)
      +COALESCE((SELECT sum(byte_length) FROM media_upload_sessions WHERE org_id=NEW.org_id AND status='OPEN' AND expires_at>now()),0)
      +NEW.byte_length>134217728 THEN
      RAISE EXCEPTION 'Organization storage quota exceeded' USING ERRCODE='23514';
    END IF;
    IF (SELECT count(*) FROM media_upload_sessions WHERE org_id=NEW.org_id AND status='OPEN' AND expires_at>now())>=8 OR
      (SELECT count(*) FROM media_upload_sessions WHERE org_id=NEW.org_id AND created_by=NEW.created_by AND status='OPEN' AND expires_at>now())>=2 THEN
      RAISE EXCEPTION 'Too many open upload sessions' USING ERRCODE='23514';
    END IF;
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
CREATE TRIGGER media_upload_sessions_guard BEFORE INSERT OR UPDATE OR DELETE ON media_upload_sessions
  FOR EACH ROW EXECUTE FUNCTION c19_upload_session_guard();

CREATE FUNCTION c19_upload_chunk_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s media_upload_sessions%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Upload chunks cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO s FROM media_upload_sessions WHERE org_id=NEW.org_id AND id=NEW.session_id FOR SHARE;
    IF NOT FOUND OR s.status<>'OPEN' OR s.expires_at<=now() OR NEW.released_at IS NOT NULL OR
      NEW.chunk_index>=s.chunk_count OR
      NEW.byte_length<>(CASE WHEN NEW.chunk_index<s.chunk_count-1 THEN s.chunk_size
        ELSE s.byte_length-s.chunk_size*(s.chunk_count-1) END) THEN
      RAISE EXCEPTION 'Chunk does not fit an open upload session' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['payload','released_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['payload','released_at']) OR
    OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NEW.payload IS NOT NULL THEN
    RAISE EXCEPTION 'Chunks are immutable until their payload is released' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_upload_chunks_guard BEFORE INSERT OR UPDATE OR DELETE ON media_upload_chunks
  FOR EACH ROW EXECUTE FUNCTION c19_upload_chunk_guard();

CREATE FUNCTION c19_media_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Request receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  -- The only change: a session receipt records the one file its completed session created.
  IF (to_jsonb(NEW)-'result_file_id') IS DISTINCT FROM (to_jsonb(OLD)-'result_file_id') OR
    OLD.result_file_id IS NOT NULL OR NEW.result_file_id IS NULL OR OLD.upload_session_id IS NULL OR
    NOT EXISTS (SELECT 1 FROM media_upload_sessions WHERE org_id=OLD.org_id AND id=OLD.upload_session_id
      AND status='COMPLETED' AND file_id=NEW.result_file_id) THEN
    RAISE EXCEPTION 'Request receipts are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_request_receipts_guard BEFORE UPDATE OR DELETE ON media_request_receipts
  FOR EACH ROW EXECUTE FUNCTION c19_media_receipt_guard();
