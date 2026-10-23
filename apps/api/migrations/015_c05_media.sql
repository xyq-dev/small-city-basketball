-- Bounded binary data shares the original PostgreSQL transaction and restore boundary.
CREATE TABLE media_files (
  id uuid PRIMARY KEY, org_id uuid NOT NULL, event_id uuid NOT NULL,
  entry_id uuid, match_id uuid, roster_revision_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('PRIVATE_INSURANCE','REGISTRATION_DOC','MATCH_IMAGE','MATCH_VIDEO')),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120 AND file_name !~ '[[:cntrl:]/\\]'),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/png','image/jpeg','video/mp4')),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'), payload bytea,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz, revoked_by uuid REFERENCES users(id),
  purged_at timestamptz, purged_by uuid REFERENCES users(id),
  UNIQUE(org_id,id), UNIQUE(org_id,event_id,match_id,id),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,event_id,entry_id) REFERENCES entries(org_id,event_id,id),
  FOREIGN KEY(org_id,entry_id,roster_revision_id) REFERENCES entry_roster_revisions(org_id,entry_id,id),
  FOREIGN KEY(org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id),
  CHECK ((purpose IN ('PRIVATE_INSURANCE','REGISTRATION_DOC') AND entry_id IS NOT NULL AND match_id IS NULL AND content_type <> 'video/mp4') OR
    (purpose='MATCH_IMAGE' AND entry_id IS NULL AND roster_revision_id IS NULL AND match_id IS NOT NULL AND content_type IN ('image/png','image/jpeg')) OR
    (purpose='MATCH_VIDEO' AND entry_id IS NULL AND roster_revision_id IS NULL AND match_id IS NOT NULL AND content_type='video/mp4')),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoked_at >= created_at)),
  CHECK ((purged_at IS NULL AND purged_by IS NULL AND payload IS NOT NULL AND octet_length(payload)=byte_length AND encode(sha256(payload),'hex')=sha256) OR
    (purged_at IS NOT NULL AND purged_by IS NOT NULL AND revoked_at IS NOT NULL AND payload IS NULL AND purged_at>=revoked_at))
);
CREATE INDEX media_files_by_entry ON media_files(org_id,entry_id,created_at,id);
CREATE INDEX media_files_by_match ON media_files(org_id,match_id,created_at,id);
CREATE FUNCTION c05_media_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'File metadata cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.revoked_at IS NOT NULL OR NEW.purged_at IS NOT NULL THEN RAISE EXCEPTION 'Files must start active' USING ERRCODE='23514'; END IF;
    -- All storage writers serialize against the same organization, including team-grant users.
    PERFORM id FROM organizations WHERE id=NEW.org_id AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND OR COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=NEW.org_id AND payload IS NOT NULL),0)+NEW.byte_length>134217728 THEN
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
CREATE TRIGGER media_files_guard BEFORE INSERT OR UPDATE OR DELETE ON media_files FOR EACH ROW EXECUTE FUNCTION c05_media_file_guard();

CREATE TABLE match_media (
  id uuid PRIMARY KEY, org_id uuid NOT NULL, event_id uuid NOT NULL, match_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('IMAGE','VIDEO','EXTERNAL_LINK')), file_id uuid, external_url text,
  title text NOT NULL CHECK(title=btrim(title) AND char_length(title) BETWEEN 1 AND 120),
  rights_declaration text NOT NULL CHECK(rights_declaration=btrim(rights_declaration) AND char_length(rights_declaration) BETWEEN 4 AND 500),
  public_media_id text NOT NULL UNIQUE CHECK(public_media_id ~ '^[A-Za-z0-9_-]{43}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(org_id,match_id,id),
  FOREIGN KEY(org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id),
  FOREIGN KEY(org_id,event_id,match_id,file_id) REFERENCES media_files(org_id,event_id,match_id,id),
  CHECK ((kind='EXTERNAL_LINK' AND file_id IS NULL AND external_url IS NOT NULL AND char_length(external_url)<=2048 AND external_url LIKE 'https://%') OR
    (kind IN ('IMAGE','VIDEO') AND file_id IS NOT NULL AND external_url IS NULL))
);
CREATE INDEX match_media_by_match ON match_media(org_id,match_id,created_at,id);
CREATE FUNCTION c05_match_media_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f media_files%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Media history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Media starts private' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version']) OR NEW.version<>OLD.version+1 OR OLD.status='REVOKED' OR
      (NEW.status=OLD.status AND OLD.status<>'DRAFT') OR (NEW.status NOT IN ('PUBLISHED','REVOKED') AND NEW.status<>OLD.status) THEN
      RAISE EXCEPTION 'Media identity is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.file_id IS NOT NULL AND NEW.status<>'REVOKED' THEN
    SELECT * INTO f FROM media_files WHERE org_id=NEW.org_id AND event_id=NEW.event_id AND match_id=NEW.match_id AND id=NEW.file_id FOR SHARE;
    IF NOT FOUND OR f.revoked_at IS NOT NULL OR f.purged_at IS NOT NULL OR
      (NEW.kind='IMAGE' AND f.purpose<>'MATCH_IMAGE') OR (NEW.kind='VIDEO' AND f.purpose<>'MATCH_VIDEO') THEN
      RAISE EXCEPTION 'Published media needs matching active media-purpose file' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_media_guard BEFORE INSERT OR UPDATE OR DELETE ON match_media FOR EACH ROW EXECUTE FUNCTION c05_match_media_guard();

CREATE TABLE media_markers (
  id uuid PRIMARY KEY,org_id uuid NOT NULL,event_id uuid NOT NULL,match_id uuid NOT NULL,media_id uuid NOT NULL,
  public_marker_id text NOT NULL UNIQUE CHECK(public_marker_id ~ '^[A-Za-z0-9_-]{43}$'),
  source_event_id uuid NOT NULL,source_seq integer NOT NULL CHECK(source_seq>0),confirmation_id uuid NOT NULL,
  source_match_version integer NOT NULL CHECK(source_match_version>0),
  label text NOT NULL CHECK(label=btrim(label) AND char_length(label) BETWEEN 1 AND 120),
  start_ms integer NOT NULL CHECK(start_ms BETWEEN 0 AND 86400000),end_ms integer NOT NULL CHECK(end_ms>start_ms AND end_ms<=86400000),
  created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(org_id,match_id,media_id) REFERENCES match_media(org_id,match_id,id),
  FOREIGN KEY(org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id),
  FOREIGN KEY(org_id,match_id,source_event_id) REFERENCES scoring_events(org_id,match_id,id),
  FOREIGN KEY(org_id,match_id,confirmation_id) REFERENCES result_confirmations(org_id,match_id,id)
);
CREATE INDEX media_markers_by_media ON media_markers(org_id,media_id,start_ms,id);
CREATE TRIGGER media_markers_immutable BEFORE UPDATE OR DELETE ON media_markers FOR EACH ROW EXECUTE FUNCTION p04_reject_plan_mutation();
CREATE FUNCTION c05_marker_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mm match_media%ROWTYPE; s scoring_states%ROWTYPE; cf result_confirmations%ROWTYPE; se scoring_events%ROWTYPE;
BEGIN
  SELECT * INTO mm FROM match_media WHERE org_id=NEW.org_id AND match_id=NEW.match_id AND id=NEW.media_id;
  SELECT * INTO s FROM scoring_states WHERE org_id=NEW.org_id AND match_id=NEW.match_id;
  SELECT * INTO cf FROM result_confirmations WHERE org_id=NEW.org_id AND match_id=NEW.match_id AND id=NEW.confirmation_id;
  SELECT * INTO se FROM scoring_events WHERE org_id=NEW.org_id AND match_id=NEW.match_id AND id=NEW.source_event_id;
  IF mm.status IS DISTINCT FROM 'DRAFT' OR mm.kind IS DISTINCT FROM 'VIDEO' OR s.latest_confirmation_id IS DISTINCT FROM NEW.confirmation_id OR s.requires_reconfirmation OR
     cf.source_match_version IS DISTINCT FROM NEW.source_match_version OR se.seq IS DISTINCT FROM NEW.source_seq OR se.seq>cf.last_event_seq OR
     NOT EXISTS(SELECT 1 FROM published_matches WHERE org_id=NEW.org_id AND id=NEW.match_id AND status='FINAL') OR
     EXISTS(SELECT 1 FROM scoring_events WHERE org_id=NEW.org_id AND match_id=NEW.match_id AND target_event_id=NEW.source_event_id AND type='STAT_VOIDED') THEN
    RAISE EXCEPTION 'A marker needs a current independently confirmed original event' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_markers_guard BEFORE INSERT ON media_markers FOR EACH ROW EXECUTE FUNCTION c05_marker_guard();
