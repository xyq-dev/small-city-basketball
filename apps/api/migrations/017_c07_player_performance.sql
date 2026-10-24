-- C07 links a precise private roster identity to an existing booking profile.
-- Publication requires a nomination AND the profile owner's explicit consent.
-- No scoring tables or copies of personal statistics are created here.
CREATE TABLE booking_performance_links (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES booking_profiles(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  member_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  nominated_by uuid NOT NULL REFERENCES users(id),
  publisher_reason text NOT NULL CHECK (publisher_reason=btrim(publisher_reason) AND char_length(publisher_reason) BETWEEN 1 AND 500),
  consented_by uuid REFERENCES users(id),
  consented_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR (revoke_reason=btrim(revoke_reason) AND char_length(revoke_reason) BETWEEN 1 AND 500)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id),
  FOREIGN KEY (org_id,team_id,member_id) REFERENCES team_members(org_id,team_id,id),
  CHECK ((consented_by IS NULL)=(consented_at IS NULL)),
  CHECK ((revoked_by IS NULL)=(revoked_at IS NULL)),
  CHECK ((revoked_by IS NULL)=(revoke_reason IS NULL)),
  CHECK (status<>'APPROVED' OR consented_by IS NOT NULL),
  CHECK (status='REVOKED' OR revoked_by IS NULL),
  CHECK (status<>'REVOKED' OR revoked_by IS NOT NULL),
  CHECK (status<>'PENDING' OR consented_by IS NULL)
);

CREATE UNIQUE INDEX booking_performance_profile_source_active
  ON booking_performance_links(profile_id,org_id,event_id)
  WHERE status IN ('PENDING','APPROVED');
CREATE UNIQUE INDEX booking_performance_member_source_active
  ON booking_performance_links(org_id,event_id,team_id,member_id)
  WHERE status IN ('PENDING','APPROVED');
CREATE INDEX booking_performance_links_by_profile
  ON booking_performance_links(profile_id,created_at DESC,id DESC);
CREATE INDEX booking_performance_links_by_event
  ON booking_performance_links(org_id,event_id,created_at DESC,id DESC);

CREATE TABLE booking_performance_operations (
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id,command_id)
);

CREATE FUNCTION c07_performance_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_user_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Performance consent history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.consented_by IS NOT NULL OR NEW.consented_at IS NOT NULL OR
      NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A performance nomination must start pending consent' USING ERRCODE='23514';
    END IF;
  ELSE
    IF OLD.status='REVOKED' OR NEW.version<>OLD.version+1 OR
      (to_jsonb(NEW)-ARRAY['status','version','consented_by','consented_at','revoked_by','revoked_at','revoke_reason','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','consented_by','consented_at','revoked_by','revoked_at','revoke_reason','updated_at']) THEN
      RAISE EXCEPTION 'Performance source identity and nomination are immutable' USING ERRCODE='23514';
    END IF;
    IF NOT ((OLD.status='PENDING' AND NEW.status='APPROVED') OR
      (OLD.status IN ('PENDING','APPROVED') AND NEW.status='REVOKED')) THEN
      RAISE EXCEPTION 'Invalid performance consent transition' USING ERRCODE='23514';
    END IF;
    IF NEW.status='REVOKED' AND (NEW.consented_by IS DISTINCT FROM OLD.consented_by OR NEW.consented_at IS DISTINCT FROM OLD.consented_at) THEN
      RAISE EXCEPTION 'Revocation must retain original consent evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.consented_by IS NOT NULL THEN
    SELECT user_id INTO owner_user_id FROM booking_profiles WHERE id=NEW.profile_id;
    IF NEW.consented_by IS DISTINCT FROM owner_user_id THEN
      RAISE EXCEPTION 'Only the nominated profile owner may consent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_performance_links_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_performance_links
  FOR EACH ROW EXECUTE FUNCTION c07_performance_link_guard();

CREATE FUNCTION c07_performance_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.result IS NOT NULL OR NEW.result IS NULL OR
    (to_jsonb(NEW)-'result') IS DISTINCT FROM (to_jsonb(OLD)-'result') THEN
    RAISE EXCEPTION 'Performance operation receipt is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_performance_operations_guard BEFORE UPDATE OR DELETE ON booking_performance_operations
  FOR EACH ROW EXECUTE FUNCTION c07_performance_operation_guard();
