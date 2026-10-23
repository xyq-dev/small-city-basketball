-- AppID-scoped irreversible identity keys. No raw openid, code or session_key is stored.
CREATE TABLE wechat_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  app_id text NOT NULL CHECK (app_id ~ '^wx[0-9a-fA-F]{16}$'),
  openid_hash char(64) NOT NULL CHECK (openid_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  UNIQUE(app_id,openid_hash),
  CHECK ((status='ACTIVE' AND revoked_at IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX wechat_identity_one_active_per_user_app ON wechat_identities(app_id,user_id) WHERE status='ACTIVE';
CREATE INDEX wechat_identities_by_user ON wechat_identities(user_id,app_id,status);
CREATE FUNCTION c05_wechat_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.version<>OLD.version+1 OR
    (to_jsonb(NEW)-ARRAY['status','version','updated_at','revoked_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','revoked_at']) OR NEW.status=OLD.status THEN
    RAISE EXCEPTION 'WeChat identity ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wechat_identities_guard BEFORE UPDATE OR DELETE ON wechat_identities FOR EACH ROW EXECUTE FUNCTION c05_wechat_identity_guard();
CREATE TABLE wechat_auth_attempts (
  id uuid PRIMARY KEY,
  app_id text NOT NULL CHECK (app_id ~ '^wx[0-9a-fA-F]{16}$'),
  state_hash char(64) NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('LOGIN','BIND')),
  user_id uuid REFERENCES users(id),
  session_id uuid REFERENCES sessions(id),
  credential_fingerprint char(64),
  code_hash char(64) UNIQUE CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','COMPLETE','FAILED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  finished_at timestamptz,
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
  CHECK ((purpose='LOGIN' AND user_id IS NULL AND session_id IS NULL AND credential_fingerprint IS NULL) OR
    (purpose='BIND' AND user_id IS NOT NULL AND session_id IS NOT NULL AND credential_fingerprint ~ '^[0-9a-f]{64}$')),
  CHECK ((status='PENDING' AND code_hash IS NULL AND claimed_at IS NULL AND finished_at IS NULL) OR
    (status='CLAIMED' AND code_hash IS NOT NULL AND claimed_at IS NOT NULL AND finished_at IS NULL) OR
    (status IN ('COMPLETE','FAILED') AND code_hash IS NOT NULL AND claimed_at IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE INDEX wechat_auth_attempts_expiry ON wechat_auth_attempts(expires_at);
CREATE FUNCTION c05_wechat_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['code_hash','status','claimed_at','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['code_hash','status','claimed_at','finished_at']) OR
    NOT ((OLD.status='PENDING' AND NEW.status='CLAIMED' AND NEW.code_hash IS NOT NULL AND NEW.claimed_at IS NOT NULL AND NEW.finished_at IS NULL) OR
      (OLD.status='CLAIMED' AND NEW.status IN ('COMPLETE','FAILED') AND NEW.code_hash=OLD.code_hash AND NEW.claimed_at=OLD.claimed_at AND NEW.finished_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WeChat challenges are single use' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wechat_auth_attempts_guard BEFORE UPDATE ON wechat_auth_attempts FOR EACH ROW EXECUTE FUNCTION c05_wechat_attempt_guard();
