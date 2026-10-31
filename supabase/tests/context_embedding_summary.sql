begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'health-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'health-member@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'health-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'health-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into app.workspaces (id, name, slug, created_by) values
  ('a2000000-0000-4000-8000-000000000001', 'Health A', 'health-summary-a', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002', 'Health B', 'health-summary-b', 'a1000000-0000-4000-8000-000000000004');

insert into app.workspace_members (workspace_id, user_id, role) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'member'),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'admin'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004', 'owner');

-- Deliberately exceed PostgREST's usual 1,000-row cap.
insert into app.context_assets (workspace_id, type, title, content)
select 'a2000000-0000-4000-8000-000000000001', 'document', 'Shared ' || n, 'shared'
from generate_series(1, 1205) n;

insert into app.context_asset_chunks (workspace_id, asset_id, chunk_index, content, metadata, created_at)
select workspace_id, id, 0, 'shared', '{"embedded":true,"embedded_at":"2025-01-01T00:00:00Z"}', '2024-01-01T00:00:00Z'
from app.context_assets where workspace_id = 'a2000000-0000-4000-8000-000000000001';

insert into app.context_assets (id, workspace_id, owner_user_id, type, title, content, metadata) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'document', 'Owner', 'owner', '{"system_managed":true}'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'document', 'Member', 'member', '{}'),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', null, 'document', 'Outside', 'outside', '{}');

insert into app.context_asset_chunks (workspace_id, asset_id, chunk_index, content, metadata, created_at) values
  ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 0, 'owner', '{"embedded":true,"embedded_at":"not a date"}', '2026-01-01T00:00:00Z'),
  ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 1, 'not embedded', '{}', '2027-01-01T00:00:00Z'),
  ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 0, 'member', '{"embedded":true,"embedded_at":"2030-01-01T00:00:00Z"}', '2024-01-01T00:00:00Z'),
  ('a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 2, 'wrong workspace', '{"embedded":true,"embedded_at":"2040-01-01T00:00:00Z"}', '2024-01-01T00:00:00Z');

select ok(not has_function_privilege('anon', 'app.context_embedding_summary(uuid,uuid)', 'execute'), 'anonymous users cannot select an actor');
select ok(not has_function_privilege('authenticated', 'app.context_embedding_summary(uuid,uuid)', 'execute'), 'authenticated users cannot select an actor');
select ok(has_function_privilege('service_role', 'app.context_embedding_summary(uuid,uuid)', 'execute'), 'trusted service can request a summary');
select ok(not has_function_privilege('authenticated', 'app.context_embedded_at(jsonb,timestamptz)', 'execute'), 'timestamp helper is not exposed');
select is(app.context_embedded_at('{"embedded_at":"2026-01-01T00:00:00+99:00"}', '2025-01-01T00:00:00Z'), '2025-01-01T00:00:00Z'::timestamptz, 'out-of-range timezone falls back to creation time');
select is(app.context_embedded_at('{"embedded_at":"2026-02-30T00:00:00Z"}', '2025-01-01T00:00:00Z'), '2025-01-01T00:00:00Z'::timestamptz, 'out-of-range date falls back to creation time');
select is(app.context_embedded_at('{"embedded_at":42}', '2025-01-01T00:00:00Z'), '2025-01-01T00:00:00Z'::timestamptz, 'non-string date falls back to creation time');

select is((select total_assets::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')), 1206, 'owner sees all shared assets plus own asset above the row cap');
select is((select system_managed_assets::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')), 1, 'owner sees only their managed asset');
select is((select total_chunks::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')), 1207, 'owner chunk count excludes other owners and mismatched workspaces');
select is((select embedded_chunks::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')), 1206, 'only embedded visible chunks are counted');
select is((select last_embedded_at from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')), '2026-01-01T00:00:00Z'::timestamptz, 'malformed embedding date falls back to creation time');
select is((select total_assets::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003')), 1205, 'admin sees shared assets only');
select is((select total_chunks::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003')), 1205, 'admin sees shared chunks only');
select is((select last_embedded_at from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003')), '2025-01-01T00:00:00Z'::timestamptz, 'admin cannot infer private embedding dates');
select is((select last_embedded_at from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002')), '2030-01-01T00:00:00Z'::timestamptz, 'member sees their own embedding date');
select is((select count(*)::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004')), 0, 'non-member receives no summary');
select is((select count(*)::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', null)), 0, 'null actor receives no summary');
select is((select count(*)::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001')), 0, 'membership in another workspace does not grant access');

set local role authenticated;
select throws_ok($$select * from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')$$, '42501', null, 'authenticated calls cannot bypass the server');
reset role;
set local role service_role;
select is((select total_assets::integer from app.context_embedding_summary('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')), 1206, 'service role invokes the same actor-scoped summary');
reset role;

select * from finish();
rollback;
