-- R6TRAIN: adult fixed-course enrollment. Youth enrollment remains closed.
CREATE TABLE training_providers (
 org_id uuid PRIMARY KEY REFERENCES organizations(id), name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
 evidence_reference text NOT NULL CHECK(char_length(evidence_reference) BETWEEN 1 AND 120), qualified_until timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','SUSPENDED')),
 created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by), CHECK(status<>'APPROVED' OR reviewed_by IS NOT NULL)
);
CREATE TABLE training_coaches (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES training_providers(org_id), user_id uuid NOT NULL REFERENCES users(id),
 display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 80), evidence_reference text NOT NULL CHECK(char_length(evidence_reference) BETWEEN 1 AND 120),
 qualified_until timestamptz NOT NULL, consented boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','SUSPENDED')),
 created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(org_id,user_id), UNIQUE(org_id,id), CHECK(reviewed_by IS NULL OR reviewed_by NOT IN(created_by,user_id)),
 CHECK(status<>'APPROVED' OR (reviewed_by IS NOT NULL AND consented))
);
CREATE TABLE training_courses (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES training_providers(org_id), title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),
 description text NOT NULL CHECK(char_length(description)<=1000), adult_only boolean NOT NULL DEFAULT true CHECK(adult_only),
 created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(org_id,id)
);
CREATE TABLE training_cohorts (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, course_id uuid NOT NULL, court_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80), address text NOT NULL CHECK(char_length(address) BETWEEN 1 AND 200),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 35), total_fen integer NOT NULL CHECK(total_fen BETWEEN 0 AND 100000000),
 terms_id uuid NOT NULL, terms_text text NOT NULL CHECK(char_length(terms_text) BETWEEN 1 AND 2000),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ENROLLING','RUNNING','COMPLETED','CANCELLED','SUSPENDED')),
 enrollment_deadline timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(org_id,id),
 FOREIGN KEY(org_id,course_id) REFERENCES training_courses(org_id,id), FOREIGN KEY(org_id,court_id) REFERENCES courts(org_id,id)
);
CREATE TABLE training_sessions (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, cohort_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, buffer_minutes integer NOT NULL DEFAULT 15 CHECK(buffer_minutes BETWEEN 0 AND 120),
 price_weight integer NOT NULL CHECK(price_weight BETWEEN 0 AND 100000000),
 state text NOT NULL DEFAULT 'SCHEDULED' CHECK(state IN('SCHEDULED','DELIVERED','CANCELLED')),
 delivered_by uuid REFERENCES users(id), delivery_note text CHECK(char_length(delivery_note)<=1000), delivered_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(org_id,id), UNIQUE(cohort_id,id),
 FOREIGN KEY(org_id,cohort_id) REFERENCES training_cohorts(org_id,id),
 CHECK(isfinite(starts_at) AND isfinite(ends_at) AND ends_at>starts_at AND ends_at<=starts_at+interval '8 hours'),
 CHECK(state<>'DELIVERED' OR (delivered_by IS NOT NULL AND delivered_at IS NOT NULL))
);
CREATE TABLE training_session_coaches (
 session_id uuid NOT NULL, org_id uuid NOT NULL, coach_id uuid NOT NULL,
 PRIMARY KEY(session_id,coach_id), FOREIGN KEY(org_id,session_id) REFERENCES training_sessions(org_id,id), FOREIGN KEY(org_id,coach_id) REFERENCES training_coaches(org_id,id)
);
CREATE TABLE training_resource_reservations (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, session_id uuid NOT NULL,
 resource_key text NOT NULL CHECK(resource_key ~ '^(court|user):[0-9a-f-]{36}$'), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 active boolean NOT NULL DEFAULT true, FOREIGN KEY(org_id,session_id) REFERENCES training_sessions(org_id,id),
 CHECK(ends_at>starts_at),
 EXCLUDE USING gist(resource_key WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active)
);
CREATE UNIQUE INDEX training_active_reservation ON training_resource_reservations(session_id,resource_key) WHERE active;
CREATE TABLE training_enrollments (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, cohort_id uuid NOT NULL,
 applicant_user_id uuid NOT NULL REFERENCES users(id), payer_user_id uuid NOT NULL REFERENCES users(id), learner_user_id uuid NOT NULL REFERENCES users(id),
 adult_confirmed boolean NOT NULL CHECK(adult_confirmed), terms_id uuid NOT NULL, terms_snapshot jsonb NOT NULL CHECK(jsonb_typeof(terms_snapshot)='object'),
 total_fen integer NOT NULL CHECK(total_fen>=0), trade_order_id uuid REFERENCES trade_orders(id),
 state text NOT NULL CHECK(state IN('WAITLISTED','HOLDING','CONFIRMED','EXPIRED','PAID_UNALLOCATED','CANCELLED','COMPLETED')),
 hold_expires_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,cohort_id) REFERENCES training_cohorts(org_id,id), UNIQUE(org_id,id),
 CHECK(state<>'HOLDING' OR hold_expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX training_enrollment_active ON training_enrollments(cohort_id,learner_user_id) WHERE state IN('WAITLISTED','HOLDING','CONFIRMED','PAID_UNALLOCATED');
ALTER TABLE training_resource_reservations ADD COLUMN enrollment_id uuid;
ALTER TABLE training_resource_reservations ADD FOREIGN KEY(org_id,enrollment_id) REFERENCES training_enrollments(org_id,id);
CREATE INDEX training_enrollment_seats ON training_enrollments(cohort_id,state,hold_expires_at);
CREATE TABLE training_lesson_entitlements (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, enrollment_id uuid NOT NULL, original_session_id uuid NOT NULL, current_session_id uuid NOT NULL,
 net_fen integer NOT NULL CHECK(net_fen>=0), state text NOT NULL DEFAULT 'AVAILABLE' CHECK(state IN('AVAILABLE','MAKEUP_DUE','CONSUMPTION_PENDING','CONSUMED','REFUND_PENDING','REFUNDED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), FOREIGN KEY(org_id,enrollment_id) REFERENCES training_enrollments(org_id,id),
 FOREIGN KEY(org_id,original_session_id) REFERENCES training_sessions(org_id,id), FOREIGN KEY(org_id,current_session_id) REFERENCES training_sessions(org_id,id),
 UNIQUE(enrollment_id,original_session_id), UNIQUE(org_id,id)
);
CREATE TABLE training_attendance (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, entitlement_id uuid NOT NULL, session_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('CHECKIN','CHECKOUT')), actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,entitlement_id) REFERENCES training_lesson_entitlements(org_id,id), FOREIGN KEY(org_id,session_id) REFERENCES training_sessions(org_id,id),
 UNIQUE(entitlement_id,session_id,action)
);
CREATE TABLE training_consumptions (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, entitlement_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN('PROPOSED','REVIEWED','FINALIZED','DISPUTED','REJECTED','ADJUSTED')),
 proposed_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id), acknowledged_by uuid REFERENCES users(id),
 finalization_reason text CHECK(finalization_reason IN('USER_CONFIRMED','INDEPENDENT_RESOLUTION')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 1000), dispute_reason text CHECK(char_length(dispute_reason)<=1000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,entitlement_id) REFERENCES training_lesson_entitlements(org_id,id), UNIQUE(org_id,id),
 CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),
 CHECK(status NOT IN('REVIEWED','FINALIZED') OR reviewed_by IS NOT NULL)
);
CREATE UNIQUE INDEX training_one_consumption ON training_consumptions(entitlement_id) WHERE status NOT IN('REJECTED','ADJUSTED');
CREATE TABLE training_refund_allocations (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, enrollment_id uuid NOT NULL, entitlement_ids uuid[] NOT NULL CHECK(cardinality(entitlement_ids) BETWEEN 1 AND 8),
 amount_fen integer NOT NULL CHECK(amount_fen>=0), proposed_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN('PENDING_REVIEW','PENDING','SUCCEEDED','FAILED','UNKNOWN','REJECTED','COMPLETED_ZERO')),
 trade_refund_id uuid REFERENCES trade_refunds(id), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,enrollment_id) REFERENCES training_enrollments(org_id,id), CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by)
);
CREATE TABLE training_guardian_grants (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES training_providers(org_id), learner_user_id uuid NOT NULL REFERENCES users(id), guardian_user_id uuid NOT NULL REFERENCES users(id),
 cohort_id uuid NOT NULL, policy_version text NOT NULL CHECK(char_length(policy_version) BETWEEN 1 AND 80),
 purpose text NOT NULL CHECK(purpose IN('PARTICIPATION','NECESSARY_DATA','PICKUP','PUBLICITY')),
 FOREIGN KEY(org_id,cohort_id) REFERENCES training_cohorts(org_id,id),
 evidence_reference text NOT NULL, reviewed_by uuid REFERENCES users(id), valid_until timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','APPROVED','REVOKED','REJECTED')),
 epoch integer NOT NULL DEFAULT 1 CHECK(epoch>0), CHECK(learner_user_id<>guardian_user_id), CHECK(reviewed_by IS NULL OR reviewed_by NOT IN(learner_user_id,guardian_user_id)),
 CHECK(state<>'APPROVED' OR reviewed_by IS NOT NULL)
);
CREATE TABLE training_command_receipts (
 actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL, request_hash char(64) NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE training_audit_events (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid NOT NULL REFERENCES users(id), resource_id uuid NOT NULL,
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION r6_training_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Training history is append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER training_receipts_immutable BEFORE UPDATE OR DELETE ON training_command_receipts FOR EACH ROW EXECUTE FUNCTION r6_training_append_only();
CREATE TRIGGER training_audit_immutable BEFORE UPDATE OR DELETE ON training_audit_events FOR EACH ROW EXECUTE FUNCTION r6_training_append_only();
CREATE TRIGGER training_attendance_immutable BEFORE UPDATE OR DELETE ON training_attendance FOR EACH ROW EXECUTE FUNCTION r6_training_append_only();
CREATE FUNCTION r6_training_quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.org_id,NEW.cohort_id,NEW.applicant_user_id,NEW.payer_user_id,NEW.learner_user_id,NEW.terms_id,NEW.terms_snapshot,NEW.total_fen) IS DISTINCT FROM
 (OLD.org_id,OLD.cohort_id,OLD.applicant_user_id,OLD.payer_user_id,OLD.learner_user_id,OLD.terms_id,OLD.terms_snapshot,OLD.total_fen)
 THEN RAISE EXCEPTION 'Training enrollment quote is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.trade_order_id IS NOT NULL AND NEW.trade_order_id IS DISTINCT FROM OLD.trade_order_id THEN RAISE EXCEPTION 'Training financial source is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.trade_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM trade_orders o WHERE o.id=NEW.trade_order_id AND o.kind='TRAINING_ENROLLMENT' AND o.source_id=NEW.id AND o.org_id=NEW.org_id AND o.payer_user_id=NEW.payer_user_id AND o.total_fen=NEW.total_fen) THEN
 RAISE EXCEPTION 'Training charge must reference its canonical order' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER training_quote_immutable BEFORE UPDATE ON training_enrollments FOR EACH ROW EXECUTE FUNCTION r6_training_quote_guard();
CREATE FUNCTION r6_training_calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE rid uuid; BEGIN
 PERFORM x12_calendar_lock(); IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NOT NEW.active THEN RETURN NEW; END IF; rid:=split_part(NEW.resource_key,':',2)::uuid;
 IF EXISTS(SELECT 1 FROM local_resource_reservations WHERE active AND resource_key=NEW.resource_key AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Training conflicts with local service' USING ERRCODE='23P01'; END IF;
 IF NEW.resource_key LIKE 'court:%' AND EXISTS(SELECT 1 FROM court_reservations WHERE court_id=rid AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Training conflicts with court' USING ERRCODE='23P01'; END IF;
 IF NEW.resource_key LIKE 'user:%' AND EXISTS(SELECT 1 FROM booking_appearances WHERE player_user_id=rid AND status IN('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND NOT(status='REQUESTED' AND expires_at<=clock_timestamp()) AND c06_booking_window(report_at,end_at) && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Training conflicts with player' USING ERRCODE='23P01'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER training_calendar_guard BEFORE INSERT OR UPDATE OR DELETE ON training_resource_reservations FOR EACH ROW EXECUTE FUNCTION r6_training_calendar_guard();

CREATE FUNCTION r6_training_entitlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.org_id,NEW.enrollment_id,NEW.original_session_id,NEW.net_fen) IS DISTINCT FROM (OLD.org_id,OLD.enrollment_id,OLD.original_session_id,OLD.net_fen) THEN
 RAISE EXCEPTION 'Original lesson allocation is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER training_entitlement_quote_immutable BEFORE UPDATE ON training_lesson_entitlements FOR EACH ROW EXECUTE FUNCTION r6_training_entitlement_guard();
CREATE FUNCTION r6_training_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.org_id,NEW.enrollment_id,NEW.entitlement_ids,NEW.amount_fen,NEW.proposed_by,NEW.reason) IS DISTINCT FROM (OLD.org_id,OLD.enrollment_id,OLD.entitlement_ids,OLD.amount_fen,OLD.proposed_by,OLD.reason)
 OR (OLD.trade_refund_id IS NOT NULL AND NEW.trade_refund_id IS DISTINCT FROM OLD.trade_refund_id) THEN RAISE EXCEPTION 'Refund allocation intent is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.trade_refund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM trade_refunds r JOIN trade_orders o ON o.id=r.order_id WHERE r.id=NEW.trade_refund_id AND o.kind='TRAINING_ENROLLMENT' AND o.source_id=NEW.enrollment_id AND o.org_id=NEW.org_id AND r.amount_fen=NEW.amount_fen) THEN
 RAISE EXCEPTION 'Training allocation must reference its canonical refund' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER training_refund_intent_immutable BEFORE UPDATE ON training_refund_allocations FOR EACH ROW EXECUTE FUNCTION r6_training_refund_guard();
