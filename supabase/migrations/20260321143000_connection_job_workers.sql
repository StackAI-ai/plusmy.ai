alter table app.connection_sync_jobs
  add column if not exists max_attempts integer not null default 3,
  add column if not exists worker_id text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

create index if not exists connection_sync_jobs_queue_idx
  on app.connection_sync_jobs (status, run_after, created_at);

create index if not exists connection_sync_jobs_connection_idx
  on app.connection_sync_jobs (connection_id, created_at desc);

create unique index if not exists connection_sync_jobs_queued_unique_idx
  on app.connection_sync_jobs (connection_id, job_type)
  where status = 'queued';

create or replace function app.schedule_connection_job(
  p_connection_id uuid,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb,
  p_run_after timestamptz default now(),
  p_max_attempts integer default 3
)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_job_id uuid;
begin
  update app.connection_sync_jobs
  set payload = coalesce(p_payload, '{}'::jsonb),
      run_after = coalesce(p_run_after, now()),
      max_attempts = greatest(coalesce(p_max_attempts, 3), 1),
      last_error = null,
      worker_id = null,
      started_at = null,
      completed_at = null,
      updated_at = now()
  where connection_id = p_connection_id
    and job_type = p_job_type
    and status = 'queued'
  returning id into v_job_id;

  if v_job_id is null then
    insert into app.connection_sync_jobs (
      connection_id,
      job_type,
      payload,
      status,
      attempts,
      max_attempts,
      run_after
    )
    values (
      p_connection_id,
      p_job_type,
      coalesce(p_payload, '{}'::jsonb),
      'queued',
      0,
      greatest(coalesce(p_max_attempts, 3), 1),
      coalesce(p_run_after, now())
    )
    returning id into v_job_id;
  end if;

  return v_job_id;
end;
$$;

drop function if exists app.enqueue_token_refresh(uuid, text);
create function app.enqueue_token_refresh(p_connection_id uuid, p_reason text default 'scheduled')
returns uuid
language sql
security definer
set search_path = app, public
as $$
  select app.schedule_connection_job(
    p_connection_id,
    'token_refresh',
    jsonb_build_object('reason', p_reason),
    now(),
    5
  );
$$;

create or replace function app.claim_connection_sync_jobs(
  p_worker_id text,
  p_limit integer default 10
)
returns setof app.connection_sync_jobs
language sql
security definer
set search_path = app, public
as $$
  with candidate_jobs as (
    select id
    from app.connection_sync_jobs
    where status = 'queued'
      and run_after <= now()
    order by run_after asc, created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  ),
  claimed_jobs as (
    update app.connection_sync_jobs job
    set status = 'processing',
        attempts = job.attempts + 1,
        worker_id = p_worker_id,
        started_at = now(),
        completed_at = null,
        last_error = null,
        updated_at = now()
    where job.id in (select id from candidate_jobs)
    returning job.*
  )
  select * from claimed_jobs;
$$;

grant execute on function app.schedule_connection_job(uuid, text, jsonb, timestamptz, integer) to service_role;
grant execute on function app.enqueue_token_refresh(uuid, text) to service_role;
grant execute on function app.claim_connection_sync_jobs(text, integer) to service_role;
