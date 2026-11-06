-- COS01 database invariants. Run ONLY in an isolated scb_test_* database after loading the
-- synthetic legacy-007.json fixture and applying migrations 001--049. This script rolls back
-- every test row. The fixture supplies real event/match/roster FK targets; no triggers are
-- disabled for any assertion below. Cloud bytes and multi-connection races are tested elsewhere.
BEGIN;
DO $$ BEGIN
  IF current_database() !~ '^scb_test_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'COS schema tests require an isolated database named scb_test_*';
  END IF;
END; $$;
CREATE TEMP TABLE cos_schema_assertions (name text PRIMARY KEY);
CREATE FUNCTION pg_temp.cos_expect_error(label text,statement text,expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>expected_state THEN
      RAISE EXCEPTION '%: unexpected SQLSTATE %, expected %',label,SQLSTATE,expected_state;
    END IF;
    INSERT INTO cos_schema_assertions VALUES(label);
    RETURN;
  END;
  RAISE EXCEPTION '%: statement unexpectedly succeeded',label;
END;
$$;

DO $$
DECLARE
  org uuid := 'f28a63af-47e2-49a3-918a-0b7c2d124d88';
  event uuid := '5765b614-4a84-4612-a598-3eb73292c6fb';
  match uuid := 'c02d20e0-9a0a-478c-b867-0ef618fb6bd2';
  actor uuid := 'b2ccd34f-e77d-4831-bd23-52f3622c8e72';
  object_id uuid := 'c0490000-0000-4000-8000-000000000001';
  database_id uuid := 'c0490000-0000-4000-8000-000000000002';
  other_org uuid := 'c0490000-0000-4000-8000-000000000003';
  wrong_scope_id uuid := 'c0490000-0000-4000-8000-000000000004';
  deleted_id uuid := 'c0490000-0000-4000-8000-000000000005';
  fresh_id uuid := 'c0490000-0000-4000-8000-000000000006';
  stale_id uuid := 'c0490000-0000-4000-8000-000000000007';
  dual_id uuid := 'c0490000-0000-4000-8000-000000000008';
  bytes bytea := convert_to('COS01 schema-only synthetic byte payload','UTF8');
  digest text;
  insert_file text;
BEGIN
  digest := encode(sha256(bytes),'hex');
  insert_file := 'INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by,cos_object_id) VALUES(%L,%L,%L,%L,''MATCH_IMAGE'',''synthetic.png'',''image/png'',%s,%L,%L,%L,%L)';

  EXECUTE format(insert_file,database_id,org,event,match,octet_length(bytes),digest,bytes,actor,NULL);
  IF NOT EXISTS(SELECT 1 FROM media_files WHERE id=database_id AND payload=bytes AND cos_object_id IS NULL) THEN
    RAISE EXCEPTION 'Database-backed file compatibility failed';
  END IF;
  INSERT INTO cos_schema_assertions VALUES('old database-backed content remains supported');

  INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES
    (object_id,org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||org||'/'||object_id||'/'||gen_random_uuid());
  EXECUTE format(insert_file,object_id,org,event,match,octet_length(bytes),digest,NULL,actor,object_id);
  IF NOT EXISTS(SELECT 1 FROM media_files WHERE id=object_id AND payload IS NULL AND cos_object_id=object_id) THEN
    RAISE EXCEPTION 'COS-backed file did not persist metadata only';
  END IF;
  INSERT INTO cos_schema_assertions VALUES('COS files persist metadata without database payload');

  PERFORM pg_temp.cos_expect_error('active object cannot be marked deleted',
    format('UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=%L',object_id),'23514');
  PERFORM pg_temp.cos_expect_error('object identity cannot be changed',
    format('UPDATE media_cos_objects SET region=''ap-shanghai'' WHERE id=%L',object_id),'23514');
  PERFORM pg_temp.cos_expect_error('object receipt cannot be deleted',
    format('DELETE FROM media_cos_objects WHERE id=%L',object_id),'23514');
  PERFORM pg_temp.cos_expect_error('file cannot switch storage reference',
    format('UPDATE media_files SET cos_object_id=NULL,payload=%L,version=version+1 WHERE id=%L',bytes,object_id),'23514');
  PERFORM pg_temp.cos_expect_error('purge requires prior revoke',
    format('UPDATE media_files SET purged_at=clock_timestamp(),purged_by=%L,version=version+1 WHERE id=%L',actor,object_id),'23514');
  PERFORM pg_temp.cos_expect_error('file without either storage source is invalid',
    format(insert_file,gen_random_uuid(),org,event,match,octet_length(bytes),digest,NULL,actor,NULL),'23514');

  -- A staging receipt for another organization cannot be attached even when its file ID matches.
  INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES
    (wrong_scope_id,other_org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||other_org||'/'||wrong_scope_id||'/'||gen_random_uuid());
  PERFORM pg_temp.cos_expect_error('cross-organization object association is forbidden',
    format(insert_file,wrong_scope_id,org,event,match,octet_length(bytes),digest,NULL,actor,wrong_scope_id),'23514');
  INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES
    (dual_id,org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||org||'/'||dual_id||'/'||gen_random_uuid());
  PERFORM pg_temp.cos_expect_error('database payload and COS reference cannot coexist',
    format(insert_file,dual_id,org,event,match,octet_length(bytes),digest,bytes,actor,dual_id),'23514');

  INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key,created_at) VALUES
    (deleted_id,org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||org||'/'||deleted_id||'/'||gen_random_uuid(),clock_timestamp()-interval '2 days');
  UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=deleted_id;
  PERFORM pg_temp.cos_expect_error('deleted object cannot be linked',
    format(insert_file,deleted_id,org,event,match,octet_length(bytes),digest,NULL,actor,deleted_id),'23514');
  PERFORM pg_temp.cos_expect_error('deleted object receipt cannot be revived',
    format('UPDATE media_cos_objects SET deleted_at=NULL WHERE id=%L',deleted_id),'23514');

  INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES
    (fresh_id,org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||org||'/'||fresh_id||'/'||gen_random_uuid());
  PERFORM pg_temp.cos_expect_error('fresh orphan observes upload grace period',
    format('UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=%L',fresh_id),'23514');
  INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key,created_at) VALUES
    (stale_id,org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||org||'/'||stale_id||'/'||gen_random_uuid(),clock_timestamp()-interval '2 days');
  UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=stale_id;
  INSERT INTO cos_schema_assertions VALUES('stale orphan may record successful cleanup');

  UPDATE media_files SET revoked_at=clock_timestamp(),revoked_by=actor,version=version+1 WHERE id=object_id;
  PERFORM pg_temp.cos_expect_error('revoked but retained object still cannot be deleted',
    format('UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=%L',object_id),'23514');
  UPDATE media_files SET purged_at=clock_timestamp(),purged_by=actor,version=version+1 WHERE id=object_id;
  IF NOT EXISTS(SELECT 1 FROM media_files WHERE id=object_id AND cos_object_id=object_id AND payload IS NULL AND purged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'COS purge did not preserve the cleanup reference';
  END IF;
  UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=object_id;
  INSERT INTO cos_schema_assertions VALUES('revoked then purged file retains reference and permits cleanup');
END;
$$;

DO $$
DECLARE
  org uuid := 'f28a63af-47e2-49a3-918a-0b7c2d124d88';
  event uuid := '5765b614-4a84-4612-a598-3eb73292c6fb';
  match uuid := 'c02d20e0-9a0a-478c-b867-0ef618fb6bd2';
  actor uuid := 'b2ccd34f-e77d-4831-bd23-52f3622c8e72';
  object_id uuid;
  reservation_id uuid := gen_random_uuid();
  remaining bigint;
  chunk integer;
  insert_file text;
BEGIN
  insert_file := 'INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by,cos_object_id) VALUES(%L,%L,%L,%L,''MATCH_IMAGE'',''quota.png'',''image/png'',%s,%L,%L,%L,%L)';
  INSERT INTO media_upload_sessions(id,org_id,event_id,match_id,created_by,client_request_id,
    purpose,file_name,content_type,byte_length,sha256,chunk_size,chunk_count,expires_at)
    VALUES(reservation_id,org,event,match,actor,gen_random_uuid(),'MATCH_IMAGE','reserved.png',
      'image/png',8388608,repeat('0',64),524288,16,clock_timestamp()+interval '1 hour');
  SELECT 134217728-COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=org AND purged_at IS NULL),0)
    -COALESCE((SELECT sum(byte_length) FROM media_upload_sessions WHERE org_id=org AND status='OPEN' AND expires_at>now()),0)
    INTO remaining;
  WHILE remaining>0 LOOP
    chunk := least(8388608,remaining);
    object_id := gen_random_uuid();
    INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES
      (object_id,org,'synthetic-1234567890','ap-guangzhou','scb-media/v1/'||org||'/'||object_id||'/'||gen_random_uuid());
    EXECUTE format(insert_file,object_id,org,event,match,chunk,repeat('0',64),NULL,actor,object_id);
    remaining := remaining-chunk;
  END LOOP;
  INSERT INTO cos_schema_assertions VALUES('COS-backed bytes and open session reservations share organization quota');
  PERFORM pg_temp.cos_expect_error('database upload cannot bypass full COS quota',
    format(insert_file,gen_random_uuid(),org,event,match,1,encode(sha256(decode('00','hex')),'hex'),decode('00','hex'),actor,NULL),'23514');
  PERFORM pg_temp.cos_expect_error('upload session reservation cannot bypass full COS quota',
    format('INSERT INTO media_upload_sessions(id,org_id,event_id,match_id,created_by,client_request_id,purpose,file_name,content_type,byte_length,sha256,chunk_size,chunk_count,expires_at) VALUES(%L,%L,%L,%L,%L,%L,''MATCH_IMAGE'',''quota.png'',''image/png'',1,%L,524288,1,clock_timestamp()+interval ''1 hour'')',
      gen_random_uuid(),org,event,match,actor,gen_random_uuid(),repeat('0',64)),'23514');

  -- Revocation keeps bytes charged; explicit purge frees them without removing audit metadata.
  UPDATE media_files SET revoked_at=clock_timestamp(),revoked_by=actor,version=version+1 WHERE id=object_id;
  PERFORM pg_temp.cos_expect_error('revoked COS file continues consuming quota',
    format(insert_file,gen_random_uuid(),org,event,match,1,encode(sha256(decode('00','hex')),'hex'),decode('00','hex'),actor,NULL),'23514');
  UPDATE media_files SET purged_at=clock_timestamp(),purged_by=actor,version=version+1 WHERE id=object_id;
  EXECUTE format(insert_file,gen_random_uuid(),org,event,match,1,encode(sha256(decode('00','hex')),'hex'),decode('00','hex'),actor,NULL);
  INSERT INTO cos_schema_assertions VALUES('explicit purge releases logical quota for a database upload');
END;
$$;

SELECT name FROM cos_schema_assertions ORDER BY name;
ROLLBACK;
