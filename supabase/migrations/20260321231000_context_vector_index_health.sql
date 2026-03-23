create or replace function app.context_vector_index_health()
returns table (
  index_name text,
  index_present boolean,
  index_status text,
  recommendation text
)
language plpgsql
security definer
stable
set search_path = app, public
as $$
declare
  v_index_name text := 'context_asset_chunks_embedding_idx';
  v_embedded_chunks integer;
begin
  select count(*)
  into v_embedded_chunks
  from app.context_asset_chunks
  where embedding is not null;

  index_present := to_regclass('app.context_asset_chunks_embedding_idx') is not null;
  index_name := case when index_present then v_index_name else null end;

  if not index_present then
    index_status := 'missing';
    recommendation := 'Create the app.context_asset_chunks_embedding_idx ivfflat index before relying on vector search.';
  elsif v_embedded_chunks = 0 then
    index_status := 'stale';
    recommendation := 'Backfill context embeddings and recheck the pgvector index health.';
  else
    index_status := 'healthy';
    recommendation := null;
  end if;

  return next;
end;
$$;

grant execute on function app.context_vector_index_health() to authenticated, service_role;
