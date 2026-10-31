-- All credential writers serialize on the connection row. A refresh result is
-- accepted only while its original, unexpired lease still owns that row.
create or replace function app.write_connection_credentials(
  p_connection_id uuid, p_provider text, p_access_token text, p_refresh_token text,
  p_api_key text, p_token_type text, p_expires_at timestamptz, p_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, vault
as $$
declare
  v_credentials app.connection_credentials%rowtype;
  v_access uuid;
  v_refresh uuid;
  v_api_key uuid;
begin
  select * into v_credentials from app.connection_credentials
  where connection_id = p_connection_id for update;
  v_access := v_credentials.access_token_secret_id;
  v_refresh := v_credentials.refresh_token_secret_id;
  v_api_key := v_credentials.api_key_secret_id;

  if nullif(p_access_token, '') is not null then
    v_access := app.put_secret(p_access_token, v_access, p_connection_id || '-access-token', p_provider || ' access token');
  end if;
  if nullif(p_refresh_token, '') is not null then
    v_refresh := app.put_secret(p_refresh_token, v_refresh, p_connection_id || '-refresh-token', p_provider || ' refresh token');
  end if;
  if nullif(p_api_key, '') is not null then
    v_api_key := app.put_secret(p_api_key, v_api_key, p_connection_id || '-api-key', p_provider || ' api key');
  end if;

  insert into app.connection_credentials (
    connection_id, access_token_secret_id, refresh_token_secret_id, api_key_secret_id, token_type, expires_at, version
  ) values (
    p_connection_id, v_access, v_refresh, v_api_key, coalesce(p_token_type, 'Bearer'), p_expires_at, 1
  ) on conflict (connection_id) do update set
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    api_key_secret_id = excluded.api_key_secret_id,
    token_type = excluded.token_type,
    expires_at = excluded.expires_at,
    version = app.connection_credentials.version + 1;

  delete from app.connection_grants where connection_id = p_connection_id;
  insert into app.connection_grants (connection_id, scope, granted)
  select p_connection_id, scope, true from unnest(coalesce(p_scopes, '{}'::text[])) as scope
  on conflict (connection_id, scope) do nothing;
end;
$$;

create or replace function app.install_connection_credentials(
  p_connection_key text, p_workspace_id uuid, p_owner_user_id uuid, p_provider text,
  p_scope app.connection_scope, p_display_name text, p_external_account_id text,
  p_external_account_email text, p_scopes text[], p_expires_at timestamptz, p_metadata jsonb,
  p_access_token text, p_refresh_token text, p_api_key text, p_token_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, vault
as $$
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
    refresh_lock_id = null, refresh_lock_expires_at = null
  returning * into v_connection;

  perform app.write_connection_credentials(v_connection.id, p_provider, p_access_token, p_refresh_token,
    p_api_key, p_token_type, p_expires_at, p_scopes);
  return jsonb_build_object('connection', to_jsonb(v_connection), 'existing', v_existing);
end;
$$;

create or replace function app.acquire_connection_refresh_lock(
  p_connection_id uuid, p_lock_id uuid, p_ttl_seconds integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  v_updated integer;
begin
  if p_lock_id is null then
    raise exception 'Refresh lock ID is required.' using errcode = '22004';
  end if;
  -- An expired lease may represent a provider request that rotated its token.
  -- Never issue another refresh with that possibly-consumed credential.
  update app.connections set status = 'reauth_required',
    reauth_required_reason = 'A previous token refresh did not finish safely. Reconnect this account.',
    refresh_lock_id = null, refresh_lock_expires_at = null
  where id = p_connection_id and status = 'active' and refresh_lock_id is not null
    and (refresh_lock_expires_at is null or refresh_lock_expires_at <= clock_timestamp());

  update app.connections set refresh_lock_id = p_lock_id,
    refresh_lock_expires_at = clock_timestamp() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 30), 1))
  where id = p_connection_id and status = 'active' and refresh_lock_id is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function app.begin_connection_refresh(
  p_connection_id uuid, p_lock_id uuid, p_ttl_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, vault
as $$
declare
  v_connection app.connections%rowtype;
  v_credentials app.connection_credentials%rowtype;
begin
  if not app.acquire_connection_refresh_lock(p_connection_id, p_lock_id, p_ttl_seconds) then
    return null;
  end if;
  -- The acquisition update holds the connection row lock until this RPC ends,
  -- so reconnect cannot replace the Vault values midway through this snapshot.
  select * into v_connection from app.connections where id = p_connection_id;
  select * into v_credentials from app.connection_credentials where connection_id = p_connection_id;
  return jsonb_build_object(
    'connection', to_jsonb(v_connection),
    'credentials', jsonb_build_object(
      'accessToken', app.resolve_secret(v_credentials.access_token_secret_id),
      'refreshToken', app.resolve_secret(v_credentials.refresh_token_secret_id),
      'apiKey', app.resolve_secret(v_credentials.api_key_secret_id),
      'tokenType', v_credentials.token_type,
      'expiresAt', v_credentials.expires_at
    )
  );
end;
$$;

create or replace function app.commit_connection_refresh(
  p_connection_id uuid, p_lock_id uuid, p_access_token text, p_refresh_token text,
  p_api_key text, p_token_type text, p_expires_at timestamptz, p_scopes text[]
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, app, vault
as $$
declare
  v_connection app.connections%rowtype;
begin
  if p_lock_id is null then
    return 'fenced';
  end if;
  select * into v_connection from app.connections where id = p_connection_id for update;
  if not found or v_connection.status <> 'active' or v_connection.refresh_lock_id is distinct from p_lock_id then
    return 'fenced';
  end if;
  if v_connection.refresh_lock_expires_at is null or v_connection.refresh_lock_expires_at <= clock_timestamp() then
    update app.connections set status = 'reauth_required',
      reauth_required_reason = 'A previous token refresh did not finish safely. Reconnect this account.',
      refresh_lock_id = null, refresh_lock_expires_at = null where id = p_connection_id;
    return 'expired';
  end if;
  if nullif(p_access_token, '') is null then
    update app.connections set status = 'reauth_required',
      reauth_required_reason = 'Token refresh did not finish safely. Reconnect this account.',
      refresh_lock_id = null, refresh_lock_expires_at = null where id = p_connection_id;
    return 'invalid';
  end if;

  perform app.write_connection_credentials(p_connection_id, v_connection.provider, p_access_token,
    p_refresh_token, p_api_key, p_token_type, p_expires_at, p_scopes);
  update app.connections set granted_scopes = coalesce(p_scopes, '{}'::text[]), expires_at = p_expires_at,
    reauth_required_reason = null, last_refreshed_at = now(), last_validated_at = now(),
    refresh_lock_id = null, refresh_lock_expires_at = null where id = p_connection_id;
  return 'committed';
end;
$$;

create or replace function app.fail_connection_refresh(p_connection_id uuid, p_lock_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  v_updated integer;
begin
  update app.connections set status = 'reauth_required',
    reauth_required_reason = 'Token refresh did not finish safely. Reconnect this account.',
    refresh_lock_id = null, refresh_lock_expires_at = null
  where id = p_connection_id and status = 'active' and refresh_lock_id = p_lock_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function app.write_connection_credentials(uuid, text, text, text, text, text, timestamptz, text[]) from public, anon, authenticated, service_role;
revoke all on function app.install_connection_credentials(text, uuid, uuid, text, app.connection_scope, text, text, text, text[], timestamptz, jsonb, text, text, text, text) from public, anon, authenticated;
revoke all on function app.begin_connection_refresh(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function app.commit_connection_refresh(uuid, uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function app.fail_connection_refresh(uuid, uuid) from public, anon, authenticated;
grant execute on function app.install_connection_credentials(text, uuid, uuid, text, app.connection_scope, text, text, text, text[], timestamptz, jsonb, text, text, text, text) to service_role;
grant execute on function app.begin_connection_refresh(uuid, uuid, integer) to service_role;
grant execute on function app.commit_connection_refresh(uuid, uuid, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function app.fail_connection_refresh(uuid, uuid) to service_role;
