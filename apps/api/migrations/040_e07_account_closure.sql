-- E07 retains immutable business history. This ledger is NOT an independent
-- deletion ledger outside old backups; restoration must keep authorization quarantine.
CREATE TABLE account_closure_requests (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 requested_session_id uuid NOT NULL REFERENCES sessions(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','BLOCKED','CANCELLED','EXPIRED_AUTH','CLOSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 cooling_off_days integer NOT NULL CHECK(cooling_off_days BETWEEN 0 AND 7),
 auth_fingerprint char(64) NOT NULL CHECK(auth_fingerprint ~ '^[0-9a-f]{64}$'),
 requested_at timestamptz NOT NULL DEFAULT statement_timestamp() CHECK(isfinite(requested_at)),
 execute_after timestamptz NOT NULL CHECK(isfinite(execute_after) AND execute_after >= requested_at AND execute_after <= requested_at + interval '7 days'),
 blocked_reasons jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(blocked_reasons)='array' AND jsonb_array_length(blocked_reasons)<=32),
 lease_id uuid, lease_until timestamptz,
 fence bigint NOT NULL DEFAULT 0 CHECK(fence >= 0),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 finished_at timestamptz,
 CHECK((lease_id IS NULL)=(lease_until IS NULL)),
 CHECK(lease_until IS NULL OR (isfinite(lease_until) AND status IN ('PENDING','BLOCKED'))),
 CHECK((status IN ('CANCELLED','EXPIRED_AUTH','CLOSED'))=(finished_at IS NOT NULL)),
 CHECK(finished_at IS NULL OR (isfinite(finished_at) AND finished_at >= requested_at)),
 UNIQUE(user_id,id)
);
CREATE UNIQUE INDEX account_closure_one_pending ON account_closure_requests(user_id) WHERE status IN ('PENDING','BLOCKED');
CREATE INDEX account_closure_due ON account_closure_requests(execute_after,id) WHERE status IN ('PENDING','BLOCKED');
CREATE TABLE account_closure_operations (
 actor_id uuid NOT NULL REFERENCES users(id),
 command_id uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 request_id uuid NOT NULL REFERENCES account_closure_requests(id),
 operation text NOT NULL CHECK(operation IN ('REQUEST','CANCEL')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES account_closure_requests(user_id,id)
);
CREATE TABLE account_closure_tombstones (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 request_id uuid NOT NULL UNIQUE REFERENCES account_closure_requests(id),
 closed_at timestamptz NOT NULL CHECK(isfinite(closed_at)),
 history_policy text NOT NULL CHECK(history_policy='RETAIN_IMMUTABLE_AND_RESTRICT_ACCESS'),
 restore_policy text NOT NULL CHECK(restore_policy='QUARANTINE_OLD_BACKUP_AUTHORIZATIONS'),
 FOREIGN KEY(user_id,request_id) REFERENCES account_closure_requests(user_id,id)
);
CREATE TRIGGER account_closure_operations_immutable BEFORE UPDATE OR DELETE ON account_closure_operations FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
CREATE TRIGGER account_closure_tombstones_immutable BEFORE UPDATE OR DELETE ON account_closure_tombstones FOR EACH ROW EXECUTE FUNCTION p05_reject_history_mutation();
CREATE FUNCTION e07_account_closure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('CANCELLED','EXPIRED_AUTH','CLOSED') THEN
  RAISE EXCEPTION 'Closure history cannot be deleted or revived' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version','blocked_reasons','lease_id','lease_until','fence','updated_at','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','blocked_reasons','lease_id','lease_until','fence','updated_at','finished_at']) OR
    NEW.fence < OLD.fence OR
    (NEW.lease_id IS NOT NULL AND NEW.lease_id IS DISTINCT FROM OLD.lease_id AND NEW.fence<>OLD.fence+1) OR NEW.version NOT IN (OLD.version,OLD.version+1) OR
    (ROW(NEW.status,NEW.blocked_reasons,NEW.finished_at) IS DISTINCT FROM ROW(OLD.status,OLD.blocked_reasons,OLD.finished_at) AND NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION 'Closure identity and security snapshot are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER account_closure_requests_guard BEFORE UPDATE OR DELETE ON account_closure_requests FOR EACH ROW EXECUTE FUNCTION e07_account_closure_guard();
-- Within a backup containing the tombstone, even an ordinary maintenance UPDATE
-- cannot revive a closed principal. Older backups still require quarantine/latest ledger.
CREATE FUNCTION e07_closed_user_no_revive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='ACTIVE' AND EXISTS(SELECT 1 FROM account_closure_tombstones WHERE user_id=NEW.id) THEN
  RAISE EXCEPTION 'A closed principal cannot be reactivated' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER closed_user_no_revive BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION e07_closed_user_no_revive();
