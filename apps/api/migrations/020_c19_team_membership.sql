-- C19: approved team requests, join codes, player account bindings and historical member claims.
-- Organization approval is the only way a non-administrator obtains a new team: an OWNER/ADMIN
-- issues a share link, a signed-in applicant submits a request through it, and another current
-- OWNER/ADMIN approves it. Approval creates exactly one team and one TEAM_MANAGER grant.
-- Player bindings are a separate relation from team_access_grants (management rights): a player
-- binding never grants management and never appears in a session's team contexts.
-- Every secret (share token, join code) is stored as a SHA-256 hash only. History is kept: rows
-- move to terminal states and are never deleted by the runtime role.

CREATE TABLE team_request_links (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 4 AND 500),
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 200),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text CHECK (
    revoke_reason IS NULL OR (revoke_reason = btrim(revoke_reason) AND char_length(revoke_reason) BETWEEN 4 AND 500)
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '168 hours'),
  CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND revoked_at >= created_at)
  )
);

CREATE INDEX team_request_links_by_org ON team_request_links(org_id, created_at DESC, id DESC);

CREATE TABLE team_requests (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  link_id uuid NOT NULL,
  requester_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  team_name text NOT NULL CHECK (team_name = btrim(team_name) AND char_length(team_name) BETWEEN 1 AND 80),
  note text CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 500)),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reviewer_id uuid REFERENCES users(id),
  review_reason text CHECK (
    review_reason IS NULL OR (review_reason = btrim(review_reason) AND char_length(review_reason) BETWEEN 4 AND 500)
  ),
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  team_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Submission is deduplicated per account: a lost response never creates a second request.
  UNIQUE (requester_id, client_request_id),
  UNIQUE (org_id, id),
  -- One approved request creates at most one team, and a team comes from at most one request.
  UNIQUE (team_id),
  FOREIGN KEY (org_id, link_id) REFERENCES team_request_links(org_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id),
  CHECK (reviewer_id IS NULL OR reviewer_id <> requester_id),
  CHECK ((status = 'APPROVED') = (team_id IS NOT NULL)),
  CHECK (
    (status IN ('APPROVED', 'REJECTED')) =
    (reviewer_id IS NOT NULL AND review_reason IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);

CREATE INDEX team_requests_by_org ON team_requests(org_id, status, created_at DESC, id DESC);
CREATE INDEX team_requests_by_requester ON team_requests(requester_id, created_at DESC, id DESC);

CREATE TABLE team_join_codes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid NOT NULL REFERENCES users(id),
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 30),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, team_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '168 hours'),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX team_join_codes_by_team ON team_join_codes(org_id, team_id, created_at DESC, id DESC);

-- A leader-issued, single-use claim of one exact historical member by one exact account.
-- Expiry is evaluated at read time; a PENDING row past expires_at is treated as EXPIRED.
CREATE TABLE team_member_claims (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  member_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES users(id),
  issued_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, team_id, id),
  FOREIGN KEY (org_id, team_id, member_id) REFERENCES team_members(org_id, team_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '168 hours'),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK (decided_at IS NULL OR decided_at >= created_at)
);

CREATE UNIQUE INDEX team_member_claims_one_pending ON team_member_claims(member_id) WHERE status = 'PENDING';
CREATE INDEX team_member_claims_by_target ON team_member_claims(target_user_id, created_at DESC, id DESC);
CREATE INDEX team_member_claims_by_team ON team_member_claims(org_id, team_id, created_at DESC, id DESC);

-- Player account binding: one account <-> one long-term member of one team.
-- ACTIVE -> ENDED only (LEFT, REMOVED, MEMBER_REMOVED); never revived, never transferred.
CREATE TABLE team_member_bindings (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  member_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  source text NOT NULL CHECK (source IN ('JOIN_CODE', 'CLAIM')),
  join_code_id uuid,
  claim_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  ended_reason text CHECK (ended_reason IN ('LEFT', 'REMOVED', 'MEMBER_REMOVED')),
  ended_by uuid REFERENCES users(id),
  end_note text CHECK (end_note IS NULL OR (end_note = btrim(end_note) AND char_length(end_note) BETWEEN 4 AND 500)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  UNIQUE (org_id, team_id, id),
  FOREIGN KEY (org_id, team_id, member_id) REFERENCES team_members(org_id, team_id, id),
  FOREIGN KEY (org_id, team_id, join_code_id) REFERENCES team_join_codes(org_id, team_id, id),
  FOREIGN KEY (org_id, team_id, claim_id) REFERENCES team_member_claims(org_id, team_id, id),
  CHECK ((source = 'JOIN_CODE') = (join_code_id IS NOT NULL)),
  CHECK ((source = 'CLAIM') = (claim_id IS NOT NULL)),
  CHECK (
    (status = 'ACTIVE' AND ended_at IS NULL AND ended_reason IS NULL AND ended_by IS NULL AND end_note IS NULL)
    OR (status = 'ENDED' AND ended_at IS NOT NULL AND ended_reason IS NOT NULL AND ended_at >= created_at)
  )
);

-- At most one active binding per account per team, and per member.
CREATE UNIQUE INDEX team_member_bindings_one_per_account
  ON team_member_bindings(org_id, team_id, user_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX team_member_bindings_one_per_member
  ON team_member_bindings(member_id) WHERE status = 'ACTIVE';
CREATE INDEX team_member_bindings_by_user ON team_member_bindings(user_id, status, created_at DESC, id DESC);
CREATE INDEX team_member_bindings_by_team ON team_member_bindings(org_id, team_id, created_at DESC, id DESC);

CREATE FUNCTION c19_guard_member_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'A member binding starts ACTIVE' USING ERRCODE = '23514';
    END IF;
    -- A member once bound to one account is never silently handed to another account.
    IF EXISTS (
      SELECT 1 FROM team_member_bindings b
      WHERE b.member_id = NEW.member_id AND b.user_id <> NEW.user_id
    ) THEN
      RAISE EXCEPTION 'The member was bound to another account' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.team_id <> OLD.team_id
    OR NEW.member_id <> OLD.member_id OR NEW.user_id <> OLD.user_id OR NEW.source <> OLD.source
    OR NEW.join_code_id IS DISTINCT FROM OLD.join_code_id OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Member binding identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'ENDED' AND (NEW.status <> 'ENDED' OR NEW.ended_at <> OLD.ended_at
    OR NEW.ended_reason <> OLD.ended_reason OR NEW.ended_by IS DISTINCT FROM OLD.ended_by
    OR NEW.end_note IS DISTINCT FROM OLD.end_note) THEN
    RAISE EXCEPTION 'An ended member binding is history' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_member_bindings_guard BEFORE INSERT OR UPDATE ON team_member_bindings
  FOR EACH ROW EXECUTE FUNCTION c19_guard_member_binding();
