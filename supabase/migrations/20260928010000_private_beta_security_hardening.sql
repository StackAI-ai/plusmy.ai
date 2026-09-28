-- Membership checks must bypass the workspace_members policy they are used by.
alter function app.is_workspace_member(uuid) security definer;
alter function app.is_workspace_member(uuid) set search_path = '';
alter function app.has_workspace_role(uuid, app.workspace_role[]) security definer;
alter function app.has_workspace_role(uuid, app.workspace_role[]) set search_path = '';
alter function app.current_workspace_ids() security definer;
alter function app.current_workspace_ids() set search_path = '';

-- Vault reads may follow a write in the same SQL statement.
alter function app.resolve_secret(uuid) volatile;

-- The stale-recovery migration added a defaulted overload without removing the old RPC.
drop function if exists app.claim_connection_sync_jobs(text, integer);

revoke execute on function app.consume_oauth_authorization_code(text, text, text) from public, anon, authenticated;
revoke execute on function app.revoke_oauth_client_approval(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function app.store_secret(text, text, text) from public, anon, authenticated;
revoke execute on function app.put_secret(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function app.resolve_secret(uuid) from public, anon, authenticated;
revoke execute on function app.consume_rate_limit(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function app.enqueue_token_refresh(uuid, text) from public, anon, authenticated;
revoke execute on function app.acquire_connection_refresh_lock(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function app.release_connection_refresh_lock(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.schedule_connection_job(uuid, text, jsonb, timestamptz, integer) from public, anon, authenticated;
revoke execute on function app.claim_connection_sync_jobs(text, integer, integer) from public, anon, authenticated;

grant execute on function app.consume_oauth_authorization_code(text, text, text) to service_role;
grant execute on function app.revoke_oauth_client_approval(uuid, uuid, uuid, text) to service_role;
grant execute on function app.store_secret(text, text, text) to service_role;
grant execute on function app.put_secret(text, uuid, text, text) to service_role;
grant execute on function app.resolve_secret(uuid) to service_role;
grant execute on function app.consume_rate_limit(uuid, text, text, integer, integer) to service_role;
grant execute on function app.enqueue_token_refresh(uuid, text) to service_role;
grant execute on function app.acquire_connection_refresh_lock(uuid, uuid, integer) to service_role;
grant execute on function app.release_connection_refresh_lock(uuid, uuid) to service_role;
grant execute on function app.schedule_connection_job(uuid, text, jsonb, timestamptz, integer) to service_role;
grant execute on function app.claim_connection_sync_jobs(text, integer, integer) to service_role;
