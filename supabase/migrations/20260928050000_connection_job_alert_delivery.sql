alter table app.connection_sync_jobs
  add column if not exists alert_claim_id uuid,
  add column if not exists alert_claimed_at timestamptz;

update app.connection_sync_jobs
set alerted_at = null
where status = 'dead_letter' and alerted_at is not null;

create index if not exists connection_sync_jobs_pending_alert_idx
  on app.connection_sync_jobs (dead_lettered_at, id)
  where status = 'dead_letter' and alerted_at is null;

create or replace function app.claim_connection_job_alerts(
  p_claim_id uuid,
  p_limit integer default 10
)
returns setof app.connection_sync_jobs
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select id
    from app.connection_sync_jobs
    where p_claim_id is not null
      and status = 'dead_letter'
      and alerted_at is null
      and (alert_claimed_at is null or alert_claimed_at < now() - interval '5 minutes')
    order by dead_lettered_at asc, id asc
    limit least(greatest(p_limit, 1), 20)
    for update skip locked
  )
  update app.connection_sync_jobs job
  set alert_claim_id = p_claim_id,
      alert_claimed_at = now()
  where job.id in (select id from candidates)
  returning job.*;
$$;

create or replace function app.complete_connection_job_alert(
  p_job_id uuid,
  p_claim_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with completed as (
    update app.connection_sync_jobs
    set alerted_at = now(),
        alert_claim_id = null,
        alert_claimed_at = null
    where id = p_job_id
      and status = 'dead_letter'
      and alerted_at is null
      and alert_claim_id = p_claim_id
    returning id
  )
  select exists(select 1 from completed);
$$;

create or replace function app.release_connection_job_alert(
  p_job_id uuid,
  p_claim_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with released as (
    update app.connection_sync_jobs
    set alert_claim_id = null,
        alert_claimed_at = null
    where id = p_job_id
      and alerted_at is null
      and alert_claim_id = p_claim_id
    returning id
  )
  select exists(select 1 from released);
$$;

revoke all on function app.claim_connection_job_alerts(uuid, integer) from public, anon, authenticated;
revoke all on function app.complete_connection_job_alert(uuid, uuid) from public, anon, authenticated;
revoke all on function app.release_connection_job_alert(uuid, uuid) from public, anon, authenticated;
grant execute on function app.claim_connection_job_alerts(uuid, integer) to service_role;
grant execute on function app.complete_connection_job_alert(uuid, uuid) to service_role;
grant execute on function app.release_connection_job_alert(uuid, uuid) to service_role;
