-- MEMBER02: organization software subscriptions share the original C05 payment ledger.
-- Earlier migration checksums and EVENT quote JSON remain unchanged.
ALTER TABLE billing_plan_versions ADD COLUMN target_kind text NOT NULL DEFAULT 'EVENT'
 CHECK(target_kind IN('EVENT','ORG_MEMBERSHIP'));
ALTER TABLE billing_plan_versions ADD COLUMN membership_tier text;
ALTER TABLE billing_plan_versions ADD COLUMN membership_events integer;
ALTER TABLE billing_plan_versions ADD CONSTRAINT m02_plan_terms CHECK(
 (target_kind='EVENT' AND membership_tier IS NULL AND membership_events IS NULL)
 OR (target_kind='ORG_MEMBERSHIP' AND membership_tier IS NOT NULL AND membership_events IS NOT NULL AND
   valid_days IN(30,365) AND (
    (membership_tier='PRO' AND max_teams=16 AND max_matches=128 AND membership_events=CASE WHEN valid_days=30 THEN 3 ELSE 36 END)
    OR (membership_tier='BUSINESS' AND max_teams=32 AND max_matches=512 AND membership_events=CASE WHEN valid_days=30 THEN 10 ELSE 120 END)))
);
ALTER TABLE billing_orders ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE billing_orders ADD COLUMN target_kind text NOT NULL DEFAULT 'EVENT'
 CHECK(target_kind IN('EVENT','ORG_MEMBERSHIP'));
ALTER TABLE billing_orders ADD COLUMN membership_previous_period_id uuid;
ALTER TABLE billing_orders ADD CONSTRAINT m02_order_org FOREIGN KEY(org_id) REFERENCES organizations(id);
ALTER TABLE billing_orders ADD CONSTRAINT m02_order_target CHECK(
 (target_kind='EVENT' AND event_id IS NOT NULL AND membership_previous_period_id IS NULL)
 OR(target_kind='ORG_MEMBERSHIP' AND event_id IS NULL));
CREATE UNIQUE INDEX m02_one_pending_order ON billing_orders(org_id)
 WHERE target_kind='ORG_MEMBERSHIP' AND status='PENDING_PAYMENT';
CREATE UNIQUE INDEX m02_one_live_renewal ON billing_orders(org_id,membership_previous_period_id)
 WHERE membership_previous_period_id IS NOT NULL AND status IN('PENDING_PAYMENT','PAID','REFUND_PENDING');

CREATE TABLE software_membership_periods (
 id uuid PRIMARY KEY,
 org_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL UNIQUE,
 tier text NOT NULL CHECK(tier IN('PRO','BUSINESS')),
 duration_days integer NOT NULL CHECK(duration_days IN(30,365)),
 event_limit integer NOT NULL CHECK(event_limit BETWEEN 1 AND 120),
 max_teams integer NOT NULL CHECK(max_teams BETWEEN 2 AND 32),
 max_matches integer NOT NULL CHECK(max_matches BETWEEN 1 AND 1024),
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)),
 ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 revoke_reason text,
 UNIQUE(org_id,id),
 FOREIGN KEY(org_id,order_id) REFERENCES billing_orders(org_id,id),
 CHECK(ends_at=starts_at+(duration_days*86400::double precision)*interval '1 second'),
 CHECK((revoked_at IS NULL AND revoke_reason IS NULL) OR
       (revoked_at IS NOT NULL AND isfinite(revoked_at) AND revoke_reason IS NOT NULL AND char_length(revoke_reason) BETWEEN 4 AND 500)),
 EXCLUDE USING gist(org_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&)
 WHERE(revoked_at IS NULL)
);
ALTER TABLE billing_orders ADD CONSTRAINT m02_previous_period
 FOREIGN KEY(org_id,membership_previous_period_id) REFERENCES software_membership_periods(org_id,id);
CREATE INDEX m02_periods_by_org ON software_membership_periods(org_id,starts_at DESC,id);
ALTER TABLE event_commercial_activations ADD COLUMN membership_period_id uuid;
ALTER TABLE event_commercial_activations DROP CONSTRAINT event_commercial_activations_source_check;
ALTER TABLE event_commercial_activations DROP CONSTRAINT event_commercial_activations_check;
ALTER TABLE event_commercial_activations ADD CONSTRAINT m02_activation_source CHECK(
 (source='PAID' AND entitlement_id IS NOT NULL AND membership_period_id IS NULL)
 OR(source IN('LEGACY','UNMETERED') AND entitlement_id IS NULL AND membership_period_id IS NULL)
 OR(source='MEMBERSHIP' AND entitlement_id IS NULL AND membership_period_id IS NOT NULL));
ALTER TABLE event_commercial_activations ADD CONSTRAINT m02_activation_period
 FOREIGN KEY(org_id,membership_period_id) REFERENCES software_membership_periods(org_id,id);
CREATE INDEX m02_period_consumption ON event_commercial_activations(membership_period_id,event_id)
 WHERE membership_period_id IS NOT NULL;

CREATE FUNCTION m02_membership_order_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p billing_plan_versions%ROWTYPE; previous software_membership_periods%ROWTYPE; ts timestamptz;
 expected_quote jsonb;
BEGIN
 IF NEW.target_kind<>'ORG_MEMBERSHIP' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('scb-software-membership:'||NEW.org_id::text,0));
 ts:=clock_timestamp();
 SELECT * INTO p FROM billing_plan_versions WHERE id=NEW.plan_id;
 expected_quote:=jsonb_build_object('planId',p.id::text,'code',p.code,'version',p.version,
  'name',p.name,'currency','CNY','amountFen',p.amount_fen,'maxTeams',p.max_teams,
  'maxMatches',p.max_matches,'validDays',p.valid_days,'scope','ORG_MEMBERSHIP',
  'tier',p.membership_tier,'durationDays',p.valid_days,'eventLimit',p.membership_events,
  'previousPeriodId',NEW.membership_previous_period_id::text,'hash',NEW.quote->>'hash');
 IF p.id IS NULL OR p.target_kind<>'ORG_MEMBERSHIP' OR NOT p.available OR
 NEW.event_id IS NOT NULL OR NEW.status<>'PENDING_PAYMENT' OR NEW.version<>1 OR
 NEW.channel IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.provider_transaction_id IS NOT NULL OR
 NEW.native_code_url IS NOT NULL OR NEW.provider_started_at IS NOT NULL OR
 NEW.amount_fen<>p.amount_fen OR NEW.quote IS DISTINCT FROM expected_quote OR
 COALESCE(NEW.quote->>'hash','') !~ '^[0-9a-f]{64}$' OR
 NEW.expires_at<=NEW.created_at OR NEW.expires_at>NEW.created_at+interval '48 hours' THEN
 RAISE EXCEPTION 'Membership order must preserve its available quoted source' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM billing_orders o WHERE o.org_id=NEW.org_id AND o.target_kind='ORG_MEMBERSHIP'
  AND (o.status IN('PENDING_PAYMENT','REFUND_PENDING') OR
    (o.status='EXPIRED' AND (o.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=o.id AND r.status='PENDING_REVIEW'))) OR
    (o.status='PAID' AND NOT EXISTS(SELECT 1 FROM software_membership_periods n WHERE n.order_id=o.id)))) THEN
 RAISE EXCEPTION 'Original membership payment or refund must be resolved first' USING ERRCODE='23514'; END IF;
 IF NEW.membership_previous_period_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM software_membership_periods n WHERE n.org_id=NEW.org_id AND n.revoked_at IS NULL AND n.ends_at>ts) THEN
   RAISE EXCEPTION 'An existing membership requires explicit renewal' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO previous FROM software_membership_periods WHERE org_id=NEW.org_id AND id=NEW.membership_previous_period_id;
  IF previous.id IS NULL OR previous.revoked_at IS NOT NULL OR previous.starts_at>ts OR previous.ends_at<=ts OR
   previous.ends_at>ts+2592000::double precision*interval '1 second' OR previous.tier<>p.membership_tier OR previous.duration_days<>p.valid_days OR
   NOT EXISTS(SELECT 1 FROM billing_orders o WHERE o.id=previous.order_id AND o.status='PAID') OR
   EXISTS(SELECT 1 FROM billing_orders o WHERE o.membership_previous_period_id=previous.id AND o.status IN('PENDING_PAYMENT','PAID','REFUND_PENDING')) THEN
   RAISE EXCEPTION 'Only one same-tier same-duration next period may be renewed in its final 30 days' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER billing_orders_membership_insert_guard BEFORE INSERT ON billing_orders
 FOR EACH ROW EXECUTE FUNCTION m02_membership_order_insert_guard();

CREATE FUNCTION m02_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o billing_orders%ROWTYPE; previous software_membership_periods%ROWTYPE; expected_start timestamptz; ts timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Membership source history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
   (to_jsonb(NEW)-ARRAY['revoked_at','revoke_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','revoke_reason']) OR
   EXISTS(SELECT 1 FROM event_commercial_activations WHERE membership_period_id=OLD.id) OR
   NOT EXISTS(SELECT 1 FROM billing_refunds f WHERE f.order_id=OLD.order_id AND f.status='SUCCEEDED') OR
   EXISTS(SELECT 1 FROM billing_orders b WHERE b.membership_previous_period_id=OLD.id AND
      (b.status IN('PENDING_PAYMENT','PAID','REFUND_PENDING') OR (b.status='EXPIRED' AND (b.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=b.id AND r.status='PENDING_REVIEW'))))) THEN
   RAISE EXCEPTION 'Only a verified unused source without a live successor may be revoked' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('scb-software-membership:'||NEW.org_id::text,0));
 SELECT * INTO o FROM billing_orders WHERE org_id=NEW.org_id AND id=NEW.order_id FOR UPDATE;
 ts:=clock_timestamp();
 IF NOT (CASE WHEN o.channel='MANUAL' THEN o.paid_at>=o.created_at AND o.paid_at<o.expires_at AND ts<o.expires_at
   WHEN o.channel='WECHAT_NATIVE' THEN o.paid_at>=date_trunc('second',o.created_at) AND o.paid_at<=o.expires_at AND o.paid_at<=ts
   ELSE false END) THEN
  RAISE EXCEPTION 'Membership period payment must belong to its authoritative quoted window' USING ERRCODE='23514'; END IF;
 IF o.membership_previous_period_id IS NULL THEN
  expected_start:=(CASE WHEN o.channel='WECHAT_NATIVE' THEN GREATEST(o.paid_at,o.created_at) ELSE o.paid_at END);
 ELSE
  SELECT * INTO previous FROM software_membership_periods WHERE org_id=NEW.org_id AND id=o.membership_previous_period_id FOR UPDATE;
  expected_start:=previous.ends_at;
  IF previous.id IS NULL OR previous.revoked_at IS NOT NULL OR previous.tier<>NEW.tier OR previous.duration_days<>NEW.duration_days OR
    NOT EXISTS(SELECT 1 FROM billing_orders b WHERE b.id=previous.order_id AND b.status='PAID') THEN
   RAISE EXCEPTION 'Renewal must preserve the same valid predecessor' USING ERRCODE='23514'; END IF;
 END IF;
 IF o.id IS NULL OR o.target_kind<>'ORG_MEMBERSHIP' OR o.status<>'PAID' OR o.paid_at IS NULL OR
  NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL OR
  NEW.tier IS DISTINCT FROM o.quote->>'tier' OR NEW.duration_days IS DISTINCT FROM (o.quote->>'durationDays')::integer OR
  NEW.event_limit IS DISTINCT FROM (o.quote->>'eventLimit')::integer OR NEW.max_teams IS DISTINCT FROM (o.quote->>'maxTeams')::integer OR
  NEW.max_matches IS DISTINCT FROM (o.quote->>'maxMatches')::integer OR NEW.starts_at IS DISTINCT FROM expected_start OR
  NEW.ends_at IS DISTINCT FROM expected_start+(NEW.duration_days*86400::double precision)*interval '1 second' THEN
 RAISE EXCEPTION 'Membership period requires exactly its settled immutable quote' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER software_membership_periods_guard BEFORE INSERT OR UPDATE OR DELETE ON software_membership_periods
 FOR EACH ROW EXECUTE FUNCTION m02_period_guard();

CREATE OR REPLACE FUNCTION c05_order_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p billing_plan_versions%ROWTYPE;
BEGIN
  IF NEW.target_kind='ORG_MEMBERSHIP' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM billing_plan_versions WHERE id=NEW.plan_id;
  IF p.target_kind<>'EVENT' THEN RAISE EXCEPTION 'Event order requires an event plan' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'PENDING_PAYMENT' OR NEW.version<>1 OR NEW.channel IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.provider_transaction_id IS NOT NULL OR NEW.native_code_url IS NOT NULL OR NEW.provider_started_at IS NOT NULL OR p.id IS NULL OR NOT p.available OR
    NEW.amount_fen<>p.amount_fen OR NEW.quote->>'code'<>p.code OR (NEW.quote->>'version')::integer<>p.version OR NEW.quote->>'name'<>p.name OR (NEW.quote->>'maxTeams')::integer<>p.max_teams OR (NEW.quote->>'maxMatches')::integer<>p.max_matches OR (NEW.quote->>'validDays')::integer<>p.valid_days OR COALESCE(NEW.quote->>'hash','') !~ '^[0-9a-f]{64}$' OR NEW.quote IS DISTINCT FROM jsonb_build_object('planId',p.id::text,'code',p.code,'version',p.version,'name',p.name,'currency','CNY','amountFen',p.amount_fen,'maxTeams',p.max_teams,'maxMatches',p.max_matches,'validDays',p.valid_days,'hash',NEW.quote->>'hash') OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>NEW.created_at+interval '48 hours' THEN
    RAISE EXCEPTION 'Order must preserve the available plan quote' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c05_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order billing_orders%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund history cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT * INTO target_order FROM billing_orders WHERE id=NEW.order_id;
  IF target_order.target_kind='ORG_MEMBERSHIP' AND TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('scb-software-membership:'||target_order.org_id::text,0));
    SELECT * INTO target_order FROM billing_orders WHERE id=NEW.order_id FOR UPDATE;
  END IF;
  IF target_order.target_kind='ORG_MEMBERSHIP' AND (
    EXISTS(SELECT 1 FROM event_commercial_activations a JOIN software_membership_periods p ON p.id=a.membership_period_id WHERE p.order_id=target_order.id) OR
    EXISTS(SELECT 1 FROM billing_orders b JOIN software_membership_periods p ON p.id=b.membership_previous_period_id WHERE p.order_id=target_order.id AND
      (b.status IN('PENDING_PAYMENT','PAID','REFUND_PENDING') OR (b.status='EXPIRED' AND (b.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=b.id AND r.status='PENDING_REVIEW')))))
  ) THEN RAISE EXCEPTION 'A used membership or a live successor cannot be refunded' USING ERRCODE='23514'; END IF;
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

CREATE OR REPLACE FUNCTION c05_activation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entitlement event_entitlements%ROWTYPE; payment_status text; period software_membership_periods%ROWTYPE; used_count integer; member_order billing_orders%ROWTYPE; ts timestamptz;
BEGIN
  IF NEW.source='LEGACY' AND current_user='scb_runtime' THEN RAISE EXCEPTION 'Legacy activation requires migration identity' USING ERRCODE='23514'; END IF;
  IF NEW.source='MEMBERSHIP' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('scb-software-membership:'||NEW.org_id::text,0));
    SELECT b.* INTO member_order FROM billing_orders b JOIN software_membership_periods p ON p.order_id=b.id
      WHERE p.org_id=NEW.org_id AND p.id=NEW.membership_period_id FOR UPDATE OF b;
    SELECT * INTO period FROM software_membership_periods WHERE org_id=NEW.org_id AND id=NEW.membership_period_id FOR UPDATE;
    ts:=clock_timestamp();
    SELECT count(*)::integer INTO used_count FROM event_commercial_activations WHERE membership_period_id=period.id;
    IF period.id IS NULL OR period.revoked_at IS NOT NULL OR member_order.target_kind<>'ORG_MEMBERSHIP' OR member_order.status<>'PAID' OR
      EXISTS(SELECT 1 FROM billing_refunds f WHERE f.order_id=member_order.id AND f.status<>'REJECTED') OR
      ts<period.starts_at OR ts>=period.ends_at OR NEW.activated_at<period.starts_at OR NEW.activated_at>=period.ends_at OR
      NEW.participant_count>period.max_teams OR NEW.expected_match_count>period.max_matches OR used_count>=period.event_limit THEN
      RAISE EXCEPTION 'A current paid membership with sufficient whole-period quota is required' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM billing_orders b WHERE b.org_id=NEW.org_id AND b.event_id=NEW.event_id AND
      (b.status IN('PENDING_PAYMENT','PAID','REFUND_PENDING') OR (b.status='EXPIRED' AND (b.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=b.id AND r.status='PENDING_REVIEW'))))) THEN
      RAISE EXCEPTION 'Resolve the original per-event purchase before membership use' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.source='PAID' THEN
    SELECT * INTO entitlement FROM event_entitlements WHERE id=NEW.entitlement_id AND org_id=NEW.org_id AND event_id=NEW.event_id;
    SELECT status INTO payment_status FROM billing_orders WHERE id=entitlement.order_id;
    IF entitlement.id IS NULL OR entitlement.revoked_at IS NOT NULL OR entitlement.valid_until<=clock_timestamp() OR payment_status<>'PAID' OR NEW.participant_count>entitlement.max_teams OR NEW.expected_match_count>entitlement.max_matches THEN RAISE EXCEPTION 'Valid event entitlement required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A verified provider CLOSED state resolves both EVENT and membership Native admission.
CREATE OR REPLACE FUNCTION c05_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status='CANCELLED' AND NEW.channel='WECHAT_NATIVE' AND OLD.status IS DISTINCT FROM NEW.status AND
      NOT EXISTS(SELECT 1 FROM payment_notifications p WHERE p.notification_id='query-payment-closed:'||OLD.out_trade_no||':CLOSED' AND p.order_id=OLD.id AND p.kind='PAYMENT') THEN
      RAISE EXCEPTION 'Native cancellation requires a verified original provider closure' USING ERRCODE='23514'; END IF;
  END IF;
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
