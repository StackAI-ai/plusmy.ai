-- Ownership transfers are not a supported edit operation. In particular,
-- changing shared content to personal must not leave a shared derived mirror.
create function app.prevent_context_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'Context ownership cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_context_asset_owner_change
before update of owner_user_id on app.context_assets
for each row execute function app.prevent_context_owner_change();
create trigger prevent_prompt_owner_change
before update of owner_user_id on app.prompt_templates
for each row execute function app.prevent_context_owner_change();
create trigger prevent_skill_owner_change
before update of owner_user_id on app.skill_definitions
for each row execute function app.prevent_context_owner_change();

revoke all on function app.prevent_context_owner_change() from public, anon, authenticated;

-- A workspace-global slug constraint would disclose another owner's private
-- slug through uniqueness errors. Keep uniqueness within each visibility scope.
alter table app.prompt_templates drop constraint prompt_templates_workspace_id_slug_key;
create unique index prompt_templates_shared_slug_key on app.prompt_templates (workspace_id, slug)
  where owner_user_id is null;
create unique index prompt_templates_personal_slug_key on app.prompt_templates (workspace_id, owner_user_id, slug)
  where owner_user_id is not null;
alter table app.skill_definitions drop constraint skill_definitions_workspace_id_slug_key;
create unique index skill_definitions_shared_slug_key on app.skill_definitions (workspace_id, slug)
  where owner_user_id is null;
create unique index skill_definitions_personal_slug_key on app.skill_definitions (workspace_id, owner_user_id, slug)
  where owner_user_id is not null;

-- This global health probe can reveal activity in another workspace. Only the
-- trusted server needs index presence; user-visible counts are actor-scoped.
revoke all on function app.context_vector_index_health() from public, anon, authenticated;
grant execute on function app.context_vector_index_health() to service_role;
