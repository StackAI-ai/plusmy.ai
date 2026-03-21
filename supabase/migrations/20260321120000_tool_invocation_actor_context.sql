alter table app.tool_invocations
  add column if not exists actor_user_id uuid references auth.users (id) on delete set null,
  add column if not exists actor_client_id text;

create index if not exists tool_invocations_workspace_actor_client_created_idx
  on app.tool_invocations (workspace_id, actor_client_id, created_at desc);

create index if not exists tool_invocations_workspace_actor_user_created_idx
  on app.tool_invocations (workspace_id, actor_user_id, created_at desc);
