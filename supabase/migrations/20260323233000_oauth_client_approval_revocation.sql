create or replace function app.revoke_oauth_client_approval(
  p_approval_id uuid,
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_revocation_reason text
)
returns app.oauth_client_approvals
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_approval app.oauth_client_approvals;
  v_revoked_at timestamptz;
begin
  update app.oauth_client_approvals
  set status = 'revoked',
      revoked_at = coalesce(revoked_at, now()),
      metadata =
        coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'revoked_by_user_id',
          p_actor_user_id::text,
          'revocation_reason',
          p_revocation_reason
        )
  where id = p_approval_id
    and workspace_id = p_workspace_id
  returning * into v_approval;

  if not found then
    return null;
  end if;

  v_revoked_at := coalesce(v_approval.revoked_at, now());

  update app.oauth_authorization_codes
  set consumed_at = v_revoked_at
  where client_id = v_approval.client_id
    and workspace_id = v_approval.workspace_id
    and user_id = v_approval.user_id
    and consumed_at is null;

  update app.oauth_refresh_tokens
  set revoked_at = v_revoked_at
  where client_id = v_approval.client_id
    and workspace_id = v_approval.workspace_id
    and user_id = v_approval.user_id
    and revoked_at is null;

  return v_approval;
end;
$$;

grant execute on function app.revoke_oauth_client_approval(uuid, uuid, uuid, text) to service_role;
