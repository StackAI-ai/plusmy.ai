begin;

create extension if not exists pgtap with schema extensions;

select plan(46);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'owner-a@example.com',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Owner A"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-5555-5555-555555555555',
    'authenticated',
    'authenticated',
    'member-b@example.com',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Member B"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into app.workspaces (id, name, slug, created_by)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A', 'workspace-a', '11111111-1111-1111-1111-111111111111'),
  ('99999999-9999-9999-9999-999999999999', 'Workspace B', 'workspace-b', '55555555-5555-5555-5555-555555555555')
on conflict (id) do nothing;

insert into app.workspace_members (workspace_id, user_id, role)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 'owner')
on conflict (workspace_id, user_id) do nothing;

insert into app.oauth_clients (client_id, client_name, redirect_uris, created_by)
values ('client-security-tests', 'Security Test Client', '{"https://example.com/callback"}', '11111111-1111-1111-1111-111111111111')
on conflict (client_id) do nothing;

insert into app.connections (
  id,
  connection_key,
  workspace_id,
  owner_user_id,
  provider,
  scope,
  status,
  display_name,
  external_account_id,
  granted_scopes
)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:google:workspace:workspace:default',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  null,
  'google',
  'workspace',
  'active',
  'Workspace A Google',
  'external-account-a',
  '{"https://www.googleapis.com/auth/drive.readonly"}'
)
on conflict (id) do nothing;

insert into app.connection_credentials (
  connection_id,
  access_token_secret_id,
  refresh_token_secret_id,
  token_type,
  version
)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'Bearer',
  1
)
on conflict (connection_id) do nothing;

insert into app.oauth_client_approvals (
  client_id,
  workspace_id,
  user_id,
  scopes,
  status
)
values (
  'client-security-tests',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  '{"mcp:tools","mcp:resources"}',
  'active'
)
on conflict (client_id, workspace_id, user_id) do nothing;

insert into app.oauth_authorization_codes (
  code_hash,
  client_id,
  user_id,
  workspace_id,
  redirect_uri,
  scopes,
  code_challenge,
  code_challenge_method,
  expires_at
)
values
  (
    'hash-replay',
    'client-security-tests',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'https://example.com/callback',
    '{"mcp:tools","mcp:resources"}',
    'challenge',
    'S256',
    now() + interval '10 minutes'
  ),
  (
    'hash-expired',
    'client-security-tests',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'https://example.com/callback',
    '{"mcp:tools","mcp:resources"}',
    'challenge',
    'S256',
    now() - interval '1 minute'
  ),
  (
    'hash-revoke',
    'client-security-tests',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'https://example.com/callback',
    '{"mcp:tools","mcp:resources"}',
    'challenge',
    'S256',
    now() + interval '10 minutes'
  )
on conflict (code_hash) do nothing;

insert into app.oauth_refresh_tokens (
  token_hash,
  client_id,
  user_id,
  workspace_id,
  scopes,
  expires_at
)
values
  ('refresh-revoke', 'client-security-tests', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"mcp:tools","mcp:resources"}', now() + interval '30 days'),
  ('refresh-rotate', 'client-security-tests', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"mcp:tools","mcp:resources"}', now() + interval '30 days'),
  ('refresh-expired', 'client-security-tests', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"mcp:tools","mcp:resources"}', now() - interval '1 minute')
on conflict (token_hash) do nothing;

insert into app.workspace_invites (workspace_id, email, role, invited_by, token_hash)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'member-b@example.com',
  'member',
  '11111111-1111-1111-1111-111111111111',
  'security-invite-hash'
)
on conflict (token_hash) do nothing;

select ok(
  has_function_privilege('service_role', 'app.consume_oauth_authorization_code(text, text, text)', 'EXECUTE'),
  'service_role can atomically consume authorization codes'
);

select ok(
  not has_function_privilege('authenticated', 'app.consume_oauth_authorization_code(text, text, text)', 'EXECUTE'),
  'authenticated callers cannot directly consume authorization codes'
);

select ok(
  has_function_privilege('service_role', 'app.rotate_oauth_refresh_token(text, text, text, timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app.rotate_oauth_refresh_token(text, text, text, timestamptz)', 'EXECUTE'),
  'only service_role can rotate OAuth refresh tokens'
);

select ok(
  has_function_privilege('service_role', 'app.revoke_oauth_client_approval(uuid, uuid, uuid, text)', 'EXECUTE'),
  'service_role can revoke OAuth client approvals through the definer helper'
);

select ok(
  not has_function_privilege('authenticated', 'app.revoke_oauth_client_approval(uuid, uuid, uuid, text)', 'EXECUTE'),
  'authenticated callers cannot revoke OAuth client approvals directly'
);

select ok(
  has_function_privilege('service_role', 'app.accept_workspace_invite(text, uuid)', 'EXECUTE'),
  'service_role can atomically accept workspace invites'
);

select ok(
  not has_function_privilege('authenticated', 'app.accept_workspace_invite(text, uuid)', 'EXECUTE'),
  'authenticated callers cannot directly accept workspace invites'
);

set local role service_role;

select is(
  (select (app.rotate_oauth_refresh_token(
    'refresh-rotate', 'refresh-rotated', 'client-security-tests', now() + interval '30 days'
  )).token_hash),
  'refresh-rotate',
  'first refresh rotation consumes the prior token'
);

select ok(
  exists (select 1 from app.oauth_refresh_tokens where token_hash = 'refresh-rotated' and revoked_at is null),
  'refresh rotation persists the replacement token'
);

select is(
  (select (app.rotate_oauth_refresh_token(
    'refresh-rotate', 'refresh-replayed', 'client-security-tests', now() + interval '30 days'
  )).token_hash),
  null::text,
  'refresh tokens cannot be rotated twice'
);

select is(
  (select (app.rotate_oauth_refresh_token(
    'refresh-expired', 'refresh-expired-replacement', 'client-security-tests', now() + interval '30 days'
  )).token_hash),
  null::text,
  'expired refresh tokens cannot be rotated'
);

select is(
  (select count(*)::integer from app.accept_workspace_invite('security-invite-hash', '55555555-5555-5555-5555-555555555555')),
  1,
  'a service-only invite acceptance returns one row'
);

select ok(
  exists (
    select 1 from app.workspace_members
    where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id = '55555555-5555-5555-5555-555555555555'
      and role = 'member'
  ),
  'invite acceptance creates the authorized membership'
);

select ok(
  exists (
    select 1 from app.workspace_invites
    where token_hash = 'security-invite-hash' and accepted_at is not null
  ),
  'invite acceptance consumes the token in the same transaction'
);

delete from app.workspace_members
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and user_id = '55555555-5555-5555-5555-555555555555';

select is(
  (
    select (app.consume_oauth_authorization_code('hash-replay', 'client-security-tests', 'https://example.com/callback')).code_hash
  ),
  'hash-replay',
  'first authorization-code consume returns the matching row'
);

select ok(
  (
    select consumed_at is not null
    from app.oauth_authorization_codes
    where code_hash = 'hash-replay'
  ),
  'first authorization-code consume records consumed_at'
);

select is(
  (
    select (app.consume_oauth_authorization_code('hash-replay', 'client-security-tests', 'https://example.com/callback')).code_hash
  ),
  null::text,
  'consumed authorization codes cannot be replayed'
);

select is(
  (
    select (app.consume_oauth_authorization_code('hash-expired', 'client-security-tests', 'https://example.com/callback')).code_hash
  ),
  null::text,
  'expired authorization codes are rejected by the database helper'
);

select ok(
  app.revoke_oauth_client_approval(
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'Revoked by approving user.'
  ) is null,
  'revoking an unknown approval returns null'
);

select is(
  (
    select (app.revoke_oauth_client_approval(
      (select id from app.oauth_client_approvals where client_id = 'client-security-tests'),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
      'Revoked by approving user.'
    )).status
  ),
  'revoked',
  'revoking an approval updates the approval status'
);

select ok(
  (
    select revoked_at is not null
    from app.oauth_client_approvals
    where client_id = 'client-security-tests'
      and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'revoking an approval records revoked_at on the approval row'
);

select is(
  (
    select metadata ->> 'revoked_by_user_id'
    from app.oauth_client_approvals
    where client_id = 'client-security-tests'
      and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-1111-1111-111111111111'
  ),
  '11111111-1111-1111-1111-111111111111',
  'revocation metadata records the revoking actor'
);

select is(
  (
    select count(*)::integer
    from app.oauth_authorization_codes
    where client_id = 'client-security-tests'
      and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-1111-1111-111111111111'
      and consumed_at is null
  ),
  0,
  'revoking an approval invalidates outstanding authorization codes'
);

select ok(
  (
    select revoked_at is not null
    from app.oauth_refresh_tokens
    where token_hash = 'refresh-revoke'
  ),
  'revoking an approval invalidates refresh tokens for that client and workspace'
);

select ok(
  has_function_privilege('service_role', 'app.resolve_secret(uuid)', 'EXECUTE'),
  'service_role can resolve secrets through the definer helper'
);

select ok(
  not has_function_privilege('authenticated', 'app.resolve_secret(uuid)', 'EXECUTE'),
  'authenticated callers cannot execute resolve_secret'
);

select ok(
  not has_schema_privilege('authenticated', 'vault', 'USAGE'),
  'authenticated callers do not have direct vault schema access'
);

select is(
  (
    with stored as (
      select app.put_secret('super-secret-value', null, 'test-secret', 'security regression') as secret_id
    )
    select app.resolve_secret(secret_id)
    from stored
  ),
  'super-secret-value',
  'service_role can round-trip a Vault secret through the SQL helpers'
);

select ok(
  has_function_privilege('service_role', 'app.consume_rate_limit(uuid, text, text, integer, integer)', 'EXECUTE'),
  'service_role can execute consume_rate_limit'
);

select ok(
  not has_function_privilege('authenticated', 'app.consume_rate_limit(uuid, text, text, integer, integer)', 'EXECUTE'),
  'authenticated callers cannot execute consume_rate_limit directly'
);

select ok(
  (
    with result as (
      select app.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'subject-a', 'tool.read', 60, 2) as payload
    )
    select (payload ->> 'allowed')::boolean and (payload ->> 'remaining')::integer = 1
    from result
  ),
  'first rate-limit event is allowed and decrements remaining budget'
);

select ok(
  (
    with result as (
      select app.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'subject-a', 'tool.read', 60, 2) as payload
    )
    select (payload ->> 'allowed')::boolean and (payload ->> 'remaining')::integer = 0 and (payload ->> 'count')::integer = 2
    from result
  ),
  'second rate-limit event stays allowed at the exact limit'
);

select ok(
  (
    with result as (
      select app.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'subject-a', 'tool.read', 60, 2) as payload
    )
    select not (payload ->> 'allowed')::boolean and (payload ->> 'remaining')::integer = 0 and (payload ->> 'count')::integer = 3
    from result
  ),
  'third rate-limit event is blocked after the limit is exceeded'
);

select ok(
  (
    with result as (
      select app.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'subject-b', 'tool.read', 60, 2) as payload
    )
    select (payload ->> 'allowed')::boolean and (payload ->> 'count')::integer = 1
    from result
  ),
  'different subjects receive isolated rate-limit buckets'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select is(
  (select count(*)::integer from app.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'workspace members can read their own workspace'
);

select is(
  (select count(*)::integer from app.workspaces where id = '99999999-9999-9999-9999-999999999999'),
  0,
  'workspace members cannot read other workspaces'
);

select is(
  (select count(*)::integer from app.connections where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'workspace members can read connections in their own workspace'
);

select is(
  (select count(*)::integer from app.connection_credentials),
  1,
  'workspace owners can read credentials for their own workspace connections'
);

select is(
  (select count(*)::integer from app.oauth_client_approvals
    where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and client_id = 'client-security-tests'),
  1,
  'approval owners can read their own workspace approvals'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

select is(
  (select count(*)::integer from app.connections where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'non-members cannot read connections from another workspace'
);

select is(
  (select count(*)::integer from app.connection_credentials),
  0,
  'non-members cannot read connection credentials outside their workspace'
);

select is(
  (select count(*)::integer from app.oauth_client_approvals where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'non-members cannot read approvals from another workspace'
);

reset role;

select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'scheduled worker has pg_net available'
);

select is(
  (select count(*)::integer from cron.job where jobname = 'plusmy-connection-worker' and schedule = '* * * * *'),
  1,
  'connection worker is scheduled every minute'
);

select ok(
  not has_function_privilege('authenticated', 'app.invoke_connection_worker()', 'EXECUTE')
    and not has_function_privilege('anon', 'app.invoke_connection_worker()', 'EXECUTE'),
  'browser roles cannot invoke the scheduled worker dispatcher'
);

select is(
  (select app.invoke_connection_worker()),
  null::bigint,
  'worker dispatch fails closed when Vault is not configured'
);

select * from finish();
rollback;
