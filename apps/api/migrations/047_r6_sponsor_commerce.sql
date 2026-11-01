-- R6ADS: fixed-price sponsorship; facts remain in the common trade ledger.
CREATE TABLE sponsor_beneficiaries (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), beneficiary_org_id uuid NOT NULL REFERENCES organizations(id),
 merchant_id text NOT NULL, display_name text NOT NULL, authorization_version text NOT NULL, evidence text NOT NULL CHECK(char_length(evidence) BETWEEN 4 AND 2000),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)), status text NOT NULL DEFAULT 'IN_REVIEW' CHECK(status IN('IN_REVIEW','APPROVED','REJECTED','DISABLED')),
 created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(reviewed_by IS NULL OR reviewed_by<>created_by),
 CHECK(status<>'APPROVED' OR reviewed_by IS NOT NULL), UNIQUE(org_id,beneficiary_org_id,authorization_version)
);
CREATE TABLE sponsor_contracts (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), campaign_id uuid NOT NULL REFERENCES sponsorship_campaigns(id),
 payer_user_id uuid NOT NULL REFERENCES users(id), beneficiary_user_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120), total_fen integer NOT NULL CHECK(total_fen BETWEEN 1 AND 100000000),
 allowed_fee_fen integer NOT NULL CHECK(allowed_fee_fen>=0 AND allowed_fee_fen<total_fen), currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 terms text NOT NULL CHECK(char_length(terms) BETWEEN 4 AND 4000), starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)), ends_at timestamptz NOT NULL CHECK(isfinite(ends_at) AND ends_at>starts_at),
 merchant_key text NOT NULL, merchant_id text NOT NULL, merchant_app_id text NOT NULL,
 shares jsonb NOT NULL CHECK(jsonb_typeof(shares)='array' AND jsonb_array_length(shares) BETWEEN 1 AND 11),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','IN_REVIEW','APPROVED','SIGNED','REJECTED','CLOSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
 owner_signed_by uuid REFERENCES users(id), advertiser_signed_at timestamptz, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id), CHECK(reviewed_by IS NULL OR (reviewed_by<>created_by AND reviewed_by<>payer_user_id)),
 CHECK(status NOT IN('APPROVED','SIGNED') OR reviewed_by IS NOT NULL),
 CHECK(status<>'SIGNED' OR (owner_signed_by IS NOT NULL AND advertiser_signed_at IS NOT NULL)), CHECK(payer_user_id<>created_by)
);
CREATE INDEX sponsor_contracts_org ON sponsor_contracts(org_id,created_at DESC,id);
CREATE TABLE sponsor_orders (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), contract_id uuid NOT NULL UNIQUE,
 payer_user_id uuid NOT NULL REFERENCES users(id), beneficiary_user_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, total_fen integer NOT NULL CHECK(total_fen BETWEEN 1 AND 100000000), currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 merchant_key text NOT NULL, merchant_id text NOT NULL, merchant_app_id text NOT NULL,
 terms text NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 status text NOT NULL DEFAULT 'WAITING_PAYMENT' CHECK(status IN('WAITING_PAYMENT','DELIVERING','ACCEPTED','DISPUTED','CLOSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), verified_fee_fen integer CHECK(verified_fee_fen>=0 AND verified_fee_fen<total_fen), fee_evidence text,
 fee_verified_by uuid REFERENCES users(id), accepted_at timestamptz, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id), FOREIGN KEY(org_id,contract_id) REFERENCES sponsor_contracts(org_id,id),
 CHECK((verified_fee_fen IS NULL)=(fee_verified_by IS NULL)), CHECK(verified_fee_fen IS NULL OR fee_evidence IS NOT NULL)
);
CREATE TABLE sponsor_deliveries (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), order_id uuid NOT NULL,
 evidence text NOT NULL CHECK(char_length(evidence) BETWEEN 4 AND 2000), created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN('PROPOSED','ACCEPTED','DISPUTED')), reviewed_by uuid REFERENCES users(id), reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), reviewed_at timestamptz,
 FOREIGN KEY(org_id,order_id) REFERENCES sponsor_orders(org_id,id), CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE TABLE sponsor_settlement_batches (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), order_id uuid NOT NULL, trade_order_id uuid NOT NULL REFERENCES trade_orders(id),
 payment_id uuid NOT NULL REFERENCES trade_payment_attempts(id), transaction_id text NOT NULL, out_order_no text NOT NULL UNIQUE,
 pool_fen integer NOT NULL CHECK(pool_fen>=0), source_hash char(64) NOT NULL, money_version integer NOT NULL,
 status text NOT NULL DEFAULT 'IN_REVIEW' CHECK(status IN('IN_REVIEW','APPROVED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','PARTIAL','REJECTED')),
 proposed_by uuid NOT NULL REFERENCES users(id), approval_required integer NOT NULL DEFAULT 2 CHECK(approval_required BETWEEN 1 AND 2),
 approvals uuid[] NOT NULL DEFAULT '{}', fence uuid, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 provider_order_id text, finished boolean NOT NULL DEFAULT false, finish_status text NOT NULL DEFAULT 'PENDING' CHECK(finish_status IN('PENDING','SENDING','UNKNOWN','SUCCEEDED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id), FOREIGN KEY(org_id,order_id) REFERENCES sponsor_orders(org_id,id), CHECK(NOT proposed_by=ANY(approvals)),
 CHECK(status NOT IN('APPROVED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','PARTIAL') OR cardinality(approvals)>=approval_required)
);
CREATE UNIQUE INDEX sponsor_active_batch ON sponsor_settlement_batches(order_id) WHERE status<>'REJECTED';
CREATE TABLE sponsor_settlement_items (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), batch_id uuid NOT NULL,
 beneficiary_org_id uuid NOT NULL REFERENCES organizations(id), receiver_merchant_id text NOT NULL, display_name text NOT NULL,
 authorization_version text NOT NULL, amount_fen integer NOT NULL CHECK(amount_fen>=0), retained boolean NOT NULL,
 status text NOT NULL CHECK(status IN('RETAINED','NOT_REQUIRED','PENDING','PROCESSING','SUCCEEDED','FAILED')), provider_detail_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(batch_id,beneficiary_org_id), UNIQUE(org_id,id), FOREIGN KEY(org_id,batch_id) REFERENCES sponsor_settlement_batches(org_id,id),
 CHECK((status='RETAINED')=retained), CHECK((status='NOT_REQUIRED')=(NOT retained AND amount_fen=0)), CHECK(status<>'SUCCEEDED' OR provider_detail_id IS NOT NULL)
);
CREATE INDEX sponsor_items_beneficiary ON sponsor_settlement_items(beneficiary_org_id,created_at DESC,id);
CREATE TABLE sponsor_refund_plans (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), order_id uuid NOT NULL, batch_id uuid REFERENCES sponsor_settlement_batches(id),
 amount_fen integer NOT NULL CHECK(amount_fen BETWEEN 1 AND 100000000), pool_reduction_fen integer NOT NULL CHECK(pool_reduction_fen>=0 AND pool_reduction_fen<=amount_fen),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 4 AND 1000), status text NOT NULL CHECK(status IN('IN_REVIEW','APPROVED','RECOVERY_REQUIRED','READY_FOR_REFUND','CLAIMED','REJECTED')),
 proposed_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id), trade_refund_id uuid UNIQUE REFERENCES trade_refunds(id) DEFERRABLE INITIALLY DEFERRED,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), funding_mode text NOT NULL DEFAULT 'RETURN_FIRST' CHECK(funding_mode IN('RETURN_FIRST','PLATFORM_ADVANCE')),
 advance_proposed_by uuid REFERENCES users(id), advance_reviewed_by uuid REFERENCES users(id), advance_evidence text, advance_coverage jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(advance_reviewed_by IS NULL OR (advance_proposed_by IS NOT NULL AND advance_reviewed_by<>advance_proposed_by)),
 CHECK((funding_mode='PLATFORM_ADVANCE')=(advance_coverage IS NOT NULL)),
 CHECK(funding_mode<>'PLATFORM_ADVANCE' OR (advance_reviewed_by IS NOT NULL AND char_length(advance_evidence) BETWEEN 4 AND 2000 AND jsonb_typeof(advance_coverage)='object' AND advance_coverage ?& ARRAY['reservationId','sourceId','allocationId','tradeOrderId','paymentId','merchantKey','merchantId','currency','amountFen','proofHash','channelSupportsOwnFundsRefund','reservedUntilRefundFinal'] AND advance_coverage->>'currency'='CNY' AND (advance_coverage->>'amountFen')::integer=amount_fen AND (advance_coverage->>'allocationId')::uuid=id AND (advance_coverage->>'sourceId')::uuid=order_id AND advance_coverage->>'reservedUntilRefundFinal'='true' AND advance_coverage->>'channelSupportsOwnFundsRefund'='true')),
 UNIQUE(org_id,id), FOREIGN KEY(org_id,order_id) REFERENCES sponsor_orders(org_id,id), CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),
 CHECK(status NOT IN('APPROVED','RECOVERY_REQUIRED','READY_FOR_REFUND','CLAIMED') OR reviewed_by IS NOT NULL),
 CHECK((status='CLAIMED')=(trade_refund_id IS NOT NULL))
);
CREATE UNIQUE INDEX sponsor_advance_reservation_unique ON sponsor_refund_plans((advance_coverage->>'reservationId')) WHERE advance_coverage IS NOT NULL;
CREATE UNIQUE INDEX sponsor_one_pending_refund ON sponsor_refund_plans(order_id) WHERE status IN('IN_REVIEW','APPROVED','RECOVERY_REQUIRED','READY_FOR_REFUND');
ALTER TABLE sponsor_refund_plans ADD UNIQUE(org_id,order_id,id);
CREATE TABLE sponsor_refund_retries (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), order_id uuid NOT NULL, plan_id uuid NOT NULL,
 previous_refund_id uuid NOT NULL REFERENCES trade_refunds(id), status text NOT NULL DEFAULT 'IN_REVIEW' CHECK(status IN('IN_REVIEW','APPROVED','CLAIMED','REJECTED')),
 evidence text NOT NULL CHECK(char_length(evidence) BETWEEN 4 AND 2000), proposed_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
 trade_refund_id uuid UNIQUE REFERENCES trade_refunds(id) DEFERRABLE INITIALLY DEFERRED,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,order_id) REFERENCES sponsor_orders(org_id,id), FOREIGN KEY(org_id,order_id,plan_id) REFERENCES sponsor_refund_plans(org_id,order_id,id), CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),
 CHECK(status NOT IN('APPROVED','CLAIMED','REJECTED') OR reviewed_by IS NOT NULL), CHECK((status='CLAIMED')=(trade_refund_id IS NOT NULL)),
 CHECK(trade_refund_id IS NULL OR trade_refund_id<>previous_refund_id)
);
CREATE UNIQUE INDEX sponsor_retry_successor ON sponsor_refund_retries(previous_refund_id) WHERE status<>'REJECTED';
CREATE UNIQUE INDEX sponsor_retry_pending ON sponsor_refund_retries(plan_id) WHERE status IN('IN_REVIEW','APPROVED');
CREATE TABLE sponsor_return_items (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), refund_plan_id uuid NOT NULL, settlement_item_id uuid NOT NULL REFERENCES sponsor_settlement_items(id),
 amount_fen integer NOT NULL CHECK(amount_fen>0), out_return_no text NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN('NOT_REQUIRED','PENDING','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','FAILED')),
 fence uuid, provider_return_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(refund_plan_id,settlement_item_id), FOREIGN KEY(org_id,refund_plan_id) REFERENCES sponsor_refund_plans(org_id,id),
 CHECK(status<>'SUCCEEDED' OR provider_return_id IS NOT NULL)
);
CREATE TABLE sponsor_recovery_cases (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), refund_plan_id uuid NOT NULL,
 return_item_id uuid NOT NULL UNIQUE REFERENCES sponsor_return_items(id), amount_fen integer NOT NULL CHECK(amount_fen>0),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RECOVERED','WRITTEN_OFF')), evidence text,
 proposed_by uuid REFERENCES users(id), reviewed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,refund_plan_id) REFERENCES sponsor_refund_plans(org_id,id), CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by)
);
CREATE TABLE sponsor_commerce_operations (
 actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL, request_hash char(64) NOT NULL,
 org_id uuid NOT NULL REFERENCES organizations(id), result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,command_id)
);
CREATE FUNCTION r6_sponsor_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fields text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sponsor financial history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='sponsor_commerce_operations' THEN RAISE EXCEPTION 'Sponsor command evidence is append only' USING ERRCODE='23514'; END IF;
 fields:=CASE TG_TABLE_NAME
 WHEN 'sponsor_beneficiaries' THEN ARRAY['status','version','reviewed_by']
 WHEN 'sponsor_contracts' THEN ARRAY['status','version','reviewed_by','reviewed_at','owner_signed_by','advertiser_signed_at','updated_at']
 WHEN 'sponsor_orders' THEN ARRAY['status','version','verified_fee_fen','fee_evidence','fee_verified_by','accepted_at','updated_at']
 WHEN 'sponsor_deliveries' THEN ARRAY['status','reviewed_by','reviewed_at','reason']
 WHEN 'sponsor_settlement_batches' THEN ARRAY['status','approvals','fence','version','provider_order_id','finished','finish_status','updated_at']
 WHEN 'sponsor_settlement_items' THEN ARRAY['status','provider_detail_id','updated_at']
 WHEN 'sponsor_refund_plans' THEN ARRAY['status','reviewed_by','trade_refund_id','version','funding_mode','advance_proposed_by','advance_reviewed_by','advance_evidence','advance_coverage','updated_at']
 WHEN 'sponsor_refund_retries' THEN ARRAY['status','reviewed_by','trade_refund_id','version','updated_at']
 WHEN 'sponsor_return_items' THEN ARRAY['status','fence','provider_return_id','updated_at']
 WHEN 'sponsor_recovery_cases' THEN ARRAY['status','evidence','proposed_by','reviewed_by'] END;
 IF (to_jsonb(NEW)-fields) IS DISTINCT FROM (to_jsonb(OLD)-fields) THEN RAISE EXCEPTION 'Sponsor frozen intent cannot change' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='sponsor_contracts' THEN
  IF OLD.status='SIGNED' AND ((to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at'])) THEN RAISE EXCEPTION 'Signed contract cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='sponsor_orders' THEN
  IF OLD.verified_fee_fen IS NOT NULL AND (NEW.verified_fee_fen IS DISTINCT FROM OLD.verified_fee_fen OR NEW.fee_evidence IS DISTINCT FROM OLD.fee_evidence OR NEW.fee_verified_by IS DISTINCT FROM OLD.fee_verified_by) THEN RAISE EXCEPTION 'Verified fee cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='sponsor_settlement_batches' THEN
  IF cardinality(NEW.approvals)<>(SELECT count(DISTINCT a) FROM unnest(NEW.approvals) a) THEN RAISE EXCEPTION 'Distinct reviewers required' USING ERRCODE='23514'; END IF;
  IF OLD.finished AND (NOT NEW.finished OR NEW.finish_status<>'SUCCEEDED') THEN RAISE EXCEPTION 'Confirmed finish cannot regress' USING ERRCODE='23514'; END IF;
  IF OLD.status IN('APPROVED','SENDING','UNKNOWN','PROCESSING','SUCCEEDED','PARTIAL') AND NEW.approvals IS DISTINCT FROM OLD.approvals THEN RAISE EXCEPTION 'Used approvals are immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='sponsor_refund_plans' THEN
  IF OLD.advance_coverage IS NOT NULL AND (NEW.advance_coverage IS DISTINCT FROM OLD.advance_coverage OR NEW.funding_mode IS DISTINCT FROM OLD.funding_mode OR NEW.advance_proposed_by IS DISTINCT FROM OLD.advance_proposed_by OR NEW.advance_reviewed_by IS DISTINCT FROM OLD.advance_reviewed_by OR NEW.advance_evidence IS DISTINCT FROM OLD.advance_evidence) THEN RAISE EXCEPTION 'Reserved advance funds cannot be reassigned' USING ERRCODE='23514'; END IF;
  IF OLD.status='CLAIMED' AND (NEW.status<>'CLAIMED' OR NEW.trade_refund_id IS DISTINCT FROM OLD.trade_refund_id) THEN RAISE EXCEPTION 'Claimed refund coverage is frozen' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='sponsor_refund_retries' THEN
  IF OLD.status IN('APPROVED','CLAIMED','REJECTED') AND NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN RAISE EXCEPTION 'Retry approval is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status IN('CLAIMED','REJECTED') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.trade_refund_id IS DISTINCT FROM OLD.trade_refund_id) THEN RAISE EXCEPTION 'Final retry intent is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='sponsor_settlement_items' THEN
  IF OLD.status='SUCCEEDED' AND (NEW.status<>'SUCCEEDED' OR NEW.provider_detail_id IS DISTINCT FROM OLD.provider_detail_id) THEN RAISE EXCEPTION 'Confirmed split cannot regress' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='sponsor_return_items' THEN
  IF OLD.status='SUCCEEDED' AND (NEW.status<>'SUCCEEDED' OR NEW.provider_return_id IS DISTINCT FROM OLD.provider_return_id) THEN RAISE EXCEPTION 'Confirmed return cannot regress' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE name text; BEGIN FOREACH name IN ARRAY ARRAY['sponsor_beneficiaries','sponsor_contracts','sponsor_orders','sponsor_deliveries','sponsor_settlement_batches','sponsor_settlement_items','sponsor_refund_plans','sponsor_refund_retries','sponsor_return_items','sponsor_recovery_cases','sponsor_commerce_operations'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION r6_sponsor_immutable()',name||'_history',name);
END LOOP; END $$;
