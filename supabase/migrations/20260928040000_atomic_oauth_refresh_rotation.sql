create or replace function app.rotate_oauth_refresh_token(
  p_old_hash text,
  p_new_hash text,
  p_client_id text,
  p_expires_at timestamptz
)
returns app.oauth_refresh_tokens
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_previous app.oauth_refresh_tokens;
begin
  update app.oauth_refresh_tokens
  set revoked_at = now(), replaced_by_token_hash = p_new_hash
  where token_hash = p_old_hash
    and client_id = p_client_id
    and revoked_at is null
    and expires_at >= now()
  returning * into v_previous;

  if not found then
    return null;
  end if;

  insert into app.oauth_refresh_tokens (
    token_hash, client_id, user_id, workspace_id, scopes, expires_at
  ) values (
    p_new_hash, v_previous.client_id, v_previous.user_id, v_previous.workspace_id,
    v_previous.scopes, p_expires_at
  );

  return v_previous;
end;
$$;

revoke execute on function app.rotate_oauth_refresh_token(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function app.rotate_oauth_refresh_token(text, text, text, timestamptz) to service_role;
