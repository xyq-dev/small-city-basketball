-- C18: explicit public event directory listings.
-- A listing references one current public publication of the same organization and event.
-- Enabling public viewing never lists an event; LIST/UNLIST are explicit, audited commands.
-- History is kept: ACTIVE -> REVOKED only, never deleted or revived; re-listing inserts a row.
-- Upgrading lists nothing: the table starts empty.
CREATE TABLE event_directory_listings (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  display_city text CHECK (
    display_city IS NULL OR (
      display_city = btrim(display_city)
      AND display_city !~ '  '
      AND char_length(display_city) BETWEEN 1 AND 20
      AND display_city ~ '^[A-Za-z0-9 ·一-鿿]+$'
    )
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  listed_by uuid NOT NULL REFERENCES users(id),
  listed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  listed_event_version integer NOT NULL CHECK (listed_event_version > 0),
  list_reason text NOT NULL CHECK (
    list_reason = btrim(list_reason) AND char_length(list_reason) BETWEEN 4 AND 500
  ),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_source text CHECK (
    revoke_source IN ('UNLIST', 'PUBLICATION_REVOKED', 'ORGANIZATION_DISABLED')
  ),
  revoke_reason text CHECK (
    revoke_reason IS NULL OR (
      revoke_reason = btrim(revoke_reason) AND char_length(revoke_reason) BETWEEN 4 AND 500
    )
  ),
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, event_id, publication_id)
    REFERENCES public_event_publications(org_id, event_id, id),
  CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL
      AND revoke_source IS NULL AND revoke_reason IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND isfinite(revoked_at)
      AND revoked_at >= listed_at AND revoke_source IS NOT NULL AND revoke_reason IS NOT NULL
      -- An organization disable has no real operator: never invent one.
      AND ((revoke_source = 'ORGANIZATION_DISABLED' AND revoked_by IS NULL)
        OR (revoke_source <> 'ORGANIZATION_DISABLED' AND revoked_by IS NOT NULL)))
  )
);

CREATE UNIQUE INDEX event_directory_one_active ON event_directory_listings(org_id, event_id)
  WHERE status = 'ACTIVE';
CREATE INDEX event_directory_active_by_publication ON event_directory_listings(publication_id)
  WHERE status = 'ACTIVE';
CREATE INDEX event_directory_history ON event_directory_listings(org_id, event_id, listed_at DESC, id DESC);

-- Inserts must reference a live parent chain; updates may only revoke; history is permanent.
-- Parent rows are locked here only after the caller already holds them (identity -> org ->
-- event -> publication -> directory); this guard never locks a listing before its parents.
CREATE FUNCTION c18_directory_listing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_status text;
  publication_purpose text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Directory listing history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'A directory listing starts ACTIVE' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM organizations WHERE id = NEW.org_id AND status = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Directory listing requires an active organization' USING ERRCODE = '23514';
    END IF;
    SELECT status INTO event_status FROM events
      WHERE org_id = NEW.org_id AND id = NEW.event_id FOR SHARE;
    SELECT purpose INTO publication_purpose FROM public_event_publications
      WHERE org_id = NEW.org_id AND event_id = NEW.event_id AND id = NEW.publication_id
        AND revoked_at IS NULL FOR SHARE;
    IF publication_purpose IS NULL OR NOT (
      (event_status IN ('SCHEDULED', 'RUNNING') AND publication_purpose = 'LIVE')
      OR (event_status IN ('COMPLETED', 'ARCHIVED') AND publication_purpose = 'HISTORY')
    ) THEN
      RAISE EXCEPTION 'Directory listing requires a current matching public publication'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'REVOKED'
    OR NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.event_id <> OLD.event_id
    OR NEW.publication_id <> OLD.publication_id
    OR NEW.display_city IS DISTINCT FROM OLD.display_city
    OR NEW.listed_by <> OLD.listed_by OR NEW.listed_at <> OLD.listed_at
    OR NEW.listed_event_version <> OLD.listed_event_version
    OR NEW.list_reason <> OLD.list_reason THEN
    RAISE EXCEPTION 'A directory listing can only move from ACTIVE to REVOKED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_directory_listings_guard
  BEFORE INSERT OR UPDATE OR DELETE ON event_directory_listings
  FOR EACH ROW EXECUTE FUNCTION c18_directory_listing_guard();
CREATE TRIGGER event_directory_listings_no_truncate
  BEFORE TRUNCATE ON event_directory_listings
  FOR EACH STATEMENT EXECUTE FUNCTION c18_directory_listing_guard();

-- Revoking a public publication (DISABLE, COMPLETE/REOPEN, a knockout or group round
-- publication, restore quarantine) withdraws its listing in the same transaction, keeping
-- the real revoking user. The parent command's own event version change is not repeated.
CREATE FUNCTION c18_directory_publication_revoked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE event_directory_listings
     SET status = 'REVOKED',
         revoked_at = GREATEST(NEW.revoked_at, listed_at),
         revoked_by = NEW.revoked_by,
         revoke_source = 'PUBLICATION_REVOKED',
         revoke_reason = '公开观赛授权已撤销，目录同时撤出'
   WHERE publication_id = NEW.id AND status = 'ACTIVE';
  RETURN NULL;
END;
$$;

CREATE TRIGGER public_event_publications_directory_revoke
  AFTER UPDATE OF revoked_at ON public_event_publications
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION c18_directory_publication_revoked();

-- Disabling an organization withdraws its listings permanently. There is no real operator,
-- so the listing records a system reason and a NULL operator (audit_logs is not touched).
-- Re-enabling the organization never re-lists anything.
CREATE FUNCTION c18_directory_organization_disabled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE event_directory_listings
     SET status = 'REVOKED',
         revoked_at = GREATEST(clock_timestamp(), listed_at),
         revoked_by = NULL,
         revoke_source = 'ORGANIZATION_DISABLED',
         revoke_reason = '机构已停用，系统撤出目录（无操作者）'
   WHERE org_id = NEW.id AND status = 'ACTIVE';
  RETURN NULL;
END;
$$;

CREATE TRIGGER organizations_directory_revoke
  AFTER UPDATE OF status ON organizations
  FOR EACH ROW WHEN (OLD.status = 'ACTIVE' AND NEW.status = 'DISABLED')
  EXECUTE FUNCTION c18_directory_organization_disabled();
