-- X12: non-payment local supply, bounded reservations and bilateral team meetups.
-- A conservative shared calendar write mutex serializes old/new reservation writers.
-- API order: actor/organizations -> all org_schedule_mutex rows ordered by UUID
-- -> x12 calendar mutex -> local rows. Never acquire a new org mutex after calendar.
CREATE TABLE local_listings (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id),
 provider_user_id uuid NOT NULL REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('COURT','REFEREE','SCORER','RECORDER','STREAMER','PHOTOGRAPHER','MEDIC')),
 court_id uuid, title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 100),
 description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 1000),
 address text NOT NULL CHECK(char_length(address) BETWEEN 1 AND 200),
 region_catalog_version text NOT NULL, region_id uuid NOT NULL, coverage_region_ids uuid[] NOT NULL CHECK(cardinality(coverage_region_ids) BETWEEN 1 AND 20),
 latitude double precision CHECK(latitude BETWEEN -90 AND 90), longitude double precision CHECK(longitude BETWEEN -180 AND 180),
 qualification_note text NOT NULL CHECK(char_length(qualification_note) BETWEEN 4 AND 1000),
 terms text NOT NULL CHECK(char_length(terms) BETWEEN 4 AND 1000), provider_confirmed boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','SUSPENDED')),
 published boolean NOT NULL DEFAULT false, qualified_until timestamptz,
 reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id), FOREIGN KEY(org_id,court_id) REFERENCES courts(org_id,id),
 FOREIGN KEY(region_catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id),
 CHECK((latitude IS NULL)=(longitude IS NULL)), CHECK((kind='COURT')=(court_id IS NOT NULL)),
 CHECK(NOT published OR (status='APPROVED' AND provider_confirmed AND reviewed_by IS NOT NULL)),
 CHECK(status NOT IN ('APPROVED','REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>provider_user_id AND reviewed_by<>created_by)),
 CHECK(status<>'APPROVED' OR (qualified_until IS NOT NULL AND qualified_until>reviewed_at))
);
CREATE INDEX local_listings_public ON local_listings(status,published,id);
CREATE INDEX local_listings_provider ON local_listings(provider_user_id,id);
CREATE TABLE local_slots (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, listing_id uuid NOT NULL,
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')), reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,listing_id,id), FOREIGN KEY(org_id,listing_id) REFERENCES local_listings(org_id,id)
);
CREATE INDEX local_slots_listing ON local_slots(listing_id,starts_at,id);
CREATE TABLE local_bookings (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, listing_id uuid NOT NULL, slot_id uuid NOT NULL,
 buyer_user_id uuid NOT NULL REFERENCES users(id), provider_user_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN ('HELD','REQUESTED','CONFIRMED','ARRIVED','DELIVERED','COMPLETED','DECLINED','CANCELLED','EXPIRED','DISPUTED')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at), hold_expires_at timestamptz,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), change_request jsonb CHECK(change_request IS NULL OR jsonb_typeof(change_request)='object'),
 reason text, version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,listing_id,slot_id) REFERENCES local_slots(org_id,listing_id,id),
 CHECK(buyer_user_id<>provider_user_id), CHECK(status NOT IN ('HELD','REQUESTED') OR hold_expires_at IS NOT NULL)
);
CREATE INDEX local_bookings_people ON local_bookings(buyer_user_id,provider_user_id,created_at DESC,id);
CREATE TABLE local_matchups (
 id uuid PRIMARY KEY, home_org_id uuid NOT NULL, home_team_id uuid NOT NULL, away_org_id uuid NOT NULL, away_team_id uuid NOT NULL,
 court_booking_id uuid NOT NULL REFERENCES local_bookings(id), created_by uuid NOT NULL REFERENCES users(id),
 home_confirmed_by uuid NOT NULL REFERENCES users(id), away_confirmed_by uuid REFERENCES users(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 expires_at timestamptz NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CONFIRMED','DECLINED','CANCELLED','COMPLETED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(home_org_id,home_team_id) REFERENCES teams(org_id,id), FOREIGN KEY(away_org_id,away_team_id) REFERENCES teams(org_id,id),
 CHECK(home_team_id<>away_team_id), CHECK(away_confirmed_by IS NULL OR away_confirmed_by<>home_confirmed_by),
 CHECK(status NOT IN ('CONFIRMED','COMPLETED') OR away_confirmed_by IS NOT NULL)
);
CREATE INDEX local_matchups_teams ON local_matchups(home_team_id,away_team_id,created_at DESC,id);
CREATE TABLE local_resource_reservations (
 id uuid PRIMARY KEY, resource_key text NOT NULL CHECK(resource_key ~ '^(court|user|team):[0-9a-f-]{36}$'),
 booking_id uuid REFERENCES local_bookings(id), matchup_id uuid REFERENCES local_matchups(id),
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((booking_id IS NULL)<>(matchup_id IS NULL)),
 EXCLUDE USING gist(resource_key WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active)
);
CREATE INDEX local_resource_booking ON local_resource_reservations(booking_id) WHERE active;
CREATE INDEX local_resource_matchup ON local_resource_reservations(matchup_id) WHERE active;
CREATE TABLE local_command_receipts (
 actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL, request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE local_service_history (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), resource_id uuid NOT NULL,
 action text NOT NULL, version integer NOT NULL CHECK(version>0), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION x12_calendar_lock() RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(20261031,12029); $$;
CREATE FUNCTION x12_release_expired() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM x12_calendar_lock();
 UPDATE local_resource_reservations r SET active=false WHERE r.active AND (
  EXISTS(SELECT 1 FROM local_bookings b WHERE b.id=r.booking_id AND b.status IN ('HELD','REQUESTED') AND b.hold_expires_at<=clock_timestamp())
  OR EXISTS(SELECT 1 FROM local_matchups m WHERE m.id=r.matchup_id AND m.status='OPEN' AND m.expires_at<=clock_timestamp())
 );
END; $$;

CREATE FUNCTION x12_local_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER local_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON local_resource_reservations FOR EACH ROW EXECUTE FUNCTION x12_local_reservation_guard();

CREATE FUNCTION x12_existing_calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF EXISTS(SELECT 1 FROM local_resource_reservations WHERE active AND resource_key=k AND tstzrange(starts_at,ends_at,'[)') && tstzrange(s,e,'[)')) THEN
  RAISE EXCEPTION 'Existing reservation conflicts with local service or matchup' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER x12_court_calendar BEFORE INSERT OR UPDATE OR DELETE ON court_reservations FOR EACH ROW EXECUTE FUNCTION x12_existing_calendar_guard();
CREATE TRIGGER x12_team_calendar BEFORE INSERT OR UPDATE OR DELETE ON team_reservations FOR EACH ROW EXECUTE FUNCTION x12_existing_calendar_guard();
CREATE TRIGGER x12_player_calendar BEFORE INSERT OR UPDATE OR DELETE ON booking_appearances FOR EACH ROW EXECUTE FUNCTION x12_existing_calendar_guard();

CREATE FUNCTION x12_local_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Local service history is retained' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN ('local_command_receipts','local_service_history') THEN
  RAISE EXCEPTION 'Local receipts and history are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Local changes require immutable identity and next version' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='local_listings' THEN
  IF (NEW.org_id<>OLD.org_id OR NEW.provider_user_id<>OLD.provider_user_id OR NEW.created_by<>OLD.created_by OR NEW.kind<>OLD.kind OR NEW.court_id IS DISTINCT FROM OLD.court_id OR NEW.region_catalog_version<>OLD.region_catalog_version OR NEW.region_id<>OLD.region_id) THEN
  RAISE EXCEPTION 'Supply identity and scope are immutable' USING ERRCODE='23514';
 END IF;
 ELSIF TG_TABLE_NAME='local_slots' THEN
  IF (NEW.org_id<>OLD.org_id OR NEW.listing_id<>OLD.listing_id OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR OLD.status='CLOSED') THEN
  RAISE EXCEPTION 'Slot identity/time is immutable and closure permanent' USING ERRCODE='23514';
 END IF;
 ELSIF TG_TABLE_NAME='local_bookings' THEN
  IF (NEW.org_id<>OLD.org_id OR NEW.listing_id<>OLD.listing_id OR NEW.buyer_user_id<>OLD.buyer_user_id OR NEW.provider_user_id<>OLD.provider_user_id OR NEW.snapshot<>OLD.snapshot OR OLD.status IN ('COMPLETED','DECLINED','CANCELLED','EXPIRED')) THEN
  RAISE EXCEPTION 'Booking identity, snapshot and terminal history are immutable' USING ERRCODE='23514';
 END IF;
 ELSIF TG_TABLE_NAME='local_matchups' THEN
  IF (NEW.home_org_id<>OLD.home_org_id OR NEW.home_team_id<>OLD.home_team_id OR NEW.away_org_id<>OLD.away_org_id OR NEW.away_team_id<>OLD.away_team_id OR NEW.court_booking_id<>OLD.court_booking_id OR NEW.created_by<>OLD.created_by OR NEW.home_confirmed_by<>OLD.home_confirmed_by OR NEW.snapshot<>OLD.snapshot OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR NEW.expires_at<>OLD.expires_at OR OLD.status IN ('COMPLETED','DECLINED','CANCELLED')) THEN
  RAISE EXCEPTION 'Matchup identity, snapshot and terminal history are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER local_listing_history BEFORE UPDATE OR DELETE ON local_listings FOR EACH ROW EXECUTE FUNCTION x12_local_row_guard();
CREATE TRIGGER local_slot_history BEFORE UPDATE OR DELETE ON local_slots FOR EACH ROW EXECUTE FUNCTION x12_local_row_guard();
CREATE TRIGGER local_booking_history BEFORE UPDATE OR DELETE ON local_bookings FOR EACH ROW EXECUTE FUNCTION x12_local_row_guard();
CREATE TRIGGER local_matchup_history BEFORE UPDATE OR DELETE ON local_matchups FOR EACH ROW EXECUTE FUNCTION x12_local_row_guard();
CREATE TRIGGER local_receipt_history BEFORE UPDATE OR DELETE ON local_command_receipts FOR EACH ROW EXECUTE FUNCTION x12_local_row_guard();
CREATE TRIGGER local_audit_history BEFORE UPDATE OR DELETE ON local_service_history FOR EACH ROW EXECUTE FUNCTION x12_local_row_guard();
