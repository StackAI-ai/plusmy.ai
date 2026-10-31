-- Browser/session clients only read these tables. Installs, revokes, refreshes,
-- sync updates and grant replacement use the server's service_role boundary.
revoke insert, update, delete, truncate, references, trigger
  on table app.connections, app.connection_grants from public, anon, authenticated;

-- RLS is a second boundary if a non-bypass client role inherits a write grant.
-- service_role retains its existing table ACLs and BYPASSRLS worker/RPC access.
drop policy if exists "connections_mutate_admins" on app.connections;
drop policy if exists "connection_grants_mutate_admins" on app.connection_grants;

-- Restrictive deny policies also prevent an unexpected permissive policy from
-- restoring client DML when a role inherits a table or column grant.
create policy "connections_client_insert_denied" on app.connections as restrictive for insert to anon, authenticated with check (false);
create policy "connections_client_update_denied" on app.connections as restrictive for update to anon, authenticated using (false) with check (false);
create policy "connections_client_delete_denied" on app.connections as restrictive for delete to anon, authenticated using (false);
create policy "connection_grants_client_insert_denied" on app.connection_grants as restrictive for insert to anon, authenticated with check (false);
create policy "connection_grants_client_update_denied" on app.connection_grants as restrictive for update to anon, authenticated using (false) with check (false);
create policy "connection_grants_client_delete_denied" on app.connection_grants as restrictive for delete to anon, authenticated using (false);

-- Preserve existing SELECT policies. Restrictive client policies AND with permissive
-- policies, so extra permissive policies cannot reopen personal-row visibility.
create policy "connections_select_visibility_boundary" on app.connections as restrictive for select to anon, authenticated using (
  app.is_workspace_member(workspace_id)
  and (scope = 'workspace' or (scope = 'personal' and owner_user_id = auth.uid()))
);
create policy "connection_grants_select_visibility_boundary" on app.connection_grants as restrictive for select to anon, authenticated using (
  exists (select 1 from app.connections c where c.id = connection_id
    and app.is_workspace_member(c.workspace_id)
    and (c.scope = 'workspace' or (c.scope = 'personal' and c.owner_user_id = auth.uid())))
);

-- Do not grant personal owners new reads: references/jobs remain admin-only,
-- and even an admin must own a personal connection to inspect its dependents.
create policy "connection_credentials_select_visibility_boundary" on app.connection_credentials as restrictive for select to anon, authenticated using (
  exists (select 1 from app.connections c where c.id = connection_id
    and app.is_workspace_member(c.workspace_id)
    and app.has_workspace_role(c.workspace_id, array['owner','admin']::app.workspace_role[])
    and (c.scope = 'workspace' or (c.scope = 'personal' and c.owner_user_id = auth.uid())))
);
create policy "connection_sync_jobs_select_visibility_boundary" on app.connection_sync_jobs as restrictive for select to anon, authenticated using (
  exists (select 1 from app.connections c where c.id = connection_id
    and app.is_workspace_member(c.workspace_id)
    and app.has_workspace_role(c.workspace_id, array['owner','admin']::app.workspace_role[])
    and (c.scope = 'workspace' or (c.scope = 'personal' and c.owner_user_id = auth.uid())))
);
