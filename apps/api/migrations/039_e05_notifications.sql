-- E05: private message center and one-attempt WeChat subscription deliveries.
-- Raw WeChat recipients are encrypted independently of irreversible identity hashes.
CREATE TABLE notification_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  key_id char(64) NOT NULL CHECK(key_id ~ '^[0-9a-f]{64}$')
);
CREATE TABLE notification_source_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('REGISTRATION_REVIEW','MATCH_RESCHEDULED','MATCH_STARTING')),
  resource_id uuid NOT NULL,
  source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  due_at timestamptz NOT NULL CHECK(isfinite(due_at)),
  expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>due_at),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(org_id,kind,resource_id,source_fingerprint),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE notification_messages (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  source_id uuid NOT NULL REFERENCES notification_source_events(id),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id,source_id)
);
CREATE INDEX notification_messages_page ON notification_messages(user_id,created_at DESC,id DESC);
CREATE TABLE notification_subscription_intents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('REGISTRATION_REVIEW','MATCH_RESCHEDULED','MATCH_STARTING')),
  template_id text NOT NULL CHECK(template_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  configuration_hash char(64) NOT NULL CHECK(configuration_hash ~ '^[0-9a-f]{64}$'),
  identity_id uuid NOT NULL REFERENCES wechat_identities(id),
  identity_version integer NOT NULL CHECK(identity_version>0),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','CLAIMED','ACCEPTED','REJECTED','FAILED')),
  confirm_request_id uuid UNIQUE,
  code_hash char(64) UNIQUE,
  grant_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  UNIQUE(user_id,client_request_id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
  CHECK((status='PENDING' AND confirm_request_id IS NULL AND code_hash IS NULL AND finished_at IS NULL) OR
    (status='CLAIMED' AND confirm_request_id IS NOT NULL AND code_hash IS NOT NULL AND finished_at IS NULL) OR
    (status IN('ACCEPTED','REJECTED','FAILED') AND confirm_request_id IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE TABLE notification_subscription_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  intent_id uuid NOT NULL UNIQUE REFERENCES notification_subscription_intents(id),
  kind text NOT NULL CHECK(kind IN('REGISTRATION_REVIEW','MATCH_RESCHEDULED','MATCH_STARTING')),
  template_id text NOT NULL,
  configuration_hash char(64) NOT NULL,
  identity_id uuid NOT NULL REFERENCES wechat_identities(id),
  identity_version integer NOT NULL,
  target_cipher bytea,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','RESERVED','CONSUMED','REVOKED')),
  evidence text NOT NULL DEFAULT 'CLIENT_REPORTED' CHECK(evidence='CLIENT_REPORTED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK((status IN('AVAILABLE','RESERVED') AND target_cipher IS NOT NULL AND octet_length(target_cipher)>=30 AND used_at IS NULL AND revoked_at IS NULL) OR
    (status='CONSUMED' AND target_cipher IS NULL AND used_at IS NOT NULL AND revoked_at IS NULL) OR
    (status='REVOKED' AND target_cipher IS NULL AND revoked_at IS NOT NULL))
);
ALTER TABLE notification_subscription_intents ADD CONSTRAINT notification_intent_grant_fk FOREIGN KEY(grant_id) REFERENCES notification_subscription_grants(id);
CREATE INDEX notification_grants_available ON notification_subscription_grants(user_id,kind,created_at,id) WHERE status='AVAILABLE';
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL UNIQUE REFERENCES notification_messages(id),
  grant_id uuid UNIQUE REFERENCES notification_subscription_grants(id),
  state text NOT NULL DEFAULT 'WAITING_PERMISSION' CHECK(state IN('WAITING_PERMISSION','PENDING','SENDING','ACCEPTED','UNKNOWN','FAILED','CANCELLED','EXPIRED')),
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_id uuid,
  lease_until timestamptz,
  last_reason text CHECK(last_reason IN('TOKEN_UNAVAILABLE','TOKEN_REJECTED','NO_PERMISSION','INVALID_TEMPLATE','PROVIDER_REJECTED','SOURCE_UNAVAILABLE','IDENTITY_UNAVAILABLE','LEASE_EXPIRED')),
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((state='SENDING' AND lease_id IS NOT NULL AND lease_until IS NOT NULL) OR
    (state<>'SENDING' AND lease_id IS NULL AND lease_until IS NULL)),
  CHECK((state='ACCEPTED')=(accepted_at IS NOT NULL)),
  CHECK(state NOT IN('PENDING','SENDING','ACCEPTED','UNKNOWN') OR grant_id IS NOT NULL)
);
CREATE INDEX notification_deliveries_due ON notification_deliveries(state,next_attempt_at,id);
CREATE FUNCTION e05_notification_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history is retained' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='notification_messages' THEN
    IF (to_jsonb(NEW)-'read_at') IS DISTINCT FROM (to_jsonb(OLD)-'read_at') OR OLD.read_at IS NOT NULL OR NEW.read_at IS NULL THEN
      RAISE EXCEPTION 'Only the first read acknowledgement is mutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='notification_source_events' THEN
    RAISE EXCEPTION 'Notification source facts are immutable' USING ERRCODE='23514';
  ELSIF TG_TABLE_NAME='notification_subscription_grants' THEN
    IF (to_jsonb(NEW)-ARRAY['status','target_cipher','used_at','revoked_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','target_cipher','used_at','revoked_at']) OR
      NOT ((OLD.status='AVAILABLE' AND NEW.status IN('RESERVED','REVOKED')) OR
        (OLD.status='RESERVED' AND NEW.status IN('CONSUMED','REVOKED')) OR
        (OLD.status='CONSUMED' AND NEW.status='REVOKED')) OR
      (NEW.target_cipher IS NOT NULL AND NEW.target_cipher IS DISTINCT FROM OLD.target_cipher) THEN
      RAISE EXCEPTION 'Subscription grants are single-attempt and cannot revive' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_source_events_guard BEFORE UPDATE OR DELETE ON notification_source_events FOR EACH ROW EXECUTE FUNCTION e05_notification_history_guard();
CREATE TRIGGER notification_messages_guard BEFORE UPDATE OR DELETE ON notification_messages FOR EACH ROW EXECUTE FUNCTION e05_notification_history_guard();
CREATE TRIGGER notification_subscription_grants_guard BEFORE UPDATE OR DELETE ON notification_subscription_grants FOR EACH ROW EXECUTE FUNCTION e05_notification_history_guard();
