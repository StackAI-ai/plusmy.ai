create extension if not exists pg_net with schema extensions;

create or replace function app.invoke_connection_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  worker_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'plusmy_worker_project_url';

  select decrypted_secret into worker_secret
  from vault.decrypted_secrets
  where name = 'plusmy_worker_shared_secret';

  if nullif(project_url, '') is null or nullif(worker_secret, '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/token-refresh-worker',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-plusmy-worker-secret', worker_secret
    ),
    body := '{"limit":10}'::jsonb,
    timeout_milliseconds := 5000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function app.invoke_connection_worker() from public, anon, authenticated;

select cron.schedule(
  'plusmy-connection-worker',
  '* * * * *',
  'select app.invoke_connection_worker()'
);
