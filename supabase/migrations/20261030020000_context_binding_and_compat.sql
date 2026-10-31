-- Older server revisions can continue reading shared context after this
-- migration, but cannot access personal chunks without an authenticated actor.
create function app.match_context_chunks(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(1536),
  p_limit integer default 8,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  chunk_id uuid,
  asset_id uuid,
  title text,
  content text,
  similarity double precision,
  metadata jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  select chunk.id, asset.id, asset.title, chunk.content,
         1 - (chunk.embedding operator(extensions.<=>) p_query_embedding),
         coalesce(chunk.metadata, '{}'::jsonb) || jsonb_build_object('asset_type', asset.type)
  from app.context_asset_chunks chunk
  join app.context_assets asset on asset.id = chunk.asset_id and asset.workspace_id = chunk.workspace_id
  where asset.workspace_id = p_workspace_id
    and asset.owner_user_id is null
    and chunk.embedding is not null
    and (p_filters ? 'asset_type' is false or asset.type = (p_filters ->> 'asset_type')::app.context_asset_type)
  order by chunk.embedding operator(extensions.<=>) p_query_embedding
  limit greatest(p_limit, 1);
$$;

revoke all on function app.match_context_chunks(uuid, extensions.vector, integer, jsonb)
  from public, anon, authenticated;
grant execute on function app.match_context_chunks(uuid, extensions.vector, integer, jsonb)
  to service_role;

-- Context cannot be moved between workspaces or converted between scopes by
-- direct writes; otherwise bindings or shared derived copies may become stale.
create or replace function app.prevent_context_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id
     or new.workspace_id is distinct from old.workspace_id then
    raise exception 'Context ownership and workspace cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger prevent_context_asset_owner_change on app.context_assets;
create trigger prevent_context_asset_owner_change
before update of owner_user_id, workspace_id on app.context_assets
for each row execute function app.prevent_context_owner_change();
drop trigger prevent_prompt_owner_change on app.prompt_templates;
create trigger prevent_prompt_owner_change
before update of owner_user_id, workspace_id on app.prompt_templates
for each row execute function app.prevent_context_owner_change();
drop trigger prevent_skill_owner_change on app.skill_definitions;
create trigger prevent_skill_owner_change
before update of owner_user_id, workspace_id on app.skill_definitions
for each row execute function app.prevent_context_owner_change();

-- Enforce the shared, same-workspace binding contract even for service writes.
create function app.validate_context_binding_resources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.binding_type not in ('workspace', 'provider', 'tool')
     or btrim(new.target_key) = ''
     or (new.prompt_template_id is null and new.skill_definition_id is null)
     or (new.prompt_template_id is not null and not exists (
       select 1 from app.prompt_templates prompt
       where prompt.id = new.prompt_template_id
         and prompt.workspace_id = new.workspace_id and prompt.owner_user_id is null
     ))
     or (new.skill_definition_id is not null and not exists (
       select 1 from app.skill_definitions skill
       where skill.id = new.skill_definition_id
         and skill.workspace_id = new.workspace_id and skill.owner_user_id is null
     )) then
    raise exception 'Bindings require shared resources in the same workspace.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_context_binding_resources
before insert or update of workspace_id, binding_type, target_key, prompt_template_id, skill_definition_id on app.context_bindings
for each row execute function app.validate_context_binding_resources();
revoke all on function app.validate_context_binding_resources() from public, anon, authenticated;

-- Also hide malformed historical bindings from direct authenticated reads.
create policy "context_bindings_shared_resources"
on app.context_bindings as restrictive for all to authenticated
using (
  binding_type in ('workspace', 'provider', 'tool') and btrim(target_key) <> ''
  and (prompt_template_id is not null or skill_definition_id is not null)
  and (prompt_template_id is null or exists (
    select 1 from app.prompt_templates prompt
    where prompt.id = context_bindings.prompt_template_id
      and prompt.workspace_id = context_bindings.workspace_id and prompt.owner_user_id is null
  ))
  and (skill_definition_id is null or exists (
    select 1 from app.skill_definitions skill
    where skill.id = context_bindings.skill_definition_id
      and skill.workspace_id = context_bindings.workspace_id and skill.owner_user_id is null
  ))
)
with check (
  binding_type in ('workspace', 'provider', 'tool') and btrim(target_key) <> ''
  and (prompt_template_id is not null or skill_definition_id is not null)
  and (prompt_template_id is null or exists (
    select 1 from app.prompt_templates prompt
    where prompt.id = context_bindings.prompt_template_id
      and prompt.workspace_id = context_bindings.workspace_id and prompt.owner_user_id is null
  ))
  and (skill_definition_id is null or exists (
    select 1 from app.skill_definitions skill
    where skill.id = context_bindings.skill_definition_id
      and skill.workspace_id = context_bindings.workspace_id and skill.owner_user_id is null
  ))
);
