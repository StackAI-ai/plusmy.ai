insert into app.providers (id, display_name, auth_kind, supports_personal, supports_workspace, metadata)
values
  ('confluence', 'Confluence', 'oauth2', true, true, jsonb_build_object('category', 'knowledge')),
  ('zendesk', 'Zendesk', 'oauth2', true, true, jsonb_build_object('category', 'support'))
on conflict (id) do update
set
  display_name = excluded.display_name,
  auth_kind = excluded.auth_kind,
  supports_personal = excluded.supports_personal,
  supports_workspace = excluded.supports_workspace,
  metadata = excluded.metadata,
  updated_at = now();

insert into app.provider_scopes (provider_id, scope, description)
values
  ('confluence', 'read:confluence-content.summary', 'Read Confluence space summary data'),
  ('confluence', 'read:confluence-content.all', 'Read full Confluence page content'),
  ('confluence', 'read:confluence-props-read', 'Read Confluence metadata and properties'),
  ('zendesk', 'read', 'Read Zendesk support data'),
  ('zendesk', 'write', 'Create and update support content'),
  ('zendesk', 'tickets:read', 'Read ticket details for governed operations'),
  ('zendesk', 'tickets:write', 'Post updates and status changes to support tickets')
on conflict (provider_id, scope) do update
set description = excluded.description;
