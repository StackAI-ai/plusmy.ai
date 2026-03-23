create table if not exists app.workspace_tool_allowances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  provider text not null references app.providers (id) on delete cascade,
  tool_name text not null,
  allowed boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, tool_name)
);

drop trigger if exists set_updated_at_workspace_tool_allowances on app.workspace_tool_allowances;
create trigger set_updated_at_workspace_tool_allowances
before update on app.workspace_tool_allowances
for each row execute procedure app.set_updated_at();

alter table app.workspace_tool_allowances enable row level security;

create policy "workspace_tool_allowances_select_members"
on app.workspace_tool_allowances
for select
using (app.has_workspace_role(workspace_id, array['owner','admin','member']::app.workspace_role[]));

create policy "workspace_tool_allowances_mutate_admins"
on app.workspace_tool_allowances
for all
using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]))
with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

grant select on app.workspace_tool_allowances to authenticated;
grant all privileges on app.workspace_tool_allowances to service_role;
