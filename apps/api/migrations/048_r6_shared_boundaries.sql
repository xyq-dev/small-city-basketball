-- R6 common ledger and shared calendar boundaries. Earlier migration checksums stay frozen.
ALTER TABLE trade_orders DROP CONSTRAINT trade_orders_kind_check;
ALTER TABLE trade_orders ADD CONSTRAINT trade_orders_kind_check CHECK(kind IN
 ('ENTRY_FEE','ENTRY_DEPOSIT','LOCAL_BOOKING','PLAYER_APPEARANCE','TRAINING_ENROLLMENT','SPONSOR_ORDER'));
CREATE TABLE r6_trade_refund_bindings (
 kind text NOT NULL CHECK(kind IN('TRAINING_ENROLLMENT','SPONSOR_ORDER')),
 source_id uuid NOT NULL,allocation_id uuid NOT NULL,
 order_id uuid NOT NULL REFERENCES trade_orders(id),refund_id uuid NOT NULL UNIQUE REFERENCES trade_refunds(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(kind,source_id,allocation_id)
);
CREATE FUNCTION r6_refund_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Domain refund allocation is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER r6_refund_binding_history BEFORE UPDATE OR DELETE ON r6_trade_refund_bindings
 FOR EACH ROW EXECUTE FUNCTION r6_refund_binding_immutable();

CREATE OR REPLACE FUNCTION x12_release_expired() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM x12_calendar_lock();
 UPDATE local_resource_reservations r SET active=false WHERE r.active AND (
  EXISTS(SELECT 1 FROM local_bookings b WHERE b.id=r.booking_id AND b.status IN ('HELD','REQUESTED') AND b.hold_expires_at<=clock_timestamp())
  OR EXISTS(SELECT 1 FROM dispatch_offers d WHERE d.id=r.dispatch_offer_id AND (d.status<>'ACCEPTED_HELD' OR d.hold_expires_at<=clock_timestamp()))
  OR EXISTS(SELECT 1 FROM local_matchups m WHERE m.id=r.matchup_id AND m.status='OPEN' AND m.expires_at<=clock_timestamp())
 );
 UPDATE training_resource_reservations r SET active=false WHERE r.active AND r.enrollment_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM training_enrollments n WHERE n.id=r.enrollment_id AND n.state='HOLDING' AND n.hold_expires_at<=clock_timestamp());
END; $$;

CREATE OR REPLACE FUNCTION x12_local_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Local reservation history cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM x12_calendar_lock();
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') OR (NOT OLD.active AND NEW.active) THEN
   RAISE EXCEPTION 'Reservation identity is immutable; release is permanent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT NEW.active THEN RAISE EXCEPTION 'New reservation must be active' USING ERRCODE='23514'; END IF;
 PERFORM x12_release_expired();
 IF EXISTS(SELECT 1 FROM training_resource_reservations WHERE active AND resource_key=NEW.resource_key AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Local service conflicts with training' USING ERRCODE='23P01';
 END IF;
 rid:=split_part(NEW.resource_key,':',2)::uuid;
 IF NEW.resource_key LIKE 'court:%' AND EXISTS(SELECT 1 FROM court_reservations WHERE court_id=rid AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Court conflicts with published match' USING ERRCODE='23P01';
 END IF;
 IF NEW.resource_key LIKE 'team:%' AND EXISTS(SELECT 1 FROM team_reservations WHERE team_id=rid AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Team conflicts with published match' USING ERRCODE='23P01';
 END IF;
 IF NEW.resource_key LIKE 'user:%' AND EXISTS(SELECT 1 FROM booking_appearances WHERE player_user_id=rid AND status IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND NOT (status='REQUESTED' AND expires_at<=clock_timestamp()) AND c06_booking_window(report_at,end_at) && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Person conflicts with player service' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION x12_existing_calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; s timestamptz; e timestamptz;
BEGIN
 PERFORM x12_calendar_lock();
 PERFORM x12_release_expired();
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='court_reservations' THEN k:='court:'||NEW.court_id; s:=NEW.starts_at; e:=NEW.ends_at;
 ELSIF TG_TABLE_NAME='team_reservations' THEN k:='team:'||NEW.team_id; s:=NEW.starts_at; e:=NEW.ends_at;
 ELSE
  IF NEW.status NOT IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') OR (NEW.status='REQUESTED' AND NEW.expires_at<=clock_timestamp()) THEN RETURN NEW; END IF;
  k:='user:'||NEW.player_user_id; s:=NEW.report_at; e:=NEW.end_at+interval '30 minutes';
 END IF;
 IF EXISTS(SELECT 1 FROM training_resource_reservations WHERE active AND resource_key=k AND tstzrange(starts_at,ends_at,'[)') && tstzrange(s,e,'[)')) THEN
  RAISE EXCEPTION 'Existing reservation conflicts with training' USING ERRCODE='23P01';
 END IF;
 IF EXISTS(SELECT 1 FROM local_resource_reservations WHERE active AND resource_key=k AND tstzrange(starts_at,ends_at,'[)') && tstzrange(s,e,'[)')) THEN
  RAISE EXCEPTION 'Existing reservation conflicts with local service or matchup' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION r6_training_calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE rid uuid; BEGIN
 PERFORM x12_calendar_lock(); IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Training reservation history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') OR (NOT OLD.active AND NEW.active)) THEN RAISE EXCEPTION 'Training reservation identity is immutable' USING ERRCODE='23514'; END IF;
 IF NOT NEW.active THEN RETURN NEW; END IF; PERFORM x12_release_expired(); rid:=split_part(NEW.resource_key,':',2)::uuid;
 IF EXISTS(SELECT 1 FROM local_resource_reservations WHERE active AND resource_key=NEW.resource_key AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Training conflicts with local service' USING ERRCODE='23P01'; END IF;
 IF NEW.resource_key LIKE 'court:%' AND EXISTS(SELECT 1 FROM court_reservations WHERE court_id=rid AND tstzrange(starts_at,ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Training conflicts with court' USING ERRCODE='23P01'; END IF;
 IF NEW.resource_key LIKE 'user:%' AND EXISTS(SELECT 1 FROM booking_appearances WHERE player_user_id=rid AND status IN('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND NOT(status='REQUESTED' AND expires_at<=clock_timestamp()) AND c06_booking_window(report_at,end_at) && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
  RAISE EXCEPTION 'Training conflicts with player' USING ERRCODE='23P01'; END IF;
 RETURN NEW; END $$;
