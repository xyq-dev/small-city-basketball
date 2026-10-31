-- X18: scoped governance, city operations, sponsorship and offline ledger publication.
-- No payment, platform wallet, fundraising or implicit access to private event/identity data.
CREATE TABLE governance_operations (
  actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE city_operation_grants (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_catalog_version text NOT NULL, region_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('SUPPLY_REVIEW','SUPPLY_SUSPEND','CASE_MANAGE','SPONSOR_REVIEW')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 4 AND 500),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
  revoked_at timestamptz, revoked_by uuid REFERENCES users(id), revoke_reason text,
  FOREIGN KEY(region_catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id),
  CHECK(expires_at>created_at),
  CHECK((status='ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND char_length(revoke_reason) BETWEEN 4 AND 500))
);
CREATE INDEX city_operation_grants_scope ON city_operation_grants(user_id,org_id,action) WHERE status='ACTIVE';
CREATE TABLE governance_cases (
  id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('SUPPORT','REPORT','APPEAL')),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
  region_catalog_version text, region_id uuid,
  source_kind text CHECK(source_kind IN ('PUBLIC_EVENT','PLAYER_BOOKING','LOCAL_BOOKING')),
  source_id text CHECK(char_length(source_id) BETWEEN 1 AND 100),
  parent_case_id uuid REFERENCES governance_cases(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ASSIGNED','RESOLVED','CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  assigned_to uuid REFERENCES users(id), assignment_grant_id uuid REFERENCES city_operation_grants(id),
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(region_catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id),
  CHECK((region_id IS NULL)=(region_catalog_version IS NULL)),
  CHECK((source_id IS NULL)=(source_kind IS NULL)),
  CHECK((kind='APPEAL')=(parent_case_id IS NOT NULL)),
  CHECK((assigned_to IS NULL)=(assigned_at IS NULL)),
  CHECK(assignment_grant_id IS NULL OR assigned_to IS NOT NULL),
  CHECK(assigned_to IS DISTINCT FROM requester_id)
);
CREATE INDEX governance_cases_requester ON governance_cases(requester_id,created_at DESC,id);
CREATE INDEX governance_cases_assignee ON governance_cases(assigned_to,status,created_at DESC,id);
CREATE TABLE governance_case_messages (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES governance_cases(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
  visibility text NOT NULL CHECK(visibility IN ('REQUESTER','INTERNAL')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE governance_case_attachments (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES governance_cases(id),
  uploaded_by uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL,
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 120),
  content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','application/pdf')),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 4194304),
  content bytea NOT NULL CHECK(octet_length(content)=byte_length),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  visibility text NOT NULL CHECK(visibility IN ('REQUESTER','INTERNAL')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(uploaded_by,command_id)
);
CREATE TABLE governance_reviews (
  id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
  public_key char(43) NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{43}$'),
  source_kind text NOT NULL CHECK(source_kind IN ('PLAYER_BOOKING','LOCAL_BOOKING')),
  source_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid NOT NULL REFERENCES users(id),
  score integer NOT NULL CHECK(score BETWEEN 1 AND 5),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','PUBLISHED','REJECTED','WITHDRAWN')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  reviewed_by uuid REFERENCES users(id), review_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_kind,source_id,author_id), CHECK(author_id<>target_user_id),
  CHECK(reviewed_by IS NULL OR (reviewed_by<>author_id AND reviewed_by<>target_user_id))
);
CREATE TABLE sponsorship_campaigns (
  id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), event_id uuid,
  region_catalog_version text NOT NULL, region_id uuid NOT NULL,
  brand text NOT NULL CHECK(char_length(brand) BETWEEN 1 AND 80),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
  starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at)),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','WITHDRAWN')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz, review_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(region_catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id),
  CHECK(starts_at<ends_at), CHECK(ends_at<=starts_at+interval '366 days'),
  CHECK(reviewed_by IS NULL OR reviewed_by<>created_by),
  CHECK(status NOT IN ('APPROVED','REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND char_length(review_reason) BETWEEN 4 AND 500))
);
CREATE TABLE sponsorship_publications (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES sponsorship_campaigns(id),
  public_key char(43) NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{43}$'),
  campaign_version integer NOT NULL CHECK(campaign_version>0),
  published_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz, revoked_by uuid REFERENCES users(id), revoke_reason text,
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND char_length(revoke_reason) BETWEEN 4 AND 500))
);
CREATE UNIQUE INDEX sponsorship_one_publication ON sponsorship_publications(campaign_id) WHERE revoked_at IS NULL;
CREATE TABLE sponsorship_impressions (
  publication_id uuid NOT NULL REFERENCES sponsorship_publications(id), command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(publication_id,command_id)
);
CREATE TABLE public_ledger_accounts (
  id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), team_id uuid,
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(org_id,team_id) REFERENCES teams(org_id,id)
);
CREATE TABLE public_ledger_entries (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public_ledger_accounts(id),
  occurred_on date NOT NULL CHECK(isfinite(occurred_on)),
  label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK(kind IN ('INCOME','EXPENSE','REVERSAL')),
  amount_fen integer NOT NULL CHECK(amount_fen<>0 AND amount_fen BETWEEN -100000000 AND 100000000),
  reverses_entry_id uuid REFERENCES public_ledger_entries(id),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id), review_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), reviewed_at timestamptz,
  CHECK((kind='INCOME' AND amount_fen>0 AND reverses_entry_id IS NULL)
    OR (kind='EXPENSE' AND amount_fen<0 AND reverses_entry_id IS NULL)
    OR (kind='REVERSAL' AND reverses_entry_id IS NOT NULL)),
  CHECK((status='PENDING_REVIEW' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status<>'PENDING_REVIEW' AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND char_length(review_reason) BETWEEN 4 AND 500))
);
CREATE INDEX public_ledger_entries_account ON public_ledger_entries(account_id,created_at,id);
CREATE UNIQUE INDEX public_ledger_one_reversal ON public_ledger_entries(reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL AND status IN ('PENDING_REVIEW','APPROVED');
CREATE TABLE public_ledger_publications (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public_ledger_accounts(id),
  public_key char(43) NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{43}$'),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  published_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz, revoked_by uuid REFERENCES users(id), revoke_reason text,
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND char_length(revoke_reason) BETWEEN 4 AND 500))
);
CREATE UNIQUE INDEX public_ledger_one_publication ON public_ledger_publications(account_id) WHERE revoked_at IS NULL;

CREATE FUNCTION x18_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Governance history is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER governance_operations_immutable BEFORE UPDATE OR DELETE ON governance_operations FOR EACH ROW EXECUTE FUNCTION x18_immutable();
CREATE TRIGGER governance_case_messages_immutable BEFORE UPDATE OR DELETE ON governance_case_messages FOR EACH ROW EXECUTE FUNCTION x18_immutable();
CREATE TRIGGER governance_case_attachments_immutable BEFORE UPDATE OR DELETE ON governance_case_attachments FOR EACH ROW EXECUTE FUNCTION x18_immutable();
CREATE TRIGGER sponsorship_impressions_immutable BEFORE UPDATE OR DELETE ON sponsorship_impressions FOR EACH ROW EXECUTE FUNCTION x18_immutable();

CREATE FUNCTION x18_versioned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Versioned governance update required' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='governance_cases' AND
    (to_jsonb(NEW)-ARRAY['status','version','assigned_to','assignment_grant_id','assigned_at','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','assigned_to','assignment_grant_id','assigned_at','updated_at']) THEN
    RAISE EXCEPTION 'Case identity and original report are immutable' USING ERRCODE='23514';
  ELSIF TG_TABLE_NAME='governance_reviews' THEN
    IF (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','review_reason','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','review_reason','updated_at']) OR
      NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('PUBLISHED','REJECTED','WITHDRAWN')) OR
        (OLD.status IN ('PUBLISHED','REJECTED') AND NEW.status='WITHDRAWN')) THEN
      RAISE EXCEPTION 'Review source and content are immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='sponsorship_campaigns' THEN
    IF NEW.org_id<>OLD.org_id OR NEW.created_by<>OLD.created_by OR OLD.status='WITHDRAWN' OR
      (OLD.status IN ('SUBMITTED','APPROVED') AND
        (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','reviewed_at','review_reason','updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','reviewed_at','review_reason','updated_at'])) THEN
      RAISE EXCEPTION 'Submitted sponsor terms are immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='public_ledger_accounts' THEN
    IF OLD.status='CLOSED' OR
      (to_jsonb(NEW)-ARRAY['status','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version']) THEN
      RAISE EXCEPTION 'Ledger scope and title are immutable; close is final' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER governance_cases_versioned BEFORE UPDATE OR DELETE ON governance_cases FOR EACH ROW EXECUTE FUNCTION x18_versioned();
CREATE TRIGGER governance_reviews_versioned BEFORE UPDATE OR DELETE ON governance_reviews FOR EACH ROW EXECUTE FUNCTION x18_versioned();
CREATE TRIGGER sponsorship_campaigns_versioned BEFORE UPDATE OR DELETE ON sponsorship_campaigns FOR EACH ROW EXECUTE FUNCTION x18_versioned();
CREATE TRIGGER public_ledger_accounts_versioned BEFORE UPDATE OR DELETE ON public_ledger_accounts FOR EACH ROW EXECUTE FUNCTION x18_versioned();

CREATE FUNCTION x18_city_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'ACTIVE' OR NEW.status<>'REVOKED' OR NEW.version<>OLD.version+1
    OR (to_jsonb(NEW)-ARRAY['status','version','revoked_at','revoked_by','revoke_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','revoked_at','revoked_by','revoke_reason']) THEN
    RAISE EXCEPTION 'City grant only revokes once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER city_operation_grants_guard BEFORE UPDATE OR DELETE ON city_operation_grants FOR EACH ROW EXECUTE FUNCTION x18_city_grant_guard();

CREATE FUNCTION x18_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
    OR (to_jsonb(NEW)-ARRAY['revoked_at','revoked_by','revoke_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','revoked_by','revoke_reason']) THEN
    RAISE EXCEPTION 'Publication only revokes once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sponsorship_publications_guard BEFORE UPDATE OR DELETE ON sponsorship_publications FOR EACH ROW EXECUTE FUNCTION x18_publication_guard();
CREATE TRIGGER public_ledger_publications_guard BEFORE UPDATE OR DELETE ON public_ledger_publications FOR EACH ROW EXECUTE FUNCTION x18_publication_guard();

CREATE FUNCTION x18_ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original public_ledger_entries%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Ledger history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.kind='REVERSAL' THEN
    SELECT * INTO original FROM public_ledger_entries WHERE id=NEW.reverses_entry_id FOR SHARE;
    IF original.id IS NULL OR original.account_id<>NEW.account_id OR original.status<>'APPROVED'
      OR original.kind='REVERSAL' OR NEW.amount_fen<>-original.amount_fen THEN
      RAISE EXCEPTION 'Reversal must exactly negate one approved entry in this account' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version<>OLD.version+1
      OR (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','review_reason','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','review_reason','reviewed_at']) THEN
      RAISE EXCEPTION 'Ledger terms are immutable and review occurs once' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_ledger_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON public_ledger_entries FOR EACH ROW EXECUTE FUNCTION x18_ledger_entry_guard();
