begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- assertions:start
-- The disposable PG harness executes this exact block without requiring pgTAP.
insert into app.workspaces (id, name, slug)
values ('ac000000-0000-0000-0000-000000000001', 'Job fencing', 'job-fencing-test');
insert into app.providers (id, display_name) values ('job-test', 'Job test') on conflict (id) do nothing;

do $$
declare
  c uuid := 'ac000000-0000-0000-0000-000000000002';
  g uuid;
  j uuid;
  successor uuid;
  a app.connection_sync_jobs%rowtype;
  b app.connection_sync_jobs%rowtype;
  lease uuid := gen_random_uuid();
  result text;
begin
  insert into app.connections (id, connection_key, workspace_id, provider, scope, status, display_name)
  values (c, 'job-fencing-test', 'ac000000-0000-0000-0000-000000000001', 'job-test', 'workspace', 'active', 'Original');
  select job_generation into g from app.connections where id = c;

  assert not has_function_privilege('authenticated', 'app.finish_connection_job(uuid,uuid,text,text,timestamptz,jsonb)', 'execute');
  assert not has_function_privilege('anon', 'app.claim_connection_sync_jobs_v2(text,integer,integer)', 'execute');
  assert not has_function_privilege('authenticated', 'app.schedule_connection_job_v2(uuid,text,jsonb,timestamptz,integer,uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'app.begin_connection_job_refresh(uuid,uuid,uuid,integer)', 'execute');
  assert not has_function_privilege('authenticated', 'app.commit_connection_job_refresh(uuid,uuid,uuid,text,text,text,text,timestamptz,text[])', 'execute');
  assert not has_function_privilege('anon', 'app.fail_connection_job_refresh(uuid,uuid,uuid)', 'execute');
  assert not has_function_privilege('service_role', 'app.lock_connection_job(uuid,uuid)', 'execute');
  assert has_function_privilege('service_role', 'app.finish_connection_job(uuid,uuid,text,text,timestamptz,jsonb)', 'execute');
  begin
    perform app.claim_connection_sync_jobs('legacy');
    raise exception 'legacy claim unexpectedly accepted';
  exception when sqlstate '55000' then null; end;
  begin
    perform app.schedule_connection_job(c, 'sync_connection');
    raise exception 'legacy producer unexpectedly accepted';
  exception when sqlstate '55000' then null; end;

  assert app.schedule_connection_job_v2(c, 'sync_connection') is null, 'missing generation rejected';
  j := app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g);
  assert j = app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g), 'queued dedupe retained';
  select * into a from app.claim_connection_sync_jobs_v2('same-worker', 1);
  assert a.id = j and a.claim_id is not null and a.attempts = 1, 'first claim has ownership';
  assert app.finish_connection_job(j, null, 'succeeded') is null, 'null claim fails closed';
  assert app.finish_connection_job(j, gen_random_uuid(), 'queued') is null, 'wrong claim fails closed';

  update app.connection_sync_jobs set started_at = clock_timestamp() - interval '1 hour' where id = j;
  select * into b from app.claim_connection_sync_jobs_v2('same-worker', 1, 1);
  assert b.id = j and b.claim_id <> a.claim_id and b.attempts = 2, 'same worker gets a new token on reclaim';
  assert app.finish_connection_job(j, a.claim_id, 'succeeded', p_connection_update => '{"display_name":"stale"}') is null;
  assert app.finish_connection_job(j, a.claim_id, 'queued') is null;
  assert app.finish_connection_job(j, a.claim_id, 'dead_letter') is null;
  assert (select display_name = 'Original' from app.connections where id = c), 'stale metadata rejected';
  assert app.finish_connection_job(j, b.claim_id, 'succeeded', p_connection_update => '{"display_name":"fresh"}') = 'succeeded';
  assert app.finish_connection_job(j, b.claim_id, 'queued') is null, 'duplicate completion cannot requeue';
  assert (select display_name = 'fresh' from app.connections where id = c);

  -- A pending successor and a stale processing row must coexist without a unique-index failure.
  j := app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  successor := app.schedule_connection_job_v2(c, 'sync_connection', '{"new":true}', now() + interval '1 day', 4, g);
  update app.connection_sync_jobs set started_at = clock_timestamp() - interval '1 hour' where id = j;
  select * into b from app.claim_connection_sync_jobs_v2('worker', 1, 1);
  assert b.id = j, 'stale row reclaimed directly while future successor remains queued';
  assert app.finish_connection_job(j, b.claim_id, 'queued', 'failure', now() + interval '1 minute') = 'canceled';
  assert (select payload = '{"new":true}'::jsonb and status = 'queued' from app.connection_sync_jobs where id = successor), 'successor not overwritten by retry';
  update app.connection_sync_jobs set status = 'canceled' where id = successor;

  -- Job-scoped refreshes use the claim as well as the existing rotating-token lease.
  perform app.install_connection_credentials('job-fencing-test', 'ac000000-0000-0000-0000-000000000001', null,
    'job-test', 'workspace', 'Installed', 'account', null, array['read'], null, '{}',
    'test-access', 'test-refresh', null, 'Bearer');
  select job_generation into g from app.connections where id = c;
  j := app.schedule_connection_job_v2(c, 'token_refresh', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  assert app.begin_connection_job_refresh(j, a.claim_id, lease, 30) is not null;
  update app.connection_sync_jobs set started_at = clock_timestamp() - interval '1 hour' where id = j;
  select * into b from app.claim_connection_sync_jobs_v2('worker', 1, 1);
  assert app.commit_connection_job_refresh(j, a.claim_id, lease, 'stale-access', 'stale-refresh', null, 'Bearer', null, array['read']) = 'fenced';
  assert not app.fail_connection_job_refresh(j, a.claim_id, lease), 'stale failure cannot mark connection';
  assert app.begin_connection_job_refresh(j, a.claim_id, gen_random_uuid(), 30) is null;
  assert (select app.resolve_secret(refresh_token_secret_id) = 'test-refresh' from app.connection_credentials where connection_id = c);
  assert (select refresh_lock_id = lease from app.connections where id = c), 'uncertain provider attempt retains lease';

  -- A reconnect must cancel both old claims and their queued successors atomically.
  successor := app.schedule_connection_job_v2(c, 'token_refresh', p_generation => g);
  perform app.install_connection_credentials('job-fencing-test', 'ac000000-0000-0000-0000-000000000001', null,
    'job-test', 'workspace', 'Reconnected', 'account', null, array['read'], now() + interval '1 hour', '{}',
    'new-access', 'new-refresh', null, 'Bearer');
  assert (select job_generation <> g from app.connections where id = c), 'reconnect changes generation';
  assert (select count(*) = 2 from app.connection_sync_jobs where id in (j, successor) and status = 'canceled' and claim_id is null);
  assert app.finish_connection_job(j, b.claim_id, 'succeeded') is null;
  assert app.schedule_connection_job_v2(c, 'token_refresh', p_generation => g) is null, 'old scheduler cannot recreate jobs after reconnect';
  select job_generation into g from app.connections where id = c;

  j := app.schedule_connection_job_v2(c, 'token_refresh', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  assert app.finish_connection_job(j, a.claim_id, 'succeeded') = 'succeeded';
  assert (select count(*) = 1 from app.connection_sync_jobs where connection_id = c and status = 'queued' and job_type = 'token_refresh'), 'completion atomically schedules next refresh';
  assert app.finish_connection_job(j, a.claim_id, 'succeeded') is null;
  update app.connections set status = 'revoked' where id = c;
  assert not exists (select 1 from app.connection_sync_jobs where connection_id = c and status in ('queued', 'processing')), 'revoke cancels followup';
  assert app.schedule_connection_job_v2(c, 'token_refresh', p_generation => g) is null, 'revoke wins against old scheduler';

  perform app.install_connection_credentials('job-fencing-test', 'ac000000-0000-0000-0000-000000000001', null,
    'job-test', 'workspace', 'Reconnected', 'account', null, array['read'], null, '{}',
    'new-access', 'new-refresh', null, 'Bearer');
  select job_generation into g from app.connections where id = c;
  j := app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  update app.connections set status = 'reauth_required' where id = c;
  assert app.finish_connection_job(j, a.claim_id, 'succeeded', p_connection_update => '{"display_name":"stale"}') = 'dead_letter';
  assert (select status = 'reauth_required' and display_name = 'Reconnected' from app.connections where id = c), 'sync cannot reactivate reauth-required state';

  update app.connections set status = 'active' where id = c;
  j := app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  assert app.finish_connection_job(j, a.claim_id, 'queued', 'retry', now() + interval '1 minute') = 'queued';
  assert (select attempts = 1 and worker_id is null and started_at is null and claim_id is null and completed_at is null from app.connection_sync_jobs where id = j), 'ordinary retry preserves attempts and clears ownership';
  update app.connection_sync_jobs set run_after = now() where id = j;
  select * into b from app.claim_connection_sync_jobs_v2('worker', 1);
  assert b.attempts = 2 and b.claim_id <> a.claim_id;
  assert app.finish_connection_job(j, b.claim_id, 'dead_letter', 'exhausted') = 'dead_letter';
  assert (select dead_lettered_at is not null and alerted_at is null from app.connection_sync_jobs where id = j), 'dead-letter alert eligibility retained';

  j := app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  update app.connection_sync_jobs set status = 'canceled' where id = j;
  assert app.finish_connection_job(j, a.claim_id, 'queued') is null, 'direct cancellation cannot be undone';

  -- Sync may refresh before its own provider call fails. Keep the next refresh
  -- scheduled without allowing that scheduling to escape the job's final fence.
  j := app.schedule_connection_job_v2(c, 'sync_connection', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  lease := gen_random_uuid();
  assert app.begin_connection_job_refresh(j, a.claim_id, lease, 30) is not null;
  assert app.commit_connection_job_refresh(j, a.claim_id, lease, 'valid-access', 'valid-refresh', null,
    'Bearer', now() + interval '1 hour', array['read']) = 'committed';
  update app.connection_sync_jobs set started_at = clock_timestamp() - interval '1 hour' where id = j;
  select * into b from app.claim_connection_sync_jobs_v2('worker', 1, 1);
  assert b.refresh_schedule_pending, 'committed refresh scheduling obligation survives reclaim';
  assert app.finish_connection_job(j, a.claim_id, 'succeeded') is null;
  assert app.finish_connection_job(j, b.claim_id, 'queued', 'sync failed', now() + interval '1 minute') = 'queued';
  assert (select not refresh_schedule_pending from app.connection_sync_jobs where id = j);
  assert (select count(*) = 1 from app.connection_sync_jobs where connection_id = c and job_type = 'token_refresh' and status = 'queued'), 'sync refresh keeps its next refresh even when sync retries';
  update app.connection_sync_jobs set status = 'canceled' where connection_id = c and status = 'queued';

  -- A scheduling failure rolls back completion too; there is no success with a
  -- silently missing successor. Retry of the RPC is still guarded by the token.
  j := app.schedule_connection_job_v2(c, 'token_refresh', p_generation => g);
  select * into a from app.claim_connection_sync_jobs_v2('worker', 1);
  alter table app.connection_sync_jobs add constraint job_test_no_successor
    check (not (job_type = 'token_refresh' and status = 'queued')) not valid;
  begin
    perform app.finish_connection_job(j, a.claim_id, 'succeeded');
    raise exception 'completion unexpectedly survived a failed successor write';
  exception when check_violation then null; end;
  assert (select status = 'processing' and claim_id = a.claim_id from app.connection_sync_jobs where id = j), 'completion and successor roll back together';
  alter table app.connection_sync_jobs drop constraint job_test_no_successor;
end;
$$;
-- assertions:end
select pass('connection job fencing assertions completed');
select * from finish();
rollback;
