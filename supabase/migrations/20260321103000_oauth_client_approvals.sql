create type app.oauth_client_approval_status as enum ('active', 'revoked');

create table if not exists app.oauth_client_approvals (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references app.oauth_clients (client_id) on delete cascade,
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scopes text[] not null default '{}',
  status app.oauth_client_approval_status not null default 'active',
  approved_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, workspace_id, user_id)
);

create index if not exists oauth_client_approvals_workspace_idx
  on app.oauth_client_approvals (workspace_id, status, approved_at desc);

create index if not exists oauth_client_approvals_user_idx
  on app.oauth_client_approvals (user_id, approved_at desc);

drop trigger if exists set_updated_at_oauth_client_approvals on app.oauth_client_approvals;
create trigger set_updated_at_oauth_client_approvals
before update on app.oauth_client_approvals
for each row execute procedure app.set_updated_at();

alter table app.oauth_client_approvals enable row level security;

create policy "oauth_client_approvals_select_self_or_admins"
on app.oauth_client_approvals
for select
using (
  user_id = auth.uid()
  or app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])
);

create policy "oauth_client_approvals_mutate_self_or_admins"
on app.oauth_client_approvals
for all
using (
  user_id = auth.uid()
  or app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])
)
with check (
  user_id = auth.uid()
  or app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])
);

grant select, insert, update, delete on app.oauth_client_approvals to authenticated;
grant all privileges on app.oauth_client_approvals to service_role;
