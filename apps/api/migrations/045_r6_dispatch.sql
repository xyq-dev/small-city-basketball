-- R6DISPATCH: bounded invitations, independently verified quotes, atomic person holds.
CREATE TABLE dispatch_preferences (
 provider_user_id uuid PRIMARY KEY REFERENCES users(id), enabled boolean NOT NULL,
 region_ids uuid[] NOT NULL CHECK(cardinality(region_ids) BETWEEN 1 AND 20), daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 1 AND 9),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE dispatch_requests (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), owner_user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('REFEREE','SCORER','RECORDER','STREAMER','PHOTOGRAPHER')),
 region_catalog_version text NOT NULL, service_region_id uuid NOT NULL, service_address text NOT NULL CHECK(char_length(service_address) BETWEEN 4 AND 200), service_point jsonb,
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at<starts_at),
 budget jsonb NOT NULL CHECK(jsonb_typeof(budget)='object'), invite_region_ids uuid[] NOT NULL CHECK(cardinality(invite_region_ids) BETWEEN 1 AND 20),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','INVITING','PAUSED','REVIEWING','NEEDS_MANUAL','SOURCE_REQUESTED','SOURCE_CONFIRMED','SOURCE_ENDED','CANCELLED','EXPIRED')),
 allow_cross_city boolean NOT NULL CHECK(allow_cross_city), people integer NOT NULL DEFAULT 1 CHECK(people=1),
 batch_count integer NOT NULL DEFAULT 0 CHECK(batch_count BETWEEN 0 AND 3), batch_size integer NOT NULL DEFAULT 3 CHECK(batch_size BETWEEN 1 AND 3), max_batches integer NOT NULL DEFAULT 3 CHECK(max_batches BETWEEN 1 AND 3),
 next_batch_at timestamptz, next_source_check_at timestamptz CHECK(next_source_check_at IS NULL OR isfinite(next_source_check_at)), winner_offer_id uuid, source_booking_id uuid UNIQUE REFERENCES local_bookings(id), reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id), FOREIGN KEY(region_catalog_version,service_region_id) REFERENCES region_catalog_nodes(catalog_version,region_id)
);
CREATE INDEX dispatch_requests_owner ON dispatch_requests(owner_user_id,created_at DESC,id);
CREATE INDEX dispatch_requests_due ON dispatch_requests(next_batch_at,id) WHERE status='INVITING';
CREATE INDEX dispatch_requests_source_due ON dispatch_requests((COALESCE(next_source_check_at,created_at)),id) WHERE source_booking_id IS NOT NULL AND status IN ('SOURCE_REQUESTED','SOURCE_CONFIRMED');
CREATE TABLE dispatch_batches (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES dispatch_requests(id), batch_no integer NOT NULL CHECK(batch_no BETWEEN 1 AND 3),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(request_id,batch_no), UNIQUE(request_id,id)
);
CREATE TABLE dispatch_offers (
 id uuid PRIMARY KEY, request_id uuid NOT NULL, batch_id uuid NOT NULL, provider_user_id uuid NOT NULL REFERENCES users(id), listing_id uuid NOT NULL REFERENCES local_listings(id),
 listing_version integer NOT NULL CHECK(listing_version>0), status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','TRAVEL_REVIEW','READY','ACCEPTED_HELD','CONVERTED','DECLINED','WITHDRAWN','EXPIRED','SUPERSEDED')),
 expires_at timestamptz NOT NULL, quote jsonb, quote_hash char(64) CHECK(quote_hash ~ '^[0-9a-f]{64}$'),
 travel_verified_by uuid REFERENCES users(id), travel_verified_at timestamptz, hold_expires_at timestamptz,
 source_booking_id uuid UNIQUE REFERENCES local_bookings(id), reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(request_id,batch_id) REFERENCES dispatch_batches(request_id,id), UNIQUE(request_id,id), UNIQUE(batch_id,provider_user_id), UNIQUE(request_id,provider_user_id),
 CHECK((quote IS NULL)=(quote_hash IS NULL)), CHECK(quote IS NULL OR (jsonb_typeof(quote)='object' AND quote ? 'hash' AND quote->>'hash'=quote_hash)),
 CHECK((travel_verified_by IS NULL)=(travel_verified_at IS NULL)), CHECK(travel_verified_by IS NULL OR travel_verified_by<>provider_user_id),
 CHECK(status NOT IN ('READY','ACCEPTED_HELD','CONVERTED') OR (quote IS NOT NULL AND travel_verified_by IS NOT NULL)),
 CHECK(status<>'ACCEPTED_HELD' OR (hold_expires_at IS NOT NULL AND isfinite(hold_expires_at) AND hold_expires_at<=expires_at)),
 CHECK((status='CONVERTED')=(source_booking_id IS NOT NULL))
);
ALTER TABLE dispatch_requests ADD FOREIGN KEY(id,winner_offer_id) REFERENCES dispatch_offers(request_id,id);
CREATE INDEX dispatch_offers_provider ON dispatch_offers(provider_user_id,created_at DESC,id);
CREATE UNIQUE INDEX dispatch_one_winner ON dispatch_offers(request_id) WHERE status='ACCEPTED_HELD';
CREATE TABLE dispatch_holds (
 id uuid PRIMARY KEY, request_id uuid NOT NULL, offer_id uuid NOT NULL UNIQUE, provider_user_id uuid NOT NULL REFERENCES users(id),
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at AND ends_at<=starts_at+interval '7 days 30 minutes'), expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at<=starts_at),
 state text NOT NULL CHECK(state IN ('ACTIVE','CONVERTED','RELEASED')), source_booking_id uuid UNIQUE REFERENCES local_bookings(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK((state='CONVERTED')=(source_booking_id IS NOT NULL)), FOREIGN KEY(request_id,offer_id) REFERENCES dispatch_offers(request_id,id)
);
CREATE UNIQUE INDEX dispatch_one_hold ON dispatch_holds(request_id) WHERE state='ACTIVE';
ALTER TABLE local_resource_reservations ADD COLUMN dispatch_offer_id uuid REFERENCES dispatch_offers(id);
-- 029's cross-column ends_at check is named _check; its owner XOR is _check1.
-- Preserve finite ordered bounds while replacing only the two-source owner rule.
ALTER TABLE local_resource_reservations DROP CONSTRAINT local_resource_reservations_check1;
ALTER TABLE local_resource_reservations ADD CONSTRAINT local_resource_owner CHECK(num_nonnulls(booking_id,matchup_id,dispatch_offer_id)=1);
CREATE INDEX local_resource_dispatch ON local_resource_reservations(dispatch_offer_id) WHERE active;
CREATE TABLE dispatch_command_receipts (
 actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL, request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'), result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE dispatch_events (
 id uuid PRIMARY KEY, request_id uuid REFERENCES dispatch_requests(id), offer_id uuid REFERENCES dispatch_offers(id), actor_id uuid REFERENCES users(id),
 action text NOT NULL, reason text NOT NULL, version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION r6_dispatch_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME IN ('dispatch_command_receipts','dispatch_events','dispatch_batches') THEN RAISE EXCEPTION 'Dispatch evidence is retained' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='dispatch_preferences' THEN
  IF NEW.provider_user_id<>OLD.provider_user_id OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Dispatch preference version conflict' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='dispatch_requests' THEN
  IF (to_jsonb(NEW)-ARRAY['status','batch_count','next_batch_at','next_source_check_at','winner_offer_id','source_booking_id','reason','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','batch_count','next_batch_at','next_source_check_at','winner_offer_id','source_booking_id','reason','version','updated_at']) OR NEW.version<>OLD.version+1 OR (OLD.source_booking_id IS NOT NULL AND NEW.source_booking_id IS DISTINCT FROM OLD.source_booking_id) THEN RAISE EXCEPTION 'Dispatch request identity/terms are immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='dispatch_offers' THEN
  IF (to_jsonb(NEW)-ARRAY['status','quote','quote_hash','travel_verified_by','travel_verified_at','hold_expires_at','source_booking_id','reason','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','quote','quote_hash','travel_verified_by','travel_verified_at','hold_expires_at','source_booking_id','reason','version','updated_at']) OR NEW.version<>OLD.version+1 OR (OLD.quote IS NOT NULL AND (NEW.quote IS DISTINCT FROM OLD.quote OR NEW.quote_hash IS DISTINCT FROM OLD.quote_hash)) OR (OLD.travel_verified_by IS NOT NULL AND (NEW.travel_verified_by IS DISTINCT FROM OLD.travel_verified_by OR NEW.travel_verified_at IS DISTINCT FROM OLD.travel_verified_at)) OR (OLD.hold_expires_at IS NOT NULL AND NEW.hold_expires_at IS DISTINCT FROM OLD.hold_expires_at) OR (OLD.source_booking_id IS NOT NULL AND NEW.source_booking_id IS DISTINCT FROM OLD.source_booking_id) THEN RAISE EXCEPTION 'Dispatch offer identity/quote is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='dispatch_holds' THEN
  IF (to_jsonb(NEW)-ARRAY['state','source_booking_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','source_booking_id']) OR OLD.state<>'ACTIVE' OR NEW.state='ACTIVE' THEN RAISE EXCEPTION 'Dispatch hold release is permanent' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER dispatch_preference_history BEFORE UPDATE OR DELETE ON dispatch_preferences FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
CREATE TRIGGER dispatch_request_history BEFORE UPDATE OR DELETE ON dispatch_requests FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
CREATE TRIGGER dispatch_offer_history BEFORE UPDATE OR DELETE ON dispatch_offers FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
CREATE TRIGGER dispatch_hold_history BEFORE UPDATE OR DELETE ON dispatch_holds FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
CREATE TRIGGER dispatch_batch_history BEFORE UPDATE OR DELETE ON dispatch_batches FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
CREATE TRIGGER dispatch_receipt_history BEFORE UPDATE OR DELETE ON dispatch_command_receipts FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
CREATE TRIGGER dispatch_event_history BEFORE UPDATE OR DELETE ON dispatch_events FOR EACH ROW EXECUTE FUNCTION r6_dispatch_history_guard();
