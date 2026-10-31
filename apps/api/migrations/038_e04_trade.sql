-- E04: business-source financial records; platform software billing remains separate.
CREATE TABLE trade_terms (
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations(id),kind text NOT NULL CHECK(kind IN('ENTRY_FEE','ENTRY_DEPOSIT','LOCAL_BOOKING')),
 source_id uuid NOT NULL,amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 1 AND 100000000),terms text NOT NULL CHECK(char_length(terms) BETWEEN 4 AND 2000),
 merchant_key text NOT NULL CHECK(char_length(merchant_key) BETWEEN 1 AND 80),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','ACTIVE','REJECTED','REVOKED')),
 created_by uuid NOT NULL REFERENCES users(id),reviewed_by uuid REFERENCES users(id),review_reason text,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),reviewed_at timestamptz,
 CHECK(status='PENDING' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX trade_active_terms ON trade_terms(org_id,kind,source_id) WHERE status='ACTIVE';
CREATE TABLE trade_orders (
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations(id),kind text NOT NULL CHECK(kind IN('ENTRY_FEE','ENTRY_DEPOSIT','LOCAL_BOOKING','PLAYER_APPEARANCE')),
 source_id uuid NOT NULL,source_version integer NOT NULL CHECK(source_version>0),source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),source_hash char(64) NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 payer_user_id uuid NOT NULL REFERENCES users(id),beneficiary_user_id uuid NOT NULL REFERENCES users(id),terms_id uuid REFERENCES trade_terms(id),
 merchant_key text NOT NULL,merchant_id text NOT NULL,merchant_app_id text NOT NULL,merchant_name text NOT NULL,total_fen integer NOT NULL CHECK(total_fen BETWEEN 1 AND 100000000),currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 quote jsonb NOT NULL CHECK(jsonb_typeof(quote)='object'),status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','SOURCE_CONFLICT','COMPLETED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(kind,source_id)
);
CREATE INDEX trade_orders_payer ON trade_orders(payer_user_id,created_at DESC,id);
CREATE INDEX trade_orders_org ON trade_orders(org_id,created_at DESC,id);
CREATE TABLE trade_payment_attempts (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES trade_orders(id),out_trade_no text NOT NULL UNIQUE CHECK(out_trade_no~'^[A-Za-z0-9_-]{1,32}$'),
 channel text NOT NULL CHECK(channel IN('NATIVE','JSAPI')),status text NOT NULL CHECK(status IN('DISPATCHING','UNKNOWN','NOTPAY','PAID','CLOSED','FAILED')),
 total_fen integer NOT NULL CHECK(total_fen BETWEEN 1 AND 100000000),currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 fence uuid NOT NULL,expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),checkout bytea,provider_transaction_id text,paid_at timestamptz,
 profit_sharing boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='PAID')=(provider_transaction_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE UNIQUE INDEX trade_live_attempt ON trade_payment_attempts(order_id) WHERE status IN('DISPATCHING','UNKNOWN','NOTPAY');
CREATE UNIQUE INDEX trade_provider_transaction ON trade_payment_attempts(provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE TABLE trade_refunds (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES trade_orders(id),payment_id uuid NOT NULL REFERENCES trade_payment_attempts(id),
 out_refund_no text NOT NULL UNIQUE,amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 1 AND 100000000),reason text NOT NULL CHECK(char_length(reason) BETWEEN 4 AND 1000),
 status text NOT NULL CHECK(status IN('PENDING_REVIEW','APPROVED','REJECTED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','FAILED')),
 proposed_by uuid NOT NULL REFERENCES users(id),reviewed_by uuid REFERENCES users(id),review_reason text,fence uuid,provider_refund_id text,success_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),CHECK(status NOT IN('APPROVED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','FAILED') OR reviewed_by IS NOT NULL),
 CHECK(status<>'SUCCEEDED' OR (provider_refund_id IS NOT NULL AND success_at IS NOT NULL))
);
CREATE TABLE trade_deductions (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES trade_orders(id),amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 1 AND 100000000),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 4 AND 1000),evidence_reference text NOT NULL CHECK(char_length(evidence_reference) BETWEEN 4 AND 200),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN('PENDING_REVIEW','APPROVED','REJECTED','REVERSAL_PENDING','REVERSED')),
 proposed_by uuid NOT NULL REFERENCES users(id),reviewed_by uuid REFERENCES users(id),review_reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),CHECK(status='PENDING_REVIEW' OR reviewed_by IS NOT NULL)
);
CREATE TABLE trade_settlements (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES trade_orders(id),payment_id uuid NOT NULL REFERENCES trade_payment_attempts(id),
 out_order_no text NOT NULL UNIQUE,amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 1 AND 100000000),receiver_merchant_id text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN('PENDING_REVIEW','APPROVED','REJECTED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','FAILED','RETURNING','RETURN_UNKNOWN','RETURNED')),
 proposed_by uuid NOT NULL REFERENCES users(id),reviewed_by uuid REFERENCES users(id),review_reason text,fence uuid,provider_order_id text,provider_detail_id text,
 return_no text UNIQUE,return_amount_fen integer NOT NULL DEFAULT 0 CHECK(return_amount_fen>=0 AND return_amount_fen<=amount_fen),provider_return_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),CHECK(status NOT IN('APPROVED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','FAILED','RETURNING','RETURN_UNKNOWN','RETURNED') OR reviewed_by IS NOT NULL),
 CHECK(status NOT IN('SUCCEEDED','RETURNING','RETURN_UNKNOWN','RETURNED') OR (provider_order_id IS NOT NULL AND provider_detail_id IS NOT NULL))
);
CREATE TABLE trade_provider_events (
 merchant_key text NOT NULL,event_id text NOT NULL,event_hash char(64) NOT NULL CHECK(event_hash~'^[a-f0-9]{64}$'),kind text NOT NULL CHECK(kind IN('PAYMENT','REFUND')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(merchant_key,event_id)
);
CREATE TABLE trade_operations (
 actor_id uuid NOT NULL REFERENCES users(id),command_id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 order_id uuid REFERENCES trade_orders(id),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE trade_reconciliations (
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations(id),merchant_key text NOT NULL,bill_date date NOT NULL,body_hash char(64) NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(merchant_key,bill_date,body_hash)
);
CREATE FUNCTION e04_trade_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='trade_orders' AND (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN
 RAISE EXCEPTION 'Financial quote and source are immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='trade_terms' AND (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_reason','reviewed_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_reason','reviewed_at','version']) THEN
 RAISE EXCEPTION 'Fee terms are immutable; create a new version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trade_order_history BEFORE UPDATE OR DELETE ON trade_orders FOR EACH ROW EXECUTE FUNCTION e04_trade_immutable();
CREATE TRIGGER trade_terms_history BEFORE UPDATE OR DELETE ON trade_terms FOR EACH ROW EXECUTE FUNCTION e04_trade_immutable();
CREATE TABLE trade_settlement_returns (
 id uuid PRIMARY KEY,settlement_id uuid NOT NULL REFERENCES trade_settlements(id),out_return_no text NOT NULL UNIQUE,
 amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 1 AND 100000000),status text NOT NULL CHECK(status IN('SENDING','UNKNOWN','PROCESSING','SUCCEEDED','FAILED')),
 fence uuid NOT NULL,provider_return_id text,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX trade_unresolved_return ON trade_settlement_returns(settlement_id) WHERE status IN('SENDING','UNKNOWN','PROCESSING');
