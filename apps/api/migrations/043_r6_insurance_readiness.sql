-- R6INS: reviewed deployment evidence; contains no applicant identity or credential.
CREATE TABLE insurance_provider_releases (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 80),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  sales_mode text NOT NULL CHECK (sales_mode IN ('APPROVED_API','PROVIDER_HOSTED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until > valid_from),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,source_hash)
);
CREATE TRIGGER insurance_provider_releases_immutable BEFORE UPDATE OR DELETE ON insurance_provider_releases
  FOR EACH ROW EXECUTE FUNCTION e03_immutable();
ALTER TABLE insurance_quotes ADD COLUMN admission_release_id uuid,
  ADD COLUMN admission_source_hash text,
  ADD CONSTRAINT insurance_quote_admission_pair CHECK ((admission_release_id IS NULL) = (admission_source_hash IS NULL)),
  ADD CONSTRAINT insurance_quote_admission_fk FOREIGN KEY(admission_release_id,admission_source_hash)
    REFERENCES insurance_provider_releases(id,source_hash);
-- Old immutable quotes retain NULL provenance and cannot create a new APPLY. Existing
-- supplier obligations remain queryable/cancellable with their original supplier pin.
ALTER TABLE insurance_operations ADD CONSTRAINT insurance_operation_order_pair UNIQUE(id,order_id);
CREATE TABLE insurance_reconciliation_cases (
  operation_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES insurance_orders(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason='AUTOMATIC_QUERY_BUDGET_EXHAUSTED'),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CHECK (resolved_at IS NULL OR resolved_at >= opened_at),
  FOREIGN KEY(operation_id,order_id) REFERENCES insurance_operations(id,order_id) ON DELETE RESTRICT
);
CREATE INDEX insurance_reconciliation_open ON insurance_reconciliation_cases(order_id) WHERE resolved_at IS NULL;
CREATE FUNCTION r6_insurance_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='UNKNOWN' AND NEW.attempt_count>=12 THEN
    INSERT INTO insurance_reconciliation_cases(operation_id,order_id,reason)
      VALUES(NEW.id,NEW.order_id,'AUTOMATIC_QUERY_BUDGET_EXHAUSTED')
      ON CONFLICT(operation_id) DO UPDATE SET resolved_at=NULL;
  ELSIF NEW.status IN ('DONE','FAILED') THEN
    UPDATE insurance_reconciliation_cases SET resolved_at=clock_timestamp()
      WHERE operation_id=NEW.id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER insurance_operation_reconciliation AFTER INSERT OR UPDATE OF status,attempt_count ON insurance_operations
  FOR EACH ROW EXECUTE FUNCTION r6_insurance_reconciliation();
INSERT INTO insurance_reconciliation_cases(operation_id,order_id,reason)
  SELECT id,order_id,'AUTOMATIC_QUERY_BUDGET_EXHAUSTED' FROM insurance_operations
  WHERE status='UNKNOWN' AND attempt_count>=12;
-- No client table grants or new public endpoint. Existing authenticated order ownership
-- and org/event locks govern access. Evidence is retained with orders for disputes;
-- account closure revokes eligibility, never deletes policy/reconciliation evidence.
REVOKE ALL ON insurance_provider_releases,insurance_reconciliation_cases FROM PUBLIC;
