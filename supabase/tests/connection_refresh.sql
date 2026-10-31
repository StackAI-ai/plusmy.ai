begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into app.workspaces (id, name, slug)
values ('ab000000-0000-0000-0000-000000000001', 'Refresh test', 'refresh-fencing-test');
insert into app.providers (id, display_name) values ('refresh-test', 'Refresh test') on conflict (id) do nothing;
insert into app.connections (id, connection_key, workspace_id, provider, scope, status, display_name)
values ('ab000000-0000-0000-0000-000000000002', 'refresh-fencing-test',
  'ab000000-0000-0000-0000-000000000001', 'refresh-test', 'workspace', 'active', 'Refresh test');

select ok(not has_function_privilege('authenticated', 'app.commit_connection_refresh(uuid,uuid,text,text,text,text,timestamptz,text[])', 'execute'), 'authenticated cannot commit refresh credentials');
select ok(not has_function_privilege('authenticated', 'app.begin_connection_refresh(uuid,uuid,integer)', 'execute'), 'authenticated cannot read the refresh snapshot');
select ok(not has_function_privilege('anon', 'app.install_connection_credentials(text,uuid,uuid,text,app.connection_scope,text,text,text,text[],timestamptz,jsonb,text,text,text,text)', 'execute'), 'anonymous cannot install credentials');
select ok(has_function_privilege('service_role', 'app.commit_connection_refresh(uuid,uuid,text,text,text,text,timestamptz,text[])', 'execute'), 'service role can commit a fenced refresh');
select ok(not has_function_privilege('service_role', 'app.write_connection_credentials(uuid,text,text,text,text,text,timestamptz,text[])', 'execute'), 'credential helper cannot bypass the row fence');

select ok((app.install_connection_credentials('refresh-fencing-test', 'ab000000-0000-0000-0000-000000000001', null,
  'refresh-test', 'workspace', 'Refresh test', 'account', null, array['read'], null, '{}'::jsonb,
  'initial-access', 'initial-refresh', null, 'Bearer')->'connection'->>'status') = 'active', 'initial install succeeds');
select is((select app.resolve_secret(refresh_token_secret_id) from app.connection_credentials where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'initial-refresh', 'install stores the refresh token in Vault');

select is(app.begin_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000010', 30)->'credentials'->>'refreshToken', 'initial-refresh', 'first refresh atomically acquires a lease and credential snapshot');
select ok(not app.acquire_connection_refresh_lock('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000011', 30), 'a competing refresh cannot acquire the lease');
update app.connections set status = 'revoked', refresh_lock_id = null, refresh_lock_expires_at = null
where id = 'ab000000-0000-0000-0000-000000000002';
select is(app.commit_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000010',
  'stale-access', 'stale-refresh', null, 'Bearer', null, array['write']), 'fenced', 'a late refresh cannot commit after revoke');
select ok(not app.fail_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000010'), 'a late failure cannot replace revoked status');
select is((select status::text from app.connections where id = 'ab000000-0000-0000-0000-000000000002'), 'revoked', 'revoke remains terminal against old refresh work');
select is((select app.resolve_secret(refresh_token_secret_id) from app.connection_credentials where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'initial-refresh', 'fenced refresh does not mutate Vault');

select ok((app.install_connection_credentials('refresh-fencing-test', 'ab000000-0000-0000-0000-000000000001', null,
  'refresh-test', 'workspace', 'Refresh test', 'account', null, array['read'], null, '{}'::jsonb,
  'reconnected-access', 'reconnected-refresh', null, 'Bearer')->'connection'->>'status') = 'active', 'reconnect succeeds');
select is((select status::text from app.connections where id = 'ab000000-0000-0000-0000-000000000002'), 'active', 'explicit reconnect activates the connection');
select ok(app.acquire_connection_refresh_lock('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000012', 30), 'refresh starts before another reconnect');
select ok((app.install_connection_credentials('refresh-fencing-test', 'ab000000-0000-0000-0000-000000000001', null,
  'refresh-test', 'workspace', 'Refresh test', 'account', null, array['read'], null, '{}'::jsonb,
  'new-reconnect-access', 'new-reconnect-refresh', null, 'Bearer')->'connection'->>'status') = 'active', 'concurrent reconnect succeeds');
select is(app.commit_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000012',
  'old-refresh-access', 'old-refresh-token', null, 'Bearer', null, array['write']), 'fenced', 'reconnect invalidates older refresh work');
select is((select app.resolve_secret(refresh_token_secret_id) from app.connection_credentials where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'new-reconnect-refresh', 'late refresh cannot overwrite reconnected Vault data');

select ok(app.acquire_connection_refresh_lock('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000013', 30), 'valid refresh obtains a lease');
select is(app.commit_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000013',
  'valid-access', 'valid-refresh', null, 'Bearer', null, array['write']), 'committed', 'valid refresh commits');
select is((select app.resolve_secret(refresh_token_secret_id) from app.connection_credentials where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'valid-refresh', 'valid refresh updates Vault');
select is((select scope from app.connection_grants where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'write', 'valid refresh updates grants');

select ok(app.acquire_connection_refresh_lock('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000014', 30), 'lease acquired for rollback check');
select throws_ok($test$select app.commit_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000014',
  'rollback-access', 'rollback-refresh', null, 'Bearer', null, array[null::text])$test$, '23502', null, 'a grant write failure aborts the transaction');
select is((select app.resolve_secret(refresh_token_secret_id) from app.connection_credentials where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'valid-refresh', 'failed transaction rolls back Vault changes');
select is((select scope from app.connection_grants where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'write', 'failed transaction rolls back grants');
update app.connections set refresh_lock_expires_at = clock_timestamp() - interval '1 second'
where id = 'ab000000-0000-0000-0000-000000000002';
select ok(not app.acquire_connection_refresh_lock('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000015', 30), 'expired lease is not stolen');
select is((select status::text from app.connections where id = 'ab000000-0000-0000-0000-000000000002'), 'reauth_required', 'expired uncertain refresh requires reconnect');
select is(app.commit_connection_refresh('ab000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000014',
  'late-access', 'late-refresh', null, 'Bearer', null, array['write']), 'fenced', 'late result from expired lease is fenced');
select is((select app.resolve_secret(refresh_token_secret_id) from app.connection_credentials where connection_id = 'ab000000-0000-0000-0000-000000000002'), 'valid-refresh', 'expired attempt does not mutate Vault');

select * from finish();
rollback;
