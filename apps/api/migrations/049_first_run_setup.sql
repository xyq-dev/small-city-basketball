-- Durable first-instance closure. Runtime may consume, never issue or reopen, setup.
CREATE TABLE first_run_setup (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 initialized_at timestamptz,
 token_hash char(64) CHECK(token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
 token_expires_at timestamptz,
 token_used_at timestamptz,
 CHECK((token_hash IS NULL) = (token_expires_at IS NULL)),
 CHECK(token_used_at IS NULL OR initialized_at IS NOT NULL)
);
-- Only the exact non-login system actors created by existing maintenance code
-- are excluded. Development fixture owners and all ordinary disabled users count.
INSERT INTO first_run_setup(singleton,initialized_at)
SELECT true, CASE WHEN EXISTS(SELECT 1 FROM organizations) OR EXISTS(
 SELECT 1 FROM users WHERE NOT (
  status='DISABLED' AND (
   (email='commerce-system-'||id::text||'@system.invalid'
    AND display_name IN ('离线平台权限维护系统主体','商业账本系统主体')
    AND password_hash ~ '^!SCB_DISABLED_COMMERCE_ACTOR![A-Za-z0-9_-]{86}$') OR
   (email='maintenance-'||id::text||'@system.invalid'
    AND display_name='离线账号维护系统主体'
    AND password_hash ~ '^!SCB_DISABLED_MAINTENANCE_ACTOR![A-Za-z0-9_-]{86}$')
  )
 )
) THEN clock_timestamp() ELSE NULL END;

CREATE FUNCTION first_run_setup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.initialized_at IS NOT NULL THEN
  RAISE EXCEPTION 'First instance setup is permanently closed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER first_run_setup_immutable BEFORE UPDATE OR DELETE ON first_run_setup
FOR EACH ROW EXECUTE FUNCTION first_run_setup_guard();
