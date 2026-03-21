create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists vault with schema vault;
create extension if not exists pgmq with schema pgmq;
create extension if not exists pg_cron with schema extensions;

create schema if not exists app;

grant usage on schema app to authenticated, service_role;
grant usage on schema vault to service_role;

create type app.workspace_role as enum ('owner', 'admin', 'member');
create type app.connection_scope as enum ('workspace', 'personal');
create type app.connection_status as enum ('pending', 'active', 'reauth_required', 'revoked', 'error');
create type app.context_asset_type as enum ('document', 'prompt', 'brand_guideline', 'workflow', 'knowledge_base');
create type app.audit_actor_type as enum ('user', 'mcp_client', 'system');
create type app.oauth_client_type as enum ('public', 'confidential');

create table if not exists app.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'starter',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists app.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  email text not null,
  role app.workspace_role not null default 'member',
  invited_by uuid references auth.users (id) on delete set null,
  token_hash text not null unique,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.providers (
  id text primary key,
  display_name text not null,
  auth_kind text not null default 'oauth2',
  supports_personal boolean not null default true,
  supports_workspace boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.provider_scopes (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references app.providers (id) on delete cascade,
  scope text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (provider_id, scope)
);

create table if not exists app.connections (
  id uuid primary key default gen_random_uuid(),
  connection_key text not null unique,
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  provider text not null references app.providers (id) on delete restrict,
  scope app.connection_scope not null default 'workspace',
  status app.connection_status not null default 'pending',
  display_name text not null,
  external_account_id text,
  external_account_email text,
  granted_scopes text[] not null default '{}',
  expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_validated_at timestamptz,
  reauth_required_reason text,
  refresh_lock_id uuid,
  refresh_lock_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.connection_grants (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references app.connections (id) on delete cascade,
  scope text not null,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  unique (connection_id, scope)
);

create table if not exists app.connection_credentials (
  connection_id uuid primary key references app.connections (id) on delete cascade,
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  api_key_secret_id uuid,
  token_type text,
  expires_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.connection_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references app.connections (id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.context_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  type app.context_asset_type not null,
  title text not null,
  source_uri text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.context_asset_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  asset_id uuid not null references app.context_assets (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (asset_id, chunk_index)
);

create table if not exists app.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists app.skill_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  instructions text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists app.context_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  binding_type text not null,
  target_key text not null,
  prompt_template_id uuid references app.prompt_templates (id) on delete cascade,
  skill_definition_id uuid references app.skill_definitions (id) on delete cascade,
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  actor_type app.audit_actor_type not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_client_id text,
  action text not null,
  resource_type text not null,
  resource_id text,
  status text not null default 'success',
  ip inet,
  user_agent text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app.tool_invocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  connection_id uuid references app.connections (id) on delete set null,
  provider text not null,
  tool_name text not null,
  status text not null,
  latency_ms integer,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists app.rate_limit_buckets (
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  subject text not null,
  action text not null,
  window_starts_at timestamptz not null,
  window_seconds integer not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, subject, action, window_starts_at)
);

create table if not exists app.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_type app.oauth_client_type not null default 'public',
  client_name text not null,
  redirect_uris text[] not null,
  grant_types text[] not null default '{authorization_code,refresh_token}',
  response_types text[] not null default '{code}',
  scopes text[] not null default '{mcp:tools,mcp:resources}',
  token_endpoint_auth_method text not null default 'none',
  client_secret_hash text,
  created_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.oauth_authorization_codes (
  code_hash text primary key,
  client_id text not null references app.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  code_challenge text,
  code_challenge_method text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists app.oauth_refresh_tokens (
  token_hash text primary key,
  client_id text not null references app.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_token_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists connections_workspace_provider_idx on app.connections (workspace_id, provider, scope);
create index if not exists context_assets_workspace_idx on app.context_assets (workspace_id, type);
create index if not exists context_asset_chunks_asset_idx on app.context_asset_chunks (asset_id, chunk_index);
create index if not exists context_asset_chunks_embedding_idx on app.context_asset_chunks using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);
create index if not exists audit_logs_workspace_created_idx on app.audit_logs (workspace_id, created_at desc);
create index if not exists tool_invocations_workspace_created_idx on app.tool_invocations (workspace_id, created_at desc);
create index if not exists oauth_refresh_tokens_client_idx on app.oauth_refresh_tokens (client_id, user_id);

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
begin
  insert into app.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function app.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function app.has_workspace_role(p_workspace_id uuid, p_roles app.workspace_role[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = any (p_roles)
  );
$$;

create or replace function app.current_workspace_ids()
returns setof uuid
language sql
stable
as $$
  select wm.workspace_id
  from app.workspace_members wm
  where wm.user_id = auth.uid();
$$;

create or replace function app.store_secret(p_secret text, p_name text default null, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = app, public, vault
as $$
declare
  v_id uuid;
begin
  select vault.create_secret(p_secret, p_name, p_description) into v_id;
  return v_id;
end;
$$;

create or replace function app.put_secret(
  p_secret text,
  p_existing_secret_id uuid default null,
  p_name text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = app, public, vault
as $$
begin
  if p_existing_secret_id is null then
    return app.store_secret(p_secret, p_name, p_description);
  end if;

  perform vault.update_secret(p_existing_secret_id, p_secret, p_name, p_description);
  return p_existing_secret_id;
end;
$$;

create or replace function app.resolve_secret(p_secret_id uuid)
returns text
language sql
security definer
stable
set search_path = app, public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = p_secret_id;
$$;

create or replace function app.acquire_connection_refresh_lock(
  p_connection_id uuid,
  p_lock_id uuid,
  p_ttl_seconds integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_updated integer;
begin
  update app.connections
  set refresh_lock_id = p_lock_id,
      refresh_lock_expires_at = now() + make_interval(secs => p_ttl_seconds),
      updated_at = now()
  where id = p_connection_id
    and (
      refresh_lock_expires_at is null
      or refresh_lock_expires_at < now()
      or refresh_lock_id = p_lock_id
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function app.release_connection_refresh_lock(p_connection_id uuid, p_lock_id uuid)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
  update app.connections
  set refresh_lock_id = null,
      refresh_lock_expires_at = null,
      updated_at = now()
  where id = p_connection_id
    and refresh_lock_id = p_lock_id;
end;
$$;

create or replace function app.enqueue_token_refresh(p_connection_id uuid, p_reason text default 'scheduled')
returns bigint
language sql
security definer
set search_path = app, public, pgmq
as $$
  select pgmq.send('token_refresh', jsonb_build_object('connection_id', p_connection_id, 'reason', p_reason, 'queued_at', now()));
$$;

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
    and (
      p_filters ? 'asset_type' is false
      or ca.type = (p_filters ->> 'asset_type')::app.context_asset_type
    )
  order by cac.embedding <=> p_query_embedding
  limit greatest(p_limit, 1);
$$;

create or replace function app.consume_rate_limit(
  p_workspace_id uuid,
  p_subject text,
  p_action text,
  p_window_seconds integer,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into app.rate_limit_buckets (workspace_id, subject, action, window_starts_at, window_seconds, count, updated_at)
  values (p_workspace_id, p_subject, p_action, v_window_start, p_window_seconds, 1, now())
  on conflict (workspace_id, subject, action, window_starts_at)
  do update set count = app.rate_limit_buckets.count + 1, updated_at = now()
  returning count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'count', v_count,
    'window_started_at', v_window_start
  );
end;
$$;

drop trigger if exists handle_auth_user_created on auth.users;
create trigger handle_auth_user_created
after insert on auth.users
for each row execute procedure app.handle_new_user();

drop trigger if exists set_updated_at_profiles on app.profiles;
create trigger set_updated_at_profiles before update on app.profiles for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_workspaces on app.workspaces;
create trigger set_updated_at_workspaces before update on app.workspaces for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_workspace_members on app.workspace_members;
create trigger set_updated_at_workspace_members before update on app.workspace_members for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_workspace_invites on app.workspace_invites;
create trigger set_updated_at_workspace_invites before update on app.workspace_invites for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_providers on app.providers;
create trigger set_updated_at_providers before update on app.providers for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_connections on app.connections;
create trigger set_updated_at_connections before update on app.connections for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_connection_credentials on app.connection_credentials;
create trigger set_updated_at_connection_credentials before update on app.connection_credentials for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_connection_sync_jobs on app.connection_sync_jobs;
create trigger set_updated_at_connection_sync_jobs before update on app.connection_sync_jobs for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_context_assets on app.context_assets;
create trigger set_updated_at_context_assets before update on app.context_assets for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_prompt_templates on app.prompt_templates;
create trigger set_updated_at_prompt_templates before update on app.prompt_templates for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_skill_definitions on app.skill_definitions;
create trigger set_updated_at_skill_definitions before update on app.skill_definitions for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_context_bindings on app.context_bindings;
create trigger set_updated_at_context_bindings before update on app.context_bindings for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_oauth_clients on app.oauth_clients;
create trigger set_updated_at_oauth_clients before update on app.oauth_clients for each row execute procedure app.set_updated_at();
drop trigger if exists set_updated_at_rate_limit_buckets on app.rate_limit_buckets;
create trigger set_updated_at_rate_limit_buckets before update on app.rate_limit_buckets for each row execute procedure app.set_updated_at();

alter table app.profiles enable row level security;
alter table app.workspaces enable row level security;
alter table app.workspace_members enable row level security;
alter table app.workspace_invites enable row level security;
alter table app.providers enable row level security;
alter table app.provider_scopes enable row level security;
alter table app.connections enable row level security;
alter table app.connection_grants enable row level security;
alter table app.connection_credentials enable row level security;
alter table app.connection_sync_jobs enable row level security;
alter table app.context_assets enable row level security;
alter table app.context_asset_chunks enable row level security;
alter table app.prompt_templates enable row level security;
alter table app.skill_definitions enable row level security;
alter table app.context_bindings enable row level security;
alter table app.audit_logs enable row level security;
alter table app.tool_invocations enable row level security;
alter table app.rate_limit_buckets enable row level security;

create policy "profiles_select_self" on app.profiles for select using (id = auth.uid());
create policy "profiles_update_self" on app.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "workspaces_select_members" on app.workspaces for select using (app.is_workspace_member(id));
create policy "workspaces_insert_creator" on app.workspaces for insert with check (created_by = auth.uid());
create policy "workspaces_update_admins" on app.workspaces for update using (app.has_workspace_role(id, array['owner','admin']::app.workspace_role[]));

create policy "workspace_members_select_members" on app.workspace_members for select using (app.is_workspace_member(workspace_id));
create policy "workspace_members_mutate_admins" on app.workspace_members for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "workspace_invites_select_admins" on app.workspace_invites for select using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));
create policy "workspace_invites_mutate_admins" on app.workspace_invites for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "providers_select_authenticated" on app.providers for select using (auth.role() = 'authenticated');
create policy "provider_scopes_select_authenticated" on app.provider_scopes for select using (auth.role() = 'authenticated');

create policy "connections_select_members" on app.connections for select using (app.is_workspace_member(workspace_id));
create policy "connections_mutate_admins" on app.connections for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "connection_grants_select_members" on app.connection_grants for select using (
  exists (
    select 1 from app.connections c
    where c.id = connection_id and app.is_workspace_member(c.workspace_id)
  )
);
create policy "connection_grants_mutate_admins" on app.connection_grants for all using (
  exists (
    select 1 from app.connections c
    where c.id = connection_id and app.has_workspace_role(c.workspace_id, array['owner','admin']::app.workspace_role[])
  )
) with check (
  exists (
    select 1 from app.connections c
    where c.id = connection_id and app.has_workspace_role(c.workspace_id, array['owner','admin']::app.workspace_role[])
  )
);

create policy "connection_credentials_select_admins" on app.connection_credentials for select using (
  exists (
    select 1 from app.connections c
    where c.id = connection_id and app.has_workspace_role(c.workspace_id, array['owner','admin']::app.workspace_role[])
  )
);

create policy "connection_sync_jobs_select_admins" on app.connection_sync_jobs for select using (
  exists (
    select 1 from app.connections c
    where c.id = connection_id and app.has_workspace_role(c.workspace_id, array['owner','admin']::app.workspace_role[])
  )
);

create policy "context_assets_select_members" on app.context_assets for select using (app.is_workspace_member(workspace_id));
create policy "context_assets_mutate_admins" on app.context_assets for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "context_asset_chunks_select_members" on app.context_asset_chunks for select using (app.is_workspace_member(workspace_id));
create policy "context_asset_chunks_mutate_admins" on app.context_asset_chunks for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "prompt_templates_select_members" on app.prompt_templates for select using (app.is_workspace_member(workspace_id));
create policy "prompt_templates_mutate_admins" on app.prompt_templates for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "skill_definitions_select_members" on app.skill_definitions for select using (app.is_workspace_member(workspace_id));
create policy "skill_definitions_mutate_admins" on app.skill_definitions for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "context_bindings_select_members" on app.context_bindings for select using (app.is_workspace_member(workspace_id));
create policy "context_bindings_mutate_admins" on app.context_bindings for all using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[])) with check (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

create policy "audit_logs_select_admins" on app.audit_logs for select using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));
create policy "tool_invocations_select_admins" on app.tool_invocations for select using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));
create policy "rate_limit_buckets_select_admins" on app.rate_limit_buckets for select using (app.has_workspace_role(workspace_id, array['owner','admin']::app.workspace_role[]));

grant select, insert, update, delete on app.profiles to authenticated;
grant select, insert, update, delete on app.workspaces to authenticated;
grant select, insert, update, delete on app.workspace_members to authenticated;
grant select, insert, update, delete on app.workspace_invites to authenticated;
grant select on app.providers, app.provider_scopes to authenticated;
grant select, insert, update, delete on app.connections to authenticated;
grant select, insert, update, delete on app.connection_grants to authenticated;
grant select on app.connection_credentials, app.connection_sync_jobs to authenticated;
grant select, insert, update, delete on app.context_assets, app.context_asset_chunks, app.prompt_templates, app.skill_definitions, app.context_bindings to authenticated;
grant select on app.audit_logs, app.tool_invocations, app.rate_limit_buckets to authenticated;
grant all privileges on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to authenticated, service_role;
grant execute on function app.current_workspace_ids() to authenticated, service_role;
grant execute on function app.match_context_chunks(uuid, extensions.vector, integer, jsonb) to authenticated, service_role;
grant execute on function app.consume_rate_limit(uuid, text, text, integer, integer) to service_role;
grant execute on function app.store_secret(text, text, text) to service_role;
grant execute on function app.put_secret(text, uuid, text, text) to service_role;
grant execute on function app.resolve_secret(uuid) to service_role;
grant execute on function app.enqueue_token_refresh(uuid, text) to service_role;
grant execute on function app.acquire_connection_refresh_lock(uuid, uuid, integer) to service_role;
grant execute on function app.release_connection_refresh_lock(uuid, uuid) to service_role;

insert into app.providers (id, display_name, auth_kind, supports_personal, supports_workspace, metadata)
values
  ('google', 'Google Workspace', 'oauth2', true, true, jsonb_build_object('category', 'workspace')),
  ('slack', 'Slack', 'oauth2', true, true, jsonb_build_object('category', 'chat')),
  ('notion', 'Notion', 'oauth2', true, true, jsonb_build_object('category', 'knowledge'))
on conflict (id) do update set
  display_name = excluded.display_name,
  auth_kind = excluded.auth_kind,
  supports_personal = excluded.supports_personal,
  supports_workspace = excluded.supports_workspace,
  metadata = excluded.metadata,
  updated_at = now();

insert into app.provider_scopes (provider_id, scope, description)
values
  ('google', 'https://www.googleapis.com/auth/drive.readonly', 'Read Google Drive files'),
  ('google', 'https://www.googleapis.com/auth/documents.readonly', 'Read Google Docs'),
  ('google', 'https://www.googleapis.com/auth/userinfo.email', 'Read Google account email'),
  ('slack', 'channels:read', 'List public Slack channels'),
  ('slack', 'channels:history', 'Read Slack channel history'),
  ('slack', 'groups:history', 'Read private channel history'),
  ('slack', 'chat:write', 'Post Slack messages'),
  ('notion', 'read', 'Read Notion content'),
  ('notion', 'write', 'Write Notion content')
on conflict (provider_id, scope) do nothing;

do $$
begin
  perform pgmq.create('token_refresh');
exception
  when others then null;
end $$;
