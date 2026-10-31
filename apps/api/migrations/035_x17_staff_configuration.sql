CREATE TABLE staff_configuration_receipts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION x17_staff_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Staff configuration receipts are immutable'; END $$;
CREATE TRIGGER x17_staff_receipt_immutable BEFORE UPDATE OR DELETE ON staff_configuration_receipts
FOR EACH ROW EXECUTE FUNCTION x17_staff_receipt_immutable();
