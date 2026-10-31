begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'context-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'context-member@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'context-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'context-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into app.workspaces (id, name, slug, created_by)
values
  ('91000000-0000-4000-8000-000000000001', 'Context A', 'context-isolation-a', '90000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002', 'Context B', 'context-isolation-b', '90000000-0000-4000-8000-000000000004');

insert into app.workspace_members (workspace_id, user_id, role)
values
  ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'owner'),
  ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'member'),
  ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', 'admin'),
  ('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000004', 'owner');

insert into app.context_assets (id, workspace_id, owner_user_id, type, title, content)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', null, 'document', 'Shared', 'shared asset'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'document', 'Owner', 'owner private asset'),
  ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'document', 'Member', 'member private asset'),
  ('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002', null, 'document', 'Outside', 'outside asset');

insert into app.context_asset_chunks (id, workspace_id, asset_id, chunk_index, content, embedding)
select ('93000000-0000-4000-8000-' || lpad((row_number() over (order by id))::text, 12, '0'))::uuid,
       workspace_id, id, 0, content, ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector
from app.context_assets
where id::text like '92000000-0000-4000-8000-%';

-- A service-side inconsistency must not let a chunk cross its parent workspace.
insert into app.context_asset_chunks (id, workspace_id, asset_id, chunk_index, content, embedding)
values ('93000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000002',
        '92000000-0000-4000-8000-000000000001', 1, 'mismatched workspace',
        ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector);

insert into app.prompt_templates (id, workspace_id, owner_user_id, name, slug, content)
values
  ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', null, 'Shared', 'shared', 'shared prompt'),
  ('94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Owner', 'owner', 'owner private prompt'),
  ('94000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'Member', 'member', 'member private prompt');

insert into app.skill_definitions (id, workspace_id, owner_user_id, name, slug, instructions)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', null, 'Shared', 'shared', 'shared skill'),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Owner', 'owner', 'owner private skill'),
  ('95000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'Member', 'member', 'member private skill');

select ok(to_regprocedure('app.match_context_chunks(uuid,extensions.vector,integer,jsonb)') is null,
          'old client-callable search overload is removed');
select ok(not has_function_privilege('authenticated', 'app.match_context_chunks(uuid,uuid,extensions.vector,integer,jsonb)', 'execute'),
          'authenticated callers cannot spoof the search actor');
select ok(not has_function_privilege('anon', 'app.match_context_chunks(uuid,uuid,extensions.vector,integer,jsonb)', 'execute'),
          'anonymous callers cannot invoke search');
select ok(has_function_privilege('service_role', 'app.match_context_chunks(uuid,uuid,extensions.vector,integer,jsonb)', 'execute'),
          'the trusted service can invoke actor-scoped search');
select is((select confdeltype::text from pg_constraint where conrelid = 'app.context_assets'::regclass and conname = 'context_assets_owner_user_id_fkey'), 'r', 'asset owner deletion is restricted');
select is((select confdeltype::text from pg_constraint where conrelid = 'app.prompt_templates'::regclass and conname = 'prompt_templates_owner_user_id_fkey'), 'r', 'prompt owner deletion is restricted');
select is((select confdeltype::text from pg_constraint where conrelid = 'app.skill_definitions'::regclass and conname = 'skill_definitions_owner_user_id_fkey'), 'r', 'skill owner deletion is restricted');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from app.context_assets where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'member reads shared and own assets only');
select is((select count(*)::integer from app.context_asset_chunks where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'member reads shared and own chunks only');
select is((select count(*)::integer from app.prompt_templates where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'member reads shared and own prompts only');
select is((select count(*)::integer from app.skill_definitions where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'member reads shared and own skills only');
select ok(
  exists(select 1 from app.context_assets where id = '92000000-0000-4000-8000-000000000001')
  and exists(select 1 from app.context_assets where id = '92000000-0000-4000-8000-000000000003')
  and not exists(select 1 from app.context_assets where id = '92000000-0000-4000-8000-000000000002')
  and not exists(select 1 from app.prompt_templates where id = '94000000-0000-4000-8000-000000000002')
  and not exists(select 1 from app.skill_definitions where id = '95000000-0000-4000-8000-000000000002'),
  'member visibility includes shared and own records but never owner private records'
);
select throws_ok(
  $$select * from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)$$,
  '42501', null, 'member cannot call search with a forged actor'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from app.context_assets where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'workspace owner cannot read another member private asset');
select is((select count(*)::integer from app.context_asset_chunks where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'workspace owner cannot read another member private chunk');
select is((select count(*)::integer from app.prompt_templates where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'workspace owner cannot read another member private prompt');
select is((select count(*)::integer from app.skill_definitions where workspace_id = '91000000-0000-4000-8000-000000000001'), 2, 'workspace owner cannot read another member private skill');
select ok(
  exists(select 1 from app.context_assets where id = '92000000-0000-4000-8000-000000000001')
  and exists(select 1 from app.context_assets where id = '92000000-0000-4000-8000-000000000002')
  and not exists(select 1 from app.context_assets where id = '92000000-0000-4000-8000-000000000003')
  and not exists(select 1 from app.prompt_templates where id = '94000000-0000-4000-8000-000000000003')
  and not exists(select 1 from app.skill_definitions where id = '95000000-0000-4000-8000-000000000003'),
  'owner visibility includes shared and own records but never member private records'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from app.context_assets where workspace_id = '91000000-0000-4000-8000-000000000001'), 1, 'admin reads only shared assets when no personal asset belongs to them');
select is((select count(*)::integer from app.context_asset_chunks where workspace_id = '91000000-0000-4000-8000-000000000001'), 1, 'admin reads only shared chunks');
select is((select count(*)::integer from app.prompt_templates where workspace_id = '91000000-0000-4000-8000-000000000001'), 1, 'admin reads only shared prompts');
select is((select count(*)::integer from app.skill_definitions where workspace_id = '91000000-0000-4000-8000-000000000001'), 1, 'admin reads only shared skills');
with changed as (
  update app.context_assets set content = 'not allowed' where id = '92000000-0000-4000-8000-000000000002' returning id
)
select is((select count(*)::integer from changed), 0, 'admin cannot update another member private asset');
with changed as (
  update app.context_assets set content = 'updated shared asset' where id = '92000000-0000-4000-8000-000000000001' returning id
)
select is((select count(*)::integer from changed), 1, 'admin can still update shared assets');

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from app.context_assets where workspace_id = '91000000-0000-4000-8000-000000000001'), 0, 'outsider cannot read assets from another workspace');
select is((select count(*)::integer from app.context_asset_chunks where workspace_id = '91000000-0000-4000-8000-000000000002'), 1, 'outsider cannot read a chunk whose parent belongs to another workspace');
select is((select count(*)::integer from app.prompt_templates where workspace_id = '91000000-0000-4000-8000-000000000001'), 0, 'outsider cannot read prompts from another workspace');
select is((select count(*)::integer from app.skill_definitions where workspace_id = '91000000-0000-4000-8000-000000000001'), 0, 'outsider cannot read skills from another workspace');

reset role;
set local role service_role;
select is((select count(*)::integer from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), 2, 'search returns shared and owner personal chunks');
select is((select count(*)::integer from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), 2, 'search returns shared and member personal chunks');
select is((select string_agg(chunk_id::text, ',' order by chunk_id) from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), '93000000-0000-4000-8000-000000000001,93000000-0000-4000-8000-000000000002', 'search returns precisely the shared and owner chunks');
select is((select string_agg(chunk_id::text, ',' order by chunk_id) from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), '93000000-0000-4000-8000-000000000001,93000000-0000-4000-8000-000000000003', 'search returns precisely the shared and member chunks');
select is((select count(*)::integer from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), 1, 'search excludes others personal chunks for an admin');
select is((select count(*)::integer from app.match_context_chunks('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), 0, 'search rejects a nonmember actor');
select is((select count(*)::integer from app.match_context_chunks('91000000-0000-4000-8000-000000000001', null, ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), 0, 'search fails closed without an actor');
select is((select count(*)::integer from app.match_context_chunks('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000004', ('[1,' || repeat('0,', 1534) || '0]')::extensions.vector)), 1, 'search excludes chunks whose parent is in another workspace');

reset role;
select throws_ok(
  $$delete from auth.users where id = '90000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'owner deletion cannot silently turn private context into shared context'
);

select * from finish();
rollback;
