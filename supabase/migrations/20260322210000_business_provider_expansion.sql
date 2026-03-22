insert into app.providers (id, display_name, auth_kind, supports_personal, supports_workspace, metadata)
values
  ('hubspot', 'HubSpot', 'oauth2', true, true, jsonb_build_object('category', 'crm')),
  ('salesforce', 'Salesforce', 'oauth2', true, true, jsonb_build_object('category', 'crm')),
  ('servicenow', 'ServiceNow', 'oauth2', true, true, jsonb_build_object('category', 'support')),
  ('okta', 'Okta', 'oauth2', true, true, jsonb_build_object('category', 'identity')),
  ('asana', 'Asana', 'oauth2', true, true, jsonb_build_object('category', 'project_management')),
  ('monday', 'monday.com', 'oauth2', true, true, jsonb_build_object('category', 'project_management')),
  ('microsoft365', 'Microsoft 365', 'oauth2', true, true, jsonb_build_object('category', 'documents')),
  ('github', 'GitHub', 'oauth2', true, true, jsonb_build_object('category', 'engineering')),
  ('linear', 'Linear', 'oauth2', true, true, jsonb_build_object('category', 'project_management')),
  ('jira', 'Jira', 'oauth2', true, true, jsonb_build_object('category', 'project_management'))
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
  ('hubspot', 'crm.objects.contacts.read', 'Read HubSpot contacts'),
  ('hubspot', 'crm.objects.companies.read', 'Read HubSpot companies'),
  ('hubspot', 'crm.objects.contacts.write', 'Write HubSpot contacts'),
  ('salesforce', 'api', 'Access Salesforce APIs'),
  ('salesforce', 'refresh_token', 'Request refresh tokens for Salesforce'),
  ('salesforce', 'id', 'Access Salesforce identity information'),
  ('servicenow', 'useraccount', 'Access ServiceNow user account context'),
  ('okta', 'okta.users.read', 'Read Okta users'),
  ('okta', 'okta.groups.read', 'Read Okta groups'),
  ('asana', 'default', 'Asana default scope'),
  ('monday', 'me:read', 'Read monday.com user identity'),
  ('monday', 'boards:read', 'Read monday.com boards and items'),
  ('monday', 'boards:write', 'Write monday.com boards and items'),
  ('microsoft365', 'offline_access', 'Request Microsoft 365 refresh tokens'),
  ('microsoft365', 'Files.Read.All', 'Read Microsoft 365 files'),
  ('microsoft365', 'Sites.Read.All', 'Read Microsoft 365 SharePoint sites'),
  ('microsoft365', 'User.Read', 'Read Microsoft 365 user identity'),
  ('github', 'read:user', 'Read GitHub user identity'),
  ('github', 'repo', 'Access GitHub repositories'),
  ('github', 'read:org', 'Read GitHub organization membership'),
  ('linear', 'read', 'Read Linear data'),
  ('linear', 'write', 'Write Linear data'),
  ('linear', 'issues:create', 'Create Linear issues'),
  ('jira', 'read:jira-work', 'Read Jira work data'),
  ('jira', 'write:jira-work', 'Write Jira work data'),
  ('jira', 'offline_access', 'Request Jira refresh tokens')
on conflict (provider_id, scope) do update
set description = excluded.description;

