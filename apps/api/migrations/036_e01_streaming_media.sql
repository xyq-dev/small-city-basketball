-- E01/E02: independent broadcast authorization, durable intent/fences, and large media jobs.
CREATE TABLE live_channel_accounts (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), template_key text NOT NULL,
 platform text NOT NULL CHECK(platform IN('DOUYIN','WECHAT_CHANNELS','KUAISHOU','BILIBILI')),
 label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 80), slot_key char(64) NOT NULL,
 credential_ciphertext bytea NOT NULL, verified_until timestamptz NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 revoked_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id)
);
CREATE TABLE broadcast_sessions (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), event_id uuid NOT NULL, match_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id), approved_at timestamptz, approval_expires_at timestamptz,
 recording_approved_by uuid REFERENCES users(id), recording_approved_at timestamptz, rights_revoked_at timestamptz,
 desired text NOT NULL DEFAULT 'DRAFT' CHECK(desired IN('DRAFT','RUNNING','PAUSED','STOPPED')),
 observed text NOT NULL DEFAULT 'IDLE' CHECK(observed IN('IDLE','STARTING','LIVE','PARTIAL','INTERRUPTED','STOPPING','ENDED','UNKNOWN')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), epoch integer NOT NULL DEFAULT 0 CHECK(epoch>=0), source_epoch integer NOT NULL DEFAULT 0 CHECK(source_epoch>=0),
 source_stream_name text UNIQUE, source_token_hash char(64), source_owner_id uuid REFERENCES users(id), source_session_id uuid REFERENCES sessions(id),
 source_device_id uuid, source_expires_at timestamptz, source_heartbeat_at timestamptz,
 maximum_seconds integer NOT NULL CHECK(maximum_seconds BETWEEN 30 AND 14400), budget_fen integer NOT NULL CHECK(budget_fen BETWEEN 1 AND 1000000),
 record_enabled boolean NOT NULL, started_at timestamptz, ended_at timestamptz, source_stopped boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(org_id,id), FOREIGN KEY(org_id,event_id,match_id) REFERENCES published_matches(org_id,event_id,id)
);
CREATE UNIQUE INDEX e01_one_active_match ON broadcast_sessions(org_id,match_id) WHERE observed<>'ENDED';
CREATE TABLE live_relays (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, session_id uuid NOT NULL, channel_id uuid NOT NULL,
 desired text NOT NULL DEFAULT 'STOPPED' CHECK(desired IN('RUNNING','STOPPED')),
 state text NOT NULL DEFAULT 'IDLE' CHECK(state IN('IDLE','STARTING','CONNECTED','FAILED','STOPPING','STOPPED','UNKNOWN')),
 epoch integer NOT NULL DEFAULT 0 CHECK(epoch>=0), operation_key text, provider_id text, observed_at timestamptz,
 slot_key char(64) NOT NULL, slot_held boolean NOT NULL DEFAULT false,
 worker_token uuid, worker_until timestamptz, error_code text,
 UNIQUE(org_id,id), UNIQUE(session_id,channel_id), FOREIGN KEY(org_id,session_id) REFERENCES broadcast_sessions(org_id,id),
 FOREIGN KEY(org_id,channel_id) REFERENCES live_channel_accounts(org_id,id)
);
CREATE UNIQUE INDEX e01_external_slot_held ON live_relays(slot_key) WHERE slot_held;
CREATE TABLE stream_command_receipts (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid NOT NULL REFERENCES users(id),
 request_hash char(64) NOT NULL, session_id uuid NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), FOREIGN KEY(org_id,session_id) REFERENCES broadcast_sessions(org_id,id)
);
CREATE TABLE stream_jobs (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, session_id uuid NOT NULL, relay_id uuid,
 kind text NOT NULL CHECK(kind IN('START','STOP','STOP_SOURCE')), epoch integer NOT NULL, target_epoch integer,
 operation_key text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','RUNNING','SUCCEEDED','UNKNOWN','FAILED')),
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0), lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), FOREIGN KEY(org_id,session_id) REFERENCES broadcast_sessions(org_id,id),
 FOREIGN KEY(org_id,relay_id) REFERENCES live_relays(org_id,id)
);
CREATE TABLE stream_usage_ledger (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, session_id uuid NOT NULL, source_key text NOT NULL UNIQUE,
 unit text NOT NULL CHECK(unit IN('RESERVED_FEN','OBSERVED_SECOND')), quantity bigint NOT NULL CHECK(quantity>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), FOREIGN KEY(org_id,session_id) REFERENCES broadcast_sessions(org_id,id)
);
CREATE TABLE live_media_jobs (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, session_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN('RECORDING','TRANSCODE','HIGHLIGHTS')),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN('QUEUED','RUNNING','READY','FAILED','CANCELLED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), source_artifact_id uuid, artifact_id uuid,
 source_epoch integer NOT NULL, intervals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(intervals)='array'),
 anchor_at timestamptz, anchor_offset_ms integer, anchor_verified_by uuid REFERENCES users(id),
 source_match_id uuid, source_confirmation_id uuid,
 FOREIGN KEY(org_id,source_match_id,source_confirmation_id) REFERENCES result_confirmations(org_id,match_id,id),
 worker_token uuid, worker_until timestamptz, cancel_requested_at timestamptz, error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(org_id,session_id) REFERENCES broadcast_sessions(org_id,id), UNIQUE(org_id,id)
);
CREATE UNIQUE INDEX e02_one_recording_epoch ON live_media_jobs(session_id,source_epoch) WHERE kind='RECORDING';
CREATE TABLE live_media_artifacts (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, session_id uuid NOT NULL, job_id uuid NOT NULL UNIQUE,
 file_name text NOT NULL UNIQUE CHECK(file_name ~ '^[a-f0-9-]{36}\.mp4$'), sha256 char(64) NOT NULL,
 byte_length bigint NOT NULL CHECK(byte_length BETWEEN 1 AND 21474836480), duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 14400000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), public_key text UNIQUE,
 published_by uuid REFERENCES users(id), published_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), FOREIGN KEY(org_id,session_id) REFERENCES broadcast_sessions(org_id,id),
 FOREIGN KEY(org_id,job_id) REFERENCES live_media_jobs(org_id,id), UNIQUE(org_id,id)
);
ALTER TABLE live_media_jobs ADD CONSTRAINT e02_source_artifact_fk FOREIGN KEY(org_id,source_artifact_id) REFERENCES live_media_artifacts(org_id,id);
ALTER TABLE live_media_jobs ADD CONSTRAINT e02_result_artifact_fk FOREIGN KEY(org_id,artifact_id) REFERENCES live_media_artifacts(org_id,id);
CREATE FUNCTION e01_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Streaming receipts and usage are append only'; END $$;
CREATE TRIGGER e01_receipt_append_only BEFORE UPDATE OR DELETE ON stream_command_receipts FOR EACH ROW EXECUTE FUNCTION e01_append_only();
CREATE TRIGGER e01_usage_append_only BEFORE UPDATE OR DELETE ON stream_usage_ledger FOR EACH ROW EXECUTE FUNCTION e01_append_only();
CREATE FUNCTION e01_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.org_id<>OLD.org_id OR NEW.event_id<>OLD.event_id OR NEW.match_id<>OLD.match_id OR NEW.created_by<>OLD.created_by OR NEW.epoch<OLD.epoch OR NEW.source_epoch<OLD.source_epoch OR NEW.version<OLD.version OR (OLD.desired='STOPPED' AND NEW.desired<>'STOPPED') THEN RAISE EXCEPTION 'Streaming identity and terminal fences are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER e01_session_invariants BEFORE UPDATE ON broadcast_sessions FOR EACH ROW EXECUTE FUNCTION e01_session_guard();

CREATE FUNCTION e02_job_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.org_id,NEW.session_id,NEW.created_by,NEW.kind,NEW.source_artifact_id,NEW.source_epoch,NEW.source_match_id,NEW.source_confirmation_id,NEW.intervals) IS DISTINCT FROM (OLD.org_id,OLD.session_id,OLD.created_by,OLD.kind,OLD.source_artifact_id,OLD.source_epoch,OLD.source_match_id,OLD.source_confirmation_id,OLD.intervals) THEN RAISE EXCEPTION 'Media source identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER e02_job_identity BEFORE UPDATE ON live_media_jobs FOR EACH ROW EXECUTE FUNCTION e02_job_identity_guard();
