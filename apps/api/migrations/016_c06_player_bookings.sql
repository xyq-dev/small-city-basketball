-- C06: independent player-service reservations. This schema deliberately has
-- no PAID/SETTLED values: marketplace payment onboarding is a separate scope.
CREATE TABLE booking_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  display_name text NOT NULL CHECK (display_name=btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80),
  position text NOT NULL CHECK (position IN ('PG','SG','SF','PF','C')),
  height_cm integer NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
  city text NOT NULL CHECK (city=btrim(city) AND char_length(city) BETWEEN 1 AND 80),
  bio text NOT NULL CHECK (bio=btrim(bio) AND char_length(bio)<=1000),
  price_fen integer NOT NULL CHECK (price_fen BETWEEN 1 AND 100000000),
  travel_fen integer NOT NULL DEFAULT 0 CHECK (travel_fen BETWEEN 0 AND 100000000),
  accommodation_fen integer NOT NULL DEFAULT 0 CHECK (accommodation_fen BETWEEN 0 AND 10000000),
  availability jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(availability)='array' AND jsonb_array_length(availability)<=60),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','DISABLED')),
  review_reason text CHECK (review_reason IS NULL OR (review_reason=btrim(review_reason) AND char_length(review_reason) BETWEEN 1 AND 500)),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id,user_id),
  CHECK ((reviewed_by IS NULL)=(reviewed_at IS NULL)),
  CHECK (reviewed_by IS NULL OR reviewed_by<>user_id),
  CHECK (status NOT IN ('APPROVED','REJECTED') OR reviewed_by IS NOT NULL)
);
CREATE INDEX booking_profiles_catalog ON booking_profiles(status,position,created_at DESC,id DESC);

CREATE TABLE booking_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  fee_bps integer NOT NULL DEFAULT 1000 CHECK (fee_bps BETWEEN 0 AND 10000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO booking_settings(id) VALUES(true);

CREATE TABLE booking_orders (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  team_id uuid NOT NULL,
  event_id uuid,
  event_name text NOT NULL CHECK (event_name=btrim(event_name) AND char_length(event_name) BETWEEN 1 AND 80),
  team_name text NOT NULL CHECK (team_name=btrim(team_name) AND char_length(team_name) BETWEEN 1 AND 80),
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL CHECK (scope IN ('SINGLE','MULTI','TOURNAMENT','SEASON','TIME_BLOCK')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  fee_bps integer NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
  settings_version integer NOT NULL CHECK (settings_version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id),
  FOREIGN KEY (org_id,event_id) REFERENCES events(org_id,id)
);
CREATE INDEX booking_orders_by_buyer ON booking_orders(buyer_user_id,created_at DESC,id DESC);
CREATE INDEX booking_orders_by_team ON booking_orders(org_id,team_id,created_at DESC,id DESC);

-- Explicit UTC arithmetic makes the fixed elapsed 30-minute travel buffer
-- independent of the session time zone and daylight-saving transitions.
CREATE FUNCTION c06_booking_window(timestamptz,timestamptz) RETURNS tstzrange
  LANGUAGE sql IMMUTABLE AS $$
  SELECT tstzrange($1,($2 AT TIME ZONE 'UTC'+interval '30 minutes') AT TIME ZONE 'UTC','[)');
$$;

CREATE TABLE booking_appearances (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES booking_orders(id),
  profile_id uuid NOT NULL,
  player_user_id uuid NOT NULL,
  match_id uuid REFERENCES published_matches(id),
  label text NOT NULL CHECK (label=btrim(label) AND char_length(label) BETWEEN 1 AND 80),
  condition_text text CHECK (condition_text IS NULL OR (condition_text=btrim(condition_text) AND char_length(condition_text) BETWEEN 1 AND 500)),
  status text NOT NULL CHECK (status IN ('CONDITIONAL','REQUESTED','ACCEPTED','DECLINED','CANCELLED','ARRIVED','COMPLETED','DISPUTED','EXPIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  report_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  venue text NOT NULL CHECK (venue=btrim(venue) AND char_length(venue) BETWEEN 1 AND 200),
  service_fen integer NOT NULL CHECK (service_fen BETWEEN 1 AND 100000000),
  travel_fen integer NOT NULL DEFAULT 0 CHECK (travel_fen BETWEEN 0 AND 100000000),
  accommodation_fen integer NOT NULL DEFAULT 0 CHECK (accommodation_fen BETWEEN 0 AND 10000000),
  rest_minutes integer NOT NULL DEFAULT 30 CHECK (rest_minutes=30),
  platform_fee_fen integer NOT NULL CHECK (platform_fee_fen BETWEEN 0 AND 100000000),
  total_fen integer NOT NULL CHECK (total_fen=service_fen+travel_fen+accommodation_fen+platform_fee_fen),
  payment_status text NOT NULL DEFAULT 'UNAVAILABLE' CHECK (payment_status='UNAVAILABLE'),
  settlement_status text NOT NULL DEFAULT 'BLOCKED' CHECK (settlement_status='BLOCKED'),
  expires_at timestamptz,
  accepted_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancellation_reason text CHECK (cancellation_reason IS NULL OR (cancellation_reason=btrim(cancellation_reason) AND char_length(cancellation_reason) BETWEEN 1 AND 500)),
  change_request jsonb CHECK (change_request IS NULL OR jsonb_typeof(change_request)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (profile_id,player_user_id) REFERENCES booking_profiles(id,user_id),
  CHECK ((report_at IS NULL AND start_at IS NULL AND end_at IS NULL) OR
    (report_at IS NOT NULL AND start_at IS NOT NULL AND end_at IS NOT NULL AND
     isfinite(report_at) AND isfinite(start_at) AND isfinite(end_at) AND report_at<=start_at AND start_at<end_at)),
  CHECK (status NOT IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED') OR report_at IS NOT NULL),
  CHECK (status<>'CONDITIONAL' OR condition_text IS NOT NULL),
  CHECK (status<>'REQUESTED' OR (expires_at IS NOT NULL AND expires_at>updated_at AND expires_at<=updated_at+interval '20 minutes')),
  CHECK (status NOT IN ('ACCEPTED','ARRIVED','COMPLETED') OR accepted_at IS NOT NULL),
  CHECK (status NOT IN ('ARRIVED','COMPLETED') OR arrived_at IS NOT NULL),
  CHECK (status<>'COMPLETED' OR completed_at IS NOT NULL),
  EXCLUDE USING gist (player_user_id WITH =,c06_booking_window(report_at,end_at) WITH &&)
    WHERE (status IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED'))
);
CREATE INDEX booking_appearances_by_order ON booking_appearances(order_id,created_at,id);
CREATE INDEX booking_appearances_by_player ON booking_appearances(player_user_id,created_at DESC,id DESC);
CREATE INDEX booking_appearances_expiry ON booking_appearances(expires_at) WHERE status='REQUESTED';

CREATE TABLE booking_operations (
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id,command_id)
);

CREATE FUNCTION c06_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Player history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1) THEN
    RAISE EXCEPTION 'Player identity is immutable and requires a new version' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('APPROVED','REJECTED') AND NOT EXISTS(
    SELECT 1 FROM platform_operators WHERE user_id=NEW.reviewed_by AND status='ACTIVE'
  ) THEN RAISE EXCEPTION 'Active independent reviewer required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_profiles_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_profiles FOR EACH ROW EXECUTE FUNCTION c06_profile_guard();

CREATE FUNCTION c06_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.version<>OLD.version+1 OR NEW.updated_by IS NULL OR NOT EXISTS(
    SELECT 1 FROM platform_operators WHERE user_id=NEW.updated_by AND status='ACTIVE'
  ) THEN RAISE EXCEPTION 'Versioned platform setting update required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_settings_guard BEFORE UPDATE OR DELETE ON booking_settings FOR EACH ROW EXECUTE FUNCTION c06_settings_guard();

CREATE FUNCTION c06_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings booking_settings%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Booking history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO settings FROM booking_settings WHERE id;
    IF NEW.version<>1 OR NEW.status<>'ACTIVE' OR NEW.fee_bps<>settings.fee_bps OR NEW.settings_version<>settings.version THEN
      RAISE EXCEPTION 'Current fee snapshot required' USING ERRCODE='23514';
    END IF;
  ELSIF (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at']) OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Booking quote and scope are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_orders FOR EACH ROW EXECUTE FUNCTION c06_order_guard();

CREATE FUNCTION c06_appearance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE booking booking_orders%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Appearance history cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT * INTO booking FROM booking_orders WHERE id=NEW.order_id;
  IF NEW.platform_fee_fen<>round(NEW.service_fen::numeric*booking.fee_bps/10000)::integer THEN
    RAISE EXCEPTION 'Quoted fee does not match the booking snapshot' USING ERRCODE='23514';
  END IF;
  IF NEW.match_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM published_matches m WHERE m.id=NEW.match_id AND m.org_id=booking.org_id
      AND m.event_id=booking.event_id AND booking.team_id IN (m.home_team_id,m.away_team_id)
  ) THEN RAISE EXCEPTION 'Appearance match must belong to the booked team and event' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NEW.version<>1 OR NEW.status NOT IN ('CONDITIONAL','REQUESTED')) THEN
    RAISE EXCEPTION 'Appearance must start pending' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.version<>OLD.version+1 OR
    (to_jsonb(NEW)-ARRAY['match_id','status','version','report_at','start_at','end_at','venue','payment_status','settlement_status','expires_at','accepted_at','arrived_at','completed_at','cancellation_reason','change_request','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['match_id','status','version','report_at','start_at','end_at','venue','payment_status','settlement_status','expires_at','accepted_at','arrived_at','completed_at','cancellation_reason','change_request','updated_at'])
  ) THEN RAISE EXCEPTION 'Appearance identity and quote are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_appearances_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_appearances FOR EACH ROW EXECUTE FUNCTION c06_appearance_guard();

CREATE FUNCTION c06_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.result IS NOT NULL OR NEW.result IS NULL OR (to_jsonb(NEW)-'result') IS DISTINCT FROM (to_jsonb(OLD)-'result') THEN
    RAISE EXCEPTION 'Booking receipt is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_operations_guard BEFORE UPDATE OR DELETE ON booking_operations FOR EACH ROW EXECUTE FUNCTION c06_operation_guard();
