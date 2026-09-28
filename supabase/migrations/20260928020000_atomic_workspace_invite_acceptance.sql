create or replace function app.accept_workspace_invite(
  p_token_hash text,
  p_user_id uuid
)
returns table (
  id uuid,
  workspace_id uuid,
  email text,
  role app.workspace_role,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite app.workspace_invites%rowtype;
  v_email text;
  v_accepted_at timestamptz;
begin
  select * into v_invite
  from app.workspace_invites
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Invite not found.';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'Invite already accepted.';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Invite expired.';
  end if;

  select u.email into v_email from auth.users as u where u.id = p_user_id;
  if v_email is null or lower(v_email) <> lower(v_invite.email) then
    raise exception 'Invite email does not match current user.';
  end if;
  if exists (
    select 1 from app.workspace_members
    where workspace_members.workspace_id = v_invite.workspace_id
      and workspace_members.user_id = p_user_id
  ) then
    raise exception 'You are already a member of this workspace.';
  end if;

  insert into app.workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, p_user_id, v_invite.role);

  update app.workspace_invites
  set accepted_at = now()
  where workspace_invites.id = v_invite.id
  returning workspace_invites.accepted_at into v_accepted_at;

  return query select v_invite.id, v_invite.workspace_id, v_invite.email, v_invite.role, v_accepted_at;
end;
$$;

revoke all on function app.accept_workspace_invite(text, uuid) from public, anon, authenticated;
grant execute on function app.accept_workspace_invite(text, uuid) to service_role;
