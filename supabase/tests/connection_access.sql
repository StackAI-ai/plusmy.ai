begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- assertions:start
set local plpgsql.check_asserts = on;
-- This exact SQL also runs in the Unix-socket-only disposable PostgreSQL harness.
-- Four distinct JWT subjects share authenticated; membership is not a DB role.
insert into auth.users (id) values
  ('ae000000-0000-0000-0000-000000000011'), -- malicious admin
  ('ae000000-0000-0000-0000-000000000012'), -- personal owner
  ('ae000000-0000-0000-0000-000000000013'), -- ordinary member
  ('ae000000-0000-0000-0000-000000000014'); -- outsider
insert into app.workspaces (id, name, slug) values
  ('ae000000-0000-0000-0000-000000000001', 'Access boundary', 'connection-access-test'),
  ('ae000000-0000-0000-0000-000000000002', 'Admin destination', 'connection-access-other');
insert into app.workspace_members (workspace_id, user_id, role) values
  ('ae000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000011', 'admin'),
  ('ae000000-0000-0000-0000-000000000002', 'ae000000-0000-0000-0000-000000000011', 'owner'),
  ('ae000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000012', 'member'),
  ('ae000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000013', 'member');
insert into app.providers (id, display_name) values ('access-test', 'Access test');

do $$
declare
  r text;
  t text;
  p text;
  f regprocedure;
begin
  foreach r in array array['anon', 'authenticated'] loop
    assert not (select rolsuper or rolbypassrls from pg_roles where rolname = r), 'client role must not bypass RLS';
    assert not pg_has_role(r, 'service_role', 'MEMBER'), 'client role must not inherit or SET ROLE service_role';
    foreach t in array array['app.connections', 'app.connection_grants'] loop
      foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        assert not has_table_privilege(r, t, p), format('%s has effective %s on %s (including PUBLIC/inheritance)', r, p, t);
      end loop;
      assert not has_any_column_privilege(r, t, 'INSERT'), 'no column INSERT bypass';
      assert not has_any_column_privilege(r, t, 'UPDATE'), 'no column UPDATE bypass';
    end loop;
    foreach f in array array[
      'app.install_connection_credentials(text,uuid,uuid,text,app.connection_scope,text,text,text,text[],timestamptz,jsonb,text,text,text,text)'::regprocedure,
      'app.install_connection_credentials_v2(text,uuid,uuid,text,app.connection_scope,text,text,text,text[],timestamptz,jsonb,text,text,text,text,boolean)'::regprocedure,
      'app.write_connection_credentials(uuid,text,text,text,text,text,timestamptz,text[])'::regprocedure,
      'app.acquire_connection_refresh_lock(uuid,uuid,integer)'::regprocedure,
      'app.release_connection_refresh_lock(uuid,uuid)'::regprocedure,
      'app.begin_connection_refresh(uuid,uuid,integer)'::regprocedure,
      'app.commit_connection_refresh(uuid,uuid,text,text,text,text,timestamptz,text[])'::regprocedure,
      'app.fail_connection_refresh(uuid,uuid)'::regprocedure,
      'app.begin_connection_job_refresh(uuid,uuid,uuid,integer)'::regprocedure,
      'app.commit_connection_job_refresh(uuid,uuid,uuid,text,text,text,text,timestamptz,text[])'::regprocedure,
      'app.fail_connection_job_refresh(uuid,uuid,uuid)'::regprocedure,
      'app.finish_connection_job(uuid,uuid,text,text,timestamptz,jsonb)'::regprocedure,
      'app.schedule_connection_job_v2(uuid,text,jsonb,timestamptz,integer,uuid)'::regprocedure,
      'app.schedule_connection_sync_for_actor(uuid,uuid,uuid,uuid,jsonb)'::regprocedure,
      'app.resolve_secret(uuid)'::regprocedure,
      'app.put_secret(text,uuid,text,text)'::regprocedure
    ] loop
      assert not has_function_privilege(r, f, 'EXECUTE'), format('%s can invoke privileged %s', r, f);
    end loop;
  end loop;
  assert not exists (select 1 from pg_policies where schemaname = 'app'
    and tablename in ('connections', 'connection_grants') and cmd <> 'SELECT' and permissive = 'PERMISSIVE'), 'no permissive client mutation policy remains';
  assert (select count(*) = 6 from pg_policies where schemaname = 'app'
    and tablename in ('connections', 'connection_grants') and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and permissive = 'RESTRICTIVE' and roles @> array['anon', 'authenticated']::name[]), 'client mutation deny boundaries exist';
  assert (select count(*) = 4 from pg_policies where schemaname = 'app'
    and tablename in ('connections', 'connection_grants', 'connection_credentials', 'connection_sync_jobs')
    and cmd = 'SELECT' and permissive = 'RESTRICTIVE' and roles @> array['anon', 'authenticated']::name[]), 'client restrictive SELECT boundary on all four tables';
  assert (select count(*) = 4 from pg_policies where schemaname = 'app'
    and policyname in ('connections_select_members', 'connection_grants_select_members',
      'connection_credentials_select_admins', 'connection_sync_jobs_select_admins')
    and cmd = 'SELECT' and permissive = 'PERMISSIVE'), 'existing permissive SELECT contracts remain intact';
  assert (select count(*) = 4 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in ('connections', 'connection_grants', 'connection_credentials', 'connection_sync_jobs')
    and c.relrowsecurity), 'all four protected tables enforce RLS';
end;
$$;

set local role service_role;
do $$
declare
  c uuid;
  active_connection uuid;
  generation uuid;
  j uuid;
begin
  assert current_user = 'service_role', 'allowed control uses the actual service DB role';
  c := (app.install_connection_credentials_v2('access-revoked', 'ae000000-0000-0000-0000-000000000001',
    'ae000000-0000-0000-0000-000000000012', 'access-test', 'personal', 'Victim revoked', 'victim-revoked',
    'victim@example.invalid', array['read'], null, '{"account":"victim"}',
    'test-victim-access', 'test-victim-refresh', null, 'Bearer', false) -> 'connection' ->> 'id')::uuid;
  update app.connections set status = 'revoked' where id = c;
  perform set_config('connection.access.revoked_id', c::text, true);
  perform set_config('connection.access.secret_id', (select refresh_token_secret_id::text from app.connection_credentials where connection_id = c), true);
  active_connection := (app.install_connection_credentials_v2('access-active', 'ae000000-0000-0000-0000-000000000001',
    'ae000000-0000-0000-0000-000000000012', 'access-test', 'personal', 'Victim active', 'victim-active',
    null, array['read'], now() + interval '1 hour', '{}',
    'test-active-access', 'test-active-refresh', null, 'Bearer', false) -> 'connection' ->> 'id')::uuid;
  assert app.begin_connection_refresh(active_connection, 'ae000000-0000-0000-0000-000000000020', 300) is not null;
  -- The real legacy release SQL is idempotent and compares the exact lock ID.
  perform app.release_connection_refresh_lock(active_connection, 'ae000000-0000-0000-0000-000000000021');
  assert (select refresh_lock_id = 'ae000000-0000-0000-0000-000000000020'::uuid from app.connections where id = active_connection), 'wrong lock ID cannot release current lease';
  perform app.release_connection_refresh_lock(active_connection, 'ae000000-0000-0000-0000-000000000020');
  perform app.release_connection_refresh_lock(active_connection, 'ae000000-0000-0000-0000-000000000020');
  assert (select refresh_lock_id is null and refresh_lock_expires_at is null from app.connections where id = active_connection), 'release and repeated release both succeed';
  assert app.begin_connection_refresh(active_connection, 'ae000000-0000-0000-0000-000000000021', 300) is not null;
  perform app.release_connection_refresh_lock(active_connection, 'ae000000-0000-0000-0000-000000000020');
  assert (select refresh_lock_id = 'ae000000-0000-0000-0000-000000000021'::uuid from app.connections where id = active_connection), 'late cleanup cannot clear newer lease';
  perform set_config('connection.access.active_id', active_connection::text, true);
  select job_generation into generation from app.connections where id = active_connection;
  j := app.schedule_connection_job_v2(active_connection, 'sync_connection', p_generation => generation);
  assert j is not null, 'service RPC can still enqueue a fenced job';

  insert into app.connections (id, connection_key, workspace_id, provider, scope, status, display_name) values
    ('ae000000-0000-0000-0000-000000000003', 'access-shared', 'ae000000-0000-0000-0000-000000000001', 'access-test', 'workspace', 'active', 'Shared'),
    ('ae000000-0000-0000-0000-000000000004', 'access-other', 'ae000000-0000-0000-0000-000000000002', 'access-test', 'workspace', 'active', 'Other');
  update app.connections set display_name = 'Service updated' where id = 'ae000000-0000-0000-0000-000000000003';
  insert into app.connection_grants (connection_id, scope) values ('ae000000-0000-0000-0000-000000000003', 'service-test');
  update app.connection_grants set granted = false where connection_id = 'ae000000-0000-0000-0000-000000000003';
  assert (select not granted from app.connection_grants where connection_id = 'ae000000-0000-0000-0000-000000000003');
  delete from app.connection_grants where connection_id = 'ae000000-0000-0000-0000-000000000003';
  delete from app.connections where id = 'ae000000-0000-0000-0000-000000000004';
  assert not exists (select 1 from app.connections where id = 'ae000000-0000-0000-0000-000000000004'), 'service direct DELETE still works';
  insert into app.connections (id, connection_key, workspace_id, provider, scope, status, display_name)
  values ('ae000000-0000-0000-0000-000000000004', 'access-other', 'ae000000-0000-0000-0000-000000000002', 'access-test', 'workspace', 'active', 'Other');
  perform app.install_connection_credentials_v2('access-shared', 'ae000000-0000-0000-0000-000000000001',
    null, 'access-test', 'workspace', 'Shared installed', 'shared', null, array['shared-read'], null, '{}',
    'test-shared-access', null, null, 'Bearer', false);
  select job_generation into generation from app.connections where id = 'ae000000-0000-0000-0000-000000000003';
  assert app.schedule_connection_job_v2('ae000000-0000-0000-0000-000000000003', 'sync_connection', p_generation => generation) is not null;
  assert (select count(*) = 4 from app.connections where provider = 'access-test'), 'service reads all personal/shared/workspace rows';
end;
$$;
reset role;

create temp table connection_access_before as
select (select jsonb_agg(to_jsonb(c) order by id) from app.connections c where provider = 'access-test') as connections,
  (select jsonb_agg(to_jsonb(g) order by g.id) from app.connection_grants g join app.connections c on c.id = g.connection_id where c.provider = 'access-test') as grants,
  (select jsonb_agg(to_jsonb(s) order by s.connection_id) from app.connection_credentials s join app.connections c on c.id = s.connection_id where c.provider = 'access-test') as credentials,
  (select jsonb_agg(to_jsonb(j) order by j.id) from app.connection_sync_jobs j join app.connections c on c.id = j.connection_id where c.provider = 'access-test') as jobs;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ae000000-0000-0000-0000-000000000011', true);
do $$
declare
  q text;
begin
  assert current_user = 'authenticated' and auth.uid() = 'ae000000-0000-0000-0000-000000000011'::uuid;
  assert app.has_workspace_role('ae000000-0000-0000-0000-000000000001', array['admin']::app.workspace_role[]);
  assert app.has_workspace_role('ae000000-0000-0000-0000-000000000002', array['owner']::app.workspace_role[]);
  assert not exists (select 1 from app.connections where provider = 'access-test' and scope = 'personal'), 'admin cannot read victim personal connections';
  assert not exists (select 1 from app.connection_grants where connection_id = current_setting('connection.access.revoked_id')::uuid), 'admin cannot read victim grants';
  assert not exists (select 1 from app.connection_credentials where connection_id = current_setting('connection.access.revoked_id')::uuid), 'admin cannot read victim credential references';
  assert not exists (select 1 from app.connection_sync_jobs where connection_id = current_setting('connection.access.active_id')::uuid), 'admin cannot read victim jobs';
  assert (select count(*) = 1 from app.connection_credentials where connection_id = 'ae000000-0000-0000-0000-000000000003'), 'admin retains shared credential-reference reads';
  assert (select count(*) = 1 from app.connection_sync_jobs where connection_id = 'ae000000-0000-0000-0000-000000000003'), 'admin retains shared job reads';
  foreach q in array array[
    $q$update app.connections set owner_user_id = auth.uid() where id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$update app.connections set scope = 'workspace', owner_user_id = null where id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$update app.connections set workspace_id = 'ae000000-0000-0000-0000-000000000002' where id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$update app.connections set status = 'active' where id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$update app.connections set connection_key = 'attacker-key', external_account_id = 'attacker' where id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$update app.connections set refresh_lock_id = null, refresh_lock_expires_at = null where id = current_setting('connection.access.active_id')::uuid$q$,
    $q$update app.connections set job_generation = gen_random_uuid() where id = current_setting('connection.access.active_id')::uuid$q$,
    $q$update app.connections set granted_scopes = array['write'] where id = current_setting('connection.access.active_id')::uuid$q$,
    $q$insert into app.connections (connection_key, workspace_id, provider, scope, owner_user_id, status, display_name) values ('attacker-install', 'ae000000-0000-0000-0000-000000000001', 'access-test', 'personal', auth.uid(), 'active', 'Attacker')$q$,
    $q$delete from app.connections where id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$insert into app.connection_grants (connection_id, scope) values (current_setting('connection.access.revoked_id')::uuid, 'write')$q$,
    $q$update app.connection_grants set scope = 'write', granted = false, connection_id = 'ae000000-0000-0000-0000-000000000003' where connection_id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$delete from app.connection_grants where connection_id = current_setting('connection.access.revoked_id')::uuid$q$,
    $q$truncate app.connection_grants$q$,
    $q$truncate app.connections cascade$q$,
    $q$select app.begin_connection_refresh(current_setting('connection.access.active_id')::uuid, gen_random_uuid(), 300)$q$,
    $q$select app.resolve_secret(current_setting('connection.access.secret_id')::uuid)$q$
  ] loop
    begin
      execute q;
      raise exception 'Client write unexpectedly accepted: %', q;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;

-- ACLs are additive. An inherited grant (or a surviving column grant) must not
-- resurrect the deleted admin policies. This is rolled back with the suite.
create role connection_access_test_writer nologin;
grant connection_access_test_writer to authenticated;
grant insert, update, delete on app.connections, app.connection_grants to connection_access_test_writer;
grant update (job_generation, refresh_lock_id, refresh_lock_expires_at) on app.connections to authenticated;
create policy access_test_extra_insert on app.connections for insert to authenticated with check (true);
create policy access_test_extra_update on app.connections for update to authenticated using (true) with check (true);
create policy access_test_extra_delete on app.connections for delete to authenticated using (true);
create policy access_test_extra_insert on app.connection_grants for insert to authenticated with check (true);
create policy access_test_extra_update on app.connection_grants for update to authenticated using (true) with check (true);
create policy access_test_extra_delete on app.connection_grants for delete to authenticated using (true);
set local role authenticated;
do $$
declare
  n integer;
begin
  assert has_table_privilege(current_user, 'app.connections', 'UPDATE'), 'inherited grant is effective in the test';
  update app.connections set owner_user_id = auth.uid(), status = 'active' where id = current_setting('connection.access.revoked_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies takeover despite inherited UPDATE';
  update app.connections set job_generation = gen_random_uuid(), refresh_lock_id = null, refresh_lock_expires_at = null where id = current_setting('connection.access.active_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies fence edits despite column UPDATE';
  update app.connections set job_generation = gen_random_uuid(), status = 'revoked' where id = 'ae000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies writes to visible shared rows too';
  delete from app.connections where id = current_setting('connection.access.revoked_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies inherited DELETE';
  update app.connection_grants set granted = false where connection_id = current_setting('connection.access.revoked_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies inherited grant UPDATE';
  update app.connection_grants set granted = false where connection_id = 'ae000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies writes to visible shared grants too';
  delete from app.connection_grants where connection_id = current_setting('connection.access.revoked_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'RLS denies inherited grant DELETE';
  begin
    insert into app.connections (connection_key, workspace_id, provider, status, display_name)
    values ('inherited-install', 'ae000000-0000-0000-0000-000000000001', 'access-test', 'active', 'Denied');
    raise exception 'Inherited INSERT unexpectedly accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into app.connection_grants (connection_id, scope)
    values (current_setting('connection.access.revoked_id')::uuid, 'inherited-write');
    raise exception 'Inherited grant INSERT unexpectedly accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', 'ae000000-0000-0000-0000-000000000012', true);
do $$
declare n integer;
begin
  update app.connections set status = 'active' where id = current_setting('connection.access.revoked_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'even a visible personal owner row has no inherited DML path';
end;
$$;
reset role;
drop policy access_test_extra_insert on app.connections;
drop policy access_test_extra_update on app.connections;
drop policy access_test_extra_delete on app.connections;
drop policy access_test_extra_insert on app.connection_grants;
drop policy access_test_extra_update on app.connection_grants;
drop policy access_test_extra_delete on app.connection_grants;
revoke update (job_generation, refresh_lock_id, refresh_lock_expires_at) on app.connections from authenticated;
revoke connection_access_test_writer from authenticated;
drop owned by connection_access_test_writer;
drop role connection_access_test_writer;

-- An unexpected inherited anon grant and permissive policies must also fail
-- closed. These roles and policies exist only inside the test transaction.
create role connection_access_test_anon nologin;
grant connection_access_test_anon to anon;
grant usage on schema app, auth to connection_access_test_anon;
grant select, insert, update, delete on app.connections, app.connection_grants to connection_access_test_anon;
create policy access_test_anon_select on app.connections for select to anon using (true);
create policy access_test_anon_update on app.connections for update to anon using (true) with check (true);
create policy access_test_anon_insert on app.connections for insert to anon with check (true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare n integer;
begin
  assert not exists (select 1 from app.connections where provider = 'access-test'), 'anon cannot read through an extra permissive policy';
  update app.connections set status = 'revoked' where id = 'ae000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'anon cannot update through an extra permissive policy';
  begin
    insert into app.connections (connection_key, workspace_id, provider, status, display_name)
    values ('anon-install', 'ae000000-0000-0000-0000-000000000001', 'access-test', 'active', 'Denied');
    raise exception 'Anon INSERT unexpectedly accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
drop policy access_test_anon_select on app.connections;
drop policy access_test_anon_update on app.connections;
drop policy access_test_anon_insert on app.connections;
revoke connection_access_test_anon from anon;
drop owned by connection_access_test_anon;
drop role connection_access_test_anon;

-- Model unexpected permissive policies without altering any live policy. They
-- cannot OR around the authenticated restrictive visibility/admin boundaries.
create policy access_test_extra_select on app.connections for select to authenticated using (true);
create policy access_test_extra_select on app.connection_grants for select to authenticated using (true);
create policy access_test_extra_select on app.connection_credentials for select to authenticated using (true);
create policy access_test_extra_select on app.connection_sync_jobs for select to authenticated using (true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ae000000-0000-0000-0000-000000000011', true);
do $$
begin
  assert not exists (select 1 from app.connections where provider = 'access-test' and scope = 'personal'), 'extra permissive SELECT cannot expose victim personal connections';
  assert not exists (select 1 from app.connection_grants where connection_id = current_setting('connection.access.revoked_id')::uuid), 'extra permissive SELECT cannot expose victim grants';
  assert not exists (select 1 from app.connection_credentials where connection_id = current_setting('connection.access.revoked_id')::uuid), 'extra permissive SELECT cannot expose victim credentials';
  assert not exists (select 1 from app.connection_sync_jobs where connection_id = current_setting('connection.access.active_id')::uuid), 'extra permissive SELECT cannot expose victim jobs';
end;
$$;

-- Member reads narrow to shared/own connections and grants. Credential/job
-- references keep the preexisting admin requirement, even for personal owners.
select set_config('request.jwt.claim.sub', 'ae000000-0000-0000-0000-000000000013', true);
do $$
begin
  assert app.is_workspace_member('ae000000-0000-0000-0000-000000000001');
  assert not app.has_workspace_role('ae000000-0000-0000-0000-000000000001', array['owner','admin']::app.workspace_role[]);
  assert (select count(*) = 1 from app.connections where provider = 'access-test' and scope = 'workspace'), 'member retains shared connection reads';
  assert not exists (select 1 from app.connections where provider = 'access-test' and scope = 'personal'), 'member cannot read victim personal metadata';
  assert not exists (select 1 from app.connection_grants where connection_id = current_setting('connection.access.revoked_id')::uuid), 'member cannot read victim personal grants';
  assert (select count(*) = 1 from app.connection_grants where connection_id = 'ae000000-0000-0000-0000-000000000003'), 'member retains shared grant reads';
  assert not exists (select 1 from app.connection_credentials where connection_id in (current_setting('connection.access.revoked_id')::uuid, current_setting('connection.access.active_id')::uuid, 'ae000000-0000-0000-0000-000000000003'::uuid)), 'member cannot read victim or shared credential references';
  assert not exists (select 1 from app.connection_sync_jobs where connection_id in (current_setting('connection.access.active_id')::uuid, 'ae000000-0000-0000-0000-000000000003'::uuid)), 'member cannot read victim or shared jobs';
  assert not exists (select 1 from app.connections where workspace_id = 'ae000000-0000-0000-0000-000000000002'), 'member cannot read other workspace';
end;
$$;
select set_config('request.jwt.claim.sub', 'ae000000-0000-0000-0000-000000000012', true);
do $$
begin
  assert (select count(*) = 2 from app.connections where provider = 'access-test' and owner_user_id = auth.uid()), 'personal owner retains reads';
  assert (select count(*) = 2 from app.connection_grants where connection_id in (current_setting('connection.access.revoked_id')::uuid, current_setting('connection.access.active_id')::uuid)), 'personal owner sees own grants';
  assert not exists (select 1 from app.connection_credentials where connection_id in (current_setting('connection.access.revoked_id')::uuid, current_setting('connection.access.active_id')::uuid)), 'non-admin personal owner does not gain credential-reference reads';
  assert not exists (select 1 from app.connection_sync_jobs where connection_id = current_setting('connection.access.active_id')::uuid), 'non-admin personal owner does not gain job reads';
  begin
    perform app.resolve_secret(current_setting('connection.access.secret_id')::uuid);
    raise exception 'Personal owner unexpectedly resolved a plaintext Vault secret';
  exception when insufficient_privilege then null; end;
  begin
    update app.connections set status = 'active' where connection_key = 'access-revoked';
    raise exception 'Personal owner unexpectedly has direct DML; use authorized server workflows';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
update app.workspace_members set role = 'admin' where workspace_id = 'ae000000-0000-0000-0000-000000000001'
  and user_id = 'ae000000-0000-0000-0000-000000000012';
set local role authenticated;
do $$
begin
  assert (select count(*) = 2 from app.connection_credentials where connection_id in (current_setting('connection.access.revoked_id')::uuid, current_setting('connection.access.active_id')::uuid)), 'admin personal owner retains own credential-reference reads';
  assert (select count(*) = 1 from app.connection_sync_jobs where connection_id = current_setting('connection.access.active_id')::uuid), 'admin personal owner retains own job reads';
end;
$$;
reset role;
delete from app.workspace_members where workspace_id = 'ae000000-0000-0000-0000-000000000001'
  and user_id = 'ae000000-0000-0000-0000-000000000012';
set local role authenticated;
do $$
begin
  assert not exists (select 1 from app.connections where provider = 'access-test'), 'removed member cannot read even their own personal connections';
  assert not exists (select 1 from app.connection_grants), 'removed member cannot read personal grants';
  assert not exists (select 1 from app.connection_credentials), 'removed member cannot read personal credential references';
  assert not exists (select 1 from app.connection_sync_jobs), 'removed member cannot read personal jobs';
end;
$$;
select set_config('request.jwt.claim.sub', 'ae000000-0000-0000-0000-000000000014', true);
do $$
begin
  assert not app.is_workspace_member('ae000000-0000-0000-0000-000000000001');
  assert not exists (select 1 from app.connections where provider = 'access-test'), 'outsider cannot read connections';
  assert not exists (select 1 from app.connection_grants), 'outsider cannot read grants by known connection ID either';
  assert not exists (select 1 from app.connection_credentials), 'outsider cannot read credential references';
  assert not exists (select 1 from app.connection_sync_jobs), 'outsider cannot read jobs';
end;
$$;
reset role;

drop policy access_test_extra_select on app.connections;
drop policy access_test_extra_select on app.connection_grants;
drop policy access_test_extra_select on app.connection_credentials;
drop policy access_test_extra_select on app.connection_sync_jobs;
do $$
begin
  assert (select connections from connection_access_before) = (select jsonb_agg(to_jsonb(c) order by id) from app.connections c where provider = 'access-test'), 'all connection fields unchanged after attacks';
  assert (select grants from connection_access_before) = (select jsonb_agg(to_jsonb(g) order by g.id) from app.connection_grants g join app.connections c on c.id = g.connection_id where c.provider = 'access-test'), 'grants unchanged after attacks';
  assert (select credentials from connection_access_before) = (select jsonb_agg(to_jsonb(s) order by s.connection_id) from app.connection_credentials s join app.connections c on c.id = s.connection_id where c.provider = 'access-test'), 'credential references unchanged after attacks';
  assert (select jobs from connection_access_before) = (select jsonb_agg(to_jsonb(j) order by j.id) from app.connection_sync_jobs j join app.connections c on c.id = j.connection_id where c.provider = 'access-test'), 'queued jobs unchanged after attacks';
  assert (select app.resolve_secret(refresh_token_secret_id) = 'test-victim-refresh' from app.connection_credentials where connection_id = (select id from app.connections where connection_key = 'access-revoked')), 'victim Vault-backed credential unchanged';
end;
$$;
-- assertions:end
select pass('connection access ACL, RLS, principal, service workflow and immutable-state assertions completed');
select * from finish();
rollback;
