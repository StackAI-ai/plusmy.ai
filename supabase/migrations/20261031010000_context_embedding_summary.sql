-- Malformed historical metadata must not make the health page unavailable.
create function app.context_embedded_at(p_metadata jsonb, p_created_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_metadata -> 'embedded_at') = 'string' then
    begin
      return (p_metadata ->> 'embedded_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      null;
    end;
  end if;
  return p_created_at;
end;
$$;

revoke all on function app.context_embedded_at(jsonb, timestamptz) from public, anon, authenticated;

-- The trusted server supplies the actor; membership is checked in the same
-- database operation as the aggregates. Never expose actor selection to users.
create function app.context_embedding_summary(p_workspace_id uuid, p_actor_user_id uuid)
returns table (
  total_assets bigint,
  system_managed_assets bigint,
  total_chunks bigint,
  embedded_chunks bigint,
  last_embedded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with membership as materialized (
    select 1 from app.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_actor_user_id
  ), visible_assets as materialized (
    select a.id, a.metadata
    from app.context_assets a
    where a.workspace_id = p_workspace_id
      and (a.owner_user_id is null or a.owner_user_id = p_actor_user_id)
      and exists (select 1 from membership)
  ), asset_counts as (
    select count(*) as total,
      count(*) filter (where a.metadata -> 'system_managed' = 'true'::jsonb
        or a.metadata -> 'hidden_from_operator' = 'true'::jsonb) as managed
    from visible_assets a
  ), chunk_counts as (
    select count(*) as total,
      count(*) filter (where c.metadata -> 'embedded' = 'true'::jsonb) as embedded,
      max(app.context_embedded_at(c.metadata, c.created_at))
        filter (where c.metadata -> 'embedded' = 'true'::jsonb) as last_embedded
    from app.context_asset_chunks c
    join visible_assets a on a.id = c.asset_id
    where c.workspace_id = p_workspace_id
  )
  select ac.total, ac.managed, cc.total, cc.embedded, cc.last_embedded
  from membership cross join asset_counts ac cross join chunk_counts cc;
$$;

revoke all on function app.context_embedding_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function app.context_embedding_summary(uuid, uuid) to service_role;
