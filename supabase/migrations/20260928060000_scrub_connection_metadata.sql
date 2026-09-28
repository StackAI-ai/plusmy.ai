create or replace function app.scrub_provider_metadata(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry record;
  item jsonb;
  clean jsonb;
  normalized_key text;
begin
  if jsonb_typeof(p_value) = 'object' then
    clean := '{}'::jsonb;
    for entry in select key, value from jsonb_each(p_value) loop
      normalized_key := lower(regexp_replace(entry.key, '[^a-zA-Z0-9]', '', 'g'));
      if normalized_key in ('raw', 'key') or normalized_key ~ '(token|secret|password|credential|authorization|apikey|cookie|signature|privatekey|bearer)' then
        continue;
      end if;
      clean := clean || jsonb_build_object(entry.key, app.scrub_provider_metadata(entry.value));
    end loop;
    return clean;
  elsif jsonb_typeof(p_value) = 'array' then
    clean := '[]'::jsonb;
    for item in select value from jsonb_array_elements(p_value) loop
      clean := clean || jsonb_build_array(app.scrub_provider_metadata(item));
    end loop;
    return clean;
  end if;
  return p_value;
end;
$$;

create or replace function app.scrub_connection_metadata_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.metadata := app.scrub_provider_metadata(coalesce(new.metadata, '{}'::jsonb));
  return new;
end;
$$;

create or replace function app.scrub_connection_job_payload_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.payload := app.scrub_provider_metadata(coalesce(new.payload, '{}'::jsonb));
  return new;
end;
$$;

drop trigger if exists scrub_connection_metadata_before_write on app.connections;
create trigger scrub_connection_metadata_before_write
before insert or update of metadata on app.connections
for each row execute function app.scrub_connection_metadata_write();

drop trigger if exists scrub_connection_job_payload_before_write on app.connection_sync_jobs;
create trigger scrub_connection_job_payload_before_write
before insert or update of payload on app.connection_sync_jobs
for each row execute function app.scrub_connection_job_payload_write();

update app.connections
set metadata = app.scrub_provider_metadata(metadata)
where metadata is distinct from app.scrub_provider_metadata(metadata);

update app.connection_sync_jobs
set payload = app.scrub_provider_metadata(payload)
where payload is distinct from app.scrub_provider_metadata(payload);

revoke all on function app.scrub_provider_metadata(jsonb) from public, anon, authenticated;
revoke all on function app.scrub_connection_metadata_write() from public, anon, authenticated;
revoke all on function app.scrub_connection_job_payload_write() from public, anon, authenticated;
grant execute on function app.scrub_provider_metadata(jsonb) to service_role;
grant execute on function app.scrub_connection_metadata_write() to service_role;
grant execute on function app.scrub_connection_job_payload_write() to service_role;
