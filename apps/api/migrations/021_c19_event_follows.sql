-- C19: signed-in viewers follow a public event publication (docs/design/C19_CONTRACTS.md §4).
-- A follow binds to one public_event_publications row, never to the private event: a later
-- publication of the same event (a new public key) inherits nothing. Only ACTIVE/CANCELLED
-- are stored; INVALID is derived on every read from the current public readability
-- (organization ACTIVE, publication unrevoked, event status matches the publication purpose),
-- so a revoked publication can never be "un-invalidated" by stale stored state.
-- Directory UNLIST does not touch follows: the share link stays valid.
-- History is kept: ACTIVE -> CANCELLED only, never deleted or revived; re-following inserts.
-- Upgrading follows nothing: the table starts empty.
CREATE TABLE event_follows (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_at timestamptz,
  FOREIGN KEY (org_id, event_id) REFERENCES events(org_id, id),
  FOREIGN KEY (org_id, event_id, publication_id)
    REFERENCES public_event_publications(org_id, event_id, id),
  CHECK (
    (status = 'ACTIVE' AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND isfinite(cancelled_at)
      AND cancelled_at >= created_at)
  )
);

-- One live follow per account and publication: the idempotency key of POST /v1/me/follows.
CREATE UNIQUE INDEX event_follows_one_active ON event_follows(user_id, publication_id)
  WHERE status = 'ACTIVE';
-- "My follows" keyset pages: newest first, ties broken by id.
CREATE INDEX event_follows_by_user ON event_follows(user_id, created_at DESC, id DESC)
  WHERE status = 'ACTIVE';
CREATE INDEX event_follows_by_publication ON event_follows(publication_id)
  WHERE status = 'ACTIVE';

-- Inserts must reference a currently readable publication; updates may only cancel; history
-- is permanent. Parent rows are locked here only after the caller already holds them
-- (identity -> organization -> event -> publication -> follow).
CREATE FUNCTION c19_event_follow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_status text;
  event_format text;
  publication_purpose text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Event follow history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'An event follow starts ACTIVE' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM organizations WHERE id = NEW.org_id AND status = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Following requires an active organization' USING ERRCODE = '23514';
    END IF;
    SELECT status, format INTO event_status, event_format FROM events
      WHERE org_id = NEW.org_id AND id = NEW.event_id FOR SHARE;
    SELECT purpose INTO publication_purpose FROM public_event_publications
      WHERE org_id = NEW.org_id AND event_id = NEW.event_id AND id = NEW.publication_id
        AND revoked_at IS NULL FOR SHARE;
    IF publication_purpose IS NULL
      OR event_format NOT IN ('ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT')
      OR NOT (
        (publication_purpose = 'LIVE' AND event_status IN ('SCHEDULED', 'RUNNING'))
        OR (publication_purpose = 'HISTORY' AND event_status IN ('COMPLETED', 'ARCHIVED'))
      ) THEN
      RAISE EXCEPTION 'Following requires a currently readable public publication'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'CANCELLED' OR
     (to_jsonb(NEW) - ARRAY['status', 'cancelled_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'cancelled_at']) THEN
    RAISE EXCEPTION 'Event follows may only transition once from ACTIVE to CANCELLED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_follows_guard BEFORE INSERT OR UPDATE OR DELETE ON event_follows
  FOR EACH ROW EXECUTE FUNCTION c19_event_follow_guard();
CREATE TRIGGER event_follows_no_truncate BEFORE TRUNCATE ON event_follows
  FOR EACH STATEMENT EXECUTE FUNCTION c19_event_follow_guard();
