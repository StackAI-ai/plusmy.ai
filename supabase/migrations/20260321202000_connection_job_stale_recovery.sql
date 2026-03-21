create or replace function app.claim_connection_sync_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_stale_after_seconds integer default 900
)
returns setof app.connection_sync_jobs
language sql
security definer
set search_path = app, public
as $$
  with recovered_jobs as (
    update app.connection_sync_jobs
    set status = 'queued',
        worker_id = null,
        started_at = null,
        completed_at = null,
        last_error = coalesce(last_error, 'Recovered stale processing job.'),
        updated_at = now()
    where status = 'processing'
      and started_at is not null
      and started_at < now() - make_interval(secs => greatest(p_stale_after_seconds, 1))
    returning id
  ),
  candidate_jobs as (
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

grant execute on function app.claim_connection_sync_jobs(text, integer, integer) to service_role;
