-- Coordinated upgrade only: drain old apps/workers before applying this migration.
alter table app.connections add column job_generation uuid not null default gen_random_uuid();
alter table app.connection_sync_jobs
  add column connection_generation uuid,
  add column claim_id uuid,
  add column refresh_schedule_pending boolean not null default false;

update app.connection_sync_jobs j set connection_generation = c.job_generation
from app.connections c where c.id = j.connection_id;
alter table app.connection_sync_jobs alter column connection_generation set not null;
create index connection_sync_jobs_processing_started_idx on app.connection_sync_jobs (started_at)
  where status = 'processing';

-- There is no trustworthy ownership token for an already-running old worker.
-- Operators must explicitly reschedule these interrupted jobs after the upgrade.
update app.connection_sync_jobs set status = 'canceled', worker_id = null,
  completed_at = now(), last_error = 'Interrupted by job fencing upgrade; reschedule explicitly.'
where status = 'processing';

create function app.fence_connection_job_generation()
returns trigger language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if (new.status = 'revoked' and old.status is distinct from new.status)
    or new.workspace_id is distinct from old.workspace_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.scope is distinct from old.scope
    or new.provider is distinct from old.provider
    or new.connection_key is distinct from old.connection_key then
    new.job_generation := gen_random_uuid();
  end if;
  if (new.workspace_id is distinct from old.workspace_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.scope is distinct from old.scope
    or new.provider is distinct from old.provider
    or new.connection_key is distinct from old.connection_key)
    and old.refresh_lock_id is not null and new.refresh_lock_id is not distinct from old.refresh_lock_id then
    -- A transfer cannot inherit an uncertain rotating-token request. Explicit
    -- credential installation clears the old lease while replacing secrets.
    if new.status = 'active' then
      new.status := 'reauth_required';
      new.reauth_required_reason := 'Connection ownership changed during token refresh. Reconnect this account.';
    end if;
    new.refresh_lock_id := null;
    new.refresh_lock_expires_at := null;
  end if;
  return new;
end;
$$;
create trigger fence_connection_job_generation before update on app.connections
for each row execute function app.fence_connection_job_generation();

create function app.cancel_obsolete_connection_jobs()
returns trigger language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.job_generation is distinct from old.job_generation then
    update app.connection_sync_jobs set status = 'canceled', claim_id = null,
      worker_id = null, completed_at = now(), last_error = 'Connection revoked or replaced.'
    where connection_id = new.id and status in ('queued', 'processing')
      and connection_generation is distinct from new.job_generation;
  end if;
  return new;
end;
$$;
create trigger cancel_obsolete_connection_jobs after update on app.connections
for each row execute function app.cancel_obsolete_connection_jobs();

create function app.set_connection_job_fence()
returns trigger language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if tg_op = 'INSERT' then
    select job_generation into new.connection_generation from app.connections
    where id = new.connection_id for update;
  end if;
  if new.status <> 'processing' then new.claim_id := null; end if;
  return new;
end;
$$;
create trigger set_connection_job_fence before insert or update on app.connection_sync_jobs
for each row execute function app.set_connection_job_fence();

-- Explicit install/reconnect, unlike ordinary refresh, starts a new generation.
create or replace function app.install_connection_credentials(
  p_connection_key text, p_workspace_id uuid, p_owner_user_id uuid, p_provider text,
  p_scope app.connection_scope, p_display_name text, p_external_account_id text,
  p_external_account_email text, p_scopes text[], p_expires_at timestamptz, p_metadata jsonb,
  p_access_token text, p_refresh_token text, p_api_key text, p_token_type text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app, vault as $$
declare
  v_connection app.connections%rowtype;
  v_existing boolean;
begin
  select exists(select 1 from app.connections where connection_key = p_connection_key) into v_existing;
  insert into app.connections (
    connection_key, workspace_id, owner_user_id, provider, scope, status, display_name,
    external_account_id, external_account_email, granted_scopes, expires_at,
    reauth_required_reason, last_refreshed_at, last_validated_at, metadata,
    refresh_lock_id, refresh_lock_expires_at
  ) values (
    p_connection_key, p_workspace_id, p_owner_user_id, p_provider, p_scope, 'active', p_display_name,
    p_external_account_id, p_external_account_email, coalesce(p_scopes, '{}'::text[]), p_expires_at,
    null, now(), now(), coalesce(p_metadata, '{}'::jsonb), null, null
  ) on conflict (connection_key) do update set
    workspace_id = excluded.workspace_id, owner_user_id = excluded.owner_user_id,
    provider = excluded.provider, scope = excluded.scope, status = 'active',
    display_name = excluded.display_name, external_account_id = excluded.external_account_id,
    external_account_email = excluded.external_account_email, granted_scopes = excluded.granted_scopes,
    expires_at = excluded.expires_at, reauth_required_reason = null,
    last_refreshed_at = now(), last_validated_at = now(), metadata = excluded.metadata,
    refresh_lock_id = null, refresh_lock_expires_at = null, job_generation = gen_random_uuid()
  returning * into v_connection;

  perform app.write_connection_credentials(v_connection.id, p_provider, p_access_token, p_refresh_token,
    p_api_key, p_token_type, p_expires_at, p_scopes);
  return jsonb_build_object('connection', to_jsonb(v_connection), 'existing', v_existing);
end;
$$;

create function app.schedule_connection_job_v2(
  p_connection_id uuid, p_job_type text, p_payload jsonb default '{}'::jsonb,
  p_run_after timestamptz default now(), p_max_attempts integer default 3,
  p_generation uuid default null
)
returns uuid language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_connection app.connections%rowtype;
  v_job_id uuid;
begin
  select * into v_connection from app.connections where id = p_connection_id for update;
  if not found or v_connection.status <> 'active' or p_generation is null
    or v_connection.job_generation is distinct from p_generation then return null; end if;

  insert into app.connection_sync_jobs (connection_id, job_type, payload, run_after, max_attempts)
  values (p_connection_id, p_job_type, coalesce(p_payload, '{}'::jsonb),
    coalesce(p_run_after, now()), greatest(coalesce(p_max_attempts, 3), 1))
  on conflict (connection_id, job_type) where status = 'queued' do update set
    payload = excluded.payload, run_after = excluded.run_after, max_attempts = excluded.max_attempts,
    last_error = null, worker_id = null, started_at = null, completed_at = null
  returning id into v_job_id;
  return v_job_id;
end;
$$;

-- Operator intent is valid only for the same workspace, generation, and
-- membership/role at the instant of scheduling. SHARE serializes removals and
-- role changes until this transaction commits.
create function app.schedule_connection_sync_for_actor(
  p_connection_id uuid, p_generation uuid, p_workspace_id uuid,
  p_actor_user_id uuid, p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_connection app.connections%rowtype;
  v_role app.workspace_role;
  v_job_id uuid;
  v_run_after timestamptz := now();
begin
  if p_actor_user_id is null or p_generation is null or p_workspace_id is null then return null; end if;
  select * into v_connection from app.connections where id = p_connection_id for update;
  if not found or v_connection.status <> 'active'
    or v_connection.workspace_id is distinct from p_workspace_id
    or v_connection.job_generation is distinct from p_generation then return null; end if;
  select m.role into v_role from app.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_actor_user_id for share;
  if not found or (v_connection.scope = 'personal' and v_connection.owner_user_id is distinct from p_actor_user_id)
    or (v_connection.scope = 'workspace' and v_role not in ('owner', 'admin')) then return null; end if;
  v_job_id := app.schedule_connection_job_v2(p_connection_id, 'sync_connection',
    coalesce(p_payload, '{}'::jsonb), v_run_after, 4, p_generation);
  if v_job_id is null then return null; end if;
  return jsonb_build_object('job_id', v_job_id, 'provider', v_connection.provider, 'run_after', v_run_after);
end;
$$;

-- Keep credential replacement and its first refresh schedule in one transaction.
create function app.install_connection_credentials_v2(
  p_connection_key text, p_workspace_id uuid, p_owner_user_id uuid, p_provider text,
  p_scope app.connection_scope, p_display_name text, p_external_account_id text,
  p_external_account_email text, p_scopes text[], p_expires_at timestamptz, p_metadata jsonb,
  p_access_token text, p_refresh_token text, p_api_key text, p_token_type text,
  p_schedule_refresh boolean default true
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_result jsonb;
  v_connection jsonb;
  v_job_id uuid;
  v_run_after timestamptz;
  v_reason text;
begin
  v_result := app.install_connection_credentials(p_connection_key, p_workspace_id, p_owner_user_id,
    p_provider, p_scope, p_display_name, p_external_account_id, p_external_account_email,
    p_scopes, p_expires_at, p_metadata, p_access_token, p_refresh_token, p_api_key, p_token_type);
  v_connection := v_result -> 'connection';
  if p_schedule_refresh and p_expires_at is not null and exists (
    select 1 from app.connection_credentials c
    where c.connection_id = (v_connection ->> 'id')::uuid and c.refresh_token_secret_id is not null
  ) then
    v_run_after := greatest(p_expires_at - interval '5 minutes', now());
    v_reason := case when (v_result ->> 'existing')::boolean then 'credential_updated' else 'connection_installed' end;
    v_job_id := app.schedule_connection_job_v2((v_connection ->> 'id')::uuid, 'token_refresh',
      jsonb_build_object('reason', v_reason, 'expires_at', p_expires_at), v_run_after, 5,
      (v_connection ->> 'job_generation')::uuid);
    if v_job_id is null then raise exception 'Could not schedule the installed connection refresh.' using errcode = '55000'; end if;
    v_result := v_result || jsonb_build_object('refresh_job_id', v_job_id, 'refresh_run_after', v_run_after);
  end if;
  return v_result;
end;
$$;

-- Unversioned producers have no generation. Fail closed rather than guessing it.
create or replace function app.schedule_connection_job(
  p_connection_id uuid, p_job_type text, p_payload jsonb default '{}'::jsonb,
  p_run_after timestamptz default now(), p_max_attempts integer default 3
)
returns uuid language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  raise exception 'Job fencing upgrade requires a v2 producer.' using errcode = '55000';
end;
$$;
create or replace function app.claim_connection_sync_jobs(
  p_worker_id text, p_limit integer default 10, p_stale_after_seconds integer default 900
)
returns setof app.connection_sync_jobs language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  raise exception 'Job fencing upgrade requires a v2 worker.' using errcode = '55000';
end;
$$;

create function app.claim_connection_sync_jobs_v2(
  p_worker_id text, p_limit integer default 10, p_stale_after_seconds integer default 900
)
returns setof app.connection_sync_jobs language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_connection app.connections%rowtype;
  v_job app.connection_sync_jobs%rowtype;
  v_candidate record;
  v_remaining integer := least(greatest(coalesce(p_limit, 10), 1), 200);
begin
  if nullif(p_worker_id, '') is null then raise exception 'Worker ID is required.' using errcode = '22004'; end if;
  -- All lifecycle RPCs lock connection then job. SKIP LOCKED avoids blocking
  -- unrelated work and direct reclaim avoids the queued-only unique index.
  for v_candidate in
    select j.id, j.connection_id from app.connection_sync_jobs j
    join app.connections c on c.id = j.connection_id
    where c.status <> 'revoked' and j.connection_generation = c.job_generation and (
      (j.status = 'queued' and j.run_after <= now()) or
      (j.status = 'processing' and j.started_at < clock_timestamp() -
        make_interval(secs => greatest(coalesce(p_stale_after_seconds, 900), 1)))
    ) order by j.run_after, j.created_at, j.id
  loop
    select * into v_connection from app.connections where id = v_candidate.connection_id
      and status <> 'revoked' for update skip locked;
    if not found then continue; end if;
    -- Recheck after both locks: the candidate snapshot may precede another claim.
    select * into v_job from app.connection_sync_jobs j where j.id = v_candidate.id
      and j.connection_generation = v_connection.job_generation and (
        (j.status = 'queued' and j.run_after <= now()) or
        (j.status = 'processing' and j.started_at < clock_timestamp() -
          make_interval(secs => greatest(coalesce(p_stale_after_seconds, 900), 1)))
      ) for update skip locked;
    if not found then continue; end if;
    update app.connection_sync_jobs set status = 'processing', attempts = attempts + 1,
      worker_id = p_worker_id, claim_id = gen_random_uuid(), started_at = clock_timestamp(),
      completed_at = null, last_error = null
    where id = v_job.id returning * into v_job;
    return next v_job;
    v_remaining := v_remaining - 1;
    exit when v_remaining = 0;
  end loop;
end;
$$;

-- Private helper holds both row locks until the calling RPC transaction ends.
create function app.lock_connection_job(p_job_id uuid, p_claim_id uuid)
returns app.connections language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_connection app.connections%rowtype;
  v_job app.connection_sync_jobs%rowtype;
begin
  if p_claim_id is null then return null; end if;
  select c.* into v_connection from app.connections c
  where c.id = (select connection_id from app.connection_sync_jobs where id = p_job_id) for update;
  if not found then return null; end if;
  select * into v_job from app.connection_sync_jobs where id = p_job_id for update;
  if not found or v_job.connection_id <> v_connection.id
    or v_job.status <> 'processing' or v_job.claim_id is distinct from p_claim_id
    or v_job.connection_generation is distinct from v_connection.job_generation then return null; end if;
  return v_connection;
end;
$$;

create function app.finish_connection_job(
  p_job_id uuid, p_claim_id uuid, p_status text, p_last_error text default null,
  p_run_after timestamptz default null, p_connection_update jsonb default null
)
returns text language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_connection app.connections%rowtype;
  v_job app.connection_sync_jobs%rowtype;
  v_status text := p_status;
begin
  v_connection := app.lock_connection_job(p_job_id, p_claim_id);
  if v_connection.id is null then return null; end if;
  select * into v_job from app.connection_sync_jobs where id = p_job_id;
  if p_status is null or p_status not in ('succeeded', 'queued', 'dead_letter', 'canceled', 'failed') then
    raise exception 'Invalid job outcome.' using errcode = '22023';
  end if;
  if v_status in ('succeeded', 'queued') and v_connection.status <> 'active' then
    v_status := 'dead_letter';
    p_last_error := coalesce(p_last_error, 'Connection is not active.');
  end if;
  -- A committed refresh is authoritative even when its RPC acknowledgement
  -- was lost. Retrying can rotate again; dead-lettering would lose the next run.
  if v_connection.status = 'active' and v_job.job_type = 'token_refresh'
    and v_job.refresh_schedule_pending and v_status in ('queued', 'dead_letter', 'failed') then
    v_status := 'succeeded';
    p_last_error := null;
  end if;
  if v_status = 'queued' and exists (select 1 from app.connection_sync_jobs
    where connection_id = v_job.connection_id and job_type = v_job.job_type and status = 'queued') then
    v_status := 'canceled';
    p_last_error := 'Superseded by an already queued job.';
  end if;

  if v_status = 'succeeded' and p_connection_update is not null then
    -- Only sync result fields are accepted. Never accept connection status or credentials.
    update app.connections set last_validated_at = now(), reauth_required_reason = null,
      metadata = coalesce(p_connection_update->'metadata', metadata),
      display_name = coalesce(p_connection_update->>'display_name', display_name),
      external_account_id = coalesce(p_connection_update->>'external_account_id', external_account_id),
      external_account_email = case when p_connection_update ? 'external_account_email'
        then p_connection_update->>'external_account_email' else external_account_email end
    where id = v_connection.id;
  end if;

  update app.connection_sync_jobs set status = v_status, last_error = p_last_error,
    worker_id = case when v_status = 'queued' then null else worker_id end,
    started_at = case when v_status = 'queued' then null else started_at end,
    run_after = coalesce(p_run_after, run_after),
    completed_at = case when v_status = 'queued' then null else now() end,
    dead_lettered_at = case when v_status = 'dead_letter' then now() else null end
  where id = p_job_id;

  if v_connection.status = 'active' and v_connection.expires_at is not null and (
    (v_status = 'succeeded' and v_job.job_type = 'token_refresh') or
    (v_job.job_type <> 'token_refresh' and v_job.refresh_schedule_pending)
  ) then
    perform app.schedule_connection_job_v2(v_connection.id, 'token_refresh',
      jsonb_build_object('reason', 'scheduled_after_refresh', 'expires_at', v_connection.expires_at),
      greatest(v_connection.expires_at - interval '5 minutes', now()), 5, v_connection.job_generation);
    update app.connection_sync_jobs set refresh_schedule_pending = false where id = p_job_id;
  end if;
  return v_status;
end;
$$;

create function app.begin_connection_job_refresh(
  p_job_id uuid, p_claim_id uuid, p_lock_id uuid, p_ttl_seconds integer default 30
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app as $$
declare v_connection app.connections%rowtype;
begin
  v_connection := app.lock_connection_job(p_job_id, p_claim_id);
  if v_connection.id is null then return null; end if;
  return app.begin_connection_refresh(v_connection.id, p_lock_id, p_ttl_seconds);
end;
$$;

create function app.commit_connection_job_refresh(
  p_job_id uuid, p_claim_id uuid, p_lock_id uuid, p_access_token text, p_refresh_token text,
  p_api_key text, p_token_type text, p_expires_at timestamptz, p_scopes text[]
)
returns text language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_connection app.connections%rowtype;
  v_outcome text;
begin
  v_connection := app.lock_connection_job(p_job_id, p_claim_id);
  if v_connection.id is null then return 'fenced'; end if;
  v_outcome := app.commit_connection_refresh(v_connection.id, p_lock_id, p_access_token, p_refresh_token,
    p_api_key, p_token_type, p_expires_at, p_scopes);
  if v_outcome = 'committed' then
    -- Survives reclaim: a new owner can finish scheduling a committed refresh.
    update app.connection_sync_jobs set refresh_schedule_pending = true where id = p_job_id;
  end if;
  return v_outcome;
end;
$$;

create function app.fail_connection_job_refresh(p_job_id uuid, p_claim_id uuid, p_lock_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, app as $$
declare v_connection app.connections%rowtype;
begin
  v_connection := app.lock_connection_job(p_job_id, p_claim_id);
  if v_connection.id is null then return false; end if;
  return app.fail_connection_refresh(v_connection.id, p_lock_id);
end;
$$;

revoke all on function app.fence_connection_job_generation() from public, anon, authenticated, service_role;
revoke all on function app.cancel_obsolete_connection_jobs() from public, anon, authenticated, service_role;
revoke all on function app.set_connection_job_fence() from public, anon, authenticated, service_role;
revoke all on function app.lock_connection_job(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.schedule_connection_job_v2(uuid, text, jsonb, timestamptz, integer, uuid) from public, anon, authenticated;
revoke all on function app.schedule_connection_sync_for_actor(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app.install_connection_credentials_v2(text, uuid, uuid, text, app.connection_scope, text, text, text, text[], timestamptz, jsonb, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function app.claim_connection_sync_jobs_v2(text, integer, integer) from public, anon, authenticated;
revoke all on function app.finish_connection_job(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function app.begin_connection_job_refresh(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function app.commit_connection_job_refresh(uuid, uuid, uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function app.fail_connection_job_refresh(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.schedule_connection_job_v2(uuid, text, jsonb, timestamptz, integer, uuid) to service_role;
grant execute on function app.schedule_connection_sync_for_actor(uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function app.install_connection_credentials_v2(text, uuid, uuid, text, app.connection_scope, text, text, text, text[], timestamptz, jsonb, text, text, text, text, boolean) to service_role;
grant execute on function app.claim_connection_sync_jobs_v2(text, integer, integer) to service_role;
grant execute on function app.finish_connection_job(uuid, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function app.begin_connection_job_refresh(uuid, uuid, uuid, integer) to service_role;
grant execute on function app.commit_connection_job_refresh(uuid, uuid, uuid, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function app.fail_connection_job_refresh(uuid, uuid, uuid) to service_role;
