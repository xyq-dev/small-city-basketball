-- X05: independent pre-schedule recruitment, bounded imports, recipient-bound invitations,
-- and private, revalidated poster recipes. No pre-existing rule or private-material ACL changes.
CREATE TABLE recruitment_publications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  ruleset_id uuid NOT NULL,
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{43}$'),
  title text NOT NULL CHECK (title=btrim(title) AND char_length(title) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (description=btrim(description) AND char_length(description) BETWEEN 1 AND 2000),
  max_applications integer NOT NULL CHECK (max_applications BETWEEN 1 AND 256),
  closes_at timestamptz NOT NULL CHECK (isfinite(closes_at)),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text,
  UNIQUE (org_id,event_id,id),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY (org_id,event_id,ruleset_id) REFERENCES event_rulesets(org_id,event_id,id),
  CHECK (closes_at>created_at AND closes_at<=created_at+interval '180 days'),
  CHECK ((status='ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
CREATE UNIQUE INDEX recruitment_one_active ON recruitment_publications(org_id,event_id) WHERE status='ACTIVE';

CREATE TABLE recruitment_applications (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  applicant_id uuid NOT NULL REFERENCES users(id),
  team_id uuid,
  team_name text NOT NULL CHECK (team_name=btrim(team_name) AND char_length(team_name) BETWEEN 1 AND 80),
  note text CHECK (note IS NULL OR (note=btrim(note) AND char_length(note) BETWEEN 1 AND 500)),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  reviewed_by uuid REFERENCES users(id),
  review_reason text,
  decided_at timestamptz,
  entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (publication_id,applicant_id),
  UNIQUE (org_id,event_id,id),
  FOREIGN KEY (org_id,event_id,publication_id) REFERENCES recruitment_publications(org_id,event_id,id),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id),
  FOREIGN KEY (org_id,event_id,entry_id) REFERENCES entries(org_id,event_id,id),
  CHECK (reviewed_by IS NULL OR reviewed_by<>applicant_id),
  CHECK ((status='PENDING' AND reviewed_by IS NULL AND decided_at IS NULL AND entry_id IS NULL)
    OR (status='WITHDRAWN' AND reviewed_by IS NULL AND decided_at IS NOT NULL AND entry_id IS NULL)
    OR (status IN ('APPROVED','REJECTED') AND reviewed_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK ((status='APPROVED')=(entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX recruitment_team_once ON recruitment_applications(publication_id,team_id)
  WHERE team_id IS NOT NULL AND status IN ('PENDING','APPROVED');
CREATE INDEX recruitment_applicant_history ON recruitment_applications(applicant_id,created_at DESC,id DESC);

CREATE TABLE event_team_import_previews (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  event_version integer NOT NULL CHECK (event_version>0),
  preview_hash char(64) NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 32),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  UNIQUE (org_id,event_id,id),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);

CREATE TABLE event_invitations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES users(id),
  issued_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  decided_at timestamptz,
  entry_id uuid,
  UNIQUE (org_id,event_id,id),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id),
  FOREIGN KEY (org_id,event_id,entry_id) REFERENCES entries(org_id,event_id,id),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '7 days'),
  CHECK ((status='PENDING')=(decided_at IS NULL)),
  CHECK ((status='ACCEPTED')=(entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX event_invitation_pending_target ON event_invitations(org_id,event_id,team_id,target_user_id) WHERE status='PENDING';
CREATE INDEX event_invitation_recipient ON event_invitations(target_user_id,created_at DESC,id DESC);

CREATE TABLE recruitment_request_receipts (
  actor_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('PUBLISH','REVOKE','APPLY','REVIEW','IMPORT_PREVIEW','IMPORT_COMMIT','INVITE','INVITATION_DECIDE','POSTER_GENERATE','POSTER_REVOKE')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id,client_request_id),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id)
);

CREATE TABLE poster_exports (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  public_publication_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('ROSTER','MATCHUP','RESULT','HONOR')),
  input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source jsonb NOT NULL CHECK (jsonb_typeof(source)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text,
  UNIQUE (org_id,event_id,id),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY (org_id,event_id,public_publication_id) REFERENCES public_event_publications(org_id,event_id,id),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE FUNCTION x05_recruitment_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Recruitment history cannot be removed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('recruitment_request_receipts','event_team_import_previews') THEN
    RAISE EXCEPTION 'Recruitment receipts and previews are immutable' USING ERRCODE='23514';
  ELSIF TG_TABLE_NAME='recruitment_publications' THEN
    IF OLD.status<>'ACTIVE' OR NEW.status<>'REVOKED' OR NEW.version<>OLD.version+1
      OR (to_jsonb(OLD)-ARRAY['status','version','revoked_at','revoked_by','revoke_reason']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','version','revoked_at','revoked_by','revoke_reason']) THEN
      RAISE EXCEPTION 'Recruitment publication only revokes once' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='recruitment_applications' THEN
    IF OLD.status<>'PENDING' OR NEW.status='PENDING' OR NEW.version<>OLD.version+1
      OR (to_jsonb(OLD)-ARRAY['team_id','status','version','reviewed_by','review_reason','decided_at','entry_id']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['team_id','status','version','reviewed_by','review_reason','decided_at','entry_id'])
      OR (OLD.team_id IS NOT NULL AND NEW.team_id IS DISTINCT FROM OLD.team_id) THEN
      RAISE EXCEPTION 'Recruitment application decides once' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='event_invitations' THEN
    IF OLD.status<>'PENDING' OR NEW.status='PENDING' OR NEW.version<>OLD.version+1
      OR (to_jsonb(OLD)-ARRAY['status','version','decided_at','entry_id']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','version','decided_at','entry_id']) THEN
      RAISE EXCEPTION 'Event invitation decides once' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='poster_exports' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
      OR (to_jsonb(OLD)-ARRAY['revoked_at','revoked_by','revoke_reason']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['revoked_at','revoked_by','revoke_reason']) THEN
      RAISE EXCEPTION 'Poster export only revokes once' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['recruitment_publications','recruitment_applications','event_team_import_previews','event_invitations','recruitment_request_receipts','poster_exports'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION x05_recruitment_history_guard()',t||'_history_guard',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION x05_recruitment_history_guard()',t||'_no_truncate',t);
  END LOOP;
END $$;

CREATE FUNCTION x05_recruitment_parent_closed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='organizations' THEN
    UPDATE recruitment_publications SET status='REVOKED',version=version+1,revoked_at=clock_timestamp(),revoke_reason='机构停用，招募链接永久失效'
      WHERE org_id=NEW.id AND status='ACTIVE';
  ELSE
    UPDATE recruitment_publications SET status='REVOKED',version=version+1,revoked_at=clock_timestamp(),revoke_reason='报名阶段结束，招募链接永久失效'
      WHERE org_id=NEW.org_id AND event_id=NEW.id AND status='ACTIVE';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER organizations_recruitment_disabled AFTER UPDATE OF status ON organizations
  FOR EACH ROW WHEN (OLD.status='ACTIVE' AND NEW.status='DISABLED') EXECUTE FUNCTION x05_recruitment_parent_closed();
CREATE TRIGGER events_recruitment_closed AFTER UPDATE OF status ON events
  FOR EACH ROW WHEN (OLD.status='REGISTRATION_OPEN' AND NEW.status<>'REGISTRATION_OPEN') EXECUTE FUNCTION x05_recruitment_parent_closed();
