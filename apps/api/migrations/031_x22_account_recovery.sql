-- Account recovery is disabled unless mail delivery plus dedicated encryption are configured.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN credential_reset_at timestamptz;

CREATE TABLE account_mail_configuration (
  singleton boolean PRIMARY KEY CHECK(singleton),
  key_id char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE account_action_requests (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE account_action_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
  token_hash char(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  email_snapshot text NOT NULL,
  credential_fingerprint char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid UNIQUE,
  used_request_hash char(64),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(expires_at > created_at),
  CHECK((used_at IS NULL AND used_by IS NULL AND used_request_hash IS NULL) OR
        (used_at IS NOT NULL AND used_by IS NOT NULL AND used_request_hash IS NOT NULL))
);
CREATE INDEX account_action_user ON account_action_tokens(user_id,purpose,created_at);
CREATE TABLE account_mail_jobs (
  id uuid PRIMARY KEY,
  token_id uuid NOT NULL UNIQUE REFERENCES account_action_tokens(id),
  envelope bytea,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','ACCEPTED','UNKNOWN','FAILED','EXPIRED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  lease_id uuid,
  lease_until timestamptz,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(envelope IS NULL OR octet_length(envelope) BETWEEN 30 AND 16384),
  CHECK((status='SENDING')=(lease_id IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX account_mail_pending ON account_mail_jobs(status,created_at);
CREATE FUNCTION x22_account_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Account request receipts are immutable'; END $$;
CREATE TRIGGER x22_account_request_immutable BEFORE UPDATE OR DELETE ON account_action_requests
FOR EACH ROW EXECUTE FUNCTION x22_account_receipt_immutable();
