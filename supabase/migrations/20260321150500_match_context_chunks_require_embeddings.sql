create or replace function app.match_context_chunks(
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
set search_path = app, public, extensions
as $$
  select
    cac.id as chunk_id,
    ca.id as asset_id,
    ca.title,
    cac.content,
    1 - (cac.embedding <=> p_query_embedding) as similarity,
    coalesce(cac.metadata, '{}'::jsonb) || jsonb_build_object('asset_type', ca.type)
  from app.context_asset_chunks cac
  join app.context_assets ca on ca.id = cac.asset_id
  where ca.workspace_id = p_workspace_id
    and cac.embedding is not null
    and (
      p_filters ? 'asset_type' is false
      or ca.type = (p_filters ->> 'asset_type')::app.context_asset_type
    )
  order by cac.embedding <=> p_query_embedding
  limit greatest(p_limit, 1);
$$;
