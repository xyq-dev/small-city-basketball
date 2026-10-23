CREATE TABLE platform_operators (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  maintenance_actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 4 AND 500),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE billing_plan_versions (
  id uuid PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{1,31}$'),
  version integer NOT NULL CHECK (version>0),
  name text NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  currency text NOT NULL CHECK (currency='CNY'),
  amount_fen integer NOT NULL CHECK (amount_fen BETWEEN 1 AND 100000000),
  max_teams integer NOT NULL CHECK (max_teams BETWEEN 2 AND 32),
  max_matches integer NOT NULL CHECK (max_matches BETWEEN 1 AND 1024),
  valid_days integer NOT NULL CHECK (valid_days BETWEEN 1 AND 730),
  available boolean NOT NULL DEFAULT true,
  catalog_version integer NOT NULL DEFAULT 1 CHECK (catalog_version>0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(code,version)
);
CREATE TABLE billing_orders (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES billing_plan_versions(id),
  quote jsonb NOT NULL CHECK (jsonb_typeof(quote)='object'),
  amount_fen integer NOT NULL CHECK (amount_fen BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK (currency='CNY'),
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','PAID','REFUND_PENDING','REFUNDED','CANCELLED','EXPIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  channel text CHECK (channel IN ('MANUAL','WECHAT_NATIVE')),
  out_trade_no text NOT NULL UNIQUE CHECK (out_trade_no ~ '^[a-zA-Z0-9]{32}$'),
  provider_transaction_id text UNIQUE,
  native_code_url text CHECK (native_code_url IS NULL OR (char_length(native_code_url)<=2048 AND native_code_url LIKE 'weixin://%')),
  provider_started_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  paid_at timestamptz,
  UNIQUE(org_id,id),
  UNIQUE(org_id,event_id,id),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  CHECK (quote->>'currency'='CNY' AND (quote->>'amountFen')::integer=amount_fen AND quote->>'planId'=plan_id::text)
);
CREATE INDEX billing_orders_by_org ON billing_orders(org_id,created_at DESC,id);
CREATE UNIQUE INDEX billing_orders_one_pending ON billing_orders(org_id,event_id) WHERE status IN ('PENDING_PAYMENT','PAID','REFUND_PENDING');
CREATE TABLE billing_payment_reviews (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','CONFIRMED','REJECTED')),
  submitted_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  external_reference text NOT NULL UNIQUE CHECK (external_reference=btrim(external_reference) AND char_length(external_reference) BETWEEN 4 AND 128),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 4 AND 500),
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  CHECK ((status='PENDING_REVIEW' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'PENDING_REVIEW' AND reviewed_by IS NOT NULL AND reviewed_by<>submitted_by AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX billing_payment_reviews_one_pending ON billing_payment_reviews(order_id) WHERE status='PENDING_REVIEW';
CREATE TABLE billing_refunds (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES billing_orders(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PENDING_REVIEW','PROCESSING','SUCCEEDED','REJECTED','FAILED','UNKNOWN')),
  amount_fen integer NOT NULL CHECK (amount_fen BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK(currency='CNY'),
  out_refund_no text NOT NULL UNIQUE CHECK(out_refund_no ~ '^[a-zA-Z0-9]{32}$'),
  provider_refund_id text UNIQUE,
  requested_by uuid NOT NULL REFERENCES users(id),
  submitted_by uuid REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  external_reference text UNIQUE CHECK (external_reference IS NULL OR (external_reference=btrim(external_reference) AND char_length(external_reference) BETWEEN 4 AND 128)),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 4 AND 500),
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  accepted_at timestamptz,
  CHECK(reviewed_by IS NULL OR (submitted_by IS NOT NULL AND reviewed_by<>submitted_by))
);
CREATE TABLE event_entitlements (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  event_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE,
  max_teams integer NOT NULL CHECK (max_teams BETWEEN 2 AND 32),
  max_matches integer NOT NULL CHECK (max_matches BETWEEN 1 AND 1024),
  valid_until timestamptz NOT NULL CHECK (isfinite(valid_until)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoke_reason text,
  UNIQUE(org_id,id),
  UNIQUE(org_id,event_id,id),
  FOREIGN KEY(org_id,event_id,order_id) REFERENCES billing_orders(org_id,event_id,id),
  CHECK((revoked_at IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND char_length(revoke_reason) BETWEEN 4 AND 500))
);
CREATE TABLE event_commercial_activations (
  event_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  source text NOT NULL CHECK(source IN ('LEGACY','UNMETERED','PAID')),
  entitlement_id uuid,
  participant_count integer NOT NULL CHECK(participant_count BETWEEN 2 AND 32),
  expected_match_count integer NOT NULL CHECK(expected_match_count BETWEEN 1 AND 1024),
  activated_by uuid REFERENCES users(id),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
  FOREIGN KEY(org_id,event_id,entitlement_id) REFERENCES event_entitlements(org_id,event_id,id),
  CHECK((source='PAID' AND entitlement_id IS NOT NULL) OR (source<>'PAID' AND entitlement_id IS NULL))
);
CREATE TABLE billing_operations (
  actor_id uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE payment_notifications (
  notification_id text PRIMARY KEY CHECK(char_length(notification_id) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK(kind IN ('PAYMENT','REFUND')),
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  proof_hash char(64) NOT NULL CHECK(proof_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE billing_reconciliations (
  id uuid PRIMARY KEY,
  bill_date date NOT NULL,
  source text NOT NULL CHECK(source IN ('MANUAL','WECHAT_NATIVE')),
  body_hash char(64) NOT NULL CHECK(body_hash ~ '^[0-9a-f]{64}$'),
  matched_count integer NOT NULL CHECK(matched_count>=0),
  issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array' AND jsonb_array_length(issues)<=1000),
  created_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 4 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION c05_commerce_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Commercial history is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER event_commercial_activations_immutable BEFORE UPDATE OR DELETE ON event_commercial_activations FOR EACH ROW EXECUTE FUNCTION c05_commerce_immutable();
CREATE TRIGGER payment_notifications_immutable BEFORE UPDATE OR DELETE ON payment_notifications FOR EACH ROW EXECUTE FUNCTION c05_commerce_immutable();
CREATE TRIGGER billing_reconciliations_immutable BEFORE UPDATE OR DELETE ON billing_reconciliations FOR EACH ROW EXECUTE FUNCTION c05_commerce_immutable();
CREATE FUNCTION c05_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['available','catalog_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['available','catalog_version']) OR NEW.catalog_version<>OLD.catalog_version+1 THEN
    RAISE EXCEPTION 'Plan terms are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_plan_versions_guard BEFORE UPDATE OR DELETE ON billing_plan_versions FOR EACH ROW EXECUTE FUNCTION c05_plan_guard();
CREATE FUNCTION c05_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','version','channel','provider_transaction_id','native_code_url','provider_started_at','paid_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','channel','provider_transaction_id','native_code_url','provider_started_at','paid_at']) OR NEW.version<>OLD.version+1 OR
    (OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id) OR
    (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at) OR
    (OLD.channel IS NOT NULL AND NEW.channel IS DISTINCT FROM OLD.channel) OR
    (OLD.status IN ('REFUNDED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status) OR
    (OLD.paid_at IS NOT NULL AND NEW.status IN ('PENDING_PAYMENT','EXPIRED','CANCELLED')) THEN
    RAISE EXCEPTION 'Order quote and settled payment are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_orders_guard BEFORE UPDATE OR DELETE ON billing_orders FOR EACH ROW EXECUTE FUNCTION c05_order_guard();
CREATE FUNCTION c05_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order billing_orders%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment review cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT * INTO target_order FROM billing_orders WHERE id=NEW.order_id;
  IF TG_OP='INSERT' AND NEW.status<>'PENDING_REVIEW' THEN RAISE EXCEPTION 'Payment review must start pending' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('CONFIRMED','REJECTED') OR
    (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_reason','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_reason','reviewed_at'])) THEN
    RAISE EXCEPTION 'Review history is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM platform_operators WHERE user_id=NEW.submitted_by AND status='ACTIVE') OR
    (NEW.reviewed_by IS NOT NULL AND (NEW.reviewed_by=target_order.created_by OR NOT EXISTS(SELECT 1 FROM platform_operators WHERE user_id=NEW.reviewed_by AND status='ACTIVE') OR EXISTS(SELECT 1 FROM organization_memberships WHERE org_id=target_order.org_id AND user_id=NEW.reviewed_by AND status='ACTIVE'))) THEN
    RAISE EXCEPTION 'Independent platform review required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_payment_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON billing_payment_reviews FOR EACH ROW EXECUTE FUNCTION c05_review_guard();
CREATE FUNCTION c05_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order billing_orders%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund history cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT * INTO target_order FROM billing_orders WHERE id=NEW.order_id;
  IF NEW.amount_fen<>target_order.amount_fen OR target_order.paid_at IS NULL OR EXISTS(SELECT 1 FROM event_commercial_activations WHERE event_id=target_order.event_id) THEN
    RAISE EXCEPTION 'Only unused full orders may be refunded' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='SUCCEEDED' AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL AND (to_jsonb(NEW)-'accepted_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'accepted_at') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND ((OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at) OR (OLD.submitted_by IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by) OR (OLD.reviewed_by IS NOT NULL AND NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by) OR (OLD.external_reference IS NOT NULL AND NEW.external_reference IS DISTINCT FROM OLD.external_reference) OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id) OR (to_jsonb(NEW)-ARRAY['status','submitted_by','reviewed_by','external_reference','review_reason','provider_refund_id','completed_at','accepted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','submitted_by','reviewed_by','external_reference','review_reason','provider_refund_id','completed_at','accepted_at']) OR OLD.status IN ('SUCCEEDED','REJECTED')) THEN
    RAISE EXCEPTION 'Refund source is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.submitted_by IS NOT NULL AND (TG_OP='INSERT' OR OLD.submitted_by IS NULL) AND NOT EXISTS(SELECT 1 FROM platform_operators WHERE user_id=NEW.submitted_by AND status='ACTIVE') THEN RAISE EXCEPTION 'Platform operator required' USING ERRCODE='23514'; END IF;
  IF NEW.reviewed_by IS NOT NULL AND (TG_OP='INSERT' OR OLD.reviewed_by IS NULL) AND (NEW.reviewed_by=target_order.created_by OR NOT EXISTS(SELECT 1 FROM platform_operators WHERE user_id=NEW.reviewed_by AND status='ACTIVE') OR EXISTS(SELECT 1 FROM organization_memberships WHERE org_id=target_order.org_id AND user_id=NEW.reviewed_by AND status='ACTIVE')) THEN
    RAISE EXCEPTION 'Independent platform reviewer required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_refunds_guard BEFORE INSERT OR UPDATE OR DELETE ON billing_refunds FOR EACH ROW EXECUTE FUNCTION c05_refund_guard();
CREATE FUNCTION c05_entitlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order billing_orders%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Entitlements cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR (to_jsonb(NEW)-ARRAY['revoked_at','revoke_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','revoke_reason']) OR EXISTS(SELECT 1 FROM event_commercial_activations WHERE entitlement_id=OLD.id) THEN RAISE EXCEPTION 'Entitlement source is immutable' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO target_order FROM billing_orders WHERE id=NEW.order_id;
    IF target_order.status<>'PAID' OR target_order.paid_at IS NULL OR NEW.max_teams<>(target_order.quote->>'maxTeams')::integer OR NEW.max_matches<>(target_order.quote->>'maxMatches')::integer OR NEW.valid_until<>target_order.paid_at+((target_order.quote->>'validDays')::integer*interval '1 day') THEN RAISE EXCEPTION 'Entitlement requires settled quoted payment' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_entitlements_guard BEFORE INSERT OR UPDATE OR DELETE ON event_entitlements FOR EACH ROW EXECUTE FUNCTION c05_entitlement_guard();
CREATE FUNCTION c05_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.result IS NOT NULL OR NEW.result IS NULL OR (to_jsonb(NEW)-'result') IS DISTINCT FROM (to_jsonb(OLD)-'result') THEN RAISE EXCEPTION 'Commercial receipt is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_operations_guard BEFORE UPDATE OR DELETE ON billing_operations FOR EACH ROW EXECUTE FUNCTION c05_operation_guard();

INSERT INTO event_commercial_activations(event_id,org_id,source,participant_count,expected_match_count,activated_at)
SELECT p.event_id,p.org_id,'LEGACY',jsonb_array_length(r.source->'entries'),
  CASE WHEN r.algorithm_version='RR_CIRCLE_V1' THEN jsonb_array_length(r.source->'entries')*(jsonb_array_length(r.source->'entries')-1)/2 ELSE jsonb_array_length(r.source->'entries')-1 END,p.created_at
FROM schedule_publications p JOIN schedule_revisions r ON r.org_id=p.org_id AND r.event_id=p.event_id AND r.id=p.revision_id;

CREATE FUNCTION c05_order_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p billing_plan_versions%ROWTYPE;
BEGIN
  SELECT * INTO p FROM billing_plan_versions WHERE id=NEW.plan_id;
  IF NEW.status<>'PENDING_PAYMENT' OR NEW.version<>1 OR NEW.channel IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.provider_transaction_id IS NOT NULL OR NEW.native_code_url IS NOT NULL OR NEW.provider_started_at IS NOT NULL OR p.id IS NULL OR NOT p.available OR
    NEW.amount_fen<>p.amount_fen OR NEW.quote->>'code'<>p.code OR (NEW.quote->>'version')::integer<>p.version OR NEW.quote->>'name'<>p.name OR (NEW.quote->>'maxTeams')::integer<>p.max_teams OR (NEW.quote->>'maxMatches')::integer<>p.max_matches OR (NEW.quote->>'validDays')::integer<>p.valid_days OR COALESCE(NEW.quote->>'hash','') !~ '^[0-9a-f]{64}$' OR NEW.quote IS DISTINCT FROM jsonb_build_object('planId',p.id::text,'code',p.code,'version',p.version,'name',p.name,'currency','CNY','amountFen',p.amount_fen,'maxTeams',p.max_teams,'maxMatches',p.max_matches,'validDays',p.valid_days,'hash',NEW.quote->>'hash') OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>NEW.created_at+interval '48 hours' THEN
    RAISE EXCEPTION 'Order must preserve the available plan quote' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_orders_insert_guard BEFORE INSERT ON billing_orders FOR EACH ROW EXECUTE FUNCTION c05_order_insert_guard();
CREATE FUNCTION c05_activation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entitlement event_entitlements%ROWTYPE; payment_status text;
BEGIN
  IF NEW.source='LEGACY' AND current_user='scb_runtime' THEN RAISE EXCEPTION 'Legacy activation requires migration identity' USING ERRCODE='23514'; END IF;
  IF NEW.source='PAID' THEN
    SELECT * INTO entitlement FROM event_entitlements WHERE id=NEW.entitlement_id AND org_id=NEW.org_id AND event_id=NEW.event_id;
    SELECT status INTO payment_status FROM billing_orders WHERE id=entitlement.order_id;
    IF entitlement.id IS NULL OR entitlement.revoked_at IS NOT NULL OR entitlement.valid_until<=clock_timestamp() OR payment_status<>'PAID' OR NEW.participant_count>entitlement.max_teams OR NEW.expected_match_count>entitlement.max_matches THEN RAISE EXCEPTION 'Valid event entitlement required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_commercial_activations_insert_guard BEFORE INSERT ON event_commercial_activations FOR EACH ROW EXECUTE FUNCTION c05_activation_insert_guard();
