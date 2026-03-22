insert into app.providers (id, display_name, auth_kind, supports_personal, supports_workspace, metadata)
values
  ('dropbox', 'Dropbox', 'oauth2', true, true, jsonb_build_object('category', 'storage')),
  ('box', 'Box', 'oauth2', true, true, jsonb_build_object('category', 'storage'))
on conflict (id) do update
set
  display_name = excluded.display_name,
  auth_kind = excluded.auth_kind,
  supports_personal = excluded.supports_personal,
  supports_workspace = excluded.supports_workspace,
  metadata = excluded.metadata;

insert into app.provider_scopes (provider_id, scope, description)
values
  ('dropbox', 'account_info.read', 'Read Dropbox account identity'),
  ('dropbox', 'files.metadata.read', 'Search Dropbox files and folders'),
  ('dropbox', 'files.content.read', 'Read Dropbox file content'),
  ('box', 'item_search', 'Search Box files and folders'),
  ('box', 'item_read', 'Read Box file content')
on conflict (provider_id, scope) do update
set description = excluded.description;
