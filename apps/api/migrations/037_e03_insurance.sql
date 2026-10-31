-- Insurance order orchestration. No supplier is configured or enabled by this migration.
CREATE TABLE insurance_configuration (
  singleton boolean PRIMARY KEY CHECK(singleton),
  key_id char(64) NOT NULL CHECK(key_id ~ '^[0-9a-f]{64}$'),
  provider_id text NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE insurance_products (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  external_id text NOT NULL,
  external_version text NOT NULL,
  name text NOT NULL,
  insurer text NOT NULL,
  terms_version text NOT NULL,
  terms_url text NOT NULL,
  basketball_covered boolean NOT NULL,
  active boolean NOT NULL DEFAULT true,
  source_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(provider_id,external_id,external_version)
);
CREATE TABLE insurance_quotes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  member_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  material_id uuid NOT NULL REFERENCES participant_materials(id),
  material_revision_id uuid NOT NULL REFERENCES participant_material_revisions(id),
  product_id uuid NOT NULL REFERENCES insurance_products(id),
  quote_ciphertext text NOT NULL,
  applicant_ciphertext text NOT NULL,
  key_id char(64) NOT NULL,
  applicant_reference char(64) NOT NULL,
  premium_fen bigint NOT NULL CHECK(premium_fen BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK(currency='CNY'),
  coverage_start_date date NOT NULL,
  coverage_end_date date NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,entry_id) REFERENCES entries(org_id,id),
  CHECK(coverage_end_date>=coverage_start_date),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE insurance_orders (
  id uuid PRIMARY KEY,
  quote_id uuid NOT NULL UNIQUE REFERENCES insurance_quotes(id),
  user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  member_id uuid NOT NULL,
  material_revision_id uuid NOT NULL REFERENCES participant_material_revisions(id),
  operation_id uuid NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN('UNPAID','PENDING','PAID','REFUND_PENDING','REFUNDED','FAILED')),
  policy_status text NOT NULL DEFAULT 'PENDING' CHECK(policy_status IN('PENDING','ISSUED','FAILED','CANCEL_PENDING','CANCELLED')),
  provider_order_id text,
  policy_ciphertext text,
  cancellation_requested_at timestamptz,
  verified_at timestamptz,
  terms_version text NOT NULL,
  key_id char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,entry_id) REFERENCES entries(org_id,id),
  CHECK(policy_status<>'ISSUED' OR payment_status='PAID')
);
CREATE TABLE insurance_operations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES insurance_orders(id),
  kind text NOT NULL CHECK(kind IN('APPLY','QUERY','CANCEL')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','RUNNING','UNKNOWN','DONE','FAILED')),
  reconcile_only boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 12),
  fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((status='RUNNING')=(lease_id IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX insurance_one_pending ON insurance_operations(order_id) WHERE status IN('PENDING','RUNNING','UNKNOWN');
CREATE INDEX insurance_pending ON insurance_operations(status,next_attempt_at);
CREATE INDEX insurance_orders_user ON insurance_orders(user_id,created_at DESC,id);
CREATE INDEX insurance_orders_eligibility ON insurance_orders(org_id,entry_id,member_id,material_revision_id);
CREATE TABLE insurance_receipts (
  user_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  action text NOT NULL CHECK(action IN('QUOTE','PURCHASE','REFRESH','REQUEST_CANCELLATION')),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,client_request_id)
);
CREATE TABLE insurance_provider_events (
  provider_id text NOT NULL,
  event_id text NOT NULL,
  operation_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(provider_id,event_id)
);
CREATE FUNCTION e03_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Insurance source evidence is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER insurance_quote_immutable BEFORE UPDATE OR DELETE ON insurance_quotes FOR EACH ROW EXECUTE FUNCTION e03_immutable();
CREATE TRIGGER insurance_receipt_immutable BEFORE UPDATE OR DELETE ON insurance_receipts FOR EACH ROW EXECUTE FUNCTION e03_immutable();
CREATE TRIGGER insurance_event_immutable BEFORE UPDATE OR DELETE ON insurance_provider_events FOR EACH ROW EXECUTE FUNCTION e03_immutable();
-- Independent identity/photo/signature qualification before buying insurance, without insurance dependency.
CREATE TABLE participant_qualification_prechecks (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  member_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  material_id uuid NOT NULL REFERENCES participant_materials(id),
  material_revision_id uuid NOT NULL REFERENCES participant_material_revisions(id),
  material_version integer NOT NULL CHECK(material_version>=1),
  ruleset_id uuid NOT NULL REFERENCES event_rulesets(id),
  roster_revision_id uuid NOT NULL REFERENCES entry_roster_revisions(id),
  portrait_sha256 char(64) NOT NULL,
  event_start_date date NOT NULL,
  event_end_date date NOT NULL,
  version integer NOT NULL CHECK(version>=1),
  status text NOT NULL CHECK(status IN('APPROVED','REJECTED')),
  reviewed_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 4 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(org_id,entry_id,member_id,version),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,entry_id) REFERENCES entries(org_id,id),
  CHECK(user_id<>reviewed_by),
  CHECK(event_end_date>=event_start_date)
);
CREATE TABLE participant_qualification_receipts (
  user_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  org_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  qualification_id uuid NOT NULL REFERENCES participant_qualification_prechecks(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,client_request_id)
);
CREATE TRIGGER qualification_precheck_immutable BEFORE UPDATE OR DELETE ON participant_qualification_prechecks FOR EACH ROW EXECUTE FUNCTION e03_immutable();
CREATE TRIGGER qualification_receipt_immutable BEFORE UPDATE OR DELETE ON participant_qualification_receipts FOR EACH ROW EXECUTE FUNCTION e03_immutable();
