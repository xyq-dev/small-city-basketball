-- PUBLIC_ARCHIVE is independent from BOOKING and PRIVATE_SEASON. No names link identities.
CREATE TABLE public_archive_profiles (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('PLAYER','TEAM')),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid,
  team_id uuid,
  display_name text NOT NULL CHECK (display_name=btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','REVOKED')),
  public_key text UNIQUE CHECK (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id),
  CHECK ((kind='PLAYER' AND org_id IS NULL AND team_id IS NULL) OR (kind='TEAM' AND org_id IS NOT NULL AND team_id IS NOT NULL)),
  CHECK ((status='PUBLISHED')=(public_key IS NOT NULL))
);
CREATE UNIQUE INDEX public_archive_one_player ON public_archive_profiles(owner_user_id) WHERE kind='PLAYER';
CREATE UNIQUE INDEX public_archive_one_team ON public_archive_profiles(org_id,team_id) WHERE kind='TEAM';
CREATE TABLE public_archive_publications (
  public_key text PRIMARY KEY CHECK (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  profile_id uuid NOT NULL REFERENCES public_archive_profiles(id),
  purpose text NOT NULL DEFAULT 'PUBLIC_ARCHIVE' CHECK (purpose='PUBLIC_ARCHIVE'),
  consented_by uuid NOT NULL REFERENCES users(id),
  consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  revoked_at timestamptz,
  CHECK ((status='ACTIVE')=(revoked_at IS NULL))
);
CREATE UNIQUE INDEX public_archive_one_active_key ON public_archive_publications(profile_id) WHERE status='ACTIVE';
CREATE TABLE public_archive_sources (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public_archive_profiles(id),
  purpose text NOT NULL DEFAULT 'PUBLIC_ARCHIVE' CHECK (purpose='PUBLIC_ARCHIVE'),
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  member_id uuid,
  binding_id uuid REFERENCES team_member_bindings(id),
  target_user_id uuid REFERENCES users(id),
  nominated_by uuid NOT NULL REFERENCES users(id),
  publisher_reason text NOT NULL CHECK (publisher_reason=btrim(publisher_reason) AND char_length(publisher_reason) BETWEEN 4 AND 500),
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REVOKED')),
  consented_by uuid REFERENCES users(id),
  consented_at timestamptz,
  revoke_reason text,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id),
  FOREIGN KEY (org_id,team_id,member_id) REFERENCES team_members(org_id,team_id,id),
  CHECK ((member_id IS NULL AND binding_id IS NULL AND target_user_id IS NULL) OR (member_id IS NOT NULL AND binding_id IS NOT NULL AND target_user_id IS NOT NULL)),
  CHECK ((consented_at IS NULL)=(consented_by IS NULL)),
  CHECK (status<>'APPROVED' OR (consented_at IS NOT NULL AND (target_user_id IS NULL OR consented_by=target_user_id))),
  CHECK ((status='REVOKED')=(revoked_at IS NOT NULL)),
  CHECK (revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 4 AND 500)
);
CREATE UNIQUE INDEX public_archive_source_once ON public_archive_sources(profile_id,event_id) WHERE status<>'REVOKED';
CREATE INDEX public_archive_sources_by_profile ON public_archive_sources(profile_id,status,created_at,id);
CREATE TABLE public_archive_operations (
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  target_kind text NOT NULL CHECK (target_kind IN ('PROFILE','SOURCE')),
  target_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,command_id)
);
CREATE TRIGGER public_archive_operations_immutable BEFORE UPDATE OR DELETE ON public_archive_operations
  FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
CREATE FUNCTION x08_public_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive consent history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='public_archive_profiles' THEN
    IF ROW(NEW.id,NEW.kind,NEW.owner_user_id,NEW.org_id,NEW.team_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.kind,OLD.owner_user_id,OLD.org_id,OLD.team_id,OLD.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Archive identity is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='public_archive_publications' THEN
    IF ROW(NEW.public_key,NEW.profile_id,NEW.purpose,NEW.consented_by,NEW.consented_at) IS DISTINCT FROM ROW(OLD.public_key,OLD.profile_id,OLD.purpose,OLD.consented_by,OLD.consented_at) OR OLD.status<>'ACTIVE' OR NEW.status<>'REVOKED' THEN RAISE EXCEPTION 'A public key cannot be revived or reassigned' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='public_archive_sources' THEN
    IF ROW(NEW.id,NEW.profile_id,NEW.purpose,NEW.org_id,NEW.event_id,NEW.team_id,NEW.member_id,NEW.binding_id,NEW.target_user_id,NEW.nominated_by,NEW.publisher_reason,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.profile_id,OLD.purpose,OLD.org_id,OLD.event_id,OLD.team_id,OLD.member_id,OLD.binding_id,OLD.target_user_id,OLD.nominated_by,OLD.publisher_reason,OLD.created_at) OR NEW.version<>OLD.version+1 OR OLD.status='REVOKED' OR NOT ((OLD.status='PENDING' AND NEW.status IN ('APPROVED','REVOKED')) OR (OLD.status='APPROVED' AND NEW.status='REVOKED')) OR (OLD.consented_at IS NOT NULL AND ROW(NEW.consented_by,NEW.consented_at) IS DISTINCT FROM ROW(OLD.consented_by,OLD.consented_at)) THEN RAISE EXCEPTION 'Archive source identity or consent cannot be rewritten' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER public_archive_profiles_guard BEFORE UPDATE OR DELETE ON public_archive_profiles FOR EACH ROW EXECUTE FUNCTION x08_public_archive_guard();
CREATE TRIGGER public_archive_publications_guard BEFORE UPDATE OR DELETE ON public_archive_publications FOR EACH ROW EXECUTE FUNCTION x08_public_archive_guard();
CREATE TRIGGER public_archive_sources_guard BEFORE UPDATE OR DELETE ON public_archive_sources FOR EACH ROW EXECUTE FUNCTION x08_public_archive_guard();
