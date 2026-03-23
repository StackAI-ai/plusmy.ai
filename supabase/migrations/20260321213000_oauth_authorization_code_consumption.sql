create or replace function app.consume_oauth_authorization_code(
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text
)
returns app.oauth_authorization_codes
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_code app.oauth_authorization_codes;
begin
  update app.oauth_authorization_codes
  set consumed_at = now()
  where code_hash = p_code_hash
    and client_id = p_client_id
    and redirect_uri = p_redirect_uri
    and consumed_at is null
    and expires_at >= now()
  returning * into v_code;

  return v_code;
end;
$$;

grant execute on function app.consume_oauth_authorization_code(text, text, text) to service_role;
