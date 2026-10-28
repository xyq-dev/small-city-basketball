-- C19: organization-level private seasons and an independent PRIVATE_SEASON data grant.
-- A season is DRAFT -> ACTIVE -> CLOSED. Events are attached explicitly by an OWNER/ADMIN (never
-- by date), at most one active season per event; CLOSED locks configuration and attachments.
-- A PRIVATE_SEASON grant names one exact frozen-roster source (org, event, team, long-term member)
-- and one exact target account through the member binding that existed at nomination
-- (team_member_bindings, migration 020). It is nominated by a current organizer and takes effect
-- only after the target's own consent. It is not the C07 booking_performance_links consent and
-- neither creates the other. Binding alone, nomination alone or a booking profile never grants.
-- Effectiveness is re-evaluated on every read (binding, nominator power, frozen source); a
-- rebinding or a new grant is a new row and never revives an old one. No statistics are copied.
-- History is kept: the runtime role never deletes; rows only move to terminal states.

CREATE TABLE seasons (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  -- Creation is deduplicated per account and organization: a lost response never creates twice.
  client_request_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  activated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, created_by, client_request_id),
  CHECK (end_date >= start_date AND end_date <= start_date + 731),
  CHECK ((status = 'DRAFT') = (activated_at IS NULL)),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE INDEX seasons_by_org ON seasons(org_id, start_date DESC, id DESC);

CREATE FUNCTION c19_guard_season() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Season history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'A season starts as a version 1 draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.created_by <> OLD.created_by
    OR NEW.client_request_id <> OLD.client_request_id OR NEW.request_hash <> OLD.request_hash
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Season identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'A closed season is locked' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Season version must advance by one' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.status = OLD.status OR (OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE')
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'CLOSED')) THEN
    RAISE EXCEPTION 'Invalid season transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at AND OLD.activated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Season activation evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER seasons_guard BEFORE INSERT OR UPDATE OR DELETE ON seasons
  FOR EACH ROW EXECUTE FUNCTION c19_guard_season();

-- Explicit attachment history. One ACTIVE attachment per event (first version: one season).
CREATE TABLE season_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  season_id uuid NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DETACHED')),
  attached_by uuid NOT NULL REFERENCES users(id),
  attached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detached_by uuid REFERENCES users(id),
  detached_at timestamptz,
  FOREIGN KEY (org_id, season_id) REFERENCES seasons(org_id, id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  CHECK ((status = 'ACTIVE') = (detached_at IS NULL)),
  CHECK ((detached_at IS NULL) = (detached_by IS NULL)),
  CHECK (detached_at IS NULL OR detached_at >= attached_at)
);

CREATE UNIQUE INDEX season_events_one_season_per_event ON season_events(event_id) WHERE status = 'ACTIVE';
CREATE INDEX season_events_by_season ON season_events(org_id, season_id, status, attached_at, id);

CREATE FUNCTION c19_guard_season_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE season_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Season attachment history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO season_status FROM seasons WHERE org_id = NEW.org_id AND id = NEW.season_id;
  IF season_status IS DISTINCT FROM 'DRAFT' AND season_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'A closed season locks its events' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'An attachment starts ACTIVE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.season_id <> OLD.season_id
    OR NEW.event_id <> OLD.event_id OR NEW.attached_by <> OLD.attached_by
    OR NEW.attached_at <> OLD.attached_at OR OLD.status <> 'ACTIVE' OR NEW.status <> 'DETACHED' THEN
    RAISE EXCEPTION 'Season attachments only move ACTIVE -> DETACHED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER season_events_guard BEFORE INSERT OR UPDATE OR DELETE ON season_events
  FOR EACH ROW EXECUTE FUNCTION c19_guard_season_event();

-- PENDING -> ACTIVE | DECLINED | WITHDRAWN; ACTIVE -> REVOKED | WITHDRAWN. Terminal rows are history.
CREATE TABLE season_data_grants (
  id uuid PRIMARY KEY,
  purpose text NOT NULL DEFAULT 'PRIVATE_SEASON' CHECK (purpose = 'PRIVATE_SEASON'),
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  member_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES users(id),
  -- The exact binding seen at nomination. A later binding (a new row) never satisfies this grant.
  binding_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  nominated_by uuid NOT NULL REFERENCES users(id),
  nominate_reason text NOT NULL CHECK (nominate_reason = btrim(nominate_reason) AND char_length(nominate_reason) BETWEEN 4 AND 500),
  client_request_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  consented_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  withdrawn_by uuid REFERENCES users(id),
  withdrawn_at timestamptz,
  withdraw_reason text CHECK (withdraw_reason IS NULL OR (withdraw_reason = btrim(withdraw_reason) AND char_length(withdraw_reason) BETWEEN 4 AND 500)),
  -- Irreversible loss of a prerequisite, distinct from a person's consent/withdrawal action.
  -- Keeping the original consent and system reason avoids inventing an audit actor.
  invalidated_at timestamptz,
  invalidation_reason text CHECK (invalidation_reason IN ('BINDING_ENDED', 'NOMINATOR_UNAUTHORIZED', 'TARGET_INACTIVE', 'ORGANIZATION_INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, nominated_by, client_request_id),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, team_id, member_id) REFERENCES team_members(org_id, team_id, id),
  FOREIGN KEY (org_id, team_id, binding_id) REFERENCES team_member_bindings(org_id, team_id, id),
  CHECK ((status = 'DECLINED') = (declined_at IS NOT NULL)),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdraw_reason IS NULL)),
  CHECK ((invalidated_at IS NULL) = (invalidation_reason IS NULL)),
  CHECK (status NOT IN ('ACTIVE', 'REVOKED') OR consented_at IS NOT NULL),
  CHECK (status NOT IN ('PENDING', 'DECLINED') OR consented_at IS NULL)
);

CREATE UNIQUE INDEX season_data_grants_one_open_per_binding
  ON season_data_grants(event_id, binding_id) WHERE status IN ('PENDING', 'ACTIVE') AND invalidated_at IS NULL;
CREATE INDEX season_data_grants_by_target ON season_data_grants(target_user_id, created_at DESC, id DESC);
CREATE INDEX season_data_grants_by_event ON season_data_grants(org_id, event_id, created_at DESC, id DESC);

CREATE FUNCTION c19_guard_season_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Season grant history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.version <> 1 OR NEW.consented_at IS NOT NULL
      OR NEW.invalidated_at IS NOT NULL THEN
      RAISE EXCEPTION 'A season grant starts as a pending nomination' USING ERRCODE = '23514';
    END IF;
    -- The binding must be the target's current binding to exactly this long-term member.
    IF NOT EXISTS (
      SELECT 1 FROM team_member_bindings b
      WHERE b.id = NEW.binding_id AND b.org_id = NEW.org_id AND b.team_id = NEW.team_id
        AND b.member_id = NEW.member_id AND b.user_id = NEW.target_user_id AND b.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'A season grant needs the target''s active member binding' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'version', 'consented_at', 'declined_at', 'revoked_at',
      'withdrawn_by', 'withdrawn_at', 'withdraw_reason', 'invalidated_at', 'invalidation_reason', 'updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'version', 'consented_at', 'declined_at',
      'revoked_at', 'withdrawn_by', 'withdrawn_at', 'withdraw_reason', 'invalidated_at', 'invalidation_reason', 'updated_at']) THEN
    RAISE EXCEPTION 'Season grant identity and nomination are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Season grant version must advance by one' USING ERRCODE = '23514';
  END IF;
  IF OLD.invalidated_at IS NOT NULL AND
    (NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at OR NEW.invalidation_reason IS DISTINCT FROM OLD.invalidation_reason) THEN
    RAISE EXCEPTION 'Season grant invalidation is permanent' USING ERRCODE = '23514';
  END IF;
  IF OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL THEN
    IF OLD.status NOT IN ('PENDING', 'ACTIVE') OR
      (to_jsonb(NEW) - ARRAY['version', 'invalidated_at', 'invalidation_reason', 'updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version', 'invalidated_at', 'invalidation_reason', 'updated_at']) THEN
      RAISE EXCEPTION 'Invalidation preserves the original consent state' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.invalidated_at IS NOT NULL AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'An invalidated season grant cannot be activated' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('ACTIVE', 'DECLINED', 'WITHDRAWN'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('REVOKED', 'WITHDRAWN'))) THEN
    RAISE EXCEPTION 'Invalid season grant transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.consented_at IS NOT NULL AND NEW.consented_at IS DISTINCT FROM OLD.consented_at THEN
    RAISE EXCEPTION 'Consent evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER season_data_grants_guard BEFORE INSERT OR UPDATE OR DELETE ON season_data_grants
  FOR EACH ROW EXECUTE FUNCTION c19_guard_season_grant();

-- Prerequisite loss is recorded in the same transaction that changes it, even when it is
-- restored before anybody reads statistics. A later permission grant/activation never
-- clears this evidence. This is an invoker function and uses the runtime's column grants.
CREATE FUNCTION c19_invalidate_season_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'team_member_bindings' THEN
    IF OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' THEN
      UPDATE season_data_grants SET invalidated_at=clock_timestamp(),invalidation_reason='BINDING_ENDED',
        version=version+1,updated_at=clock_timestamp()
        WHERE binding_id=OLD.id AND status IN ('PENDING','ACTIVE') AND invalidated_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'organizations' THEN
    IF OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' THEN
      UPDATE season_data_grants SET invalidated_at=clock_timestamp(),invalidation_reason='ORGANIZATION_INACTIVE',
        version=version+1,updated_at=clock_timestamp()
        WHERE org_id=OLD.id AND status IN ('PENDING','ACTIVE') AND invalidated_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'users' THEN
    IF OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' THEN
      UPDATE season_data_grants SET invalidated_at=clock_timestamp(),
        invalidation_reason=CASE WHEN target_user_id=OLD.id THEN 'TARGET_INACTIVE' ELSE 'NOMINATOR_UNAUTHORIZED' END,
        version=version+1,updated_at=clock_timestamp()
        WHERE (target_user_id=OLD.id OR nominated_by=OLD.id) AND status IN ('PENDING','ACTIVE') AND invalidated_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME IN ('event_staff','organization_memberships') THEN
    -- Losing one route to authority while retaining another does not terminate a grant.
    UPDATE season_data_grants g SET invalidated_at=clock_timestamp(),invalidation_reason='NOMINATOR_UNAUTHORIZED',
      version=version+1,updated_at=clock_timestamp()
      WHERE g.org_id=OLD.org_id AND g.nominated_by=OLD.user_id
        AND g.status IN ('PENDING','ACTIVE') AND g.invalidated_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM organization_memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
          WHERE m.org_id=g.org_id AND m.user_id=g.nominated_by AND m.status='ACTIVE'
            AND (m.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS (
              SELECT 1 FROM event_staff es WHERE es.org_id=g.org_id AND es.event_id=g.event_id
                AND es.user_id=g.nominated_by AND es.status='ACTIVE' AND es.role='EVENT_MANAGER'
            ))
        );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER season_grants_binding_ended AFTER UPDATE OF status ON team_member_bindings
  FOR EACH ROW EXECUTE FUNCTION c19_invalidate_season_grants();
CREATE TRIGGER season_grants_organization_disabled AFTER UPDATE OF status ON organizations
  FOR EACH ROW EXECUTE FUNCTION c19_invalidate_season_grants();
CREATE TRIGGER season_grants_user_disabled AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION c19_invalidate_season_grants();
CREATE TRIGGER season_grants_staff_changed AFTER UPDATE OF status,role ON event_staff
  FOR EACH ROW EXECUTE FUNCTION c19_invalidate_season_grants();
CREATE TRIGGER season_grants_membership_changed AFTER UPDATE OF status,role ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION c19_invalidate_season_grants();
