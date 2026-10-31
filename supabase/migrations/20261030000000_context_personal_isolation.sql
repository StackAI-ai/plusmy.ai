-- Existing permissive admin policies also apply to SELECT, so personal visibility
-- must be enforced in addition to every existing policy, not as another OR policy.
create policy "context_assets_personal_owner"
on app.context_assets as restrictive for all to authenticated
using (owner_user_id is null or owner_user_id = auth.uid())
with check (owner_user_id is null or owner_user_id = auth.uid());

create policy "prompt_templates_personal_owner"
on app.prompt_templates as restrictive for all to authenticated
using (owner_user_id is null or owner_user_id = auth.uid())
with check (owner_user_id is null or owner_user_id = auth.uid());

create policy "skill_definitions_personal_owner"
on app.skill_definitions as restrictive for all to authenticated
using (owner_user_id is null or owner_user_id = auth.uid())
with check (owner_user_id is null or owner_user_id = auth.uid());

create policy "context_asset_chunks_personal_owner"
on app.context_asset_chunks as restrictive for all to authenticated
using (
  exists (
    select 1 from app.context_assets asset
    where asset.id = context_asset_chunks.asset_id
      and asset.workspace_id = context_asset_chunks.workspace_id
      and (asset.owner_user_id is null or asset.owner_user_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from app.context_assets asset
    where asset.id = context_asset_chunks.asset_id
      and asset.workspace_id = context_asset_chunks.workspace_id
      and (asset.owner_user_id is null or asset.owner_user_id = auth.uid())
  )
);

-- Deleting an owner must not silently convert private records into shared ones.
alter table app.context_assets drop constraint context_assets_owner_user_id_fkey;
alter table app.context_assets add constraint context_assets_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete restrict;
alter table app.prompt_templates drop constraint prompt_templates_owner_user_id_fkey;
alter table app.prompt_templates add constraint prompt_templates_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete restrict;
alter table app.skill_definitions drop constraint skill_definitions_owner_user_id_fkey;
alter table app.skill_definitions add constraint skill_definitions_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete restrict;

-- Replace the old client-callable definer function; caller identity is supplied
-- only by trusted server code and independently checked against membership.
drop function app.match_context_chunks(uuid, extensions.vector, integer, jsonb);

create function app.match_context_chunks(
  p_workspace_id uuid,
  p_actor_user_id uuid,
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
  select
    chunk.id,
    asset.id,
    asset.title,
    chunk.content,
    1 - (chunk.embedding operator(extensions.<=>) p_query_embedding),
    coalesce(chunk.metadata, '{}'::jsonb) || jsonb_build_object('asset_type', asset.type)
  from app.context_asset_chunks chunk
  join app.context_assets asset on asset.id = chunk.asset_id and asset.workspace_id = chunk.workspace_id
  where asset.workspace_id = p_workspace_id
    and (asset.owner_user_id is null or asset.owner_user_id = p_actor_user_id)
    and exists (
      select 1 from app.workspace_members member
      where member.workspace_id = p_workspace_id and member.user_id = p_actor_user_id
    )
    and chunk.embedding is not null
    and (
      p_filters ? 'asset_type' is false
      or asset.type = (p_filters ->> 'asset_type')::app.context_asset_type
    )
  order by chunk.embedding operator(extensions.<=>) p_query_embedding
  limit greatest(p_limit, 1);
$$;

revoke all on function app.match_context_chunks(uuid, uuid, extensions.vector, integer, jsonb)
  from public, anon, authenticated;
grant execute on function app.match_context_chunks(uuid, uuid, extensions.vector, integer, jsonb)
  to service_role;
