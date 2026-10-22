CREATE TABLE overlay_grants (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  overlay_id text NOT NULL UNIQUE CHECK (overlay_id ~ '^[A-Za-z0-9_-]{43}$'),
  secret_hash char(64) NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  template text NOT NULL DEFAULT 'SCOREBAR_1080P_V1' CHECK (template = 'SCOREBAR_1080P_V1'),
  issuer_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  version integer NOT NULL DEFAULT 1 CHECK (version IN (1, 2)),
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE (org_id, event_id, match_id, id, expires_at),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10080 minutes'),
  CHECK ((version = 1 AND revoked_at IS NULL AND revocation_reason IS NULL) OR
    (version = 2 AND revoked_at IS NOT NULL AND isfinite(revoked_at) AND revoked_at >= created_at AND
      revocation_reason IS NOT NULL AND revocation_reason = btrim(revocation_reason) AND
      char_length(revocation_reason) BETWEEN 1 AND 200))
);

CREATE UNIQUE INDEX overlay_grants_one_unrevoked_match ON overlay_grants(org_id, match_id)
  WHERE revoked_at IS NULL;
CREATE INDEX overlay_grants_by_match_history ON overlay_grants(org_id, event_id, match_id, created_at DESC, overlay_id DESC);

CREATE TABLE overlay_sessions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at) AND expires_at > created_at),
  FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id),
  FOREIGN KEY (org_id, event_id, match_id, grant_id, expires_at)
    REFERENCES overlay_grants(org_id, event_id, match_id, id, expires_at)
);

CREATE INDEX overlay_sessions_by_grant ON overlay_sessions(org_id, event_id, match_id, grant_id, expires_at);

CREATE FUNCTION p06_overlay_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Overlay grants cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.revoked_at IS NOT NULL OR NEW.revocation_reason IS NOT NULL THEN
      RAISE EXCEPTION 'An overlay grant must start unrevoked at version one' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.version <> 1 OR OLD.revoked_at IS NOT NULL OR NEW.version <> 2 OR
     NEW.revoked_at IS NULL OR NEW.revocation_reason IS NULL OR
     (to_jsonb(NEW) - ARRAY['version', 'revoked_at', 'revocation_reason']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['version', 'revoked_at', 'revocation_reason']) THEN
    RAISE EXCEPTION 'Overlay grants may only be revoked once without changing their identity or expiry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER overlay_grants_guard BEFORE INSERT OR UPDATE OR DELETE ON overlay_grants
  FOR EACH ROW EXECUTE FUNCTION p06_overlay_grant_guard();

CREATE FUNCTION p06_reject_overlay_session_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Overlay sessions are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER overlay_sessions_immutable BEFORE UPDATE OR DELETE ON overlay_sessions
  FOR EACH ROW EXECUTE FUNCTION p06_reject_overlay_session_mutation();
